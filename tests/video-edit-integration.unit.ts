import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { contentBlockForSnapshot } from "../src/lib/course-snapshot-block";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("published video blocks upgrade version-one playback policies", () => {
  const snapshot = contentBlockForSnapshot(
    {
      id: "10000000-0000-4000-8000-000000000001",
      type: "video",
      data: {
        videoPlayback: {
          version: 1,
          trimStartMs: 1_000,
          trimEndMs: 8_000,
          completionMode: "required",
          minimumWatchPercent: 90,
          seeking: "watched_only",
        },
      },
    } as never,
    false,
  );

  assert.deepEqual(snapshot.data.videoPlayback, {
    version: 2,
    trimStartMs: 1_000,
    trimEndMs: 8_000,
    removedSegments: [],
    completionMode: "required",
    minimumWatchPercent: 90,
    seeking: "watched_only",
  });
});

test("learner playback keeps cuts compatible with captions, seek rules and end cards", () => {
  const player = source("src/components/academy/video-transcript-player.tsx");
  const heartbeat = source("src/app/api/media-playback/route.ts");

  assert.match(player, /playbackPositionAfterRemovedSegment/);
  assert.match(player, /sourcePositionToPlaybackOffset/);
  assert.match(player, /playbackOffsetToSourcePosition/);
  assert.match(player, /policy\.seeking === "disabled"/);
  assert.match(player, /policy\.seeking === "watched_only"/);
  assert.match(player, /<track[\s\S]*kind="captions"/);
  assert.match(player, /onRateChange=/);
  assert.match(player, /sanitizeVideoEndCard/);
  assert.match(player, /setEndCardVisible\(Boolean\(endCardDocument\)\)/);
  assert.match(heartbeat, /playbackPositionAfterRemovedSegment/);
  assert.match(heartbeat, /sourcePositionToPlaybackOffset/);
  assert.match(heartbeat, /playbackWindowMilliseconds/);
});

test("learner applies playback edits once to the full-timeline composition derivative", () => {
  const lesson = source("src/components/academy/lesson-content.tsx");
  const player = source("src/components/academy/video-transcript-player.tsx");
  const invocationStart = lesson.indexOf("<VideoTranscriptPlayer");
  const invocationEnd = lesson.indexOf("/>", invocationStart);
  assert.ok(invocationStart >= 0 && invocationEnd > invocationStart);
  const invocation = lesson.slice(invocationStart, invocationEnd);
  assert.match(invocation, /playbackPolicy=\{block\.data\.videoPlayback\}/);
  assert.match(invocation, /transcodeJobId=/);
  assert.match(
    player,
    /sanitizeVideoPlaybackPolicy\(playbackPolicy\)[\s\S]*\[playbackPolicy\]/,
  );
  assert.match(
    player,
    /transcodeJobId[\s\S]*\?job=\$\{encodeURIComponent\(transcodeJobId\)\}/,
  );
  assert.match(player, /!transcodeJobId \? <source src=\{src\} \/> : null/);
  assert.match(
    player,
    /onError=\{\(\) => \{[\s\S]*setFailedCompositionSourceKey\(compositionSourceKey\)/,
  );
  assert.match(player, /compositionCopy\.playbackUnavailable/);
});

test("admin editor persists ordered cut ranges and queues the same edit plan", () => {
  const editor = source("src/components/admin/video-transcript-editor.tsx");
  const actions = source("src/lib/course-builder-actions.ts");

  assert.match(editor, /name="videoRemovedSegments"/);
  assert.match(editor, /JSON\.stringify\(removedSegmentsPayload\)/);
  assert.match(editor, /videoEdit:[\s\S]*videoEditPlanFromPlaybackPolicy/);
  assert.match(editor, /playbackPositionAfterRemovedSegment/);
  assert.match(
    actions,
    /removedSegments: value\(formData, "videoRemovedSegments"\)/,
  );
  assert.match(actions, /playbackWindowMilliseconds\(policy, duration\)/);
});
