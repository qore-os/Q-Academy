import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { n8nTriggerSchema } from "@/lib/commerce/model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleTransactionalApiCommand(request, {
    scopes: ["automations:write"],
    action: "automation.n8n.trigger",
    resourceType: "automation_workflow",
    idempotent: true,
  }, {
    prepare: async () => parseJson(request, n8nTriggerSchema),
    execute: async ({ context, activity, webhook }, input) => {
      const triggerId = crypto.randomUUID();
      const payload = {
        triggerId,
        eventKey: input.eventKey,
        data: input.data,
      };
      const deliveries = await webhook("automation.n8n.triggered", payload);
      await activity({
        type: "automation.n8n.triggered",
        entityType: "automation_workflow",
        entityId: triggerId,
        metadata: { eventKey: input.eventKey, deliveryCount: deliveries.length },
      });
      return {
        data: {
          triggerId,
          eventKey: input.eventKey,
          deliveryCount: deliveries.length,
          organizationId: context.organizationId,
        },
        status: 202,
        resourceId: triggerId,
      };
    },
  });
}
