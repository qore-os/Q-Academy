"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";

import {
  deleteBrowserSessionMediaAsset,
  discardBrowserSessionMediaAsset,
  isTerminalSessionMediaUploadError,
  uploadBrowserSessionMedia,
  type DirectPostUploadResume,
  type BrowserSessionTransferStatus,
} from "@/lib/media/browser-session-upload";
import { UploadTransferIndicator } from "@/components/media/upload-transfer-indicator";
import { browserUploadErrorMessage } from "@/lib/media/browser-upload";
import { SubmissionRecorder } from "@/components/academy/submission-recorder";
import {
  formatLearningFileSize,
  getLearningUiCopy,
} from "@/lib/i18n/learning";
import { getMediaUploadCopy } from "@/lib/i18n/media-upload";
import type { AppLocale } from "@/lib/i18n/model";
import { useFileDrop } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

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
  file: File;
  clientId: string;
  assetId: string | null;
  name: string;
  sizeBytes: number;
  progress: number;
  transferStatus: BrowserSessionTransferStatus | null;
  status: "preparing" | "uploading" | "processing" | "ready" | "error";
  error: string | null;
  retryable: boolean;
  directPostResume: DirectPostUploadResume | null;
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
  const uploadCopy = getMediaUploadCopy(locale);
  const [entries, setEntries] = useState<UploadEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [recorderBlocking, setRecorderBlocking] = useState(false);
  const controllers = useRef(new Map<string, AbortController>());
  const directPostResumeRef = useRef(
    new Map<string, DirectPostUploadResume | null>(),
  );
  const entriesRef = useRef(entries);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousResetKey = useRef(resetKey);

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

  useEffect(() => {
    onReadinessChange(
      !recorderBlocking && entries.every((entry) => entry.status === "ready"),
    );
  }, [entries, onReadinessChange, recorderBlocking]);

  useEffect(() => {
    if (resetKey && resetKey !== previousResetKey.current) {
      for (const controller of controllers.current.values()) controller.abort();
      controllers.current.clear();
      directPostResumeRef.current.clear();
      for (const entry of entriesRef.current) {
        if (entry.assetId) discardBrowserSessionMediaAsset(entry.assetId);
      }
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
      directPostResumeRef.current.clear();
      for (const entry of entriesRef.current) {
        if (entry.assetId) discardBrowserSessionMediaAsset(entry.assetId);
      }
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
        directPostResume: directPostResumeRef.current.get(clientId) ?? null,
        onDirectPostResumeChange: (directPostResume) => {
          directPostResumeRef.current.set(clientId, directPostResume);
          updateEntry(clientId, { directPostResume });
        },
        signal: controller.signal,
        onAssetCreated: (asset) => {
          assetId = asset.id;
          updateEntry(clientId, { assetId: asset.id });
        },
        onProgress: (progress) => updateEntry(clientId, { progress }),
        onTransferStatus: (transferStatus) =>
          updateEntry(clientId, { transferStatus }),
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
      updateEntry(clientId, { status: "ready", error: null, retryable: false });
      directPostResumeRef.current.delete(clientId);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      updateEntry(clientId, {
        assetId,
        status: "error",
        retryable: !isTerminalSessionMediaUploadError(error),
        error: browserUploadErrorMessage(
          error,
          copy("attachments.uploadError"),
        ),
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
            file,
            clientId,
            assetId: null,
            name: file.name,
            sizeBytes: file.size,
            progress: 0,
            transferStatus: null,
            status: "error",
            error: copy("attachments.invalidFile"),
            retryable: false,
            directPostResume: null,
          },
        ]);
        continue;
      }
      setEntries((current) => [
        ...current,
        {
          file,
          clientId,
          assetId: null,
          name: file.name,
          sizeBytes: file.size,
          progress: 0,
          transferStatus: null,
          status: "preparing",
          error: null,
          retryable: true,
          directPostResume: null,
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
    controller?.abort();
    directPostResumeRef.current.delete(entry.clientId);
    if (entry.assetId) {
      try {
        await deleteBrowserSessionMediaAsset(entry.assetId);
      } catch {
        setMessage(copy("attachments.removeError"));
        return;
      }
    }
    setEntries((current) =>
      current.filter((candidate) => candidate.clientId !== entry.clientId),
    );
    setMessage(null);
  };

  const retryEntry = (entry: UploadEntry) => {
    if (controllers.current.has(entry.clientId)) return;
    updateEntry(entry.clientId, {
      progress: 0,
      transferStatus: null,
      status: "preparing",
      error: null,
      retryable: true,
    });
    void runUpload(entry.file, entry.clientId);
  };

  const { isDraggingFiles, fileDropProps } = useFileDrop({
    disabled: Boolean(disabled) || recorderBlocking || entries.length >= MAX_ATTACHMENTS,
    multiple: true,
    onFiles: enqueueFiles,
  });

  return (
    <div
      {...fileDropProps}
      className={cn(
        "border-y border-[#e3cbc7] py-3 transition-colors",
        isDraggingFiles && "border-[#2b9188] bg-[#edf9f7]",
      )}
    >
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--theme-strong-text)]">
          <Paperclip className="size-4" />
          {isDraggingFiles ? uploadCopy.dropActiveMultiple : copy("attachments.title")}
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
                      ? entry.transferStatus?.kind === "determinate"
                        ? copy("attachments.uploading", {
                            progress: entry.transferStatus.progress,
                          })
                        : uploadCopy.transferring
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
                {entry.status === "uploading" && entry.transferStatus ? (
                  <UploadTransferIndicator
                    status={entry.transferStatus}
                    label={
                      entry.transferStatus.kind === "determinate"
                        ? copy("attachments.uploading", {
                            progress: entry.transferStatus.progress,
                          })
                        : uploadCopy.transferring
                    }
                    className="mt-1 bg-[#f0dfdc]"
                  />
                ) : null}
              </span>
              {entry.status === "error" && entry.retryable && entry.file.type && entry.file.size > 0 ? (
                <button
                  type="button"
                  onClick={() => retryEntry(entry)}
                  className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[var(--theme-muted-text)] hover:bg-[var(--theme-input-background)] hover:text-[var(--theme-teal-text)]"
                  aria-label={copy("attachments.retryNamed", {
                    name: entry.name,
                  })}
                  title={copy("attachments.retry")}
                  disabled={disabled}
                >
                  <RefreshCw className="size-4" />
                </button>
              ) : null}
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
