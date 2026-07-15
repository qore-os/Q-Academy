"use client";

import { useRef } from "react";
import { Clock3, MessageSquareText, Play, Quote } from "lucide-react";

import type { SubmissionAttachmentView } from "@/components/academy/submission-attachment-uploader";
import type { SubmissionReviewAnnotationInput } from "@/lib/submission-review-annotations";
import { getLearningUiCopy } from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

export type SubmissionReviewAnnotationView =
  SubmissionReviewAnnotationInput &
    Readonly<{
      id: string;
      createdAt: Date | string;
    }>;

function inlineMediaHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}disposition=inline`;
}

function timestampLabel(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SubmissionReviewAnnotations({
  annotations,
  content,
  attachments,
  locale,
}: {
  annotations: SubmissionReviewAnnotationView[];
  content: string | null;
  attachments: SubmissionAttachmentView[];
  locale: AppLocale;
}) {
  const copy = getLearningUiCopy(locale);
  const players = useRef(new Map<string, HTMLMediaElement>());
  if (!annotations.length) return null;

  const attachmentsById = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  const playableAttachments = [
    ...new Map(
      annotations
        .filter(
          (annotation) => annotation.type === "media_timestamp",
        )
        .map((annotation) => {
          const attachment = attachmentsById.get(annotation.mediaAssetId);
          return [
            annotation.mediaAssetId,
            attachment?.kind === "audio" || attachment?.kind === "video"
              ? attachment
              : null,
          ] as const;
        })
        .filter(
          (
            entry,
          ): entry is readonly [string, SubmissionAttachmentView] =>
            entry[1] !== null,
        ),
    ).values(),
  ];

  const seekTo = (mediaAssetId: string, timestampMilliseconds: number) => {
    const player = players.current.get(mediaAssetId);
    if (!player) return;
    const seekAndPlay = () => {
      player.currentTime = timestampMilliseconds / 1_000;
      void player.play().catch(() => undefined);
      player.focus();
    };
    if (player.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekAndPlay();
      return;
    }
    player.addEventListener("loadedmetadata", seekAndPlay, { once: true });
    player.load();
  };

  return (
    <div className="mt-3 space-y-3">
      {playableAttachments.map((attachment) => (
        <div
          key={attachment.id}
          className="overflow-hidden rounded-md border border-[#dce4e7] bg-white"
        >
          <p className="truncate border-b border-[#edf0f2] px-3 py-2 text-[10px] font-semibold text-[#52606d]">
            {attachment.originalFileName}
          </p>
          {attachment.kind === "video" ? (
            <video
              ref={(node) => {
                if (node) players.current.set(attachment.id, node);
                else players.current.delete(attachment.id);
              }}
              src={inlineMediaHref(attachment.downloadHref)}
              controls
              preload="none"
              aria-label={copy("annotations.videoAttachment", {
                name: attachment.originalFileName,
              })}
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
              preload="none"
              aria-label={copy("annotations.audioAttachment", {
                name: attachment.originalFileName,
              })}
              className="w-full px-3 py-2"
            />
          )}
        </div>
      ))}

      <ol className="divide-y divide-[#dce4e7] overflow-hidden rounded-md border border-[#dce4e7] bg-white">
        {annotations.map((annotation) => {
          if (annotation.type === "text_range") {
            const excerpt = content?.slice(
              annotation.startOffset,
              annotation.endOffset,
            );
            return (
              <li key={annotation.id} className="p-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-[#365f8d]">
                  <Quote className="size-3.5" />
                  {copy("annotations.textRange")}
                </div>
                {excerpt ? (
                  <blockquote className="mt-2 border-l-2 border-[#9cb3c9] pl-2 text-xs italic leading-5 text-[#52606d]">
                    {excerpt}
                  </blockquote>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#354555]">
                  {annotation.body}
                </p>
              </li>
            );
          }

          const attachment = attachmentsById.get(annotation.mediaAssetId);
          const playable =
            attachment?.kind === "audio" || attachment?.kind === "video";
          return (
            <li key={annotation.id} className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase text-[#176f68]">
                  <Clock3 className="size-3.5" />
                  {timestampLabel(annotation.timestampMilliseconds)}
                </span>
                {playable ? (
                  <button
                    type="button"
                    onClick={() =>
                      seekTo(
                        annotation.mediaAssetId,
                        annotation.timestampMilliseconds,
                      )
                    }
                    className="focus-ring inline-flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold text-[#365f8d] hover:bg-[#eef3f8]"
                    title={copy("annotations.playTimestamp")}
                  >
                    <Play className="size-3" />
                    <span className="truncate">
                      {attachment.originalFileName}
                    </span>
                  </button>
                ) : (
                  <span className="truncate text-[10px] text-[#71808b]">
                    {attachment?.originalFileName ??
                      copy("annotations.mediaAttachment")}
                  </span>
                )}
              </div>
              <p className="mt-2 flex items-start gap-2 whitespace-pre-wrap text-xs leading-5 text-[#354555]">
                <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-[#71808b]" />
                <span>{annotation.body}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
