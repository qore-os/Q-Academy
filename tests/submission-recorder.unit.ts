import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatRecordingTime,
  MAX_SUBMISSION_RECORDING_BYTES,
  MAX_SUBMISSION_RECORDING_DURATION_MS,
  recordedMediaValidationError,
  recordingCaptureErrorMessage,
  recordingFileName,
  recordingMimeCandidates,
  selectRecordingMimeType,
} from "@/lib/media/submission-recorder";

test("recorder chooses only a browser-supported MIME candidate in priority order", () => {
  const candidates = recordingMimeCandidates("video");
  assert.equal(
    selectRecordingMimeType("video", (mimeType) => mimeType === candidates[1]),
    candidates[1],
  );
  assert.equal(
    selectRecordingMimeType("audio", () => false),
    null,
  );
  assert.equal(
    selectRecordingMimeType("screen", () => {
      throw new Error("unsupported probe");
    }),
    null,
  );
});

test("recorder creates upload-safe names and base MIME types", () => {
  assert.deepEqual(
    recordingFileName(
      "audio",
      "audio/webm;codecs=opus",
      new Date("2026-07-11T12:34:56.789Z"),
    ),
    {
      baseMimeType: "audio/webm",
      fileName: "aufnahme-audio-20260711T123456Z.webm",
    },
  );
  assert.equal(recordingFileName("audio", "video/webm"), null);
  assert.equal(recordingFileName("screen", "application/octet-stream"), null);
});

test("recorder enforces ten minutes and 250 MiB before upload", () => {
  assert.equal(
    recordedMediaValidationError({
      sizeBytes: MAX_SUBMISSION_RECORDING_BYTES,
      durationMs: MAX_SUBMISSION_RECORDING_DURATION_MS,
    }),
    null,
  );
  assert.match(
    recordedMediaValidationError({
      sizeBytes: MAX_SUBMISSION_RECORDING_BYTES + 1,
      durationMs: 1_000,
    }) ?? "",
    /250 MiB/,
  );
  assert.match(
    recordedMediaValidationError({
      sizeBytes: 1,
      durationMs: MAX_SUBMISSION_RECORDING_DURATION_MS + 1,
    }) ?? "",
    /10 Minuten/,
  );
  assert.match(
    recordedMediaValidationError({ sizeBytes: 1, durationMs: 0 }) ?? "",
    /10 Minuten/,
  );
  assert.equal(formatRecordingTime(9 * 60_000 + 7_000), "09:07");
});

test("recorder maps permission, device, and display cancellation errors", () => {
  assert.match(
    recordingCaptureErrorMessage({ name: "NotAllowedError" }, "video"),
    /Berechtigung/,
  );
  assert.match(
    recordingCaptureErrorMessage({ name: "NotFoundError" }, "audio"),
    /Mikrofon/,
  );
  assert.match(
    recordingCaptureErrorMessage({ name: "AbortError" }, "screen"),
    /Bildschirmfreigabe/,
  );
});

test("learner recorder reuses the session upload and owns every media resource", () => {
  const recorder = readFileSync(
    "src/components/academy/submission-recorder.tsx",
    "utf8",
  );
  const uploader = readFileSync(
    "src/components/academy/submission-attachment-uploader.tsx",
    "utf8",
  );
  const runtime = readFileSync(
    "src/lib/media/browser-recorder-runtime.ts",
    "utf8",
  );

  assert.match(recorder, /getUserMedia/);
  assert.match(recorder, /getDisplayMedia/);
  assert.match(recorder, /MediaRecorder\.isTypeSupported/);
  assert.match(runtime, /systemAudio/);
  assert.match(runtime, /track\.stop\(\)/);
  assert.match(recorder, /clearInterval/);
  assert.match(recorder, /URL\.revokeObjectURL/);
  assert.match(recorder, /autoPlay/);
  assert.match(recorder, /muted/);
  assert.match(recorder, /playsInline/);
  assert.match(uploader, /onFile=\{\(file\) => enqueueFiles\(\[file\]\)\}/);
  assert.match(uploader, /uploadBrowserSessionMedia/);
  assert.match(uploader, /entries\.length >= MAX_ATTACHMENTS/);
});
