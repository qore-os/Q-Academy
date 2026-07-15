"use client";

import { CheckCircle2, FileUp, LoaderCircle, Paperclip, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
  deleteBrowserSessionMediaAsset,
  uploadBrowserSessionMedia,
} from "@/lib/media/browser-session-upload";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import type { AppLocale } from "@/lib/i18n/model";

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
  const copy = getMemberExperienceCopy(locale).customFields;
  const inputId = useId();
  const controllerRef = useRef<AbortController | null>(null);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [createdAssetId, setCreatedAssetId] = useState("");
  const [fileName, setFileName] = useState(initialAssetId ? copy.currentMedia : "");
  const [status, setStatus] = useState<"idle" | "working" | "ready" | "error">(
    initialAssetId ? "ready" : "idle",
  );
  const [message, setMessage] = useState("");

  useEffect(() => () => controllerRef.current?.abort(), []);

  const select = async (file: File | undefined) => {
    if (!file || !file.type || file.size <= 0) return;
    if (createdAssetId) {
      await deleteBrowserSessionMediaAsset(createdAssetId).catch(() => undefined);
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus("working");
    setMessage(copy.uploadAndCheck);
    setFileName(file.name);
    try {
      const asset = await uploadBrowserSessionMedia({
        file,
        purpose: "profile",
        ownerUserId,
        clientUploadId: crypto.randomUUID(),
        signal: controller.signal,
        onAssetCreated: (created) => {
          setAssetId(created.id);
          setCreatedAssetId(created.id);
        },
      });
      setAssetId(asset.id);
      setCreatedAssetId(asset.id);
      setFileName(asset.originalFileName);
      setStatus("ready");
      setMessage(copy.ready);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
      setMessage(copy.uploadFailed);
    }
  };

  const remove = async () => {
    controllerRef.current?.abort();
    if (createdAssetId) {
      await deleteBrowserSessionMediaAsset(createdAssetId).catch(() => undefined);
    }
    setAssetId("");
    setCreatedAssetId("");
    setFileName("");
    setStatus("idle");
    setMessage("");
  };

  return (
    <div className="flex min-h-16 items-center gap-3 rounded-md border border-[#dce1e5] bg-white p-3">
      <input type="hidden" name={name} value={assetId} />
      <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#eef3f7] text-[#365f8d]">
        {status === "working" ? (
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
        {message ? (
          <span className={`mt-0.5 block text-[10px] ${status === "error" ? "text-[#a94339]" : "text-[#71808b]"}`} aria-live="polite">
            {message}
          </span>
        ) : null}
      </span>
      {!readOnly ? (
        <span className="flex shrink-0 gap-1">
          <label htmlFor={inputId} title={copy.uploadMedia} className="focus-within:ring-2 focus-within:ring-[#2b9188] grid size-9 cursor-pointer place-items-center rounded-md border border-[#d4dce2] text-[#365f8d] hover:bg-[#f3f7fa]">
            <FileUp className="size-4" />
            <span className="sr-only">{copy.uploadMedia}</span>
            <input id={inputId} type="file" accept={ACCEPTED_PROFILE_MEDIA} className="sr-only" onChange={(event) => void select(event.currentTarget.files?.[0])} />
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
