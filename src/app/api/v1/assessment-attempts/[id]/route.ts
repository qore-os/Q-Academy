import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { assessmentAnswers, assessmentAttempts } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { redactAssessmentAnswerKeys } from "@/lib/assessments";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["members:read", "courses:read"],
      action: "assessment_attempt.read",
      resourceType: "assessment_attempt",
    },
    async (context) => {
      const [attempt] = await db
        .select()
        .from(assessmentAttempts)
        .where(
          and(
            eq(assessmentAttempts.id, id),
            eq(assessmentAttempts.organizationId, context.organizationId),
            isNull(assessmentAttempts.courseVersionId),
          ),
        )
        .limit(1);
      if (!attempt) {
        throw new ApiError(404, "not_found", "Quizversuch nicht gefunden.");
      }
      const answers = await db
        .select()
        .from(assessmentAnswers)
        .where(
          and(
            eq(assessmentAnswers.attemptId, attempt.id),
            eq(assessmentAnswers.organizationId, context.organizationId),
          ),
        )
        .orderBy(asc(assessmentAnswers.answeredAt), asc(assessmentAnswers.id));

      return {
        data: redactAssessmentAnswerKeys({ ...attempt, answers }),
        resourceId: attempt.id,
      };
    },
  );
}
