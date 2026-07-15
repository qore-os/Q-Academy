import {
  requireAiApiAdminActor,
  rollbackAiAgentVersion,
} from "@/lib/ai/agent-studio";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentRollbackSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";

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
      scopes: ["agents:write"],
      action: "agent.version.rollback",
      resourceType: "agent",
      idempotent: true,
    },
    async (context) => {
      const [actor, rollback] = await Promise.all([
        requireAiApiAdminActor({
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
        parseJson(request, agentRollbackSchema),
      ]);
      const version = await rollbackAiAgentVersion({
        actor,
        agentId: id,
        rollback,
      });
      const data = {
        id,
        publishedVersionId: version.id,
        publishedVersion: version.version,
      };
      await enqueueWebhook(context.organizationId, "agent.updated", {
        ...data,
        mutation: "rolled_back",
      });
      return { data, resourceId: id };
    },
  );
}
