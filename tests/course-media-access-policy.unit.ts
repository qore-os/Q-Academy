import assert from "node:assert/strict";
import test from "node:test";

import type { CourseVersionSnapshot } from "@/db/schema";
import {
  accessibleLessonsReferenceMediaAsset,
  lessonReferencesMediaAsset,
} from "@/lib/media/course-media-access-policy";

type SnapshotLesson =
  CourseVersionSnapshot["modules"][number]["lessons"][number];

const mediaAssetId = "10000000-0000-4000-8000-000000000001";

function lesson(overrides: Partial<SnapshotLesson> = {}): SnapshotLesson {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    moduleId: "60000000-0000-4000-8000-000000000006",
    sectionId: null,
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
                style: { width: "content", alignment: "left", surface: "plain" },
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
