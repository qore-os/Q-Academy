"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getAiInitialSuggestions,
  getAiMemberCopy,
  resolveAiMemberApiError,
} from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";

export type AiConversationView = {
  id: string;
  agentId: string;
  agentVersionId: string;
  memberId: string;
  title: string | null;
  status: "active" | "archived";
  messageCount: number;
  lastMessageAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type AiMessageView = {
  id: string;
  chatId: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  citations: Array<{
    title: string;
    href?: string;
    courseId?: string;
    lessonId?: string;
    pageId?: string;
    excerpt?: string;
  }>;
  createdAt: string;
  isPending?: boolean;
};

export type AiAgentView = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  type: "learning_coach" | "knowledge_assistant" | "form_assistant";
  version: number;
};

export type AiAgentActionView = {
  id: string;
  agentVersionId: string;
  actionType:
    | "course_enrollment"
    | "course_unenrollment"
    | "group_membership_add"
    | "group_membership_remove"
    | "bundle_assignment_add"
    | "bundle_assignment_remove";
  target: { type: "course" | "group" | "bundle"; id: string };
  targetType: "course" | "group" | "bundle";
  targetId: string;
  targetLabel: string;
  courseId: string | null;
  courseTitle: string | null;
  label: string;
  description: string;
  state: "available" | "pending" | "granted" | "completed";
  request: null | {
    id: string;
    revision: number;
    status: "pending";
    expiresAt: string;
  };
};

export type AiTransparencyState = {
  required: boolean;
  acknowledgedAt: string | null;
  notice: {
    version: number;
    digest: string;
    title: string;
    description: string;
    warning: string;
    privacyPolicyUrl: string | null;
    transparencyPolicyUrl: string | null;
  };
};

type BootstrapResponse = {
  agent: AiAgentView;
  agents: AiAgentView[];
  conversations: AiConversationView[];
  activeConversationId: string | null;
  messages: AiMessageView[];
  transparency: AiTransparencyState;
};

type SendResponse = {
  message: string;
  suggestions: string[];
  conversation: AiConversationView;
  userMessage: AiMessageView;
  assistantMessage: AiMessageView;
};

class LocalizedAiError extends Error {
  constructor(readonly localizedCopy: string) {
    super("localized_ai_error");
  }
}

function localizedAiErrorCopy(error: unknown, fallback: string) {
  return error instanceof LocalizedAiError ? error.localizedCopy : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isAiTransparencyState(value: unknown): value is AiTransparencyState {
  const candidate = record(value);
  const notice = record(candidate?.notice);
  return Boolean(
    candidate &&
      typeof candidate.required === "boolean" &&
      (candidate.acknowledgedAt === null ||
        typeof candidate.acknowledgedAt === "string") &&
      notice &&
      typeof notice.version === "number" &&
      typeof notice.digest === "string" &&
      typeof notice.title === "string" &&
      typeof notice.description === "string" &&
      typeof notice.warning === "string" &&
      (notice.privacyPolicyUrl === null ||
        typeof notice.privacyPolicyUrl === "string") &&
      (notice.transparencyPolicyUrl === null ||
        typeof notice.transparencyPolicyUrl === "string"),
  );
}

function isBootstrapResponse(value: unknown): value is BootstrapResponse {
  const candidate = record(value);
  return Boolean(
    candidate &&
      record(candidate.agent) &&
      Array.isArray(candidate.agents) &&
      Array.isArray(candidate.conversations) &&
      Array.isArray(candidate.messages) &&
      isAiTransparencyState(candidate.transparency) &&
      (candidate.activeConversationId === null || typeof candidate.activeConversationId === "string"),
  );
}

function isSendResponse(value: unknown): value is SendResponse {
  const candidate = record(value);
  return Boolean(
    candidate &&
      typeof candidate.message === "string" &&
      Array.isArray(candidate.suggestions) &&
      candidate.suggestions.every(
        (suggestion) => typeof suggestion === "string",
      ) &&
      record(candidate.conversation) &&
      record(candidate.userMessage) &&
      record(candidate.assistantMessage),
  );
}

function aiAgentActions(value: unknown): AiAgentActionView[] | null {
  const data = record(value)?.data;
  if (!Array.isArray(data)) return null;
  return data.every((item) => {
    const candidate = record(item);
    return Boolean(
      candidate &&
        typeof candidate.id === "string" &&
        typeof candidate.agentVersionId === "string" &&
        [
          "course_enrollment",
          "course_unenrollment",
          "group_membership_add",
          "group_membership_remove",
          "bundle_assignment_add",
          "bundle_assignment_remove",
        ].includes(
          String(candidate.actionType),
        ) &&
        record(candidate.target) &&
        ["course", "group", "bundle"].includes(
          String(candidate.targetType),
        ) &&
        typeof candidate.targetId === "string" &&
        typeof candidate.targetLabel === "string" &&
        (candidate.courseId === null || typeof candidate.courseId === "string") &&
        (candidate.courseTitle === null ||
          typeof candidate.courseTitle === "string") &&
        typeof candidate.label === "string" &&
        typeof candidate.description === "string" &&
        ["available", "pending", "granted", "completed"].includes(
          String(candidate.state),
        ) &&
        (candidate.request === null || record(candidate.request)),
    );
  })
    ? (data as AiAgentActionView[])
    : null;
}

function uniqueSuggestions(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(
    0,
    3,
  );
}

export function useAiConversations({
  locale,
  enabled = true,
  initialAgentId,
}: { locale: AppLocale; enabled?: boolean; initialAgentId?: string }) {
  const copy = getAiMemberCopy(locale);
  const initialSuggestions = useMemo(
    () => getAiInitialSuggestions(locale),
    [locale],
  );
  const [agent, setAgent] = useState<AiAgentView | null>(null);
  const [agents, setAgents] = useState<AiAgentView[]>([]);
  const [conversations, setConversations] = useState<AiConversationView[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessageView[]>([]);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [actions, setActions] = useState<AiAgentActionView[]>([]);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [transparency, setTransparency] =
    useState<AiTransparencyState | null>(null);
  const [isAcknowledgingTransparency, setIsAcknowledgingTransparency] =
    useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  const loadActions = useCallback(async (agentId: string) => {
    try {
      const response = await fetch(
        `/api/ai/actions?agentId=${encodeURIComponent(agentId)}`,
        { cache: "no-store" },
      );
      const body: unknown = await response.json().catch(() => null);
      const parsed = response.ok ? aiAgentActions(body) : null;
      setActions(parsed ?? []);
    } catch {
      setActions([]);
    }
  }, []);

  const loadConversation = useCallback(async (
    conversationId?: string | null,
    agentId?: string | null,
  ) => {
    setIsBootstrapping(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (conversationId) query.set("conversationId", conversationId);
      if (agentId) query.set("agentId", agentId);
      const queryString = query.toString();
      const response = await fetch(
        `/api/ai${queryString ? `?${queryString}` : ""}`,
        { cache: "no-store" },
      );
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          setIsUnavailable(true);
        }
        throw new LocalizedAiError(
          resolveAiMemberApiError(response, copy, copy.errors.historyLoad),
        );
      }
      if (!isBootstrapResponse(data)) {
        throw new LocalizedAiError(copy.errors.historyFormat);
      }
      setIsUnavailable(false);
      setAgent(data.agent);
      setAgents(data.agents);
      setConversations(data.conversations);
      setActiveConversationId(data.activeConversationId);
      setMessages(data.messages);
      setTransparency(data.transparency);
      setSuggestions(initialSuggestions);
      setHasLoaded(true);
      void loadActions(data.agent.id);
    } catch (loadError) {
      setError(localizedAiErrorCopy(loadError, copy.errors.historyLoad));
    } finally {
      setIsBootstrapping(false);
    }
  }, [copy, initialSuggestions, loadActions]);

  useEffect(() => {
    if (!enabled || hasLoaded) return;
    const timeoutId = window.setTimeout(
      () => void loadConversation(null, initialAgentId),
      0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [enabled, hasLoaded, initialAgentId, loadConversation]);

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  );
  const selectedAgentId = agent?.id ?? null;

  useEffect(() => {
    if (
      !selectedAgentId ||
      !actions.some((item) => item.state === "pending")
    ) {
      return;
    }
    const intervalId = window.setInterval(
      () => void loadActions(selectedAgentId),
      10_000,
    );
    return () => window.clearInterval(intervalId);
  }, [actions, loadActions, selectedAgentId]);

  const startNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    setSuggestions(initialSuggestions);
    setError(null);
  }, [initialSuggestions]);

  const selectConversation = useCallback(
    async (conversationId: string) => {
      if (conversationId === activeConversationId && messages.length > 0) return;
      await loadConversation(conversationId, selectedAgentId);
    },
    [activeConversationId, loadConversation, messages.length, selectedAgentId],
  );

  const selectAgent = useCallback(
    async (agentId: string) => {
      if (agentId === selectedAgentId) return;
      setActiveConversationId(null);
      setMessages([]);
      setSuggestions(initialSuggestions);
      await loadConversation(null, agentId);
    },
    [initialSuggestions, loadConversation, selectedAgentId],
  );

  const sendMessage = useCallback(
    async (rawContent: string) => {
      const content = rawContent.trim();
      if (
        !content ||
        isSending ||
        activeConversation?.status === "archived" ||
        transparency?.required
      )
        return false;
      const pendingId = `pending-${Date.now()}`;
      setMessages((current) => [
        ...current,
        {
          id: pendingId,
          chatId: activeConversationId ?? "pending",
          role: "user",
          content,
          citations: [],
          createdAt: new Date().toISOString(),
          isPending: true,
        },
      ]);
      setSuggestions([]);
      setError(null);
      setIsSending(true);
      try {
        const response = await fetch("/api/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            conversationId: activeConversationId ?? undefined,
            agentId: selectedAgentId,
          }),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            setIsUnavailable(true);
          }
          throw new LocalizedAiError(
            resolveAiMemberApiError(
              response,
              copy,
              copy.errors.messageProcess,
            ),
          );
        }
        if (!isSendResponse(data)) {
          throw new LocalizedAiError(copy.errors.responseFormat);
        }
        setIsUnavailable(false);
        setMessages((current) => [
          ...current.filter((message) => message.id !== pendingId),
          data.userMessage,
          data.assistantMessage,
        ]);
        setActiveConversationId(data.conversation.id);
        setConversations((current) => [
          data.conversation,
          ...current.filter((conversation) => conversation.id !== data.conversation.id),
        ]);
        setSuggestions(uniqueSuggestions(data.suggestions));
        return true;
      } catch (sendError) {
        setMessages((current) => current.filter((message) => message.id !== pendingId));
        setError(localizedAiErrorCopy(sendError, copy.errors.messageProcess));
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [
      activeConversation?.status,
      activeConversationId,
      copy,
      isSending,
      selectedAgentId,
      transparency?.required,
    ],
  );

  const acknowledgeTransparency = useCallback(async () => {
    if (!transparency?.required || isAcknowledgingTransparency) return false;
    setIsAcknowledgingTransparency(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/transparency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noticeDigest: transparency.notice.digest }),
      });
      const body: unknown = await response.json().catch(() => null);
      const state = record(body)?.data;
      if (!response.ok) {
        throw new LocalizedAiError(
          resolveAiMemberApiError(
            response,
            copy,
            copy.errors.transparency,
          ),
        );
      }
      if (!isAiTransparencyState(state)) {
        throw new LocalizedAiError(copy.errors.transparency);
      }
      setTransparency(state);
      return true;
    } catch (acknowledgementError) {
      setError(
        localizedAiErrorCopy(acknowledgementError, copy.errors.transparency),
      );
      return false;
    } finally {
      setIsAcknowledgingTransparency(false);
    }
  }, [copy, isAcknowledgingTransparency, transparency]);

  const requestAction = useCallback(
    async (actionConfigurationId: string) => {
      if (!selectedAgentId || pendingActionId) return false;
      const selectedAction = actions.find(
        (candidate) => candidate.id === actionConfigurationId,
      );
      setPendingActionId(actionConfigurationId);
      setError(null);
      try {
        const response = await fetch("/api/ai/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agentId: selectedAgentId,
            actionConfigurationId,
            conversationId:
              activeConversation &&
              selectedAction?.agentVersionId === activeConversation.agentVersionId
                ? activeConversation.id
                : null,
          }),
        });
        await response.json().catch(() => null);
        if (!response.ok) {
          throw new LocalizedAiError(
            resolveAiMemberApiError(
              response,
              copy,
              copy.errors.actionRequest,
            ),
          );
        }
        await loadActions(selectedAgentId);
        return true;
      } catch (actionError) {
        setError(localizedAiErrorCopy(actionError, copy.errors.actionRequest));
        return false;
      } finally {
        setPendingActionId(null);
      }
    },
    [
      actions,
      activeConversation,
      copy,
      loadActions,
      pendingActionId,
      selectedAgentId,
    ],
  );

  const cancelAction = useCallback(
    async (requestId: string, expectedRevision: number) => {
      if (!selectedAgentId || pendingActionId) return false;
      setPendingActionId(requestId);
      setError(null);
      try {
        const response = await fetch(`/api/ai/actions/${requestId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision }),
        });
        await response.json().catch(() => null);
        if (!response.ok) {
          throw new LocalizedAiError(
            resolveAiMemberApiError(
              response,
              copy,
              copy.errors.actionCancel,
            ),
          );
        }
        await loadActions(selectedAgentId);
        return true;
      } catch (actionError) {
        setError(localizedAiErrorCopy(actionError, copy.errors.actionCancel));
        return false;
      } finally {
        setPendingActionId(null);
      }
    },
    [copy, loadActions, pendingActionId, selectedAgentId],
  );

  return {
    agent,
    agents,
    conversations,
    activeConversation,
    activeConversationId,
    messages,
    suggestions,
    actions,
    pendingActionId,
    isBootstrapping,
    isSending,
    isUnavailable,
    error,
    transparency,
    isAcknowledgingTransparency,
    acknowledgeTransparency,
    loadConversation,
    selectConversation,
    selectAgent,
    startNewConversation,
    sendMessage,
    requestAction,
    cancelAction,
  };
}
