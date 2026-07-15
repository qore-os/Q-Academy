import { z } from "zod";

import { listAiAgentActionEvents } from "@/lib/ai/agent-actions";
import { requireAiApiAdminActor } from "@/lib/ai/agent-studio";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return handleApi(
    request,
    {
      scopes: ["agents:read"],
      action: "agent.action.events.list",
      resourceType: "ai_agent_action_event",
    },
    async (context) => {
      await requireAiApiAdminActor({
        organizationId: context.organizationId,
        apiKeyId: context.apiKeyId,
      });
      const requestId = z.string().uuid().parse((await params).id);
      return {
        data: await listAiAgentActionEvents({
          organizationId: context.organizationId,
          requestId,
        }),
      };
    },
  );
}
