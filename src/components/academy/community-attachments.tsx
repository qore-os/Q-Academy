"use client";

import Image from "next/image";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  Download,
  FileAudio,
  FileText,
  FileVideo,
  ImageIcon,
  LoaderCircle,
  Paperclip,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";

import {
  deleteBrowserSessionMediaAsset,
  uploadBrowserSessionMedia,
} from "@/lib/media/browser-session-upload";
import { ImageLightbox } from "@/components/content/image-lightbox";
import { getImageLightboxCopy } from "@/lib/i18n/image-lightbox";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

type UploadEntry = {
  clientId: string;
  assetId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  progress: number;
  status: "preparing" | "uploading" | "processing" | "ready" | "error";
  error: string | null;
};

export type CommunityAttachmentView = {
  id: string;
  name: string;
  kind: "image" | "audio" | "video" | "document";
  mimeType: string;
  sizeBytes: number;
  downloadHref: string;
};

export type CommunityAttachmentUploaderHandle = {
  discard: () => void;
  markCommitted: () => void;
};

function bytesLabel(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function inlineMediaHref(href: string) {
  return `${href}${href.includes("?") ? "&" : "?"}disposition=inline`;
}

function FileKindIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" />;
  if (mimeType.startsWith("audio/")) return <FileAudio className="size-4" />;
  if (mimeType.startsWith("video/")) return <FileVideo className="size-4" />;
  return <FileText className="size-4" />;
}

export const CommunityAttachmentUploader = forwardRef<
  CommunityAttachmentUploaderHandle,
  {
    maxAttachments: 3 | 6;
    locale: AppLocale;
    disabled?: boolean;
    compact?: boolean;
    onReadinessChange: (ready: boolean) => void;
  }
>(function CommunityAttachmentUploader(
  {
    maxAttachments,
    locale,
    disabled = false,
    compact = false,
    onReadinessChange,
  },
  ref,
) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const entriesRef = useRef(entries);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const updateEntry = (clientId: string, patch: Partial<UploadEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.clientId === clientId ? { ...entry, ...patch } : entry,
      ),
    );
  };

  const clearEntries = (deleteAssets: boolean) => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    const assetIds = entriesRef.current.flatMap((entry) =>
      entry.assetId ? [entry.assetId] : [],
    );
    setEntries([]);
    setMessage(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
    if (deleteAssets) {
      for (const assetId of assetIds) {
        void deleteBrowserSessionMediaAsset(assetId).catch(() => undefined);
      }
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      discard: () => clearEntries(true),
      markCommitted: () => clearEntries(false),
    }),
    [],
  );

  useEffect(() => {
    onReadinessChange(entries.every((entry) => entry.status === "ready"));
  }, [entries, onReadinessChange]);

  useEffect(
    () => () => {
      for (const controller of controllers.current.values()) controller.abort();
    },
    [],
  );

  const runUpload = async (file: File, clientId: string) => {
    const controller = new AbortController();
    controllers.current.set(clientId, controller);
    let assetId: string | null = null;
    try {
      await uploadBrowserSessionMedia({
        file,
        purpose: "community",
        clientUploadId: clientId,
        signal: controller.signal,
        onAssetCreated: (asset) => {
          assetId = asset.id;
          updateEntry(clientId, { assetId: asset.id });
        },
        onProgress: (progress) => updateEntry(clientId, { progress }),
        onStage: (stage) =>
          updateEntry(clientId, {
            status:
              stage === "uploading"
                ? "uploading"
                : stage === "processing"
                  ? "processing"
                  : "preparing",
            ...(stage === "processing" ? { progress: 100 } : {}),
          }),
      });
      updateEntry(clientId, { status: "ready", error: null });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      updateEntry(clientId, {
        assetId,
        status: "error",
        error: copy.attachments.uploadFailed,
      });
    } finally {
      controllers.current.delete(clientId);
    }
  };

  const enqueueFiles = (files: readonly File[]) => {
    if (!files.length || disabled) return;
    const available = maxAttachments - entriesRef.current.length;
    const selected = files.slice(0, Math.max(0, available));
    setMessage(
      selected.length < files.length
        ? copy.attachments.maximumFiles(maxAttachments)
        : null,
    );
    for (const file of selected) {
      const clientId = crypto.randomUUID();
      const entry: UploadEntry = {
        clientId,
        assetId: null,
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        progress: 0,
        status: "preparing",
        error: null,
      };
      if (!file.type || file.size <= 0) {
        entry.status = "error";
        entry.error = copy.attachments.invalidFile;
      }
      setEntries((current) => [...current, entry]);
      if (!entry.error) void runUpload(file, clientId);
    }
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeEntry = (entry: UploadEntry) => {
    controllers.current.get(entry.clientId)?.abort();
    controllers.current.delete(entry.clientId);
    setEntries((current) =>
      current.filter((candidate) => candidate.clientId !== entry.clientId),
    );
    setMessage(null);
    if (entry.assetId) {
      void deleteBrowserSessionMediaAsset(entry.assetId).catch(() => {
        setMessage(copy.attachments.removeFailed);
      });
    }
  };

  return (
    <div className={cn("mt-3 min-w-0", compact && "mt-2")}>
      <div
        className={cn(
          "min-w-0 overflow-hidden rounded-md border border-dashed border-[#c9d2d9] bg-[#f8fafb] p-3 transition-colors",
          dragging && "border-[#2b9188] bg-[#edf9f7]",
          disabled && "opacity-60",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          enqueueFiles(Array.from(event.dataTransfer.files));
        }}
      >
        <div className="flex min-h-8 min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[#52606d]">
            <Paperclip className="size-4 text-[#2b9188]" />
            {copy.attachments.title}
            <span className="text-[10px] font-medium text-[#87919a]">
              {entries.length}/{maxAttachments}
            </span>
          </span>
          <label className="focus-within:ring-2 focus-within:ring-[#2b9188] focus-within:ring-offset-2 inline-flex h-8 max-w-full cursor-pointer items-center gap-2 self-start rounded-md border border-[#cfd7dd] bg-white px-3 text-xs font-semibold text-[#455463] hover:bg-[#f4f7f8] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
            <Upload className="size-3.5" />
            {copy.attachments.chooseFile}
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPTED_TYPES}
              className="sr-only"
              disabled={disabled || entries.length >= maxAttachments}
              onChange={(event) =>
                enqueueFiles(Array.from(event.currentTarget.files ?? []))
              }
            />
          </label>
        </div>
        {!compact && !entries.length ? (
          <p className="mt-2 text-[10px] leading-4 text-[#87919a]">
            {copy.attachments.dropHint}
          </p>
        ) : null}
      </div>

      {entries.length ? (
        <div className="mt-2 min-w-0 divide-y divide-[#e4e8eb] overflow-hidden rounded-md border border-[#e0e5e8] bg-white">
          {entries.map((entry) => (
            <div
              key={entry.clientId}
              className="flex min-h-12 min-w-0 items-center gap-2.5 px-2.5 py-2"
            >
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded bg-[#f4f7f8] text-[#52606d]",
                  entry.status === "ready" && "text-[#167e74]",
                  entry.status === "error" && "bg-[#fdf0ee] text-[#a94339]",
                )}
              >
                {entry.status === "ready" ? (
                  <CheckCircle2 className="size-4" />
                ) : entry.status === "error" ? (
                  <ShieldAlert className="size-4" />
                ) : entry.status === "preparing" ? (
                  <FileKindIcon mimeType={entry.mimeType} />
                ) : (
                  <LoaderCircle className="size-4 animate-spin" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#455463]">
                  {entry.name}
                </span>
                <span
                  className={cn(
                    "mt-0.5 block text-[10px] text-[#7a8690]",
                    entry.status === "error" && "text-[#a94339]",
                  )}
                  aria-live="polite"
                >
                  {entry.status === "preparing"
                    ? copy.attachments.preparing
                    : entry.status === "uploading"
                      ? copy.attachments.uploading(entry.progress)
                      : entry.status === "processing"
                        ? copy.attachments.securityCheck
                        : entry.status === "ready"
                          ? copy.attachments.ready(bytesLabel(entry.sizeBytes))
                          : entry.error}
                </span>
                {entry.status === "uploading" ? (
                  <span className="mt-1 block h-1 overflow-hidden rounded bg-[#e4e9ec]">
                    <span
                      className="block h-full bg-[#2b9188] transition-[width]"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => removeEntry(entry)}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#71808b] hover:bg-[#fdf0ee] hover:text-[#a94339]"
                aria-label={copy.attachments.remove(entry.name)}
                title={copy.attachments.removeAttachment}
                disabled={disabled}
              >
                <Trash2 className="size-4" />
              </button>
              {entry.status === "ready" && entry.assetId ? (
                <input
                  type="hidden"
                  name="attachmentIds"
                  value={entry.assetId}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-xs text-[#a94339]" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
});

export function CommunityAttachments({
  attachments,
  locale,
  compact = false,
}: {
  attachments: CommunityAttachmentView[];
  locale: AppLocale;
  compact?: boolean;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  if (!attachments.length) return null;
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const lightboxCopy = getImageLightboxCopy(locale);
  const images = attachments.filter(
    (attachment) => attachment.kind === "image",
  );
  const media = attachments.filter(
    (attachment) => attachment.kind === "audio" || attachment.kind === "video",
  );
  const documents = attachments.filter(
    (attachment) => attachment.kind === "document",
  );

  return (
    <div className={cn("mt-3 space-y-2.5", compact && "mt-2 space-y-2")}>
      {images.length ? (
        <div
          className={cn(
            "grid gap-2 overflow-hidden",
            images.length > 1 && "sm:grid-cols-2",
          )}
        >
          {images.map((attachment, index) => (
            <button
              key={attachment.id}
              type="button"
              onClick={() => setActiveImageIndex(index)}
              className="focus-ring group relative block aspect-video min-w-0 overflow-hidden rounded-md border border-[#dfe5e8] bg-[#eef2f4]"
              aria-label={lightboxCopy.openImage(attachment.name)}
            >
              <Image
                src={inlineMediaHref(attachment.downloadHref)}
                alt={attachment.name}
                fill
                unoptimized
                sizes={
                  images.length > 1 ? "(min-width: 640px) 40vw, 90vw" : "90vw"
                }
                className="object-contain transition-transform group-hover:scale-[1.01]"
              />
            </button>
          ))}
        </div>
      ) : null}

      {activeImageIndex !== null ? (
        <ImageLightbox
          items={images.map((attachment) => ({
            id: attachment.id,
            src: inlineMediaHref(attachment.downloadHref),
            alt: attachment.name,
            originalHref: inlineMediaHref(attachment.downloadHref),
          }))}
          activeIndex={activeImageIndex}
          locale={locale}
          onActiveIndexChange={setActiveImageIndex}
          onClose={() => setActiveImageIndex(null)}
        />
      ) : null}

      {media.map((attachment) => (
        <div
          key={attachment.id}
          className="min-w-0 overflow-hidden rounded-md border border-[#dfe5e8] bg-[#f8fafb]"
        >
          <p className="truncate border-b border-[#e7ebed] px-3 py-2 text-[10px] font-semibold text-[#52606d]">
            {attachment.name}
          </p>
          {attachment.kind === "video" ? (
            <video
              src={inlineMediaHref(attachment.downloadHref)}
              controls
              preload={compact ? "none" : "metadata"}
              aria-label={copy.attachments.video(attachment.name)}
              className="aspect-video w-full bg-black object-contain"
            />
          ) : (
            <audio
              src={inlineMediaHref(attachment.downloadHref)}
              controls
              preload={compact ? "none" : "metadata"}
              aria-label={copy.attachments.audio(attachment.name)}
              className="w-full max-w-full px-3 py-2"
            />
          )}
        </div>
      ))}

      {documents.length ? (
        <div className="divide-y divide-[#e4e8eb] overflow-hidden rounded-md border border-[#dfe5e8] bg-[#f8fafb]">
          {documents.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.downloadHref}
              className="focus-ring flex min-h-12 min-w-0 items-center gap-3 px-3 py-2 hover:bg-white"
            >
              <FileText className="size-4 shrink-0 text-[#365f8d]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[#455463]">
                  {attachment.name}
                </span>
                <span className="block text-[10px] text-[#7a8690]">
                  {bytesLabel(attachment.sizeBytes)}
                </span>
              </span>
              <Download className="size-4 shrink-0 text-[#71808b]" />
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
