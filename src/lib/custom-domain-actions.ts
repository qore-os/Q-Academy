"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { requireOwner } from "@/lib/auth";
import { BRANDING_CACHE_TAG } from "@/lib/branding-model";
import {
  customDomainClaimCreateSchema,
  customDomainClaimMutationSchema,
} from "@/lib/custom-domain-model";
import {
  createCustomDomainClaim,
  revokeCustomDomainClaim,
  rotateCustomDomainChallenge,
  verifyCustomDomainClaim,
} from "@/lib/custom-domains";
import { logServerError } from "@/lib/server-error-logging";

export type CustomDomainActionState = {
  ok: boolean | null;
  message: string;
  code?: CustomDomainActionCode;
  challenge?: {
    recordName: string;
    recordValue: string;
    expiresAt: string;
  };
};

export type CustomDomainActionCode =
  | "domainHostnameInvalid"
  | "domainClaimInvalid"
  | "domainClaimFailed"
  | "domainAcademyClaimExists"
  | "domainHostnameClaimed"
  | "domainChallengeCreated"
  | "domainChallengeRotated"
  | "domainVerified"
  | "domainNoMatch"
  | "domainDnsError"
  | "domainTimeout"
  | "domainExpired"
  | "domainRevoked";

const initialFailure = (message: string, code: CustomDomainActionCode = "domainClaimFailed"): CustomDomainActionState => ({
  ok: false,
  message,
  code,
});
const claimIdSchema = z.string().uuid();

function refreshSettings(brandingChanged = false) {
  revalidatePath("/admin/settings");
  if (brandingChanged) {
    updateTag(BRANDING_CACHE_TAG);
    revalidatePath("/login");
    revalidatePath("/", "layout");
  }
}

function actionError(error: unknown, action: string) {
  if (error instanceof ApiError) {
    const conflict =
      error.code === "conflict" &&
      error.details &&
      typeof error.details === "object" &&
      "conflict" in error.details
        ? error.details.conflict
        : null;
    if (conflict === "organization") {
      return initialFailure(error.message, "domainAcademyClaimExists");
    }
    if (conflict === "hostname") {
      return initialFailure(error.message, "domainHostnameClaimed");
    }
    return initialFailure(error.message);
  }
  logServerError(error, { action });
  return initialFailure("Der Domain-Claim konnte nicht verarbeitet werden.", "domainClaimFailed");
}

export async function createCustomDomainClaimAction(
  _state: CustomDomainActionState,
  formData: FormData,
): Promise<CustomDomainActionState> {
  const owner = await requireOwner();
  const parsed = customDomainClaimCreateSchema.safeParse({
    hostname: formData.get("hostname"),
  });
  if (!parsed.success) {
    return initialFailure(
      parsed.error.issues[0]?.message ?? "Der Hostname ist ungueltig.",
      "domainHostnameInvalid",
    );
  }
  try {
    const result = await createCustomDomainClaim({
      organizationId: owner.organizationId,
      actorUserId: owner.id,
      hostname: parsed.data.hostname,
    });
    refreshSettings();
    return {
      ok: true,
      code: "domainChallengeCreated",
      message: "DNS-Challenge erstellt.",
      challenge: {
        ...result.challenge,
        expiresAt: result.challenge.expiresAt.toISOString(),
      },
    };
  } catch (error) {
    return actionError(error, "custom_domain.create");
  }
}

function parseMutation(claimId: string, formData: FormData) {
  const id = claimIdSchema.safeParse(claimId);
  const mutation = customDomainClaimMutationSchema.safeParse({
    expectedRevision: Number(formData.get("expectedRevision")),
  });
  return { id, mutation };
}

export async function rotateCustomDomainChallengeAction(
  claimId: string,
  _state: CustomDomainActionState,
  formData: FormData,
): Promise<CustomDomainActionState> {
  const owner = await requireOwner();
  const parsed = parseMutation(claimId, formData);
  if (!parsed.id.success || !parsed.mutation.success) {
    return initialFailure("Der Domain-Claim ist ungueltig.", "domainClaimInvalid");
  }
  try {
    const result = await rotateCustomDomainChallenge({
      organizationId: owner.organizationId,
      actorUserId: owner.id,
      claimId: parsed.id.data,
      expectedRevision: parsed.mutation.data.expectedRevision,
    });
    refreshSettings();
    return {
      ok: true,
      code: "domainChallengeRotated",
      message: "DNS-Challenge rotiert. Der alte Wert ist ungueltig.",
      challenge: {
        ...result.challenge,
        expiresAt: result.challenge.expiresAt.toISOString(),
      },
    };
  } catch (error) {
    return actionError(error, "custom_domain.rotate");
  }
}

export async function verifyCustomDomainClaimAction(
  claimId: string,
  _state: CustomDomainActionState,
  formData: FormData,
): Promise<CustomDomainActionState> {
  const owner = await requireOwner();
  const parsed = parseMutation(claimId, formData);
  if (!parsed.id.success || !parsed.mutation.success) {
    return initialFailure("Der Domain-Claim ist ungueltig.", "domainClaimInvalid");
  }
  try {
    const result = await verifyCustomDomainClaim({
      organizationId: owner.organizationId,
      actorUserId: owner.id,
      claimId: parsed.id.data,
      expectedRevision: parsed.mutation.data.expectedRevision,
    });
    refreshSettings(result.verified);
    if (result.verified) {
      return {
        ok: true,
        code: "domainVerified",
        message:
          "DNS verifiziert. TLS wird beim ersten HTTPS-Aufruf bereitgestellt.",
      };
    }
    const messages = {
      no_match: "Der exakte TXT-Challengewert wurde noch nicht gefunden.",
      dns_error: "Die TXT-Abfrage ist fehlgeschlagen.",
      timeout: "Die TXT-Abfrage hat das Zeitlimit ueberschritten.",
      expired: "Die DNS-Challenge ist abgelaufen und muss rotiert werden.",
      verified:
        "DNS verifiziert. TLS wird beim ersten HTTPS-Aufruf bereitgestellt.",
    } as const;
    const codes = { no_match: "domainNoMatch", dns_error: "domainDnsError", timeout: "domainTimeout", expired: "domainExpired", verified: "domainVerified" } as const;
    return initialFailure(messages[result.code], codes[result.code]);
  } catch (error) {
    return actionError(error, "custom_domain.verify");
  }
}

export async function revokeCustomDomainClaimAction(
  claimId: string,
  _state: CustomDomainActionState,
  formData: FormData,
): Promise<CustomDomainActionState> {
  const owner = await requireOwner();
  const parsed = parseMutation(claimId, formData);
  if (!parsed.id.success || !parsed.mutation.success) {
    return initialFailure("Der Domain-Claim ist ungueltig.", "domainClaimInvalid");
  }
  try {
    await revokeCustomDomainClaim({
      organizationId: owner.organizationId,
      actorUserId: owner.id,
      claimId: parsed.id.data,
      expectedRevision: parsed.mutation.data.expectedRevision,
    });
    refreshSettings(true);
    return { ok: true, code: "domainRevoked", message: "Domain-Claim widerrufen." };
  } catch (error) {
    return actionError(error, "custom_domain.revoke");
  }
}
