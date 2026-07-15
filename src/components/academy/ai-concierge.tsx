"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  AlertCircle,
  Bot,
  History,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useAiConversations } from "@/components/academy/use-ai-conversations";
import { AiAgentActionList } from "@/components/academy/ai-agent-action-list";
import { AiTransparencyNotice } from "@/components/academy/ai-transparency-notice";
import { safeInternalAcademyHref } from "@/lib/ai/citations";
import { getAiMemberCopy } from "@/lib/i18n/ai-member";
import type { AppLocale } from "@/lib/i18n/model";

export function AiConcierge({ locale }: { locale: AppLocale }) {
  const copy = getAiMemberCopy(locale);
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const {
    agent,
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
    startNewConversation,
    sendMessage,
    requestAction,
    cancelAction,
  } = useAiConversations({ locale, enabled: isOpen });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [isOpen, isSending, messages]);

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

  if (pathname === "/academy/ai") return null;

  return (
    <div className="fixed bottom-[calc(0.5rem+env(safe-area-inset-bottom))] right-[calc(8.333333vw-1.5rem)] z-[70] flex flex-col items-end gap-3 lg:bottom-6 lg:right-6">
      {isOpen ? (
        <section
          id="ai-concierge-panel"
          role="dialog"
          aria-label={copy.concierge.panelAria}
          className="flex h-[min(34rem,calc(100dvh-6.25rem-env(safe-area-inset-bottom)))] w-[calc(100vw-1.5rem)] max-w-[23rem] flex-col overflow-hidden rounded-lg border border-[#d9e1e5] bg-white shadow-[0_18px_55px_rgba(17,44,65,0.22)] sm:w-[23rem]"
        >
          <header className="shrink-0 bg-[#17324d] px-3.5 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#2bb7a9] text-[#102d43]">
                <Sparkles aria-hidden="true" className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">
                  {agent?.name ?? copy.common.defaultAgent}
                </h2>
                <p className="mt-0.5 text-[11px] text-[#c8d7df]">
                  {copy.concierge.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  startNewConversation();
                  inputRef.current?.focus();
                }}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#dbe6eb] hover:bg-white/10 hover:text-white"
                aria-label={copy.common.newConversation}
                title={copy.common.newConversation}
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#dbe6eb] hover:bg-white/10 hover:text-white"
                aria-label={copy.concierge.close}
                title={copy.concierge.closeShort}
              >
                <X aria-hidden="true" className="size-4.5" />
              </button>
            </div>
            <label className="mt-2.5 flex items-center gap-2 rounded-md bg-white/8 px-2.5">
              <History aria-hidden="true" className="size-3.5 shrink-0 text-[#a8c0cc]" />
              <span className="sr-only">
                {copy.concierge.selectConversation}
              </span>
              <select
                value={activeConversationId ?? ""}
                onChange={(event) => {
                  const conversationId = event.target.value;
                  if (conversationId) void selectConversation(conversationId);
                  else startNewConversation();
                }}
                className="h-8 min-w-0 flex-1 appearance-none truncate bg-transparent text-xs text-white outline-none"
                aria-label={copy.concierge.selectConversation}
              >
                <option value="" className="text-[#243444]">
                  {copy.common.defaultConversation}
                </option>
                {conversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id} className="text-[#243444]">
                    {conversation.title || copy.common.defaultConversation}
                  </option>
                ))}
              </select>
            </label>
          </header>

          {transparency?.required ? (
            <AiTransparencyNotice
              locale={locale}
              state={transparency}
              pending={isAcknowledgingTransparency}
              onAcknowledge={() => void acknowledgeTransparency()}
              compact
              className="min-h-0 flex-1 overflow-y-auto"
            />
          ) : null}

          <div
            className={`${transparency?.required ? "hidden" : ""} min-h-0 flex-1 overflow-y-auto bg-[#f5f7f8] px-3 py-4 sm:px-4`}
            role="log"
            aria-label={copy.concierge.compactLog}
            aria-live="polite"
            aria-busy={isSending || isBootstrapping}
          >
            {isBootstrapping ? (
              <div className="grid h-full place-items-center text-xs text-[var(--theme-muted-text)]">
                <span className="flex items-center gap-2">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  {copy.concierge.historyLoading}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {messages.length === 0 ? (
                  <div className="py-3 text-center">
                    <span className="mx-auto grid size-10 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
                      <Bot aria-hidden="true" className="size-5" />
                    </span>
                    <p className="mt-3 text-sm font-semibold text-[#243b4a]">
                      {copy.concierge.emptyPrompt}
                    </p>
                  </div>
                ) : null}

                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <div
                      key={message.id}
                      className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {!isUser ? (
                        <span className="mb-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
                          <Bot aria-hidden="true" className="size-3.5" />
                        </span>
                      ) : null}
                      <div className="max-w-[84%]">
                        <p
                          className={`whitespace-pre-wrap rounded-md px-3 py-2.5 text-[13px] leading-5 ${
                            isUser
                              ? "bg-[#17324d] text-white"
                              : "border border-[#e0e6e9] bg-white text-[#243b4a]"
                          } ${message.isPending ? "opacity-65" : ""}`}
                        >
                          {message.content}
                        </p>
                        {!isUser && message.citations.length > 0 ? (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {message.citations.map((citation) => {
                              const href = safeInternalAcademyHref(citation.href);
                              return href ? (
                                <a
                                  key={`${message.id}-${citation.pageId ?? citation.lessonId ?? citation.courseId ?? citation.title}`}
                                  href={href}
                                  className="focus-ring max-w-full truncate rounded-md border border-[#c9dedb] bg-white px-2 py-1 text-[10px] font-medium text-[#176e68] hover:border-[#2bb7a9]"
                                >
                                  {citation.title}
                                </a>
                              ) : null;
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {isSending ? (
                  <div className="flex items-end gap-2">
                    <span className="mb-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-[#dff4f0] text-[#167c73]">
                      <Bot aria-hidden="true" className="size-3.5" />
                    </span>
                    <span className="flex h-9 items-center gap-2 rounded-md border border-[#e0e6e9] bg-white px-3 text-xs text-[#5e707b]">
                      <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
                      {copy.common.responseGenerating}
                    </span>
                  </div>
                ) : null}

                {!isSending && suggestions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 pl-8 pt-1">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void submit(suggestion)}
                        className="focus-ring max-w-full rounded-md border border-[#b9d8d3] bg-white px-2.5 py-1.5 text-left text-xs leading-4 text-[#176e68] hover:border-[#2bb7a9] hover:bg-[#eef9f7]"
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
              compact
            />
          ) : null}
          <form onSubmit={handleSubmit} className="shrink-0 border-t border-[#e0e6e9] bg-white p-3">
            {error ? (
              <p className="mb-2 flex items-start gap-1.5 text-xs leading-4 text-[#a74439]" role="alert">
                <AlertCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}
            <div className="flex items-end gap-2 rounded-md border border-[#cfd9de] bg-white p-1.5 pl-3 focus-within:border-[#2b968c] focus-within:ring-2 focus-within:ring-[#2bb7a9]/15">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                maxLength={10_000}
                disabled={
                  archived ||
                  isBootstrapping ||
                  Boolean(transparency?.required)
                }
                placeholder={
                  archived
                    ? copy.concierge.archivedPlaceholder
                    : copy.concierge.messagePlaceholder
                }
                aria-label={copy.concierge.messageAria}
                className="max-h-24 min-h-9 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-5 text-[#243b4a] outline-none placeholder:text-[var(--theme-muted-text)] disabled:cursor-not-allowed"
              />
              <button
                type="submit"
                disabled={
                  !draft.trim() ||
                  isSending ||
                  isBootstrapping ||
                  archived ||
                  Boolean(transparency?.required)
                }
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-md bg-[#e2a938] text-[#172f45] hover:bg-[#efb94c] disabled:cursor-not-allowed disabled:bg-[#e8ecee] disabled:text-[#9aa7ae]"
                aria-label={copy.common.sendMessage}
                title={copy.common.send}
              >
                {isSending ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <Send aria-hidden="true" className="size-4" />
                )}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="focus-ring relative grid size-12 place-items-center rounded-lg bg-[#17324d] text-white shadow-[0_8px_20px_rgba(17,44,65,0.24)] transition-transform hover:-translate-y-0.5 hover:bg-[#21415e] lg:size-13 lg:shadow-[0_10px_30px_rgba(17,44,65,0.3)]"
        aria-label={isOpen ? copy.concierge.close : copy.concierge.open}
        aria-expanded={isOpen}
        aria-controls="ai-concierge-panel"
        title={
          isOpen ? copy.concierge.closeShort : copy.concierge.panelAria
        }
      >
        {isOpen ? <X aria-hidden="true" className="size-5" /> : <MessageCircle aria-hidden="true" className="size-5.5" />}
        {!isOpen ? (
          <span className="absolute -right-1 -top-1 size-3 rounded-full border-2 border-white bg-[#2bb7a9]" aria-hidden="true" />
        ) : null}
      </button>
    </div>
  );
}

export default AiConcierge;
