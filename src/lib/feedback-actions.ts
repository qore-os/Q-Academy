"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, feedbackEntries } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireAdmin, requireUser } from "@/lib/auth";
import {
  coursePermissionAllows,
  coursePermissionForUser,
} from "@/lib/course-permissions";
import {
  createMemberCourseFeedbackInTransaction,
  createMemberLessonFeedbackInTransaction,
  queueFeedbackReplyInTransaction,
  requireFeedbackTeamActor,
  updateFeedbackStatusInTransaction,
} from "@/lib/feedback-service";
import { logServerError } from "@/lib/server-error-logging";

export type FeedbackActionCode =
  | "reviewInvalid"
  | "reviewForbidden"
  | "reviewFailed"
  | "reviewed"
  | "reopened"
  | "archived"
  | "replyInvalid"
  | "replyForbidden"
  | "replyFailed"
  | "replyQueued";

export type FeedbackActionState = {
  error?: string;
  success?: string;
  code?: FeedbackActionCode;
  memberCode?: "submitInvalid" | "submitFailed" | "submitted";
};

const courseFeedbackSchema = z.object({
  courseId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  content: z
    .string()
    .trim()
    .min(3, "Bitte ergaenze einen kurzen Kommentar.")
    .max(5_000),
  testimonialConsent: z.string().optional(),
});

const lessonFeedbackSchema = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid(),
  rating: z.coerce.number().int().min(1).max(5),
  content: z.string().trim().max(10_000),
});

const reviewFeedbackSchema = z.object({
  feedbackId: z.string().uuid(),
  status: z.enum(["new", "reviewed", "archived"]),
});

const replyFeedbackSchema = z.object({
  feedbackId: z.string().uuid(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(3).max(10_000),
});

function actionError(
  error: unknown,
  fallback: string,
  action: string,
  code?: FeedbackActionCode,
): FeedbackActionState {
  if (!(error instanceof ApiError)) {
    logServerError(error, { action });
  }
  return {
    error: error instanceof ApiError ? error.message : fallback,
    code,
  };
}

async function canModerateFeedback(
  user: Awaited<ReturnType<typeof requireAdmin>>,
  feedbackId: string,
) {
  const [target] = await db
    .select({ courseId: feedbackEntries.courseId })
    .from(feedbackEntries)
    .where(
      and(
        eq(feedbackEntries.id, feedbackId),
        eq(feedbackEntries.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!target) return false;
  if (user.role === "owner" || user.role === "admin") return true;
  if (!target.courseId) return false;
  return coursePermissionAllows(
    await coursePermissionForUser(user, target.courseId),
    "edit",
  );
}

export async function submitCourseFeedbackAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const parsed = courseFeedbackSchema.safeParse({
    courseId: formData.get("courseId"),
    rating: formData.get("rating"),
    content: formData.get("content"),
    testimonialConsent: formData.get("testimonialConsent") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "invalid_feedback", memberCode: "submitInvalid" };
  }

  try {
    await db.transaction(async (tx) => {
      const feedback = await createMemberCourseFeedbackInTransaction(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        courseId: parsed.data.courseId,
        rating: parsed.data.rating,
        content: parsed.data.content,
        testimonialConsent: parsed.data.testimonialConsent === "on",
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "feedback.created",
        entityType: "feedback",
        entityId: feedback.id,
        metadata: {
          rating: feedback.rating,
          feedbackType: feedback.type,
          courseId: feedback.courseId,
        },
      });
      await enqueueWebhook(
        user.organizationId,
        "feedback.created",
        feedback,
        tx,
      );
    });
  } catch (error) {
    return {
      ...actionError(
      error,
      "Feedback konnte nicht gesendet werden.",
      "feedback.course.submit",
      ),
      memberCode: "submitFailed",
    };
  }
  revalidatePath("/admin/tasks");
  return { success: "feedback_submitted", memberCode: "submitted" };
}

export async function submitLessonFeedbackAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireUser();
  const parsed = lessonFeedbackSchema.safeParse({
    courseId: formData.get("courseId"),
    lessonId: formData.get("lessonId"),
    rating: formData.get("rating"),
    content: formData.get("content") ?? "",
  });
  if (!parsed.success) {
    return { error: "invalid_feedback", memberCode: "submitInvalid" };
  }

  try {
    await db.transaction(async (tx) => {
      const feedback = await createMemberLessonFeedbackInTransaction(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        courseId: parsed.data.courseId,
        lessonId: parsed.data.lessonId,
        rating: parsed.data.rating,
        content: parsed.data.content,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "feedback.created",
        entityType: "feedback",
        entityId: feedback.id,
        metadata: {
          rating: feedback.rating,
          feedbackType: "lesson",
          courseId: feedback.courseId,
          lessonId: feedback.lessonId,
        },
      });
      await enqueueWebhook(
        user.organizationId,
        "feedback.created",
        feedback,
        tx,
      );
    });
  } catch (error) {
    return {
      ...actionError(
      error,
      "Feedback konnte nicht gesendet werden.",
      "feedback.lesson.submit",
      ),
      memberCode: "submitFailed",
    };
  }
  revalidatePath("/admin/tasks");
  return { success: "feedback_submitted", memberCode: "submitted" };
}

export async function reviewFeedbackAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireAdmin();
  const parsed = reviewFeedbackSchema.safeParse({
    feedbackId: formData.get("feedbackId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: "Feedback-Aktion ist ungueltig.", code: "reviewInvalid" };
  }
  if (!(await canModerateFeedback(user, parsed.data.feedbackId))) {
    return {
      error: "Dieses Feedback ist nicht fuer dich freigegeben.",
      code: "reviewForbidden",
    };
  }

  try {
    await db.transaction(async (tx) => {
      const actor = await requireFeedbackTeamActor(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
      });
      const { feedback } = await updateFeedbackStatusInTransaction(tx, {
        organizationId: user.organizationId,
        feedbackId: parsed.data.feedbackId,
        actorId: actor.id,
        actorRole: actor.role,
        access: "course",
        status: parsed.data.status,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "feedback.status.updated",
        entityType: "feedback",
        entityId: feedback.id,
        metadata: { status: feedback.status },
      });
      if (feedback.status === "reviewed") {
        await enqueueWebhook(
          user.organizationId,
          "feedback.reviewed",
          feedback,
          tx,
        );
      }
    });
  } catch (error) {
    return actionError(
      error,
      "Feedback konnte nicht aktualisiert werden.",
      "feedback.status.update",
      "reviewFailed",
    );
  }
  revalidatePath("/admin/tasks");
  return {
    code:
      parsed.data.status === "reviewed"
        ? "reviewed"
        : parsed.data.status === "new"
          ? "reopened"
          : "archived",
    success:
      parsed.data.status === "reviewed"
        ? "Als erledigt markiert."
        : parsed.data.status === "new"
          ? "Feedback wieder geoeffnet."
          : "Feedback archiviert.",
  };
}

export async function replyToFeedbackAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const user = await requireAdmin();
  const parsed = replyFeedbackSchema.safeParse({
    feedbackId: formData.get("feedbackId"),
    subject: formData.get("subject"),
    message: formData.get("message"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Nachricht ist ungueltig.",
      code: "replyInvalid",
    };
  }
  if (!(await canModerateFeedback(user, parsed.data.feedbackId))) {
    return {
      error: "Dieses Feedback ist nicht fuer dich freigegeben.",
      code: "replyForbidden",
    };
  }

  try {
    await db.transaction(async (tx) => {
      const actor = await requireFeedbackTeamActor(tx, {
        organizationId: user.organizationId,
        actorId: user.id,
      });
      const result = await queueFeedbackReplyInTransaction(tx, {
        organizationId: user.organizationId,
        feedbackId: parsed.data.feedbackId,
        actorId: actor.id,
        actorRole: actor.role,
        access: "course",
        subject: parsed.data.subject,
        message: parsed.data.message,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "feedback.reply.queued",
        entityType: "feedback",
        entityId: result.feedback.id,
        metadata: {
          deliveryId: result.delivery.id,
          recipientUserId: result.target.recipient.id,
          courseId: result.feedback.courseId,
          lessonId: result.feedback.lessonId,
        },
      });
      await enqueueWebhook(
        user.organizationId,
        "feedback.replied",
        {
          feedbackId: result.feedback.id,
          deliveryId: result.delivery.id,
          recipientUserId: result.target.recipient.id,
          status: result.feedback.status,
        },
        tx,
      );
    });
  } catch (error) {
    return actionError(
      error,
      "Die Nachricht konnte nicht vorgemerkt werden.",
      "feedback.reply.queue",
      "replyFailed",
    );
  }
  revalidatePath("/admin/tasks");
  return {
    success: "Nachricht wurde fuer den E-Mail-Versand vorgemerkt.",
    code: "replyQueued",
  };
}
