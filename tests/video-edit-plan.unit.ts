import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVideoEditFfmpegFilters,
  effectiveVideoEditDuration,
  sanitizeVideoEditPlan,
  videoEditKeptSegments,
  videoPlaybackOffsetToSourcePosition,
  videoPositionAfterRemovedSegment,
  videoSourcePositionToPlaybackOffset,
} from "../src/lib/media/video-edit-plan";

const plan = {
  version: 1,
  trimStartMs: 1_000,
  trimEndMs: 11_000,
  removedSegments: [
    { startMs: 2_000, endMs: 3_000 },
    { startMs: 7_000, endMs: 8_500 },
  ],
} as const;

test("video edit plans retain ordered playable segments", () => {
  assert.deepEqual(sanitizeVideoEditPlan(plan, 20_000), plan);
  assert.deepEqual(videoEditKeptSegments(plan, 20_000), [
    { startMs: 1_000, endMs: 2_000 },
    { startMs: 3_000, endMs: 7_000 },
    { startMs: 8_500, endMs: 11_000 },
  ]);
  assert.equal(effectiveVideoEditDuration(plan, 20_000), 7_500);
  assert.equal(videoPositionAfterRemovedSegment(plan, 2_500), 3_000);
  assert.equal(videoSourcePositionToPlaybackOffset(plan, 20_000, 9_000), 5_500);
  assert.equal(videoPlaybackOffsetToSourcePosition(plan, 20_000, 5_500), 9_000);
  assert.equal(videoPlaybackOffsetToSourcePosition(plan, 20_000, 1_000), 3_000);
  assert.equal(videoPlaybackOffsetToSourcePosition(plan, 20_000, 2_000), 4_000);
});

test("video edit plans reject overlaps, bounds violations and fully removed clips", () => {
  assert.equal(
    sanitizeVideoEditPlan({
      ...plan,
      removedSegments: [
        { startMs: 2_000, endMs: 4_000 },
        { startMs: 3_000, endMs: 5_000 },
      ],
    }),
    null,
  );
  assert.equal(
    sanitizeVideoEditPlan({
      version: 1,
      trimStartMs: 1_000,
      trimEndMs: 2_000,
      removedSegments: [{ startMs: 1_000, endMs: 2_000 }],
    }),
    null,
  );
});

test("FFmpeg filters are derived only from canonical numeric segments", () => {
  assert.deepEqual(buildVideoEditFfmpegFilters(plan, 20_000), {
    video:
      "select=between(t\\,1\\,2)+between(t\\,3\\,7)+between(t\\,8.5\\,11),setpts=N/FRAME_RATE/TB",
    audio:
      "aselect=between(t\\,1\\,2)+between(t\\,3\\,7)+between(t\\,8.5\\,11),asetpts=N/SR/TB",
    expectedDurationMs: 7_500,
  });
});
