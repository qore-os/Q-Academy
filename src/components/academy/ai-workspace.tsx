"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  AlertCircle,
  Archive,
  Bot,
  History,
  LoaderCircle,
  MessageSquare,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { AiAgentActionList } from "@/components/academy/ai-agent-action-list";
import { AiTransparencyNotice } from "@/components/academy/ai-transparency-notice";
import { useAiConversations, type AiMessageView } from "@/components/academy/use-ai-conversations";
import { safeInternalAcademyHref } from "@/lib/ai/citations";
import {
  formatAiConversationDate,
  getAiMemberCopy,
} from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

function MessageBubble({
  message,
  curatedSource,
}: {
  message: AiMessageView;
  curatedSource: string;
}) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-end gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <span className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
          <Bot aria-hidden="true" className="size-4" />
        </span>
      ) : null}
      <div className={`max-w-[min(42rem,86%)] ${isUser ? "items-end" : "items-start"}`}>
        <p
          className={`whitespace-pre-wrap rounded-md px-3.5 py-3 text-sm leading-6 ${
            isUser
              ? "bg-[#17324d] text-white"
              : "border border-[#dfe5e8] bg-white text-[#243b4a]"
          } ${message.isPending ? "opacity-65" : ""}`}
        >
          {message.content}
        </p>
        {!isUser && message.citations.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.citations.map((citation) => {
              const href = safeInternalAcademyHref(citation.href);
              return href ? (
                <a
                  key={`${message.id}-${citation.pageId ?? citation.lessonId ?? citation.courseId ?? citation.title}`}
                  href={href}
                  className="focus-ring rounded-md border border-[#c9dedb] bg-[#f5fbfa] px-2 py-1 text-[11px] font-medium text-[#176e68] hover:border-[#2bb7a9]"
                >
                  {citation.title}
                </a>
              ) : (
                <span
                  key={`${message.id}-${citation.courseId ?? citation.title}`}
                  className="rounded-md border border-[#d9e1e5] bg-[#f7f9fa] px-2 py-1 text-[11px] font-medium text-[#52606d]"
                  title={curatedSource}
                >
                  {citation.title}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function AiWorkspace({ locale }: { locale: AppLocale }) {
  const copy = getAiMemberCopy(locale);
  const {
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
    error,
    transparency,
    isAcknowledgingTransparency,
    acknowledgeTransparency,
    selectConversation,
    selectAgent,
    startNewConversation,
    sendMessage,
    requestAction,
    cancelAction,
  } = useAiConversations({ locale });
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [isSending, messages]);

  async function submit(rawContent?: string) {
    const content = (rawContent ?? draft).trim();
    if (!content || isSending) return;
    setDraft("");
    const sent = await sendMessage(content);
    if (!sent) setDraft(content);
    inputRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  const archived = activeConversation?.status === "archived";

  return (
    <section className="grid min-h-[36rem] min-w-0 grid-cols-[minmax(0,1fr)] overflow-hidden rounded-md border border-[#dce3e7] bg-white shadow-sm lg:h-[calc(100dvh-12rem)] lg:min-h-[38rem] lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex min-h-0 min-w-0 flex-col border-b border-[#dce3e7] bg-[#f7f9fa] lg:border-b-0 lg:border-r">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e2e7ea] px-3.5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase text-[#536675]">
            <History aria-hidden="true" className="size-4" />
            {copy.workspace.history}
          </h2>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={() => {
              startNewConversation();
              inputRef.current?.focus();
            }}
            aria-label={copy.common.newConversation}
            title={copy.common.newConversation}
          >
            <Plus aria-hidden="true" className="size-4" />
          </Button>
        </div>

        <nav
          aria-label={copy.workspace.conversationsAria}
          className="flex w-full max-w-full max-h-44 min-h-0 gap-1.5 overflow-x-auto p-2 lg:max-h-none lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto"
        >
          {isBootstrapping && conversations.length === 0 ? (
            <div className="flex h-20 min-w-52 items-center justify-center gap-2 text-xs text-[var(--theme-muted-text)] lg:min-w-0">
              <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              {copy.workspace.historyLoading}
            </div>
          ) : null}
          {!isBootstrapping && conversations.length === 0 ? (
            <p className="min-w-52 px-2 py-5 text-xs leading-5 text-[#66727f] lg:min-w-0">
              {copy.workspace.noConversations}
            </p>
          ) : null}
          {conversations.map((conversation) => {
            const active = conversation.id === activeConversationId;
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => void selectConversation(conversation.id)}
                className={`focus-ring flex w-56 shrink-0 items-start gap-2.5 rounded-md border px-2.5 py-2.5 text-left transition-colors lg:w-full ${
                  active
                    ? "border-[#9dd8d1] bg-[#e9f8f6]"
                    : "border-transparent bg-transparent hover:border-[#dce3e7] hover:bg-white"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <MessageSquare
                  aria-hidden="true"
                  className={`mt-0.5 size-4 shrink-0 ${active ? "text-[#168078]" : "text-[#7a8994]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-[#2a3d4b]">
                    {conversation.title || copy.common.defaultConversation}
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-[#52606d]">
                    <span>
                      {formatAiConversationDate(
                        conversation.lastMessageAt,
                        locale,
                        PLATFORM_TIME_ZONE,
                      )}
                    </span>
                    {conversation.status === "archived" ? (
                      <Archive
                        aria-label={copy.common.archived}
                        className="size-3"
                      />
                    ) : (
                      <span>{conversation.messageCount}</span>
                    )}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-[#e0e6e9] px-4 sm:px-5">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#17324d] text-white">
            <Sparkles aria-hidden="true" className="size-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-[#243444]">
              {agent?.name ?? copy.common.defaultAgent}
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-[#71808b]">
              {activeConversation?.title ?? copy.common.defaultConversation}
            </p>
          </div>
          {agents.length > 1 ? (
            <label className="min-w-0 max-w-52">
              <span className="sr-only">{copy.workspace.selectAgent}</span>
              <select
                value={agent?.id ?? ""}
                onChange={(event) => void selectAgent(event.target.value)}
                disabled={isBootstrapping || isSending}
                className="focus-ring h-9 w-full min-w-0 rounded-md border border-[#d7e0e4] bg-white px-2 text-xs font-semibold text-[#354555] disabled:opacity-60"
                aria-label={copy.workspace.selectAgent}
              >
                {agents.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              startNewConversation();
              inputRef.current?.focus();
            }}
          >
            <Plus aria-hidden="true" className="size-4" />
            {copy.workspace.newChat}
          </Button>
        </header>

        {transparency?.required ? (
          <AiTransparencyNotice
            locale={locale}
            state={transparency}
            pending={isAcknowledgingTransparency}
            onAcknowledge={() => void acknowledgeTransparency()}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        ) : null}

        <div
          className={`${transparency?.required ? "hidden" : ""} min-h-[22rem] flex-1 overflow-y-auto bg-[#f5f7f8] px-3 py-5 sm:px-5 lg:min-h-0`}
          role="log"
          aria-label={copy.workspace.conversationLog}
          aria-live="polite"
          aria-busy={isSending || isBootstrapping}
        >
          {isBootstrapping ? (
            <div className="grid h-full min-h-64 place-items-center text-sm text-[#71808b]">
              <span className="flex items-center gap-2">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {copy.workspace.conversationLoading}
              </span>
            </div>
          ) : messages.length === 0 ? (
            <div className="mx-auto flex h-full min-h-64 max-w-xl flex-col items-center justify-center text-center">
              <span className="grid size-12 place-items-center rounded-md bg-[#dff4f0] text-[#177a72]">
                <Bot aria-hidden="true" className="size-6" />
              </span>
              <h3 className="mt-4 text-base font-bold text-[#243444]">
                {copy.workspace.emptyPrompt}
              </h3>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void submit(suggestion)}
                    className="focus-ring rounded-md border border-[#c9dedb] bg-white px-3 py-2 text-xs font-medium text-[#176e68] hover:border-[#2bb7a9] hover:bg-[#f1faf8]"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  curatedSource={copy.common.curatedSource}
                />
              ))}
              {isSending ? (
                <div className="flex items-end gap-2.5">
                  <span className="mb-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
                    <Bot aria-hidden="true" className="size-4" />
                  </span>
                  <span className="flex h-10 items-center gap-2 rounded-md border border-[#dfe5e8] bg-white px-3 text-xs text-[#647581]">
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    {copy.common.responseGenerating}
                  </span>
                </div>
              ) : null}
              {!isSending && suggestions.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void submit(suggestion)}
                      className="focus-ring rounded-md border border-[#c9dedb] bg-white px-2.5 py-1.5 text-left text-xs text-[#176e68] hover:border-[#2bb7a9] hover:bg-[#f1faf8]"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}
              <div ref={endRef} />
            </div>
          )}
        </div>

        {!transparency?.required ? (
          <AiAgentActionList
            locale={locale}
            actions={actions}
            pendingActionId={pendingActionId}
            onRequest={requestAction}
            onCancel={cancelAction}
          />
        ) : null}

        <form onSubmit={handleSubmit} className="shrink-0 border-t border-[#e0e6e9] bg-white p-3 sm:p-4">
          {error ? (
            <p className="mx-auto mb-2 flex max-w-3xl items-center gap-2 text-xs text-[#a74439]" role="alert">
              <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
              {error}
            </p>
          ) : null}
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-md border border-[#cfd9de] bg-white p-1.5 pl-3 focus-within:border-[#2b968c] focus-within:ring-2 focus-within:ring-[#2bb7a9]/15">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={10_000}
              disabled={
                archived || isBootstrapping || Boolean(transparency?.required)
              }
              placeholder={
                archived
                  ? copy.workspace.archivedPlaceholder
                  : copy.workspace.messagePlaceholder
              }
              aria-label={copy.workspace.messagePlaceholder}
              className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm leading-5 text-[#243b4a] outline-none placeholder:text-[var(--theme-muted-text)] disabled:cursor-not-allowed disabled:bg-transparent"
            />
            <Button
              type="submit"
              size="icon"
              className="size-10"
              disabled={
                !draft.trim() ||
                isSending ||
                isBootstrapping ||
                archived ||
                Boolean(transparency?.required)
              }
              aria-label={copy.common.sendMessage}
              title={copy.common.send}
            >
              {isSending ? (
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Send aria-hidden="true" className="size-4" />
              )}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
