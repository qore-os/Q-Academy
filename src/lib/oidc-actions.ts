"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { getSession, requireOwner } from "@/lib/auth";
import {
  previewOidcConfigurationUpdate,
  updateOidcConfiguration,
} from "@/lib/oidc-configuration";
import { oidcConfigurationInputSchema } from "@/lib/oidc-model";
import { verifyOidcProviderConfiguration } from "@/lib/oidc-provider";
import { logServerError } from "@/lib/server-error-logging";
import { assertOrganizationFeatureAvailable } from "@/lib/organization-contracts";
import {
  PrivacyOwnerStepUpError,
  verifyPrivacyOwnerStepUp,
} from "@/lib/privacy/owner-step-up";
import {
  MfaSecurityStepUpError,
  verifyAndConsumeMfaSecurityStepUp,
} from "@/lib/mfa/security-step-up";

export type OidcSettingsMessageCode =
  | "invalid_version"
  | "invalid_configuration"
  | "configuration_changed"
  | "provider_changes_require_password_login"
  | "owner_sso_required"
  | "step_up_invalid_password"
  | "step_up_rate_limited"
  | "step_up_reauthentication_required"
  | "step_up_mfa_required"
  | "step_up_mfa_invalid"
  | "provider_rejected"
  | "saved"
  | "disabled"
  | "unchanged"
  | "save_failed";

export type OidcSettingsActionState = {
  error?: string;
  success?: string;
  messageCode?: OidcSettingsMessageCode;
  version?: number;
};

function checkbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function oidcConfigurationFailureCode(
  error: ApiError,
): OidcSettingsMessageCode {
  const reason =
    error.details &&
    typeof error.details === "object" &&
    "reason" in error.details &&
    typeof error.details.reason === "string"
      ? error.details.reason
      : null;
  if (reason === "provider_changes_require_password_login") {
    return "provider_changes_require_password_login";
  }
  if (reason === "owner_sso_required") return "owner_sso_required";
  if (reason === "configuration_changed" || error.status === 409) {
    return "configuration_changed";
  }
  if (error.status === 422) return "invalid_configuration";
  return "save_failed";
}

export async function updateOidcSettingsAction(
  _state: OidcSettingsActionState,
  formData: FormData,
): Promise<OidcSettingsActionState> {
  const actor = await requireOwner();
  const expectedVersion = Number(formData.get("version"));
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return {
      error: "Die Konfigurationsversion ist ungueltig. Bitte lade die Seite neu.",
      messageCode: "invalid_version",
    };
  }
  const domainInput = formData.get("allowedEmailDomains");
  const domains =
    typeof domainInput === "string"
      ? domainInput
          .replace(/\r\n?/g, "\n")
          .split(/[\n,;]/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
  const secretInput = formData.get("clientSecret");
  const clearSecret = checkbox(formData, "clearClientSecret");
  const parsed = oidcConfigurationInputSchema.safeParse({
    enabled: checkbox(formData, "enabled"),
    displayName: formData.get("displayName"),
    issuer: optionalText(formData, "issuer"),
    clientId: optionalText(formData, "clientId"),
    clientSecret: clearSecret
      ? null
      : typeof secretInput === "string"
        ? secretInput
        : "",
    autoProvisionMembers: checkbox(formData, "autoProvisionMembers"),
    allowedEmailDomains: domains,
    passwordLoginEnabled: checkbox(formData, "passwordLoginEnabled"),
  });
  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Bitte pruefe die OIDC-Konfiguration.",
      messageCode: "invalid_configuration",
    };
  }
  try {
    const passwordInput = formData.get("currentPassword");
    await verifyPrivacyOwnerStepUp(
      actor,
      typeof passwordInput === "string" && passwordInput.length <= 256
        ? passwordInput
        : "",
    );
    const mfaCode = formData.get("mfaCode");
    const session = await getSession();
    await verifyAndConsumeMfaSecurityStepUp(
      actor,
      typeof mfaCode === "string" ? mfaCode : "",
      session?.sessionId,
    );
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "oidc_sso",
    );
    const preview = await previewOidcConfigurationUpdate(
      actor.organizationId,
      parsed.data,
    );
    if (preview.expectedVersion !== expectedVersion) {
      return {
        error: "Die Konfiguration wurde geaendert. Bitte lade die Seite neu.",
        messageCode: "configuration_changed",
      };
    }
    if (preview.runtime) {
      try {
        await verifyOidcProviderConfiguration(preview.runtime);
      } catch (error) {
        if (!(error instanceof ApiError)) {
          logServerError(error, {
            action: "auth.oidc.configuration.provider.verify",
          });
        }
        return {
          error: "Die Provider-Konfiguration konnte nicht sicher geprueft werden.",
          messageCode: "provider_rejected",
        };
      }
    }
    const saved = await db.transaction((tx) =>
      updateOidcConfiguration(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        source: "admin_ui",
        expectedVersion,
        patch: parsed.data,
      }),
    );
    revalidatePath("/admin/settings");
    revalidatePath("/login");
    return {
      success: saved.changed
        ? preview.runtime
          ? "Unternehmens-Login geprueft und gespeichert."
          : "Unternehmens-Login deaktiviert und gespeichert."
        : "Keine Aenderungen gespeichert.",
      messageCode: saved.changed
        ? preview.runtime
          ? "saved"
          : "disabled"
        : "unchanged",
      version: saved.version,
    };
  } catch (error) {
    if (error instanceof MfaSecurityStepUpError) {
      return {
        error: error.message,
        messageCode:
          error.code === "rate_limited"
            ? "step_up_rate_limited"
            : error.code === "required"
              ? "step_up_mfa_required"
              : "step_up_mfa_invalid",
      };
    }
    if (error instanceof PrivacyOwnerStepUpError) {
      const messageCode =
        error.code === "invalid_password"
          ? "step_up_invalid_password"
          : error.code === "rate_limited"
            ? "step_up_rate_limited"
            : "step_up_reauthentication_required";
      return { error: error.message, messageCode };
    }
    if (error instanceof ApiError) {
      return {
        error: error.message,
        messageCode: oidcConfigurationFailureCode(error),
      };
    }
    logServerError(error, { action: "auth.oidc.configuration.update" });
    return {
      error: "Der Unternehmens-Login konnte nicht gespeichert werden.",
      messageCode: "save_failed",
    };
  }
}
