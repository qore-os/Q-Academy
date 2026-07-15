"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  communityLevelConfigurationUpdateSchema,
  communityModerationPolicyUpdateSchema,
} from "@/lib/api/schemas";
import { requireTeamPermission } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import {
  replaceCommunityLevelConfiguration,
  updateCommunitySpaceModerationPolicy,
} from "@/lib/community-governance";
import type { CommunityAdminActionCode } from "@/lib/i18n/community-admin";
import { logServerError } from "@/lib/server-error-logging";

export type CommunityGovernanceActionState = Readonly<{
  ok: boolean | null;
  message: string;
  messageCode?: CommunityAdminActionCode;
}>;

const identifierSchema = z.string().uuid();

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function refreshCommunityGovernance() {
  revalidatePath("/admin/community");
  revalidatePath("/academy/community");
  revalidatePath("/academy");
}

function actionError(
  error: unknown,
  fallback: string,
  messageCode: CommunityAdminActionCode,
) {
  if (!(error instanceof ApiError)) {
    logServerError(error, { action: "community.governance" });
  }
  return {
    ok: false,
    message: fallback,
    messageCode,
  } satisfies CommunityGovernanceActionState;
}

export async function updateCommunityModerationPolicyAdminAction(
  spaceId: string,
  _state: CommunityGovernanceActionState,
  formData: FormData,
): Promise<CommunityGovernanceActionState> {
  const actor = await requireTeamPermission("community.manage");
  if (!identifierSchema.safeParse(spaceId).success) {
    return { ok: false, message: "Der Community-Bereich ist ungueltig.", messageCode: "moderationPolicySaveFailed" };
  }
  const reportThreshold = formValue(formData, "reportThreshold");
  const parsed = communityModerationPolicyUpdateSchema.safeParse({
    expectedVersion: Number(formValue(formData, "expectedVersion")),
    postApproval: formValue(formData, "postApproval"),
    commentApproval: formValue(formData, "commentApproval"),
    automationMode: formValue(formData, "automationMode"),
    reportThreshold: reportThreshold ? Number(reportThreshold) : null,
    duplicateWindowMinutes: Number(
      formValue(formData, "duplicateWindowMinutes"),
    ),
    linkLimit: Number(formValue(formData, "linkLimit")),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Die Moderationsregeln sind ungueltig.",
      messageCode: "moderationPolicySaveFailed",
    };
  }
  try {
    await updateCommunitySpaceModerationPolicy({
      organizationId: actor.organizationId,
      actorId: actor.id,
      spaceId,
      ...parsed.data,
    });
  } catch (error) {
    return actionError(
      error,
      "Die Moderationsregeln konnten nicht gespeichert werden.",
      "moderationPolicySaveFailed",
    );
  }
  refreshCommunityGovernance();
  return { ok: true, message: "Moderationsregeln gespeichert.", messageCode: "moderationPolicySaved" };
}

export async function updateCommunityLevelsAdminAction(
  _state: CommunityGovernanceActionState,
  formData: FormData,
): Promise<CommunityGovernanceActionState> {
  const actor = await requireTeamPermission("community.manage");
  const rawLevels = formData.get("levelsJson");
  if (typeof rawLevels !== "string" || rawLevels.length > 100_000) {
    return { ok: false, message: "Die Leveldefinitionen sind ungueltig.", messageCode: "levelsSaveFailed" };
  }
  let levels: unknown;
  try {
    levels = JSON.parse(rawLevels);
  } catch {
    return {
      ok: false,
      message: "Die Leveldefinitionen sind kein gueltiges JSON.",
      messageCode: "levelsSaveFailed",
    };
  }
  const parsed = communityLevelConfigurationUpdateSchema.safeParse({
    expectedRevision: Number(formValue(formData, "expectedRevision")),
    enabled: formData.get("enabled") === "on",
    levels,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Die Levelkonfiguration ist ungueltig.",
      messageCode: "levelsSaveFailed",
    };
  }
  try {
    await replaceCommunityLevelConfiguration({
      organizationId: actor.organizationId,
      actorId: actor.id,
      ...parsed.data,
    });
  } catch (error) {
    return actionError(
      error,
      "Die Levelkonfiguration konnte nicht gespeichert werden.",
      "levelsSaveFailed",
    );
  }
  refreshCommunityGovernance();
  return { ok: true, message: "Community-Level gespeichert.", messageCode: "levelsSaved" };
}
