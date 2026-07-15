"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import {
  badgeGroupInputSchema,
  communityBadgeInputSchema,
  saveBadgeGroup,
  saveCommunityBadge,
  setManualCommunityBadge,
} from "@/lib/community-badge-admin";
import type { CommunityAdminActionCode } from "@/lib/i18n/community-admin";
import { logServerError } from "@/lib/server-error-logging";

export type CommunityBadgeActionState = Readonly<{
  ok: boolean | null;
  message: string;
  messageCode?: CommunityAdminActionCode;
}>;

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function optionalId(input: string) {
  return input ? input : undefined;
}

function refresh() {
  revalidatePath("/admin/community");
  revalidatePath("/academy/community");
  revalidatePath("/academy/profile");
}

function failure(
  error: unknown,
  fallback: string,
  messageCode: CommunityAdminActionCode,
): CommunityBadgeActionState {
  if (!(error instanceof ApiError)) {
    logServerError(error, { action: "community.badge" });
  }
  return {
    ok: false,
    message: fallback,
    messageCode,
  };
}

export async function saveBadgeGroupAdminAction(
  _state: CommunityBadgeActionState,
  formData: FormData,
): Promise<CommunityBadgeActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = badgeGroupInputSchema.safeParse({
    id: optionalId(value(formData, "id")),
    name: value(formData, "name"),
    description: value(formData, "description"),
    displayMode: value(formData, "displayMode"),
    sortOrder: Number(value(formData, "sortOrder")),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Badge-Gruppe ungueltig.", messageCode: "badgeGroupSaveFailed" };
  }
  try {
    await saveBadgeGroup({
      organizationId: actor.organizationId,
      actorId: actor.id,
      value: parsed.data,
    });
  } catch (error) {
    return failure(error, "Die Badge-Gruppe konnte nicht gespeichert werden.", "badgeGroupSaveFailed");
  }
  refresh();
  return { ok: true, message: "Badge-Gruppe gespeichert.", messageCode: "badgeGroupSaved" };
}

export async function saveCommunityBadgeAdminAction(
  _state: CommunityBadgeActionState,
  formData: FormData,
): Promise<CommunityBadgeActionState> {
  const actor = await requireTeamPermission("community.manage");
  const threshold = value(formData, "pointsThreshold");
  const parsed = communityBadgeInputSchema.safeParse({
    id: optionalId(value(formData, "id")),
    groupId: optionalId(value(formData, "groupId")) ?? null,
    name: value(formData, "name"),
    description: value(formData, "description"),
    icon: value(formData, "icon") || "award",
    color: value(formData, "color"),
    pointsThreshold: threshold ? Number(threshold) : null,
    sortOrder: Number(value(formData, "sortOrder")),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Badge ungueltig.", messageCode: "badgeSaveFailed" };
  }
  try {
    await saveCommunityBadge({
      organizationId: actor.organizationId,
      actorId: actor.id,
      value: parsed.data,
    });
  } catch (error) {
    return failure(error, "Der Badge konnte nicht gespeichert werden.", "badgeSaveFailed");
  }
  refresh();
  return { ok: true, message: "Badge gespeichert.", messageCode: "badgeSaved" };
}

const assignmentSchema = z.object({
  userId: z.string().uuid(),
  badgeId: z.string().uuid(),
  awarded: z.boolean(),
});

export async function setManualCommunityBadgeAdminAction(
  _state: CommunityBadgeActionState,
  formData: FormData,
): Promise<CommunityBadgeActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = assignmentSchema.safeParse({
    userId: value(formData, "userId"),
    badgeId: value(formData, "badgeId"),
    awarded: value(formData, "awarded") !== "false",
  });
  if (!parsed.success) return { ok: false, message: "Badge-Zuweisung ungueltig.", messageCode: "badgeAssignmentFailed" };
  try {
    await setManualCommunityBadge({
      organizationId: actor.organizationId,
      actorId: actor.id,
      ...parsed.data,
    });
  } catch (error) {
    return failure(error, "Die Badge-Zuweisung konnte nicht geaendert werden.", "badgeAssignmentFailed");
  }
  refresh();
  return {
    ok: true,
    message: parsed.data.awarded ? "Badge vergeben." : "Badge entzogen.",
    messageCode: parsed.data.awarded ? "badgeAwarded" : "badgeRevoked",
  };
}
