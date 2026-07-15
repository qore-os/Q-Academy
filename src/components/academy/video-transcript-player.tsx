"use client";

import { Captions, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  formatTranscriptTimestamp,
  sanitizeVideoTranscriptDocument,
  searchVideoTranscript,
  serializeWebVttTranscript,
} from "@/lib/content-blocks/video-transcript";
import {
  playbackOffsetToSourcePosition,
  playbackPositionAfterRemovedSegment,
  sanitizeVideoPlaybackPolicy,
  sourcePositionToPlaybackOffset,
} from "@/lib/media/video-playback-policy";
import { sanitizeVideoEndCard } from "@/lib/media/video-end-card";
import {
  parseVideoPlaybackRatePreference,
  videoPlaybackRatePreference,
  VIDEO_PLAYBACK_RATES,
  VIDEO_PLAYBACK_RATE_STORAGE_KEY,
  type VideoPlaybackRate,
} from "@/lib/media/video-playback-rate-preference";
import {
  parseVideoVolumePreference,
  videoVolumePreference,
  VIDEO_VOLUME_STORAGE_KEY,
} from "@/lib/media/video-volume-preference";
import { getLearningUiCopy } from "@/lib/i18n/learning";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import { getVideoCompositionCopy } from "@/lib/i18n/video-composition";
import type { AppLocale } from "@/lib/i18n/model";
import { isExternalRichTextHref } from "@/lib/rich-text/document";

export function VideoTranscriptPlayer({
  src,
  title,
  caption,
  transcript,
  playbackPolicy,
  endCard,
  mediaAssetId,
  transcodeJobId,
  courseId,
  courseSlug,
  lessonId,
  blockId,
  locale,
  onCompletionChange,
}: {
  src: string;
  title?: string | null;
  caption?: string | null;
  transcript?: unknown;
  playbackPolicy?: unknown;
  endCard?: unknown;
  mediaAssetId?: string;
  transcodeJobId?: string;
  courseId?: string;
  courseSlug?: string;
  lessonId?: string;
  blockId?: string;
  locale: AppLocale;
  onCompletionChange?: (completed: boolean) => void;
}) {
  const copy = getLearningUiCopy(locale);
  const endCardCopy = getCourseParityCopy(locale).video.endCard;
  const compositionCopy = getVideoCompositionCopy(locale);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastAcceptedTimeRef = useRef(0);
  const furthestMillisecondsRef = useRef(0);
  const heartbeatPendingRef = useRef(false);
  const lastHeartbeatAtRef = useRef(0);
  const completionCallbackRef = useRef(onCompletionChange);
  const [query, setQuery] = useState("");
  const [searchPolicy, setSearchPolicy] = useState<{
    query: string;
    status: "pending" | "ready" | "blocked";
    segments: ReturnType<typeof searchVideoTranscript>;
  } | null>(null);
  const [activeStartMs, setActiveStartMs] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<VideoPlaybackRate>(1);
  const [endCardVisible, setEndCardVisible] = useState(false);
  const compositionSourceKey = `${mediaAssetId ?? ""}:${transcodeJobId ?? ""}`;
  const [failedCompositionSourceKey, setFailedCompositionSourceKey] = useState<
    string | null
  >(null);
  const compositionLoadFailed =
    Boolean(transcodeJobId) &&
    failedCompositionSourceKey === compositionSourceKey;
  const [playbackProgress, setPlaybackProgress] = useState({
    watchedMilliseconds: 0,
    requiredMilliseconds: 0,
    completed: false,
  });
  const policy = useMemo(
    () => sanitizeVideoPlaybackPolicy(playbackPolicy),
    [playbackPolicy],
  );
  const endCardDocument = useMemo(
    () => sanitizeVideoEndCard(endCard),
    [endCard],
  );
  const tracksRequiredPlayback = Boolean(
    policy.completionMode === "required" &&
    courseId &&
    lessonId &&
    blockId &&
    mediaAssetId,
  );
  useEffect(() => {
    completionCallbackRef.current = onCompletionChange;
  }, [onCompletionChange]);
  const document = useMemo(
    () => sanitizeVideoTranscriptDocument(transcript),
    [transcript],
  );
  const webVttUrl = useMemo(() => {
    const webVtt = serializeWebVttTranscript(document);
    return webVtt
      ? `data:text/vtt;charset=utf-8,${encodeURIComponent(webVtt)}`
      : null;
  }, [document]);
  const checksSearchPolicy = Boolean(
    courseSlug && lessonId && blockId && query.trim(),
  );
  const currentSearchStatus =
    checksSearchPolicy && searchPolicy?.query === query
      ? searchPolicy.status
      : checksSearchPolicy
        ? "pending"
        : "ready";
  const segments = useMemo(() => {
    let candidates: NonNullable<typeof document>["segments"] = [];
    if (!query.trim()) candidates = document?.segments ?? [];
    if (checksSearchPolicy) {
      candidates =
        currentSearchStatus === "ready" && searchPolicy?.query === query
          ? searchPolicy.segments
          : [];
    } else if (query.trim()) {
      candidates = searchVideoTranscript(document, query).slice(0, 100);
    }
    return candidates.filter((segment) => {
      const cutEndMs = playbackPositionAfterRemovedSegment(
        policy,
        segment.startMs,
      );
      return cutEndMs === null || cutEndMs < segment.endMs;
    });
  }, [
    checksSearchPolicy,
    currentSearchStatus,
    document,
    policy,
    query,
    searchPolicy,
  ]);

  const postPlaybackHeartbeat = useCallback(
    (video: HTMLVideoElement, watchedDeltaMs: number) => {
      if (!tracksRequiredPlayback || heartbeatPendingRef.current) return;
      heartbeatPendingRef.current = true;
      void fetch("/api/media-playback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          lessonId,
          blockId,
          positionMs: Math.max(0, Math.round(video.currentTime * 1_000)),
          watchedDeltaMs: Math.max(
            0,
            Math.min(10_000, Math.round(watchedDeltaMs)),
          ),
        }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const result = (await response.json()) as {
            watchedMilliseconds: number;
            furthestMilliseconds: number;
            requiredMilliseconds: number;
            completed: boolean;
          };
          furthestMillisecondsRef.current = result.furthestMilliseconds;
          setPlaybackProgress(result);
          completionCallbackRef.current?.(result.completed);
        })
        .catch(() => undefined)
        .finally(() => {
          heartbeatPendingRef.current = false;
        });
    },
    [blockId, courseId, lessonId, tracksRequiredPlayback],
  );

  useEffect(() => {
    if (!courseSlug || !lessonId || !blockId || !query.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/transcript-search", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courseSlug, lessonId, blockId, query }),
          signal: controller.signal,
        });
        if (!response.ok) {
          setSearchPolicy({ query, status: "blocked", segments: [] });
          return;
        }
        const result = (await response.json()) as {
          allowed?: unknown;
          segments?: unknown;
        };
        const responseDocument = sanitizeVideoTranscriptDocument({
          version: 1,
          language: document?.language ?? "de",
          segments: result.segments,
        });
        setSearchPolicy({
          query,
          status: result.allowed === true ? "ready" : "blocked",
          segments:
            result.allowed === true ? (responseDocument?.segments ?? []) : [],
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSearchPolicy({ query, status: "blocked", segments: [] });
      }
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [blockId, courseSlug, document?.language, lessonId, query]);

  useEffect(() => {
    if (!tracksRequiredPlayback) {
      completionCallbackRef.current?.(policy.completionMode !== "required");
      return;
    }
    const controller = new AbortController();
    const parameters = new URLSearchParams({
      courseId: courseId!,
      lessonId: lessonId!,
      blockId: blockId!,
    });
    void fetch(`/api/media-playback?${parameters}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as {
          watchedMilliseconds?: number;
          furthestMilliseconds?: number;
          requiredMilliseconds?: number;
          completed?: boolean;
        };
        const completed = result.completed === true;
        furthestMillisecondsRef.current = Math.max(
          0,
          Number(result.furthestMilliseconds) || 0,
        );
        setPlaybackProgress({
          watchedMilliseconds: Math.max(
            0,
            Number(result.watchedMilliseconds) || 0,
          ),
          requiredMilliseconds: Math.max(
            0,
            Number(result.requiredMilliseconds) || 0,
          ),
          completed,
        });
        completionCallbackRef.current?.(completed);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [
    blockId,
    courseId,
    lessonId,
    mediaAssetId,
    policy.completionMode,
    tracksRequiredPlayback,
  ]);

  useEffect(() => {
    if (!playing || !tracksRequiredPlayback) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || heartbeatPendingRef.current) return;
      const now = Date.now();
      const elapsed = lastHeartbeatAtRef.current
        ? Math.min(10_000, now - lastHeartbeatAtRef.current)
        : 0;
      lastHeartbeatAtRef.current = now;
      postPlaybackHeartbeat(video, elapsed);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [playing, postPlaybackHeartbeat, tracksRequiredPlayback]);

  const updateQuery = (value: string) => {
    setQuery(value);
    setSearchPolicy(
      courseSlug && lessonId && blockId && value.trim()
        ? { query: value, status: "pending", segments: [] }
        : null,
    );
  };

  const seekTo = (startMs: number) => {
    const video = videoRef.current;
    if (!video) return;
    const playableStartMs =
      playbackPositionAfterRemovedSegment(policy, startMs) ?? startMs;
    video.currentTime = playableStartMs / 1_000;
    setEndCardVisible(false);
    setActiveStartMs(playableStartMs);
    void video.play().catch(() => undefined);
  };

  const updateActiveSegment = () => {
    const video = videoRef.current;
    if (!video) return;
    const currentMs = Math.floor(video.currentTime * 1_000);
    const cutEndMs = playbackPositionAfterRemovedSegment(policy, currentMs);
    if (cutEndMs !== null) {
      lastAcceptedTimeRef.current = cutEndMs / 1_000;
      video.currentTime = cutEndMs / 1_000;
      setActiveStartMs(null);
      return;
    }
    if (document) {
      const active = document.segments.find(
        (segment) => segment.startMs <= currentMs && segment.endMs > currentMs,
      );
      setActiveStartMs(active?.startMs ?? null);
    }
    const endSeconds =
      policy.trimEndMs === null ? video.duration : policy.trimEndMs / 1_000;
    if (Number.isFinite(endSeconds) && video.currentTime >= endSeconds) {
      lastAcceptedTimeRef.current = endSeconds;
      video.currentTime = endSeconds;
      video.pause();
      setPlaying(false);
      setEndCardVisible(Boolean(endCardDocument));
    } else if (!video.seeking) {
      lastAcceptedTimeRef.current = video.currentTime;
      const durationMs = Math.round(video.duration * 1_000);
      const playbackOffset = Number.isSafeInteger(durationMs)
        ? sourcePositionToPlaybackOffset(policy, durationMs, currentMs)
        : null;
      furthestMillisecondsRef.current = Math.max(
        furthestMillisecondsRef.current,
        playbackOffset ?? currentMs - policy.trimStartMs,
      );
    }
  };

  const onLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setEndCardVisible(false);
    try {
      const preference = parseVideoVolumePreference(
        window.localStorage.getItem(VIDEO_VOLUME_STORAGE_KEY),
      );
      if (preference) {
        video.volume = preference.volume;
        video.muted = preference.muted;
      }
    } catch {
      // Storage can be unavailable in hardened or private browser contexts.
    }
    try {
      const preference = parseVideoPlaybackRatePreference(
        window.sessionStorage.getItem(VIDEO_PLAYBACK_RATE_STORAGE_KEY),
      );
      if (preference) {
        video.playbackRate = preference.rate;
        setPlaybackRate(preference.rate);
      }
    } catch {
      // Playback remains functional when browser storage is unavailable.
    }
    const startSeconds = policy.trimStartMs / 1_000;
    if (video.currentTime < startSeconds) {
      lastAcceptedTimeRef.current = startSeconds;
      video.currentTime = startSeconds;
    } else {
      lastAcceptedTimeRef.current = video.currentTime;
    }
    const cutEndMs = playbackPositionAfterRemovedSegment(
      policy,
      Math.round(video.currentTime * 1_000),
    );
    if (cutEndMs !== null) {
      lastAcceptedTimeRef.current = cutEndMs / 1_000;
      video.currentTime = cutEndMs / 1_000;
    }
  };

  const onSeeking = () => {
    const video = videoRef.current;
    if (!video) return;
    const target = video.currentTime;
    const startSeconds = policy.trimStartMs / 1_000;
    const durationMs = Math.round(video.duration * 1_000);
    const maximumWatchedSourceMs = Number.isSafeInteger(durationMs)
      ? playbackOffsetToSourcePosition(
          policy,
          durationMs,
          furthestMillisecondsRef.current + 2_000,
        )
      : null;
    const maximumWatched =
      maximumWatchedSourceMs === null
        ? startSeconds + furthestMillisecondsRef.current / 1_000 + 2
        : maximumWatchedSourceMs / 1_000;
    const cutEndMs = playbackPositionAfterRemovedSegment(
      policy,
      Math.round(target * 1_000),
    );
    const normalizedTarget = cutEndMs === null ? target : cutEndMs / 1_000;
    const rejected =
      (policy.seeking === "disabled" &&
        Math.abs(normalizedTarget - lastAcceptedTimeRef.current) > 1.5) ||
      (policy.seeking === "watched_only" && normalizedTarget > maximumWatched);
    if (rejected) {
      video.currentTime = lastAcceptedTimeRef.current;
    } else if (cutEndMs !== null) {
      lastAcceptedTimeRef.current = normalizedTarget;
      video.currentTime = normalizedTarget;
    }
  };

  return (
    <section>
      {title ? (
        <h2 className="mb-3 text-base font-bold text-[#243444]">{title}</h2>
      ) : null}
      <div className="relative overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          controls
          preload="metadata"
          playsInline
          poster={
            mediaAssetId
              ? `/api/media-assets/${mediaAssetId}/derivatives/thumbnail`
              : undefined
          }
          onLoadedMetadata={onLoadedMetadata}
          onError={() => {
            if (!transcodeJobId) return;
            setFailedCompositionSourceKey(compositionSourceKey);
            setPlaying(false);
            completionCallbackRef.current?.(false);
          }}
          onSeeking={onSeeking}
          onVolumeChange={(event) => {
            try {
              window.localStorage.setItem(
                VIDEO_VOLUME_STORAGE_KEY,
                JSON.stringify(videoVolumePreference(event.currentTarget)),
              );
            } catch {
              // Playback remains functional when browser storage is unavailable.
            }
          }}
          onRateChange={(event) => {
            const preference = videoPlaybackRatePreference(event.currentTarget);
            if (event.currentTarget.playbackRate !== preference.rate) {
              event.currentTarget.playbackRate = preference.rate;
            }
            setPlaybackRate(preference.rate);
            try {
              window.sessionStorage.setItem(
                VIDEO_PLAYBACK_RATE_STORAGE_KEY,
                JSON.stringify(preference),
              );
            } catch {
              // Playback remains functional when browser storage is unavailable.
            }
          }}
          onPlay={() => {
            lastHeartbeatAtRef.current = Date.now();
            setEndCardVisible(false);
            setPlaying(true);
            const video = videoRef.current;
            if (video) postPlaybackHeartbeat(video, 0);
          }}
          onPause={() => {
            const video = videoRef.current;
            const now = Date.now();
            if (video && lastHeartbeatAtRef.current) {
              postPlaybackHeartbeat(video, now - lastHeartbeatAtRef.current);
            }
            lastHeartbeatAtRef.current = now;
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
            setEndCardVisible(Boolean(endCardDocument));
          }}
          onTimeUpdate={updateActiveSegment}
          className="aspect-video w-full bg-black"
        >
          {mediaAssetId ? (
            <source
              src={`/api/media-assets/${mediaAssetId}/derivatives/transcode${
                transcodeJobId
                  ? `?job=${encodeURIComponent(transcodeJobId)}`
                  : ""
              }`}
              type="video/mp4"
            />
          ) : null}
          {!transcodeJobId ? <source src={src} /> : null}
          {webVttUrl && document ? (
            <track
              default
              kind="captions"
              src={webVttUrl}
              srcLang={document.language}
              label={document.language.toUpperCase()}
            />
          ) : null}
        </video>
        {transcodeJobId && (!mediaAssetId || compositionLoadFailed) ? (
          <div
            role="alert"
            className="absolute inset-0 flex items-center justify-center bg-[#101820]/95 p-6 text-center text-sm font-semibold leading-6 text-white"
          >
            <p className="max-w-lg">{compositionCopy.playbackUnavailable}</p>
          </div>
        ) : null}
        {endCardVisible && endCardDocument ? (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-[#101820]/95 p-4 text-center text-white sm:p-8"
          >
            <div className="max-h-full w-full max-w-xl overflow-y-auto">
              <h3 className="text-xl font-bold leading-tight sm:text-2xl">
                {endCardDocument.heading}
              </h3>
              {endCardDocument.text ? (
                <p className="mx-auto mt-3 max-w-lg whitespace-pre-wrap text-sm leading-6 text-[#dce7ec]">
                  {endCardDocument.text}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    const replayStartMs =
                      playbackPositionAfterRemovedSegment(
                        policy,
                        policy.trimStartMs,
                      ) ?? policy.trimStartMs;
                    const startSeconds = replayStartMs / 1_000;
                    lastAcceptedTimeRef.current = startSeconds;
                    video.currentTime = startSeconds;
                    setEndCardVisible(false);
                    void video.play().catch(() => undefined);
                  }}
                  className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-md border border-white/40 px-4 text-sm font-bold text-white hover:bg-white/10"
                >
                  <RotateCcw className="size-4" />
                  {endCardCopy.replay}
                </button>
                {endCardDocument.cta ? (
                  <a
                    href={endCardDocument.cta.href}
                    {...(isExternalRichTextHref(endCardDocument.cta.href)
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                    className="focus-ring inline-flex min-h-10 items-center justify-center rounded-md bg-[#2b9188] px-4 text-sm font-bold text-white hover:bg-[#237b73]"
                  >
                    {endCardDocument.cta.label}
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex justify-end">
        <label className="flex items-center gap-2 text-xs font-semibold text-[#52606d]">
          <span>{copy("video.playbackSpeed")}</span>
          <select
            value={playbackRate}
            onChange={(event) => {
              const nextRate = Number(
                event.currentTarget.value,
              ) as VideoPlaybackRate;
              const video = videoRef.current;
              if (video) video.playbackRate = nextRate;
              setPlaybackRate(nextRate);
            }}
            aria-label={copy("video.playbackSpeed")}
            className="focus-ring h-8 w-20 rounded-md border border-[#d5dde3] bg-white px-2 text-xs font-bold tabular-nums text-[#354555]"
          >
            {VIDEO_PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {rate}x
              </option>
            ))}
          </select>
        </label>
      </div>
      {policy.completionMode === "required" ? (
        <div className="mt-2" aria-live="polite">
          <div className="h-1.5 overflow-hidden rounded bg-[#dfe7ed]">
            <div
              className="h-full bg-[#2b9188] transition-[width]"
              style={{
                width: `${playbackProgress.requiredMilliseconds > 0 ? Math.min(100, Math.round((playbackProgress.watchedMilliseconds / playbackProgress.requiredMilliseconds) * 100)) : 0}%`,
              }}
            />
          </div>
          <p className="mt-1 text-[10px] font-semibold text-[#657580]">
            {playbackProgress.completed
              ? copy("video.requiredComplete")
              : copy("video.requiredIncomplete")}
          </p>
        </div>
      ) : null}
      {caption ? (
        <p className="mt-2 text-xs leading-5 text-[#71808b]">{caption}</p>
      ) : null}

      {document ? (
        <div className="mt-4 border-t border-[#dfe4e8] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-[#354555]">
              <Captions className="size-4 text-[#365f8d]" />
              {copy("video.transcript")}
            </div>
            <label className="relative block w-full sm:w-72">
              <span className="sr-only">{copy("video.search")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#71808b]" />
              <input
                type="search"
                value={query}
                onChange={(event) => updateQuery(event.target.value)}
                maxLength={500}
                placeholder={copy("video.search")}
                className="focus-ring h-9 w-full rounded-md border border-[#d5dde3] bg-white pl-9 pr-9 text-sm"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => updateQuery("")}
                  aria-label={copy("video.clearSearch")}
                  title={copy("video.clearSearch")}
                  className="focus-ring absolute right-1.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-[#71808b] hover:bg-[#eef2f4]"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
          </div>

          {currentSearchStatus === "pending" ? (
            <p className="mt-3 text-xs text-[#71808b]" aria-live="polite">
              {copy("video.searchPending")}
            </p>
          ) : segments.length ? (
            <ol
              aria-label={copy("video.timestamps")}
              className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1"
            >
              {segments.map((segment) => (
                <li key={`${segment.startMs}-${segment.endMs}-${segment.text}`}>
                  <button
                    type="button"
                    onClick={() => seekTo(segment.startMs)}
                    aria-current={
                      segment.startMs === activeStartMs ? "true" : undefined
                    }
                    className={`focus-ring grid w-full grid-cols-[4rem_1fr] gap-3 rounded-md px-2.5 py-2 text-left text-xs leading-5 hover:bg-[#f2f5f7] ${
                      segment.startMs === activeStartMs
                        ? "bg-[#e9f2f7] text-[#244f70]"
                        : "text-[#52606d]"
                    }`}
                  >
                    <span className="font-bold tabular-nums text-[#365f8d]">
                      {formatTranscriptTimestamp(segment.startMs)}
                    </span>
                    <span>{segment.text}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-xs text-[#71808b]">
              {copy("video.noMatches")}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
