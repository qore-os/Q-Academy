"use client";

import {
  CheckCircle2,
  FileUp,
  LoaderCircle,
  Paperclip,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

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
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { getMediaUploadCopy } from "@/lib/i18n/media-upload";
import type { AppLocale } from "@/lib/i18n/model";
import { useFileDrop } from "@/lib/use-file-drop";
import { cn } from "@/lib/utils";

const ACCEPTED_PROFILE_MEDIA = [
  "image/jpeg", "image/png", "image/webp", "image/avif", "image/gif",
  "audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg", "audio/webm",
  "video/mp4", "video/webm", "video/quicktime",
  "application/pdf", "text/plain", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");

export function ProfileMediaAssetField({
  name,
  ownerUserId,
  initialAssetId,
  readOnly,
  locale,
}: {
  name: string;
  ownerUserId?: string;
  initialAssetId?: string | null;
  readOnly: boolean;
  locale: AppLocale;
}) {
  const experienceCopy = getMemberExperienceCopy(locale);
  const copy = experienceCopy.customFields;
  const mediaCopy = experienceCopy.media;
  const uploadCopy = getMediaUploadCopy(locale);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const createdAssetIdRef = useRef("");
  const retryUploadRef = useRef<{
    file: File;
    clientUploadId: string;
    directPostResume: DirectPostUploadResume | null;
  } | null>(null);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [createdAssetId, setCreatedAssetId] = useState("");
  const [fileName, setFileName] = useState(initialAssetId ? copy.currentMedia : "");
  const [status, setStatus] = useState<
    "idle" | "preparing" | "uploading" | "processing" | "ready" | "error"
  >(initialAssetId ? "ready" : "idle");
  const [, setProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState<BrowserSessionTransferStatus | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    createdAssetIdRef.current = createdAssetId;
  }, [createdAssetId]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (createdAssetIdRef.current) {
        discardBrowserSessionMediaAsset(createdAssetIdRef.current);
      }
    },
    [],
  );

  const select = async (
    file: File | undefined,
    resume?: Readonly<{
      clientUploadId: string;
      directPostResume: DirectPostUploadResume | null;
    }>,
  ) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file || !file.type || file.size <= 0) return;
    controllerRef.current?.abort();
    if (!resume && createdAssetId) {
      await deleteBrowserSessionMediaAsset(createdAssetId).catch(() => undefined);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const clientUploadId = resume?.clientUploadId ?? crypto.randomUUID();
    retryUploadRef.current = {
      file,
      clientUploadId,
      directPostResume: resume?.directPostResume ?? null,
    };
    setCanRetry(true);
    setStatus("preparing");
    setProgress(0);
    setTransferStatus(null);
    setMessage(mediaCopy.preparing);
    setFileName(file.name);
    try {
      const asset = await uploadBrowserSessionMedia({
        file,
        purpose: "profile",
        ownerUserId,
        clientUploadId,
        directPostResume: resume?.directPostResume,
        onDirectPostResumeChange: (directPostResume) => {
          if (retryUploadRef.current?.clientUploadId === clientUploadId) {
            retryUploadRef.current = {
              ...retryUploadRef.current,
              directPostResume,
            };
          }
        },
        signal: controller.signal,
        onAssetCreated: (created) => {
          setAssetId(created.id);
          setCreatedAssetId(created.id);
        },
        onProgress: setProgress,
        onTransferStatus: setTransferStatus,
        onStage: (stage) => {
          setStatus(stage);
          setMessage(
            stage === "preparing"
              ? mediaCopy.preparing
              : stage === "processing"
                ? mediaCopy.securityCheck
                : copy.uploadAndCheck,
          );
        },
      });
      setAssetId(asset.id);
      setCreatedAssetId(asset.id);
      setFileName(asset.originalFileName);
      setStatus("ready");
      setMessage(copy.ready);
      retryUploadRef.current = null;
      setCanRetry(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isTerminalSessionMediaUploadError(error)) {
        retryUploadRef.current = null;
        setCanRetry(false);
      }
      setStatus("error");
      setMessage(browserUploadErrorMessage(error, copy.uploadFailed));
    }
  };

  const retryUpload = () => {
    const pending = retryUploadRef.current;
    if (!pending) return;
    void select(pending.file, {
      clientUploadId: pending.clientUploadId,
      directPostResume: pending.directPostResume,
    });
  };

  const remove = async () => {
    controllerRef.current?.abort();
    retryUploadRef.current = null;
    setCanRetry(false);
    if (createdAssetId) {
      await deleteBrowserSessionMediaAsset(createdAssetId).catch(() => undefined);
    }
    setAssetId("");
    setCreatedAssetId("");
    setFileName("");
    setStatus("idle");
    setProgress(0);
    setTransferStatus(null);
    setMessage("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const { isDraggingFiles, fileDropProps } = useFileDrop({
    disabled: readOnly || ["preparing", "uploading", "processing"].includes(status),
    onFiles: (files) => void select(files[0]),
  });

  return (
    <div
      {...fileDropProps}
      className={cn(
        "flex min-h-16 items-center gap-3 rounded-md border border-[#dce1e5] bg-white p-3 transition-colors",
        isDraggingFiles && "border-[#2b9188] bg-[#edf9f7]",
      )}
    >
      <input type="hidden" name={name} value={assetId} />
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f7] text-[#365f8d]">
        {["preparing", "uploading", "processing"].includes(status) ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : status === "ready" ? (
          <CheckCircle2 className="size-4 text-[#167e74]" />
        ) : (
          <Paperclip className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {assetId ? (
          <a
            href={`/api/media-assets/${assetId}/download`}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-xs font-bold text-[#365f8d] hover:underline"
          >
            {fileName || copy.viewMedia}
          </a>
        ) : (
          <span className="block text-xs font-semibold text-[#657580]">{copy.noMedia}</span>
        )}
        {message || isDraggingFiles ? (
          <span className={`mt-0.5 block text-[10px] ${status === "error" ? "text-[#a94339]" : "text-[#71808b]"}`} aria-live="polite">
            {isDraggingFiles
              ? uploadCopy.dropActiveSingle
              : status === "uploading"
                ? transferStatus?.kind === "determinate"
                  ? mediaCopy.uploading(transferStatus.progress)
                  : uploadCopy.transferring
              : message}
          </span>
        ) : null}
        {status === "uploading" && transferStatus ? (
          <UploadTransferIndicator
            status={transferStatus}
            label={
              transferStatus.kind === "determinate"
                ? mediaCopy.uploading(transferStatus.progress)
                : uploadCopy.transferring
            }
            className="mt-1.5"
          />
        ) : null}
      </span>
      {!readOnly ? (
        <span className="flex shrink-0 gap-1">
          {status === "error" && canRetry ? (
            <button
              type="button"
              onClick={retryUpload}
              title={copy.uploadMedia}
              aria-label={copy.uploadMedia}
              className="focus-ring grid size-9 place-items-center rounded-md text-[#71808b] hover:bg-[#f3f7fa] hover:text-[var(--theme-teal-text)]"
            >
              <RefreshCw className="size-4" />
            </button>
          ) : null}
          <label htmlFor={inputId} title={copy.uploadMedia} className="focus-within:ring-2 focus-within:ring-[#2b9188] grid size-9 cursor-pointer place-items-center rounded-md border border-[#d4dce2] text-[#365f8d] hover:bg-[#f3f7fa]">
            <FileUp className="size-4" />
            <span className="sr-only">{copy.uploadMedia}</span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={ACCEPTED_PROFILE_MEDIA}
              className="sr-only"
              onChange={(event) => void select(event.currentTarget.files?.[0])}
            />
          </label>
          {assetId ? (
            <button type="button" onClick={() => void remove()} title={copy.removeMedia} aria-label={copy.removeMedia} className="focus-ring grid size-9 place-items-center rounded-md text-[#71808b] hover:bg-[#fdf0ee] hover:text-[#a94339]">
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
