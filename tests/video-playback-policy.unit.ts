import assert from "node:assert/strict";
import test from "node:test";

import {
  playbackWindowMilliseconds,
  sanitizeVideoPlaybackPolicy,
  videoPlaybackPolicyFromForm,
} from "../src/lib/media/video-playback-policy";

test("video policy preserves non-destructive trim and required playback rules", () => {
  const policy = videoPlaybackPolicyFromForm({
    trimStartSeconds: "1.250",
    trimEndSeconds: "11.250",
    removedSegments: JSON.stringify([
      { startSeconds: 3.25, endSeconds: 4.25 },
      { startSeconds: 8.25, endSeconds: 9.25 },
    ]),
    requiredPlayback: true,
    minimumWatchPercent: "90",
    seeking: "watched_only",
  });
  assert.deepEqual(policy, {
    version: 2,
    trimStartMs: 1_250,
    trimEndMs: 11_250,
    removedSegments: [
      { startMs: 3_250, endMs: 4_250 },
      { startMs: 8_250, endMs: 9_250 },
    ],
    completionMode: "required",
    minimumWatchPercent: 90,
    seeking: "watched_only",
  });
  assert.deepEqual(playbackWindowMilliseconds(policy, 20_000), {
    startMs: 1_250,
    endMs: 11_250,
    durationMs: 8_000,
    requiredMs: 7_200,
  });
});

test("invalid playback input fails closed to defaults", () => {
  assert.equal(
    videoPlaybackPolicyFromForm({
      trimStartSeconds: "10",
      trimEndSeconds: "9",
      requiredPlayback: true,
      minimumWatchPercent: "20",
      seeking: "unknown",
    }),
    null,
  );
  assert.deepEqual(sanitizeVideoPlaybackPolicy({ version: 1, trimStartMs: -1 }), {
    version: 2,
    trimStartMs: 0,
    trimEndMs: null,
    removedSegments: [],
    completionMode: "optional",
    minimumWatchPercent: 90,
    seeking: "allowed",
  });
});

test("version one policies remain readable and upgrade without cuts", () => {
  assert.deepEqual(
    sanitizeVideoPlaybackPolicy({
      version: 1,
      trimStartMs: 500,
      trimEndMs: 5_000,
      completionMode: "optional",
      minimumWatchPercent: 90,
      seeking: "allowed",
    }),
    {
      version: 2,
      trimStartMs: 500,
      trimEndMs: 5_000,
      removedSegments: [],
      completionMode: "optional",
      minimumWatchPercent: 90,
      seeking: "allowed",
    },
  );
});
