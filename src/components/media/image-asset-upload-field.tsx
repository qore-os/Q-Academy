"use client";

import { CheckCircle2, LoaderCircle, RefreshCw, ShieldAlert, Trash2, Upload } from "lucide-react";
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

type ImagePurpose = "avatar" | "branding";
type UploadState =
  | "idle"
  | "preparing"
  | "uploading"
  | "processing"
  | "ready"
  | "error";

const RASTER_IMAGE_TYPES = "image/jpeg,image/png,image/webp,image/avif";

export function ImageAssetUploadField({
  name,
  label,
  purpose,
  initialAssetId,
  initialSource,
  allowIcon = false,
  disabled = false,
  locale,
  previewClassName,
  onSourceChange,
}: {
  name: string;
  label: string;
  purpose: ImagePurpose;
  initialAssetId?: string | null;
  initialSource?: string | null;
  allowIcon?: boolean;
  disabled?: boolean;
  locale: AppLocale;
  previewClassName?: string;
  onSourceChange?: (source: string | null) => void;
}) {
  const copy = getMemberExperienceCopy(locale).media;
  const uploadCopy = getMediaUploadCopy(locale);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const newAssetIdRef = useRef("");
  const retryUploadRef = useRef<{
    file: File;
    clientUploadId: string;
    directPostResume: DirectPostUploadResume | null;
  } | null>(null);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [newAssetId, setNewAssetId] = useState("");
  const [source, setSource] = useState(initialSource ?? null);
  const [fileName, setFileName] = useState("");
  const [state, setState] = useState<UploadState>(
    initialSource ? "ready" : "idle",
  );
  const [, setProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState<BrowserSessionTransferStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [clear, setClear] = useState(false);

  const replaceObjectUrl = (next: string | null) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = next;
  };

  useEffect(() => {
    newAssetIdRef.current = newAssetId;
  }, [newAssetId]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (newAssetIdRef.current) {
        discardBrowserSessionMediaAsset(newAssetIdRef.current);
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
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
    if (!file) return;
    if (!file.type || file.size <= 0) {
      setState("error");
      setError(copy.invalidFile);
      return;
    }
    controllerRef.current?.abort();
    if (!resume && newAssetId) {
      await deleteBrowserSessionMediaAsset(newAssetId).catch(() => undefined);
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const objectUrl = URL.createObjectURL(file);
    replaceObjectUrl(objectUrl);
    setSource(objectUrl);
    onSourceChange?.(objectUrl);
    setNewAssetId("");
    setFileName(file.name);
    setProgress(0);
    setTransferStatus(null);
    setState("preparing");
    setError(null);
    setClear(false);
    const clientUploadId = resume?.clientUploadId ?? crypto.randomUUID();
    retryUploadRef.current = {
      file,
      clientUploadId,
      directPostResume: resume?.directPostResume ?? null,
    };
    setCanRetry(true);
    try {
      const ready = await uploadBrowserSessionMedia({
        file,
        purpose,
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
        onAssetCreated: (asset) => setNewAssetId(asset.id),
        onProgress: setProgress,
        onTransferStatus: setTransferStatus,
        onStage: setState,
      });
      if (ready.kind !== "image") {
        await deleteBrowserSessionMediaAsset(ready.id).catch(() => undefined);
        throw new Error(copy.imageRequired);
      }
      setAssetId(ready.id);
      setNewAssetId(ready.id);
      setFileName(ready.originalFileName);
      setState("ready");
      retryUploadRef.current = null;
      setCanRetry(false);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        return;
      }
      if (isTerminalSessionMediaUploadError(uploadError)) {
        retryUploadRef.current = null;
        setCanRetry(false);
      }
      setState("error");
      setError(browserUploadErrorMessage(uploadError, copy.uploadFailed));
    }
  };

  const remove = async () => {
    controllerRef.current?.abort();
    retryUploadRef.current = null;
    setCanRetry(false);
    if (newAssetId) {
      try {
        await deleteBrowserSessionMediaAsset(newAssetId);
      } catch {
        setError(
          copy.removeFailed,
        );
        setState("error");
        return;
      }
    }
    replaceObjectUrl(null);
    setAssetId("");
    setNewAssetId("");
    setSource(null);
    setFileName("");
    setProgress(0);
    setTransferStatus(null);
    setState("idle");
    setError(null);
    setClear(true);
    onSourceChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const retryUpload = () => {
    const pending = retryUploadRef.current;
    if (!pending) return;
    void select(pending.file, {
      clientUploadId: pending.clientUploadId,
      directPostResume: pending.directPostResume,
    });
  };

  const { isDraggingFiles, fileDropProps } = useFileDrop({
    disabled: disabled || ["preparing", "uploading", "processing"].includes(state),
    onFiles: (files) => void select(files[0]),
  });

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={assetId} />
      <input type="hidden" name={`${name}Clear`} value={clear ? "true" : "false"} />
      <span className="block text-xs font-semibold text-[#52606d]">{label}</span>
      <div
        {...fileDropProps}
        className={cn(
          "brand-radius flex min-h-20 min-w-0 items-center gap-3 border border-[#dce1e5] bg-[#f8fafb] p-3 transition-colors",
          isDraggingFiles && "border-[#2b9188] bg-[#edf9f7]",
        )}
      >
        <span
          className={cn(
            "brand-radius grid size-14 shrink-0 place-items-center overflow-hidden border border-[#e3e8eb] bg-white text-[#82909b]",
            previewClassName,
          )}
        >
          {source ? (
            // eslint-disable-next-line @next/next/no-img-element -- Same-origin checked media or a local object URL selected by the user.
            <img src={source} alt={copy.preview(label)} className="size-full object-contain" />
          ) : (
            <Upload className="size-5" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[#354555]">
            {fileName || (source ? copy.currentImage : copy.noImage)}
          </span>
          <span
            className={cn(
              "mt-1 block text-[10px]",
              state === "error" ? "text-[#a94339]" : "text-[#71808b]",
            )}
            aria-live="polite"
          >
            {isDraggingFiles
              ? uploadCopy.dropActiveSingle
              : state === "preparing"
                ? copy.preparing
              : state === "uploading"
                  ? transferStatus?.kind === "determinate"
                    ? copy.uploading(transferStatus.progress)
                    : uploadCopy.transferring
                : state === "processing"
                  ? copy.securityCheck
                  : state === "ready"
                    ? copy.ready
                    : state === "error"
                      ? error
                      : copy.formats}
          </span>
          {state === "uploading" && transferStatus ? (
            <UploadTransferIndicator
              status={transferStatus}
              label={
                transferStatus.kind === "determinate"
                  ? copy.uploading(transferStatus.progress)
                  : uploadCopy.transferring
              }
              className="mt-2"
            />
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {state === "error" && canRetry ? (
            <button
              type="button"
              onClick={retryUpload}
              disabled={disabled}
              className="focus-ring grid size-9 place-items-center rounded-md text-[#71808b] hover:bg-[#edf9f7] hover:text-[var(--theme-teal-text)] disabled:opacity-50"
              aria-label={copy.upload(label)}
              title={copy.upload(label)}
            >
              <RefreshCw className="size-4" />
            </button>
          ) : null}
          <label
            htmlFor={inputId}
            className={cn(
              "focus-within:ring-2 focus-within:ring-[#2b9188] focus-within:ring-offset-2 grid size-9 cursor-pointer place-items-center rounded-md border border-[#d4dce2] bg-white text-[#365f8d] hover:bg-[#f3f7fa]",
              disabled && "cursor-not-allowed opacity-50",
            )}
            title={copy.upload(label)}
          >
            {state === "preparing" || state === "uploading" || state === "processing" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : state === "error" ? (
              <ShieldAlert className="size-4" />
            ) : state === "ready" ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <Upload className="size-4" />
            )}
            <span className="sr-only">{copy.upload(label)}</span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={allowIcon ? `${RASTER_IMAGE_TYPES},image/vnd.microsoft.icon` : RASTER_IMAGE_TYPES}
              className="sr-only"
              disabled={disabled}
              onChange={(event) => void select(event.currentTarget.files?.[0])}
            />
          </label>
          {source || newAssetId ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={disabled}
              className="focus-ring grid size-9 place-items-center rounded-md text-[#71808b] hover:bg-[#fdf0ee] hover:text-[#a94339] disabled:opacity-50"
              aria-label={copy.remove(label)}
              title={copy.remove(label)}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
