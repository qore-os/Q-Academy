import assert from "node:assert/strict";
import test from "node:test";

import {
  bindVideoCompositionSources,
  boundVideoCompositionMatchesDocument,
  buildVideoCompositionFfmpegGraph,
  canDownloadVideoCompositionDerivative,
  canUseVideoCompositionSource,
  MAX_VIDEO_COMPOSITION_SOURCE_BYTES,
  publishedSnapshotReferencesVideoComposition,
  sanitizeBoundVideoComposition,
  sanitizeVideoComposition,
  videoProcessingOptionsConflict,
} from "../src/lib/media/video-composition";
import { MAX_SCANNABLE_MEDIA_BYTES } from "../src/lib/media/storage-configuration";

const TRACK_ID = "10000000-0000-4000-8000-000000000001";
const AUDIO_ID = "20000000-0000-4000-8000-000000000001";
const JOB_ID = "30000000-0000-4000-8000-000000000001";

const document = {
  version: 1,
  audioTracks: [
    {
      id: TRACK_ID,
      mediaAssetId: AUDIO_ID,
      mediaAssetName: " narration.wav ",
      timelineStartMs: 2_500,
      sourceStartMs: 1_000,
      sourceEndMs: null,
      volume: 0.755,
    },
  ],
  renderJobId: JOB_ID,
};

const source = {
  assetId: AUDIO_ID,
  storageDriver: "filesystem" as const,
  storageKey: `tenants/test/assets/${AUDIO_ID}/ready.wav`,
  storageVersionId: null,
  etag: null,
  contentSha256: "a".repeat(64),
  sizeBytes: 25_000,
  durationMilliseconds: 12_000,
};

test("video composition is strict, canonical and bounded by source duration", () => {
  assert.deepEqual(
    sanitizeVideoComposition(document, new Map([[AUDIO_ID, 12_000]])),
    {
      version: 1,
      audioTracks: [
        {
          id: TRACK_ID,
          mediaAssetId: AUDIO_ID,
          mediaAssetName: "narration.wav",
          timelineStartMs: 2_500,
          sourceStartMs: 1_000,
          sourceEndMs: null,
          volume: 0.76,
        },
      ],
      renderJobId: JOB_ID,
    },
  );
  assert.equal(
    sanitizeVideoComposition({ ...document, unexpected: true }),
    null,
  );
  assert.equal(
    sanitizeVideoComposition(
      {
        ...document,
        audioTracks: [{ ...document.audioTracks[0], sourceEndMs: 12_001 }],
      },
      new Map([[AUDIO_ID, 12_000]]),
    ),
    null,
  );
});

test("binding freezes every secondary source identity and supplies the source end", () => {
  const bound = bindVideoCompositionSources(document, [source]);
  assert.ok(bound);
  assert.equal(bound.audioTracks[0]?.sourceEndMs, 12_000);
  assert.deepEqual(bound.audioTracks[0]?.source, source);
  assert.equal(sanitizeBoundVideoComposition(bound)?.audioTracks.length, 1);
  assert.equal(boundVideoCompositionMatchesDocument(bound, document), true);
  assert.equal(
    boundVideoCompositionMatchesDocument(bound, {
      ...document,
      audioTracks: [{ ...document.audioTracks[0], timelineStartMs: 3_000 }],
    }),
    false,
  );
  assert.equal(
    bindVideoCompositionSources(document, [
      { ...source, storageDriver: "s3", storageVersionId: null, etag: null },
    ]),
    null,
  );
});

test("video composition accepts the complete scannable source boundary", () => {
  assert.equal(
    MAX_VIDEO_COMPOSITION_SOURCE_BYTES,
    MAX_SCANNABLE_MEDIA_BYTES,
  );
  assert.ok(
    bindVideoCompositionSources(document, [
      { ...source, sizeBytes: MAX_SCANNABLE_MEDIA_BYTES },
    ]),
  );
  assert.equal(
    bindVideoCompositionSources(document, [
      { ...source, sizeBytes: MAX_SCANNABLE_MEDIA_BYTES + 1 },
    ]),
    null,
  );
});

test("FFmpeg graph mixes bounded audio inputs on the full source timeline", () => {
  const composition = bindVideoCompositionSources(document, [source]);
  assert.ok(composition);
  const graph = buildVideoCompositionFfmpegGraph({
    composition,
    expectedDurationMs: 10_000,
    includePrimaryAudio: true,
  });
  assert.ok(graph);
  assert.equal(graph.videoMap, "0:v:0");
  assert.equal(graph.audioMap, "[audio_out]");
  assert.match(graph.filterComplex, /\[1:a:0\]atrim=start=1:end=12/);
  assert.match(graph.filterComplex, /volume=0\.76/);
  assert.match(graph.filterComplex, /adelay=2500:all=1/);
  assert.match(graph.filterComplex, /amix=inputs=2/);
  assert.match(graph.filterComplex, /alimiter=limit=0\.95/);
  assert.match(graph.filterComplex, /atrim=end=10\[audio_out\]/);
});

test("processing requests reject physical edits combined with a composition", () => {
  assert.equal(videoProcessingOptionsConflict({ videoEdit: {} }), false);
  assert.equal(videoProcessingOptionsConflict({ videoComposition: {} }), false);
  assert.equal(
    videoProcessingOptionsConflict({ videoEdit: {}, videoComposition: {} }),
    true,
  );
  assert.equal(
    videoProcessingOptionsConflict({
      videoEdit: null,
      videoComposition: null,
    }),
    true,
  );
});

test("trainer composition access is current-course or own-unbound only", () => {
  assert.equal(
    canUseVideoCompositionSource({
      role: "trainer",
      uploadedByActor: false,
      boundToCurrentCourse: true,
      boundAnywhere: true,
    }),
    true,
  );
  assert.equal(
    canUseVideoCompositionSource({
      role: "trainer",
      uploadedByActor: true,
      boundToCurrentCourse: false,
      boundAnywhere: false,
    }),
    true,
  );
  assert.equal(
    canUseVideoCompositionSource({
      role: "trainer",
      uploadedByActor: true,
      boundToCurrentCourse: false,
      boundAnywhere: true,
    }),
    false,
  );
  assert.equal(
    canUseVideoCompositionSource({
      role: "admin",
      uploadedByActor: false,
      boundToCurrentCourse: false,
      boundAnywhere: true,
    }),
    true,
  );
});

test("member render lookup requires the exact published job and primary asset", () => {
  const snapshot = {
    modules: [
      {
        lessons: [
          {
            blocks: [
              {
                type: "video",
                data: {
                  mediaAssetId: "40000000-0000-4000-8000-000000000001",
                  videoComposition: document,
                },
              },
            ],
            pages: [],
          },
        ],
      },
    ],
  };
  assert.equal(
    publishedSnapshotReferencesVideoComposition(snapshot, {
      renderJobId: JOB_ID,
      primaryAssetId: "40000000-0000-4000-8000-000000000001",
    }),
    true,
  );
  assert.equal(
    publishedSnapshotReferencesVideoComposition(snapshot, {
      renderJobId: "30000000-0000-4000-8000-000000000002",
      primaryAssetId: "40000000-0000-4000-8000-000000000001",
    }),
    false,
  );
  assert.equal(
    publishedSnapshotReferencesVideoComposition(snapshot, {
      renderJobId: JOB_ID,
      primaryAssetId: "40000000-0000-4000-8000-000000000002",
    }),
    false,
  );
});

test("composition derivatives keep staff tenant-wide but bind trainers to edit grants", () => {
  assert.equal(
    canDownloadVideoCompositionDerivative({
      role: "trainer",
      coursePermission: "edit",
    }),
    true,
  );
  assert.equal(
    canDownloadVideoCompositionDerivative({
      role: "trainer",
      coursePermission: "view",
    }),
    false,
  );
  assert.equal(
    canDownloadVideoCompositionDerivative({
      role: "trainer",
      coursePermission: null,
    }),
    false,
  );
  assert.equal(canDownloadVideoCompositionDerivative({ role: "owner" }), true);
  assert.equal(canDownloadVideoCompositionDerivative({ role: "admin" }), true);
});
