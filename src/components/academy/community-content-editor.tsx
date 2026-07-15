"use client";

import { AlignLeft, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { RichTextEditor } from "@/components/admin/rich-text-editor";
import {
  createRichTextDocument,
  sanitizeRichTextDocument,
  type RichTextDocument,
} from "@/lib/rich-text/document";
import { projectSubmissionRichTextPlainText } from "@/lib/submission-rich-text";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

export type CommunityContentEditorMentionCandidate = {
  id: string;
  handle: string;
  firstName: string;
  lastName: string;
};

export type CommunityContentEditorSnapshot = {
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
};

export function CommunityContentEditor({
  candidates,
  placeholder,
  minLength,
  maxLength,
  initialContent = "",
  initialFormat = "plain_text",
  initialRichText = null,
  multiline = true,
  compact = false,
  deferFormatControls = false,
  autoFocus = false,
  disabled = false,
  mentionLabel,
  locale,
  onSnapshotChange,
}: {
  candidates: CommunityContentEditorMentionCandidate[];
  placeholder: string;
  minLength: number;
  maxLength: number;
  initialContent?: string;
  initialFormat?: "plain_text" | "rich_text";
  initialRichText?: RichTextDocument | null;
  multiline?: boolean;
  compact?: boolean;
  deferFormatControls?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  mentionLabel?: string;
  locale: AppLocale;
  onSnapshotChange?: (snapshot: CommunityContentEditorSnapshot) => void;
}) {
  const dictionary = getMainPageDictionary(locale);
  const copy = dictionary.editor.richText;
  const ui = dictionary.academy.communityUi;
  const resolvedMentionLabel =
    mentionLabel ?? dictionary.academy.community.mentionMember;
  const [mode, setMode] = useState<"plain_text" | "rich_text">(
    initialFormat === "rich_text" && initialRichText
      ? "rich_text"
      : "plain_text",
  );
  const [plainValue, setPlainValue] = useState(initialContent);
  const [richDocument, setRichDocument] = useState<RichTextDocument>(() =>
    initialFormat === "rich_text" && initialRichText
      ? sanitizeRichTextDocument(initialRichText)
      : createRichTextDocument(initialContent),
  );
  const [matches, setMatches] = useState<
    CommunityContentEditorMentionCandidate[]
  >([]);
  const [formatControlsVisible, setFormatControlsVisible] = useState(
    !deferFormatControls || initialFormat === "rich_text",
  );
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const reset = () => {
      const nextRich =
        initialFormat === "rich_text" && initialRichText
          ? sanitizeRichTextDocument(initialRichText)
          : createRichTextDocument(initialContent);
      setMode(
        initialFormat === "rich_text" && initialRichText
          ? "rich_text"
          : "plain_text",
      );
      setPlainValue(initialContent);
      setRichDocument(nextRich);
      setMatches([]);
      setFormatControlsVisible(
        !deferFormatControls || initialFormat === "rich_text",
      );
      const nextMode =
        initialFormat === "rich_text" && initialRichText
          ? "rich_text"
          : "plain_text";
      onSnapshotChange?.({
        content:
          nextMode === "rich_text"
            ? projectSubmissionRichTextPlainText(nextRich)
            : initialContent,
        contentFormat: nextMode,
        richText: nextMode === "rich_text" ? nextRich : null,
      });
    };
    form.addEventListener("reset", reset);
    return () => form.removeEventListener("reset", reset);
  }, [
    deferFormatControls,
    initialContent,
    initialFormat,
    initialRichText,
    onSnapshotChange,
  ]);

  const publishSnapshot = (
    nextMode: "plain_text" | "rich_text",
    nextPlain: string,
    nextRich: RichTextDocument,
  ) => {
    onSnapshotChange?.({
      content:
        nextMode === "rich_text"
          ? projectSubmissionRichTextPlainText(nextRich)
          : nextPlain,
      contentFormat: nextMode,
      richText: nextMode === "rich_text" ? nextRich : null,
    });
  };

  const updateMatches = (content: string) => {
    const query = content
      .match(/(?:^|\s)@([a-z0-9._-]*)$/i)?.[1]
      ?.toLowerCase();
    if (query === undefined) {
      setMatches([]);
      return;
    }
    setMatches(
      candidates
        .filter(
          (candidate) =>
            candidate.handle.startsWith(query) ||
            `${candidate.firstName} ${candidate.lastName}`
              .toLocaleLowerCase(locale)
              .includes(query),
        )
        .slice(0, 5),
    );
  };

  const selectCandidate = (
    candidate: CommunityContentEditorMentionCandidate,
  ) => {
    const next = plainValue.replace(
      /@([a-z0-9._-]*)$/i,
      `@${candidate.handle} `,
    );
    setPlainValue(next);
    setMatches([]);
    publishSnapshot("plain_text", next, richDocument);
    controlRef.current?.focus();
  };

  const selectMode = (nextMode: "plain_text" | "rich_text") => {
    if (nextMode === mode) return;
    if (nextMode === "rich_text") {
      const nextRich = createRichTextDocument(plainValue);
      setRichDocument(nextRich);
      setMode(nextMode);
      setMatches([]);
      publishSnapshot(nextMode, plainValue, nextRich);
      return;
    }
    const nextPlain = projectSubmissionRichTextPlainText(richDocument);
    setPlainValue(nextPlain);
    setMode(nextMode);
    publishSnapshot(nextMode, nextPlain, richDocument);
  };

  const shared = {
    name: "content",
    value: plainValue,
    placeholder,
    minLength,
    maxLength,
    autoFocus,
    disabled,
    required: true,
    onFocus: () => setFormatControlsVisible(true),
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      const next = event.currentTarget.value;
      setPlainValue(next);
      updateMatches(next);
      publishSnapshot("plain_text", next, richDocument);
    },
  };

  return (
    <div ref={rootRef} className={cn("min-w-0", compact ? "mt-2" : "mt-4")}>
      {formatControlsVisible ? <div
        className="mb-2 inline-grid grid-cols-2 rounded-md border border-[#dfe4e8] bg-[#f4f6f7] p-0.5"
        role="group"
        aria-label={ui.editor.contentFormat}
        data-testid="community-content-format"
      >
        <button
          type="button"
          onClick={() => selectMode("plain_text")}
          disabled={disabled}
          aria-pressed={mode === "plain_text"}
          className={cn(
            "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded px-2.5 text-[10px] font-bold disabled:opacity-50",
            mode === "plain_text"
              ? "bg-white text-[#17324d] shadow-sm"
              : "text-[#71808b]",
          )}
        >
          <AlignLeft className="size-3.5" /> {copy.plainText}
        </button>
        <button
          type="button"
          onClick={() => selectMode("rich_text")}
          disabled={disabled}
          aria-pressed={mode === "rich_text"}
          className={cn(
            "focus-ring inline-flex h-8 items-center justify-center gap-1.5 rounded px-2.5 text-[10px] font-bold disabled:opacity-50",
            mode === "rich_text"
              ? "bg-white text-[#17324d] shadow-sm"
              : "text-[#71808b]",
          )}
        >
          <Type className="size-3.5" /> {copy.formatted}
        </button>
      </div> : null}

      {mode === "rich_text" ? (
        <RichTextEditor
          name="richText"
          initialValue={richDocument}
          ariaLabel={copy.communityContentLabel}
          placeholder={placeholder}
          minHeightClassName={compact ? "min-h-24" : "min-h-36"}
          disabled={disabled}
          variant="submission"
          locale={locale}
          onDocumentChange={(document) => {
            setRichDocument(document);
            publishSnapshot("rich_text", plainValue, document);
          }}
        />
      ) : (
        <div className="relative">
          {multiline ? (
            <textarea
              {...shared}
              ref={(node) => {
                controlRef.current = node;
              }}
              className={cn(
                "focus-ring w-full resize-y rounded-md border border-[#dce1e5] text-[#455463]",
                compact
                  ? "min-h-24 bg-[#f8f9fa] px-3 py-2 text-xs leading-5"
                  : "min-h-40 p-3 text-sm leading-6",
              )}
            />
          ) : (
            <input
              {...shared}
              ref={(node) => {
                controlRef.current = node;
              }}
              className="focus-ring h-9 min-w-0 w-full rounded-md border border-[#dce1e5] bg-[#f8f9fa] px-3 text-xs text-[#455463]"
            />
          )}
          {matches.length ? (
            <div
              className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-[#dce1e5] bg-white shadow-lg"
              role="listbox"
              aria-label={resolvedMentionLabel}
            >
              {matches.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectCandidate(candidate)}
                  className="focus-ring flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f3f6f7]"
                  role="option"
                  aria-selected="false"
                >
                  <span className="text-xs font-semibold text-[#354555]">
                    {candidate.firstName} {candidate.lastName}
                  </span>
                  <span className="text-[10px] text-[#71808b]">
                    @{candidate.handle}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
