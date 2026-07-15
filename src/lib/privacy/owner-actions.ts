"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwner } from "@/lib/auth";
import {
  approvePrivacyRequest,
  cancelPrivacyRequest,
  createPrivacyLegalHold,
  createPrivacyRequest,
  PrivacyRequestServiceError,
  processPrivacyRequest,
  rejectPrivacyRequest,
  releasePrivacyLegalHold,
  verifyPrivacyRequestIdentity,
} from "@/lib/privacy/request-service";
import {
  privacyLegalHoldCreateSchema,
  privacyLegalHoldReleaseSchema,
  privacyReasonStepUpSchema,
  privacyRequestCreateSchema,
  privacyStepUpSchema,
  privacyStepUpPassword,
} from "@/lib/privacy/request-schemas";
import {
  PrivacyOwnerStepUpError,
  verifyPrivacyOwnerStepUp,
} from "@/lib/privacy/owner-step-up";
import {
  claimPrivacyRuntimeCapacity,
  releasePrivacyRuntimeCapacity,
} from "@/lib/privacy/runtime-capacity";
import { logServerError } from "@/lib/server-error-logging";

export type PrivacyOwnerActionState = {
  ok: boolean | null;
  message: string;
  resourceId?: string;
  code?: PrivacyOwnerActionCode;
};

export type PrivacyOwnerActionCode =
  | "createInvalid"
  | "created"
  | "existing"
  | "createFailed"
  | "stepUpInvalid"
  | "stepUpInvalidPassword"
  | "stepUpRateLimited"
  | "stepUpOwnerRequired"
  | "stepUpReauthenticationRequired"
  | "identityVerified"
  | "identityFailed"
  | "approved"
  | "approveFailed"
  | "exportCompleted"
  | "erasureCompleted"
  | "processingBlocked"
  | "processingBusy"
  | "processFailed"
  | "terminalInvalid"
  | "statusFailed"
  | "rejected"
  | "cancelled"
  | "holdInvalid"
  | "holdCreated"
  | "holdCreateFailed"
  | "holdReleased"
  | "holdReleaseFailed";

const idSchema = z.string().uuid();

function actorFrom(user: Awaited<ReturnType<typeof requireOwner>>) {
  return { kind: "user" as const, id: user.id, userId: user.id };
}

function actionError(
  error: unknown,
  fallback: string,
  code: PrivacyOwnerActionCode,
): PrivacyOwnerActionState {
  if (error instanceof PrivacyOwnerStepUpError) {
    const stepUpCode: PrivacyOwnerActionCode =
      error.code === "invalid_password"
        ? "stepUpInvalidPassword"
        : error.code === "rate_limited"
          ? "stepUpRateLimited"
          : error.code === "owner_required"
            ? "stepUpOwnerRequired"
            : "stepUpReauthenticationRequired";
    return { ok: false, message: error.message, code: stepUpCode };
  }
  if (error instanceof PrivacyRequestServiceError) {
    return { ok: false, message: error.message, code };
  }
  logServerError(error, { action: "privacy.owner_action" });
  return { ok: false, message: fallback, code };
}

function issueMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Bitte pruefe die Eingaben.";
}

function refreshPrivacy(requestId?: string) {
  revalidatePath("/admin/privacy");
  if (requestId) revalidatePath(`/admin/privacy/${requestId}`);
}

export async function createPrivacyRequestOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  const parsed = privacyRequestCreateSchema.safeParse({
    subjectUserId: formData.get("subjectUserId"),
    clientRequestId: formData.get("clientRequestId"),
    type: formData.get("type"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: issueMessage(parsed.error),
      code: "createInvalid",
    };
  }
  try {
    const result = await createPrivacyRequest(
      owner.organizationId,
      parsed.data,
      actorFrom(owner),
    );
    refreshPrivacy(result.request.id);
    return {
      ok: true,
      message: result.created
        ? "Datenschutzfall angelegt."
        : "Der bestehende Datenschutzfall wurde gefunden.",
      resourceId: result.request.id,
      code: result.created ? "created" : "existing",
    };
  } catch (error) {
    return actionError(
      error,
      "Der Datenschutzfall konnte nicht angelegt werden.",
      "createFailed",
    );
  }
}

async function parseStepUp(owner: Awaited<ReturnType<typeof requireOwner>>, formData: FormData) {
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const input = privacyStepUpSchema.safeParse({
    password: privacyStepUpPassword(formData),
  });
  if (!requestId.success || !input.success) {
    return { error: "Fall-ID oder Owner-Bestaetigung ist ungueltig." } as const;
  }
  await verifyPrivacyOwnerStepUp(owner, input.data.password);
  return { requestId: requestId.data } as const;
}

export async function verifyPrivacyIdentityOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  try {
    const parsed = await parseStepUp(owner, formData);
    if ("error" in parsed) {
      return {
        ok: false,
        message: parsed.error ?? "Die Eingabe ist ungueltig.",
        code: "stepUpInvalid",
      };
    }
    await verifyPrivacyRequestIdentity(owner.organizationId, parsed.requestId, actorFrom(owner));
    refreshPrivacy(parsed.requestId);
    return { ok: true, message: "Identitaet bestaetigt.", resourceId: parsed.requestId, code: "identityVerified" };
  } catch (error) {
    return actionError(error, "Die Identitaet konnte nicht bestaetigt werden.", "identityFailed");
  }
}

export async function approvePrivacyRequestOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  try {
    const parsed = await parseStepUp(owner, formData);
    if ("error" in parsed) {
      return { ok: false, message: parsed.error ?? "Die Eingabe ist ungueltig.", code: "stepUpInvalid" };
    }
    await approvePrivacyRequest(owner.organizationId, parsed.requestId, actorFrom(owner));
    refreshPrivacy(parsed.requestId);
    return { ok: true, message: "Datenschutzfall freigegeben.", resourceId: parsed.requestId, code: "approved" };
  } catch (error) {
    return actionError(error, "Der Datenschutzfall konnte nicht freigegeben werden.", "approveFailed");
  }
}

export async function processPrivacyRequestOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  try {
    const parsed = await parseStepUp(owner, formData);
    if ("error" in parsed) {
      return { ok: false, message: parsed.error ?? "Die Eingabe ist ungueltig.", code: "stepUpInvalid" };
    }
    const runtimeLease = claimPrivacyRuntimeCapacity();
    if (!runtimeLease) {
      return {
        ok: false,
        message: "Der Server verarbeitet bereits die maximal erlaubte Anzahl an Datenschutzpaketen.",
        code: "processingBusy",
      };
    }
    let result;
    try {
      result = await processPrivacyRequest(
        owner.organizationId,
        parsed.requestId,
        actorFrom(owner),
      );
    } finally {
      releasePrivacyRuntimeCapacity(runtimeLease);
    }
    refreshPrivacy(parsed.requestId);
    return {
      ok: true,
      message:
        result.kind === "export_completed"
          ? "Vollstaendiges Exportpaket erstellt und der Fall abgeschlossen."
          : result.kind === "erasure_completed"
            ? "Mitgliedsdaten geloescht beziehungsweise dokumentiert anonymisiert."
            : "Der Fall wurde mit dokumentiertem Grund blockiert.",
      resourceId: parsed.requestId,
      code:
        result.kind === "export_completed"
          ? "exportCompleted"
          : result.kind === "erasure_completed"
            ? "erasureCompleted"
            : "processingBlocked",
    };
  } catch (error) {
    return actionError(error, "Der Datenschutzfall konnte nicht verarbeitet werden.", "processFailed");
  }
}

async function terminalOwnerAction(
  formData: FormData,
  transition: typeof rejectPrivacyRequest | typeof cancelPrivacyRequest,
  successMessage: string,
  successCode: "rejected" | "cancelled",
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const input = privacyReasonStepUpSchema.safeParse({
    password: privacyStepUpPassword(formData),
    reason: formData.get("reason"),
  });
  if (!requestId.success || !input.success) {
    return { ok: false, message: input.success ? "Die Fall-ID ist ungueltig." : issueMessage(input.error), code: "terminalInvalid" };
  }
  try {
    await verifyPrivacyOwnerStepUp(owner, input.data.password);
    await transition(owner.organizationId, requestId.data, actorFrom(owner), input.data.reason);
    refreshPrivacy(requestId.data);
    return { ok: true, message: successMessage, resourceId: requestId.data, code: successCode };
  } catch (error) {
    return actionError(error, "Der Status konnte nicht geaendert werden.", "statusFailed");
  }
}

export async function rejectPrivacyRequestOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  return terminalOwnerAction(formData, rejectPrivacyRequest, "Datenschutzfall abgelehnt.", "rejected");
}

export async function cancelPrivacyRequestOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  return terminalOwnerAction(formData, cancelPrivacyRequest, "Datenschutzfall storniert.", "cancelled");
}

export async function createPrivacyLegalHoldOwnerAction(
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const expiresAtInput = formData.get("expiresAt");
  const expiresAt =
    typeof expiresAtInput === "string" && expiresAtInput
      ? new Date(expiresAtInput)
      : null;
  const parsed = privacyLegalHoldCreateSchema.safeParse({
    password: privacyStepUpPassword(formData),
    reference: formData.get("reference"),
    scope: formData.get("scope"),
    reason: formData.get("reason"),
    legalBasis: formData.get("legalBasis"),
    expiresAt:
      expiresAt && !Number.isNaN(expiresAt.getTime())
        ? expiresAt.toISOString()
        : null,
  });
  if (!requestId.success || !parsed.success) {
    return { ok: false, message: parsed.success ? "Die Fall-ID ist ungueltig." : issueMessage(parsed.error), code: "holdInvalid" };
  }
  try {
    await verifyPrivacyOwnerStepUp(owner, parsed.data.password);
    const hold = await createPrivacyLegalHold(
      owner.organizationId,
      requestId.data,
      actorFrom(owner),
      {
        reference: parsed.data.reference,
        scope: parsed.data.scope,
        reason: parsed.data.reason,
        legalBasis: parsed.data.legalBasis,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    );
    refreshPrivacy(requestId.data);
    return { ok: true, message: "Aufbewahrungssperre angelegt.", resourceId: hold.id, code: "holdCreated" };
  } catch (error) {
    return actionError(error, "Die Aufbewahrungssperre konnte nicht angelegt werden.", "holdCreateFailed");
  }
}

export async function releasePrivacyLegalHoldOwnerAction(
  holdId: string,
  _state: PrivacyOwnerActionState,
  formData: FormData,
): Promise<PrivacyOwnerActionState> {
  const owner = await requireOwner();
  const parsedHoldId = idSchema.safeParse(holdId);
  const requestId = idSchema.safeParse(formData.get("requestId"));
  const parsed = privacyLegalHoldReleaseSchema.safeParse({
    password: privacyStepUpPassword(formData),
    reason: formData.get("reason"),
  });
  if (!parsedHoldId.success || !requestId.success || !parsed.success) {
    return { ok: false, message: parsed.success ? "Die Referenz ist ungueltig." : issueMessage(parsed.error), code: "holdInvalid" };
  }
  try {
    await verifyPrivacyOwnerStepUp(owner, parsed.data.password);
    await releasePrivacyLegalHold(
      owner.organizationId,
      requestId.data,
      parsedHoldId.data,
      actorFrom(owner),
      parsed.data.reason,
    );
    refreshPrivacy(requestId.data);
    return { ok: true, message: "Aufbewahrungssperre aufgehoben.", resourceId: parsedHoldId.data, code: "holdReleased" };
  } catch (error) {
    return actionError(error, "Die Aufbewahrungssperre konnte nicht aufgehoben werden.", "holdReleaseFailed");
  }
}
