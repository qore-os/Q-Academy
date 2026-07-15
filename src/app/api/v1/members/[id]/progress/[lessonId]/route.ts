import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, lessonProgress, users } from "@/db/schema";
import { hasPassedRequiredQuiz } from "@/lib/assessments";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { lessonProgressUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { recalculateRelatedCourseEnrollments } from "@/lib/course-progress";
import { getCourseLearningAccess } from "@/lib/learning-access";
import type { PublishedSnapshotLesson } from "@/lib/published-course";
import {
  assertProgressReductionHasNoActiveCertificate,
  certificateProgressCourseIdsForLesson,
} from "@/lib/progress-integrity";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import { hasApprovedRequiredSubmissions } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function accessibleCourses(userId: string, lessonId: string, organizationId: string) {
  const [[member], enrolledCourses] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId))).limit(1),
    db
      .select({ courseId: courses.id })
      .from(enrollments)
      .innerJoin(courses, and(eq(courses.id, enrollments.courseId), eq(courses.organizationId, organizationId)))
      .innerJoin(
        users,
        and(
          eq(users.id, enrollments.userId),
          eq(users.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(enrollments.userId, userId),
          eq(enrollments.accessActive, true),
          eq(courses.status, "published"),
        ),
      ),
  ]);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  const resolvedCourses = await Promise.all(
    enrolledCourses.map(({ courseId }) =>
      getCourseLearningAccess(db, {
        organizationId,
        userId,
        courseId,
      }),
    ),
  );
  const relatedCourseIds = resolvedCourses.flatMap((learningAccess) => {
    if (!learningAccess?.lessons.has(lessonId)) return [];
    return [learningAccess.published.courseId];
  });
  const accessibleCourseIds = resolvedCourses.flatMap((learningAccess) => {
    if (!learningAccess?.lessons.get(lessonId)?.access.accessible) return [];
    return [learningAccess.published.courseId];
  });
  const interactiveCourseIds = resolvedCourses.flatMap((learningAccess) => {
    if (!learningAccess?.lessons.get(lessonId)?.access.canInteract) return [];
    return [learningAccess.published.courseId];
  });
  if (!accessibleCourseIds.length) throw new ApiError(404, "not_found", "Lektion wurde nicht gefunden oder ist noch nicht freigeschaltet.");
  return { accessibleCourseIds, interactiveCourseIds, relatedCourseIds };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handleApi(request, { scopes: ["members:read"], action: "lesson_progress.read", resourceType: "lesson_progress" }, async (context) => {
    await accessibleCourses(id, lessonId, context.organizationId);
    const [progress] = await db.select().from(lessonProgress).where(and(eq(lessonProgress.userId, id), eq(lessonProgress.lessonId, lessonId))).limit(1);
    return { data: progress ?? { userId: id, lessonId, status: "not_started", percent: 0 }, resourceId: progress?.id };
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handleApi(request, { scopes: ["members:write"], action: "lesson_progress.set", resourceType: "lesson_progress", idempotent: true }, async (context) => {
    const { interactiveCourseIds, relatedCourseIds } = await accessibleCourses(id, lessonId, context.organizationId);
    if (!interactiveCourseIds.length) {
      throw new ApiError(404, "not_found", "Lektion ist nur lesbar oder gesperrt.");
    }
    const input = await parseJson(request, lessonProgressUpdateSchema);
    const result = await db.transaction(async (tx) => {
      const certificateCourseIds = await certificateProgressCourseIdsForLesson(
        tx,
        {
          organizationId: context.organizationId,
          userId: id,
          lessonId,
        },
      );
      const progressLockCourseIds = [
        ...new Set([...relatedCourseIds, ...certificateCourseIds]),
      ].sort();
      for (const courseId of progressLockCourseIds) {
        await lockMemberCourseProgress(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseId,
        });
      }
      const currentAccessibleCourses: Array<{
        courseId: string;
        lesson: PublishedSnapshotLesson;
      }> = [];
      for (const courseId of interactiveCourseIds) {
        const learningAccess = await getCourseLearningAccess(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseId,
        });
        const resolvedLesson = learningAccess?.lessons.get(lessonId);
        if (resolvedLesson?.access.canInteract) {
          currentAccessibleCourses.push({
            courseId,
            lesson: resolvedLesson.lesson,
          });
        }
      }
      if (!currentAccessibleCourses.length) {
        throw new ApiError(
          404,
          "not_found",
          "Lektion wurde nicht gefunden oder ist noch nicht freigeschaltet.",
        );
      }
      const [current] = await tx
        .select()
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, id),
            eq(lessonProgress.lessonId, lessonId),
          ),
        )
        .limit(1);
      const percent =
        input.status === "completed"
          ? 100
          : input.status === "not_started"
            ? 0
            : (input.percent ?? current?.percent ?? 0);
      const status =
        input.status ??
        (percent === 100
          ? "completed"
          : percent > 0
            ? "in_progress"
            : "not_started");
      const statusRank = {
        not_started: 0,
        in_progress: 1,
        completed: 2,
      } as const;
      const currentStatus = current?.status ?? "not_started";
      const currentPercent = current?.percent ?? 0;
      if (
        percent < currentPercent ||
        statusRank[status] < statusRank[currentStatus]
      ) {
        await assertProgressReductionHasNoActiveCertificate(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseIds: progressLockCourseIds,
        });
      }
      if (status === "completed") {
        for (const { courseId, lesson } of currentAccessibleCourses) {
          const assessmentPassed = await hasPassedRequiredQuiz(tx, {
            organizationId: context.organizationId,
            userId: id,
            courseId,
            lessonId,
          });
          if (!assessmentPassed) {
            throw new ApiError(
              409,
              "conflict",
              "Die Lektion kann erst nach bestandenem Pflichtquiz abgeschlossen werden.",
              { courseId, lessonId },
            );
          }
          const submissionsApproved = await hasApprovedRequiredSubmissions(tx, {
            organizationId: context.organizationId,
            userId: id,
            courseId,
            lessonId,
            lesson,
          });
          if (!submissionsApproved) {
            throw new ApiError(
              409,
              "conflict",
              "Die Lektion kann erst nach Freigabe aller Pflichtabgaben abgeschlossen werden.",
              { courseId, lessonId, reason: "required_submission_pending" },
            );
          }
        }
      }
      const [updated] = await tx
        .insert(lessonProgress)
        .values({ userId: id, lessonId, status, percent, startedAt: status === "not_started" ? null : (current?.startedAt ?? new Date()), completedAt: status === "completed" ? new Date() : null })
        .onConflictDoUpdate({ target: [lessonProgress.userId, lessonProgress.lessonId], set: { status, percent, startedAt: status === "not_started" ? null : (current?.startedAt ?? new Date()), completedAt: status === "completed" ? new Date() : null } })
        .returning();
      await recalculateRelatedCourseEnrollments(tx, {
        organizationId: context.organizationId,
        userId: id,
        lessonId,
        courseIds: relatedCourseIds,
      });
      return { progress: updated, previousStatus: current?.status ?? null };
    });
    if (
      result.progress.status === "completed" &&
      result.previousStatus !== "completed"
    ) {
      await enqueueWebhook(
        context.organizationId,
        "lesson.completed",
        result.progress,
      );
    }
    return { data: result.progress, resourceId: result.progress.id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; lessonId: string }> }) {
  const { id, lessonId } = await params;
  return handleApi(request, { scopes: ["members:write"], action: "lesson_progress.reset", resourceType: "lesson_progress", idempotent: true }, async (context) => {
    const { interactiveCourseIds, relatedCourseIds } = await accessibleCourses(id, lessonId, context.organizationId);
    if (!interactiveCourseIds.length) {
      throw new ApiError(404, "not_found", "Lektion ist nur lesbar oder gesperrt.");
    }
    await db.transaction(async (tx) => {
      const certificateCourseIds = await certificateProgressCourseIdsForLesson(
        tx,
        {
          organizationId: context.organizationId,
          userId: id,
          lessonId,
        },
      );
      const progressLockCourseIds = [
        ...new Set([...relatedCourseIds, ...certificateCourseIds]),
      ].sort();
      for (const courseId of progressLockCourseIds) {
        await lockMemberCourseProgress(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseId,
        });
      }
      let remainsInteractive = false;
      for (const courseId of interactiveCourseIds) {
        const access = await getCourseLearningAccess(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseId,
        });
        if (access?.lessons.get(lessonId)?.access.canInteract) {
          remainsInteractive = true;
          break;
        }
      }
      if (!remainsInteractive) {
        throw new ApiError(
          404,
          "not_found",
          "Lektion ist nur lesbar oder gesperrt.",
        );
      }
      const [current] = await tx
        .select({ id: lessonProgress.id })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, id),
            eq(lessonProgress.lessonId, lessonId),
          ),
        )
        .limit(1);
      if (!current) return;
      await assertProgressReductionHasNoActiveCertificate(tx, {
        organizationId: context.organizationId,
        userId: id,
        courseIds: progressLockCourseIds,
      });
      await tx.delete(lessonProgress).where(and(eq(lessonProgress.userId, id), eq(lessonProgress.lessonId, lessonId)));
      await recalculateRelatedCourseEnrollments(tx, {
        organizationId: context.organizationId,
        userId: id,
        lessonId,
        courseIds: relatedCourseIds,
      });
    });
    return { data: { userId: id, lessonId, reset: true } };
  });
}
