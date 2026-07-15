"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireUser } from "@/lib/auth";
import {
  subscribeToLessonAvailability,
  unsubscribeFromLessonAvailability,
} from "@/lib/lesson-availability-service";
import { logServerError } from "@/lib/server-error-logging";

export type LessonAvailabilityActionState = {
  ok: boolean | null;
  message: string;
  subscribed: boolean;
};

const inputSchema = z
  .object({
    courseId: z.string().uuid(),
    lessonId: z.string().uuid(),
    courseSlug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180),
  })
  .strict();

function failure(
  error: unknown,
  subscribed: boolean,
): LessonAvailabilityActionState {
  if (error instanceof ApiError) {
    return { ok: false, message: error.message, subscribed };
  }
  logServerError(error, { action: "lesson.availability_subscription.mutate" });
  return {
    ok: false,
    message: "Die Benachrichtigungseinstellung konnte nicht gespeichert werden.",
    subscribed,
  };
}

export async function subscribeToLessonAvailabilityAction(
  courseId: string,
  lessonId: string,
  courseSlug: string,
  previousState: LessonAvailabilityActionState,
  _formData: FormData,
): Promise<LessonAvailabilityActionState> {
  void _formData;
  const user = await requireUser();
  if (user.role !== "member") {
    return {
      ok: false,
      message: "Nur Lernende koennen Lektionsbenachrichtigungen abonnieren.",
      subscribed: false,
    };
  }
  const parsed = inputSchema.safeParse({ courseId, lessonId, courseSlug });
  if (!parsed.success) {
    return { ok: false, message: "Lektion ist ungueltig.", subscribed: false };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const saved = await subscribeToLessonAvailability(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        courseId: parsed.data.courseId,
        lessonId: parsed.data.lessonId,
      });
      if (saved.created) {
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "lesson.availability.subscribed",
          entityType: "lesson_availability_subscription",
          entityId: saved.subscription.id,
          metadata: {
            courseId: parsed.data.courseId,
            lessonId: parsed.data.lessonId,
            versionId: saved.subscription.subscribedVersionId,
          },
        });
        await enqueueWebhook(
          user.organizationId,
          "lesson.availability.subscribed",
          {
            subscriptionId: saved.subscription.id,
            userId: user.id,
            courseId: parsed.data.courseId,
            lessonId: parsed.data.lessonId,
          },
          tx,
        );
      }
      return saved;
    });
    revalidatePath(`/academy/courses/${parsed.data.courseSlug}`);
    return {
      ok: true,
      message: result.created
        ? "Du wirst bei der Freigabe benachrichtigt."
        : "Benachrichtigung ist bereits aktiviert.",
      subscribed: true,
    };
  } catch (error) {
    return failure(error, previousState.subscribed);
  }
}

export async function unsubscribeFromLessonAvailabilityAction(
  courseId: string,
  lessonId: string,
  courseSlug: string,
  previousState: LessonAvailabilityActionState,
  _formData: FormData,
): Promise<LessonAvailabilityActionState> {
  void _formData;
  const user = await requireUser();
  if (user.role !== "member") {
    return {
      ok: false,
      message: "Nur Lernende koennen Lektionsbenachrichtigungen verwalten.",
      subscribed: previousState.subscribed,
    };
  }
  const parsed = inputSchema.safeParse({ courseId, lessonId, courseSlug });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Lektion ist ungueltig.",
      subscribed: previousState.subscribed,
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const cancelled = await unsubscribeFromLessonAvailability(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        courseId: parsed.data.courseId,
        lessonId: parsed.data.lessonId,
      });
      if (cancelled.subscription) {
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "lesson.availability.unsubscribed",
          entityType: "lesson_availability_subscription",
          entityId: cancelled.subscription.id,
          metadata: {
            courseId: parsed.data.courseId,
            lessonId: parsed.data.lessonId,
          },
        });
        await enqueueWebhook(
          user.organizationId,
          "lesson.availability.unsubscribed",
          {
            subscriptionId: cancelled.subscription.id,
            userId: user.id,
            courseId: parsed.data.courseId,
            lessonId: parsed.data.lessonId,
          },
          tx,
        );
      }
      return cancelled;
    });
    revalidatePath(`/academy/courses/${parsed.data.courseSlug}`);
    return {
      ok: true,
      message: result.cancelled
        ? "Benachrichtigung deaktiviert."
        : "Benachrichtigung war bereits deaktiviert.",
      subscribed: false,
    };
  } catch (error) {
    return failure(error, previousState.subscribed);
  }
}

export async function toggleLessonAvailabilityAction(
  courseId: string,
  lessonId: string,
  courseSlug: string,
  previousState: LessonAvailabilityActionState,
  formData: FormData,
) {
  return previousState.subscribed
    ? unsubscribeFromLessonAvailabilityAction(
        courseId,
        lessonId,
        courseSlug,
        previousState,
        formData,
      )
    : subscribeToLessonAvailabilityAction(
        courseId,
        lessonId,
        courseSlug,
        previousState,
        formData,
      );
}
