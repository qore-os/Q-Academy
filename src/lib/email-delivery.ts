import "server-only";

import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  emailDeliveries,
  organizations,
  platformSettings,
  userNotificationPreferences,
  users,
} from "@/db/schema";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { renderTenantAuthenticationLinkContent } from "@/lib/email-center";
import {
  authenticationLinkRenderedPayloadSchema,
  authenticationLinkSourcePayloadSchema,
  isAuthenticationLinkEmailEvent,
} from "@/lib/email-center-model";
import {
  buildEmailGatewayRequest,
  canDispatchEmailToRecipient,
  emailTenantBrandingFromTenantBranding,
  type EmailGatewayRequest,
} from "@/lib/email-gateway-contract";
import {
  createEmailDeliveryPayloadEnvelope,
  parseEmailDeliveryPayload,
  parseEmailGatewayRequestForDelivery,
} from "@/lib/email-delivery-snapshot";
import { getEmailDeliveryConfiguration } from "@/lib/server-environment";
import { normalizeLocale } from "@/lib/i18n/model";
import {
  brandingFromRow,
  canonicalTenantAuthOrigin,
} from "@/lib/branding";
import { activeEmailSuppression } from "@/lib/email-feedback";

const MAX_ATTEMPTS = 8;
const PROCESSING_LEASE_MS = 5 * 60_000;
const WORKER_CONCURRENCY = 5;

function retryAt(attempt: number) {
  const baseDelay = Math.min(
    60 * 60_000,
    30_000 * 2 ** Math.max(0, attempt - 1),
  );
  const jitter = Math.round(baseDelay * (Math.random() * 0.2 - 0.1));
  return new Date(Date.now() + baseDelay + jitter);
}

async function claimNextEmailDelivery() {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
  return db.transaction(async (tx) => {
    const [delivery] = await tx
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(
        or(
          eq(emailDeliveries.status, "pending"),
          and(
            eq(emailDeliveries.status, "retrying"),
            lte(emailDeliveries.nextRetryAt, now),
          ),
          and(
            eq(emailDeliveries.status, "processing"),
            or(
              isNull(emailDeliveries.claimedAt),
              lte(emailDeliveries.claimedAt, staleBefore),
            ),
          ),
        ),
      )
      .orderBy(asc(emailDeliveries.createdAt))
      .limit(1)
      .for("update", { of: emailDeliveries, skipLocked: true });
    if (!delivery) return null;
    await tx
      .update(emailDeliveries)
      .set({ status: "processing", claimedAt: now, updatedAt: now })
      .where(eq(emailDeliveries.id, delivery.id));
    return { id: delivery.id, claimedAt: now };
  });
}

type EmailDeliveryClaim = { id: string; claimedAt: Date };

type EmailDeliveryDependencies = {
  beforeProviderRevalidation?: () => Promise<void> | void;
  afterSnapshotFreezeBeforeFinalRevalidation?: () => Promise<void> | void;
};

async function finishEmailWithoutDelivery(
  claim: EmailDeliveryClaim,
  input: { attempt: number; detail: string },
) {
  const [updated] = await db
    .update(emailDeliveries)
    .set({
      status: "failed",
      attempt: input.attempt,
      responseStatus: null,
      responseBody: input.detail,
      nextRetryAt: null,
      claimedAt: null,
      deliveredAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailDeliveries.id, claim.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .returning();
  return updated ?? null;
}

async function revalidateProviderRecipient(
  claim: EmailDeliveryClaim,
  attempt: number,
) {
  const [recipient] = await db
    .select({
      event: emailDeliveries.event,
      organizationId: emailDeliveries.organizationId,
      recipientEmail: emailDeliveries.recipientEmail,
      category: emailDeliveries.category,
      recipientStatus: users.status,
      recipientRole: users.role,
      emailEnabled: userNotificationPreferences.emailEnabled,
    })
    .from(emailDeliveries)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, emailDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, emailDeliveries.userId),
        eq(users.organizationId, emailDeliveries.organizationId),
        eq(users.email, emailDeliveries.recipientEmail),
      ),
    )
    .leftJoin(
      userNotificationPreferences,
      and(
        eq(
          userNotificationPreferences.organizationId,
          emailDeliveries.organizationId,
        ),
        eq(userNotificationPreferences.userId, emailDeliveries.userId),
        eq(userNotificationPreferences.category, emailDeliveries.category),
      ),
    )
    .where(
      and(
        eq(emailDeliveries.id, claim.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .limit(1);
  if (
    !recipient ||
    !canDispatchEmailToRecipient({
      event: recipient.event,
      recipientStatus: recipient.recipientStatus,
      recipientRole: recipient.recipientRole,
    })
  ) {
    return {
      allowed: false as const,
      result: await finishEmailWithoutDelivery(claim, {
        attempt,
        detail:
          "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.",
      }),
    };
  }
  if (recipient.category !== "system" && recipient.emailEnabled === false) {
    return {
      allowed: false as const,
      result: await finishEmailWithoutDelivery(claim, {
        attempt,
        detail: "Durch Benachrichtigungseinstellungen unterdrueckt.",
      }),
    };
  }
  const suppression = await activeEmailSuppression({
    organizationId: recipient.organizationId,
    recipientEmail: recipient.recipientEmail,
  });
  if (suppression) {
    return {
      allowed: false as const,
      result: await finishEmailWithoutDelivery(claim, {
        attempt,
        detail:
          "Die E-Mail wurde wegen einer aktiven Empfaengersperre nicht zugestellt.",
      }),
    };
  }
  return { allowed: true as const, recipient };
}

export async function deliverQueuedEmail(
  claim: EmailDeliveryClaim,
  dependencies: EmailDeliveryDependencies = {},
) {
  const [record] = await db
    .select({
      delivery: emailDeliveries,
      organization: {
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        primaryColor: organizations.primaryColor,
        accentColor: organizations.accentColor,
        logoMark: organizations.logoMark,
      },
      recipientStatus: users.status,
      recipientRole: users.role,
      recipientFirstName: users.firstName,
      emailEnabled: userNotificationPreferences.emailEnabled,
      design: platformSettings.value,
    })
    .from(emailDeliveries)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, emailDeliveries.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, emailDeliveries.userId),
        eq(users.organizationId, emailDeliveries.organizationId),
        eq(users.email, emailDeliveries.recipientEmail),
      ),
    )
    .leftJoin(
      platformSettings,
      and(
        eq(platformSettings.organizationId, organizations.id),
        eq(platformSettings.key, "design"),
      ),
    )
    .leftJoin(
      userNotificationPreferences,
      and(
        eq(
          userNotificationPreferences.organizationId,
          emailDeliveries.organizationId,
        ),
        eq(userNotificationPreferences.userId, emailDeliveries.userId),
        eq(userNotificationPreferences.category, emailDeliveries.category),
      ),
    )
    .where(
      and(
        eq(emailDeliveries.id, claim.id),
        eq(emailDeliveries.status, "processing"),
        eq(emailDeliveries.claimedAt, claim.claimedAt),
      ),
    )
    .limit(1);
  if (!record) {
    const [failed] = await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        attempt: sql`${emailDeliveries.attempt} + 1`,
        responseStatus: null,
        responseBody:
          "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.",
        nextRetryAt: null,
        claimedAt: null,
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailDeliveries.id, claim.id),
          eq(emailDeliveries.status, "processing"),
          eq(emailDeliveries.claimedAt, claim.claimedAt),
        ),
      )
      .returning();
    return failed ?? null;
  }
  const delivery = record.delivery;
  const claimCondition = eq(emailDeliveries.claimedAt, claim.claimedAt);

  const attempt = delivery.attempt + 1;
  if (delivery.category !== "system" && record.emailEnabled === false) {
    const [failed] = await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        attempt,
        responseStatus: null,
        responseBody: "Durch Benachrichtigungseinstellungen unterdrueckt.",
        nextRetryAt: null,
        claimedAt: null,
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailDeliveries.id, claim.id),
          eq(emailDeliveries.status, "processing"),
          claimCondition,
        ),
      )
      .returning();
    return failed ?? null;
  }
  if (
    !canDispatchEmailToRecipient({
      event: delivery.event,
      recipientStatus: record.recipientStatus,
      recipientRole: record.recipientRole,
    })
  ) {
    const [failed] = await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        attempt,
        responseStatus: null,
        responseBody:
          "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.",
        nextRetryAt: null,
        claimedAt: null,
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailDeliveries.id, claim.id),
          eq(emailDeliveries.status, "processing"),
          claimCondition,
        ),
      )
      .returning();
    return failed;
  }
  const suppression = await activeEmailSuppression({
    organizationId: delivery.organizationId,
    recipientEmail: delivery.recipientEmail,
  });
  if (suppression) {
    const [failed] = await db
      .update(emailDeliveries)
      .set({
        status: "failed",
        attempt,
        responseStatus: null,
        responseBody:
          "Die E-Mail wurde wegen einer aktiven Empfaengersperre nicht zugestellt.",
        nextRetryAt: null,
        claimedAt: null,
        deliveredAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(emailDeliveries.id, claim.id),
          eq(emailDeliveries.status, "processing"),
          claimCondition,
        ),
      )
      .returning();
    return failed;
  }
  const configuration = getEmailDeliveryConfiguration();
  if (!configuration) {
    return finishEmailWithoutDelivery(claim, {
      attempt,
      detail: "Die E-Mail-Zustellung ist nicht konfiguriert.",
    });
  }
  let responseStatus: number | null = null;
  let responseBody = "";
  let delivered = false;
  try {
    const decryptedPayload: unknown = JSON.parse(
      decryptPayload(delivery.payload, `email-delivery:${delivery.id}`),
    );
    const storedPayload = parseEmailDeliveryPayload({
      event: delivery.event,
      email: delivery.recipientEmail,
      organizationId: delivery.organizationId,
      payload: decryptedPayload,
    });
    let gatewayRequest: EmailGatewayRequest;
    if (storedPayload.kind === "snapshot") {
      gatewayRequest = storedPayload.gatewayRequest;
    } else {
      let requestPayload = storedPayload.source;
      if (
        isAuthenticationLinkEmailEvent(delivery.event) &&
        !authenticationLinkRenderedPayloadSchema.safeParse(requestPayload)
          .success
      ) {
        const source =
          authenticationLinkSourcePayloadSchema.parse(requestPayload);
        requestPayload = await renderTenantAuthenticationLinkContent(db, {
          organizationId: delivery.organizationId,
          event: delivery.event,
          firstName: record.recipientFirstName,
          link: source.link,
          locale: normalizeLocale(source.locale),
        });
      }
      const payloadLocale =
        typeof requestPayload === "object" &&
        requestPayload !== null &&
        "locale" in requestPayload
          ? normalizeLocale(requestPayload.locale)
          : "de";
      const branding = brandingFromRow({
        ...record.organization,
        settings:
          record.design && typeof record.design === "object"
            ? record.design
            : null,
      });
      const tenantBranding = emailTenantBrandingFromTenantBranding({
        branding,
        organizationName: record.organization.name,
        assetOrigin: canonicalTenantAuthOrigin(branding),
        locale: payloadLocale,
      });
      gatewayRequest = buildEmailGatewayRequest({
        event: delivery.event,
        email: delivery.recipientEmail,
        decryptedPayload: requestPayload,
        tenantBranding,
      });
    }
    await dependencies.beforeProviderRevalidation?.();
    const firstRevalidation = await revalidateProviderRecipient(claim, attempt);
    if (!firstRevalidation.allowed) return firstRevalidation.result;
    let providerRecipient = firstRevalidation.recipient;
    gatewayRequest = parseEmailGatewayRequestForDelivery({
      event: providerRecipient.event,
      email: providerRecipient.recipientEmail,
      organizationId: providerRecipient.organizationId,
      gatewayRequest,
    });
    let expectedPayload = delivery.payload;
    if (storedPayload.kind === "legacy") {
      const envelope = createEmailDeliveryPayloadEnvelope({
        event: providerRecipient.event,
        email: providerRecipient.recipientEmail,
        organizationId: providerRecipient.organizationId,
        source: storedPayload.source,
        gatewayRequest,
      });
      const encryptedEnvelope = encryptPayload(
        JSON.stringify(envelope),
        `email-delivery:${delivery.id}`,
      );
      const [frozen] = await db
        .update(emailDeliveries)
        .set({
          payload: encryptedEnvelope,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(emailDeliveries.id, claim.id),
            eq(emailDeliveries.status, "processing"),
            eq(emailDeliveries.claimedAt, claim.claimedAt),
            eq(emailDeliveries.event, providerRecipient.event),
            eq(
              emailDeliveries.organizationId,
              providerRecipient.organizationId,
            ),
            eq(
              emailDeliveries.recipientEmail,
              providerRecipient.recipientEmail,
            ),
            eq(emailDeliveries.payload, delivery.payload),
          ),
        )
        .returning({ id: emailDeliveries.id });
      if (!frozen) return null;
      gatewayRequest = envelope.gatewayRequest;
      expectedPayload = encryptedEnvelope;
    }
    await dependencies.afterSnapshotFreezeBeforeFinalRevalidation?.();
    const finalRevalidation = await revalidateProviderRecipient(claim, attempt);
    if (!finalRevalidation.allowed) return finalRevalidation.result;
    providerRecipient = finalRevalidation.recipient;
    gatewayRequest = parseEmailGatewayRequestForDelivery({
      event: providerRecipient.event,
      email: providerRecipient.recipientEmail,
      organizationId: providerRecipient.organizationId,
      gatewayRequest,
    });
    const [currentSnapshot] = await db
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.id, claim.id),
          eq(emailDeliveries.status, "processing"),
          eq(emailDeliveries.claimedAt, claim.claimedAt),
          eq(emailDeliveries.event, providerRecipient.event),
          eq(
            emailDeliveries.organizationId,
            providerRecipient.organizationId,
          ),
          eq(
            emailDeliveries.recipientEmail,
            providerRecipient.recipientEmail,
          ),
          eq(emailDeliveries.payload, expectedPayload),
        ),
      )
      .limit(1);
    if (!currentSnapshot) return null;
    const response = await fetch(configuration.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": delivery.id,
        ...(configuration.secret
          ? { Authorization: `Bearer ${configuration.secret}` }
          : {}),
      },
      body: JSON.stringify(gatewayRequest),
    });
    responseStatus = response.status;
    await response.body?.cancel();
    delivered = response.status >= 200 && response.status < 300;
    responseBody = delivered
      ? ""
      : `Das Mail-Gateway antwortete mit HTTP ${response.status}.`;
  } catch {
    responseBody = "Die E-Mail-Zustellung ist fehlgeschlagen.";
  }

  const status = delivered
    ? "delivered"
    : attempt >= MAX_ATTEMPTS
      ? "failed"
      : "retrying";
  const [updated] = await db
    .update(emailDeliveries)
    .set({
      status,
      attempt,
      responseStatus,
      responseBody,
      nextRetryAt: status === "retrying" ? retryAt(attempt) : null,
      claimedAt: null,
      deliveredAt: delivered ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailDeliveries.id, claim.id),
        eq(emailDeliveries.status, "processing"),
        claimCondition,
      ),
    )
    .returning();
  return updated;
}

export async function processEmailQueue(limit = 25) {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const claims: EmailDeliveryClaim[] = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const claim = await claimNextEmailDelivery();
    if (!claim) break;
    claims.push(claim);
  }

  const results = [];
  for (let index = 0; index < claims.length; index += WORKER_CONCURRENCY) {
    const batch = claims.slice(index, index + WORKER_CONCURRENCY);
    const delivered = await Promise.all(
      batch.map((claim) => deliverQueuedEmail(claim)),
    );
    results.push(...delivered.filter((result) => result !== null));
  }
  return results;
}
