import {
  getAiAgentVersionKnowledgeContext,
  listAiMessages,
  presentAiMessage,
  presentAiMessageForCurrentAccess,
  requireAiAgent,
  requireAiConversation,
  sendAiConversationMessage,
} from "@/lib/ai/conversations";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { chatMessageCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteParams = { params: Promise<{ id: string; chatId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { id: agentId, chatId } = await params;
  return handleApi(
    request,
    { scopes: ["agents:read"], action: "agent.chat.message.list", resourceType: "ai_message" },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId);
      const conversation = await requireAiConversation({
        organizationId: context.organizationId,
        conversationId: chatId,
        agentId,
      });
      const pagination = parsePagination(new URL(request.url));
      const [rows, courseContext] = await Promise.all([
        listAiMessages({
          organizationId: context.organizationId,
          conversationId: chatId,
          limit: pagination.limit,
          offset: pagination.offset,
        }),
        getAiAgentVersionKnowledgeContext({
          organizationId: context.organizationId,
          userId: conversation.userId,
          agentId: conversation.agentId,
          agentVersionId: conversation.agentVersionId,
        }),
      ]);
      const hasMore = rows.length > pagination.limit;
      const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(
        (message) =>
          presentAiMessageForCurrentAccess(message, courseContext.courses),
      );
      return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
    },
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id: agentId, chatId } = await params;
  return handleApi(
    request,
    {
      scopes: ["agents:write"],
      action: "agent.chat.message.create",
      resourceType: "ai_message",
      idempotent: true,
    },
    async (context) => {
      await requireAiAgent(context.organizationId, agentId, { active: true });
      await requireAiConversation({
        organizationId: context.organizationId,
        conversationId: chatId,
        agentId,
      });
      const input = await parseJson(request, chatMessageCreateSchema);
      const result = await sendAiConversationMessage({
        organizationId: context.organizationId,
        conversationId: chatId,
        content: input.content,
        metadata: input.metadata,
      });
      return {
        data: presentAiMessage(result.assistantMessage),
        status: 201,
        resourceId: result.assistantMessage.id,
      };
    },
  );
}
