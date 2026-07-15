"use client";

import { CheckCircle2, LoaderCircle, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  deleteBrowserSessionMediaAsset,
  uploadBrowserSessionMedia,
} from "@/lib/media/browser-session-upload";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import type { AppLocale } from "@/lib/i18n/model";
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
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [newAssetId, setNewAssetId] = useState("");
  const [source, setSource] = useState(initialSource ?? null);
  const [fileName, setFileName] = useState("");
  const [state, setState] = useState<UploadState>(
    initialSource ? "ready" : "idle",
  );
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [clear, setClear] = useState(false);

  const replaceObjectUrl = (next: string | null) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = next;
  };

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  const select = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type || file.size <= 0) {
      setState("error");
      setError(copy.invalidFile);
      return;
    }
    if (newAssetId) {
      await deleteBrowserSessionMediaAsset(newAssetId).catch(() => undefined);
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const objectUrl = URL.createObjectURL(file);
    replaceObjectUrl(objectUrl);
    setSource(objectUrl);
    onSourceChange?.(objectUrl);
    setNewAssetId("");
    setFileName(file.name);
    setProgress(0);
    setState("preparing");
    setError(null);
    setClear(false);
    try {
      const ready = await uploadBrowserSessionMedia({
        file,
        purpose,
        clientUploadId: crypto.randomUUID(),
        signal: controller.signal,
        onAssetCreated: (asset) => setNewAssetId(asset.id),
        onProgress: setProgress,
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
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") {
        return;
      }
      setState("error");
      setError(
        uploadError instanceof Error && uploadError.message === copy.imageRequired
          ? uploadError.message
          : copy.uploadFailed,
      );
    }
  };

  const remove = async () => {
    controllerRef.current?.abort();
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
    setState("idle");
    setError(null);
    setClear(true);
    onSourceChange?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="space-y-2">
      <input type="hidden" name={name} value={assetId} />
      <input type="hidden" name={`${name}Clear`} value={clear ? "true" : "false"} />
      <span className="block text-xs font-semibold text-[#52606d]">{label}</span>
      <div className="brand-radius flex min-h-20 min-w-0 items-center gap-3 border border-[#dce1e5] bg-[#f8fafb] p-3">
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
            {state === "preparing"
              ? copy.preparing
              : state === "uploading"
                ? copy.uploading(progress)
                : state === "processing"
                  ? copy.securityCheck
                  : state === "ready"
                    ? copy.ready
                    : state === "error"
                      ? error
                      : copy.formats}
          </span>
          {state === "uploading" ? (
            <span className="mt-2 block h-1 overflow-hidden rounded bg-[#dfe7ed]">
              <span
                className="block h-full bg-[#2b9188] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1">
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
