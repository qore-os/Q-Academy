import {
  publishAiAgentDraft,
  requireAiApiAdminActor,
} from "@/lib/ai/agent-studio";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentPublishSchema } from "@/lib/api/schemas";
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
      action: "agent.version.publish",
      resourceType: "agent",
      idempotent: true,
    },
    async (context) => {
      const [actor, publication] = await Promise.all([
        requireAiApiAdminActor({
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
        parseJson(request, agentPublishSchema),
      ]);
      const result = await publishAiAgentDraft({
        actor,
        agentId: id,
        publication,
      });
      const data = {
        id,
        publishedVersionId: result.published.id,
        publishedVersion: result.published.version,
        draftVersionId: result.nextDraft.id,
        draftVersion: result.nextDraft.version,
        draftRevision: result.nextDraft.draftRevision,
      };
      await enqueueWebhook(context.organizationId, "agent.updated", {
        ...data,
        mutation: "published",
      });
      return { data, resourceId: id };
    },
  );
}
