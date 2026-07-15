import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { apiKeys, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { finalizeExamAttemptByAdministrator } from "@/lib/exam-lifecycle";

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
      action: "exam_attempt.finalize",
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
          "Die Finalisierung benoetigt einen aktiven verantwortlichen Benutzer.",
        );
      }
      return {
        data: await finalizeExamAttemptByAdministrator({
          organizationId: context.organizationId,
          actorUserId: actor.id,
          attemptId: id,
        }),
        resourceId: id,
      };
    },
  );
}
