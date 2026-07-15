import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import {
  presentAiConversation,
  requireAiAgent,
  requireAiConversation,
} from "@/lib/ai/conversations";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { agentChatUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteParams = { params: Promise<{ id: string; chatId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { id: agentId, chatId } = await params;
  return handleApi(
    request,
    { scopes: ["agents:read"], action: "agent.chat.read", resourceType: "agent_chat" },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId);
      const conversation = await requireAiConversation({
        organizationId: context.organizationId,
        conversationId: chatId,
        agentId,
      });
      return { data: presentAiConversation(conversation), resourceId: chatId };
    },
  );
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id: agentId, chatId } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.chat.update",
      resourceType: "agent_chat",
      idempotent: true,
    },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId);
      await requireAiConversation({
        organizationId: context.organizationId,
        conversationId: chatId,
        agentId,
      });
      const input = await parseJson(request, agentChatUpdateSchema);
      const [updated] = await db
        .update(aiConversations)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(aiConversations.id, chatId),
            eq(aiConversations.agentId, agentId),
            eq(aiConversations.organizationId, context.organizationId),
          ),
        )
        .returning();
      if (!updated) throw new ApiError(404, "not_found", "Konversation nicht gefunden.");
      return { data: presentAiConversation(updated), resourceId: chatId };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id: agentId, chatId } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.chat.delete",
      resourceType: "agent_chat",
      idempotent: true,
    },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId);
      await requireAiConversation({
        organizationId: context.organizationId,
        conversationId: chatId,
        agentId,
      });
      const [deleted] = await db
        .delete(aiConversations)
        .where(
          and(
            eq(aiConversations.id, chatId),
            eq(aiConversations.agentId, agentId),
            eq(aiConversations.organizationId, context.organizationId),
          ),
        )
        .returning({ id: aiConversations.id });
      if (!deleted) throw new ApiError(404, "not_found", "Konversation nicht gefunden.");
      return { data: { id: chatId, deleted: true }, resourceId: chatId };
    },
  );
}

