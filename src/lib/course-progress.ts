import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { courses, enrollments, lessonProgress } from "@/db/schema";
import { issueCourseCertificate } from "@/lib/certificates";
import {
  calculateRequiredCourseProgress,
  getCourseLearningAccess,
} from "@/lib/learning-access";

export type CourseProgressTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type DerivedCourseEnrollmentProgress = {
  enrollmentId: string;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  completedAt: Date | null;
  lastAccessedAt: Date;
};

export async function relatedPublishedCourseIdsForLesson(
  transaction: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    lessonId: string;
  },
) {
  const enrollmentRows = await transaction
    .select({ courseId: enrollments.courseId })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.accessActive, true),
      ),
    );
  const relatedCourseIds: string[] = [];
  for (const { courseId } of enrollmentRows) {
    const access = await getCourseLearningAccess(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId,
    });
    if (access?.lessons.get(input.lessonId)?.access.listed) {
      relatedCourseIds.push(courseId);
    }
  }
  return relatedCourseIds;
}

export async function deriveCourseEnrollmentProgress(
  transaction: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    now?: Date;
  },
) {
  const learningAccess = await getCourseLearningAccess(transaction, input);
  if (!learningAccess) return null;
  const [currentEnrollment] = await transaction
    .select({
      id: enrollments.id,
      completedAt: enrollments.completedAt,
    })
    .from(enrollments)
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.accessActive, true),
      ),
    )
    .limit(1);
  if (!currentEnrollment) return null;

  const publishedLessonIds = learningAccess.publishedLessonIds;
  const requiredLessonIds = learningAccess.requiredLessonIds;
  const progressRows = publishedLessonIds.length
    ? await transaction
        .select({
          lessonId: lessonProgress.lessonId,
          status: lessonProgress.status,
        })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, input.userId),
            inArray(lessonProgress.lessonId, publishedLessonIds),
          ),
        )
    : [];
  const completedLessonIds = new Set(
    progressRows
      .filter((progress) => progress.status === "completed")
      .map((progress) => progress.lessonId),
  );
  const progress = calculateRequiredCourseProgress(
    requiredLessonIds,
    completedLessonIds,
  );
  const hasStarted = progressRows.some(
    (lesson) => lesson.status !== "not_started",
  );
  const status =
    requiredLessonIds.length > 0 && progress === 100
      ? "completed"
      : hasStarted
        ? "in_progress"
        : "not_started";
  const now = input.now ?? new Date();
  return {
    enrollmentId: currentEnrollment.id,
    status,
    progress,
    lastAccessedAt: now,
    completedAt:
      status === "completed" ? (currentEnrollment.completedAt ?? now) : null,
  } satisfies DerivedCourseEnrollmentProgress;
}

export async function recalculateCourseEnrollmentProgress(
  transaction: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    now?: Date;
  },
) {
  const derived = await deriveCourseEnrollmentProgress(transaction, input);
  if (!derived) return null;
  const [updated] = await transaction
    .update(enrollments)
    .set({
      status: derived.status,
      progress: derived.progress,
      lastAccessedAt: derived.lastAccessedAt,
      completedAt: derived.completedAt,
    })
    .where(
      and(
        eq(enrollments.id, derived.enrollmentId),
        eq(enrollments.userId, input.userId),
        eq(enrollments.courseId, input.courseId),
      ),
    )
    .returning();
  if (!updated) return null;
  if (derived.status === "completed") {
    await issueCourseCertificate(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
    });
  }
  return updated;
}

export async function recalculateRelatedCourseEnrollments(
  transaction: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    lessonId: string;
    courseIds?: string[];
    now?: Date;
  },
) {
  const courseIds = input.courseIds ??
    (await relatedPublishedCourseIdsForLesson(transaction, input));
  const updates = [];
  for (const courseId of [...new Set(courseIds)]) {
    const updated = await recalculateCourseEnrollmentProgress(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId,
      now: input.now,
    });
    if (updated) updates.push(updated);
  }
  return updates;
}
