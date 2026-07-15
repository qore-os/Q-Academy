"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, Bot, LoaderCircle, Plus, Send, Sparkles } from "lucide-react";

import { useAiConversations } from "@/components/academy/use-ai-conversations";
import { AiAgentActionList } from "@/components/academy/ai-agent-action-list";
import { AiTransparencyNotice } from "@/components/academy/ai-transparency-notice";
import { Button } from "@/components/ui/button";
import { getAiMemberCopy } from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";

export function EmbeddedAiAgent({
  locale,
  agentId,
  canInteract,
}: {
  locale: AppLocale;
  agentId: string;
  canInteract: boolean;
}) {
  const copy = getAiMemberCopy(locale);
  const {
    agent,
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
    startNewConversation,
    sendMessage,
    requestAction,
    cancelAction,
  } = useAiConversations({ locale, initialAgentId: agentId });
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const visibleMessages = messages.filter(
    (message) => message.role === "user" || message.role === "assistant",
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [isSending, visibleMessages.length]);

  async function submit(rawContent?: string) {
    const content = (rawContent ?? draft).trim();
    if (!content || !canInteract || isSending) return;
    setDraft("");
    const sent = await sendMessage(content);
    if (!sent) setDraft(content);
    inputRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  if (isBootstrapping && !agent) {
    return (
      <section
        className="grid min-h-40 place-items-center rounded-md border border-[#dce3e7] bg-[#f7f9fa] text-sm text-[#71808b]"
        aria-label={copy.embedded.loadingAria}
      >
        <span className="flex items-center gap-2">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {copy.embedded.loading}
        </span>
      </section>
    );
  }

  if (isUnavailable || !agent || agent.id !== agentId) {
    return (
      <section
        className="flex items-center gap-3 rounded-md border border-[#dfe4e8] bg-[#f7f9fa] p-4 text-sm text-[#66727f]"
        role="status"
      >
        <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
        {copy.embedded.unavailable}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-md border border-[#cbdadf] bg-white shadow-sm">
      <header className="flex min-h-16 items-center gap-3 border-b border-[#e0e6e9] px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#17324d] text-white">
          <Sparkles aria-hidden="true" className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-[#243444]">{agent.name}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-[#71808b]">
            {agent.description}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={!canInteract || isSending}
          onClick={() => {
            startNewConversation();
            inputRef.current?.focus();
          }}
          aria-label={copy.common.newConversation}
          title={copy.common.newConversation}
        >
          <Plus aria-hidden="true" className="size-4" />
        </Button>
      </header>

      {transparency?.required ? (
        <AiTransparencyNotice
          locale={locale}
          state={transparency}
          pending={isAcknowledgingTransparency}
          onAcknowledge={() => void acknowledgeTransparency()}
          compact
        />
      ) : null}

      <div
        className={`${transparency?.required ? "hidden" : ""} max-h-96 min-h-52 overflow-y-auto bg-[#f5f7f8] px-3 py-4 sm:px-4`}
        role="log"
        aria-label={copy.embedded.conversationWith(agent.name)}
        aria-live="polite"
        aria-busy={isSending}
      >
        {visibleMessages.length ? (
          <div className="space-y-3">
            {visibleMessages.map((message) => {
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                >
                  {!isUser ? (
                    <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
                      <Bot aria-hidden="true" className="size-3.5" />
                    </span>
                  ) : null}
                  <p
                    className={`max-w-[88%] whitespace-pre-wrap rounded-md px-3 py-2.5 text-sm leading-6 ${
                      isUser
                        ? "bg-[#17324d] text-white"
                        : "border border-[#dfe5e8] bg-white text-[#243b4a]"
                    } ${message.isPending ? "opacity-60" : ""}`}
                  >
                    {message.content}
                  </p>
                </div>
              );
            })}
            {isSending ? (
              <div className="flex items-center gap-2 text-xs text-[#66727f]">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {copy.common.responseGenerating}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center text-center">
            <Bot aria-hidden="true" className="size-6 text-[#2b9188]" />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.slice(0, 2).map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void submit(suggestion)}
                  disabled={!canInteract || isSending}
                  className="focus-ring rounded-md border border-[#c9dedb] bg-white px-3 py-2 text-xs font-medium text-[#176e68] hover:border-[#2bb7a9] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {suggestion}
                </button>
              ))}
            </div>
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
          compact
        />
      ) : null}
      <form onSubmit={handleSubmit} className="border-t border-[#e0e6e9] p-3">
        {error ? (
          <p className="mb-2 flex items-center gap-2 text-xs text-[#a74439]" role="alert">
            <AlertCircle aria-hidden="true" className="size-4 shrink-0" />
            {error}
          </p>
        ) : null}
        <div className="flex items-end gap-2 rounded-md border border-[#cfd9de] p-1.5 pl-3 focus-within:border-[#2b968c] focus-within:ring-2 focus-within:ring-[#2bb7a9]/15">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={1}
            maxLength={10_000}
            disabled={
              !canInteract || isSending || Boolean(transparency?.required)
            }
            placeholder={
              canInteract
                ? copy.embedded.messageTo(agent.name)
                : copy.embedded.interactionLocked
            }
            aria-label={copy.embedded.messageTo(agent.name)}
            className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2.5 text-sm leading-5 text-[#243b4a] outline-none placeholder:text-[var(--theme-muted-text)] disabled:cursor-not-allowed"
          />
          <Button
            type="submit"
            size="icon"
            className="size-10"
            disabled={
              !canInteract ||
              !draft.trim() ||
              isSending ||
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
    </section>
  );
}
