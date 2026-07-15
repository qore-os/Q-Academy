import "server-only";

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseWebVttTranscript,
  type VideoTranscriptDocument,
} from "@/lib/content-blocks/video-transcript";

const COMMAND_TIMEOUT_MS = 10 * 60_000;
const MAX_COMMAND_ERROR_BYTES = 16 * 1_024;
const MAX_TRANSCRIPT_FILE_BYTES = 600_000;
const EXECUTABLE_PATTERN = /^[^\u0000-\u001f\u007f]{1,1024}$/;

export class MediaProcessingProviderError extends Error {
  constructor(
    readonly code:
      | "provider_unavailable"
      | "provider_timeout"
      | "provider_failed"
      | "invalid_output",
    message: string,
  ) {
    super(message);
    this.name = "MediaProcessingProviderError";
  }
}

export type TranscriptProviderInput = Readonly<{
  inputPath: string;
  outputPath: string;
  language: string;
  sourceSha256: string;
  signal?: AbortSignal;
}>;

export interface TranscriptProvider {
  readonly id: string;
  transcribe(input: TranscriptProviderInput): Promise<VideoTranscriptDocument>;
}

function boundedCommandArguments() {
  const raw = process.env.MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON?.trim();
  if (!raw) {
    return [
      "--input",
      "{input}",
      "--output-vtt",
      "{output}",
      "--language",
      "{language}",
      "--temperature",
      "0",
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MediaProcessingProviderError(
      "provider_unavailable",
      "MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON is not valid JSON.",
    );
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length > 64 ||
    parsed.some(
      (value) =>
        typeof value !== "string" ||
        value.length > 2_048 ||
        /[\u0000-\u001f\u007f]/.test(value),
    )
  ) {
    throw new MediaProcessingProviderError(
      "provider_unavailable",
      "MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON contains unsafe arguments.",
    );
  }
  return parsed as string[];
}

export async function runBoundedMediaCommand(input: {
  executable: string;
  arguments: readonly string[];
  signal?: AbortSignal;
  timeoutMs?: number;
  captureStdoutBytes?: number;
}) {
  if (!EXECUTABLE_PATTERN.test(input.executable)) {
    throw new MediaProcessingProviderError(
      "provider_unavailable",
      "The media processing executable is not configured safely.",
    );
  }
  const timeoutMs = Math.min(
    Math.max(input.timeoutMs ?? COMMAND_TIMEOUT_MS, 1_000),
    COMMAND_TIMEOUT_MS,
  );
  return new Promise<string>((resolvePromise, reject) => {
    const stdoutLimit = Math.min(
      Math.max(input.captureStdoutBytes ?? 0, 0),
      64 * 1_024,
    );
    const child = spawn(input.executable, [...input.arguments], {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", stdoutLimit ? "pipe" : "ignore", "pipe"],
    });
    let errorOutput = Buffer.alloc(0);
    let stdout = Buffer.alloc(0);
    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdout.byteLength >= stdoutLimit) return;
      stdout = Buffer.concat([
        stdout,
        chunk.subarray(0, stdoutLimit - stdout.byteLength),
      ]);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (errorOutput.byteLength >= MAX_COMMAND_ERROR_BYTES) return;
      errorOutput = Buffer.concat([
        errorOutput,
        chunk.subarray(0, MAX_COMMAND_ERROR_BYTES - errorOutput.byteLength),
      ]);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const abort = () => child.kill("SIGKILL");
    input.signal?.addEventListener("abort", abort, { once: true });
    child.once("error", (error) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      reject(
        new MediaProcessingProviderError(
          "provider_unavailable",
          `Media processor could not be started: ${error.message}`,
        ),
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      if (input.signal?.aborted) {
        reject(input.signal.reason ?? new Error("Media processing aborted."));
      } else if (timedOut) {
        reject(
          new MediaProcessingProviderError(
            "provider_timeout",
            "Media processing exceeded its bounded execution time.",
          ),
        );
      } else if (code !== 0) {
        reject(
          new MediaProcessingProviderError(
            "provider_failed",
            `Media processor exited with code ${code ?? "unknown"}: ${errorOutput.toString("utf8").trim()}`.slice(
              0,
              2_000,
            ),
          ),
        );
      } else {
        resolvePromise(stdout.toString("utf8"));
      }
    });
  });
}

async function readTranscript(path: string, language: string) {
  const bytes = await readFile(/* turbopackIgnore: true */ path);
  if (!bytes.byteLength || bytes.byteLength > MAX_TRANSCRIPT_FILE_BYTES) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "Transcript output is empty or exceeds the bounded size.",
    );
  }
  const transcript = parseWebVttTranscript(bytes.toString("utf8"), language);
  if (!transcript) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "Transcript provider did not produce valid bounded WebVTT.",
    );
  }
  return transcript;
}

export class LocalCommandTranscriptProvider implements TranscriptProvider {
  readonly id = "local-command-v1";

  async transcribe(input: TranscriptProviderInput) {
    const executable = process.env.MEDIA_TRANSCRIPT_COMMAND?.trim();
    if (!executable) {
      throw new MediaProcessingProviderError(
        "provider_unavailable",
        "MEDIA_TRANSCRIPT_COMMAND is not configured.",
      );
    }
    const replacements: Record<string, string> = {
      "{input}": input.inputPath,
      "{output}": input.outputPath,
      "{language}": input.language,
    };
    const args = boundedCommandArguments().map(
      (value) => replacements[value] ?? value,
    );
    await runBoundedMediaCommand({
      executable,
      arguments: args,
      signal: input.signal,
    });
    return readTranscript(input.outputPath, input.language);
  }
}

export class DeterministicSidecarTranscriptProvider
  implements TranscriptProvider
{
  readonly id = "deterministic-sidecar-v1";

  async transcribe(input: TranscriptProviderInput) {
    const directory = process.env.MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY?.trim();
    if (!directory) {
      throw new MediaProcessingProviderError(
        "provider_unavailable",
        "MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY is not configured.",
      );
    }
    const root = resolve(directory);
    const sidecar = resolve(root, `${input.sourceSha256}.${input.language}.vtt`);
    if (!sidecar.startsWith(`${root}\\`) && !sidecar.startsWith(`${root}/`)) {
      throw new MediaProcessingProviderError(
        "provider_unavailable",
        "The transcript sidecar path is invalid.",
      );
    }
    await access(sidecar, constants.R_OK).catch(() => {
      throw new MediaProcessingProviderError(
        "provider_unavailable",
        "No deterministic transcript sidecar exists for this media digest.",
      );
    });
    return readTranscript(sidecar, input.language);
  }
}

export function configuredTranscriptProvider(): TranscriptProvider {
  return process.env.MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY?.trim()
    ? new DeterministicSidecarTranscriptProvider()
    : new LocalCommandTranscriptProvider();
}
