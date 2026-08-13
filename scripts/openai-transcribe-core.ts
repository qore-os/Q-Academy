import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { constants, createReadStream, openAsBlob } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS,
  OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
  OPENAI_TRANSCRIPTION_MODEL,
  OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
  OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
} from "../src/lib/media/transcription-contract";

export const OPENAI_API_BASE_URL = "https://api.openai.com/v1" as const;
export const OPENAI_TRANSCRIPTIONS_URL =
  `${OPENAI_API_BASE_URL}/audio/transcriptions` as const;
export const DEFAULT_OPENAI_API_KEY_FILE =
  "/run/secrets/q-academy-openai-transcription-api-key" as const;

const AUDIO_CHUNK_SECONDS = 5 * 60;
const AUDIO_BITRATE = "32k";
const MAX_AUDIO_SECONDS = MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS / 1_000;
const FFMPEG_LIMIT_SECONDS = MAX_AUDIO_SECONDS + 1;
const MAX_AUDIO_CHUNKS = Math.ceil(FFMPEG_LIMIT_SECONDS / AUDIO_CHUNK_SECONDS);
const MAX_UPLOAD_BYTES = 24_000_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4 * 1_024 * 1_024;
const MAX_WEBVTT_BYTES = 550_000;
const MAX_TRANSCRIPT_SEGMENTS = 2_000;
const MAX_TRANSCRIPT_TEXT_LENGTH = 300_000;
const MAX_SEGMENT_TEXT_LENGTH = 1_000;
const MAX_PROVIDER_SEGMENT_TEXT_LENGTH = 20_000;
const TARGET_WEBVTT_CUE_TEXT_LENGTH = 240;
const MAX_RETRY_DELAY_MS = 10_000;
const PROVIDER_ATTEMPTS = 3;
const PROVIDER_REQUEST_TIMEOUT_MS = 180_000;
const FFMPEG_TIMEOUT_MS = 60 * 60_000;

export type OpenAiTranscriptionErrorCode =
  | "configuration_invalid"
  | "secret_file_invalid"
  | "audio_input_invalid"
  | "audio_conversion_failed"
  | "audio_duration_exceeded"
  | "provider_authentication_failed"
  | "provider_rate_limited"
  | "provider_request_rejected"
  | "provider_redirect_rejected"
  | "provider_unavailable"
  | "provider_response_invalid"
  | "provider_response_oversize"
  | "transcript_output_invalid"
  | "transcript_write_failed";

export class OpenAiTranscriptionError extends Error {
  constructor(
    readonly code: OpenAiTranscriptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OpenAiTranscriptionError";
  }
}

export type TranscriptSegment = Readonly<{
  startMilliseconds: number;
  endMilliseconds: number;
  text: string;
}>;

export type AudioChunk = Readonly<{
  path: string;
  startSeconds: number;
  endSeconds: number;
}>;

export type ProviderTranscript = Readonly<{
  durationSeconds: number;
  segments: readonly Readonly<{
    startSeconds: number;
    endSeconds: number;
    text: string;
  }>[];
}>;

export type OpenAiTranscriptionCliConfiguration =
  | Readonly<{
      mode: "preflight";
      apiKeyFile: string;
    }>
  | Readonly<{
      mode: "transcribe";
      apiKeyFile: string;
      inputPath: string;
      outputVttPath: string;
      language: string;
      providerLanguage: string;
    }>;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type SleepImplementation = (milliseconds: number) => Promise<void>;

function transcriptionError(
  code: OpenAiTranscriptionErrorCode,
  message: string,
): never {
  throw new OpenAiTranscriptionError(code, message);
}

function singleValueArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  let preflight = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--preflight") {
      if (preflight) {
        transcriptionError(
          "configuration_invalid",
          "The preflight option was provided more than once.",
        );
      }
      preflight = true;
      continue;
    }
    if (
      !["--api-key-file", "--input", "--output-vtt", "--language"].includes(
        argument,
      )
    ) {
      transcriptionError(
        "configuration_invalid",
        "The transcription command contains an unsupported option.",
      );
    }
    if (values.has(argument)) {
      transcriptionError(
        "configuration_invalid",
        "The transcription command contains a duplicate option.",
      );
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--") || value.length > 4_096) {
      transcriptionError(
        "configuration_invalid",
        "A transcription command option is missing its bounded value.",
      );
    }
    values.set(argument, value);
    index += 1;
  }
  return { preflight, values };
}

function language(value: string | undefined) {
  const normalized = value ?? "";
  if (!/^[a-z]{2}$/.test(normalized)) {
    transcriptionError(
      "configuration_invalid",
      "The transcription language must be a lowercase ISO-639-1 code.",
    );
  }
  return {
    language: normalized,
    providerLanguage: normalized,
  };
}

export function parseOpenAiTranscriptionArguments(
  argv: readonly string[],
): OpenAiTranscriptionCliConfiguration {
  const { preflight, values } = singleValueArguments(argv);
  const apiKeyFile = resolve(
    values.get("--api-key-file") ?? DEFAULT_OPENAI_API_KEY_FILE,
  );
  if (preflight) {
    if (
      values.has("--input") ||
      values.has("--output-vtt") ||
      values.has("--language")
    ) {
      transcriptionError(
        "configuration_invalid",
        "Preflight does not accept media job paths or a language.",
      );
    }
    return {
      mode: "preflight",
      apiKeyFile,
    };
  }

  const inputPath = values.get("--input");
  const outputVttPath = values.get("--output-vtt");
  const configuredLanguage = language(values.get("--language"));
  if (!inputPath || !outputVttPath) {
    transcriptionError(
      "configuration_invalid",
      "Transcription requires an input and WebVTT output path.",
    );
  }
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputVttPath);
  if (resolvedInput === resolvedOutput || !resolvedOutput.endsWith(".vtt")) {
    transcriptionError(
      "configuration_invalid",
      "The transcription input and WebVTT output paths are invalid.",
    );
  }
  return {
    mode: "transcribe",
    apiKeyFile,
    inputPath: resolvedInput,
    outputVttPath: resolvedOutput,
    ...configuredLanguage,
  };
}

export async function readOpenAiApiKeyFile(path: string) {
  let handle;
  try {
    const noFollow =
      "O_NOFOLLOW" in constants ? (constants.O_NOFOLLOW as number) : 0;
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NONBLOCK | noFollow,
    );
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size < 8 ||
      metadata.size > 1_024 ||
      (process.platform !== "win32" &&
        ((metadata.mode & 0o222) !== 0 || (metadata.mode & 0o077) !== 0))
    ) {
      transcriptionError(
        "secret_file_invalid",
        "The transcription credential file is not a private read-only file.",
      );
    }
    const bytes = await handle.readFile();
    const apiKey = bytes.toString("utf8").trim();
    bytes.fill(0);
    if (
      apiKey.length < 8 ||
      apiKey.length > 512 ||
      /[^\x21-\x7e]/.test(apiKey)
    ) {
      transcriptionError(
        "secret_file_invalid",
        "The transcription credential file has invalid bounded content.",
      );
    }
    return apiKey;
  } catch (error) {
    if (error instanceof OpenAiTranscriptionError) throw error;
    transcriptionError(
      "secret_file_invalid",
      "The transcription credential file could not be read safely.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function safeFfmpegEnvironment() {
  return {
    ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
    ...(process.platform === "win32" && process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
    NODE_ENV: process.env.NODE_ENV ?? "production",
    LANG: "C",
    LC_ALL: "C",
  };
}

async function runFfmpeg(argumentsList: readonly string[], cwd?: string) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "ffmpeg", // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      [...argumentsList],
      {
        cwd,
        // The outer media runner owns the process group. Keeping FFmpeg in it
        // ensures an outer abort or timeout terminates the whole command tree.
        detached: false,
        env: safeFfmpegEnvironment(),
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    let settled = false;
    const finish = (error?: OpenAiTranscriptionError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise();
    };
    const terminate = () => {
      const pid = child.pid;
      if (pid) {
        try {
          process.kill(pid, "SIGKILL");
          return;
        } catch {
          // The process can already be gone; use the child handle below.
        }
      }
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      terminate();
      finish(
        new OpenAiTranscriptionError(
          "audio_conversion_failed",
          "The bounded audio conversion timed out.",
        ),
      );
    }, FFMPEG_TIMEOUT_MS);
    child.once("error", () => {
      finish(
        new OpenAiTranscriptionError(
          "audio_conversion_failed",
          "The audio conversion process could not be started.",
        ),
      );
    });
    child.once("close", (code) => {
      finish(
        code === 0
          ? undefined
          : new OpenAiTranscriptionError(
              "audio_conversion_failed",
              "The audio conversion process failed.",
            ),
      );
    });
  });
}

type FfmpegSegment = Readonly<{
  fileName: string;
  startSeconds: number;
  endSeconds: number;
}>;

export function parseFfmpegSegmentCsv(value: string): readonly FfmpegSegment[] {
  if (!value || value.length > 64 * 1_024 || /[\u0000\r]/.test(value)) {
    transcriptionError(
      "audio_conversion_failed",
      "The audio conversion segment manifest is invalid.",
    );
  }
  const lines = value.split("\n").filter(Boolean);
  if (!lines.length || lines.length > MAX_AUDIO_CHUNKS) {
    transcriptionError(
      "audio_duration_exceeded",
      "The audio duration or chunk count exceeds the supported bound.",
    );
  }
  const result: FfmpegSegment[] = [];
  let previousEnd = 0;
  for (const [index, line] of lines.entries()) {
    const match = line.match(
      /^(?:"(chunk-\d{4}\.mp3)"|(chunk-\d{4}\.mp3)),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/,
    );
    if (!match) {
      transcriptionError(
        "audio_conversion_failed",
        "The audio conversion segment manifest is invalid.",
      );
    }
    const fileName = match[1] ?? match[2] ?? "";
    const expectedFileName = `chunk-${String(index).padStart(4, "0")}.mp3`;
    const startSeconds = Number(match[3]);
    const endSeconds = Number(match[4]);
    if (
      fileName !== expectedFileName ||
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      endSeconds <= startSeconds ||
      endSeconds - startSeconds > AUDIO_CHUNK_SECONDS + 2 ||
      Math.abs(startSeconds - previousEnd) > 2 ||
      endSeconds > FFMPEG_LIMIT_SECONDS + 0.1
    ) {
      transcriptionError(
        "audio_conversion_failed",
        "The audio conversion segment manifest is inconsistent.",
      );
    }
    result.push({ fileName, startSeconds, endSeconds });
    previousEnd = endSeconds;
  }
  if ((result.at(-1)?.endSeconds ?? 0) > MAX_AUDIO_SECONDS + 0.1) {
    transcriptionError(
      "audio_duration_exceeded",
      "The audio duration exceeds the supported bound.",
    );
  }
  return result;
}

async function validateAudioInput(inputPath: string) {
  try {
    const metadata = await lstat(inputPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
      transcriptionError(
        "audio_input_invalid",
        "The transcription input is not a non-empty regular file.",
      );
    }
  } catch (error) {
    if (error instanceof OpenAiTranscriptionError) throw error;
    transcriptionError(
      "audio_input_invalid",
      "The transcription input could not be opened safely.",
    );
  }
}

export async function createCompressedAudioChunks(
  inputPath: string,
  workspace: string,
): Promise<readonly AudioChunk[]> {
  await validateAudioInput(inputPath);
  await runFfmpeg(
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputPath,
      "-t",
      String(FFMPEG_LIMIT_SECONDS),
      "-map",
      "0:a:0",
      "-vn",
      "-sn",
      "-dn",
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      "asetpts=N/SR/TB",
      "-c:a",
      "libmp3lame",
      "-b:a",
      AUDIO_BITRATE,
      "-reservoir",
      "0",
      "-threads",
      "1",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      "-f",
      "segment",
      "-segment_time",
      String(AUDIO_CHUNK_SECONDS),
      "-segment_format",
      "mp3",
      "-segment_format_options",
      "write_xing=0",
      "-reset_timestamps",
      "1",
      "-segment_list",
      "chunks.csv",
      "-segment_list_type",
      "csv",
      "chunk-%04d.mp3",
    ],
    workspace,
  );
  let segments: readonly FfmpegSegment[];
  try {
    segments = parseFfmpegSegmentCsv(
      await readFile(join(workspace, "chunks.csv"), "utf8"),
    );
  } catch (error) {
    if (error instanceof OpenAiTranscriptionError) throw error;
    transcriptionError(
      "audio_conversion_failed",
      "The audio conversion segment manifest could not be read.",
    );
  }
  const chunks: AudioChunk[] = [];
  for (const segment of segments) {
    const chunkPath = join(workspace, segment.fileName);
    const metadata = await stat(chunkPath).catch(() => undefined);
    if (
      !metadata?.isFile() ||
      metadata.size < 1 ||
      metadata.size >= MAX_UPLOAD_BYTES
    ) {
      transcriptionError(
        "audio_conversion_failed",
        "A compressed audio chunk is missing or exceeds the upload bound.",
      );
    }
    chunks.push({
      path: chunkPath,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    });
  }
  return chunks;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedSegmentText(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > MAX_PROVIDER_SEGMENT_TEXT_LENGTH
  ) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned invalid segment text.",
    );
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length > MAX_PROVIDER_SEGMENT_TEXT_LENGTH) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned oversized segment text.",
    );
  }
  return normalized;
}

function splitCueText(value: string) {
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > TARGET_WEBVTT_CUE_TEXT_LENGTH) {
    let breakAt = remaining.lastIndexOf(" ", TARGET_WEBVTT_CUE_TEXT_LENGTH + 1);
    if (breakAt < TARGET_WEBVTT_CUE_TEXT_LENGTH / 2) {
      breakAt = TARGET_WEBVTT_CUE_TEXT_LENGTH;
      if (
        /[\uD800-\uDBFF]/.test(remaining[breakAt - 1] ?? "") &&
        /[\uDC00-\uDFFF]/.test(remaining[breakAt] ?? "")
      ) {
        breakAt -= 1;
      }
    }
    const part = remaining.slice(0, breakAt).trim();
    if (!part || part.length > MAX_SEGMENT_TEXT_LENGTH) {
      transcriptionError(
        "provider_response_invalid",
        "The transcription provider returned unsplittable segment text.",
      );
    }
    parts.push(part);
    remaining = remaining.slice(breakAt).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitTimedSegment(
  text: string,
  startSeconds: number,
  endSeconds: number,
) {
  const cueTexts = splitCueText(text);
  if (cueTexts.length <= 1) {
    return cueTexts.map((cueText) => ({
      startSeconds,
      endSeconds,
      text: cueText,
    }));
  }

  const startMilliseconds = Math.round(startSeconds * 1_000);
  const endMilliseconds = Math.round(endSeconds * 1_000);
  if (endMilliseconds - startMilliseconds < cueTexts.length) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned oversized text for its timestamp span.",
    );
  }
  const totalWeight = cueTexts.reduce(
    (sum, cueText) => sum + cueText.length,
    0,
  );
  let completedWeight = 0;
  let cueStartMilliseconds = startMilliseconds;
  return cueTexts.map((cueText, index) => {
    completedWeight += cueText.length;
    const remainingCues = cueTexts.length - index - 1;
    const proportionalEnd = Math.round(
      startMilliseconds +
        ((endMilliseconds - startMilliseconds) * completedWeight) / totalWeight,
    );
    const cueEndMilliseconds =
      remainingCues === 0
        ? endMilliseconds
        : Math.min(
            Math.max(proportionalEnd, cueStartMilliseconds + 1),
            endMilliseconds - remainingCues,
          );
    const result = {
      startSeconds: cueStartMilliseconds / 1_000,
      endSeconds: cueEndMilliseconds / 1_000,
      text: cueText,
    };
    cueStartMilliseconds = cueEndMilliseconds;
    return result;
  });
}

function normalizedTranscriptText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizedDiarizedAggregateText(
  value: string,
  speakerLabels: ReadonlySet<string>,
) {
  const withoutSpeakerLabels = value
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      const separator = trimmed.indexOf(":");
      if (separator <= 0) return line;
      const label = trimmed
        .slice(0, separator)
        .trim()
        .toLocaleLowerCase("en-US");
      return speakerLabels.has(label) ? trimmed.slice(separator + 1) : line;
    })
    .join(" ");
  return normalizedTranscriptText(withoutSpeakerLabels);
}

export function validateDiarizedTranscriptionResponse(
  value: unknown,
  expectedDurationSeconds: number,
): ProviderTranscript {
  if (
    !isRecord(value) ||
    value.task !== "transcribe" ||
    typeof value.text !== "string" ||
    value.text.length > MAX_TRANSCRIPT_TEXT_LENGTH ||
    /[\u0000\u000b\u000c\u007f]/.test(value.text) ||
    typeof value.duration !== "number" ||
    !Number.isFinite(value.duration) ||
    value.duration <= 0 ||
    Math.abs(value.duration - expectedDurationSeconds) > 5 ||
    !Array.isArray(value.segments) ||
    value.segments.length > MAX_TRANSCRIPT_SEGMENTS
  ) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned an invalid response schema.",
    );
  }
  const segments: Array<{
    startSeconds: number;
    endSeconds: number;
    text: string;
  }> = [];
  const providerSegmentTexts: string[] = [];
  const providerSpeakerLabels = new Set<string>();
  let previousStart = 0;
  const segmentIds = new Set<string>();
  for (const candidate of value.segments) {
    if (!isRecord(candidate)) {
      transcriptionError(
        "provider_response_invalid",
        "The transcription provider returned an invalid segment.",
      );
    }
    const startSeconds = candidate.start;
    const endSeconds = candidate.end;
    const id = candidate.id;
    const speaker = candidate.speaker;
    if (
      candidate.type !== "transcript.text.segment" ||
      typeof id !== "string" ||
      !/^[A-Za-z0-9._:-]{1,128}$/.test(id) ||
      segmentIds.has(id) ||
      typeof speaker !== "string" ||
      speaker.trim().length < 1 ||
      speaker.length > 64 ||
      /[\u0000-\u001f\u007f]/.test(speaker) ||
      typeof startSeconds !== "number" ||
      typeof endSeconds !== "number" ||
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      startSeconds < 0 ||
      startSeconds + 0.05 < previousStart ||
      endSeconds <= startSeconds ||
      endSeconds > value.duration
    ) {
      transcriptionError(
        "provider_response_invalid",
        "The transcription provider returned invalid segment timestamps.",
      );
    }
    segmentIds.add(id);
    providerSpeakerLabels.add(
      speaker.normalize("NFKC").trim().toLocaleLowerCase("en-US"),
    );
    const text = boundedSegmentText(candidate.text);
    if (text) {
      providerSegmentTexts.push(text);
      const cueSegments = splitTimedSegment(text, startSeconds, endSeconds);
      if (segments.length + cueSegments.length > MAX_TRANSCRIPT_SEGMENTS) {
        transcriptionError(
          "provider_response_invalid",
          "The transcription provider returned too many bounded cues.",
        );
      }
      segments.push(...cueSegments);
    }
    previousStart = startSeconds;
  }
  const normalizedProviderText = normalizedTranscriptText(value.text);
  const normalizedSegmentText = normalizedTranscriptText(
    providerSegmentTexts.join(" "),
  );
  const normalizedUnlabeledProviderText = normalizedDiarizedAggregateText(
    value.text,
    providerSpeakerLabels,
  );
  if (
    normalizedProviderText !== normalizedSegmentText &&
    normalizedUnlabeledProviderText !== normalizedSegmentText
  ) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned incomplete timed segments.",
    );
  }
  return { durationSeconds: value.duration, segments };
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, {
    highWaterMark: 64 * 1_024,
  })) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function retryAfterMilliseconds(header: string | null, now = Date.now()) {
  if (!header) return 0;
  const trimmed = header.trim();
  let milliseconds: number;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    milliseconds = Math.ceil(Number(trimmed) * 1_000);
  } else {
    const date = Date.parse(trimmed);
    milliseconds = Number.isFinite(date) ? Math.max(0, date - now) : 0;
  }
  if (!Number.isFinite(milliseconds)) return 0;
  return Math.min(Math.max(0, milliseconds), MAX_RETRY_DELAY_MS);
}

function retryableProviderStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function discardResponse(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function boundedJsonResponse(response: Response) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    await discardResponse(response);
    transcriptionError(
      "provider_response_oversize",
      "The transcription provider response exceeds the bounded size.",
    );
  }
  if (!response.body) {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned an empty response.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        transcriptionError(
          "provider_response_oversize",
          "The transcription provider response exceeds the bounded size.",
        );
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total,
  );
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
  } catch {
    transcriptionError(
      "provider_response_invalid",
      "The transcription provider returned invalid JSON.",
    );
  }
}

function providerStatusError(status: number) {
  if (status === 401 || status === 403) {
    return new OpenAiTranscriptionError(
      "provider_authentication_failed",
      "The transcription provider rejected its dedicated credential.",
    );
  }
  if (status === 429) {
    return new OpenAiTranscriptionError(
      "provider_rate_limited",
      "The transcription provider remained rate limited.",
    );
  }
  if (status === 408 || status >= 500) {
    return new OpenAiTranscriptionError(
      "provider_unavailable",
      "The transcription provider is temporarily unavailable.",
    );
  }
  if (status >= 300 && status < 400) {
    return new OpenAiTranscriptionError(
      "provider_redirect_rejected",
      "The transcription provider attempted a redirect.",
    );
  }
  return new OpenAiTranscriptionError(
    "provider_request_rejected",
    "The transcription provider rejected the bounded request.",
  );
}

export function openAiTranscriptionRequestDigest(
  input: Readonly<{
    contentSha256: string;
    language: string;
  }>,
) {
  if (
    !/^[0-9a-f]{64}$/.test(input.contentSha256) ||
    !/^[a-z]{2}$/.test(input.language)
  ) {
    transcriptionError(
      "configuration_invalid",
      "The transcription request digest input is invalid.",
    );
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        contract: OPENAI_TRANSCRIPTION_REQUEST_CONTRACT,
        endpoint: OPENAI_TRANSCRIPTIONS_URL,
        model: OPENAI_TRANSCRIPTION_MODEL,
        responseFormat: OPENAI_TRANSCRIPTION_RESPONSE_FORMAT,
        chunkingStrategy: OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY,
        language: input.language,
        contentSha256: input.contentSha256,
      }),
    )
    .digest("hex");
}

export async function requestOpenAiTranscription(
  input: Readonly<{
    apiKey: string;
    audioPath: string;
    expectedDurationSeconds: number;
    language: string;
    fetchImplementation?: FetchImplementation;
    sleep?: SleepImplementation;
    requestTimeoutMs?: number;
  }>,
): Promise<ProviderTranscript> {
  if (
    input.apiKey.length < 8 ||
    input.apiKey.length > 512 ||
    /[^\x21-\x7e]/.test(input.apiKey) ||
    !/^[a-z]{2}$/.test(input.language) ||
    !Number.isFinite(input.expectedDurationSeconds) ||
    input.expectedDurationSeconds <= 0 ||
    input.expectedDurationSeconds > AUDIO_CHUNK_SECONDS + 2
  ) {
    transcriptionError(
      "configuration_invalid",
      "The bounded transcription provider request is invalid.",
    );
  }
  const timeoutOverride = input.requestTimeoutMs;
  if (
    timeoutOverride !== undefined &&
    (!Number.isFinite(timeoutOverride) || timeoutOverride < 1)
  ) {
    transcriptionError(
      "configuration_invalid",
      "The transcription provider timeout is invalid.",
    );
  }
  let audioMetadata: Awaited<ReturnType<typeof lstat>>;
  try {
    audioMetadata = await lstat(input.audioPath);
  } catch {
    transcriptionError(
      "audio_input_invalid",
      "The compressed transcription audio could not be opened safely.",
    );
  }
  if (
    !audioMetadata.isFile() ||
    audioMetadata.isSymbolicLink() ||
    audioMetadata.size < 1 ||
    audioMetadata.size >= MAX_UPLOAD_BYTES
  ) {
    transcriptionError(
      "audio_input_invalid",
      "The compressed transcription audio is not a bounded regular file.",
    );
  }
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const sleep =
    input.sleep ??
    ((milliseconds) =>
      new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, milliseconds),
      ));
  const contentDigest = await sha256File(input.audioPath);
  const idempotencyDigest = openAiTranscriptionRequestDigest({
    contentSha256: contentDigest,
    language: input.language,
  });
  const requestTimeoutMs = Math.min(
    Math.max(Math.trunc(timeoutOverride ?? PROVIDER_REQUEST_TIMEOUT_MS), 1),
    PROVIDER_REQUEST_TIMEOUT_MS,
  );

  for (let attempt = 0; attempt < PROVIDER_ATTEMPTS; attempt += 1) {
    const form = new FormData();
    form.set("model", OPENAI_TRANSCRIPTION_MODEL);
    form.set("response_format", OPENAI_TRANSCRIPTION_RESPONSE_FORMAT);
    form.set("chunking_strategy", OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY);
    form.set("language", input.language);
    form.set(
      "file",
      await openAsBlob(input.audioPath, { type: "audio/mpeg" }),
      basename(input.audioPath),
    );
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), requestTimeoutMs);
    let retryDelay: number | undefined;
    try {
      const response = await fetchImplementation(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          "Idempotency-Key": `q-academy-stt-${idempotencyDigest}`,
        },
        body: form,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.redirected) {
        await discardResponse(response);
        throw new OpenAiTranscriptionError(
          "provider_redirect_rejected",
          "The transcription provider attempted a redirect.",
        );
      }
      if (response.status >= 300 && response.status < 400) {
        await discardResponse(response);
        throw providerStatusError(response.status);
      }
      if (!response.ok) {
        const retry = retryableProviderStatus(response.status);
        const waitMilliseconds = retryAfterMilliseconds(
          response.headers.get("retry-after"),
        );
        const status = response.status;
        await discardResponse(response);
        if (retry && attempt + 1 < PROVIDER_ATTEMPTS) {
          retryDelay = waitMilliseconds || Math.min(500 * 2 ** attempt, 2_000);
        } else {
          throw providerStatusError(status);
        }
      } else {
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
          await discardResponse(response);
          transcriptionError(
            "provider_response_invalid",
            "The transcription provider returned an unexpected content type.",
          );
        }
        return validateDiarizedTranscriptionResponse(
          await boundedJsonResponse(response),
          input.expectedDurationSeconds,
        );
      }
    } catch (error) {
      if (error instanceof OpenAiTranscriptionError) throw error;
      if (attempt + 1 < PROVIDER_ATTEMPTS) {
        retryDelay = Math.min(500 * 2 ** attempt, 2_000);
      } else {
        transcriptionError(
          "provider_unavailable",
          "The transcription provider request failed without a response.",
        );
      }
    } finally {
      clearTimeout(requestTimer);
    }
    if (retryDelay !== undefined) {
      await sleep(retryDelay);
      continue;
    }
    transcriptionError(
      "provider_unavailable",
      "The transcription provider request failed without a response.",
    );
  }
  transcriptionError(
    "provider_unavailable",
    "The transcription provider is temporarily unavailable.",
  );
}

export function mergeTranscriptChunks(
  chunks: readonly Readonly<{
    chunk: AudioChunk;
    transcript: ProviderTranscript;
  }>[],
): readonly TranscriptSegment[] {
  if (!chunks.length || chunks.length > MAX_AUDIO_CHUNKS) {
    transcriptionError(
      "transcript_output_invalid",
      "The transcript does not contain a bounded audio chunk set.",
    );
  }
  const result: TranscriptSegment[] = [];
  let totalTextLength = 0;
  let previousChunkEnd = 0;
  for (const [index, item] of chunks.entries()) {
    const duration = item.chunk.endSeconds - item.chunk.startSeconds;
    if (index > 0 && Math.abs(item.chunk.startSeconds - previousChunkEnd) > 2) {
      transcriptionError(
        "transcript_output_invalid",
        "The transcript audio chunks are not contiguous.",
      );
    }
    for (const segment of item.transcript.segments) {
      const localEnd = Math.min(segment.endSeconds, duration);
      const startMilliseconds = Math.round(
        (item.chunk.startSeconds + segment.startSeconds) * 1_000,
      );
      const endMilliseconds = Math.round(
        (item.chunk.startSeconds + localEnd) * 1_000,
      );
      if (
        startMilliseconds < 0 ||
        endMilliseconds <= startMilliseconds ||
        endMilliseconds > MAX_AUDIO_SECONDS * 1_000
      ) {
        transcriptionError(
          "transcript_output_invalid",
          "The merged transcript contains invalid timestamps.",
        );
      }
      totalTextLength += segment.text.length;
      if (
        result.length >= MAX_TRANSCRIPT_SEGMENTS ||
        totalTextLength > MAX_TRANSCRIPT_TEXT_LENGTH
      ) {
        transcriptionError(
          "transcript_output_invalid",
          "The merged transcript exceeds its segment or text bound.",
        );
      }
      result.push({ startMilliseconds, endMilliseconds, text: segment.text });
    }
    previousChunkEnd = item.chunk.endSeconds;
  }
  if (!result.length) {
    transcriptionError(
      "transcript_output_invalid",
      "The transcription provider returned no usable speech segments.",
    );
  }
  result.sort(
    (left, right) =>
      left.startMilliseconds - right.startMilliseconds ||
      left.endMilliseconds - right.endMilliseconds,
  );
  return result;
}

function webVttTimestamp(milliseconds: number) {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(3, "0")}`;
}

export function serializeTranscriptWebVtt(
  segments: readonly TranscriptSegment[],
) {
  if (!segments.length || segments.length > MAX_TRANSCRIPT_SEGMENTS) {
    transcriptionError(
      "transcript_output_invalid",
      "The WebVTT transcript has an invalid segment count.",
    );
  }
  let previousStart = -1;
  let totalTextLength = 0;
  for (const segment of segments) {
    totalTextLength += segment.text.length;
    if (
      !Number.isInteger(segment.startMilliseconds) ||
      !Number.isInteger(segment.endMilliseconds) ||
      segment.startMilliseconds < 0 ||
      segment.startMilliseconds < previousStart ||
      segment.endMilliseconds <= segment.startMilliseconds ||
      segment.endMilliseconds > MAX_AUDIO_SECONDS * 1_000 ||
      !segment.text ||
      segment.text.length > MAX_SEGMENT_TEXT_LENGTH ||
      totalTextLength > MAX_TRANSCRIPT_TEXT_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(segment.text)
    ) {
      transcriptionError(
        "transcript_output_invalid",
        "The WebVTT transcript contains an invalid bounded cue.",
      );
    }
    previousStart = segment.startMilliseconds;
  }
  const value = [
    "WEBVTT",
    "",
    ...segments.flatMap((segment, index) => [
      String(index + 1),
      `${webVttTimestamp(segment.startMilliseconds)} --> ${webVttTimestamp(segment.endMilliseconds)}`,
      segment.text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;"),
      "",
    ]),
  ].join("\n");
  if (Buffer.byteLength(value, "utf8") > MAX_WEBVTT_BYTES) {
    transcriptionError(
      "transcript_output_invalid",
      "The WebVTT transcript exceeds its bounded output size.",
    );
  }
  return value;
}

export async function writeWebVttAtomically(path: string, value: string) {
  const outputPath = resolve(path);
  const outputDirectory = dirname(outputPath);
  const temporaryPath = join(
    outputDirectory,
    `.${basename(outputPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    const directoryMetadata = await lstat(outputDirectory);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink()
    ) {
      transcriptionError(
        "transcript_write_failed",
        "The WebVTT output directory is invalid.",
      );
    }
    handle = await open(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, outputPath);
  } catch (error) {
    if (error instanceof OpenAiTranscriptionError) throw error;
    transcriptionError(
      "transcript_write_failed",
      "The WebVTT transcript could not be written atomically.",
    );
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function transcribeMediaToWebVtt(
  input: Readonly<{
    apiKey: string;
    inputPath: string;
    outputVttPath: string;
    providerLanguage: string;
    fetchImplementation?: FetchImplementation;
    sleep?: SleepImplementation;
  }>,
) {
  const outputDirectory = dirname(resolve(input.outputVttPath));
  let workspace: string;
  try {
    const directoryMetadata = await lstat(outputDirectory);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink()
    ) {
      transcriptionError(
        "transcript_write_failed",
        "The WebVTT output directory is invalid.",
      );
    }
    workspace = await mkdtemp(join(outputDirectory, ".q-academy-stt-"));
  } catch (error) {
    if (error instanceof OpenAiTranscriptionError) throw error;
    transcriptionError(
      "transcript_write_failed",
      "The bounded transcription workspace could not be created.",
    );
  }
  try {
    const chunks = await createCompressedAudioChunks(
      input.inputPath,
      workspace,
    );
    const transcribed: Array<{
      chunk: AudioChunk;
      transcript: ProviderTranscript;
    }> = [];
    for (const chunk of chunks) {
      transcribed.push({
        chunk,
        transcript: await requestOpenAiTranscription({
          apiKey: input.apiKey,
          audioPath: chunk.path,
          expectedDurationSeconds: chunk.endSeconds - chunk.startSeconds,
          language: input.providerLanguage,
          fetchImplementation: input.fetchImplementation,
          sleep: input.sleep,
        }),
      });
    }
    const segments = mergeTranscriptChunks(transcribed);
    await writeWebVttAtomically(
      input.outputVttPath,
      serializeTranscriptWebVtt(segments),
    );
    return { chunks: chunks.length, segments: segments.length };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function createPreflightCanary(workspace: string) {
  const canaryPath = join(workspace, "provider-canary.mp3");
  await runFfmpeg(
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "flite=text='Q Academy transcription canary':voice=slt",
      "-t",
      "3",
      "-map_metadata",
      "-1",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "libmp3lame",
      "-b:a",
      AUDIO_BITRATE,
      "-reservoir",
      "0",
      "-threads",
      "1",
      "-write_xing",
      "0",
      "-fflags",
      "+bitexact",
      "-flags:a",
      "+bitexact",
      canaryPath,
    ],
    workspace,
  );
  const metadata = await stat(canaryPath).catch(() => undefined);
  if (
    !metadata?.isFile() ||
    metadata.size < 1 ||
    metadata.size >= MAX_UPLOAD_BYTES
  ) {
    transcriptionError(
      "audio_conversion_failed",
      "The deterministic provider canary could not be generated.",
    );
  }
  return canaryPath;
}

export async function runOpenAiTranscriptionPreflight(
  input: Readonly<{
    apiKey: string;
    fetchImplementation?: FetchImplementation;
    sleep?: SleepImplementation;
  }>,
) {
  const workspace = await mkdtemp(join(tmpdir(), "q-academy-stt-preflight-"));
  try {
    const canaryPath = await createPreflightCanary(workspace);
    const result = await requestOpenAiTranscription({
      apiKey: input.apiKey,
      audioPath: canaryPath,
      expectedDurationSeconds: 3,
      language: "en",
      fetchImplementation: input.fetchImplementation,
      sleep: input.sleep,
    });
    const canaryText = result.segments.map((segment) => segment.text).join(" ");
    if (!/academy/i.test(canaryText) || !/canary/i.test(canaryText)) {
      transcriptionError(
        "provider_response_invalid",
        "The transcription provider did not verify the spoken canary.",
      );
    }
    return {
      durationSeconds: result.durationSeconds,
      segments: result.segments.length,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function redactedTranscriptionFailure(error: unknown) {
  return {
    ok: false as const,
    code:
      error instanceof OpenAiTranscriptionError
        ? error.code
        : ("provider_unavailable" as const),
  };
}
