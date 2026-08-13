import { isAbsolute, parse, resolve } from "node:path";

const SAFE_EXECUTABLE = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const MAX_PROCESSOR_TIMEOUT_SECONDS = 18_000;
const DEFAULT_FFMPEG_TIMEOUT_SECONDS = 10_800;
const DEFAULT_TRANSCRIPT_TIMEOUT_SECONDS = 18_000;

export type MediaProcessingPreflightConfiguration = Readonly<{
  workRoot: string;
  ffmpeg: string;
  ffprobe: string;
  ffmpegTimeoutMs: number;
  transcriptTimeoutMs: number;
  transcript:
    | Readonly<{ mode: "command"; executable: string; arguments: readonly string[] }>
    | Readonly<{ mode: "sidecar"; directory: string }>
    | Readonly<{ mode: "disabled" }>;
}>;

function processorTimeoutMs(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallbackSeconds: number,
) {
  const raw = environment[name]?.trim();
  if (!raw) return fallbackSeconds * 1_000;
  if (!/^[1-9][0-9]{1,4}$/.test(raw)) {
    throw new Error(`${name} must be an integer number of seconds.`);
  }
  const seconds = Number(raw);
  if (seconds < 60 || seconds > MAX_PROCESSOR_TIMEOUT_SECONDS) {
    throw new Error(
      `${name} must be between 60 and ${MAX_PROCESSOR_TIMEOUT_SECONDS} seconds.`,
    );
  }
  return seconds * 1_000;
}

export function resolveMediaProcessorTimeouts(
  environment: Readonly<Record<string, string | undefined>>,
) {
  return {
    ffmpegTimeoutMs: processorTimeoutMs(
      environment,
      "MEDIA_FFMPEG_TIMEOUT_SECONDS",
      DEFAULT_FFMPEG_TIMEOUT_SECONDS,
    ),
    transcriptTimeoutMs: processorTimeoutMs(
      environment,
      "MEDIA_TRANSCRIPT_TIMEOUT_SECONDS",
      DEFAULT_TRANSCRIPT_TIMEOUT_SECONDS,
    ),
  } as const;
}

function executable(value: string | undefined, fallback: string, name: string) {
  const result = value?.trim() || fallback;
  if (!SAFE_EXECUTABLE.test(result)) throw new Error(`${name} is invalid.`);
  return result;
}

function commandArguments(value: string | undefined) {
  if (!value?.trim()) {
    throw new Error("MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON is invalid JSON.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 16 ||
    parsed.some((argument) => typeof argument !== "string" || argument.length > 2048 || /[\u0000-\u001f\u007f]/.test(argument))
  ) {
    throw new Error("MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON is unsafe.");
  }
  return parsed as string[];
}

export function resolveMediaProcessingPreflightConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): MediaProcessingPreflightConfiguration {
  const production = environment.NODE_ENV === "production";
  if (production && environment.Q_ACADEMY_RUNTIME_ROLE?.trim() !== "media-worker") {
    throw new Error("Q_ACADEMY_RUNTIME_ROLE must be media-worker.");
  }
  if (production && environment.MEDIA_STORAGE_DRIVER?.trim() !== "s3") {
    throw new Error("MEDIA_STORAGE_DRIVER must be s3 for the production runner.");
  }
  const rawRoot =
    environment.MEDIA_PROCESSING_WORK_ROOT?.trim() ||
    resolve(
      /* turbopackIgnore: true */ process.cwd(),
      ".data",
      "media-processing",
    );
  if (production && !isAbsolute(rawRoot)) {
    throw new Error("MEDIA_PROCESSING_WORK_ROOT must be absolute in production.");
  }
  const workRoot = resolve(/* turbopackIgnore: true */ rawRoot);
  if (workRoot === parse(workRoot).root || workRoot.length < 8 || workRoot.includes("\0")) {
    throw new Error("MEDIA_PROCESSING_WORK_ROOT is unsafe.");
  }
  const ffmpeg = executable(environment.MEDIA_FFMPEG_PATH, "ffmpeg", "MEDIA_FFMPEG_PATH");
  const ffprobe = executable(environment.MEDIA_FFPROBE_PATH, "ffprobe", "MEDIA_FFPROBE_PATH");
  const timeouts = resolveMediaProcessorTimeouts(environment);
  const sidecar = environment.MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY?.trim();
  const transcriptCommand = environment.MEDIA_TRANSCRIPT_COMMAND?.trim();
  const transcriptEnabledValue =
    environment.MEDIA_TRANSCRIPTION_ENABLED?.trim() || "false";
  if (!/^(?:true|false)$/.test(transcriptEnabledValue)) {
    throw new Error("MEDIA_TRANSCRIPTION_ENABLED must be true or false.");
  }
  const transcriptEnabled = transcriptEnabledValue === "true";
  if (production && sidecar) {
    throw new Error("MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY is not allowed in production.");
  }
  if (transcriptEnabled && Boolean(sidecar) === Boolean(transcriptCommand)) {
    throw new Error("Configure exactly one transcript provider.");
  }
  return {
    workRoot,
    ffmpeg,
    ffprobe,
    ...timeouts,
    transcript: !transcriptEnabled
      ? { mode: "disabled" }
      : transcriptCommand
      ? {
          mode: "command",
          executable: executable(transcriptCommand, "", "MEDIA_TRANSCRIPT_COMMAND"),
          arguments: commandArguments(environment.MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON),
        }
      : {
          mode: "sidecar",
          directory: resolve(/* turbopackIgnore: true */ sidecar!),
        },
  };
}
