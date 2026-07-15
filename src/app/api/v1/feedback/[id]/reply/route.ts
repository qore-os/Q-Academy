import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { feedbackReplySchema } from "@/lib/api/schemas";
import {
  queueFeedbackReplyInTransaction,
  requireFeedbackApiActor,
} from "@/lib/feedback-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["feedback:write"],
      action: "feedback.reply",
      resourceType: "feedback",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, feedbackReplySchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const actor = await requireFeedbackApiActor(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const result = await queueFeedbackReplyInTransaction(tx, {
          organizationId: context.organizationId,
          feedbackId: id,
          actorId: actor.id,
          actorRole: actor.role,
          access: "tenant",
          subject: input.subject,
          message: input.message,
        });
        await activity({
          userId: actor.id,
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
        await webhook("feedback.replied", {
          feedbackId: result.feedback.id,
          deliveryId: result.delivery.id,
          recipientUserId: result.target.recipient.id,
          status: result.feedback.status,
        });
        return {
          data: {
            feedback: result.feedback,
            delivery: result.delivery,
          },
          status: 201,
          resourceId: id,
        };
      },
    },
  );
}
