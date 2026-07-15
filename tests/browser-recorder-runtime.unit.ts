import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  requestBrowserRecording,
  stopBrowserRecordingStream,
} from "../src/lib/media/browser-recorder-runtime";

function mockStream() {
  const track = { onended: () => undefined, stopped: false, stop() { this.stopped = true; } };
  return {
    track,
    stream: { getTracks: () => [track] } as unknown as MediaStream,
  };
}

test("camera and microphone capture uses bounded user-media constraints", async () => {
  const { stream } = mockStream();
  let userConstraints: MediaStreamConstraints | undefined;
  let recorderOptions: MediaRecorderOptions | undefined;
  class MockRecorder {
    state = "inactive" as RecordingState;
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
      recorderOptions = options;
    }
  }
  const result = await requestBrowserRecording({
    mode: "video",
    includeSystemAudio: false,
    mimeType: "video/webm;codecs=vp9,opus",
    mediaDevices: {
      async getUserMedia(constraints) { userConstraints = constraints; return stream; },
      async getDisplayMedia() { throw new Error("unexpected display capture"); },
    },
    MediaRecorderClass: MockRecorder as unknown as typeof MediaRecorder,
  });
  assert.equal(result.stream, stream);
  assert.equal(userConstraints?.audio !== false, true);
  assert.equal(typeof userConstraints?.video, "object");
  assert.equal(recorderOptions?.audioBitsPerSecond, 128_000);
  assert.equal(recorderOptions?.videoBitsPerSecond, 2_500_000);
});

test("screen capture delegates only to getDisplayMedia with explicit audio choice", async () => {
  const { stream } = mockStream();
  let displayConstraints: DisplayMediaStreamOptions | undefined;
  class MockRecorder { state = "inactive" as RecordingState; }
  await requestBrowserRecording({
    mode: "screen",
    includeSystemAudio: true,
    mimeType: "video/webm",
    mediaDevices: {
      async getUserMedia() { throw new Error("unexpected camera capture"); },
      async getDisplayMedia(constraints) { displayConstraints = constraints; return stream; },
    },
    MediaRecorderClass: MockRecorder as unknown as typeof MediaRecorder,
  });
  assert.equal(displayConstraints?.audio, true);
  assert.equal(
    (displayConstraints as DisplayMediaStreamOptions & { systemAudio?: string })
      .systemAudio,
    "include",
  );
});

test("recorder construction failures stop every granted track", async () => {
  const { stream, track } = mockStream();
  class BrokenRecorder { constructor() { throw new Error("unsupported"); } }
  await assert.rejects(
    requestBrowserRecording({
      mode: "audio",
      includeSystemAudio: false,
      mimeType: "audio/webm",
      mediaDevices: {
        async getUserMedia() { return stream; },
        async getDisplayMedia() { return stream; },
      },
      MediaRecorderClass: BrokenRecorder as unknown as typeof MediaRecorder,
    }),
    /unsupported/,
  );
  assert.equal(track.stopped, true);
  assert.equal(track.onended, null);
});

test("denied media permissions fail before recorder construction", async () => {
  let constructed = false;
  class MockRecorder { constructor() { constructed = true; } }
  await assert.rejects(
    requestBrowserRecording({
      mode: "video",
      includeSystemAudio: false,
      mimeType: "video/webm",
      mediaDevices: {
        async getUserMedia() {
          throw new DOMException("denied", "NotAllowedError");
        },
        async getDisplayMedia() {
          throw new Error("unexpected display capture");
        },
      },
      MediaRecorderClass: MockRecorder as unknown as typeof MediaRecorder,
    }),
    (error: unknown) =>
      error instanceof DOMException && error.name === "NotAllowedError",
  );
  assert.equal(constructed, false);
});

test("explicit cleanup clears handlers and stops all tracks", () => {
  const first = mockStream();
  const second = mockStream();
  const stream = {
    getTracks: () => [first.track, second.track],
  } as unknown as MediaStream;
  stopBrowserRecordingStream(stream);
  assert.equal(first.track.stopped, true);
  assert.equal(second.track.stopped, true);
  assert.equal(first.track.onended, null);
  assert.equal(second.track.onended, null);
});

test("course editor recordings enter only the existing course-content upload pipeline", () => {
  const source = readFileSync(
    "src/components/admin/course-media-source-field.tsx",
    "utf8",
  ) as string;
  assert.match(source, /SubmissionRecorder/);
  assert.match(source, /allowedModes=/);
  assert.match(source, /uploadBrowserSessionMedia\(\{/);
  assert.match(source, /purpose: "course_content"/);
  assert.doesNotMatch(source, /localStorage|indexedDB|sessionStorage/);
});
