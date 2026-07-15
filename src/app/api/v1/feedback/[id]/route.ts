import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedbackEntries } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { feedbackUpdateSchema } from "@/lib/api/schemas";
import {
  requireFeedbackApiActor,
  updateFeedbackStatusInTransaction,
} from "@/lib/feedback-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function feedbackForOrganization(id: string, organizationId: string) {
  const [feedback] = await db
    .select()
    .from(feedbackEntries)
    .where(
      and(
        eq(feedbackEntries.id, id),
        eq(feedbackEntries.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!feedback) {
    throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
  }
  return feedback;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["feedback:read"],
      action: "feedback.read",
      resourceType: "feedback",
    },
    async (context) => ({
      data: await feedbackForOrganization(id, context.organizationId),
      resourceId: id,
    }),
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["feedback:write"],
      action: "feedback.update",
      resourceType: "feedback",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, feedbackUpdateSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const actor = await requireFeedbackApiActor(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const { feedback } = await updateFeedbackStatusInTransaction(tx, {
          organizationId: context.organizationId,
          feedbackId: id,
          actorId: actor.id,
          actorRole: actor.role,
          access: "tenant",
          status: input.status,
        });
        await activity({
          userId: actor.id,
          type: "feedback.status.updated",
          entityType: "feedback",
          entityId: feedback.id,
          metadata: { status: feedback.status },
        });
        if (feedback.status === "reviewed") {
          await webhook("feedback.reviewed", feedback);
        }
        return { data: feedback, resourceId: id };
      },
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["feedback:write"],
      action: "feedback.delete",
      resourceType: "feedback",
      idempotent: true,
    },
    async (context) => {
      const [deleted] = await db
        .delete(feedbackEntries)
        .where(
          and(
            eq(feedbackEntries.id, id),
            eq(feedbackEntries.organizationId, context.organizationId),
          ),
        )
        .returning({ id: feedbackEntries.id });
      if (!deleted) {
        throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
      }
      return { data: { id, deleted: true }, resourceId: id };
    },
  );
}
