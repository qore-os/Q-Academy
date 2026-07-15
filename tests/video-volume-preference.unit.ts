import assert from "node:assert/strict";
import test from "node:test";
import {
  parseVideoVolumePreference,
  videoVolumePreference,
  VIDEO_VOLUME_STORAGE_KEY,
} from "../src/lib/media/video-volume-preference";

test("video volume preference accepts only bounded version-one values", () => {
  assert.deepEqual(
    parseVideoVolumePreference('{"version":1,"volume":0.35,"muted":false}'),
    { version: 1, volume: 0.35, muted: false },
  );
  assert.equal(parseVideoVolumePreference(null), null);
  assert.equal(parseVideoVolumePreference("not-json"), null);
  assert.equal(
    parseVideoVolumePreference('{"version":1,"volume":2,"muted":false}'),
    null,
  );
  assert.equal(
    parseVideoVolumePreference('{"version":2,"volume":0.5,"muted":false}'),
    null,
  );
});

test("video volume preference serializes media state defensively", () => {
  assert.equal(VIDEO_VOLUME_STORAGE_KEY, "q-academy:video-volume:v1");
  assert.deepEqual(videoVolumePreference({ volume: 0.7, muted: true }), {
    version: 1,
    volume: 0.7,
    muted: true,
  });
  assert.deepEqual(videoVolumePreference({ volume: 4, muted: false }), {
    version: 1,
    volume: 1,
    muted: false,
  });
});
