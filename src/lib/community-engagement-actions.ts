"use server";

import { revalidatePath } from "next/cache";

import {
  communityBoostUpdateSchema,
  communityFollowParamsSchema,
} from "@/lib/api/schemas";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import {
  removeCommunityAuthorBoost,
  replaceCommunityAuthorBoost,
} from "@/lib/community-boosts";
import {
  removeCommunityFollow,
  upsertCommunityFollow,
} from "@/lib/community-follows";
import type {
  CommunityActionCode,
  CommunityActionParams,
} from "@/lib/i18n/community-actions";

export type CommunityEngagementActionState = Readonly<{
  ok: boolean;
  message: string;
  code: CommunityActionCode;
  params?: CommunityActionParams;
}>;

function refreshCommunity() {
  revalidatePath("/academy/community");
  revalidatePath("/admin/community");
}

function actionFailure(
  _error: unknown,
  fallback: string,
  code: CommunityActionCode,
): CommunityEngagementActionState {
  return {
    ok: false,
    message: fallback,
    code,
  };
}

export async function followCommunityTargetAction(
  targetType: string,
  targetId: string,
): Promise<CommunityEngagementActionState> {
  const actor = await requireUser();
  try {
    const target = communityFollowParamsSchema.parse({ targetType, targetId });
    await upsertCommunityFollow({ actor, ...target, notify: true });
    refreshCommunity();
    return { ok: true, message: "Follow gespeichert.", code: "followSaved" };
  } catch (error) {
    return actionFailure(
      error,
      "Der Follow konnte nicht gespeichert werden.",
      "followSaveFailed",
    );
  }
}

export async function unfollowCommunityTargetAction(
  targetType: string,
  targetId: string,
): Promise<CommunityEngagementActionState> {
  const actor = await requireUser();
  try {
    const target = communityFollowParamsSchema.parse({ targetType, targetId });
    await removeCommunityFollow({ actor, ...target });
    refreshCommunity();
    return { ok: true, message: "Follow entfernt.", code: "followRemoved" };
  } catch (error) {
    return actionFailure(
      error,
      "Der Follow konnte nicht entfernt werden.",
      "followRemoveFailed",
    );
  }
}

export async function replaceCommunityAuthorBoostAction(
  authorId: string,
  input: { strength: string; startsAt: string; endsAt: string; reason: string },
): Promise<CommunityEngagementActionState> {
  const actor = await requireTeamPermission("community.manage");
  try {
    const target = communityFollowParamsSchema.shape.targetId.parse(authorId);
    const boost = communityBoostUpdateSchema.parse(input);
    await replaceCommunityAuthorBoost({ actor, authorId: target, ...boost });
    refreshCommunity();
    return {
      ok: true,
      message: "Autoren-Boost gespeichert.",
      code: "authorBoostSaved",
    };
  } catch (error) {
    return actionFailure(
      error,
      "Der Autoren-Boost konnte nicht gespeichert werden.",
      "authorBoostSaveFailed",
    );
  }
}

export async function removeCommunityAuthorBoostAction(
  authorId: string,
): Promise<CommunityEngagementActionState> {
  const actor = await requireTeamPermission("community.manage");
  try {
    const target = communityFollowParamsSchema.shape.targetId.parse(authorId);
    await removeCommunityAuthorBoost({ actor, authorId: target });
    refreshCommunity();
    return {
      ok: true,
      message: "Autoren-Boost entfernt.",
      code: "authorBoostRemoved",
    };
  } catch (error) {
    return actionFailure(
      error,
      "Der Autoren-Boost konnte nicht entfernt werden.",
      "authorBoostRemoveFailed",
    );
  }
}
