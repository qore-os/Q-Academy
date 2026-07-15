import "server-only";

import { and, asc, eq, isNotNull, isNull, ne, or } from "drizzle-orm";

import { db } from "@/db";
import {
  assessmentAttempts,
  courses,
  lessons,
  users,
  type User,
} from "@/db/schema";
import {
  coursePermissionAllows,
  coursePermissionMapForUser,
} from "@/lib/course-permissions";
import {
  availableExamOperationActions,
  examOperationStatus,
} from "@/lib/exam-operations-policy";

type ExamOperationsActor = Pick<
  User,
  "id" | "organizationId" | "role"
>;

export async function listAdminExamOperations(actor: ExamOperationsActor) {
  const rows = await db
    .select({
      id: assessmentAttempts.id,
      courseId: assessmentAttempts.courseId,
      courseTitle: courses.title,
      lessonId: assessmentAttempts.lessonId,
      lessonTitle: lessons.title,
      userId: assessmentAttempts.userId,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      attemptNumber: assessmentAttempts.attemptNumber,
      status: assessmentAttempts.status,
      score: assessmentAttempts.score,
      passed: assessmentAttempts.passed,
      questionCount: assessmentAttempts.questionCount,
      correctCount: assessmentAttempts.correctCount,
      draftRevision: assessmentAttempts.draftRevision,
      startedAt: assessmentAttempts.startedAt,
      lastSavedAt: assessmentAttempts.lastSavedAt,
      deadlineAt: assessmentAttempts.deadlineAt,
      submittedAt: assessmentAttempts.submittedAt,
      gradedAt: assessmentAttempts.gradedAt,
      finalizationReason: assessmentAttempts.finalizationReason,
      resultReleaseMode: assessmentAttempts.resultReleaseMode,
      reviewReleaseMode: assessmentAttempts.reviewReleaseMode,
      resultReleasedAt: assessmentAttempts.resultReleasedAt,
      reviewReleasedAt: assessmentAttempts.reviewReleasedAt,
      contentAccessMode: assessmentAttempts.contentAccessMode,
    })
    .from(assessmentAttempts)
    .innerJoin(
      users,
      and(
        eq(users.id, assessmentAttempts.userId),
        eq(users.organizationId, assessmentAttempts.organizationId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, assessmentAttempts.courseId),
        eq(courses.organizationId, assessmentAttempts.organizationId),
      ),
    )
    .innerJoin(
      lessons,
      and(
        eq(lessons.id, assessmentAttempts.lessonId),
        eq(lessons.organizationId, assessmentAttempts.organizationId),
      ),
    )
    .where(
      and(
        eq(assessmentAttempts.organizationId, actor.organizationId),
        isNotNull(assessmentAttempts.courseVersionId),
        or(
          eq(assessmentAttempts.status, "in_progress"),
          eq(assessmentAttempts.status, "submitted"),
          and(
            eq(assessmentAttempts.status, "graded"),
            or(
              isNull(assessmentAttempts.resultReleasedAt),
              and(
                ne(assessmentAttempts.reviewReleaseMode, "never"),
                isNull(assessmentAttempts.reviewReleasedAt),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(
      asc(assessmentAttempts.deadlineAt),
      asc(assessmentAttempts.startedAt),
      asc(assessmentAttempts.id),
    );

  const permissions = await coursePermissionMapForUser(
    actor,
    rows.map((row) => row.courseId),
  );
  return rows.flatMap((row) => {
    if (
      !coursePermissionAllows(
        permissions.get(row.courseId) ?? null,
        "edit",
      )
    ) {
      return [];
    }
    const operationStatus = examOperationStatus(row);
    if (!operationStatus) return [];
    return [
      {
        ...row,
        operationStatus,
        availableActions: availableExamOperationActions(row),
      },
    ];
  });
}

export type AdminExamOperation = Awaited<
  ReturnType<typeof listAdminExamOperations>
>[number];
