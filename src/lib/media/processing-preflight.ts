import { isAbsolute, parse, resolve } from "node:path";

const SAFE_EXECUTABLE = /^[^\u0000-\u001f\u007f]{1,1024}$/;

export type MediaProcessingPreflightConfiguration = Readonly<{
  workRoot: string;
  ffmpeg: string;
  ffprobe: string;
  transcript:
    | Readonly<{ mode: "command"; executable: string; arguments: readonly string[] }>
    | Readonly<{ mode: "sidecar"; directory: string }>;
}>;

function executable(value: string | undefined, fallback: string, name: string) {
  const result = value?.trim() || fallback;
  if (!SAFE_EXECUTABLE.test(result)) throw new Error(`${name} is invalid.`);
  return result;
}

function commandArguments(value: string | undefined) {
  if (!value?.trim()) return ["--help"];
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
  const rawRoot = environment.MEDIA_PROCESSING_WORK_ROOT?.trim() ||
    resolve(process.cwd(), ".data", "media-processing");
  if (production && !isAbsolute(rawRoot)) {
    throw new Error("MEDIA_PROCESSING_WORK_ROOT must be absolute in production.");
  }
  const workRoot = resolve(rawRoot);
  if (workRoot === parse(workRoot).root || workRoot.length < 8 || workRoot.includes("\0")) {
    throw new Error("MEDIA_PROCESSING_WORK_ROOT is unsafe.");
  }
  const ffmpeg = executable(environment.MEDIA_FFMPEG_PATH, "ffmpeg", "MEDIA_FFMPEG_PATH");
  const ffprobe = executable(environment.MEDIA_FFPROBE_PATH, "ffprobe", "MEDIA_FFPROBE_PATH");
  const sidecar = environment.MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY?.trim();
  const transcriptCommand = environment.MEDIA_TRANSCRIPT_COMMAND?.trim();
  if (production && sidecar) {
    throw new Error("MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY is not allowed in production.");
  }
  if (Boolean(sidecar) === Boolean(transcriptCommand)) {
    throw new Error("Configure exactly one transcript provider.");
  }
  return {
    workRoot,
    ffmpeg,
    ffprobe,
    transcript: transcriptCommand
      ? {
          mode: "command",
          executable: executable(transcriptCommand, "", "MEDIA_TRANSCRIPT_COMMAND"),
          arguments: commandArguments(environment.MEDIA_TRANSCRIPT_PREFLIGHT_ARGS_JSON),
        }
      : { mode: "sidecar", directory: resolve(sidecar!) },
  };
}
