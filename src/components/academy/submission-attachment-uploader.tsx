"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
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
import { SubmissionRecorder } from "@/components/academy/submission-recorder";
import {
  formatLearningFileSize,
  getLearningUiCopy,
} from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

const MAX_ATTACHMENTS = 10;
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
  sizeBytes: number;
  progress: number;
  status: "preparing" | "uploading" | "processing" | "ready" | "error";
  error: string | null;
};

export type SubmissionAttachmentView = {
  id: string;
  originalFileName: string;
  kind: "image" | "audio" | "video" | "document";
  mimeType: string;
  sizeBytes: number;
  downloadHref: string;
};

export function SubmissionAttachmentLinks({
  attachments,
  locale,
}: {
  attachments: SubmissionAttachmentView[];
  locale: AppLocale;
}) {
  if (!attachments.length) return null;
  return (
    <div className="mt-3 divide-y divide-[#e3cbc7] border-y border-[#e3cbc7]">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={attachment.downloadHref}
          className="focus-ring flex min-h-12 items-center gap-3 px-1 py-2 text-left hover:bg-white/70"
        >
          <FileText className="size-4 shrink-0 text-[var(--theme-coral-text)]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-[var(--theme-strong-text)]">
              {attachment.originalFileName}
            </span>
            <span className="block text-[10px] text-[var(--theme-muted-text)]">
              {formatLearningFileSize(attachment.sizeBytes, locale)}
            </span>
          </span>
          <Download
            className="size-4 shrink-0 text-[var(--theme-muted-text)]"
            aria-hidden="true"
          />
        </a>
      ))}
    </div>
  );
}

export function SubmissionAttachmentUploader({
  disabled,
  locale,
  onReadinessChange,
  resetKey,
}: {
  disabled?: boolean;
  locale: AppLocale;
  onReadinessChange: (ready: boolean) => void;
  resetKey?: string;
}) {
  const copy = getLearningUiCopy(locale);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [recorderBlocking, setRecorderBlocking] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const inputRef = useRef<HTMLInputElement>(null);
  const previousResetKey = useRef(resetKey);

  const updateEntry = (clientId: string, patch: Partial<UploadEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.clientId === clientId ? { ...entry, ...patch } : entry,
      ),
    );
  };

  useEffect(() => {
    onReadinessChange(
      !recorderBlocking && entries.every((entry) => entry.status === "ready"),
    );
  }, [entries, onReadinessChange, recorderBlocking]);

  useEffect(() => {
    if (resetKey && resetKey !== previousResetKey.current) {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
      setEntries([]);
      setMessage(null);
      setRecorderBlocking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
    previousResetKey.current = resetKey;
  }, [resetKey]);

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
        purpose: "submission",
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
        error: copy("attachments.uploadError"),
      });
    } finally {
      controllers.current.delete(clientId);
    }
  };

  const enqueueFiles = (files: readonly File[]) => {
    if (!files.length) return false;
    const available = MAX_ATTACHMENTS - entries.length;
    const selected = files.slice(0, Math.max(0, available));
    if (selected.length < files.length) {
      setMessage(copy("attachments.maxFiles", { count: MAX_ATTACHMENTS }));
    } else {
      setMessage(null);
    }
    for (const file of selected) {
      const clientId = crypto.randomUUID();
      if (!file.type || file.size <= 0) {
        setEntries((current) => [
          ...current,
          {
            clientId,
            assetId: null,
            name: file.name,
            sizeBytes: file.size,
            progress: 0,
            status: "error",
            error: copy("attachments.invalidFile"),
          },
        ]);
        continue;
      }
      setEntries((current) => [
        ...current,
        {
          clientId,
          assetId: null,
          name: file.name,
          sizeBytes: file.size,
          progress: 0,
          status: "preparing",
          error: null,
        },
      ]);
      void runUpload(file, clientId);
    }
    if (inputRef.current) inputRef.current.value = "";
    return selected.length > 0;
  };

  const selectFiles = (files: FileList | null) => {
    if (!files?.length) return;
    enqueueFiles(Array.from(files));
  };

  const removeEntry = async (entry: UploadEntry) => {
    const controller = controllers.current.get(entry.clientId);
    if (entry.assetId) {
      try {
        await deleteBrowserSessionMediaAsset(entry.assetId);
      } catch {
        setMessage(copy("attachments.removeError"));
        return;
      }
    }
    controller?.abort();
    setEntries((current) =>
      current.filter((candidate) => candidate.clientId !== entry.clientId),
    );
    setMessage(null);
  };

  return (
    <div className="border-y border-[#e3cbc7] py-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--theme-strong-text)]">
          <Paperclip className="size-4" />
          {copy("attachments.title")}
          <span className="text-[10px] font-medium text-[var(--theme-coral-text)]">
            {entries.length}/{MAX_ATTACHMENTS}
          </span>
        </div>
        <label className="focus-within:ring-2 focus-within:ring-[#2b9188] focus-within:ring-offset-2 inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-[#d8bbb6] bg-white px-3 text-xs font-semibold text-[var(--theme-strong-text)] hover:bg-[var(--theme-input-background)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
          <Upload className="size-3.5" />
          {copy("attachments.choose")}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_TYPES}
            className="sr-only"
            disabled={
              disabled || recorderBlocking || entries.length >= MAX_ATTACHMENTS
            }
            onChange={(event) => selectFiles(event.target.files)}
          />
        </label>
      </div>

      <SubmissionRecorder
        disabled={Boolean(disabled) || entries.length >= MAX_ATTACHMENTS}
        locale={locale}
        resetKey={resetKey}
        onBlockingChange={setRecorderBlocking}
        onFile={(file) => enqueueFiles([file])}
      />

      {entries.length ? (
        <div className="mt-3 divide-y divide-[#ead7d3] border-y border-[#ead7d3]">
          {entries.map((entry) => (
            <div
              key={entry.clientId}
              className="flex min-h-14 items-center gap-3 py-2"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded bg-[var(--theme-layer-background)] text-[var(--theme-coral-text)]">
                {entry.status === "ready" ? (
                  <CheckCircle2 className="size-4 text-[#167e74]" />
                ) : entry.status === "error" ? (
                  <ShieldAlert className="size-4" />
                ) : (
                  <LoaderCircle className="size-4 animate-spin" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold text-[var(--theme-strong-text)]">
                  {entry.name}
                </span>
                <span
                  className="mt-0.5 block text-[10px] text-[var(--theme-muted-text)]"
                  aria-live="polite"
                >
                  {entry.status === "preparing"
                    ? copy("attachments.preparing")
                    : entry.status === "uploading"
                      ? copy("attachments.uploading", {
                          progress: entry.progress,
                        })
                      : entry.status === "processing"
                        ? copy("attachments.securityCheck")
                        : entry.status === "ready"
                          ? copy("attachments.ready", {
                              size: formatLearningFileSize(
                                entry.sizeBytes,
                                locale,
                              ),
                            })
                          : entry.error}
                </span>
                {entry.status === "uploading" ? (
                  <span className="mt-1 block h-1 overflow-hidden rounded bg-[#f0dfdc]">
                    <span
                      className="block h-full bg-[#2b9188] transition-[width]"
                      style={{ width: `${entry.progress}%` }}
                    />
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => void removeEntry(entry)}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[var(--theme-muted-text)] hover:bg-[var(--theme-input-background)] hover:text-[var(--theme-coral-text)]"
                aria-label={copy("attachments.removeNamed", {
                  name: entry.name,
                })}
                title={copy("attachments.remove")}
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
        <p className="mt-2 text-xs text-[var(--theme-coral-text)]">{message}</p>
      ) : null}
    </div>
  );
}
