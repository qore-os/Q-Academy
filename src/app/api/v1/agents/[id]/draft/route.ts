import {
  requireAiApiAdminActor,
  updateAiAgentDraft,
} from "@/lib/ai/agent-studio";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentDraftUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.draft.update",
      resourceType: "agent",
      idempotent: true,
    },
    async (context) => {
      const [actor, draft] = await Promise.all([
        requireAiApiAdminActor({
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
        parseJson(request, agentDraftUpdateSchema),
      ]);
      const updated = await updateAiAgentDraft({ actor, agentId: id, draft });
      await enqueueWebhook(context.organizationId, "agent.updated", {
        id,
        mutation: "draft_updated",
        draftVersionId: updated.id,
        draftVersion: updated.version,
        draftRevision: updated.draftRevision,
      });
      return {
        data: updated,
        resourceId: id,
      };
    },
  );
}
