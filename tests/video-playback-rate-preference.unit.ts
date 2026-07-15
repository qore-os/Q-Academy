import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parseVideoPlaybackRatePreference,
  videoPlaybackRatePreference,
  VIDEO_PLAYBACK_RATES,
  VIDEO_PLAYBACK_RATE_STORAGE_KEY,
} from "../src/lib/media/video-playback-rate-preference";

test("video playback rate preference accepts only supported version-one rates", () => {
  assert.deepEqual(
    parseVideoPlaybackRatePreference('{"version":1,"rate":1.5}'),
    { version: 1, rate: 1.5 },
  );
  assert.equal(parseVideoPlaybackRatePreference(null), null);
  assert.equal(parseVideoPlaybackRatePreference("not-json"), null);
  assert.equal(
    parseVideoPlaybackRatePreference('{"version":1,"rate":4}'),
    null,
  );
  assert.equal(
    parseVideoPlaybackRatePreference('{"version":2,"rate":1.5}'),
    null,
  );
});

test("video playback rate preference normalizes media state", () => {
  assert.equal(
    VIDEO_PLAYBACK_RATE_STORAGE_KEY,
    "q-academy:video-playback-rate:v1",
  );
  assert.deepEqual(VIDEO_PLAYBACK_RATES, [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  assert.deepEqual(videoPlaybackRatePreference({ playbackRate: 1.7 }), {
    version: 1,
    rate: 1.75,
  });
  assert.deepEqual(videoPlaybackRatePreference({ playbackRate: 20 }), {
    version: 1,
    rate: 2,
  });
});

test("learner player persists playback speed for the browser session", () => {
  const source = readFileSync(
    "src/components/academy/video-transcript-player.tsx",
    "utf8",
  );

  assert.match(source, /window\.sessionStorage\.getItem/);
  assert.match(source, /window\.sessionStorage\.setItem/);
  assert.match(source, /onRateChange=/);
  assert.match(source, /copy\("video\.playbackSpeed"\)/);
});
