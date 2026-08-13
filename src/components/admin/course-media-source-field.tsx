"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  CheckCircle2,
  ImageIcon,
  Link2,
  Library,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Search,
  Trash2,
  Upload,
} from "lucide-react";

import {
  deleteBrowserSessionMediaAsset,
  isTerminalSessionMediaUploadError,
  uploadBrowserSessionMedia,
  type DirectPostUploadResume,
  type BrowserSessionTransferStatus,
} from "@/lib/media/browser-session-upload";
import { UploadTransferIndicator } from "@/components/media/upload-transfer-indicator";
import { browserUploadErrorMessage } from "@/lib/media/browser-upload";
import { SubmissionRecorder } from "@/components/academy/submission-recorder";
import { cn } from "@/lib/utils";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { getMediaUploadCopy } from "@/lib/i18n/media-upload";
import { useFileDrop } from "@/lib/use-file-drop";

type CourseMediaKind = "image" | "video" | "audio" | "file";
export type CourseMediaSelection = {
  id: string;
  originalFileName: string;
  durationMilliseconds: number | null;
};
export type CourseMediaSourceSelection =
  | { mode: "upload"; selection: CourseMediaSelection | null }
  | { mode: "library"; selection: CourseMediaSelection | null }
  | { mode: "url"; url: string }
  | { mode: "stock"; url: string };
type UploadState = "idle" | "preparing" | "uploading" | "processing" | "ready" | "error";

const ACCEPTED_TYPES: Record<CourseMediaKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/avif,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/webm",
  file: [
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].join(","),
};

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";
const AUDIO_RECORDING_MODES = ["audio"] as const;
const VIDEO_RECORDING_MODES = ["video", "screen"] as const;

function CourseMediaUpload({
  active,
  fieldName,
  initialAssetId,
  initialFileName,
  kind,
  locale,
  externalFile,
  onAssetChange,
  onAssetSelection,
}: {
  active: boolean;
  fieldName: string;
  initialAssetId?: string;
  initialFileName?: string;
  kind: CourseMediaKind;
  locale: AppLocale;
  externalFile?: File;
  onAssetChange?: (
    assetId: string | null,
    selection?: CourseMediaSelection,
  ) => void;
  onAssetSelection?: (selection: CourseMediaSelection | null) => void;
}) {
  const copy = getCourseSupportCopy(locale).media;
  const uploadCopy = getMediaUploadCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale), {
    maximumFractionDigits: 0,
  });
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const retryUploadRef = useRef<{
    file: File;
    clientUploadId: string;
    directPostResume: DirectPostUploadResume | null;
  } | null>(null);
  const newAssetIdRef = useRef("");
  const uploadedExternalFileRef = useRef<File | undefined>(undefined);
  const [assetId, setAssetId] = useState(initialAssetId ?? "");
  const [newAssetId, setNewAssetId] = useState("");
  const [fileName, setFileName] = useState(initialFileName ?? "");
  const [, setProgress] = useState(0);
  const [transferStatus, setTransferStatus] = useState<BrowserSessionTransferStatus | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [state, setState] = useState<UploadState>(initialAssetId ? "ready" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [recorderBlocking, setRecorderBlocking] = useState(false);

  useEffect(() => {
    newAssetIdRef.current = newAssetId;
  }, [newAssetId]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      const cleanupId = newAssetIdRef.current;
      if (cleanupId) {
        void deleteBrowserSessionMediaAsset(cleanupId).catch(() => undefined);
      }
    },
    [],
  );

  useEffect(() => {
    if (active || !newAssetId) return;
    const cleanupId = newAssetId;
    controllerRef.current?.abort();
    void deleteBrowserSessionMediaAsset(cleanupId)
      .catch(() => undefined)
      .finally(() => {
        setAssetId((current) => (current === cleanupId ? "" : current));
        setNewAssetId((current) => (current === cleanupId ? "" : current));
        setFileName("");
        setProgress(0);
        setTransferStatus(null);
        setState("idle");
        setError(null);
      });
  }, [active, newAssetId]);

  const remove = async () => {
    controllerRef.current?.abort();
    retryUploadRef.current = null;
    setCanRetry(false);
    if (newAssetId) {
      try {
        await deleteBrowserSessionMediaAsset(newAssetId);
      } catch {
        setError(copy.errors.remove);
        return;
      }
    }
    setAssetId("");
    setNewAssetId("");
    setFileName("");
    setProgress(0);
    setTransferStatus(null);
    setState("idle");
    setError(null);
    onAssetChange?.(null);
    onAssetSelection?.(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const select = useCallback(async (
    file: File | undefined,
    resume?: Readonly<{
      clientUploadId: string;
      directPostResume: DirectPostUploadResume | null;
    }>,
  ) => {
    if (!file) return;
    if (!file.type || file.size <= 0) {
      setState("error");
      setCanRetry(false);
      setError(copy.errors.invalidFile);
      onAssetChange?.(null);
      onAssetSelection?.(null);
      return;
    }
    controllerRef.current?.abort();
    if (!resume && newAssetId) {
      await deleteBrowserSessionMediaAsset(newAssetId).catch(() => undefined);
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
    if (!resume) {
      setAssetId("");
      setNewAssetId("");
    }
    setFileName(file.name);
    setProgress(0);
    setTransferStatus(null);
    setState("preparing");
    setError(null);
    onAssetChange?.(null);
    onAssetSelection?.(null);
    try {
      const asset = await uploadBrowserSessionMedia({
        file,
        purpose: "course_content",
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
          setNewAssetId(created.id);
        },
        onProgress: setProgress,
        onTransferStatus: setTransferStatus,
        onStage: (stage) => setState(stage),
      });
      const expectedKind = kind === "file" ? "document" : kind;
      if (asset.kind !== expectedKind) {
        await deleteBrowserSessionMediaAsset(asset.id).catch(() => undefined);
        retryUploadRef.current = null;
        setCanRetry(false);
        setState("error");
        setError(copy.errors.wrongKind);
        onAssetChange?.(null);
        onAssetSelection?.(null);
        return;
      }
      setAssetId(asset.id);
      setNewAssetId(asset.id);
      setFileName(asset.originalFileName);
      setState("ready");
      retryUploadRef.current = null;
      setCanRetry(false);
      const selection = {
        id: asset.id,
        originalFileName: asset.originalFileName,
        durationMilliseconds: asset.durationMilliseconds,
      };
      onAssetChange?.(asset.id);
      onAssetSelection?.(selection);
    } catch (uploadError) {
      if (uploadError instanceof DOMException && uploadError.name === "AbortError") return;
      if (isTerminalSessionMediaUploadError(uploadError)) {
        retryUploadRef.current = null;
        setCanRetry(false);
      }
      setState("error");
      setError(browserUploadErrorMessage(uploadError, copy.errors.upload));
      onAssetChange?.(null);
      onAssetSelection?.(null);
    }
  }, [copy.errors.invalidFile, copy.errors.upload, copy.errors.wrongKind, kind, newAssetId, onAssetChange, onAssetSelection]);

  const selectDroppedFiles = useCallback(
    (files: readonly File[]) => void select(files[0]),
    [select],
  );
  const { isDraggingFiles, fileDropProps } = useFileDrop({
    disabled: !active || recorderBlocking || state !== "idle",
    onFiles: selectDroppedFiles,
  });

  const retryUpload = () => {
    const pending = retryUploadRef.current;
    if (!pending) return;
    void select(pending.file, {
      clientUploadId: pending.clientUploadId,
      directPostResume: pending.directPostResume,
    });
  };

  useEffect(() => {
    if (!externalFile || uploadedExternalFileRef.current === externalFile) return;
    uploadedExternalFileRef.current = externalFile;
    void select(externalFile);
  }, [externalFile, select]);

  return (
    <div className={cn("space-y-3", !active && "hidden")} aria-hidden={!active}>
      <input
        type="hidden"
        name={fieldName}
        value={assetId}
        disabled={!active}
      />
      {state === "idle" ? (
        <>
          <label
            htmlFor={inputId}
            {...fileDropProps}
            className={cn(
              "focus-within:ring-2 focus-within:ring-[#2b9188] focus-within:ring-offset-2 flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-[#b8c3cb] bg-[#f8fafb] px-4 text-center",
              recorderBlocking
                ? "cursor-not-allowed opacity-45"
                : "cursor-pointer hover:border-[#6b8ead] hover:bg-[#f3f7fa]",
              isDraggingFiles && "border-[#2b9188] bg-[#edf9f7]",
            )}
          >
            <Upload className="size-5 text-[#365f8d]" />
            <span className="text-xs font-semibold text-[#354555]">
              {isDraggingFiles ? uploadCopy.dropActiveSingle : copy.selectFile}
            </span>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={ACCEPTED_TYPES[kind]}
              className="sr-only"
              disabled={!active || recorderBlocking}
              onChange={(event) => void select(event.currentTarget.files?.[0])}
            />
          </label>
          {kind === "audio" || kind === "video" ? (
            <SubmissionRecorder
              locale={locale}
              disabled={!active}
              allowedModes={
                kind === "audio"
                  ? AUDIO_RECORDING_MODES
                  : VIDEO_RECORDING_MODES
              }
              heading={
                kind === "audio"
                  ? copy.microphoneRecording
                  : copy.cameraRecording
              }
              fileRejectedMessage={copy.recordingRejected}
              onBlockingChange={setRecorderBlocking}
              onFile={(file) => {
                void select(file);
                return true;
              }}
            />
          ) : null}
        </>
      ) : (
        <div className="flex min-h-16 items-center gap-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] px-3 py-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-white text-[#365f8d]">
            {state === "ready" ? (
              <CheckCircle2 className="size-4 text-[#167e74]" />
            ) : state === "error" ? (
              <ShieldAlert className="size-4 text-[#a94339]" />
            ) : (
              <LoaderCircle className="size-4 animate-spin" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-[#354555]">
              {fileName || copy.genericMedium}
            </span>
            <span className={cn("mt-0.5 block text-[10px]", state === "error" ? "text-[#a94339]" : "text-[#71808b]")} aria-live="polite">
              {state === "preparing"
                ? copy.preparing
                : state === "uploading"
                  ? transferStatus?.kind === "determinate"
                    ? copy.uploading(numberFormatter.format(transferStatus.progress))
                    : uploadCopy.transferring
                  : state === "processing"
                    ? copy.processing
                    : state === "ready"
                      ? copy.ready
                      : error}
            </span>
            {state === "uploading" && transferStatus ? (
              <UploadTransferIndicator
                status={transferStatus}
                label={
                  transferStatus.kind === "determinate"
                    ? copy.uploading(numberFormatter.format(transferStatus.progress))
                    : uploadCopy.transferring
                }
                className="mt-1.5"
              />
            ) : null}
          </span>
          {state === "error" && canRetry ? (
            <button
              type="button"
              onClick={retryUpload}
              className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#71808b] hover:bg-white hover:text-[var(--theme-teal-text)]"
              aria-label={copy.retry}
              title={copy.retry}
            >
              <RefreshCw className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void remove()}
            className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#71808b] hover:bg-white hover:text-[#a94339]"
            aria-label={copy.remove(fileName || copy.genericMedium)}
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export function CourseMediaSourceField({
  courseId,
  defaultAssetId,
  defaultDurationMilliseconds,
  defaultFileName,
  defaultUrl,
  kind,
  label,
  defaultStockAttribution,
  stockImagesEnabled = false,
  mediaAssetIdName = "mediaAssetId",
  urlName = "url",
  allowExternalUrl = true,
  locale,
  materializeStockSelection = false,
  stockSelectionIdName = "stockImageSelectionId",
  preferredMode,
  allowInternalUrl = false,
  onAssetChange,
  onAssetSelection,
  onSourceChange,
}: {
  courseId?: string;
  defaultAssetId?: string;
  defaultDurationMilliseconds?: number | null;
  defaultFileName?: string;
  defaultUrl?: string;
  kind: CourseMediaKind;
  label: string;
  defaultStockAttribution?: string;
  stockImagesEnabled?: boolean;
  mediaAssetIdName?: string;
  urlName?: string;
  allowExternalUrl?: boolean;
  locale: AppLocale;
  materializeStockSelection?: boolean;
  stockSelectionIdName?: string;
  preferredMode?: "upload" | "url";
  allowInternalUrl?: boolean;
  onAssetChange?: (
    assetId: string | null,
    selection?: CourseMediaSelection,
  ) => void;
  onAssetSelection?: (selection: CourseMediaSelection | null) => void;
  onSourceChange?: (source: CourseMediaSourceSelection) => void;
}) {
  const copy = getCourseSupportCopy(locale).media;
  const stockAvailableForKind =
    kind === "image" && Boolean(courseId) && stockImagesEnabled;
  const libraryAvailable = Boolean(courseId);
  const [mode, setMode] = useState<"upload" | "library" | "url" | "stock">(
    defaultAssetId
      ? "upload"
      : defaultStockAttribution && stockAvailableForKind
        ? "stock"
        : defaultUrl && allowExternalUrl
          ? "url"
        : preferredMode ?? (allowExternalUrl
          ? "url"
          : "upload"),
  );
  const [stockQuery, setStockQuery] = useState("");
  const [stockResults, setStockResults] = useState<
    Array<{
      id: string;
      previewUrl: string;
      width: number;
      height: number;
      alt: string | null;
      author: string;
      attribution: string;
    }>
  >([]);
  const [stockSelection, setStockSelection] = useState<{
    selectionId: string;
    imageUrl: string;
    previewUrl: string;
    alt: string | null;
    attribution: string;
    author: string;
  } | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [materializedSelectionId, setMaterializedSelectionId] = useState("");
  const [materializedFile, setMaterializedFile] = useState<File>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySelection, setLibrarySelection] = useState<{
    id: string;
    originalFileName: string;
    actualSizeBytes: number | null;
    declaredSizeBytes: number;
    durationMilliseconds: number | null;
    createdAt: string;
  } | null>(null);
  const [libraryResults, setLibraryResults] = useState<Array<NonNullable<typeof librarySelection>>>([]);
  const [uploadSelection, setUploadSelection] =
    useState<CourseMediaSelection | null>(() =>
      defaultAssetId
        ? {
            id: defaultAssetId,
            originalFileName: defaultFileName ?? "",
            durationMilliseconds: defaultDurationMilliseconds ?? null,
          }
        : null,
    );
  const [externalUrl, setExternalUrl] = useState(
    defaultAssetId ? "" : defaultUrl ?? "",
  );

  const notifyAssetSelection = useCallback(
    (selection: CourseMediaSelection | null) => {
      onAssetChange?.(selection?.id ?? null, selection ?? undefined);
      onAssetSelection?.(selection);
    },
    [onAssetChange, onAssetSelection],
  );

  const notifySource = useCallback(
    (source: CourseMediaSourceSelection) => {
      onSourceChange?.(source);
      notifyAssetSelection(
        source.mode === "upload" || source.mode === "library"
          ? source.selection
          : null,
      );
    },
    [notifyAssetSelection, onSourceChange],
  );

  const activateMode = (nextMode: typeof mode) => {
    if (
      mode === "upload" &&
      nextMode !== "upload" &&
      uploadSelection?.id !== defaultAssetId
    ) {
      setUploadSelection(null);
    }
    setMode(nextMode);
    if (nextMode === "upload") {
      notifySource({ mode: nextMode, selection: uploadSelection });
    } else if (nextMode === "library") {
      notifySource({ mode: nextMode, selection: librarySelection });
    } else if (nextMode === "url") {
      notifySource({ mode: nextMode, url: externalUrl });
    } else {
      notifySource({
        mode: nextMode,
        url: stockSelection?.imageUrl ?? defaultUrl ?? "",
      });
    }
  };

  const searchLibrary = async (requestedQuery = libraryQuery) => {
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const params = new URLSearchParams({
        kind: kind === "file" ? "document" : kind,
        search: requestedQuery.trim(),
        limit: "30",
      });
      const response = await fetch(`/api/media-assets?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: typeof libraryResults;
      };
      if (!response.ok) throw new Error("library_failed");
      setLibraryResults(payload.data ?? []);
      setLibraryLoaded(true);
    } catch {
      setLibraryResults([]);
      setLibraryError(copy.errors.library);
    } finally {
      setLibraryLoading(false);
    }
  };

  const searchStock = async () => {
    if (!courseId || stockQuery.trim().length < 2) return;
    setStockLoading(true);
    setStockError(null);
    try {
      const params = new URLSearchParams({
        courseId,
        query: stockQuery.trim(),
        perPage: "12",
      });
      const response = await fetch(`/api/stock-images?${params}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        data?: { enabled?: boolean; results?: typeof stockResults };
        detail?: string;
      };
      if (!response.ok) throw new Error("stock_search_failed");
      if (payload.data?.enabled === false) {
        setStockResults([]);
        setStockError(copy.errors.stockUnavailable);
        return;
      }
      setStockResults(payload.data?.results ?? []);
    } catch {
      setStockResults([]);
      setStockError(copy.errors.stockSearch);
    } finally {
      setStockLoading(false);
    }
  };

  const selectStock = async (externalId: string) => {
    if (!courseId) return;
    setStockLoading(true);
    setStockError(null);
    try {
      const response = await fetch("/api/stock-images", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, externalId }),
      });
      const payload = (await response.json()) as {
        data?: typeof stockSelection;
        detail?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error("stock_selection_failed");
      }
      setStockSelection(payload.data);
      if (materializeStockSelection) {
        const materialized = await fetch(
          `/api/stock-images/${payload.data.selectionId}/content?courseId=${encodeURIComponent(courseId)}`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!materialized.ok) throw new Error("stock_materialization_failed");
        const blob = await materialized.blob();
        if (!blob.type.startsWith("image/") || blob.size <= 0) {
          throw new Error("stock_materialization_invalid");
        }
        const extension = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
          "image/avif": "avif",
          "image/gif": "gif",
        }[blob.type] ?? "img";
        setMaterializedSelectionId(payload.data.selectionId);
        setMaterializedFile(
          new File(
            [blob],
            `stock-${payload.data.selectionId}.${extension}`,
            { type: blob.type },
          ),
        );
        activateMode("upload");
      } else {
        notifySource({ mode: "stock", url: payload.data.imageUrl });
      }
    } catch {
      setStockError(copy.errors.stockSelect);
    } finally {
      setStockLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {materializeStockSelection ? (
        <input
          type="hidden"
          name={stockSelectionIdName}
          value={materializedSelectionId}
        />
      ) : null}
      <div
        role="group"
        className="inline-flex max-w-full flex-wrap rounded-md border border-[#dce1e5] bg-[#f3f5f7] p-0.5"
        aria-label={copy.source(label)}
      >
        <button
          type="button"
          onClick={() => activateMode("upload")}
          className={cn(
            "focus-ring inline-flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-semibold",
            mode === "upload" ? "bg-white text-[#294f79] shadow-sm" : "text-[#71808b]",
          )}
          aria-pressed={mode === "upload"}
          aria-label={copy.uploadLabel(label)}
        >
          <Upload className="size-3.5" />
          {copy.upload}
        </button>
        {libraryAvailable ? (
          <button
            type="button"
            onClick={() => {
              activateMode("library");
              if (!libraryLoaded && !libraryLoading) void searchLibrary("");
            }}
            className={cn(
              "focus-ring inline-flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-semibold",
              mode === "library" ? "bg-white text-[#294f79] shadow-sm" : "text-[#71808b]",
            )}
            aria-pressed={mode === "library"}
            aria-label={copy.useLibrary}
          >
            <Library className="size-3.5" />
            {copy.library}
          </button>
        ) : null}
        {stockAvailableForKind ? (
          <button
            type="button"
            onClick={() => activateMode("stock")}
            className={cn(
              "focus-ring inline-flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-semibold",
              mode === "stock" ? "bg-white text-[#294f79] shadow-sm" : "text-[#71808b]",
            )}
            aria-pressed={mode === "stock"}
            aria-label={copy.useStock}
          >
            <ImageIcon className="size-3.5" />
            {copy.stock}
          </button>
        ) : null}
        {allowExternalUrl ? <button
          type="button"
          onClick={() => activateMode("url")}
          className={cn(
            "focus-ring inline-flex h-8 items-center justify-center gap-2 rounded px-3 text-xs font-semibold",
            mode === "url" ? "bg-white text-[#294f79] shadow-sm" : "text-[#71808b]",
          )}
          aria-pressed={mode === "url"}
          aria-label={copy.externalUrl(label)}
        >
          <Link2 className="size-3.5" />
          {copy.url}
        </button> : null}
      </div>
      <CourseMediaUpload
        active={mode === "upload"}
        fieldName={mediaAssetIdName}
        initialAssetId={defaultAssetId}
        initialFileName={defaultFileName}
        kind={kind}
        locale={locale}
        externalFile={materializedFile}
        onAssetSelection={(selection) => {
          setUploadSelection(selection);
          if (mode === "upload") {
            notifySource({ mode: "upload", selection });
          }
        }}
      />
      {libraryAvailable ? (
        <div className={cn("space-y-3", mode !== "library" && "hidden")} aria-hidden={mode !== "library"}>
          <input
            type="hidden"
            name={mediaAssetIdName}
            value={librarySelection?.id ?? ""}
            disabled={mode !== "library"}
          />
          <div className="flex gap-2">
            <input
              type="search"
              value={libraryQuery}
              onChange={(event) => setLibraryQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchLibrary();
                }
              }}
              maxLength={100}
              placeholder={copy.searchLibrary}
              className={inputClass}
              disabled={mode !== "library" || libraryLoading}
            />
            <button
              type="button"
              onClick={() => void searchLibrary()}
              disabled={libraryLoading}
              className="focus-ring grid size-10 shrink-0 place-items-center rounded-md border border-[#dce1e5] bg-white text-[#294f79] disabled:opacity-45"
              aria-label={copy.searchLibrary}
              title={copy.search}
            >
              {libraryLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            </button>
          </div>
          {libraryError ? <p role="alert" className="text-xs text-[#a94339]">{libraryError}</p> : null}
          {librarySelection ? (
            <p role="status" className="truncate rounded-md border border-[#b9ddd8] bg-[#eff9f7] px-3 py-2 text-xs font-semibold text-[#176f68]">
              {librarySelection.originalFileName}
            </p>
          ) : null}
          {libraryLoaded && !libraryLoading && !libraryResults.length ? (
            <p className="rounded-md border border-dashed border-[#cbd5dc] px-3 py-5 text-center text-xs text-[#71808b]">{copy.emptyLibrary}</p>
          ) : null}
          {libraryResults.length ? (
            <div className="max-h-72 divide-y divide-[#e5e9ec] overflow-y-auto rounded-md border border-[#dce1e5] bg-white">
              {libraryResults.map((asset) => {
                const size = asset.actualSizeBytes ?? asset.declaredSizeBytes;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      setLibrarySelection(asset);
                      const selection = {
                        id: asset.id,
                        originalFileName: asset.originalFileName,
                        durationMilliseconds: asset.durationMilliseconds,
                      };
                      notifySource({ mode: "library", selection });
                    }}
                    className={cn(
                      "focus-ring flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#f3f7fa]",
                      librarySelection?.id === asset.id && "bg-[#eff9f7]",
                    )}
                    aria-label={copy.selectLibraryAsset(asset.originalFileName)}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-[#eef3f7] text-[#365f8d]"><Library className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-[#354555]">{asset.originalFileName}</span>
                      <span className="mt-0.5 block text-[10px] text-[#71808b]">
                        {new Intl.NumberFormat(intlLocale(locale), {
                          style: "unit",
                          unit: "megabyte",
                          unitDisplay: "short",
                          maximumFractionDigits: 1,
                        }).format(size / 1024 / 1024)}
                      </span>
                    </span>
                    {librarySelection?.id === asset.id ? <CheckCircle2 className="size-4 shrink-0 text-[#167e74]" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {allowExternalUrl ? <div className={cn(mode !== "url" && "hidden")} aria-hidden={mode !== "url"}>
        <input
          name={urlName}
          type={allowInternalUrl ? "text" : "url"}
          required={mode === "url"}
          disabled={mode !== "url"}
          maxLength={2_000}
          value={externalUrl}
          onChange={(event) => {
            const nextUrl = event.currentTarget.value;
            setExternalUrl(nextUrl);
            notifySource({ mode: "url", url: nextUrl });
          }}
          placeholder="https://..."
          className={inputClass}
          aria-label={copy.urlLabel(label)}
        />
      </div> : null}
      {stockAvailableForKind ? (
        <div className={cn("min-w-0 space-y-3", mode !== "stock" && "hidden")} aria-hidden={mode !== "stock"}>
          <input
            type="hidden"
            name={urlName}
            value={stockSelection?.imageUrl ?? defaultUrl ?? ""}
            disabled={mode !== "stock"}
          />
          {!materializeStockSelection ? (
            <input
              type="hidden"
              name={stockSelectionIdName}
              value={stockSelection?.selectionId ?? ""}
              disabled={mode !== "stock"}
            />
          ) : null}
          <div className="flex gap-2">
            <input
              type="search"
              value={stockQuery}
              onChange={(event) => setStockQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void searchStock();
                }
              }}
              maxLength={100}
              placeholder={copy.searchStock}
              className={inputClass}
              disabled={mode !== "stock" || stockLoading}
            />
            <button
              type="button"
              onClick={() => void searchStock()}
              disabled={stockLoading || stockQuery.trim().length < 2}
              className="focus-ring grid size-10 shrink-0 place-items-center rounded-md border border-[#dce1e5] bg-white text-[#294f79] disabled:opacity-45"
              aria-label={copy.searchStock}
              title={copy.search}
            >
              {stockLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Search className="size-4" />}
            </button>
          </div>
          {stockSelection || defaultStockAttribution ? (
            <div className="min-w-0 break-words rounded-md border border-[#b9ddd8] bg-[#eff9f7] px-3 py-2 text-xs text-[#176f68] [overflow-wrap:anywhere]">
              {stockSelection?.attribution ?? defaultStockAttribution}
            </div>
          ) : null}
          {stockError ? <p role="alert" className="text-xs text-[#a94339]">{stockError}</p> : null}
          {stockResults.length ? (
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
              {stockResults.map((image) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => void selectStock(image.id)}
                  disabled={stockLoading}
                  className="focus-ring min-w-0 overflow-hidden rounded-md border border-[#dce1e5] bg-white text-left hover:border-[#2b9188]"
                  title={image.attribution}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.previewUrl} alt={image.alt ?? ""} className="aspect-[4/3] w-full object-cover" />
                  <span className="block min-w-0 truncate px-2 py-1.5 text-[10px] text-[#5f6f7b]">{image.author}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
