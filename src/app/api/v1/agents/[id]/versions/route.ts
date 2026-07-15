import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { aiAgents, aiAgentVersions } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:read"],
      action: "agent.version.list",
      resourceType: "agent",
    },
    async (context) => {
      const [agent] = await db
        .select({
          id: aiAgents.id,
          draftVersionId: aiAgents.draftVersionId,
          publishedVersionId: aiAgents.publishedVersionId,
        })
        .from(aiAgents)
        .where(
          and(
            eq(aiAgents.id, id),
            eq(aiAgents.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!agent) {
        throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
      }
      const versions = await db
        .select({
          id: aiAgentVersions.id,
          version: aiAgentVersions.version,
          draftRevision: aiAgentVersions.draftRevision,
          state: aiAgentVersions.state,
          type: aiAgentVersions.type,
          name: aiAgentVersions.name,
          description: aiAgentVersions.description,
          systemPrompt: aiAgentVersions.systemPrompt,
          color: aiAgentVersions.color,
          icon: aiAgentVersions.icon,
          knowledgeMode: aiAgentVersions.knowledgeMode,
          accessMode: aiAgentVersions.accessMode,
          publishedAt: aiAgentVersions.publishedAt,
          createdAt: aiAgentVersions.createdAt,
          updatedAt: aiAgentVersions.updatedAt,
        })
        .from(aiAgentVersions)
        .where(
          and(
            eq(aiAgentVersions.agentId, id),
            eq(aiAgentVersions.organizationId, context.organizationId),
          ),
        )
        .orderBy(asc(aiAgentVersions.version));
      return {
        data: {
          id,
          draftVersionId: agent.draftVersionId,
          publishedVersionId: agent.publishedVersionId,
          versions,
        },
        resourceId: id,
      };
    },
  );
}
