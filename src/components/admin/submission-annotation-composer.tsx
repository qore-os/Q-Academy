"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clock3,
  MessageSquarePlus,
  Quote,
  Save,
  Trash2,
  X,
} from "lucide-react";

import {
  SubmissionAttachmentLinks,
  type SubmissionAttachmentView,
} from "@/components/academy/submission-attachment-uploader";
import { Button } from "@/components/ui/button";
import { SubmissionAnswerContent } from "@/components/content/submission-answer-content";
import type { SubmissionReviewAnnotationInput } from "@/lib/submission-review-annotations";
import type { AppLocale } from "@/lib/i18n/model";
import { getSubmissionReviewCopy } from "@/lib/i18n/submission-review";

type AnnotationAnchor =
  | Readonly<{
      type: "text_range";
      startOffset: number;
      endOffset: number;
      excerpt: string;
    }>
  | Readonly<{
      type: "media_timestamp";
      mediaAssetId: string;
      timestampMilliseconds: number;
      label: string;
    }>;

function inlineMediaHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}disposition=inline`;
}

function timestampLabel(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SubmissionAnnotationComposer({
  content,
  contentFormat,
  richText,
  attachments,
  formId,
  disabled,
  locale,
}: {
  content: string | null;
  contentFormat: "plain_text" | "rich_text";
  richText: unknown;
  attachments: SubmissionAttachmentView[];
  formId: string;
  disabled?: boolean;
  locale: AppLocale;
}) {
  const reviewCopy = getSubmissionReviewCopy(locale);
  const copy = reviewCopy.annotations;
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const players = useRef(new Map<string, HTMLMediaElement>());
  const [annotations, setAnnotations] = useState<
    SubmissionReviewAnnotationInput[]
  >([]);
  const [anchor, setAnchor] = useState<AnnotationAnchor | null>(null);
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (anchor) bodyRef.current?.focus();
  }, [anchor]);

  const beginTextAnnotation = () => {
    const root = answerRef.current;
    if (!root || root.selectionStart === root.selectionEnd) {
      setMessage(copy.noSelection);
      return;
    }
    const startOffset = root.selectionStart;
    const endOffset = root.selectionEnd;
    const excerpt = root.value.slice(startOffset, endOffset);
    if (!excerpt || endOffset > (content?.length ?? 0)) {
      setMessage(copy.invalidSelection);
      return;
    }
    setAnchor({ type: "text_range", startOffset, endOffset, excerpt });
    setBody("");
    setMessage(null);
  };

  const beginMediaAnnotation = (attachment: SubmissionAttachmentView) => {
    const player = players.current.get(attachment.id);
    if (
      !player ||
      player.readyState < HTMLMediaElement.HAVE_METADATA ||
      !Number.isFinite(player.duration) ||
      player.duration <= 0
    ) {
      player?.load();
      setMessage(copy.mediaNotReady);
      return;
    }
    if (
      !Number.isFinite(player.currentTime) ||
      player.currentTime < 0 ||
      player.currentTime > player.duration
    ) {
      setMessage(copy.invalidTimestamp);
      return;
    }
    setAnchor({
      type: "media_timestamp",
      mediaAssetId: attachment.id,
      timestampMilliseconds: Math.max(0, Math.round(player.currentTime * 1_000)),
      label: attachment.originalFileName,
    });
    setBody("");
    setMessage(null);
  };

  const addAnnotation = () => {
    const normalizedBody = body.trim();
    if (!anchor || !normalizedBody) {
      setMessage(copy.enterComment);
      return;
    }
    if (annotations.length >= 100) {
      setMessage(copy.limitReached);
      return;
    }
    const annotation: SubmissionReviewAnnotationInput =
      anchor.type === "text_range"
        ? {
            type: "text_range",
            body: normalizedBody,
            startOffset: anchor.startOffset,
            endOffset: anchor.endOffset,
          }
        : {
            type: "media_timestamp",
            body: normalizedBody,
            mediaAssetId: anchor.mediaAssetId,
            timestampMilliseconds: anchor.timestampMilliseconds,
          };
    if (
      annotations.some(
        (current) => JSON.stringify(current) === JSON.stringify(annotation),
      )
    ) {
      setMessage(copy.duplicate);
      return;
    }
    setAnnotations((current) => [...current, annotation]);
    setAnchor(null);
    setBody("");
    setMessage(null);
  };

  const playableAttachments = attachments.filter(
    (attachment) =>
      attachment.kind === "audio" || attachment.kind === "video",
  );

  return (
    <div className="space-y-4">
      <input
        type="hidden"
        form={formId}
        name="annotations"
        value={JSON.stringify(annotations)}
      />
      {contentFormat === "rich_text" ? (
        <div className="rounded-md border border-[#e1e5e8] bg-[#fafbfb] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase text-[#66727f]">
            {copy.formattedAnswer}
          </p>
          <SubmissionAnswerContent
            emptyLabel={reviewCopy.center.noText}
            content={content}
            contentFormat={contentFormat}
            richText={richText}
          />
        </div>
      ) : null}
      {content ? (
        <div>
          {contentFormat === "rich_text" ? (
            <label
              htmlFor={`${formId}-text-projection`}
              className="mb-1.5 block text-xs font-semibold text-[#52606d]"
            >
              {copy.textProjection}
            </label>
          ) : null}
        <textarea
          ref={answerRef}
          id={`${formId}-text-projection`}
          aria-label={copy.submittedAnswer}
          value={content}
          readOnly
          className="focus-ring min-h-48 w-full resize-y rounded-md border border-[#e1e5e8] bg-[#fafbfb] p-4 text-sm leading-7 text-[#455463]"
        />
        </div>
      ) : (
        <div className="min-h-48 rounded-md border border-[#e1e5e8] bg-[#fafbfb] p-4 text-sm leading-7 text-[#71808b]">
          {reviewCopy.center.noText}
        </div>
      )}
      {content ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={beginTextAnnotation}
          disabled={disabled}
        >
          <Quote className="size-4" />
          {copy.commentSelection}
        </Button>
      ) : null}

      {playableAttachments.map((attachment) => (
        <div
          key={attachment.id}
          className="overflow-hidden rounded-md border border-[#dfe4e8] bg-white"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf0f2] px-3 py-2">
            <p className="min-w-0 truncate text-xs font-semibold text-[#455463]">
              {attachment.originalFileName}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => beginMediaAnnotation(attachment)}
              disabled={disabled}
              title={copy.commentTimestamp}
            >
              <Clock3 className="size-4" />
              {copy.timestamp}
            </Button>
          </div>
          {attachment.kind === "video" ? (
            <video
              ref={(node) => {
                if (node) players.current.set(attachment.id, node);
                else players.current.delete(attachment.id);
              }}
              src={inlineMediaHref(attachment.downloadHref)}
              controls
              preload="metadata"
              aria-label={copy.videoAttachment(attachment.originalFileName)}
              className="aspect-video w-full bg-black object-contain"
            />
          ) : (
            <audio
              ref={(node) => {
                if (node) players.current.set(attachment.id, node);
                else players.current.delete(attachment.id);
              }}
              src={inlineMediaHref(attachment.downloadHref)}
              controls
              preload="metadata"
              aria-label={copy.audioAttachment(attachment.originalFileName)}
              className="w-full px-3 py-2"
            />
          )}
        </div>
      ))}
      <SubmissionAttachmentLinks attachments={attachments} locale={locale} />

      {anchor ? (
        <div className="rounded-md border border-[#b8cbdc] bg-[#f5f8fb] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase text-[#365f8d]">
                {anchor.type === "text_range"
                  ? copy.selectedText
                  : copy.timestampAt(timestampLabel(anchor.timestampMilliseconds))}
              </p>
              <p className="mt-1 truncate text-xs text-[#52606d]">
                {anchor.type === "text_range" ? anchor.excerpt : anchor.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAnchor(null)}
              className="focus-ring grid size-8 shrink-0 place-items-center rounded text-[#71808b] hover:bg-white"
              title={copy.discard}
            >
              <X className="size-4" />
            </button>
          </div>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.comment}
            </span>
            <textarea
              ref={bodyRef}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={2_000}
              className="focus-ring min-h-24 w-full rounded-md border border-[#cbd7e2] bg-white p-3 text-sm"
              disabled={disabled}
            />
          </label>
          <Button
            type="button"
            size="sm"
            onClick={addAnnotation}
            disabled={disabled || !body.trim()}
            className="mt-3"
          >
            <Save className="size-4" />
            {copy.applyComment}
          </Button>
        </div>
      ) : null}

      {annotations.length ? (
        <div className="overflow-hidden rounded-md border border-[#dfe4e8]">
          <div className="flex items-center gap-2 border-b border-[#edf0f2] bg-[#f7f9fa] px-3 py-2">
            <MessageSquarePlus className="size-4 text-[#365f8d]" />
            <p className="text-xs font-bold text-[#354555]">
              {copy.comments(annotations.length)}
            </p>
          </div>
          <ol className="divide-y divide-[#edf0f2]">
            {annotations.map((annotation, index) => (
              <li
                key={`${annotation.type}-${index}`}
                className="flex items-start gap-3 px-3 py-3"
              >
                <span className="grid size-6 shrink-0 place-items-center rounded bg-[#eef3f8] text-[10px] font-bold text-[#365f8d]">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase text-[#71808b]">
                    {annotation.type === "text_range"
                      ? copy.textRange(annotation.startOffset, annotation.endOffset)
                      : copy.timestampAt(timestampLabel(annotation.timestampMilliseconds))}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#455463]">
                    {annotation.body}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setAnnotations((current) =>
                      current.filter((_, currentIndex) => currentIndex !== index),
                    )
                  }
                  className="focus-ring grid size-8 shrink-0 place-items-center rounded text-[#8a949d] hover:bg-[#fdf0ee] hover:text-[#b84e42]"
                  title={copy.removeComment}
                  disabled={disabled}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {message ? (
        <p role="status" aria-live="polite" className="text-xs text-[#a94339]">
          {message}
        </p>
      ) : null}
    </div>
  );
}
