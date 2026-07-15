"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { communityModerationCases } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { communityModerationAppealCreateSchema } from "@/lib/api/schemas";
import { requireUser } from "@/lib/auth";
import { createCommunityModerationAppeal } from "@/lib/community-moderation-lifecycle";
import type {
  CommunityActionCode,
  CommunityActionParams,
} from "@/lib/i18n/community-actions";
import { logServerError } from "@/lib/server-error-logging";

export type CommunityModerationAppealActionState = Readonly<{
  ok: boolean | null;
  message: string;
  code?: CommunityActionCode;
  params?: CommunityActionParams;
}>;

const appealSchema = communityModerationAppealCreateSchema
  .pick({ statement: true })
  .extend({ caseId: z.string().uuid() })
  .strict();

function formValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function createOwnCommunityModerationAppealAction(
  caseId: string,
  _state: CommunityModerationAppealActionState,
  formData: FormData,
): Promise<CommunityModerationAppealActionState> {
  const actor = await requireUser();
  const parsed = appealSchema.safeParse({
    caseId,
    statement: formValue(formData, "statement"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Der Einspruch muss zwischen 3 und 2000 Zeichen enthalten.",
      code: "appealInvalid",
    };
  }

  try {
    await db.transaction(async (tx) => {
      const [caseReference] = await tx
        .select({
          decisionVersion: communityModerationCases.decisionVersion,
          targetType: communityModerationCases.targetType,
          targetId: communityModerationCases.targetId,
        })
        .from(communityModerationCases)
        .where(
          and(
            eq(communityModerationCases.id, parsed.data.caseId),
            eq(communityModerationCases.organizationId, actor.organizationId),
            eq(communityModerationCases.targetAuthorId, actor.id),
          ),
        )
        .limit(1);
      if (!caseReference) {
        throw new ApiError(
          404,
          "not_found",
          "Moderationseinreichung nicht gefunden.",
        );
      }
      const [latestCase] = await tx
        .select({ id: communityModerationCases.id })
        .from(communityModerationCases)
        .where(
          and(
            eq(communityModerationCases.organizationId, actor.organizationId),
            eq(communityModerationCases.targetAuthorId, actor.id),
            eq(communityModerationCases.targetType, caseReference.targetType),
            eq(communityModerationCases.targetId, caseReference.targetId),
          ),
        )
        .orderBy(
          desc(communityModerationCases.createdAt),
          desc(communityModerationCases.id),
        )
        .limit(1);
      if (!latestCase || latestCase.id !== parsed.data.caseId) {
        throw new ApiError(
          409,
          "conflict",
          "Fuer diesen Inhalt existiert ein neuerer Moderationsfall.",
        );
      }
      await createCommunityModerationAppeal(tx, {
        organizationId: actor.organizationId,
        caseId: parsed.data.caseId,
        appellantId: actor.id,
        expectedDecisionVersion: caseReference.decisionVersion,
        statement: parsed.data.statement,
      });
    });
  } catch (error) {
    if (!(error instanceof ApiError)) {
      logServerError(error, { action: "community.create_appeal" });
    }
    return {
      ok: false,
      message: "Der Einspruch konnte nicht eingereicht werden.",
      code:
        error instanceof ApiError && error.code === "not_found"
          ? "appealNotFound"
          : error instanceof ApiError && error.code === "validation_error"
            ? "appealInvalid"
            : error instanceof ApiError &&
                (error.code === "conflict" || error.code === "forbidden")
              ? "appealUnavailable"
              : "appealFailed",
    };
  }

  revalidatePath("/academy/community");
  revalidatePath("/admin/community");
  return {
    ok: true,
    message: "Einspruch wurde eingereicht.",
    code: "appealSubmitted",
  };
}
