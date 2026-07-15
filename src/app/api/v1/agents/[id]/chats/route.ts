import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { agentChatCreateSchema } from "@/lib/api/schemas";
import {
  createAiConversation,
  deleteEmptyAiConversation,
  getApiActorUserId,
  listAiConversations,
  presentAiConversation,
  requireAiAgent,
  sendAiConversationMessage,
} from "@/lib/ai/conversations";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  return handleApi(
    request,
    { scopes: ["agents:read"], action: "agent.chat.list", resourceType: "agent_chat" },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId);
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const status = url.searchParams.get("status");
      if (status && status !== "active" && status !== "archived") {
        throw new ApiError(400, "bad_request", "status muss active oder archived sein.");
      }
      const memberId = url.searchParams.get("memberId") ?? undefined;
      const rows = await listAiConversations(context.organizationId, {
        agentId,
        userId: memberId,
        status: status === "active" || status === "archived" ? status : undefined,
        limit: pagination.limit,
        offset: pagination.offset,
      });
      const hasMore = rows.length > pagination.limit;
      const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(presentAiConversation);
      return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
    },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.chat.create",
      resourceType: "agent_chat",
      idempotent: true,
    },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId, { active: true });
      const input = await parseJson(request, agentChatCreateSchema);
      const userId = input.memberId ?? (await getApiActorUserId(context.organizationId, context.apiKeyId));
      let createdConversation: Awaited<ReturnType<typeof createAiConversation>> | null = null;
      try {
        let conversation = await createAiConversation({
          organizationId: context.organizationId,
          agentId,
          userId,
          title: input.title,
          metadata: input.metadata,
        });
        createdConversation = conversation;
        if (input.initialMessage) {
          const result = await sendAiConversationMessage({
            organizationId: context.organizationId,
            conversationId: conversation.id,
            content: input.initialMessage,
            metadata: { source: "agent_chat_create" },
          });
          conversation = result.conversation;
        }
        return {
          data: presentAiConversation(conversation),
          status: 201,
          resourceId: conversation.id,
        };
      } catch (error) {
        if (createdConversation) {
          try {
            await deleteEmptyAiConversation({
              organizationId: context.organizationId,
              conversationId: createdConversation.id,
              userId,
            });
          } catch (cleanupError) {
            logServerError(cleanupError, {
              action: "api.agent_chat.empty_conversation.cleanup",
            });
          }
        }
        throw error;
      }
    },
  );
}
