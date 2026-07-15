import {
  queueEmailTemplateTest,
  requireEmailApiKeyActor,
} from "@/lib/email-center";
import { emailTemplateTestInputSchema } from "@/lib/email-center-model";
import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["email:write"],
      action: "email.template_test.create",
      resourceType: "email_delivery",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, emailTemplateTestInputSchema),
      execute: async (tools, input) => {
        const actorUserId = await requireEmailApiKeyActor(tools.tx, {
          organizationId: tools.context.organizationId,
          apiKeyId: tools.context.apiKeyId,
        });
        const result = await queueEmailTemplateTest(tools.tx, {
          organizationId: tools.context.organizationId,
          actorUserId,
          event: input.event,
          requestId: input.requestId,
          source: "api",
          locale: input.locale,
        });
        return {
          data: {
            id: result.delivery.id,
            event: result.delivery.event,
            status: result.delivery.status,
            attempt: result.delivery.attempt,
            locale: result.locale,
            createdAt: result.delivery.createdAt,
            changed: result.changed,
          },
          status: 202,
          resourceId: result.delivery.id,
        };
      },
    },
  );
}
