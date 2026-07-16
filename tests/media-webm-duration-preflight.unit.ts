import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPlausibleWebmDuration,
  containerDurationIsMissing,
  runBoundedBinaryProcess,
  WEBM_PREFLIGHT_FFMPEG,
  WEBM_PREFLIGHT_FFMPEG_ARGUMENTS,
  WEBM_PREFLIGHT_FFPROBE,
  WEBM_PREFLIGHT_MAX_BYTES,
  WEBM_PREFLIGHT_MAX_DURATION_MS,
  WEBM_PREFLIGHT_MIN_DURATION_MS,
  WebmDurationPreflightError,
} from "../scripts/webm-duration-preflight";

test("durationless WebM preflight uses a bounded Chromium-like live mux", () => {
  assert.equal(WEBM_PREFLIGHT_FFMPEG, "/usr/bin/ffmpeg");
  assert.equal(WEBM_PREFLIGHT_FFPROBE, "/usr/bin/ffprobe");
  assert.deepEqual(
    WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.slice(0, 4),
    ["-nostdin", "-hide_banner", "-loglevel", "error"],
  );
  assert.ok(
    WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.includes(
      "testsrc2=size=160x90:rate=10",
    ),
  );
  assert.ok(
    WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.includes(
      "sine=frequency=997:sample_rate=48000",
    ),
  );
  assert.ok(WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.includes("libvpx"));
  assert.ok(WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.includes("libopus"));
  assert.equal(
    WEBM_PREFLIGHT_FFMPEG_ARGUMENTS[
      WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.indexOf("-live") + 1
    ],
    "1",
  );
  assert.equal(
    WEBM_PREFLIGHT_FFMPEG_ARGUMENTS[
      WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.indexOf("-fs") + 1
    ],
    String(WEBM_PREFLIGHT_MAX_BYTES),
  );
  assert.equal(WEBM_PREFLIGHT_FFMPEG_ARGUMENTS.at(-1), "pipe:1");
});

test("bounded media process passes arguments literally and preserves binary output", async () => {
  const literal = "literal;not-a-shell|argument";
  const output = await runBoundedBinaryProcess({
    executable: process.execPath,
    arguments: [
      "-e",
      "process.stdout.write(Buffer.concat([Buffer.from([0, 255]), Buffer.from(process.argv[1] ?? '')]))",
      literal,
    ],
    timeoutMs: 5_000,
    maxStdoutBytes: 1_024,
  });
  assert.deepEqual(output, Buffer.concat([Buffer.from([0, 255]), Buffer.from(literal)]));
});

test("bounded media process rejects oversized output", async () => {
  await assert.rejects(
    runBoundedBinaryProcess({
      executable: process.execPath,
      arguments: ["-e", "process.stdout.write(Buffer.alloc(4096, 1))"],
      timeoutMs: 5_000,
      maxStdoutBytes: 1_024,
    }),
    (error: unknown) =>
      error instanceof WebmDurationPreflightError &&
      error.code === "output_limit",
  );
});

test("bounded media process enforces its execution timeout", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runBoundedBinaryProcess({
      executable: process.execPath,
      arguments: ["-e", "setInterval(() => undefined, 1000)"],
      timeoutMs: 100,
      maxStdoutBytes: 1_024,
    }),
    (error: unknown) =>
      error instanceof WebmDurationPreflightError &&
      error.code === "process_timeout",
  );
  assert.ok(Date.now() - startedAt < 3_000);
});

test("durationless metadata and the canary duration window fail closed", () => {
  assert.equal(containerDurationIsMissing(""), false);
  assert.equal(containerDurationIsMissing("N/A\n"), true);
  assert.equal(containerDurationIsMissing("1.250000\n"), false);

  assert.doesNotThrow(() =>
    assertPlausibleWebmDuration(WEBM_PREFLIGHT_MIN_DURATION_MS),
  );
  assert.doesNotThrow(() =>
    assertPlausibleWebmDuration(WEBM_PREFLIGHT_MAX_DURATION_MS),
  );
  for (const invalid of [
    WEBM_PREFLIGHT_MIN_DURATION_MS - 1,
    WEBM_PREFLIGHT_MAX_DURATION_MS + 1,
    Number.NaN,
  ]) {
    assert.throws(
      () => assertPlausibleWebmDuration(invalid),
      (error: unknown) =>
        error instanceof WebmDurationPreflightError &&
        error.code === "duration_out_of_range",
    );
  }
});
