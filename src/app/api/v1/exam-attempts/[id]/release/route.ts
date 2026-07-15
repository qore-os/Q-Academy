import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { releaseExamAttempt } from "@/lib/exam-lifecycle";
import { examAttemptReleaseSchema } from "@/lib/exam-lifecycle-model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["assessments:write", "courses:write"],
      action: "exam_attempt.release",
      resourceType: "assessment_attempt",
      idempotent: true,
    },
    async (context) => {
      const [actor] = await db
        .select({ id: users.id })
        .from(apiKeys)
        .innerJoin(
          users,
          and(
            eq(users.id, apiKeys.createdById),
            eq(users.organizationId, apiKeys.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(apiKeys.id, context.apiKeyId),
            eq(apiKeys.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!actor) {
        throw new ApiError(
          403,
          "forbidden",
          "Die Freigabe benoetigt einen aktiven verantwortlichen Benutzer.",
        );
      }
      return {
        data: await releaseExamAttempt({
          organizationId: context.organizationId,
          actorUserId: actor.id,
          attemptId: id,
          ...(await parseJson(request, examAttemptReleaseSchema)),
        }),
        resourceId: id,
      };
    },
  );
}
