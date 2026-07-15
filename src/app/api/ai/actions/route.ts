import { z } from "zod";

import {
  createAiAgentActionRequest,
  listAvailableAiAgentActionsForMember,
  presentAiAgentActionRequest,
} from "@/lib/ai/agent-actions";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    agentId: z.string().uuid(),
    actionConfigurationId: z.string().uuid(),
    conversationId: z.string().uuid().nullable().optional(),
  })
  .strict();

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "agent.action.available.list" },
    async (user) => {
      const parsedAgentId = z
        .string()
        .uuid()
        .safeParse(new URL(request.url).searchParams.get("agentId"));
      if (!parsedAgentId.success) {
        return Response.json(
          { error: "agentId muss eine gueltige UUID sein." },
          { status: 400 },
        );
      }
      const actions = await listAvailableAiAgentActionsForMember({
        organizationId: user.organizationId,
        memberId: user.id,
        agentId: parsedAgentId.data,
      });
      return sessionData(request, actions);
    },
  );
}

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "agent.action.request" },
    async (user) => {
      const input = createSchema.parse(
        await parseSessionJson(request, { maxBytes: 2_048 }),
      );
      const result = await createAiAgentActionRequest({
        organizationId: user.organizationId,
        actor: { kind: "user", id: user.id, userId: user.id },
        request: { ...input, memberId: user.id },
      });
      return sessionData(
        request,
        {
          request: presentAiAgentActionRequest(result.request),
          created: result.created,
        },
        result.created ? 201 : 200,
      );
    },
  );
}
