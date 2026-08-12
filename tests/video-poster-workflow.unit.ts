import assert from "node:assert/strict";
import test from "node:test";

import { getVideoWorkflowCopy } from "../src/lib/i18n/video-workflow";
import {
  exactVideoThumbnailJobStatus,
  parseVideoPosterJson,
  sanitizeVideoPoster,
  videoThumbnailLookup,
  videoThumbnailLookupAcceptsJob,
  videoPosterUrl,
} from "../src/lib/media/video-poster";

const VIDEO_ID = "11111111-1111-4111-8111-111111111111";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";

test("video posters canonicalize frame and uploaded image selections", () => {
  assert.deepEqual(
    sanitizeVideoPoster({
      version: 1,
      source: "frame",
      atMilliseconds: 12_300,
      ignored: true,
    }),
    { version: 1, source: "frame", atMilliseconds: 12_300 },
  );
  assert.deepEqual(
    parseVideoPosterJson(
      JSON.stringify({
        version: 1,
        source: "upload",
        mediaAssetId: IMAGE_ID.toUpperCase(),
        mediaAssetName: "  lesson.jpg  ",
      }),
    ),
    {
      version: 1,
      source: "upload",
      mediaAssetId: IMAGE_ID,
      mediaAssetName: "lesson.jpg",
    },
  );
});

test("video posters fail closed for invalid versions, identities and timestamps", () => {
  for (const value of [
    null,
    { version: 2, source: "frame", atMilliseconds: 0 },
    { version: 1, source: "frame", atMilliseconds: -1 },
    { version: 1, source: "frame", atMilliseconds: 1.5 },
    { version: 1, source: "upload", mediaAssetId: "not-a-uuid" },
  ]) {
    assert.equal(sanitizeVideoPoster(value), null);
  }
  assert.equal(parseVideoPosterJson("{"), null);
});

test("poster URLs preserve legacy auto behavior and address an exact frame", () => {
  assert.equal(
    videoPosterUrl(VIDEO_ID, undefined),
    `/api/media-assets/${VIDEO_ID}/derivatives/thumbnail`,
  );
  assert.equal(
    videoPosterUrl(VIDEO_ID, {
      version: 1,
      source: "frame",
      atMilliseconds: 4_200,
    }),
    `/api/media-assets/${VIDEO_ID}/derivatives/thumbnail?atMilliseconds=4200`,
  );
  assert.equal(
    videoPosterUrl(VIDEO_ID, {
      version: 1,
      source: "upload",
      mediaAssetId: IMAGE_ID,
    }),
    `/api/media-assets/${IMAGE_ID}/download`,
  );
});

test("automatic thumbnail lookup accepts legacy and timestamp-zero jobs at runtime", () => {
  const lookup = videoThumbnailLookup(null);

  assert.deepEqual(lookup, { kind: "auto" });
  assert.equal(videoThumbnailLookupAcceptsJob(lookup, {}), true);
  assert.equal(
    videoThumbnailLookupAcceptsJob(lookup, { atMilliseconds: 0 }),
    true,
  );
  assert.equal(
    videoThumbnailLookupAcceptsJob(lookup, { atMilliseconds: 4_200 }),
    false,
  );
  assert.equal(
    videoThumbnailLookupAcceptsJob(lookup, { atMilliseconds: "0" }),
    false,
  );

  const exactLookup = videoThumbnailLookup(4_200);
  assert.equal(videoThumbnailLookupAcceptsJob(exactLookup, {}), false);
  assert.equal(
    videoThumbnailLookupAcceptsJob(exactLookup, { atMilliseconds: 0 }),
    false,
  );
  assert.equal(
    videoThumbnailLookupAcceptsJob(exactLookup, { atMilliseconds: 4_200 }),
    true,
  );
});

test("frame readiness requires the exact thumbnail job and timestamp", () => {
  const jobId = "33333333-3333-4333-8333-333333333333";
  const job = (status: string, atMilliseconds: number, type = "thumbnail") => ({
    id: jobId,
    type,
    status,
    atMilliseconds,
  });

  assert.equal(
    exactVideoThumbnailJobStatus([job("queued", 4_200)], jobId, 4_200),
    "pending",
  );
  assert.equal(
    exactVideoThumbnailJobStatus([job("processing", 4_200)], jobId, 4_200),
    "processing",
  );
  assert.equal(
    exactVideoThumbnailJobStatus([job("failed", 4_200)], jobId, 4_200),
    "failed",
  );
  assert.equal(
    exactVideoThumbnailJobStatus([job("succeeded", 4_200)], jobId, 4_200),
    "succeeded",
  );
  assert.equal(
    exactVideoThumbnailJobStatus([job("succeeded", 4_201)], jobId, 4_200),
    null,
  );
  assert.equal(
    exactVideoThumbnailJobStatus(
      [job("succeeded", 4_200, "transcode")],
      jobId,
      4_200,
    ),
    null,
  );
});

test("video workflow copy is complete in all supported locales", () => {
  const keys = Object.keys(getVideoWorkflowCopy("de")).sort();
  for (const locale of ["de", "en", "it", "es", "fr"] as const) {
    const localized = getVideoWorkflowCopy(locale);
    assert.deepEqual(Object.keys(localized).sort(), keys);
    assert.ok(Object.values(localized).every((value) => value.trim().length > 0));
  }
});

test("video workflow copy preserves locale-specific diacritics", () => {
  assert.match(getVideoWorkflowCopy("de").descriptionAccept, /übernehmen/);
  assert.match(getVideoWorkflowCopy("it").posterFrameHint, /verrà/);
  assert.match(getVideoWorkflowCopy("es").descriptionTitle, /Descripción/);
  assert.match(getVideoWorkflowCopy("fr").descriptionGenerate, /Générer/);
});
