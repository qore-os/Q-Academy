"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Circle,
  LoaderCircle,
  Mic,
  MonitorUp,
  ShieldAlert,
  Square,
  Trash2,
  Upload,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  formatRecordingTime,
  MAX_SUBMISSION_RECORDING_BYTES,
  MAX_SUBMISSION_RECORDING_DURATION_MS,
  recordingFileName,
  selectRecordingMimeType,
  type SubmissionRecordingMode,
} from "@/lib/media/submission-recorder";
import {
  requestBrowserRecording,
  stopBrowserRecordingStream,
} from "@/lib/media/browser-recorder-runtime";
import {
  formatLearningFileSize,
  getLearningUiCopy,
  type LearningUiCopy,
} from "@/lib/i18n/learning";
import type { AppLocale } from "@/lib/i18n/model";

type RecorderStatus =
  "idle" | "requesting" | "recording" | "stopping" | "preview" | "error";

type RecorderAvailability = {
  secureContext: boolean;
  mediaRecorder: boolean;
  getUserMedia: boolean;
  getDisplayMedia: boolean;
  mimeTypes: Record<SubmissionRecordingMode, string | null>;
};

type RecordingDraft = {
  file: File;
  mode: SubmissionRecordingMode;
  durationMs: number;
  objectUrl: string;
  durationLimitReached: boolean;
};

function clearVideoSource(video: HTMLVideoElement | null) {
  if (!video) return;
  video.pause();
  video.srcObject = null;
}

function modeLabel(mode: SubmissionRecordingMode, copy: LearningUiCopy) {
  if (mode === "audio") return copy("recorder.audio");
  if (mode === "video") return copy("recorder.video");
  return copy("recorder.screen");
}

export function SubmissionRecorder({
  disabled,
  locale,
  onBlockingChange,
  onFile,
  resetKey,
  allowedModes = ["audio", "video", "screen"],
  heading,
  fileRejectedMessage,
}: {
  disabled: boolean;
  locale: AppLocale;
  onBlockingChange: (blocking: boolean) => void;
  onFile: (file: File) => boolean;
  resetKey?: string;
  allowedModes?: readonly SubmissionRecordingMode[];
  heading?: string;
  fileRejectedMessage?: string;
}) {
  const copy = useMemo(() => getLearningUiCopy(locale), [locale]);
  const resolvedHeading = heading ?? copy("recorder.heading");
  const resolvedFileRejectedMessage =
    fileRejectedMessage ?? copy("attachments.limitReached");
  const [availability, setAvailability] = useState<RecorderAvailability | null>(
    null,
  );
  const headingId = useId();
  const [mode, setMode] = useState<SubmissionRecordingMode>(
    allowedModes[0] ?? "audio",
  );
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [draft, setDraft] = useState<RecordingDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordedBytesRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const mimeTypeRef = useRef("");
  const sizeLimitReachedRef = useRef(false);
  const durationLimitReachedRef = useRef(false);
  const recorderFailureRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const draftCommitRef = useRef(false);
  const previousResetKeyRef = useRef(resetKey);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const disposeRecorder = useCallback(
    (updateState: boolean) => {
      generationRef.current += 1;
      clearTimer();
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onerror = null;
        recorder.onstop = null;
        if (recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // The stream is stopped below even if the recorder already closed.
          }
        }
      }
      stopBrowserRecordingStream(streamRef.current);
      streamRef.current = null;
      clearVideoSource(liveVideoRef.current);
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      sizeLimitReachedRef.current = false;
      durationLimitReachedRef.current = false;
      recorderFailureRef.current = null;
      draftCommitRef.current = false;
      revokePreview();
      if (updateState && mountedRef.current) {
        setDraft(null);
        setElapsedMs(0);
        setError(null);
        setStatus("idle");
      }
    },
    [clearTimer, revokePreview],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const secureContext = window.isSecureContext;
      const mediaRecorder =
        typeof MediaRecorder !== "undefined" &&
        typeof MediaRecorder.isTypeSupported === "function";
      const getUserMedia =
        typeof navigator.mediaDevices?.getUserMedia === "function";
      const getDisplayMedia =
        typeof navigator.mediaDevices?.getDisplayMedia === "function";
      const supported = (recordingMode: SubmissionRecordingMode) =>
        secureContext && mediaRecorder
          ? selectRecordingMimeType(
              recordingMode,
              MediaRecorder.isTypeSupported.bind(MediaRecorder),
            )
          : null;
      setAvailability({
        secureContext,
        mediaRecorder,
        getUserMedia,
        getDisplayMedia,
        mimeTypes: {
          audio: supported("audio"),
          video: supported("video"),
          screen: supported("screen"),
        },
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      disposeRecorder(false);
    };
  }, [disposeRecorder]);

  useEffect(() => {
    if (resetKey && resetKey !== previousResetKeyRef.current) {
      disposeRecorder(true);
    }
    previousResetKeyRef.current = resetKey;
  }, [disposeRecorder, resetKey]);

  useEffect(() => {
    if (disabled) disposeRecorder(true);
  }, [disabled, disposeRecorder]);

  const busy = ["requesting", "recording", "stopping"].includes(status);
  const blocking = busy || draft !== null;
  useEffect(() => {
    onBlockingChange(blocking);
    return () => onBlockingChange(false);
  }, [blocking, onBlockingChange]);

  useEffect(() => {
    const video = liveVideoRef.current;
    if (!video || status !== "recording" || !streamRef.current) return;
    video.srcObject = streamRef.current;
    video.muted = true;
    void video.play().catch(() => undefined);
    return () => clearVideoSource(video);
  }, [status]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    if (mountedRef.current) setStatus("stopping");
    try {
      recorder.stop();
    } catch {
      recorderFailureRef.current = copy("recorder.stopError");
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      recorderRef.current = null;
      stopBrowserRecordingStream(streamRef.current);
      streamRef.current = null;
      clearTimer();
      clearVideoSource(liveVideoRef.current);
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      if (mountedRef.current) {
        setError(recorderFailureRef.current);
        setStatus("error");
      }
    }
  }, [clearTimer, copy]);

  const startRecording = async () => {
    const mimeType = availability?.mimeTypes[mode] ?? null;
    const captureAvailable =
      availability?.secureContext &&
      availability.mediaRecorder &&
      (mode === "screen"
        ? availability.getDisplayMedia
        : availability.getUserMedia);
    if (disabled || draft || busy || !mimeType || !captureAvailable) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    setError(null);
    setElapsedMs(0);
    setStatus("requesting");

    let stream: MediaStream | null = null;
    try {
      // Capture and recorder construction stay together so constructor
      // failures cannot leave already granted browser tracks running.
      const requested = await requestBrowserRecording({
        mode,
        includeSystemAudio,
        mimeType,
        mediaDevices: navigator.mediaDevices,
        MediaRecorderClass: MediaRecorder,
      });
      stream = requested.stream;
      if (!mountedRef.current || generation !== generationRef.current) {
        stopBrowserRecordingStream(stream);
        return;
      }
      const recorder = requested.recorder;

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      sizeLimitReachedRef.current = false;
      durationLimitReachedRef.current = false;
      recorderFailureRef.current = null;
      draftCommitRef.current = false;
      mimeTypeRef.current = mimeType;
      startedAtRef.current = performance.now();

      for (const track of stream.getTracks()) {
        track.onended = () => stopRecording();
      }

      recorder.ondataavailable = (event) => {
        if (!event.data.size || generation !== generationRef.current) return;
        chunksRef.current.push(event.data);
        recordedBytesRef.current += event.data.size;
        if (
          recordedBytesRef.current > MAX_SUBMISSION_RECORDING_BYTES &&
          recorder.state !== "inactive"
        ) {
          sizeLimitReachedRef.current = true;
          stopRecording();
        }
      };
      recorder.onerror = (event) => {
        void event;
        recorderFailureRef.current = copy("recorder.recordingError");
        stopRecording();
      };
      recorder.onstop = () => {
        const rawDurationMs = performance.now() - startedAtRef.current;
        const durationMs = durationLimitReachedRef.current
          ? MAX_SUBMISSION_RECORDING_DURATION_MS
          : rawDurationMs;
        clearTimer();
        stopBrowserRecordingStream(streamRef.current);
        streamRef.current = null;
        clearVideoSource(liveVideoRef.current);
        recorderRef.current = null;
        const chunks = chunksRef.current;
        chunksRef.current = [];

        if (!mountedRef.current || generation !== generationRef.current) return;
        if (recorderFailureRef.current) {
          setError(recorderFailureRef.current);
          setStatus("error");
          return;
        }
        if (sizeLimitReachedRef.current) {
          setError(copy("recorder.tooLarge"));
          setStatus("error");
          return;
        }

        const fileDetails = recordingFileName(mode, mimeTypeRef.current);
        if (!fileDetails) {
          setError(copy("recorder.invalidFormat"));
          setStatus("error");
          return;
        }
        const blob = new Blob(chunks, { type: mimeTypeRef.current });
        if (!blob.size || durationMs <= 0) {
          setError(copy("recorder.invalidMedia"));
          setStatus("error");
          return;
        }
        const file = new File([blob], fileDetails.fileName, {
          type: fileDetails.baseMimeType,
          lastModified: Date.now(),
        });
        const objectUrl = URL.createObjectURL(file);
        revokePreview();
        previewUrlRef.current = objectUrl;
        setElapsedMs(durationMs);
        setDraft({
          file,
          mode,
          durationMs,
          objectUrl,
          durationLimitReached: durationLimitReachedRef.current,
        });
        setStatus("preview");
      };

      recorder.start(1_000);
      setStatus("recording");
      timerRef.current = window.setInterval(() => {
        if (generation !== generationRef.current) return;
        const nextElapsedMs = performance.now() - startedAtRef.current;
        setElapsedMs(
          Math.min(nextElapsedMs, MAX_SUBMISSION_RECORDING_DURATION_MS),
        );
        if (
          nextElapsedMs >= MAX_SUBMISSION_RECORDING_DURATION_MS &&
          recorder.state !== "inactive"
        ) {
          durationLimitReachedRef.current = true;
          stopRecording();
        }
      }, 250);
    } catch {
      const failedRecorder = recorderRef.current;
      recorderRef.current = null;
      if (failedRecorder) {
        failedRecorder.ondataavailable = null;
        failedRecorder.onerror = null;
        failedRecorder.onstop = null;
        if (failedRecorder.state !== "inactive") {
          try {
            failedRecorder.stop();
          } catch {
            // The capture tracks are stopped below.
          }
        }
      }
      stopBrowserRecordingStream(stream);
      streamRef.current = null;
      clearTimer();
      clearVideoSource(liveVideoRef.current);
      chunksRef.current = [];
      recordedBytesRef.current = 0;
      if (!mountedRef.current || generation !== generationRef.current) return;
      setError(copy("recorder.captureError"));
      setStatus("error");
    }
  };

  const useDraft = () => {
    if (!draft || draftCommitRef.current) return;
    draftCommitRef.current = true;
    if (!onFile(draft.file)) {
      draftCommitRef.current = false;
      setError(resolvedFileRejectedMessage);
      setStatus("error");
      return;
    }
    revokePreview();
    setDraft(null);
    setElapsedMs(0);
    setError(null);
    setStatus("idle");
  };

  const modeAvailable = (candidate: SubmissionRecordingMode) => {
    if (!allowedModes.includes(candidate)) return false;
    if (!availability?.secureContext || !availability.mediaRecorder)
      return false;
    if (!availability.mimeTypes[candidate]) return false;
    return candidate === "screen"
      ? availability.getDisplayMedia
      : availability.getUserMedia;
  };

  const unavailableMessage = !availability
    ? copy("recorder.checking")
    : !availability.secureContext
      ? copy("recorder.secureContext")
      : !availability.mediaRecorder
        ? copy("recorder.unsupported")
        : !modeAvailable(mode)
          ? copy("recorder.modeUnsupported", {
              mode: modeLabel(mode, copy),
            })
          : null;

  const availableModes: Array<{
    value: SubmissionRecordingMode;
    label: string;
    icon: typeof Mic;
  }> = [
    { value: "audio", label: copy("recorder.audio"), icon: Mic },
    { value: "video", label: copy("recorder.video"), icon: Video },
    { value: "screen", label: copy("recorder.screen"), icon: MonitorUp },
  ];
  const modes = availableModes.filter((candidate) =>
    allowedModes.includes(candidate.value),
  );

  return (
    <section
      className="mt-3 border-t border-[#ead7d3] pt-3"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="text-xs font-semibold text-[var(--theme-strong-text)]"
        >
          {resolvedHeading}
        </h3>
        <span className="text-[10px] text-[var(--theme-coral-text)]">
          {copy("recorder.maxHint")}
        </span>
      </div>

      <div
        className="mt-2 flex w-full overflow-x-auto rounded-md border border-[#d8bbb6] bg-white p-1 sm:w-fit"
        role="group"
        aria-label={copy("recorder.mode")}
      >
        {modes.map((candidate) => {
          const Icon = candidate.icon;
          const selected = mode === candidate.value;
          return (
            <button
              key={candidate.value}
              type="button"
              disabled={
                disabled ||
                busy ||
                draft !== null ||
                !modeAvailable(candidate.value)
              }
              onClick={() => {
                setMode(candidate.value);
                setError(null);
                setStatus("idle");
              }}
              className={`focus-ring flex h-8 min-w-24 flex-1 items-center justify-center gap-1.5 rounded px-2 text-[10px] font-semibold sm:flex-none ${
                selected
                  ? "bg-[#17324d] text-white"
                  : "text-[var(--theme-strong-text)] hover:bg-[var(--theme-input-background)] disabled:cursor-not-allowed disabled:opacity-35"
              }`}
              aria-pressed={selected}
              title={
                modeAvailable(candidate.value)
                  ? candidate.label
                  : copy("recorder.modeUnsupported", {
                      mode: candidate.label,
                    })
              }
            >
              <Icon className="size-3.5" />
              {candidate.label}
            </button>
          );
        })}
      </div>

      {mode === "screen" && !draft ? (
        <label className="mt-2 flex w-fit items-center gap-2 text-[10px] font-medium text-[var(--theme-muted-text)]">
          <input
            type="checkbox"
            checked={includeSystemAudio}
            disabled={disabled || busy}
            onChange={(event) => setIncludeSystemAudio(event.target.checked)}
            className="size-3.5 accent-[#2b9188]"
          />
          {copy("recorder.systemAudio")}
        </label>
      ) : null}

      {status === "recording" || status === "stopping" ? (
        <div className="mt-3 overflow-hidden rounded-md bg-[#17212b]">
          {mode !== "audio" ? (
            <video
              ref={liveVideoRef}
              autoPlay
              muted
              playsInline
              className="aspect-video w-full bg-black object-contain"
              aria-label={copy("recorder.mutedPreview")}
            />
          ) : (
            <div className="grid min-h-28 place-items-center">
              <Mic className="size-8 text-white/75" />
            </div>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 px-3 py-2 text-white">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold">
              {status === "recording" ? (
                <Circle className="size-2.5 fill-[#ee6c5d] text-[#ee6c5d]" />
              ) : (
                <LoaderCircle className="size-3 animate-spin" />
              )}
              {status === "recording"
                ? copy("recorder.recording")
                : copy("recorder.stopping")}
            </span>
            <span className="font-mono text-xs" role="timer" aria-live="off">
              {formatRecordingTime(elapsedMs)} / 10:00
            </span>
          </div>
        </div>
      ) : null}

      {draft ? (
        <div className="mt-3 overflow-hidden rounded-md border border-[#d8bbb6] bg-white">
          {draft.mode === "audio" ? (
            <audio
              controls
              preload="metadata"
              src={draft.objectUrl}
              className="w-full px-3 pt-3"
            />
          ) : (
            <video
              controls
              playsInline
              preload="metadata"
              src={draft.objectUrl}
              className="aspect-video w-full bg-black object-contain"
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#ead7d3] px-3 py-2">
            <span className="text-[10px] text-[var(--theme-muted-text)]">
              {formatRecordingTime(draft.durationMs)} |{" "}
              {formatLearningFileSize(draft.file.size, locale)}
              {draft.durationLimitReached ? copy("recorder.limitSuffix") : ""}
            </span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={useDraft}
              >
                <Upload className="size-3.5" />
                {copy("recorder.use")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() => disposeRecorder(true)}
              >
                <Trash2 className="size-3.5" />
                {copy("recorder.discard")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {!draft ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {status === "recording" ? (
            <Button type="button" size="sm" onClick={stopRecording}>
              <Square className="size-3.5 fill-current" />
              {copy("recorder.stop")}
            </Button>
          ) : status === "requesting" || status === "stopping" ? (
            <Button type="button" size="sm" disabled>
              <LoaderCircle className="size-3.5 animate-spin" />
              {status === "requesting"
                ? copy("recorder.requesting")
                : copy("recorder.stopping")}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={disabled || Boolean(unavailableMessage)}
              onClick={() => void startRecording()}
            >
              <Circle className="size-3.5 fill-[#ee6c5d] text-[#ee6c5d]" />
              {copy("recorder.start")}
            </Button>
          )}
          {busy ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => disposeRecorder(true)}
            >
              <Trash2 className="size-3.5" />
              {copy("recorder.discard")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {unavailableMessage && !draft && !busy ? (
        <p
          className="mt-2 text-[10px] text-[var(--theme-muted-text)]"
          role="status"
        >
          {unavailableMessage}
        </p>
      ) : null}
      {error ? (
        <p
          className="mt-2 flex items-start gap-1.5 text-[10px] text-[var(--theme-coral-text)]"
          role="alert"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {status === "requesting"
          ? copy("recorder.statusRequesting")
          : status === "recording"
            ? copy("recorder.statusRecording")
            : status === "stopping"
              ? copy("recorder.statusStopping")
              : status === "preview"
                ? copy("recorder.statusPreview")
                : ""}
      </span>
    </section>
  );
}
