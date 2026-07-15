import { and, count, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { aiAgents, aiConversations } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireAiApiAdminActor } from "@/lib/ai/agent-studio";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function agentForOrganization(id: string, organizationId: string) {
  const [agent] = await db
    .select()
    .from(aiAgents)
    .where(and(eq(aiAgents.id, id), eq(aiAgents.organizationId, organizationId)))
    .limit(1);
  if (!agent) throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
  return agent;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["agents:read"], action: "agent.read", resourceType: "agent" },
    async (context) => ({
      data: await agentForOrganization(id, context.organizationId),
      resourceId: id,
    }),
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["agents:write"], action: "agent.update", resourceType: "agent", idempotent: true },
    async (context) => {
      await requireAiApiAdminActor({
        organizationId: context.organizationId,
        apiKeyId: context.apiKeyId,
      });
      const input = await parseJson(request, agentUpdateSchema);
      const draftFields = Object.keys(input).filter((field) => field !== "active");
      if (draftFields.length > 0) {
        throw new ApiError(
          409,
          "conflict",
          "Agentenkonfigurationen werden versioniert. Verwende PUT /api/v1/agents/{id}/draft mit Draft-ID und Revision.",
          { reason: "versioned_agent_configuration" },
        );
      }
      if (input.active === undefined) {
        throw new ApiError(
          422,
          "validation_error",
          "active ist fuer diesen Endpunkt erforderlich.",
        );
      }
      const updated = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`ai-agents:${context.organizationId}`}))`,
        );
        const [current] = await tx
          .select()
          .from(aiAgents)
          .where(
            and(
              eq(aiAgents.id, id),
              eq(aiAgents.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        if (!current) {
          throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
        }

        if (input.active && !current.publishedVersionId) {
          throw new ApiError(
            409,
            "conflict",
            "Veroeffentliche zuerst eine Agentenversion, bevor du den Agenten aktivierst.",
            { reason: "agent_unpublished" },
          );
        }

        if (current.active && input.active === false) {
          const [alternatives] = await tx
            .select({ value: count() })
            .from(aiAgents)
            .where(
              and(
                eq(aiAgents.organizationId, context.organizationId),
                eq(aiAgents.active, true),
                sql`${aiAgents.publishedVersionId} is not null`,
                ne(aiAgents.id, current.id),
              ),
            );
          if (Number(alternatives?.value ?? 0) === 0) {
            throw new ApiError(
              409,
              "conflict",
              "Der letzte aktive KI-Agent kann nicht pausiert werden. Aktiviere zuerst eine Alternative.",
              { reason: "last_active_agent" },
            );
          }
        }

        const [record] = await tx
          .update(aiAgents)
          .set({ active: input.active })
          .where(
            and(
              eq(aiAgents.id, id),
              eq(aiAgents.organizationId, context.organizationId),
            ),
          )
          .returning();
        if (!record) {
          throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
        }
        return record;
      });
      await enqueueWebhook(context.organizationId, "agent.updated", { ...updated, mutation: "updated" });

      return { data: updated, resourceId: id };
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["agents:write"], action: "agent.delete", resourceType: "agent", idempotent: true },
    async (context) => {
      await requireAiApiAdminActor({
        organizationId: context.organizationId,
        apiKeyId: context.apiKeyId,
      });
      const deleted = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`ai-agents:${context.organizationId}`}))`,
        );
        const [current] = await tx
          .select()
          .from(aiAgents)
          .where(
            and(
              eq(aiAgents.id, id),
              eq(aiAgents.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        if (!current) {
          throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
        }

        const [usage] = await tx
          .select({ value: count() })
          .from(aiConversations)
          .where(
            and(
              eq(aiConversations.organizationId, context.organizationId),
              eq(aiConversations.agentId, current.id),
            ),
          );
        const conversationCount = Number(usage?.value ?? 0);
        if (conversationCount > 0) {
          throw new ApiError(
            409,
            "conflict",
            "Der KI-Agent hat gespeicherte Konversationen und kann nicht geloescht werden. Pausiere ihn stattdessen.",
            { reason: "agent_in_use", conversationCount },
          );
        }

        if (current.publishedVersionId) {
          throw new ApiError(
            409,
            "conflict",
            "Veroeffentlichte KI-Agenten bleiben fuer Audit und bestehende Chats erhalten. Pausiere den Agenten stattdessen.",
            { reason: "published_agent_immutable" },
          );
        }

        if (current.active) {
          const [alternatives] = await tx
            .select({ value: count() })
            .from(aiAgents)
            .where(
              and(
                eq(aiAgents.organizationId, context.organizationId),
                eq(aiAgents.active, true),
                ne(aiAgents.id, current.id),
              ),
            );
          if (Number(alternatives?.value ?? 0) === 0) {
            throw new ApiError(
              409,
              "conflict",
              "Der letzte aktive KI-Agent kann nicht geloescht werden. Aktiviere zuerst eine Alternative.",
              { reason: "last_active_agent" },
            );
          }
        }

        const [record] = await tx
          .delete(aiAgents)
          .where(
            and(
              eq(aiAgents.id, current.id),
              eq(aiAgents.organizationId, context.organizationId),
            ),
          )
          .returning();
        if (!record) {
          throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
        }
        return record;
      });
      await enqueueWebhook(context.organizationId, "agent.updated", { ...deleted, mutation: "deleted" });

      return { data: { id, deleted: true }, resourceId: id };
    },
  );
}
