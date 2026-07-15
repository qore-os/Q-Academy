import assert from "node:assert/strict";
import test from "node:test";

import {
  collectCourseContentMediaReferences,
  courseContentDataForCopy,
  copiedLessonSlug,
  CourseContentCopyReferenceError,
  remapCopiedExamQuestionPools,
} from "../src/lib/course-content-copy-model";

const IMAGE_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const AUDIO_ID = "33333333-3333-4333-8333-333333333333";
const RENDER_JOB_ID = "66666666-6666-4666-8666-666666666666";

test("copy model discovers direct, gallery and download media bindings", () => {
  const references = collectCourseContentMediaReferences([
    { id: "image", type: "image", data: { mediaAssetId: IMAGE_ID } },
    {
      id: "gallery",
      type: "gallery",
      data: {
        gallery: {
          version: 1,
          layout: "grid",
          items: [
            {
              source: `/api/media-assets/${IMAGE_ID}/download`,
              alt: "Preview",
              mediaAssetId: IMAGE_ID,
            },
          ],
        },
      },
    },
    {
      id: "download",
      type: "download",
      data: {
        download: {
          version: 1,
          mediaAssetId: FILE_ID,
          fileName: "guide.pdf",
          label: "Guide",
        },
      },
    },
    {
      id: "video",
      type: "video",
      data: {
        mediaAssetId: "44444444-4444-4444-8444-444444444444",
        videoComposition: {
          version: 1,
          audioTracks: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              mediaAssetId: AUDIO_ID,
              timelineStartMs: 0,
              sourceStartMs: 0,
              sourceEndMs: null,
              volume: 1,
            },
          ],
        },
      },
    },
  ]);
  assert.deepEqual(
    [...references],
    [
      [IMAGE_ID, "image"],
      [FILE_ID, "document"],
      ["44444444-4444-4444-8444-444444444444", "video"],
      [AUDIO_ID, "audio"],
    ],
  );
});

test("copy model remaps every exam pool block reference", () => {
  assert.deepEqual(
    remapCopiedExamQuestionPools(
      [{ id: "pool", questionIds: ["old-a", "old-b"], drawCount: 1 }],
      new Map([
        ["old-a", "new-a"],
        ["old-b", "new-b"],
      ]),
    ),
    [{ id: "pool", questionIds: ["new-a", "new-b"], drawCount: 1 }],
  );
  assert.throws(
    () =>
      remapCopiedExamQuestionPools(
        [{ id: "pool", questionIds: ["missing"], drawCount: 1 }],
        new Map(),
      ),
    CourseContentCopyReferenceError,
  );
});

test("copied compositions retain tracks but require a target-course render", () => {
  const data = courseContentDataForCopy({
    mediaAssetId: "44444444-4444-4444-8444-444444444444",
    videoComposition: {
      version: 1,
      renderJobId: RENDER_JOB_ID,
      audioTracks: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          mediaAssetId: AUDIO_ID,
          timelineStartMs: 250,
          sourceStartMs: 500,
          sourceEndMs: 2_000,
          volume: 0.8,
        },
      ],
    },
  });
  assert.equal(data.videoComposition?.renderJobId, undefined);
  assert.equal(data.videoComposition?.audioTracks[0]?.mediaAssetId, AUDIO_ID);
  assert.equal(data.videoComposition?.audioTracks[0]?.timelineStartMs, 250);
});

test("copied lesson slugs are bounded and tied to the new lesson", () => {
  const slug = copiedLessonSlug("a".repeat(180), "ABCDEF12-rest");
  assert.equal(slug.length, 180);
  assert.ok(slug.endsWith("-abcdef12"));
});
