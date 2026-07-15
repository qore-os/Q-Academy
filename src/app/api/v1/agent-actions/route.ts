import { z } from "zod";

import {
  createAiAgentActionRequest,
  listAiAgentActionRequests,
  presentAiAgentActionRequest,
} from "@/lib/ai/agent-actions";
import { requireAiApiAdminActor } from "@/lib/ai/agent-studio";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentActionRequestCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const statusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
]);

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["agents:read"],
      action: "agent.action.list",
      resourceType: "ai_agent_action_request",
    },
    async (context) => {
      await requireAiApiAdminActor({
        organizationId: context.organizationId,
        apiKeyId: context.apiKeyId,
      });
      const url = new URL(request.url);
      const statusValue = url.searchParams.get("status");
      const status = statusValue ? statusSchema.parse(statusValue) : undefined;
      const memberValue = url.searchParams.get("memberId");
      const agentValue = url.searchParams.get("agentId");
      const memberId = memberValue ? z.string().uuid().parse(memberValue) : undefined;
      const agentId = agentValue ? z.string().uuid().parse(agentValue) : undefined;
      const rows = await listAiAgentActionRequests({
        organizationId: context.organizationId,
        status,
        memberId,
        agentId,
        limit: 250,
      });
      return {
        data: rows.map((row) => {
          const requestProjection = presentAiAgentActionRequest(row.request);
          const targetLabel =
            row.request.targetType === "course"
              ? row.courseTitle
              : row.request.targetType === "group"
                ? row.groupName
                : row.bundleName;
          return {
            ...requestProjection,
            member: {
              id: row.request.requestedById,
              firstName: row.memberFirstName,
              lastName: row.memberLastName,
              email: row.memberEmail,
            },
            agent: {
              id: row.request.agentId,
              name: row.agentName,
              version: row.agentVersion,
            },
            target: {
              ...requestProjection.target,
              label: targetLabel,
            },
            course:
              row.request.targetType === "course"
                ? {
                    id: row.request.targetCourseId,
                    title: row.courseTitle,
                  }
                : null,
          };
        }),
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.action.request",
      resourceType: "ai_agent_action_request",
      idempotent: true,
    },
    async (context) => {
      const [actor, input] = await Promise.all([
        requireAiApiAdminActor({
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
        parseJson(request, agentActionRequestCreateSchema),
      ]);
      const result = await createAiAgentActionRequest({
        organizationId: context.organizationId,
        actor: {
          kind: "api_key",
          id: context.apiKeyId,
          userId: actor.id,
        },
        request: input,
      });
      return {
        data: presentAiAgentActionRequest(result.request),
        status: result.created ? 201 : 200,
        resourceId: result.request.id,
      };
    },
  );
}
