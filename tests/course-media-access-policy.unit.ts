import assert from "node:assert/strict";
import test from "node:test";

import type { CourseVersionSnapshot } from "@/db/schema";
import {
  accessibleLessonsReferenceMediaAsset,
  accessibleLessonsReferenceVideoComposition,
  lessonReferencesMediaAsset,
} from "@/lib/media/course-media-access-policy";

type SnapshotLesson =
  CourseVersionSnapshot["modules"][number]["lessons"][number];

const mediaAssetId = "10000000-0000-4000-8000-000000000001";

function lesson(overrides: Partial<SnapshotLesson> = {}): SnapshotLesson {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    organizationId: "70000000-0000-4000-8000-000000000007",
    moduleId: "60000000-0000-4000-8000-000000000006",
    title: "Medienlektion",
    slug: "medienlektion",
    summary: null,
    type: "lesson",
    durationMinutes: 10,
    passingScore: 100,
    maxAttempts: null,
    shuffleQuestions: false,
    examDurationSeconds: null,
    examQuestionPools: [],
    examResultReleaseMode: "immediate",
    examReviewReleaseMode: "after_result",
    examContentAccessMode: "allow",
    sortOrder: 0,
    status: "published",
    visibility: "visible",
    unlockAfterPrevious: false,
    dripDays: 0,
    availableAt: null,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    pages: [],
    blocks: [
      {
        id: "30000000-0000-4000-8000-000000000003",
        lessonId: "20000000-0000-4000-8000-000000000002",
        pageId: null,
        type: "image",
        title: "Privates Bild",
        sortOrder: 0,
        required: false,
        style: { width: "content", alignment: "left", surface: "plain" },
        data: { mediaAssetId },
      },
    ],
    ...overrides,
  };
}

test("lesson media references include direct blocks and page galleries", () => {
  assert.equal(lessonReferencesMediaAsset(lesson(), mediaAssetId), true);
  assert.equal(
    lessonReferencesMediaAsset(
      lesson({
        blocks: [],
        pages: [
          {
            id: "40000000-0000-4000-8000-000000000004",
            lessonId: "20000000-0000-4000-8000-000000000002",
            title: "Galerieseite",
            titleSyncedWithLesson: false,
            slug: "galerieseite",
            sortOrder: 0,
            status: "published",
            revision: 1,
            layoutWidth: "standard",
            backgroundTone: "plain",
            contentSpacing: "comfortable",
            createdAt: "2026-07-11T09:00:00.000Z",
            updatedAt: "2026-07-11T09:00:00.000Z",
            blocks: [
              {
                id: "50000000-0000-4000-8000-000000000005",
                lessonId: "20000000-0000-4000-8000-000000000002",
                pageId: "40000000-0000-4000-8000-000000000004",
                type: "gallery",
                title: null,
                sortOrder: 0,
                required: false,
                style: {
                  width: "content",
                  alignment: "left",
                  surface: "plain",
                },
                data: {
                  gallery: {
                    version: 1,
                    layout: "grid",
                    items: [
                      {
                        source: `/api/media-assets/${mediaAssetId}/download`,
                        alt: "Galeriebild",
                        caption: "",
                        mediaAssetId,
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      }),
      mediaAssetId,
    ),
    true,
  );
});

test("lesson media references include a custom uploaded video poster", () => {
  const videoAssetId = "90000000-0000-4000-8000-000000000009";
  assert.equal(
    lessonReferencesMediaAsset(
      lesson({
        blocks: [
          {
            id: "30000000-0000-4000-8000-000000000003",
            lessonId: "20000000-0000-4000-8000-000000000002",
            pageId: null,
            type: "video",
            title: "Video mit Poster",
            sortOrder: 0,
            required: false,
            style: { width: "content", alignment: "left", surface: "plain" },
            data: {
              mediaAssetId: videoAssetId,
              videoPoster: {
                version: 1,
                source: "upload",
                mediaAssetId,
              },
            },
          },
        ],
      }),
      mediaAssetId,
    ),
    true,
  );
});

test("locked lesson media cannot be downloaded through course access", () => {
  const locked = { lesson: lesson(), access: { accessible: false } };
  assert.equal(
    accessibleLessonsReferenceMediaAsset([locked], mediaAssetId),
    false,
  );

  const open = { lesson: lesson(), access: { accessible: true } };
  assert.equal(
    accessibleLessonsReferenceMediaAsset([locked, open], mediaAssetId),
    true,
  );
});

test("read-only lesson media remains readable while draft-page media stays hidden", () => {
  const readOnly = { lesson: lesson(), access: { accessible: true } };
  assert.equal(
    accessibleLessonsReferenceMediaAsset([readOnly], mediaAssetId),
    true,
  );

  const draftPageOnly = lesson({
    blocks: [],
    pages: [
      {
        id: "70000000-0000-4000-8000-000000000007",
        lessonId: "20000000-0000-4000-8000-000000000002",
        title: "Entwurf",
        titleSyncedWithLesson: false,
        slug: "entwurf",
        sortOrder: 0,
        status: "draft",
        revision: 1,
        layoutWidth: "standard",
        backgroundTone: "plain",
        contentSpacing: "comfortable",
        createdAt: "2026-07-11T09:00:00.000Z",
        updatedAt: "2026-07-11T09:00:00.000Z",
        blocks: [
          {
            id: "80000000-0000-4000-8000-000000000008",
            lessonId: "20000000-0000-4000-8000-000000000002",
            pageId: "70000000-0000-4000-8000-000000000007",
            type: "file",
            title: "Entwurfsdatei",
            sortOrder: 0,
            required: false,
            style: { width: "content", alignment: "left", surface: "plain" },
            data: { mediaAssetId },
          },
        ],
      },
    ],
  });
  assert.equal(
    accessibleLessonsReferenceMediaAsset(
      [{ lesson: draftPageOnly, access: { accessible: true } }],
      mediaAssetId,
    ),
    false,
  );
});

test("composition derivatives require the exact job inside an accessible lesson", () => {
  const videoId = "90000000-0000-4000-8000-000000000009";
  const blockId = "80000000-0000-4000-8000-000000000008";
  const jobId = "70000000-0000-4000-8000-000000000007";
  const compositionBlock = {
    id: blockId,
    lessonId: "20000000-0000-4000-8000-000000000002",
    pageId: null,
    type: "video",
    title: "Vertrauliche Mischung",
    sortOrder: 0,
    required: false,
    style: { width: "content", alignment: "left", surface: "plain" } as const,
    data: {
      mediaAssetId: videoId,
      videoComposition: {
        version: 1 as const,
        renderJobId: jobId,
        audioTracks: [
          {
            id: "60000000-0000-4000-8000-000000000006",
            mediaAssetId: "50000000-0000-4000-8000-000000000005",
            timelineStartMs: 0,
            sourceStartMs: 0,
            sourceEndMs: 1_000,
            volume: 1,
          },
        ],
      },
    },
  };
  const openPrimary = {
    lesson: lesson({
      blocks: [
        {
          ...compositionBlock,
          id: "40000000-0000-4000-8000-000000000004",
          data: { mediaAssetId: videoId },
        },
      ],
    }),
    access: { accessible: true },
  };
  const lockedComposition = {
    lesson: lesson({ blocks: [compositionBlock] }),
    access: { accessible: false },
  };
  const input = { renderJobId: jobId, primaryAssetId: videoId, blockId };

  assert.equal(
    accessibleLessonsReferenceVideoComposition(
      [openPrimary, lockedComposition],
      input,
    ),
    false,
  );
  assert.equal(
    accessibleLessonsReferenceVideoComposition(
      [openPrimary, { ...lockedComposition, access: { accessible: true } }],
      input,
    ),
    true,
  );
});

test("composition derivatives ignore blocks on draft pages", () => {
  const videoId = "90000000-0000-4000-8000-000000000009";
  const blockId = "80000000-0000-4000-8000-000000000008";
  const jobId = "70000000-0000-4000-8000-000000000007";
  const page = {
    id: "40000000-0000-4000-8000-000000000004",
    lessonId: "20000000-0000-4000-8000-000000000002",
    title: "Mischung",
    titleSyncedWithLesson: false,
    slug: "mischung",
    sortOrder: 0,
    status: "draft" as const,
    revision: 1,
    layoutWidth: "standard" as const,
    backgroundTone: "plain" as const,
    contentSpacing: "comfortable" as const,
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z",
    blocks: [
      {
        id: blockId,
        lessonId: "20000000-0000-4000-8000-000000000002",
        pageId: "40000000-0000-4000-8000-000000000004",
        type: "video",
        title: "Mischung",
        sortOrder: 0,
        required: false,
        style: {
          width: "content",
          alignment: "left",
          surface: "plain",
        } as const,
        data: {
          mediaAssetId: videoId,
          videoComposition: {
            version: 1 as const,
            renderJobId: jobId,
            audioTracks: [
              {
                id: "60000000-0000-4000-8000-000000000006",
                mediaAssetId: "50000000-0000-4000-8000-000000000005",
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 1_000,
                volume: 1,
              },
            ],
          },
        },
      },
    ],
  };
  const input = { renderJobId: jobId, primaryAssetId: videoId, blockId };
  assert.equal(
    accessibleLessonsReferenceVideoComposition(
      [
        {
          lesson: lesson({ blocks: [], pages: [page] }),
          access: { accessible: true },
        },
      ],
      input,
    ),
    false,
  );
  assert.equal(
    accessibleLessonsReferenceVideoComposition(
      [
        {
          lesson: lesson({
            blocks: [],
            pages: [{ ...page, status: "published" }],
          }),
          access: { accessible: true },
        },
      ],
      input,
    ),
    true,
  );
});
