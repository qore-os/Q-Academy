import {
  requireEmailApiKeyActor,
  retryFailedEmailDelivery,
} from "@/lib/email-center";
import { emailDeliveryRetryInputSchema } from "@/lib/email-center-model";
import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";

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
      scopes: ["email:write"],
      action: "email.delivery.retry",
      resourceType: "email_delivery",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, emailDeliveryRetryInputSchema),
      execute: async (tools) => {
        const actorUserId = await requireEmailApiKeyActor(tools.tx, {
          organizationId: tools.context.organizationId,
          apiKeyId: tools.context.apiKeyId,
        });
        const result = await retryFailedEmailDelivery(tools.tx, {
          organizationId: tools.context.organizationId,
          actorUserId,
          deliveryId: id,
          source: "api",
        });
        return {
          data: {
            id: result.delivery.id,
            event: result.delivery.event,
            status: result.delivery.status,
            attempt: result.delivery.attempt,
            nextRetryAt: result.delivery.nextRetryAt,
            updatedAt: result.delivery.updatedAt,
            changed: result.changed,
          },
          status: 202,
          resourceId: result.delivery.id,
        };
      },
    },
  );
}
