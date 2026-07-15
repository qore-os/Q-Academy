"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import {
  claimCommunityModerationCase,
  decideCommunityModerationCaseAsAdmin,
  resolveCommunityModerationAppealAsAdmin,
} from "@/lib/community-moderation-admin";
import { logServerError } from "@/lib/server-error-logging";
import type { CommunityAdminActionCode } from "@/lib/i18n/community-admin";

export type CommunityModerationCaseActionState = Readonly<{
  ok: boolean | null;
  message: string;
  messageCode?: CommunityAdminActionCode;
}>;

const identifierSchema = z.string().uuid();
const versionSchema = z.number().int().min(1);
const claimSchema = z
  .object({
    caseId: identifierSchema,
    expectedDecisionVersion: versionSchema,
    expectedContentVersion: versionSchema,
  })
  .strict();
const decisionSchema = claimSchema
  .extend({
    action: z.enum(["approve", "reject", "restore"]),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();
const appealDecisionSchema = z
  .object({
    appealId: identifierSchema,
    action: z.enum(["uphold", "overturn"]),
    expectedDecisionVersion: versionSchema,
    expectedContentVersion: versionSchema,
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

function refreshModeration() {
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
    logServerError(error, { action: "community.moderation_case" });
  }
  return {
    ok: false,
    message: fallback,
    messageCode,
  } satisfies CommunityModerationCaseActionState;
}

export async function claimCommunityModerationCaseAdminAction(
  caseId: string,
  expectedDecisionVersion: number,
  expectedContentVersion: number,
): Promise<CommunityModerationCaseActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = claimSchema.safeParse({
    caseId,
    expectedDecisionVersion,
    expectedContentVersion,
  });
  if (!parsed.success) {
    return { ok: false, message: "Der Moderationsfall ist ungueltig.", messageCode: "caseClaimFailed" };
  }
  try {
    await db.transaction((tx) =>
      claimCommunityModerationCase(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      }),
    );
  } catch (error) {
    return actionError(error, "Der Fall konnte nicht uebernommen werden.", "caseClaimFailed");
  }
  refreshModeration();
  return { ok: true, message: "Moderationsfall uebernommen.", messageCode: "caseClaimed" };
}

export async function decideCommunityModerationCaseAdminAction(input: {
  caseId: string;
  action: "approve" | "reject" | "restore";
  expectedDecisionVersion: number;
  expectedContentVersion: number;
  note: string;
}): Promise<CommunityModerationCaseActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ??
        "Die Moderationsentscheidung ist ungueltig.",
      messageCode: "decisionFailed",
    };
  }
  try {
    await db.transaction((tx) =>
      decideCommunityModerationCaseAsAdmin(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      }),
    );
  } catch (error) {
    return actionError(error, "Die Entscheidung konnte nicht gespeichert werden.", "decisionFailed");
  }
  refreshModeration();
  return {
    ok: true,
    message:
      parsed.data.action === "reject"
        ? "Inhalt wurde abgelehnt und verborgen."
        : parsed.data.action === "restore"
          ? "Inhalt wurde wiederhergestellt."
          : "Inhalt wurde freigegeben.",
    messageCode:
      parsed.data.action === "reject"
        ? "contentRejected"
        : parsed.data.action === "restore"
          ? "contentRestored"
          : "contentApproved",
  };
}

export async function resolveCommunityModerationAppealAdminAction(input: {
  appealId: string;
  action: "uphold" | "overturn";
  expectedDecisionVersion: number;
  expectedContentVersion: number;
  note: string;
}): Promise<CommunityModerationCaseActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = appealDecisionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Der Einspruch ist ungueltig.",
      messageCode: "appealFailed",
    };
  }
  try {
    await db.transaction((tx) =>
      resolveCommunityModerationAppealAsAdmin(tx, {
        organizationId: actor.organizationId,
        actorId: actor.id,
        ...parsed.data,
      }),
    );
  } catch (error) {
    return actionError(error, "Der Einspruch konnte nicht entschieden werden.", "appealFailed");
  }
  refreshModeration();
  return {
    ok: true,
    message:
      parsed.data.action === "overturn"
        ? "Einspruch angenommen und Inhalt wiederhergestellt."
        : "Einspruch geprueft und Entscheidung bestaetigt.",
    messageCode:
      parsed.data.action === "overturn" ? "appealOverturned" : "appealUpheld",
  };
}
