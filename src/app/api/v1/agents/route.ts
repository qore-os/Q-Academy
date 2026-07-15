import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { aiAgents } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { agentCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  createAiAgentDraftIdentity,
  requireAiApiAdminActor,
} from "@/lib/ai/agent-studio";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["agents:read"], action: "agent.list", resourceType: "agent" },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const conditions: SQL[] = [eq(aiAgents.organizationId, context.organizationId)];
      const search = url.searchParams.get("search")?.trim();
      const active = url.searchParams.get("active");
      const icon = url.searchParams.get("icon")?.trim();

      if (search) {
        conditions.push(
          or(
            ilike(aiAgents.name, `%${search}%`),
            ilike(aiAgents.description, `%${search}%`),
          )!,
        );
      }
      if (active === "true" || active === "false") {
        conditions.push(eq(aiAgents.active, active === "true"));
      }
      if (icon) conditions.push(eq(aiAgents.icon, icon));

      const sort = url.searchParams.get("sort") ?? "createdAt:desc";
      const order =
        sort === "name:asc"
          ? asc(aiAgents.name)
          : sort === "name:desc"
            ? desc(aiAgents.name)
            : sort === "createdAt:asc"
              ? asc(aiAgents.createdAt)
              : desc(aiAgents.createdAt);
      const rows = await db
        .select({
          id: aiAgents.id,
          name: aiAgents.name,
          description: aiAgents.description,
          systemPrompt: aiAgents.systemPrompt,
          color: aiAgents.color,
          icon: aiAgents.icon,
          active: aiAgents.active,
          createdAt: aiAgents.createdAt,
        })
        .from(aiAgents)
        .where(and(...conditions))
        .orderBy(order, asc(aiAgents.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;

      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    { scopes: ["agents:write"], action: "agent.create", resourceType: "agent", idempotent: true },
    async (context) => {
      const input = await parseJson(request, agentCreateSchema);
      const actor = await requireAiApiAdminActor({
        organizationId: context.organizationId,
        apiKeyId: context.apiKeyId,
      });
      const created = await createAiAgentDraftIdentity({
        actor,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        color: input.color,
        icon: input.icon,
        publish: input.active,
        active: input.active,
      });
      const data = {
        id: created.agentId,
        draftVersionId: created.draft.id,
        published: input.active,
        active: input.active,
      };
      await enqueueWebhook(context.organizationId, "agent.updated", {
        ...data,
        mutation: "created",
      });

      return { data, status: 201, resourceId: created.agentId };
    },
  );
}
