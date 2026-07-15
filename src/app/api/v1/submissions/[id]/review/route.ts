import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import { ApiError } from "@/lib/api/errors";
import { submissionReviewSchema } from "@/lib/api/schemas";
import { reviewSubmissionAttemptInTransaction } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["submissions:write"],
      action: "submission.review",
      resourceType: "submission",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, submissionReviewSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const actor = await requireActiveApiKeyCreator(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        if (input.reviewerId && input.reviewerId !== actor.id) {
          throw new ApiError(
            403,
            "forbidden",
            "Eine Bewertung kann nur dem aktiven API-Key-Ersteller zugerechnet werden.",
          );
        }
        const reviewed = await reviewSubmissionAttemptInTransaction(tx, {
          organizationId: context.organizationId,
          submissionId: id,
          reviewerId: actor.id,
          decision: input.decision,
          feedback: input.feedback,
          score: input.score,
          annotations: input.annotations,
        });
        await activity({
          userId: actor.id,
          type: "submission.reviewed",
          entityType: "submission",
          entityId: reviewed.submission.id,
          metadata: {
            status: input.decision,
            score: input.score,
            attemptNumber: reviewed.submission.attemptNumber,
            reviewId: reviewed.review.id,
            annotationCount: reviewed.review.annotations.length,
          },
        });
        await webhook("submission.reviewed", {
          ...reviewed.submission,
          review: reviewed.review,
        });
        return { data: reviewed, resourceId: id };
      },
    },
  );
}
