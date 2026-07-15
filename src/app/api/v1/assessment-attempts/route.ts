import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { assessmentAttempts, courses, lessons, users } from "@/db/schema";
import {
  redactAssessmentAnswerKeys,
  submitAssessmentAttempt,
} from "@/lib/assessments";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { assessmentAttemptSubmitSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["members:read", "courses:read"],
      action: "assessment_attempt.list",
      resourceType: "assessment_attempt",
    },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const conditions: SQL[] = [
        eq(assessmentAttempts.organizationId, context.organizationId),
        isNull(assessmentAttempts.courseVersionId),
      ];
      const userId = url.searchParams.get("userId");
      const courseId = url.searchParams.get("courseId");
      const lessonId = url.searchParams.get("lessonId");
      const status = url.searchParams.get("status");
      const passed = url.searchParams.get("passed");

      if (userId) conditions.push(eq(assessmentAttempts.userId, userId));
      if (courseId) conditions.push(eq(assessmentAttempts.courseId, courseId));
      if (lessonId) conditions.push(eq(assessmentAttempts.lessonId, lessonId));
      if (status && ["in_progress", "submitted", "graded"].includes(status)) {
        conditions.push(
          eq(
            assessmentAttempts.status,
            status as "in_progress" | "submitted" | "graded",
          ),
        );
      }
      if (passed === "true" || passed === "false") {
        conditions.push(eq(assessmentAttempts.passed, passed === "true"));
      }

      const rows = await db
        .select({
          id: assessmentAttempts.id,
          userId: assessmentAttempts.userId,
          memberEmail: users.email,
          memberFirstName: users.firstName,
          memberLastName: users.lastName,
          courseId: assessmentAttempts.courseId,
          courseTitle: courses.title,
          lessonId: assessmentAttempts.lessonId,
          lessonTitle: lessons.title,
          attemptNumber: assessmentAttempts.attemptNumber,
          status: assessmentAttempts.status,
          score: assessmentAttempts.score,
          passed: assessmentAttempts.passed,
          questionCount: assessmentAttempts.questionCount,
          correctCount: assessmentAttempts.correctCount,
          startedAt: assessmentAttempts.startedAt,
          submittedAt: assessmentAttempts.submittedAt,
          gradedAt: assessmentAttempts.gradedAt,
          createdAt: assessmentAttempts.createdAt,
        })
        .from(assessmentAttempts)
        .innerJoin(
          users,
          and(
            eq(users.id, assessmentAttempts.userId),
            eq(users.organizationId, context.organizationId),
          ),
        )
        .innerJoin(
          courses,
          and(
            eq(courses.id, assessmentAttempts.courseId),
            eq(courses.organizationId, context.organizationId),
          ),
        )
        .innerJoin(lessons, eq(lessons.id, assessmentAttempts.lessonId))
        .where(and(...conditions))
        .orderBy(desc(assessmentAttempts.createdAt), asc(assessmentAttempts.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;

      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["members:write", "courses:read"],
      action: "assessment_attempt.submit",
      resourceType: "assessment_attempt",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, assessmentAttemptSubmitSchema);
      const attempt = await submitAssessmentAttempt({
        organizationId: context.organizationId,
        ...input,
      });
      return {
        data: redactAssessmentAnswerKeys(attempt),
        status: 201,
        resourceId: attempt.id,
      };
    },
  );
}
