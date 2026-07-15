import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { aiAgents, aiAgentVersions } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

export type ContentBlockAiAgentTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const agentIdSchema = z.string().uuid();

function aiAgentId(type: string, data: unknown) {
  if (type !== "ai_agent") return null;
  const candidate =
    data && typeof data === "object"
      ? (data as Record<string, unknown>).agentId
      : undefined;
  const parsed = agentIdSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      "KI-Agent-Bloecke benoetigen einen gueltigen veroeffentlichten Agenten.",
    );
  }
  return parsed.data;
}

export async function assertPublishedAiAgentContentBlock(input: {
  transaction: ContentBlockAiAgentTransaction;
  organizationId: string;
  type: string;
  data: unknown;
}) {
  const id = aiAgentId(input.type, input.data);
  if (!id) return null;

  const [agent] = await assertPublishedAiAgentReferences({
    transaction: input.transaction,
    organizationId: input.organizationId,
    agentIds: [id],
  });
  return agent;
}

export async function assertPublishedAiAgentReferences(input: {
  transaction: ContentBlockAiAgentTransaction;
  organizationId: string;
  agentIds: readonly string[];
}) {
  const ids = [
    ...new Set(input.agentIds.map((id) => agentIdSchema.parse(id))),
  ];
  if (ids.length === 0) return [];

  const agents = await input.transaction
    .select({
      id: aiAgents.id,
      name: aiAgentVersions.name,
      version: aiAgentVersions.version,
    })
    .from(aiAgents)
    .innerJoin(
      aiAgentVersions,
      and(
        eq(aiAgentVersions.id, aiAgents.publishedVersionId),
        eq(aiAgentVersions.agentId, aiAgents.id),
        eq(aiAgentVersions.organizationId, aiAgents.organizationId),
        eq(aiAgentVersions.state, "published"),
      ),
    )
    .where(
      and(
        inArray(aiAgents.id, ids),
        eq(aiAgents.organizationId, input.organizationId),
        eq(aiAgents.active, true),
      ),
    )
    .for("share");

  if (agents.length !== ids.length) {
    throw new ApiError(
      422,
      "validation_error",
      "Der KI-Agent ist nicht aktiv veroeffentlicht oder gehoert nicht zur Organisation.",
    );
  }
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return ids.map((id) => byId.get(id)!);
}
