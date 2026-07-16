import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { probeWebmDurationStream } from "../src/lib/media/webm-duration-probe";

export const WEBM_PREFLIGHT_FFMPEG = "/usr/bin/ffmpeg";
export const WEBM_PREFLIGHT_FFPROBE = "/usr/bin/ffprobe";
export const WEBM_PREFLIGHT_MAX_BYTES = 2 * 1_024 * 1_024;
export const WEBM_PREFLIGHT_PROCESS_TIMEOUT_MS = 15_000;
export const WEBM_PREFLIGHT_MIN_DURATION_MS = 900;
export const WEBM_PREFLIGHT_MAX_DURATION_MS = 2_000;

const MAX_STDERR_BYTES = 16 * 1_024;
const MAX_PROBE_OUTPUT_BYTES = 256 * 1_024;
const MAX_PROBE_PACKET_RECORDS = 2_000;
const SAFE_EXECUTABLE = /^[^\u0000-\u001f\u007f]{1,1024}$/;

export const WEBM_PREFLIGHT_FFMPEG_ARGUMENTS = [
  "-nostdin",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=160x90:rate=10",
  "-f",
  "lavfi",
  "-i",
  "sine=frequency=997:sample_rate=48000",
  "-t",
  "1.25",
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-map_metadata",
  "-1",
  "-c:v",
  "libvpx",
  "-deadline",
  "realtime",
  "-cpu-used",
  "8",
  "-threads",
  "1",
  "-pix_fmt",
  "yuv420p",
  "-b:v",
  "128k",
  "-g",
  "10",
  "-c:a",
  "libopus",
  "-b:a",
  "32k",
  "-f",
  "webm",
  "-cluster_time_limit",
  "250",
  "-live",
  "1",
  "-flush_packets",
  "1",
  "-fs",
  String(WEBM_PREFLIGHT_MAX_BYTES),
  "pipe:1",
] as const;

const CONTAINER_DURATION_ARGUMENTS = [
  "-v",
  "error",
  "-max_alloc",
  "33554432",
  "-protocol_whitelist",
  "pipe",
  "-f",
  "matroska",
  "-i",
  "pipe:0",
  "-show_entries",
  "format=duration",
  "-of",
  "default=noprint_wrappers=1:nokey=1",
] as const;

export class WebmDurationPreflightError extends Error {
  constructor(
    readonly code:
      | "process_unavailable"
      | "process_timeout"
      | "process_failed"
      | "output_limit"
      | "invalid_canary"
      | "container_duration_present"
      | "duration_out_of_range",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WebmDurationPreflightError";
  }
}

type BoundedProcessInput = Readonly<{
  executable: string;
  arguments: readonly string[];
  stdin?: Uint8Array;
  timeoutMs: number;
  maxStdoutBytes: number;
}>;

function terminateProcess(child: ReturnType<typeof spawn>) {
  const pid = child.pid;
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // The process group can already be gone; fall back to the child handle.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The process can exit between the state check and termination.
  }
}

function boundedProcessEnvironment() {
  return {
    ...(process.platform === "win32" && process.env.SystemRoot
      ? { SystemRoot: process.env.SystemRoot }
      : {}),
    NODE_ENV: process.env.NODE_ENV ?? "production",
    LANG: "C",
    LC_ALL: "C",
  };
}

export function runBoundedBinaryProcess(input: BoundedProcessInput) {
  if (!SAFE_EXECUTABLE.test(input.executable)) {
    throw new WebmDurationPreflightError(
      "process_unavailable",
      "The media preflight executable is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > WEBM_PREFLIGHT_PROCESS_TIMEOUT_MS ||
    !Number.isSafeInteger(input.maxStdoutBytes) ||
    input.maxStdoutBytes < 1 ||
    input.maxStdoutBytes > WEBM_PREFLIGHT_MAX_BYTES
  ) {
    throw new WebmDurationPreflightError(
      "process_unavailable",
      "The media preflight process limits are invalid.",
    );
  }

  return new Promise<Buffer>((resolvePromise, reject) => {
    const child = spawn(
      input.executable, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
      [...input.arguments],
      {
        detached: process.platform !== "win32",
        env: boundedProcessEnvironment(),
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: WebmDurationPreflightError | null = null;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(Buffer.concat(stdoutChunks, stdoutBytes));
    };
    const fail = (error: WebmDurationPreflightError) => {
      terminalError ??= error;
      terminateProcess(child);
    };
    const timer = setTimeout(() => {
      fail(
        new WebmDurationPreflightError(
          "process_timeout",
          "The media preflight process exceeded its time limit.",
        ),
      );
    }, input.timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (value: Buffer | string) => {
      if (terminalError) return;
      const chunk = Buffer.from(value);
      if (stdoutBytes + chunk.byteLength > input.maxStdoutBytes) {
        fail(
          new WebmDurationPreflightError(
            "output_limit",
            "The media preflight process exceeded its output limit.",
          ),
        );
        return;
      }
      stdoutChunks.push(chunk);
      stdoutBytes += chunk.byteLength;
    });
    child.stdout.once("error", () => {
      fail(
        new WebmDurationPreflightError(
          "process_failed",
          "The media preflight output stream failed.",
        ),
      );
    });
    child.stderr.on("data", (value: Buffer | string) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return;
      const chunk = Buffer.from(value);
      const retained = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes);
      stderrChunks.push(retained);
      stderrBytes += retained.byteLength;
    });
    child.stderr.once("error", () => {
      fail(
        new WebmDurationPreflightError(
          "process_failed",
          "The media preflight error stream failed.",
        ),
      );
    });
    child.stdin?.on("error", () => {
      // Process close provides the stable terminal classification.
    });
    child.once("error", (error) => {
      finish(
        new WebmDurationPreflightError(
          "process_unavailable",
          "The media preflight process could not be started.",
          { cause: error },
        ),
      );
    });
    child.once("close", (code, signal) => {
      if (terminalError) {
        finish(terminalError);
        return;
      }
      if (signal !== null || code !== 0) {
        const stderr = Buffer.concat(stderrChunks, stderrBytes)
          .toString("utf8")
          .trim()
          .slice(0, 2_000);
        finish(
          new WebmDurationPreflightError(
            "process_failed",
            `The media preflight process failed${stderr ? `: ${stderr}` : "."}`,
          ),
        );
        return;
      }
      finish();
    });

    child.stdin.end(input.stdin ? Buffer.from(input.stdin) : undefined);
  });
}

export function containerDurationIsMissing(output: Uint8Array | string) {
  const normalized =
    typeof output === "string"
      ? output.trim()
      : Buffer.from(output).toString("utf8").trim();
  return normalized === "N/A";
}

export function assertPlausibleWebmDuration(durationMilliseconds: number) {
  if (
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds < WEBM_PREFLIGHT_MIN_DURATION_MS ||
    durationMilliseconds > WEBM_PREFLIGHT_MAX_DURATION_MS
  ) {
    throw new WebmDurationPreflightError(
      "duration_out_of_range",
      "The durationless WebM canary produced an implausible duration.",
    );
  }
}

async function* chunkedWebm(bytes: Uint8Array) {
  const chunkSize = 16 * 1_024;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
  }
}

export async function runWebmDurationPreflight() {
  const webm = await runBoundedBinaryProcess({
    executable: WEBM_PREFLIGHT_FFMPEG,
    arguments: WEBM_PREFLIGHT_FFMPEG_ARGUMENTS,
    timeoutMs: WEBM_PREFLIGHT_PROCESS_TIMEOUT_MS,
    maxStdoutBytes: WEBM_PREFLIGHT_MAX_BYTES,
  });
  if (
    webm.byteLength < 1_024 ||
    webm[0] !== 0x1a ||
    webm[1] !== 0x45 ||
    webm[2] !== 0xdf ||
    webm[3] !== 0xa3
  ) {
    throw new WebmDurationPreflightError(
      "invalid_canary",
      "FFmpeg did not produce a bounded WebM canary.",
    );
  }

  const containerDuration = await runBoundedBinaryProcess({
    executable: WEBM_PREFLIGHT_FFPROBE,
    arguments: CONTAINER_DURATION_ARGUMENTS,
    stdin: webm,
    timeoutMs: WEBM_PREFLIGHT_PROCESS_TIMEOUT_MS,
    maxStdoutBytes: 1_024,
  });
  if (!containerDurationIsMissing(containerDuration)) {
    throw new WebmDurationPreflightError(
      "container_duration_present",
      "The FFmpeg canary unexpectedly contains a container duration.",
    );
  }

  const result = await probeWebmDurationStream(
    {
      body: chunkedWebm(webm),
      expectedSizeBytes: webm.byteLength,
    },
    {
      executable: WEBM_PREFLIGHT_FFPROBE,
      timeoutMs: WEBM_PREFLIGHT_PROCESS_TIMEOUT_MS,
      maxOutputBytes: MAX_PROBE_OUTPUT_BYTES,
      maxPacketRecords: MAX_PROBE_PACKET_RECORDS,
    },
  );
  assertPlausibleWebmDuration(result.durationMilliseconds);
  return {
    bytes: webm.byteLength,
    durationMilliseconds: result.durationMilliseconds,
  };
}

const entrypoint = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (entrypoint === import.meta.url) {
  runWebmDurationPreflight()
    .then((result) => {
      process.stdout.write(
        `Durationless WebM preflight passed: ${result.durationMilliseconds} ms, ${result.bytes} bytes.\n`,
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Durationless WebM preflight failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
      );
      process.exitCode = 1;
    });
}
