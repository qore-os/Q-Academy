import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  createAiConversation,
  deleteEmptyAiConversation,
  getAiAgentVersionKnowledgeContext,
  listAiConversations,
  listRecentAiMessages,
  presentAiConversation,
  presentAiMessage,
  presentAiMessageForCurrentAccess,
  requireAiConversation,
  sendAiConversationMessage,
} from "@/lib/ai/conversations";
import {
  getDefaultAccessiblePublishedAiAgent,
  listAccessiblePublishedAiAgents,
  requireAccessiblePublishedAiAgent,
} from "@/lib/ai/agent-studio";
import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { ApiError } from "@/lib/api/errors";
import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
} from "@/lib/bounded-json-request";
import { logServerError } from "@/lib/server-error-logging";
import { getAiTransparencyState } from "@/lib/ai/transparency";

export const dynamic = "force-dynamic";

const AI_MESSAGE_JSON_MAX_BYTES = 1024 * 1024;

const messageSchema = z
  .object({
    message: z.string().trim().min(1, "Bitte gib eine Nachricht ein.").max(10_000),
    conversationId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(10_000),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    const resetAt =
      error.status === 429 &&
      error.details &&
      typeof error.details === "object" &&
      "resetAt" in error.details
        ? new Date(String((error.details as { resetAt: unknown }).resetAt))
        : null;
    const headers =
      resetAt && Number.isFinite(resetAt.getTime())
        ? { "Retry-After": String(retryAfterSeconds(resetAt)) }
        : undefined;
    return json(
      { error: error.message, code: error.code },
      { status: error.status, headers },
    );
  }
  logServerError(error, { action: "qcoach.request" });
  return json(
    { error: "Der Lernbegleiter ist gerade nicht erreichbar. Bitte versuche es erneut." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId");
    const requestedAgentId = url.searchParams.get("agentId");
    if (conversationId && !z.string().uuid().safeParse(conversationId).success) {
      return json({ error: "conversationId muss eine gueltige UUID sein." }, { status: 400 });
    }
    if (requestedAgentId && !z.string().uuid().safeParse(requestedAgentId).success) {
      return json({ error: "agentId muss eine gueltige UUID sein." }, { status: 400 });
    }
    const accessibleAgents = await listAccessiblePublishedAiAgents({
      organizationId: user.organizationId,
      userId: user.id,
    });
    const agent = requestedAgentId
      ? await requireAccessiblePublishedAiAgent({
          organizationId: user.organizationId,
          userId: user.id,
          agentId: requestedAgentId,
        })
      : await getDefaultAccessiblePublishedAiAgent({
          organizationId: user.organizationId,
          userId: user.id,
        });
    const conversationRows = await listAiConversations(user.organizationId, {
      agentId: agent.agentId,
      userId: user.id,
      limit: 50,
      offset: 0,
    });
    const conversations = conversationRows.slice(0, 50);
    const transparency = await getAiTransparencyState({
      organizationId: user.organizationId,
      userId: user.id,
    });
    const selectedConversationId =
      conversationId ?? conversations.find((conversation) => conversation.status === "active")?.id ?? conversations[0]?.id ?? null;
    let messages: ReturnType<typeof presentAiMessage>[] = [];
    if (selectedConversationId) {
      const conversation = await requireAiConversation({
        organizationId: user.organizationId,
        conversationId: selectedConversationId,
        agentId: agent.agentId,
        userId: user.id,
      });
      const rows = await listRecentAiMessages({
        organizationId: user.organizationId,
        conversationId: selectedConversationId,
        limit: 100,
      });
      const knowledge = await getAiAgentVersionKnowledgeContext({
        organizationId: user.organizationId,
        userId: user.id,
        agentId: conversation.agentId,
        agentVersionId: conversation.agentVersionId,
      });
      messages = rows.map((message) =>
        presentAiMessageForCurrentAccess(message, knowledge.courses),
      );
    }

    return json({
      agent: {
        id: agent.agentId,
        name: agent.name,
        description: agent.description,
        color: agent.color,
        icon: agent.icon,
        type: agent.type,
        version: agent.version,
      },
      agents: accessibleAgents.map((candidate) => ({
        id: candidate.agentId,
        name: candidate.name,
        description: candidate.description,
        color: candidate.color,
        icon: candidate.icon,
        type: candidate.type,
        version: candidate.version,
      })),
      conversations: conversations.map(presentAiConversation),
      activeConversationId: selectedConversationId,
      messages,
      transparency,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich erneut an." }, { status: 401 });

  let body: unknown;
  try {
    body = await parseBoundedJsonRequest(request, {
      maxBytes: AI_MESSAGE_JSON_MAX_BYTES,
    });
  } catch (error) {
    if (
      error instanceof BoundedJsonRequestError &&
      error.reason === "too_large"
    ) {
      return json({ error: "Die Anfrage ist zu gross." }, { status: 413 });
    }
    if (!(error instanceof BoundedJsonRequestError)) throw error;
    return json({ error: "Die Anfrage enthaelt kein gueltiges JSON." }, { status: 400 });
  }
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Die Anfrage ist ungueltig." },
      { status: 400 },
    );
  }

  const rateIdentifier = `${user.organizationId}\0${user.id}`;
  let concurrencyClaimed = false;
  let concurrencyResetAt: Date | null = null;
  let conversationCreatedForRequest: string | null = null;
  try {
    const concurrent = await consumePersistentRateLimit({
      action: "ai_message_concurrent",
      identifier: rateIdentifier,
    });
    if (concurrent.limited) {
      return json(
        {
          error:
            "Eine andere Q-Coach-Antwort wird noch erstellt. Bitte warte kurz.",
          code: "rate_limit_exceeded",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds(concurrent.resetAt)),
          },
        },
      );
    }
    concurrencyClaimed = true;
    concurrencyResetAt = concurrent.resetAt;

    const quota = await consumeGuardedPersistentRateLimit({
      guards: [
        {
          action: "ai_message_tenant",
          identifier: user.organizationId,
        },
      ],
      primary: {
        action: "ai_message",
        identifier: rateIdentifier,
      },
    });
    if (quota.limited) {
      return json(
        {
          error: "Das Q-Coach-Limit ist erreicht. Bitte versuche es spaeter erneut.",
          code: "rate_limit_exceeded",
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds(quota.resetAt)),
          },
        },
      );
    }

    let conversation;
    if (parsed.data.conversationId) {
      conversation = await requireAiConversation({
        organizationId: user.organizationId,
        conversationId: parsed.data.conversationId,
        userId: user.id,
        agentId: parsed.data.agentId,
      });
      await requireAccessiblePublishedAiAgent({
        organizationId: user.organizationId,
        userId: user.id,
        agentId: conversation.agentId,
      });
    } else {
      const agent = parsed.data.agentId
        ? await requireAccessiblePublishedAiAgent({
            organizationId: user.organizationId,
            userId: user.id,
            agentId: parsed.data.agentId,
          })
        : await getDefaultAccessiblePublishedAiAgent({
            organizationId: user.organizationId,
            userId: user.id,
          });
      conversation = await createAiConversation({
        organizationId: user.organizationId,
        agentId: agent.agentId,
        userId: user.id,
        metadata: { source: "member_ui" },
      });
      conversationCreatedForRequest = conversation.id;
    }

    const result = await sendAiConversationMessage({
      organizationId: user.organizationId,
      conversationId: conversation.id,
      content: parsed.data.message,
      metadata: { source: "member_ui" },
    });
    return json({
      message: result.assistantMessage.content,
      suggestions: result.suggestions,
      conversation: presentAiConversation(result.conversation),
      userMessage: presentAiMessage(result.userMessage),
      assistantMessage: presentAiMessage(result.assistantMessage),
    });
  } catch (error) {
    if (conversationCreatedForRequest) {
      try {
        await deleteEmptyAiConversation({
          organizationId: user.organizationId,
          conversationId: conversationCreatedForRequest,
          userId: user.id,
        });
      } catch (cleanupError) {
        logServerError(cleanupError, { action: "qcoach.empty_conversation.cleanup" });
      }
    }
    return errorResponse(error);
  } finally {
    if (concurrencyClaimed && concurrencyResetAt) {
      try {
        await clearPersistentRateLimit({
          action: "ai_message_concurrent",
          identifier: rateIdentifier,
          expectedResetAt: concurrencyResetAt,
        });
      } catch (error) {
        logServerError(error, { action: "qcoach.concurrency.release" });
      }
    }
  }
}
