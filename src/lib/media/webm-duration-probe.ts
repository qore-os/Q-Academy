import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { MediaContentInspectionError } from "@/lib/media/content-inspection";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_LINE_BYTES = 256;
const MAX_PACKET_RECORDS = 1_000_000;
const MAX_MEDIA_STREAMS = 64;
const MAX_DURATION_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const SAFE_EXECUTABLE = /^[^\u0000-\u001f\u007f]{1,1024}$/;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]{1,9})?$/;

export const WEBM_DURATION_FFPROBE_ARGUMENTS = [
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
  "-show_packets",
  "-show_entries",
  "packet=stream_index,pts_time,duration_time:packet_tags=:packet_side_data=",
  "-of",
  "compact=p=0:nk=0",
] as const;

export function isWebmDurationProbeMimeType(mimeType: string) {
  return mimeType === "audio/webm" || mimeType === "video/webm";
}

export class WebmDurationProbeError extends Error {
  readonly code: "probe_unavailable" | "probe_timeout";

  constructor(
    code: WebmDurationProbeError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WebmDurationProbeError";
    this.code = code;
  }
}

type ProbeOptions = Readonly<{
  executable?: string;
  arguments?: readonly string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxPacketRecords?: number;
}>;

function invalidWebm(message: string) {
  return new MediaContentInspectionError("signature_mismatch", message);
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
) {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), maximum)
    : fallback;
}

function terminateProcess(child: ChildProcessWithoutNullStreams) {
  const pid = child.pid;
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // Fall back to the direct child when the process group already exited.
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // The child may already have exited between the state check and the kill.
  }
}

type ProcessOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; error: Error }>;

type PacketStreamState = {
  lastPtsSeconds: number | null;
};

function cancelInput(
  body: AsyncIterable<Uint8Array>,
  iterator: AsyncIterator<Uint8Array>,
) {
  const destroy = (body as { destroy?: () => void }).destroy;
  if (typeof destroy === "function") {
    try {
      destroy.call(body);
    } catch {
      // Iterator cancellation below remains the portable fallback.
    }
  }
  try {
    const returned = iterator.return?.();
    void returned?.catch(() => undefined);
  } catch {
    // Cancellation is best effort after the probe has already failed.
  }
}

export async function probeWebmDurationStream(
  input: {
    body: AsyncIterable<Uint8Array>;
    expectedSizeBytes: number;
  },
  options: ProbeOptions = {},
) {
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes <= 0
  ) {
    throw new TypeError("Expected WebM size must be a positive safe integer.");
  }
  const executable =
    options.executable ??
    (process.env.MEDIA_FFPROBE_PATH?.trim() || "ffprobe");
  if (!SAFE_EXECUTABLE.test(executable)) {
    throw new WebmDurationProbeError(
      "probe_unavailable",
      "The WebM duration probe executable is invalid.",
    );
  }
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
  );
  const outputLimit = boundedPositiveInteger(
    options.maxOutputBytes,
    MAX_OUTPUT_BYTES,
    MAX_OUTPUT_BYTES,
  );
  const recordLimit = boundedPositiveInteger(
    options.maxPacketRecords,
    MAX_PACKET_RECORDS,
    MAX_PACKET_RECORDS,
  );
  const childProcess = process.getBuiltinModule("node:child_process");
  if (!childProcess) {
    throw new WebmDurationProbeError(
      "probe_unavailable",
      "The WebM duration probe process runtime is unavailable.",
    );
  }
  const { spawn } = childProcess;
  const child = spawn(
    executable, // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
    [...(options.arguments ?? WEBM_DURATION_FFPROBE_ARGUMENTS)],
    {
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let outputBytes = 0;
  let packetRecords = 0;
  let timedPacketRecords = 0;
  let pendingOutput = "";
  let maxPacketEndSeconds = Number.NEGATIVE_INFINITY;
  let minPacketStartSeconds = Number.POSITIVE_INFINITY;
  let fatalError: Error | null = null;
  let closed = false;
  let receivedBytes = 0;
  const packetStreams = new Map<number, PacketStreamState>();

  let resolveCompletion: (outcome: ProcessOutcome) => void = () => undefined;
  const completion = new Promise<ProcessOutcome>((resolve) => {
    resolveCompletion = resolve;
  });
  let completionSettled = false;
  const complete = (outcome: ProcessOutcome) => {
    if (completionSettled) return;
    completionSettled = true;
    resolveCompletion(outcome);
  };

  const fail = (error: Error) => {
    fatalError ??= error;
    complete({ ok: false, error: fatalError });
    terminateProcess(child);
  };
  const parsePacket = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line) return;
    if (Buffer.byteLength(line, "utf8") > MAX_OUTPUT_LINE_BYTES) {
      fail(
        invalidWebm("The WebM duration probe produced an oversized record."),
      );
      return;
    }
    packetRecords += 1;
    if (packetRecords > recordLimit) {
      fail(invalidWebm("The WebM file contains too many packet records."));
      return;
    }
    const parts = line.split("|");
    if (parts.at(-1) === "") parts.pop();
    const fields = new Map<string, string>();
    for (const part of parts) {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        fail(
          invalidWebm("The WebM duration probe produced an invalid record."),
        );
        return;
      }
      const name = part.slice(0, separator);
      const value = part.slice(separator + 1);
      if (fields.has(name)) {
        fail(invalidWebm("The WebM duration probe produced duplicate fields."));
        return;
      }
      fields.set(name, value);
    }
    const streamIndexValue = fields.get("stream_index") ?? "";
    const ptsValue = fields.get("pts_time") ?? "";
    const durationValue = fields.get("duration_time");
    if (
      fields.size < 2 ||
      fields.size > 3 ||
      [...fields.keys()].some(
        (name) =>
          name !== "stream_index" &&
          name !== "pts_time" &&
          name !== "duration_time",
      ) ||
      !/^(?:0|[1-9][0-9]*)$/.test(streamIndexValue)
    ) {
      fail(invalidWebm("The WebM packet timing metadata is incomplete."));
      return;
    }
    if (ptsValue === "N/A") return;
    if (!NUMBER.test(ptsValue)) {
      fail(invalidWebm("The WebM packet timestamp is invalid."));
      return;
    }
    const streamIndex = Number(streamIndexValue);
    if (!Number.isSafeInteger(streamIndex)) {
      fail(invalidWebm("The WebM packet stream index is invalid."));
      return;
    }
    const ptsSeconds = Number(ptsValue);
    let durationSeconds: number | null = null;
    if (durationValue !== undefined && durationValue !== "N/A") {
      if (!NUMBER.test(durationValue)) {
        fail(invalidWebm("The WebM packet duration is invalid."));
        return;
      }
      const parsedDuration = Number(durationValue);
      if (!Number.isFinite(parsedDuration) || parsedDuration < 0) {
        fail(invalidWebm("The WebM packet duration is invalid."));
        return;
      }
      if (parsedDuration > 0) durationSeconds = parsedDuration;
    }
    const maximumSeconds = MAX_DURATION_MILLISECONDS / 1_000;
    if (
      !Number.isFinite(ptsSeconds) ||
      Math.abs(ptsSeconds) > maximumSeconds ||
      (durationSeconds !== null && durationSeconds > maximumSeconds)
    ) {
      fail(
        invalidWebm("The WebM packet timing metadata is outside its bounds."),
      );
      return;
    }
    let stream = packetStreams.get(streamIndex);
    if (!stream) {
      if (packetStreams.size >= MAX_MEDIA_STREAMS) {
        fail(invalidWebm("The WebM file contains too many media streams."));
        return;
      }
      stream = {
        lastPtsSeconds: null,
      };
      packetStreams.set(streamIndex, stream);
    }
    if (stream.lastPtsSeconds !== null) {
      const deltaSeconds = ptsSeconds - stream.lastPtsSeconds;
      if (deltaSeconds > 0 && deltaSeconds <= maximumSeconds) {
        maxPacketEndSeconds = Math.max(maxPacketEndSeconds, ptsSeconds);
      }
    }
    if (durationSeconds !== null) {
      const packetEndSeconds = ptsSeconds + durationSeconds;
      if (
        !Number.isFinite(packetEndSeconds) ||
        Math.abs(packetEndSeconds) > maximumSeconds
      ) {
        fail(
          invalidWebm("The WebM packet timing metadata is outside its bounds."),
        );
        return;
      }
      maxPacketEndSeconds = Math.max(maxPacketEndSeconds, packetEndSeconds);
    }
    stream.lastPtsSeconds = ptsSeconds;
    timedPacketRecords += 1;
    minPacketStartSeconds = Math.min(minPacketStartSeconds, ptsSeconds);
    maxPacketEndSeconds = Math.max(maxPacketEndSeconds, ptsSeconds);
  };
  const consumeOutput = (chunk: Buffer | string) => {
    if (fatalError) return;
    const text = chunk.toString();
    outputBytes += Buffer.byteLength(text, "utf8");
    if (outputBytes > outputLimit) {
      fail(invalidWebm("The WebM duration probe exceeded its output limit."));
      return;
    }
    pendingOutput += text;
    let newline = pendingOutput.indexOf("\n");
    while (newline >= 0 && !fatalError) {
      parsePacket(pendingOutput.slice(0, newline));
      pendingOutput = pendingOutput.slice(newline + 1);
      newline = pendingOutput.indexOf("\n");
    }
    if (
      !fatalError &&
      Buffer.byteLength(pendingOutput, "utf8") > MAX_OUTPUT_LINE_BYTES
    ) {
      fail(
        invalidWebm("The WebM duration probe produced an oversized record."),
      );
    }
  };

  child.stdout.on("data", consumeOutput);
  child.stdout.once("error", () => {
    fail(
      new WebmDurationProbeError(
        "probe_unavailable",
        "The WebM duration probe output stream failed.",
      ),
    );
  });
  child.stderr.once("error", () => {
    fail(
      new WebmDurationProbeError(
        "probe_unavailable",
        "The WebM duration probe error stream failed.",
      ),
    );
  });
  child.stderr.resume();
  child.stdin.on("error", () => {
    // `close` classifies an ffprobe parse exit, signal, or infrastructure
    // failure without racing an early EPIPE into the wrong terminal state.
  });

  const timer = setTimeout(() => {
    complete({
      ok: false,
      error: new WebmDurationProbeError(
        "probe_timeout",
        "The WebM duration probe exceeded its time limit.",
      ),
    });
    terminateProcess(child);
  }, timeoutMs);
  timer.unref?.();
  child.once("error", (error) => {
    closed = true;
    clearTimeout(timer);
    complete({
      ok: false,
      error: new WebmDurationProbeError(
        "probe_unavailable",
        "The WebM duration probe could not be started.",
        { cause: error },
      ),
    });
  });
  child.once("close", (code, signal) => {
    closed = true;
    clearTimeout(timer);
    if (pendingOutput && !fatalError) parsePacket(pendingOutput);
    if (fatalError) {
      complete({ ok: false, error: fatalError });
    } else if (signal !== null) {
      complete({
        ok: false,
        error: new WebmDurationProbeError(
          "probe_unavailable",
          "The WebM duration probe was terminated unexpectedly.",
        ),
      });
    } else if (code !== 0) {
      complete({
        ok: false,
        error: invalidWebm("The WebM container could not be parsed safely."),
      });
    } else {
      complete({ ok: true });
    }
  });

  const iterator = input.body[Symbol.asyncIterator]();
  let iteratorDone = false;
  const processCompleted = completion.then(
    (outcome) => ({ kind: "process" as const, outcome }),
  );
  try {
    while (true) {
      const nextInput = Promise.resolve()
        .then(() => iterator.next())
        .then(
          (result) => ({ kind: "input" as const, result }),
          (error: unknown) => ({ kind: "input_error" as const, error }),
        );
      const next = await Promise.race([nextInput, processCompleted]);
      if (next.kind === "process") {
        if (!next.outcome.ok) throw next.outcome.error;
        throw invalidWebm(
          "The WebM duration probe ended before the input stream.",
        );
      }
      if (next.kind === "input_error") throw next.error;
      if (next.result.done) {
        iteratorDone = true;
        break;
      }
      const sourceChunk = next.result.value;
      const chunk = Buffer.from(sourceChunk);
      if (!chunk.byteLength) continue;
      receivedBytes += chunk.byteLength;
      if (receivedBytes > input.expectedSizeBytes) {
        throw invalidWebm("The WebM object exceeds its expected size.");
      }
      if (closed) {
        const outcome = await completion;
        if (!outcome.ok) throw outcome.error;
        throw invalidWebm(
          "The WebM duration probe ended before the input stream.",
        );
      }
      if (!child.stdin.write(chunk)) {
        const writable = await Promise.race([
          new Promise<{ kind: "drain" }>((resolve) => {
            child.stdin.once("drain", () => resolve({ kind: "drain" }));
          }),
          processCompleted,
        ]);
        if (writable.kind === "process") {
          if (!writable.outcome.ok) throw writable.outcome.error;
          throw invalidWebm(
            "The WebM duration probe ended before the input stream.",
          );
        }
      }
    }
    if (receivedBytes !== input.expectedSizeBytes) {
      throw invalidWebm("The WebM object does not match its expected size.");
    }
    child.stdin.end();
    const outcome = await completion;
    if (!outcome.ok) throw outcome.error;
  } catch (error) {
    terminateProcess(child);
    throw error;
  } finally {
    clearTimeout(timer);
    if (!iteratorDone) cancelInput(input.body, iterator);
    if (!closed) terminateProcess(child);
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  }

  const durationMilliseconds = Math.round(
    (maxPacketEndSeconds - minPacketStartSeconds) * 1_000,
  );
  if (
    timedPacketRecords < 1 ||
    !Number.isSafeInteger(durationMilliseconds) ||
    durationMilliseconds <= 0 ||
    durationMilliseconds > MAX_DURATION_MILLISECONDS
  ) {
    throw invalidWebm("The WebM file has no trustworthy bounded duration.");
  }
  return { durationMilliseconds };
}
