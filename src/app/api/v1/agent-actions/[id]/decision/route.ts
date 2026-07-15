import { z } from "zod";

import {
  decideAiAgentActionRequest,
  presentAiAgentActionRequest,
} from "@/lib/ai/agent-actions";
import { requireAiApiAdminActor } from "@/lib/ai/agent-studio";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentActionDecisionSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.action.decide",
      resourceType: "ai_agent_action_request",
      idempotent: true,
    },
    async (context) => {
      const [actor, input, requestId] = await Promise.all([
        requireAiApiAdminActor({
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
        parseJson(request, agentActionDecisionSchema),
        params.then((value) => z.string().uuid().parse(value.id)),
      ]);
      const result = await decideAiAgentActionRequest({
        organizationId: context.organizationId,
        actorId: actor.id,
        actor: {
          kind: "api_key",
          id: context.apiKeyId,
          userId: actor.id,
        },
        requestId,
        decision: input,
      });
      return {
        data: presentAiAgentActionRequest(result),
        resourceId: result.id,
      };
    },
  );
}
