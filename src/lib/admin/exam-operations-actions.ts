"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import {
  finalizeExamAttemptByAdministrator,
  releaseExamAttempt,
} from "@/lib/exam-lifecycle";
import { logServerError } from "@/lib/server-error-logging";

export type ExamOperationActionState = {
  error?: string;
  success?: string;
  code?: ExamOperationActionCode;
};

export type ExamOperationActionCode =
  | "invalid"
  | "failed"
  | "resultReleased"
  | "reviewReleased"
  | "finalized";

const attemptSchema = z.object({ attemptId: z.string().uuid() }).strict();
const releaseSchema = attemptSchema
  .extend({ release: z.enum(["result", "review"]) })
  .strict();

function actionFailure(error: unknown, action: string) {
  if (error instanceof ApiError) return { error: error.message, code: "failed" as const };
  logServerError(error, { action });
  return {
    error: "Die Pruefungsaktion konnte nicht ausgefuehrt werden.",
    code: "failed" as const,
  };
}

export async function releaseExamOperationAction(
  _previous: ExamOperationActionState,
  formData: FormData,
): Promise<ExamOperationActionState> {
  const actor = await requireTeamPermission("courses.manage");
  const parsed = releaseSchema.safeParse({
    attemptId: formData.get("attemptId"),
    release: formData.get("release"),
  });
  if (!parsed.success) {
    return { error: "Die Pruefungsaktion ist ungueltig.", code: "invalid" };
  }
  try {
    await releaseExamAttempt({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      ...parsed.data,
    });
    revalidatePath("/admin/tasks");
    return {
      code:
        parsed.data.release === "result"
          ? "resultReleased"
          : "reviewReleased",
      success:
        parsed.data.release === "result"
          ? "Das Pruefungsergebnis wurde freigegeben."
          : "Die Pruefungseinsicht wurde freigegeben.",
    };
  } catch (error) {
    return actionFailure(error, "admin.exam.release");
  }
}

export async function finalizeExamOperationAction(
  _previous: ExamOperationActionState,
  formData: FormData,
): Promise<ExamOperationActionState> {
  const actor = await requireTeamPermission("courses.manage");
  const parsed = attemptSchema.safeParse({
    attemptId: formData.get("attemptId"),
  });
  if (!parsed.success) {
    return { error: "Der Pruefungsversuch ist ungueltig.", code: "invalid" };
  }
  try {
    await finalizeExamAttemptByAdministrator({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      attemptId: parsed.data.attemptId,
    });
    revalidatePath("/admin/tasks");
    return {
      success: "Der laufende Pruefungsversuch wurde finalisiert.",
      code: "finalized",
    };
  } catch (error) {
    return actionFailure(error, "admin.exam.finalize");
  }
}
