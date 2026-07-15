import "server-only";

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  apiKeys,
  oidcConfigurations,
  oidcIdentities,
  organizations,
  userSessions,
  users,
  type OidcConfiguration,
} from "@/db/schema";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  normalizeOidcEmailDomains,
  normalizeOidcIssuer,
  oidcClientIdSchema,
  oidcClientSecretSchema,
  oidcConfigurationPatchSchema,
  oidcDisplayNameSchema,
  OIDC_DEFAULT_CONFIGURATION,
  type OidcConfigurationPatch,
  type OidcConfigurationView,
} from "@/lib/oidc-model";

const OIDC_CLIENT_SECRET_CONTEXT_PREFIX = "q-academy:oidc-client-secret:v1";

function clientSecretContext(organizationId: string) {
  return `${OIDC_CLIENT_SECRET_CONTEXT_PREFIX}\n${organizationId}`;
}

function viewFromRow(row: OidcConfiguration | undefined): OidcConfigurationView {
  if (!row) return { ...OIDC_DEFAULT_CONFIGURATION, updatedAt: null };
  return {
    enabled: row.enabled,
    displayName: row.displayName,
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecretConfigured: row.clientSecretEncrypted !== null,
    autoProvisionMembers: row.autoProvisionMembers,
    allowedEmailDomains: [...row.allowedEmailDomains],
    passwordLoginEnabled: row.passwordLoginEnabled,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function decryptClientSecret(row: OidcConfiguration) {
  if (!row.clientSecretEncrypted) return null;
  return decryptPayload(
    row.clientSecretEncrypted,
    clientSecretContext(row.organizationId),
  );
}

type ClientSecretPatchMode = "preserve" | "replace" | "clear";

function clientSecretPatchMode(
  patch: OidcConfigurationPatch,
): ClientSecretPatchMode {
  if (patch.clientSecret === undefined || patch.clientSecret === "") {
    return "preserve";
  }
  return patch.clientSecret === null ? "clear" : "replace";
}

function currentClientSecretForPatch(
  row: OidcConfiguration | undefined,
  mode: ClientSecretPatchMode,
) {
  if (mode !== "preserve" || !row?.clientSecretEncrypted) return null;
  try {
    return decryptClientSecret(row);
  } catch {
    throw new ApiError(
      409,
      "conflict",
      "Das gespeicherte Client-Secret kann nicht gelesen werden und muss ersetzt werden.",
    );
  }
}

export async function getOidcConfiguration(
  organizationId: string,
): Promise<OidcConfigurationView> {
  const [row] = await db
    .select()
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, organizationId))
    .limit(1);
  return viewFromRow(row);
}

export type OidcPublicLoginConfiguration = {
  enabled: boolean;
  displayName: string;
  passwordLoginEnabled: boolean;
};

export async function getPublicOidcLoginConfiguration(
  organizationId: string | null | undefined,
): Promise<OidcPublicLoginConfiguration> {
  if (!organizationId) {
    return {
      enabled: false,
      displayName: OIDC_DEFAULT_CONFIGURATION.displayName,
      passwordLoginEnabled: true,
    };
  }
  const [row] = await db
    .select({
      enabled: oidcConfigurations.enabled,
      displayName: oidcConfigurations.displayName,
      passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
    })
    .from(oidcConfigurations)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, oidcConfigurations.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(eq(oidcConfigurations.organizationId, organizationId))
    .limit(1);
  return row ?? {
    enabled: false,
    displayName: OIDC_DEFAULT_CONFIGURATION.displayName,
    passwordLoginEnabled: true,
  };
}

export type OidcRuntimeConfiguration = {
  organizationId: string;
  enabled: true;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  autoProvisionMembers: boolean;
  allowedEmailDomains: string[];
  passwordLoginEnabled: boolean;
  version: number;
};

export async function getOidcRuntimeConfiguration(
  organizationId: string,
): Promise<OidcRuntimeConfiguration | null> {
  const [row] = await db
    .select()
    .from(oidcConfigurations)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, oidcConfigurations.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(oidcConfigurations.organizationId, organizationId),
        eq(oidcConfigurations.enabled, true),
      ),
    )
    .limit(1);
  const configuration = row?.oidc_configurations;
  if (
    !configuration?.issuer ||
    !configuration.clientId ||
    !configuration.clientSecretEncrypted
  ) {
    return null;
  }
  let clientSecret: string;
  try {
    clientSecret = oidcClientSecretSchema.parse(
      decryptClientSecret(configuration),
    );
  } catch {
    throw new ApiError(
      503,
      "internal_error",
      "Der Unternehmens-Login ist derzeit nicht verfuegbar.",
    );
  }
  return {
    organizationId,
    enabled: true,
    displayName: configuration.displayName,
    issuer: configuration.issuer,
    clientId: configuration.clientId,
    clientSecret,
    autoProvisionMembers: configuration.autoProvisionMembers,
    allowedEmailDomains: [...configuration.allowedEmailDomains],
    passwordLoginEnabled: configuration.passwordLoginEnabled,
    version: configuration.version,
  };
}

export async function lockOidcConfiguration(
  tx: ApiTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`oidc-configuration:${organizationId}`}, 0))`,
  );
}

function parseConfigurationValues(input: {
  current: OidcConfigurationView;
  currentSecret: string | null;
  patch: OidcConfigurationPatch;
}) {
  const parsedPatch = input.patch;
  const displayName = oidcDisplayNameSchema.parse(
    parsedPatch.displayName ?? input.current.displayName,
  );
  const issuerInput =
    parsedPatch.issuer === undefined
      ? input.current.issuer
      : parsedPatch.issuer;
  let issuer: string | null = null;
  if (issuerInput) {
    try {
      issuer = normalizeOidcIssuer(issuerInput, {
        allowInsecureLocalhost: process.env.NODE_ENV !== "production",
      });
    } catch (error) {
      throw new ApiError(
        422,
        "validation_error",
        error instanceof Error ? error.message : "Die Issuer-URL ist ungueltig.",
      );
    }
  }
  const clientIdInput =
    parsedPatch.clientId === undefined
      ? input.current.clientId
      : parsedPatch.clientId;
  const clientId = clientIdInput
    ? oidcClientIdSchema.parse(clientIdInput)
    : null;
  const clientSecret =
    parsedPatch.clientSecret === undefined || parsedPatch.clientSecret === ""
      ? input.currentSecret
      : parsedPatch.clientSecret === null
        ? null
        : oidcClientSecretSchema.parse(parsedPatch.clientSecret);
  let allowedEmailDomains: string[];
  try {
    allowedEmailDomains = normalizeOidcEmailDomains(
      parsedPatch.allowedEmailDomains ?? input.current.allowedEmailDomains,
    );
  } catch (error) {
    throw new ApiError(
      422,
      "validation_error",
      error instanceof Error ? error.message : "Die E-Mail-Domains sind ungueltig.",
    );
  }
  const enabled = parsedPatch.enabled ?? input.current.enabled;
  const autoProvisionMembers =
    parsedPatch.autoProvisionMembers ?? input.current.autoProvisionMembers;
  const passwordLoginEnabled =
    parsedPatch.passwordLoginEnabled ?? input.current.passwordLoginEnabled;
  if (enabled && (!issuer || !clientId || !clientSecret)) {
    throw new ApiError(
      422,
      "validation_error",
      "Zum Aktivieren werden Issuer, Client-ID und Client-Secret benoetigt.",
    );
  }
  if (!enabled && !passwordLoginEnabled) {
    throw new ApiError(
      422,
      "validation_error",
      "Mindestens eine Login-Methode muss aktiv bleiben.",
    );
  }
  if (autoProvisionMembers && allowedEmailDomains.length === 0) {
    throw new ApiError(
      422,
      "validation_error",
      "Automatische Bereitstellung erfordert mindestens eine erlaubte E-Mail-Domain.",
    );
  }
  return {
    enabled,
    displayName,
    issuer,
    clientId,
    clientSecret,
    autoProvisionMembers,
    allowedEmailDomains,
    passwordLoginEnabled,
  };
}

export async function previewOidcConfigurationUpdate(
  organizationId: string,
  patch: OidcConfigurationPatch,
) {
  const parsedPatch = oidcConfigurationPatchSchema.parse(patch);
  const [currentRow] = await db
    .select()
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, organizationId))
    .limit(1);
  const secretMode = clientSecretPatchMode(parsedPatch);
  const currentSecret = currentClientSecretForPatch(currentRow, secretMode);
  const values = parseConfigurationValues({
    current: viewFromRow(currentRow),
    currentSecret,
    patch: parsedPatch,
  });
  return {
    expectedVersion: currentRow?.version ?? 0,
    runtime: values.enabled
      ? ({
          organizationId,
          enabled: true,
          displayName: values.displayName,
          issuer: values.issuer!,
          clientId: values.clientId!,
          clientSecret: values.clientSecret!,
          autoProvisionMembers: values.autoProvisionMembers,
          allowedEmailDomains: values.allowedEmailDomains,
          passwordLoginEnabled: values.passwordLoginEnabled,
          version: (currentRow?.version ?? 0) + 1,
        } satisfies OidcRuntimeConfiguration)
      : null,
  };
}

export async function updateOidcConfiguration(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId: string;
    source: "admin_ui" | "api";
    expectedVersion: number;
    patch: OidcConfigurationPatch;
  },
) {
  await lockOidcConfiguration(tx, input.organizationId);
  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, input.actorUserId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        eq(users.role, "owner"),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur ein aktiver Owner darf den Unternehmens-Login konfigurieren.",
    );
  }

  const [currentRow] = await tx
    .select()
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, input.organizationId))
    .limit(1)
    .for("update");
  if ((currentRow?.version ?? 0) !== input.expectedVersion) {
    throw new ApiError(
      409,
      "conflict",
      "Die OIDC-Konfiguration wurde zwischenzeitlich geaendert. Bitte lade die Seite neu.",
      { reason: "configuration_changed" },
    );
  }
  const parsedPatch = oidcConfigurationPatchSchema.parse(input.patch);
  const secretMode = clientSecretPatchMode(parsedPatch);
  const currentSecret = currentClientSecretForPatch(currentRow, secretMode);
  const current = viewFromRow(currentRow);
  const next = parseConfigurationValues({
    current,
    currentSecret,
    patch: parsedPatch,
  });

  const changedFields = (
    [
      "enabled",
      "displayName",
      "issuer",
      "clientId",
      "autoProvisionMembers",
      "allowedEmailDomains",
      "passwordLoginEnabled",
    ] as const
  ).filter((field) => {
    if (field === "allowedEmailDomains") {
      return JSON.stringify(current.allowedEmailDomains) !== JSON.stringify(next.allowedEmailDomains);
    }
    return current[field] !== next[field];
  });
  const secretChanged =
    secretMode === "replace" ||
    (secretMode === "clear" && current.clientSecretConfigured);
  if (changedFields.length === 0 && !secretChanged) {
    return { ...current, changed: false, version: currentRow?.version ?? 0 };
  }

  if (!next.passwordLoginEnabled) {
    const providerConfigurationChanged =
      secretChanged ||
      changedFields.some((field) =>
        ["enabled", "issuer", "clientId", "allowedEmailDomains"].includes(
          field,
        ),
      );
    if (providerConfigurationChanged) {
      throw new ApiError(
        409,
        "conflict",
        "Speichere zuerst die Provider-Aenderungen, teste den Owner-Login per SSO und schalte den Passwort-Login danach separat ab.",
        { reason: "provider_changes_require_password_login" },
      );
    }

    const [linkedOwner] = await tx
      .select({ id: oidcIdentities.id })
      .from(oidcIdentities)
      .innerJoin(
        users,
        and(
          eq(users.id, oidcIdentities.userId),
          eq(users.organizationId, oidcIdentities.organizationId),
          eq(users.status, "active"),
          eq(users.role, "owner"),
        ),
      )
      .where(
        and(
          eq(oidcIdentities.organizationId, input.organizationId),
          eq(oidcIdentities.issuer, next.issuer!),
          eq(
            oidcIdentities.lastConfigurationVersion,
            current.version,
          ),
        ),
      )
      .limit(1)
      .for("share");
    if (!linkedOwner) {
      throw new ApiError(
        409,
        "conflict",
        "Vor dem Abschalten des Passwort-Logins muss ein aktiver Owner die aktuelle SSO-Konfiguration erfolgreich verwendet haben.",
        { reason: "owner_sso_required" },
      );
    }
  }

  const now = new Date();
  const encryptedSecret =
    secretMode === "preserve"
      ? (currentRow?.clientSecretEncrypted ?? null)
      : next.clientSecret
        ? encryptPayload(
            next.clientSecret,
            clientSecretContext(input.organizationId),
          )
        : null;
  const [saved] = await tx
    .insert(oidcConfigurations)
    .values({
      organizationId: input.organizationId,
      enabled: next.enabled,
      displayName: next.displayName,
      issuer: next.issuer,
      clientId: next.clientId,
      clientSecretEncrypted: encryptedSecret,
      autoProvisionMembers: next.autoProvisionMembers,
      allowedEmailDomains: next.allowedEmailDomains,
      passwordLoginEnabled: next.passwordLoginEnabled,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: oidcConfigurations.organizationId,
      set: {
        enabled: next.enabled,
        displayName: next.displayName,
        issuer: next.issuer,
        clientId: next.clientId,
        clientSecretEncrypted: encryptedSecret,
        autoProvisionMembers: next.autoProvisionMembers,
        allowedEmailDomains: next.allowedEmailDomains,
        passwordLoginEnabled: next.passwordLoginEnabled,
        version: sql`${oidcConfigurations.version} + 1`,
        updatedAt: now,
      },
    })
    .returning();
  if (!saved) {
    throw new ApiError(
      409,
      "conflict",
      "Die OIDC-Konfiguration wurde parallel geaendert.",
      { reason: "configuration_changed" },
    );
  }
  const authenticationBoundaryChanged =
    secretChanged ||
    changedFields.some((field) =>
      ["enabled", "issuer", "clientId", "allowedEmailDomains"].includes(
        field,
      ),
    );
  if (authenticationBoundaryChanged) {
    await tx
      .update(userSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(userSessions.organizationId, input.organizationId),
          eq(userSessions.authMethod, "oidc"),
          isNull(userSessions.revokedAt),
        ),
      );
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorUserId,
    type: "auth.oidc.configuration.updated",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: {
      source: input.source,
      version: saved.version,
      changedFields,
      clientSecretReplaced: secretChanged && Boolean(next.clientSecret),
      clientSecretCleared: secretChanged && !next.clientSecret,
      enabled: saved.enabled,
      passwordLoginEnabled: saved.passwordLoginEnabled,
      autoProvisionMembers: saved.autoProvisionMembers,
      allowedEmailDomainCount: saved.allowedEmailDomains.length,
      oidcSessionsRevoked: authenticationBoundaryChanged,
    },
  });
  return { ...viewFromRow(saved), changed: true, version: saved.version };
}

export async function requireOidcApiKeyOwner(
  tx: ApiTransaction,
  input: { organizationId: string; apiKeyId: string },
) {
  const [actor] = await tx
    .select({ id: users.id })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
        eq(users.role, "owner"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
        eq(apiKeys.status, "active"),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Die OIDC-Konfiguration erfordert einen API-Schluessel eines aktiven Owners.",
    );
  }
  return actor.id;
}
