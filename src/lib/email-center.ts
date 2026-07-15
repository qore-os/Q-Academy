import "server-only";

import { createHash } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  apiKeys,
  emailDeliveries,
  organizations,
  platformSettings,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { emailDeliveryPayloadSource } from "@/lib/email-delivery-snapshot";
import {
  authenticationLinkTemplateVariables,
  DEFAULT_EMAIL_TEMPLATE_SETTINGS,
  DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE,
  EMAIL_CENTER_EVENTS,
  EMAIL_DELIVERY_STATUSES,
  EMAIL_TEMPLATE_SAMPLE_COPY,
  EMAIL_TEMPLATE_EVENTS,
  emailTemplateSettingsSchema,
  PERSONALIZED_EMAIL_TEMPLATE_EVENTS,
  isSafeEmailRetryEvent,
  maskEmailAddress,
  maskRecipientName,
  presentEmailDeliveryContent,
  renderEmailTemplate,
  sanitizeEmailTemplateSettings,
  type AuthenticationLinkEmailEvent,
  type EmailDeliveryStatus,
  type EmailTemplateEvent,
  type EmailTemplateSettings,
} from "@/lib/email-center-model";
import {
  listMemberPropertyVariableCatalog,
  resolveMemberPropertyVariables,
} from "@/lib/member-properties";
import { getPublicAppUrl } from "@/lib/server-environment";
import {
  normalizeLocale,
  SUPPORTED_LOCALES,
  type AppLocale,
} from "@/lib/i18n/model";
import {
  getOrganizationDefaultLocale,
  resolveRecipientLocale,
} from "@/lib/i18n/server";

export const EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY = "email_templates";

function localizedEmailTemplateSettingsKey(locale: AppLocale) {
  return `${EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY}.${locale}`;
}

const ALL_EMAIL_TEMPLATE_SETTINGS_KEYS = [
  EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
  ...SUPPORTED_LOCALES.map(
    (locale) => `${EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY}.${locale}`,
  ),
];

type EmailCenterReader = Pick<typeof db, "select">;

export type EmailTemplateSettingsView = EmailTemplateSettings & {
  locale: AppLocale;
  source: "localized" | "legacy" | "default";
  updatedAt: Date | null;
};

type StoredTemplateRow = {
  key: string;
  value: unknown;
  updatedAt?: Date;
};

function resolveStoredTemplateRow(
  rows: readonly StoredTemplateRow[],
  locale: AppLocale,
  organizationLocale: AppLocale,
) {
  const localized = rows.find(
    (row) => row.key === localizedEmailTemplateSettingsKey(locale),
  );
  if (localized) {
    return { row: localized, source: "localized" as const };
  }
  const legacy =
    locale === organizationLocale
      ? rows.find((row) => row.key === EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY)
      : undefined;
  return legacy
    ? { row: legacy, source: "legacy" as const }
    : { row: undefined, source: "default" as const };
}

async function templateRuntime(
  reader: EmailCenterReader,
  organizationId: string,
  locale: AppLocale,
) {
  const [organization, settingsRows, propertyCatalog] = await Promise.all([
    reader
      .select({
        name: organizations.name,
        defaultLocale: organizations.defaultLocale,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
      .then((rows) => rows[0]),
    reader
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
        updatedAt: platformSettings.updatedAt,
      })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.organizationId, organizationId),
          inArray(platformSettings.key, [
            ...ALL_EMAIL_TEMPLATE_SETTINGS_KEYS,
            "design",
          ]),
        ),
      ),
    listMemberPropertyVariableCatalog(organizationId, reader),
  ]);
  if (!organization) {
    throw new ApiError(404, "not_found", "Academy nicht gefunden.");
  }
  const settingsByKey = new Map(settingsRows.map((row) => [row.key, row.value]));
  const design = settingsByKey.get("design");
  const organizationLocale = normalizeLocale(organization.defaultLocale);
  const localizedDefaults = DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale];
  const storedTemplates = resolveStoredTemplateRow(
    settingsRows,
    locale,
    organizationLocale,
  ).row?.value;
  const platformName =
    design &&
    typeof design === "object" &&
    typeof design.platformName === "string" &&
    design.platformName.trim()
      ? design.platformName.trim().slice(0, 160)
      : organization.name;
  return {
    platformName,
    settings: sanitizeEmailTemplateSettings(
      storedTemplates,
      localizedDefaults,
      {
        "feedback.reply": propertyCatalog.map((entry) => entry.emailToken),
        "lesson.available": propertyCatalog.map((entry) => entry.emailToken),
      },
    ),
    propertyCatalog,
  };
}

export async function renderTenantEmailContent(
  reader: EmailCenterReader,
  input: {
    organizationId: string;
    event: EmailTemplateEvent;
    variables: Record<string, string>;
    locale?: AppLocale;
    recipientUserId?: string;
  },
) {
  const locale = input.locale ?? "de";
  const runtime = await templateRuntime(reader, input.organizationId, locale);
  const properties =
    input.recipientUserId &&
    PERSONALIZED_EMAIL_TEMPLATE_EVENTS.includes(
      input.event as (typeof PERSONALIZED_EMAIL_TEMPLATE_EVENTS)[number],
    )
    ? await resolveMemberPropertyVariables({
        organizationId: input.organizationId,
        userId: input.recipientUserId,
        locale,
        reader,
      })
    : { email: {} as Record<string, string> };
  return renderEmailTemplate({
    event: input.event,
    settings: runtime.settings,
    variables: {
      ...input.variables,
      ...properties.email,
      platformName: runtime.platformName,
    },
    additionalAllowedVariables: runtime.propertyCatalog.map(
      (entry) => entry.emailToken,
    ),
  });
}

export async function renderTenantEmailContentBatch(
  reader: EmailCenterReader,
  input: {
    organizationId: string;
    event: EmailTemplateEvent;
    locale: AppLocale;
    variables: readonly Record<string, string>[];
  },
) {
  if (
    PERSONALIZED_EMAIL_TEMPLATE_EVENTS.includes(
      input.event as (typeof PERSONALIZED_EMAIL_TEMPLATE_EVENTS)[number],
    )
  ) {
    throw new Error(
      "Personalisierte E-Mail-Vorlagen muessen empfaengerbezogen gerendert werden.",
    );
  }
  const runtime = await templateRuntime(
    reader,
    input.organizationId,
    input.locale,
  );
  return input.variables.map((variables) =>
    renderEmailTemplate({
      event: input.event,
      settings: runtime.settings,
      variables: { ...variables, platformName: runtime.platformName },
    }),
  );
}

export async function renderTenantAuthenticationLinkContent(
  reader: EmailCenterReader,
  input: {
    organizationId: string;
    event: AuthenticationLinkEmailEvent;
    firstName: string;
    link: string;
    locale: AppLocale;
  },
) {
  const rendered = await renderTenantEmailContent(reader, {
    organizationId: input.organizationId,
    event: input.event,
    variables: authenticationLinkTemplateVariables(input.event, input),
    locale: input.locale,
  });
  return { ...rendered, link: input.link, locale: input.locale };
}

export async function getEmailTemplateSettings(
  organizationId: string,
  requestedLocale?: AppLocale,
): Promise<EmailTemplateSettingsView> {
  const [rows, organizationLocale, propertyCatalog] = await Promise.all([
    db
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
        updatedAt: platformSettings.updatedAt,
      })
      .from(platformSettings)
      .where(
        and(
          eq(platformSettings.organizationId, organizationId),
          inArray(platformSettings.key, ALL_EMAIL_TEMPLATE_SETTINGS_KEYS),
        ),
      ),
    getOrganizationDefaultLocale(organizationId),
    listMemberPropertyVariableCatalog(organizationId),
  ]);
  const locale = requestedLocale ?? organizationLocale;
  const resolved = resolveStoredTemplateRow(rows, locale, organizationLocale);
  return {
    ...sanitizeEmailTemplateSettings(
      resolved.row?.value,
      DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale],
      {
        "feedback.reply": propertyCatalog.map((entry) => entry.emailToken),
        "lesson.available": propertyCatalog.map((entry) => entry.emailToken),
      },
    ),
    locale,
    source: resolved.source,
    updatedAt: resolved.row?.updatedAt ?? null,
  };
}

async function requireEmailCenterActor(
  tx: ApiTransaction,
  input: { organizationId: string; actorUserId: string },
) {
  const [organization] = await tx
    .select({
      id: organizations.id,
      defaultLocale: organizations.defaultLocale,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, input.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!organization) {
    throw new ApiError(404, "not_found", "Academy nicht gefunden.");
  }
  const [actor] = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(
      and(
        eq(users.id, input.actorUserId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        sql`${users.role} in ('owner', 'admin')`,
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Das E-Mail-Center darf nicht verwaltet werden.",
    );
  }
  return {
    ...actor,
    organizationDefaultLocale: normalizeLocale(organization.defaultLocale),
  };
}

export async function updateEmailTemplateSettings(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId: string;
    source: "admin_ui" | "api";
    settings: EmailTemplateSettings;
    locale?: AppLocale;
  },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`email-templates:${input.organizationId}`}, 0))`,
  );
  const actor = await requireEmailCenterActor(tx, input);
  const propertyCatalog = await listMemberPropertyVariableCatalog(
    input.organizationId,
    tx,
  );
  const additionalVariables = {
    "feedback.reply": propertyCatalog.map((entry) => entry.emailToken),
    "lesson.available": propertyCatalog.map((entry) => entry.emailToken),
  } as const;
  const next = emailTemplateSettingsSchema(additionalVariables).parse(
    input.settings,
  );
  const locale = input.locale ?? actor.organizationDefaultLocale;
  const settingsKey = localizedEmailTemplateSettingsKey(locale);
  const currentRows = await tx
    .select({
      key: platformSettings.key,
      value: platformSettings.value,
      updatedAt: platformSettings.updatedAt,
    })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, input.organizationId),
        inArray(platformSettings.key, [
          settingsKey,
          EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
        ]),
      ),
    )
    .for("update");
  const resolvedCurrent = resolveStoredTemplateRow(
    currentRows,
    locale,
    actor.organizationDefaultLocale,
  );
  const current = sanitizeEmailTemplateSettings(
    resolvedCurrent.row?.value,
    DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale],
    additionalVariables,
  );
  const configurationChanged = JSON.stringify(current) !== JSON.stringify(next);
  const localizedRow = currentRows.find((row) => row.key === settingsKey);
  const legacyRow = currentRows.find(
    (row) => row.key === EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
  );
  const localizedMatches =
    localizedRow !== undefined &&
    JSON.stringify(
      sanitizeEmailTemplateSettings(
        localizedRow.value,
        DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale],
        additionalVariables,
      ),
    ) === JSON.stringify(next);
  const mirrorsLegacy = locale === actor.organizationDefaultLocale;
  const legacyMatches =
    !mirrorsLegacy ||
    (legacyRow !== undefined &&
      JSON.stringify(
        sanitizeEmailTemplateSettings(
          legacyRow.value,
          DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale],
          additionalVariables,
        ),
      ) === JSON.stringify(next));
  const storageMigrationRequired = !localizedMatches || !legacyMatches;
  if (!configurationChanged && !storageMigrationRequired) {
    return {
      ...current,
      locale,
      source: "localized" as const,
      updatedAt: localizedRow?.updatedAt ?? null,
      changed: false,
      migratedLegacy: false,
    };
  }

  const changedEvents = EMAIL_TEMPLATE_EVENTS.filter(
    (event) =>
      JSON.stringify(current.templates[event]) !==
      JSON.stringify(next.templates[event]),
  );
  const configurationHash = createHash("sha256")
    .update(JSON.stringify(next))
    .digest("hex");
  const now = new Date();
  const savedRows = await tx
    .insert(platformSettings)
    .values(
      [settingsKey, ...(mirrorsLegacy ? [EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY] : [])].map(
        (key) => ({
          organizationId: input.organizationId,
          key,
          value: next,
          updatedAt: now,
        }),
      ),
    )
    .onConflictDoUpdate({
      target: [platformSettings.organizationId, platformSettings.key],
      set: { value: next, updatedAt: now },
    })
    .returning({ updatedAt: platformSettings.updatedAt });
  const saved = savedRows.find((row) => row.updatedAt);
  if (!saved) {
    throw new ApiError(
      409,
      "conflict",
      "Die E-Mail-Vorlagen wurden parallel geaendert.",
    );
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    type: "platform.email_templates.updated",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: {
      source: input.source,
      configurationHash,
      changedEventCount: changedEvents.length,
      changedEvents,
      locale,
      migratedLegacy: storageMigrationRequired && !configurationChanged,
    },
  });
  return {
    ...next,
    locale,
    source: "localized" as const,
    updatedAt: saved.updatedAt,
    changed: configurationChanged,
    migratedLegacy: storageMigrationRequired && !configurationChanged,
  };
}

export async function preserveEmailTemplatesAcrossDefaultLocaleChange(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    previousLocale: AppLocale;
    nextLocale: AppLocale;
  },
) {
  if (input.previousLocale === input.nextLocale) return false;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`email-templates:${input.organizationId}`}, 0))`,
  );
  const previousKey = localizedEmailTemplateSettingsKey(input.previousLocale);
  const nextKey = localizedEmailTemplateSettingsKey(input.nextLocale);
  const rows = await tx
    .select({ key: platformSettings.key, value: platformSettings.value })
    .from(platformSettings)
    .where(
      and(
        eq(platformSettings.organizationId, input.organizationId),
        inArray(platformSettings.key, [
          EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
          previousKey,
          nextKey,
        ]),
      ),
    )
    .for("update");
  const legacy = rows.find(
    (row) => row.key === EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
  );
  const previousLocalized = rows.find((row) => row.key === previousKey);
  const nextLocalized = rows.find((row) => row.key === nextKey);
  if (!legacy && !nextLocalized) return false;

  const now = new Date();
  if (legacy && !previousLocalized) {
    const previousSettings = sanitizeEmailTemplateSettings(
      legacy.value,
      DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[input.previousLocale],
    );
    await tx
      .insert(platformSettings)
      .values({
        organizationId: input.organizationId,
        key: previousKey,
        value: previousSettings,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }

  const nextSettings = sanitizeEmailTemplateSettings(
    nextLocalized?.value,
    DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[input.nextLocale],
  );
  await tx
    .insert(platformSettings)
    .values({
      organizationId: input.organizationId,
      key: EMAIL_TEMPLATE_PLATFORM_SETTINGS_KEY,
      value: nextSettings,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [platformSettings.organizationId, platformSettings.key],
      set: { value: nextSettings, updatedAt: now },
    });
  return true;
}

export type EmailDeliveryListFilters = {
  search?: string;
  event?: string;
  status?: EmailDeliveryStatus;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
};

function literalSearchPattern(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function emailDeliveryConditions(
  organizationId: string,
  input: EmailDeliveryListFilters,
) {
  const conditions: SQL[] = [eq(emailDeliveries.organizationId, organizationId)];
  if (input.event) conditions.push(eq(emailDeliveries.event, input.event));
  if (input.status) conditions.push(eq(emailDeliveries.status, input.status));
  if (input.from) conditions.push(gte(emailDeliveries.createdAt, input.from));
  if (input.to) conditions.push(lte(emailDeliveries.createdAt, input.to));
  const search = input.search?.trim();
  if (search) {
    const pattern = literalSearchPattern(search);
    conditions.push(
      or(
        ilike(emailDeliveries.recipientEmail, pattern),
        ilike(users.email, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
      )!,
    );
  }
  return conditions;
}

export async function listEmailDeliveries(
  organizationId: string,
  input: EmailDeliveryListFilters,
) {
  const limit = Math.max(1, Math.min(100, input.limit));
  const offset = Math.max(0, input.offset);
  const conditions = emailDeliveryConditions(organizationId, input);
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: emailDeliveries.id,
        event: emailDeliveries.event,
        status: emailDeliveries.status,
        attempt: emailDeliveries.attempt,
        responseStatus: emailDeliveries.responseStatus,
        nextRetryAt: emailDeliveries.nextRetryAt,
        deliveredAt: emailDeliveries.deliveredAt,
        createdAt: emailDeliveries.createdAt,
        updatedAt: emailDeliveries.updatedAt,
        recipientEmail: emailDeliveries.recipientEmail,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(emailDeliveries)
      .innerJoin(
        users,
        and(
          eq(users.id, emailDeliveries.userId),
          eq(users.organizationId, emailDeliveries.organizationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(emailDeliveries.createdAt), desc(emailDeliveries.id))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: count() })
      .from(emailDeliveries)
      .innerJoin(
        users,
        and(
          eq(users.id, emailDeliveries.userId),
          eq(users.organizationId, emailDeliveries.organizationId),
        ),
      )
      .where(and(...conditions)),
  ]);
  return {
    data: rows.map((row) => ({
      id: row.id,
      event: row.event,
      status: row.status,
      attempt: row.attempt,
      responseStatus: row.responseStatus,
      nextRetryAt: row.nextRetryAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      recipient: {
        name: maskRecipientName(row.firstName, row.lastName),
        email: maskEmailAddress(row.recipientEmail),
      },
    })),
    total: Number(totalRows[0]?.value ?? 0),
    limit,
    offset,
  };
}

function safeFailureSummary(input: {
  status: EmailDeliveryStatus;
  responseStatus: number | null;
  responseBody: string | null;
}) {
  if (input.status !== "failed" && input.status !== "retrying") return null;
  if (input.responseStatus) {
    return `Das Mail-Gateway antwortete mit HTTP ${input.responseStatus}.`;
  }
  const allowed = new Set([
    "Die E-Mail-Zustellung ist nicht konfiguriert.",
    "Die E-Mail-Zustellung ist fehlgeschlagen.",
    "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.",
  ]);
  return input.responseBody && allowed.has(input.responseBody)
    ? input.responseBody
    : "Die E-Mail-Zustellung ist fehlgeschlagen.";
}

export async function getEmailDeliveryDetail(
  organizationId: string,
  deliveryId: string,
) {
  const [row] = await db
    .select({
      delivery: emailDeliveries,
      recipient: {
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: users.status,
        role: users.role,
      },
    })
    .from(emailDeliveries)
    .innerJoin(
      users,
      and(
        eq(users.id, emailDeliveries.userId),
        eq(users.organizationId, emailDeliveries.organizationId),
      ),
    )
    .where(
      and(
        eq(emailDeliveries.id, deliveryId),
        eq(emailDeliveries.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ApiError(404, "not_found", "E-Mail-Versand nicht gefunden.");
  }
  let content = presentEmailDeliveryContent(row.delivery.event, null);
  if (isSafeEmailRetryEvent(row.delivery.event)) {
    try {
      const decrypted: unknown = JSON.parse(
        decryptPayload(
          row.delivery.payload,
          `email-delivery:${row.delivery.id}`,
        ),
      );
      content = presentEmailDeliveryContent(
        row.delivery.event,
        emailDeliveryPayloadSource({
          event: row.delivery.event,
          email: row.delivery.recipientEmail,
          organizationId: row.delivery.organizationId,
          payload: decrypted,
        }),
      );
    } catch {
      content = { available: false, reason: "invalid_payload" };
    }
  }
  return {
    id: row.delivery.id,
    event: row.delivery.event,
    status: row.delivery.status,
    attempt: row.delivery.attempt,
    responseStatus: row.delivery.responseStatus,
    failureSummary: safeFailureSummary(row.delivery),
    nextRetryAt: row.delivery.nextRetryAt,
    deliveredAt: row.delivery.deliveredAt,
    createdAt: row.delivery.createdAt,
    updatedAt: row.delivery.updatedAt,
    recipient: {
      ...row.recipient,
      email: row.delivery.recipientEmail,
    },
    content,
    canRetry:
      row.delivery.status === "failed" &&
      isSafeEmailRetryEvent(row.delivery.event),
  };
}

export async function retryFailedEmailDelivery(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId: string;
    deliveryId: string;
    source: "admin_ui" | "api";
  },
) {
  await requireEmailCenterActor(tx, input);
  const [row] = await tx
    .select({ delivery: emailDeliveries })
    .from(emailDeliveries)
    .innerJoin(
      users,
      and(
        eq(users.id, emailDeliveries.userId),
        eq(users.organizationId, emailDeliveries.organizationId),
      ),
    )
    .where(
      and(
        eq(emailDeliveries.id, input.deliveryId),
        eq(emailDeliveries.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: emailDeliveries });
  const current = row?.delivery;
  if (!current) {
    throw new ApiError(404, "not_found", "E-Mail-Versand nicht gefunden.");
  }
  if (!isSafeEmailRetryEvent(current.event)) {
    throw new ApiError(
      409,
      "conflict",
      "Dieser E-Mail-Typ darf nicht manuell wiederholt werden.",
    );
  }
  if (current.status === "pending" && current.attempt === 0) {
    const [existingRetry] = await tx
      .select({ id: activityEvents.id })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.organizationId, input.organizationId),
          eq(activityEvents.type, "email.delivery.retried"),
          eq(activityEvents.entityType, "email_delivery"),
          eq(activityEvents.entityId, current.id),
        ),
      )
      .limit(1);
    if (existingRetry) return { delivery: current, changed: false };
  }
  if (current.status !== "failed") {
    throw new ApiError(
      409,
      "conflict",
      "Nur fehlgeschlagene E-Mails koennen wiederholt werden.",
    );
  }
  const now = new Date();
  const [delivery] = await tx
    .update(emailDeliveries)
    .set({
      status: "pending",
      attempt: 0,
      responseStatus: null,
      responseBody: null,
      nextRetryAt: null,
      claimedAt: null,
      deliveredAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailDeliveries.id, input.deliveryId),
        eq(emailDeliveries.organizationId, input.organizationId),
        eq(emailDeliveries.status, "failed"),
      ),
    )
    .returning();
  if (!delivery) {
    throw new ApiError(
      409,
      "conflict",
      "Der E-Mail-Versand wurde parallel geaendert.",
    );
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    type: "email.delivery.retried",
    entityType: "email_delivery",
    entityId: delivery.id,
    metadata: {
      source: input.source,
      event: delivery.event,
      previousAttemptCount: current.attempt,
    },
  });
  return { delivery, changed: true };
}

function deterministicDeliveryId(
  organizationId: string,
  requestId: string,
) {
  const hex = createHash("sha256")
    .update(`email-template-test\0${organizationId}\0${requestId}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16] ?? "0", 16) % 4]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function queueEmailTemplateTest(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId: string;
    event: EmailTemplateEvent;
    requestId: string;
    source: "admin_ui" | "api";
    locale?: AppLocale;
  },
) {
  const actor = await requireEmailCenterActor(tx, input);
  const publicAppUrl = getPublicAppUrl();
  const recipientLocale =
    input.locale ??
    (await resolveRecipientLocale(tx, {
      organizationId: input.organizationId,
      userId: actor.id,
    }));
  const sample = EMAIL_TEMPLATE_SAMPLE_COPY[recipientLocale];
  let variables: Record<string, string>;
  switch (input.event) {
    case "feedback.reply":
      variables = {
        defaultSubject: sample.feedbackSubject,
        defaultMessage: sample.feedbackMessage,
        firstName: actor.firstName,
      };
      break;
    case "lesson.available":
      variables = {
        defaultSubject: sample.lessonSubject,
        defaultMessage: sample.lessonMessage,
        firstName: actor.firstName,
        lessonTitle: sample.lessonTitle,
        courseTitle: sample.courseTitle,
        lessonUrl: new URL("/academy", publicAppUrl).toString(),
      };
      break;
    case "course.modules.released":
      variables = {
        firstName: actor.firstName,
        courseTitle: sample.courseTitle,
        moduleList: sample.moduleList,
        courseUrl: new URL("/academy/courses", publicAppUrl).toString(),
      };
      break;
    case "invitation.created":
      variables = authenticationLinkTemplateVariables(input.event, {
        firstName: actor.firstName,
        link: new URL("/invitations/beispiel", publicAppUrl).toString(),
        locale: recipientLocale,
      });
      break;
    case "password.reset":
      variables = authenticationLinkTemplateVariables(input.event, {
        firstName: actor.firstName,
        link: new URL(
          "/password/reset?token=beispiel",
          publicAppUrl,
        ).toString(),
        locale: recipientLocale,
      });
      break;
  }
  const rendered = await renderTenantEmailContent(tx, {
    organizationId: input.organizationId,
    event: input.event,
    variables,
    locale: recipientLocale,
    recipientUserId: actor.id,
  });
  const deliveryId = deterministicDeliveryId(
    input.organizationId,
    input.requestId,
  );
  const [created] = await tx
    .insert(emailDeliveries)
    .values({
      id: deliveryId,
      organizationId: input.organizationId,
      userId: actor.id,
      event: "email.template.test",
      category: "system",
      recipientEmail: actor.email,
      payload: encryptPayload(
        JSON.stringify({
          ...rendered,
          locale: recipientLocale,
        }),
        `email-delivery:${deliveryId}`,
      ),
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [existing] = await tx
      .select()
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.id, deliveryId),
          eq(emailDeliveries.organizationId, input.organizationId),
          eq(emailDeliveries.userId, actor.id),
          eq(emailDeliveries.event, "email.template.test"),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new ApiError(
        409,
        "conflict",
        "Die Testsendung konnte nicht eindeutig zugeordnet werden.",
      );
    }
    return { delivery: existing, locale: recipientLocale, changed: false };
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: actor.id,
    type: "email.template_test.queued",
    entityType: "email_delivery",
    entityId: created.id,
    metadata: {
      source: input.source,
      templateEvent: input.event,
      locale: recipientLocale,
    },
  });
  return { delivery: created, locale: recipientLocale, changed: true };
}

export async function requireEmailApiKeyActor(
  tx: ApiTransaction,
  input: { organizationId: string; apiKeyId: string },
) {
  const now = new Date();
  const [key] = await tx
    .select({ createdById: apiKeys.createdById })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
        eq(apiKeys.status, "active"),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
      ),
    )
    .limit(1)
    .for("share");
  if (!key?.createdById) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Owner oder Admin zugeordnet.",
    );
  }
  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, key.createdById),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        sql`${users.role} in ('owner', 'admin')`,
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Owner oder Admin zugeordnet.",
    );
  }
  return actor.id;
}

export function validEmailCenterEvent(value: string | undefined) {
  return !value || EMAIL_CENTER_EVENTS.some((event) => event === value);
}

export function validEmailDeliveryStatus(
  value: string | undefined,
): value is EmailDeliveryStatus | undefined {
  return !value || EMAIL_DELIVERY_STATUSES.some((status) => status === value);
}

export { DEFAULT_EMAIL_TEMPLATE_SETTINGS };
