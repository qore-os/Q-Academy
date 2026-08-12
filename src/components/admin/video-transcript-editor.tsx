"use client";

import {
  Captions,
  Check,
  Download,
  Film,
  ImageIcon,
  LoaderCircle,
  Music2,
  Play,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  parseWebVttTranscript,
  serializeWebVttTranscript,
} from "@/lib/content-blocks/video-transcript";
import {
  exportWebVttTranscript,
  importWebVttTranscriptFile,
  MAX_WEB_VTT_FILE_BYTES,
  WebVttFileImportError,
  webVttExportFileName,
} from "@/lib/content-blocks/transcript-file";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { getVideoCutsCopy } from "@/lib/i18n/video-cuts";
import { getVideoCompositionCopy } from "@/lib/i18n/video-composition";
import { getVideoWorkflowCopy } from "@/lib/i18n/video-workflow";
import {
  CourseMediaSourceField,
  type CourseMediaSelection,
} from "@/components/admin/course-media-source-field";
import {
  MAX_VIDEO_COMPOSITION_AUDIO_TRACKS,
  sanitizeVideoComposition,
} from "@/lib/media/video-composition";
import { sanitizeVideoEndCard } from "@/lib/media/video-end-card";
import {
  playbackPositionAfterRemovedSegment,
  sanitizeVideoPlaybackPolicy,
  videoEditPlanFromPlaybackPolicy,
  videoPlaybackPolicyFromForm,
  videoPlaybackPolicyHasEdits,
} from "@/lib/media/video-playback-policy";
import {
  exactVideoThumbnailJobStatus,
  sanitizeVideoPoster,
  type ExactVideoThumbnailJobStatus,
  type VideoPoster,
} from "@/lib/media/video-poster";
import {
  TRANSCRIPT_POLLING_MAXIMUM_MS,
  waitForAbortableDelay,
} from "@/lib/media/browser-async-retry";

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#d5dde3] bg-white px-3 text-sm";
const textareaClass =
  "focus-ring min-h-48 w-full rounded-md border border-[#d5dde3] bg-white p-3 font-mono text-xs leading-5";
type AsyncAssetScope = {
  assetId: string;
  controller: AbortController;
};
type PosterFrameState = {
  assetId: string;
  atMilliseconds: number;
  jobId: string | null;
  status: ExactVideoThumbnailJobStatus;
};

export function VideoTranscriptEditor({
  transcript,
  transcriptLanguage,
  playbackPolicy,
  endCard,
  composition,
  poster,
  description,
  descriptionIntent,
  sourceUrl,
  sourceAssetId,
  sourceDurationMilliseconds,
  automaticallyLoadTranscript = false,
  serverProcessingEnabled = true,
  courseId,
  blockId,
  locale,
  onDescriptionPendingChange,
  onPosterPendingChange,
}: {
  transcript?: unknown;
  transcriptLanguage?: string;
  playbackPolicy?: unknown;
  endCard?: unknown;
  composition?: unknown;
  poster?: unknown;
  description?: string;
  descriptionIntent?: "automatic" | "touched";
  sourceUrl?: string;
  sourceAssetId?: string;
  sourceDurationMilliseconds?: number | null;
  automaticallyLoadTranscript?: boolean;
  serverProcessingEnabled?: boolean;
  courseId: string;
  blockId: string;
  locale: AppLocale;
  onDescriptionPendingChange?: (pending: boolean) => void;
  onPosterPendingChange?: (pending: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptFileRef = useRef<HTMLInputElement>(null);
  const copy = getCourseParityCopy(locale).video;
  const cutsCopy = getVideoCutsCopy(locale);
  const compositionCopy = getVideoCompositionCopy(locale);
  const workflowCopy = getVideoWorkflowCopy(locale);
  const secondsFormatter = useMemo(
    () =>
      new Intl.NumberFormat(intlLocale(locale), {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const persistedLanguage = transcriptLanguage?.trim().toLowerCase();
  const embeddedLanguage =
    typeof transcript === "object" &&
    transcript !== null &&
    "language" in transcript &&
    typeof transcript.language === "string"
      ? transcript.language.trim().toLowerCase()
      : "";
  const initialLanguage = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(
    persistedLanguage ?? "",
  )
    ? persistedLanguage!
    : /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(embeddedLanguage)
      ? embeddedLanguage
      : locale;
  const [language, setLanguage] = useState(initialLanguage);
  const [webVtt, setWebVtt] = useState(() =>
    serializeWebVttTranscript(transcript),
  );
  const [generating, setGenerating] = useState(false);
  const transcriptEditVersionRef = useRef(0);
  const [descriptionPending, setDescriptionPending] = useState(false);
  const [descriptionValue, setDescriptionValue] = useState(description ?? "");
  const initialDescriptionTouched =
    descriptionIntent === "touched" || Boolean(description?.trim());
  const [descriptionTouched, setDescriptionTouched] = useState(
    initialDescriptionTouched,
  );
  const [descriptionSuggestion, setDescriptionSuggestion] = useState("");
  const [descriptionSuggestionAssetId, setDescriptionSuggestionAssetId] =
    useState("");
  const descriptionRequestRef = useRef(0);
  const automaticTranscriptRequestedRef = useRef(false);
  const asyncAssetScopeRef = useRef<AsyncAssetScope | null>(null);
  const generateTranscriptRef = useRef<(() => Promise<void>) | null>(null);
  const [variantsPending, setVariantsPending] = useState(false);
  const posterFrameControllerRef = useRef<AbortController | null>(null);
  const initialComposition = useMemo(
    () => sanitizeVideoComposition(composition),
    [composition],
  );
  const [renderJobId, setRenderJobId] = useState(
    initialComposition?.renderJobId,
  );
  const [audioTracks, setAudioTracks] = useState(() =>
    (initialComposition?.audioTracks ?? []).map((track) => ({
      id: track.id,
      mediaAssetId: track.mediaAssetId,
      mediaAssetName: track.mediaAssetName ?? "",
      durationMilliseconds: null as number | null,
      timelineStartSeconds: String(track.timelineStartMs / 1_000),
      sourceStartSeconds: String(track.sourceStartMs / 1_000),
      sourceEndSeconds:
        track.sourceEndMs === null ? "" : String(track.sourceEndMs / 1_000),
      volumePercent: String(Math.round(track.volume * 100)),
    })),
  );
  const initialEndCard = useMemo(
    () => sanitizeVideoEndCard(endCard),
    [endCard],
  );
  const [endCardEnabled, setEndCardEnabled] = useState(Boolean(initialEndCard));
  const policy = useMemo(
    () => sanitizeVideoPlaybackPolicy(playbackPolicy),
    [playbackPolicy],
  );
  const initialPoster = useMemo(() => sanitizeVideoPoster(poster), [poster]);
  const [posterMode, setPosterMode] = useState<"auto" | "frame" | "upload">(
    sourceAssetId ? (initialPoster?.source ?? "auto") : "auto",
  );
  const [posterFrameState, setPosterFrameState] =
    useState<PosterFrameState | null>(() =>
      sourceAssetId && initialPoster?.source === "frame"
        ? {
            assetId: sourceAssetId,
            atMilliseconds: initialPoster.atMilliseconds,
            jobId: null,
            status: "succeeded",
          }
        : null,
    );
  const [posterUpload, setPosterUpload] = useState<
    Extract<VideoPoster, { source: "upload" }> | undefined
  >(
    sourceAssetId && initialPoster?.source === "upload"
      ? initialPoster
      : undefined,
  );
  const [trimStartSeconds, setTrimStartSeconds] = useState(
    String(policy.trimStartMs / 1_000),
  );
  const [trimEndSeconds, setTrimEndSeconds] = useState(
    policy.trimEndMs === null ? "" : String(policy.trimEndMs / 1_000),
  );
  const [removedSegments, setRemovedSegments] = useState(() =>
    policy.removedSegments.map((segment, index) => ({
      id: `${segment.startMs}-${segment.endMs}-${index}`,
      startSeconds: String(segment.startMs / 1_000),
      endSeconds: String(segment.endMs / 1_000),
    })),
  );
  const [durationMs, setDurationMs] = useState<number | null>(() =>
    Number.isSafeInteger(sourceDurationMilliseconds) &&
    Number(sourceDurationMilliseconds) > 0
      ? Number(sourceDurationMilliseconds)
      : null,
  );
  const [thumbnailMs, setThumbnailMs] = useState(
    initialPoster?.source === "frame"
      ? initialPoster.atMilliseconds
      : policy.trimStartMs,
  );
  const requestedFrameMilliseconds = Math.max(0, Math.round(thumbnailMs));
  const currentPosterFrameStatus =
    posterFrameState?.assetId === (sourceAssetId?.trim() ?? "") &&
    posterFrameState.atMilliseconds === requestedFrameMilliseconds
      ? posterFrameState.status
      : null;
  const posterFrameBusy =
    currentPosterFrameStatus === "pending" ||
    currentPosterFrameStatus === "processing";
  const [playheadMs, setPlayheadMs] = useState(policy.trimStartMs);
  const parsed = useMemo(
    () => (webVtt.trim() ? parseWebVttTranscript(webVtt, language) : null),
    [language, webVtt],
  );
  const timelineDurationMs = Math.max(
    1_000,
    durationMs ?? 0,
    policy.trimEndMs ?? 0,
    parsed?.segments.at(-1)?.endMs ?? 0,
  );
  const trimStartMs = Math.min(
    Math.max(Math.round((Number(trimStartSeconds) || 0) * 1_000), 0),
    Math.max(timelineDurationMs - 1, 0),
  );
  const requestedTrimEndMs = trimEndSeconds
    ? Math.round(Number(trimEndSeconds) * 1_000)
    : timelineDurationMs;
  const trimEndMs = Math.min(
    Math.max(
      Number.isFinite(requestedTrimEndMs)
        ? requestedTrimEndMs
        : timelineDurationMs,
      trimStartMs + 1,
    ),
    timelineDurationMs,
  );
  const currentCaption = parsed?.segments.find(
    (segment) => playheadMs >= segment.startMs && playheadMs < segment.endMs,
  );
  const removedSegmentsPayload = removedSegments.map((segment) => ({
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
  }));
  const draftPlaybackPolicy = videoPlaybackPolicyFromForm({
    trimStartSeconds,
    trimEndSeconds,
    removedSegments: removedSegmentsPayload,
    requiredPlayback: false,
    minimumWatchPercent: "90",
    seeking: "allowed",
  });
  const removedMilliseconds =
    draftPlaybackPolicy?.removedSegments.reduce(
      (total, segment) => total + segment.endMs - segment.startMs,
      0,
    ) ?? 0;
  const rawComposition = audioTracks.length
    ? {
        version: 1 as const,
        audioTracks: audioTracks.map((track) => ({
          id: track.id,
          mediaAssetId: track.mediaAssetId,
          ...(track.mediaAssetName
            ? { mediaAssetName: track.mediaAssetName }
            : {}),
          timelineStartMs: Math.round(
            (Number(track.timelineStartSeconds) || 0) * 1_000,
          ),
          sourceStartMs: Math.round(
            (Number(track.sourceStartSeconds) || 0) * 1_000,
          ),
          sourceEndMs: track.sourceEndSeconds
            ? Math.round(Number(track.sourceEndSeconds) * 1_000)
            : null,
          volume: Number(track.volumePercent) / 100,
        })),
        ...(renderJobId ? { renderJobId } : {}),
      }
    : null;
  const compositionDocument = rawComposition
    ? sanitizeVideoComposition(rawComposition)
    : null;
  const posterDocument: VideoPoster | null =
    sourceAssetId &&
    posterMode === "frame" &&
    currentPosterFrameStatus === "succeeded"
      ? {
          version: 1,
          source: "frame",
          atMilliseconds: requestedFrameMilliseconds,
        }
      : sourceAssetId && posterMode === "upload" && posterUpload
        ? posterUpload
        : null;
  const posterPending = posterMode !== "auto" && !posterDocument;

  useEffect(() => {
    const scope: AsyncAssetScope = {
      assetId: sourceAssetId?.trim() ?? "",
      controller: new AbortController(),
    };
    asyncAssetScopeRef.current?.controller.abort();
    asyncAssetScopeRef.current = scope;
    automaticTranscriptRequestedRef.current = false;
    return () => {
      scope.controller.abort();
      if (asyncAssetScopeRef.current === scope) {
        asyncAssetScopeRef.current = null;
      }
    };
  }, [sourceAssetId]);

  useEffect(() => {
    posterFrameControllerRef.current?.abort();
    posterFrameControllerRef.current = null;
    return () => posterFrameControllerRef.current?.abort();
  }, [sourceAssetId]);

  useEffect(
    () => () => {
      onDescriptionPendingChange?.(false);
    },
    [onDescriptionPendingChange],
  );

  useEffect(() => {
    onPosterPendingChange?.(posterPending);
  }, [onPosterPendingChange, posterPending]);

  useEffect(
    () => () => {
      onPosterPendingChange?.(false);
    },
    [onPosterPendingChange],
  );

  const updateAudioTrack = (
    id: string,
    update: Partial<(typeof audioTracks)[number]>,
  ) => {
    setRenderJobId(undefined);
    setAudioTracks((current) =>
      current.map((track) =>
        track.id === id ? { ...track, ...update } : track,
      ),
    );
  };

  const selectAudioTrackAsset = (
    id: string,
    assetId: string | null,
    selection?: CourseMediaSelection,
  ) => {
    updateAudioTrack(id, {
      mediaAssetId: assetId ?? "",
      mediaAssetName: selection?.originalFileName ?? "",
      durationMilliseconds: selection?.durationMilliseconds ?? null,
      ...(selection?.durationMilliseconds
        ? { sourceEndSeconds: String(selection.durationMilliseconds / 1_000) }
        : {}),
    });
  };

  const importTranscriptFile = async (file: File) => {
    try {
      if (!file.name.toLowerCase().endsWith(".vtt")) {
        throw new WebVttFileImportError("invalid_vtt");
      }
      if (file.size > MAX_WEB_VTT_FILE_BYTES) {
        throw new WebVttFileImportError("too_large");
      }
      const imported = importWebVttTranscriptFile(
        await file.arrayBuffer(),
        language,
      );
      transcriptEditVersionRef.current += 1;
      setLanguage(imported.document.language);
      setWebVtt(imported.webVtt);
      toast.success(copy.success.transcriptImported);
    } catch (error) {
      const message =
        error instanceof WebVttFileImportError
          ? {
              too_large: copy.errors.transcriptFileTooLarge,
              invalid_encoding: copy.errors.transcriptFileEncoding,
              invalid_vtt: copy.errors.transcriptFileInvalid,
            }[error.code]
          : copy.errors.transcriptFileInvalid;
      toast.error(message);
    }
  };

  const exportTranscriptFile = () => {
    const exported = exportWebVttTranscript(parsed);
    if (!exported) {
      toast.error(copy.errors.transcriptFileInvalid);
      return;
    }
    const objectUrl = URL.createObjectURL(
      new Blob([exported], { type: "text/vtt;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = webVttExportFileName(parsed?.language ?? language);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  };

  const generateTranscript = async () => {
    const assetId = sourceAssetId?.trim() ?? "";
    if (!serverProcessingEnabled) return;
    if (!assetId) {
      toast.error(copy.errors.assetRequired);
      return;
    }
    const scope = asyncAssetScopeRef.current;
    if (!scope || scope.assetId !== assetId || scope.controller.signal.aborted)
      return;
    const requestedLanguage = language.toLowerCase();
    const editVersion = transcriptEditVersionRef.current;
    const scopeIsCurrent = () =>
      asyncAssetScopeRef.current === scope &&
      !scope.controller.signal.aborted;
    setGenerating(true);
    try {
      const queued = await fetch(`/api/media-assets/${assetId}/processing`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "transcript",
          language,
          courseId,
          blockId,
        }),
        signal: scope.controller.signal,
      });
      if (!queued.ok) throw new Error(copy.errors.queueTranscript);
      const pollingStartedAt = Date.now();
      for (
        let attempt = 0;
        Date.now() - pollingStartedAt < TRANSCRIPT_POLLING_MAXIMUM_MS;
        attempt += 1
      ) {
        if (!scopeIsCurrent()) return;
        const status = await fetch(
          `/api/media-assets/${assetId}/processing?language=${encodeURIComponent(requestedLanguage)}`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: scope.controller.signal,
          },
        );
        if (!status.ok) throw new Error(copy.errors.transcriptStatus);
        const result = (await status.json()) as {
          transcript?: { language?: string; webVtt?: string } | null;
          jobs?: Array<{
            type?: string;
            status?: string;
            failureCode?: string | null;
            language?: string | null;
          }>;
        };
        if (result.transcript?.webVtt) {
          if (!scopeIsCurrent()) return;
          if (editVersion !== transcriptEditVersionRef.current) {
            return;
          }
          setLanguage(result.transcript.language ?? language);
          setWebVtt(result.transcript.webVtt);
          toast.success(copy.success.transcriptLoaded);
          return;
        }
        const transcriptJob = result.jobs?.find(
          (job) =>
            job.type === "transcript" &&
            job.language === requestedLanguage,
        );
        if (transcriptJob?.status === "failed") {
          throw new Error(
            transcriptJob.failureCode === "provider_unavailable"
              ? copy.errors.providerUnavailable
              : copy.errors.transcriptFailed,
          );
        }
        await waitForAbortableDelay(
          attempt < 60 ? 2_000 : 10_000,
          scope.controller.signal,
        );
      }
      throw new Error(copy.errors.transcriptContinues);
    } catch (error) {
      if (!scopeIsCurrent()) return;
      toast.error(
        error instanceof Error ? error.message : copy.errors.transcriptGeneric,
      );
    } finally {
      if (scopeIsCurrent()) setGenerating(false);
    }
  };
  generateTranscriptRef.current = generateTranscript;

  function selectedAssetId() {
    return sourceAssetId?.trim() ?? "";
  }

  const generateDescription = async () => {
    if (!serverProcessingEnabled) return;
    const assetId = selectedAssetId();
    if (!assetId) {
      toast.error(copy.errors.assetRequired);
      return;
    }
    if (!parsed) {
      toast.error(workflowCopy.descriptionTranscriptRequired);
      return;
    }
    const scope = asyncAssetScopeRef.current;
    if (!scope || scope.assetId !== assetId || scope.controller.signal.aborted)
      return;
    const scopeIsCurrent = () =>
      asyncAssetScopeRef.current === scope &&
      !scope.controller.signal.aborted;
    const requestId = ++descriptionRequestRef.current;
    setDescriptionPending(true);
    onDescriptionPendingChange?.(true);
    try {
      const response = await fetch(
        `/api/media-assets/${assetId}/video-description`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId,
            blockId,
            locale,
            transcriptLanguage: language,
          }),
          signal: scope.controller.signal,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        description?: string;
      } | null;
      if (!response.ok || !payload?.description) {
        throw new Error(workflowCopy.descriptionFailed);
      }
      if (
        requestId !== descriptionRequestRef.current ||
        !scopeIsCurrent()
      ) {
        return;
      }
      setDescriptionSuggestion(payload.description);
      setDescriptionSuggestionAssetId(assetId);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : workflowCopy.descriptionFailed,
      );
    } finally {
      if (
        requestId === descriptionRequestRef.current &&
        scopeIsCurrent()
      ) {
        setDescriptionPending(false);
        onDescriptionPendingChange?.(false);
      }
    }
  };
  useEffect(() => {
    if (
      !automaticallyLoadTranscript ||
      automaticTranscriptRequestedRef.current ||
      parsed ||
      !sourceAssetId ||
      !serverProcessingEnabled
    ) {
      return;
    }
    automaticTranscriptRequestedRef.current = true;
    void generateTranscriptRef.current?.();
  }, [automaticallyLoadTranscript, parsed, serverProcessingEnabled, sourceAssetId]);

  const queueVideoVariants = async () => {
    if (!serverProcessingEnabled) return;
    const assetId = selectedAssetId();
    if (!assetId) {
      toast.error(copy.errors.assetRequired);
      return;
    }
    if (!draftPlaybackPolicy) {
      toast.error(cutsCopy.invalid);
      return;
    }
    if (audioTracks.length && !compositionDocument) {
      toast.error(compositionCopy.invalid);
      return;
    }
    setVariantsPending(true);
    try {
      const responses = await Promise.all(
        (["thumbnail", "transcode"] as const).map(async (type) => {
          const response = await fetch(
            `/api/media-assets/${assetId}/processing`,
            {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                type === "thumbnail"
                  ? { type, atMilliseconds: thumbnailMs, courseId, blockId }
                  : {
                      type,
                      courseId,
                      blockId,
                      ...(!compositionDocument &&
                      videoPlaybackPolicyHasEdits(draftPlaybackPolicy)
                        ? {
                            videoEdit:
                              videoEditPlanFromPlaybackPolicy(
                                draftPlaybackPolicy,
                              ),
                          }
                        : {}),
                      ...(compositionDocument
                        ? { videoComposition: compositionDocument }
                        : {}),
                    },
              ),
            },
          );
          const payload = (await response.json().catch(() => null)) as {
            id?: string;
          } | null;
          return { type, response, payload };
        }),
      );
      if (responses.some(({ response }) => !response.ok)) {
        throw new Error(copy.errors.variantsQueue);
      }
      const transcodeJobId = responses.find(
        (result) => result.type === "transcode",
      )?.payload?.id;
      if (compositionDocument) {
        if (!transcodeJobId) throw new Error(copy.errors.variantsQueue);
        setRenderJobId(transcodeJobId);
      }
      toast.success(copy.success.variantsQueued);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : copy.errors.variantsGeneric,
      );
    } finally {
      setVariantsPending(false);
    }
  };

  const queuePosterFrame = async () => {
    if (!serverProcessingEnabled) return;
    const assetId = selectedAssetId();
    if (!assetId) {
      toast.error(copy.errors.assetRequired);
      return;
    }
    const atMilliseconds = requestedFrameMilliseconds;
    posterFrameControllerRef.current?.abort();
    const controller = new AbortController();
    posterFrameControllerRef.current = controller;
    const updateStatus = (
      status: ExactVideoThumbnailJobStatus,
      jobId: string | null,
    ) => {
      if (posterFrameControllerRef.current !== controller) return;
      setPosterFrameState({ assetId, atMilliseconds, jobId, status });
    };
    updateStatus("pending", null);
    try {
      const response = await fetch(`/api/media-assets/${assetId}/processing`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "thumbnail",
          atMilliseconds,
          courseId,
          blockId,
        }),
        signal: controller.signal,
      });
      const queued = (await response.json().catch(() => null)) as {
        id?: unknown;
        type?: unknown;
        status?: unknown;
        atMilliseconds?: unknown;
      } | null;
      if (!response.ok || typeof queued?.id !== "string") {
        throw new Error(workflowCopy.posterFrameFailed);
      }
      const initialStatus = exactVideoThumbnailJobStatus(
        [queued],
        queued.id,
        atMilliseconds,
      );
      if (!initialStatus) throw new Error(workflowCopy.posterFrameFailed);
      updateStatus(initialStatus, queued.id);
      if (initialStatus === "failed") {
        throw new Error(workflowCopy.posterFrameFailed);
      }
      if (initialStatus === "succeeded") {
        toast.success(workflowCopy.posterFrameSucceeded);
        return;
      }

      const pollingStartedAt = Date.now();
      for (
        let attempt = 0;
        Date.now() - pollingStartedAt < TRANSCRIPT_POLLING_MAXIMUM_MS;
        attempt += 1
      ) {
        await waitForAbortableDelay(
          attempt < 60 ? 2_000 : 10_000,
          controller.signal,
        );
        const statusResponse = await fetch(
          `/api/media-assets/${assetId}/processing`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!statusResponse.ok) {
          throw new Error(workflowCopy.posterFrameFailed);
        }
        const result = (await statusResponse.json().catch(() => null)) as {
          jobs?: Array<Readonly<Record<string, unknown>>>;
        } | null;
        const matchingJob = result?.jobs?.find(
          (job) => job.id === queued.id,
        );
        if (!matchingJob) continue;
        const exactStatus = exactVideoThumbnailJobStatus(
          [matchingJob],
          queued.id,
          atMilliseconds,
        );
        if (!exactStatus) throw new Error(workflowCopy.posterFrameFailed);
        updateStatus(exactStatus, queued.id);
        if (exactStatus === "failed") {
          throw new Error(workflowCopy.posterFrameFailed);
        }
        if (exactStatus === "succeeded") {
          toast.success(workflowCopy.posterFrameSucceeded);
          return;
        }
      }
      throw new Error(workflowCopy.posterFrameFailed);
    } catch (error) {
      if (controller.signal.aborted) return;
      updateStatus("failed", null);
      toast.error(
        error instanceof Error
          ? error.message
          : workflowCopy.posterFrameFailed,
      );
    } finally {
      if (posterFrameControllerRef.current === controller) {
        posterFrameControllerRef.current = null;
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className="space-y-4 border-t border-[#e1e6e9] pt-4"
    >
      <section
        aria-label={copy.timeline}
        className="space-y-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3"
      >
        {sourceUrl ? (
          <div className="overflow-hidden rounded-md bg-black">
            <video
              ref={videoRef}
              src={sourceUrl}
              controls
              preload="metadata"
              className="aspect-video w-full"
              onLoadedMetadata={(event) => {
                const nextDuration = Math.round(
                  event.currentTarget.duration * 1_000,
                );
                if (Number.isSafeInteger(nextDuration) && nextDuration > 0)
                  setDurationMs(nextDuration);
                event.currentTarget.currentTime = trimStartMs / 1_000;
              }}
              onTimeUpdate={(event) => {
                const nextPlayhead = Math.round(
                  event.currentTarget.currentTime * 1_000,
                );
                setPlayheadMs(nextPlayhead);
                if (nextPlayhead >= trimEndMs) {
                  event.currentTarget.pause();
                  event.currentTarget.currentTime = trimStartMs / 1_000;
                  return;
                }
                const cutEndMs = draftPlaybackPolicy
                  ? playbackPositionAfterRemovedSegment(
                      draftPlaybackPolicy,
                      nextPlayhead,
                    )
                  : null;
                if (cutEndMs !== null) {
                  event.currentTarget.currentTime = cutEndMs / 1_000;
                  setPlayheadMs(cutEndMs);
                }
              }}
            />
            {currentCaption ? (
              <p className="min-h-9 bg-black px-3 py-2 text-center text-xs text-white">
                {currentCaption.text}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          className="relative h-12 overflow-hidden rounded-md border border-[#cbd5dc] bg-white"
          aria-hidden="true"
        >
          <span
            className="absolute inset-y-0 bg-[#dff2ef]"
            style={{
              left: `${(trimStartMs / timelineDurationMs) * 100}%`,
              width: `${((trimEndMs - trimStartMs) / timelineDurationMs) * 100}%`,
            }}
          />
          {draftPlaybackPolicy?.removedSegments.map((segment, index) => (
            <span
              key={`${segment.startMs}-${segment.endMs}-${index}`}
              className="absolute inset-y-0 bg-[#d96b5f]/70"
              style={{
                left: `${(segment.startMs / timelineDurationMs) * 100}%`,
                width: `${((segment.endMs - segment.startMs) / timelineDurationMs) * 100}%`,
              }}
            />
          ))}
          {parsed?.segments.slice(0, 500).map((segment, index) => (
            <span
              key={`${segment.startMs}-${index}`}
              className="absolute bottom-1 h-2 rounded-sm bg-[#3d7fa3]"
              style={{
                left: `${(segment.startMs / timelineDurationMs) * 100}%`,
                width: `${Math.max(((segment.endMs - segment.startMs) / timelineDurationMs) * 100, 0.25)}%`,
              }}
            />
          ))}
          <span
            className="absolute inset-y-0 w-0.5 bg-[#c95b4f]"
            style={{ left: `${(thumbnailMs / timelineDurationMs) * 100}%` }}
          />
          <span
            className="absolute inset-y-0 w-0.5 bg-[#17324d]"
            style={{ left: `${(playheadMs / timelineDurationMs) * 100}%` }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.trimStart}
            <input
              type="range"
              min="0"
              max={timelineDurationMs}
              step="100"
              value={trimStartMs}
              onChange={(event) =>
                setTrimStartSeconds(
                  String(
                    Math.min(Number(event.target.value), trimEndMs - 1) / 1_000,
                  ),
                )
              }
              className="mt-2 w-full accent-[#2b9188]"
            />
          </label>
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.trimEnd}
            <input
              type="range"
              min="1"
              max={timelineDurationMs}
              step="100"
              value={trimEndMs}
              onChange={(event) =>
                setTrimEndSeconds(
                  String(
                    Math.max(Number(event.target.value), trimStartMs + 1) /
                      1_000,
                  ),
                )
              }
              className="mt-2 w-full accent-[#2b9188]"
            />
          </label>
          <label className="text-xs font-semibold text-[#52606d]">
            {copy.thumbnail}
            <input
              type="range"
              min="0"
              max={Math.max(0, timelineDurationMs - 1)}
              step="100"
              value={Math.min(thumbnailMs, Math.max(0, timelineDurationMs - 1))}
              onChange={(event) => setThumbnailMs(Number(event.target.value))}
              className="mt-2 w-full accent-[#c95b4f]"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#66727f]">
          <button
            type="button"
            onClick={() => {
              if (!videoRef.current) return;
              videoRef.current.currentTime = trimStartMs / 1_000;
              void videoRef.current.play();
            }}
            disabled={!sourceUrl}
            className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 font-bold text-[#365f8d] disabled:opacity-40"
          >
            <Play className="size-3.5" />
            {copy.previewClip}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!videoRef.current) return;
              videoRef.current.currentTime = thumbnailMs / 1_000;
              setPlayheadMs(thumbnailMs);
            }}
            disabled={!sourceUrl}
            className="focus-ring inline-flex h-8 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 font-bold text-[#365f8d] disabled:opacity-40"
          >
            <ImageIcon className="size-3.5" />
            {copy.showThumbnail}
          </button>
          <span>
            {copy.timelineSummary(
              secondsFormatter.format(trimStartMs / 1_000),
              secondsFormatter.format(trimEndMs / 1_000),
              secondsFormatter.format(thumbnailMs / 1_000),
              parsed?.segments.length ?? 0,
            )}
          </span>
        </div>
      </section>
      <fieldset className="space-y-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {workflowCopy.posterTitle}
        </legend>
        <input
          type="hidden"
          name="videoPoster"
          value={posterDocument ? JSON.stringify(posterDocument) : ""}
        />
        <div
          role="group"
          aria-label={workflowCopy.posterTitle}
          className="inline-flex max-w-full flex-wrap rounded-md border border-[#dce1e5] bg-[#eef2f4] p-0.5"
        >
          {(
            [
              ["auto", workflowCopy.posterAuto, Sparkles],
              ["frame", workflowCopy.posterFrame, Film],
              ["upload", workflowCopy.posterUpload, ImageIcon],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={posterMode === mode}
              disabled={
                mode !== "auto" &&
                (!sourceAssetId || (mode === "frame" && !serverProcessingEnabled))
              }
              onClick={() => {
                setPosterMode(mode);
                if (mode !== "upload") setPosterUpload(undefined);
              }}
              className={`focus-ring inline-flex h-8 items-center gap-2 rounded px-3 text-xs font-semibold ${
                posterMode === mode
                  ? "bg-white text-[#294f79] shadow-sm"
                  : "text-[#71808b]"
              } disabled:opacity-40`}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
        {posterMode === "frame" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-xs leading-5 text-[#66727f]">
                {workflowCopy.posterFrameHint}
              </p>
              <button
                type="button"
                onClick={() => void queuePosterFrame()}
                disabled={
                  posterFrameBusy || !sourceAssetId || !serverProcessingEnabled
                }
                className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-45"
              >
                {posterFrameBusy ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : currentPosterFrameStatus === "succeeded" ? (
                  <Check className="size-4" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
                {posterFrameBusy
                  ? workflowCopy.posterFrameCreating
                  : workflowCopy.posterFrameCreate}
              </button>
            </div>
            {currentPosterFrameStatus ? (
              <p
                role={
                  currentPosterFrameStatus === "failed" ? "alert" : "status"
                }
                aria-live="polite"
                className={`text-xs font-semibold ${
                  currentPosterFrameStatus === "failed"
                    ? "text-[#a94339]"
                    : currentPosterFrameStatus === "succeeded"
                      ? "text-[#167e74]"
                      : "text-[#66727f]"
                }`}
              >
                {currentPosterFrameStatus === "pending"
                  ? workflowCopy.posterFramePending
                  : currentPosterFrameStatus === "processing"
                    ? workflowCopy.posterFrameProcessing
                    : currentPosterFrameStatus === "succeeded"
                      ? workflowCopy.posterFrameSucceeded
                      : workflowCopy.posterFrameFailed}
              </p>
            ) : null}
          </div>
        ) : null}
        {posterMode === "upload" ? (
          <CourseMediaSourceField
            locale={locale}
            courseId={courseId}
            kind="image"
            label={workflowCopy.posterUploadLabel}
            defaultAssetId={posterUpload?.mediaAssetId}
            defaultFileName={posterUpload?.mediaAssetName}
            mediaAssetIdName="videoPosterAssetId"
            urlName="videoPosterUrl"
            allowExternalUrl={false}
            preferredMode="upload"
            onSourceChange={(source) =>
              setPosterUpload(
                (source.mode === "upload" || source.mode === "library") &&
                  source.selection
                  ? {
                      version: 1,
                      source: "upload",
                      mediaAssetId: source.selection.id,
                      mediaAssetName: source.selection.originalFileName,
                    }
                  : undefined,
              )
            }
          />
        ) : null}
      </fieldset>
      <fieldset className="space-y-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {cutsCopy.title}
        </legend>
        <input
          type="hidden"
          name="videoRemovedSegments"
          value={JSON.stringify(removedSegmentsPayload)}
        />
        {removedSegments.length ? (
          <div className="space-y-2">
            {removedSegments.map((segment, index) => (
              <div
                key={segment.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-end gap-2"
              >
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[#52606d]">
                    {cutsCopy.start}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={segment.startSeconds}
                    onChange={(event) =>
                      setRemovedSegments((current) =>
                        current.map((candidate) =>
                          candidate.id === segment.id
                            ? { ...candidate, startSeconds: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-[#52606d]">
                    {cutsCopy.end}
                  </span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={segment.endSeconds}
                    onChange={(event) =>
                      setRemovedSegments((current) =>
                        current.map((candidate) =>
                          candidate.id === segment.id
                            ? { ...candidate, endSeconds: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setRemovedSegments((current) =>
                      current.filter(
                        (candidate) => candidate.id !== segment.id,
                      ),
                    )
                  }
                  aria-label={cutsCopy.remove(index + 1)}
                  title={cutsCopy.remove(index + 1)}
                  className="focus-ring grid size-9 place-items-center rounded-md border border-[#dfb8b1] bg-white text-[#a94339] hover:bg-[#fdf0ee]"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#71808b]">{cutsCopy.empty}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              const startMs = Math.min(
                Math.max(playheadMs, trimStartMs),
                Math.max(trimEndMs - 1, trimStartMs),
              );
              const endMs = Math.min(startMs + 1_000, trimEndMs);
              if (endMs <= startMs) return;
              setRemovedSegments((current) => [
                ...current,
                {
                  id: `${Date.now()}-${current.length}`,
                  startSeconds: String(startMs / 1_000),
                  endSeconds: String(endMs / 1_000),
                },
              ]);
            }}
            disabled={removedSegments.length >= 50}
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-40"
          >
            <Plus className="size-4" />
            {cutsCopy.add}
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#66727f]">
            <Scissors className="size-3.5" />
            {cutsCopy.summary(
              removedSegments.length,
              secondsFormatter.format(removedMilliseconds / 1_000),
            )}
          </span>
        </div>
        {!draftPlaybackPolicy && removedSegments.length ? (
          <p role="alert" className="text-xs font-semibold text-[#a94339]">
            {cutsCopy.invalid}
          </p>
        ) : null}
      </fieldset>
      <input
        type="hidden"
        name="videoComposition"
        value={rawComposition ? JSON.stringify(rawComposition) : ""}
      />
      <fieldset className="space-y-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {compositionCopy.title}
        </legend>
        {audioTracks.length ? (
          <div className="space-y-1" aria-label={compositionCopy.title}>
            {audioTracks.map((track, index) => {
              const sourceEndMs = track.sourceEndSeconds
                ? Number(track.sourceEndSeconds) * 1_000
                : track.durationMilliseconds;
              const sourceStartMs =
                (Number(track.sourceStartSeconds) || 0) * 1_000;
              const trackDurationMs = Math.max(
                500,
                (sourceEndMs ?? sourceStartMs + 5_000) - sourceStartMs,
              );
              const timelineStartMs =
                (Number(track.timelineStartSeconds) || 0) * 1_000;
              const left = Math.min(
                100,
                Math.max(0, (timelineStartMs / timelineDurationMs) * 100),
              );
              const width = Math.max(
                0.5,
                Math.min(
                  100 - left,
                  (trackDurationMs / timelineDurationMs) * 100,
                ),
              );
              return (
                <div
                  key={`timeline-${track.id}`}
                  className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2"
                >
                  <span className="truncate text-[10px] font-semibold text-[#52606d]">
                    {compositionCopy.track(index + 1)}
                  </span>
                  <span className="relative h-5 overflow-hidden rounded border border-[#cad6de] bg-white">
                    <span
                      className="absolute inset-y-0 bg-[#2b9188]"
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[#71808b]">{compositionCopy.empty}</p>
        )}
        {audioTracks.map((track, index) => (
          <div
            key={track.id}
            className="space-y-3 border-t border-[#dce3e8] pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex min-w-0 items-center gap-2 text-xs font-bold text-[#354555]">
                <Music2 className="size-4 shrink-0 text-[#2b9188]" />
                <span className="truncate">
                  {compositionCopy.track(index + 1)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setRenderJobId(undefined);
                  setAudioTracks((current) =>
                    current.filter((candidate) => candidate.id !== track.id),
                  );
                }}
                aria-label={compositionCopy.remove(index + 1)}
                title={compositionCopy.remove(index + 1)}
                className="focus-ring grid size-9 shrink-0 place-items-center rounded-md border border-[#dfb8b1] bg-white text-[#a94339] hover:bg-[#fdf0ee]"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <CourseMediaSourceField
              locale={locale}
              courseId={courseId}
              kind="audio"
              label={compositionCopy.audioSource}
              defaultAssetId={track.mediaAssetId || undefined}
              defaultFileName={track.mediaAssetName || undefined}
              mediaAssetIdName={`videoCompositionAsset.${track.id}`}
              urlName={`videoCompositionUrl.${track.id}`}
              allowExternalUrl={false}
              preferredMode="upload"
              onAssetChange={(assetId) =>
                assetId
                  ? updateAudioTrack(track.id, { mediaAssetId: assetId })
                  : selectAudioTrackAsset(track.id, null)
              }
              onAssetSelection={(selection) =>
                selectAudioTrackAsset(
                  track.id,
                  selection?.id ?? null,
                  selection ?? undefined,
                )
              }
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                  {compositionCopy.timelineStart}
                </span>
                <input
                  type="number"
                  min="0"
                  max="604799.999"
                  step="0.001"
                  value={track.timelineStartSeconds}
                  onChange={(event) =>
                    updateAudioTrack(track.id, {
                      timelineStartSeconds: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                  {compositionCopy.sourceStart}
                </span>
                <input
                  type="number"
                  min="0"
                  max="604799.999"
                  step="0.001"
                  value={track.sourceStartSeconds}
                  onChange={(event) =>
                    updateAudioTrack(track.id, {
                      sourceStartSeconds: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                  {compositionCopy.sourceEnd}
                </span>
                <input
                  type="number"
                  min="0.001"
                  max="604800"
                  step="0.001"
                  value={track.sourceEndSeconds}
                  onChange={(event) =>
                    updateAudioTrack(track.id, {
                      sourceEndSeconds: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>
            <label className="grid grid-cols-[auto_minmax(0,1fr)_4rem] items-center gap-3 text-xs font-semibold text-[#52606d]">
              <Volume2 className="size-4" />
              <span className="sr-only">{compositionCopy.volume}</span>
              <input
                type="range"
                min="0"
                max="200"
                step="1"
                value={track.volumePercent}
                onChange={(event) =>
                  updateAudioTrack(track.id, {
                    volumePercent: event.target.value,
                  })
                }
                className="w-full accent-[#2b9188]"
              />
              <span className="text-right tabular-nums">
                {track.volumePercent || "0"}%
              </span>
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setRenderJobId(undefined);
              setAudioTracks((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  mediaAssetId: "",
                  mediaAssetName: "",
                  durationMilliseconds: null,
                  timelineStartSeconds: "0",
                  sourceStartSeconds: "0",
                  sourceEndSeconds: "",
                  volumePercent: "100",
                },
              ]);
            }}
            disabled={audioTracks.length >= MAX_VIDEO_COMPOSITION_AUDIO_TRACKS}
            title={
              audioTracks.length >= MAX_VIDEO_COMPOSITION_AUDIO_TRACKS
                ? compositionCopy.maxTracks
                : compositionCopy.addTrack
            }
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-40"
          >
            <Plus className="size-4" />
            {compositionCopy.addTrack}
          </button>
          {audioTracks.length && !compositionDocument ? (
            <span role="alert" className="text-xs font-semibold text-[#a94339]">
              {compositionCopy.invalid}
            </span>
          ) : null}
        </div>
      </fieldset>
      <fieldset className="grid gap-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {copy.playback}
        </legend>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.startSeconds}
          </span>
          <input
            name="videoTrimStartSeconds"
            type="number"
            min="0"
            step="0.001"
            value={trimStartSeconds}
            onChange={(event) => setTrimStartSeconds(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.endSecondsOptional}
          </span>
          <input
            name="videoTrimEndSeconds"
            type="number"
            min="0.001"
            step="0.001"
            value={trimEndSeconds}
            onChange={(event) => setTrimEndSeconds(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.seeking}
          </span>
          <select
            name="videoSeeking"
            defaultValue={policy.seeking}
            className={inputClass}
          >
            <option value="allowed">{copy.seekingOptions.allowed}</option>
            <option value="watched_only">
              {copy.seekingOptions.watched_only}
            </option>
            <option value="disabled">{copy.seekingOptions.disabled}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.minimumPlayback}
          </span>
          <input
            name="videoMinimumWatchPercent"
            type="number"
            min="50"
            max="100"
            step="1"
            defaultValue={policy.minimumWatchPercent}
            className={inputClass}
          />
        </label>
        <label className="flex min-h-10 items-center gap-3 sm:col-span-2">
          <input
            name="videoRequiredPlayback"
            type="checkbox"
            defaultChecked={policy.completionMode === "required"}
            className="focus-ring size-4 accent-[#2b9188]"
          />
          <span className="text-xs font-semibold text-[#52606d]">
            {copy.requiredPlayback}
          </span>
        </label>
        <button
          type="button"
          onClick={() => void queueVideoVariants()}
          disabled={
            variantsPending || !sourceAssetId || !serverProcessingEnabled
          }
          title={copy.variantsTitle}
          className="focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-60 sm:col-span-2 sm:justify-self-start"
        >
          {variantsPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Film className="size-4" />
          )}
          {variantsPending ? copy.processing : copy.createVariants}
        </button>
      </fieldset>
      <fieldset className="grid gap-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3 sm:grid-cols-2">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {copy.endCard.title}
        </legend>
        <label className="flex min-h-10 items-center gap-3 sm:col-span-2">
          <input
            name="videoEndCardEnabled"
            type="checkbox"
            checked={endCardEnabled}
            onChange={(event) => setEndCardEnabled(event.target.checked)}
            className="focus-ring size-4 accent-[#2b9188]"
          />
          <span className="text-xs font-semibold text-[#52606d]">
            {copy.endCard.enabled}
          </span>
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.endCard.heading}
          </span>
          <input
            name="videoEndCardHeading"
            maxLength={180}
            required={endCardEnabled}
            disabled={!endCardEnabled}
            defaultValue={initialEndCard?.heading ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.endCard.text}
          </span>
          <textarea
            name="videoEndCardText"
            maxLength={1_500}
            disabled={!endCardEnabled}
            defaultValue={initialEndCard?.text ?? ""}
            className="focus-ring min-h-24 w-full rounded-md border border-[#d5dde3] bg-white p-3 text-sm leading-6 disabled:bg-[#eef2f4]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.endCard.ctaLabel}
          </span>
          <input
            name="videoEndCardCtaLabel"
            maxLength={120}
            disabled={!endCardEnabled}
            defaultValue={initialEndCard?.cta?.label ?? ""}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.endCard.ctaUrl}
          </span>
          <input
            name="videoEndCardCtaHref"
            maxLength={2_000}
            disabled={!endCardEnabled}
            defaultValue={initialEndCard?.cta?.href ?? ""}
            className={inputClass}
          />
        </label>
        <p className="text-[11px] leading-4 text-[#66727f] sm:col-span-2">
          {copy.endCard.ctaHint}
        </p>
      </fieldset>
      <fieldset className="space-y-3 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3">
        <legend className="px-1 text-xs font-bold text-[#354555]">
          {workflowCopy.descriptionTitle}
        </legend>
        <input
          type="hidden"
          name="videoDescriptionIntent"
          value={descriptionTouched ? "touched" : "automatic"}
        />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {workflowCopy.descriptionLabel}
          </span>
          <textarea
            name="caption"
            maxLength={5_000}
            value={descriptionValue}
            onChange={(event) => {
              setDescriptionTouched(true);
              setDescriptionValue(event.target.value);
            }}
            className="focus-ring min-h-28 w-full rounded-md border border-[#d5dde3] bg-white p-3 text-sm leading-6"
          />
        </label>
        <button
          type="button"
          onClick={() => void generateDescription()}
          disabled={
            descriptionPending ||
            !parsed ||
            !sourceAssetId ||
            !serverProcessingEnabled
          }
          className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-45"
        >
          {descriptionPending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {descriptionPending
            ? workflowCopy.descriptionGenerating
            : descriptionSuggestion
              ? workflowCopy.descriptionRegenerate
              : workflowCopy.descriptionGenerate}
        </button>
        {descriptionSuggestion ? (
          <div className="space-y-2 rounded-md border border-[#b9ddd8] bg-white p-3">
            <p className="text-[11px] font-bold uppercase text-[#52606d]">
              {workflowCopy.descriptionSuggestion}
            </p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-[#354555]">
              {descriptionSuggestion}
            </p>
            <button
              type="button"
              onClick={() => {
                if (selectedAssetId() !== descriptionSuggestionAssetId) {
                  setDescriptionSuggestion("");
                  setDescriptionSuggestionAssetId("");
                  toast.error(copy.errors.assetRequired);
                  return;
                }
                setDescriptionTouched(true);
                setDescriptionValue(descriptionSuggestion);
                toast.success(workflowCopy.descriptionAccepted);
              }}
              className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-[#176f68] px-3 text-xs font-bold text-white hover:bg-[#125e58]"
            >
              <Check className="size-4" />
              {workflowCopy.descriptionAccept}
            </button>
          </div>
        ) : null}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block w-28">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.language}
          </span>
          <input
            name="transcriptLanguage"
              value={language}
              onChange={(event) => {
                transcriptEditVersionRef.current += 1;
                setLanguage(event.target.value);
              }}
            maxLength={35}
            pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*"
            className={inputClass}
          />
        </label>
        <button
          type="button"
          onClick={() => void generateTranscript()}
          disabled={generating || !sourceAssetId || !serverProcessingEnabled}
          className="focus-ring mb-0 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-60"
        >
          {generating ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Captions className="size-4" />
          )}
          {generating ? copy.transcribing : copy.transcribe}
        </button>
        <input
          ref={transcriptFileRef}
          type="file"
          accept=".vtt,text/vtt"
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) void importTranscriptFile(file);
            event.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => transcriptFileRef.current?.click()}
          className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa]"
        >
          <Upload className="size-4" />
          {copy.importVtt}
        </button>
        <button
          type="button"
          onClick={exportTranscriptFile}
          disabled={!parsed}
          className="focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#b8c7d2] bg-white px-3 text-xs font-bold text-[#365f8d] hover:bg-[#f3f7fa] disabled:opacity-40"
        >
          <Download className="size-4" />
          {copy.exportVtt}
        </button>
        <p
          role="status"
          className={`pb-2 text-xs font-semibold ${
            webVtt.trim() && !parsed ? "text-[#a94339]" : "text-[#58717f]"
          }`}
        >
          {webVtt.trim()
            ? parsed
              ? copy.timestamps(parsed.segments.length)
              : copy.invalidVtt
            : copy.noTranscript}
        </p>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
          {copy.transcriptLabel}
        </span>
        <textarea
              name="transcriptVtt"
              value={webVtt}
              onChange={(event) => {
                transcriptEditVersionRef.current += 1;
                setWebVtt(event.target.value);
              }}
          maxLength={600_000}
          spellCheck={false}
          className={textareaClass}
          placeholder={copy.transcriptPlaceholder}
        />
      </label>
    </div>
  );
}
