import { z } from "zod";

import {
  aiAgentActionCancelSchema,
  cancelAiAgentActionRequest,
  presentAiAgentActionRequest,
} from "@/lib/ai/agent-actions";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "agent.action.cancel" },
    async (user) => {
      const requestId = z.string().uuid().parse((await params).id);
      const cancellation = aiAgentActionCancelSchema.parse(
        await parseSessionJson(request, { maxBytes: 1_024 }),
      );
      const updated = await cancelAiAgentActionRequest({
        organizationId: user.organizationId,
        memberId: user.id,
        actor: { kind: "user", id: user.id, userId: user.id },
        requestId,
        cancellation,
      });
      return sessionData(request, presentAiAgentActionRequest(updated));
    },
  );
}
