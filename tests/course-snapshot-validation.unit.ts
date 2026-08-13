import assert from "node:assert/strict";
import test from "node:test";

import { isValidPublishedCourseSnapshot } from "../src/lib/course-snapshot-validation";

const organizationId = "10000000-0000-4000-8000-000000000001";
const courseId = "20000000-0000-4000-8000-000000000002";
const moduleId = "30000000-0000-4000-8000-000000000003";
const lessonId = "50000000-0000-4000-8000-000000000005";
const linkModuleId = "60000000-0000-4000-8000-000000000006";
const linkedCourseId = "70000000-0000-4000-8000-000000000007";
const linkedVersionId = "80000000-0000-4000-8000-000000000008";
const capturedAt = "2027-01-01T09:00:00.000Z";
const widgetId = "90000000-0000-4000-8000-000000000009";
const mediaAssetId = "a0000000-0000-4000-8000-00000000000a";

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: lessonId,
    organizationId,
    moduleId,
    sortOrder: 0,
    status: "published",
    visibility: "visible",
    availableAt: null,
    dripDays: 0,
    unlockAfterPrevious: false,
    blocks: [],
    pages: [],
    ...overrides,
  };
}

function strictSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt,
    course: { id: courseId, organizationId, firstPublishedAt: capturedAt },
    widgets: [],
    modules: [
      {
        id: moduleId,
        organizationId,
        kind: "learning",
        sortOrder: 0,
        indentLevel: 0,
        accessMode: "visible",
        dripDays: 0,
        delayPendingState: "locked",
        availableFrom: null,
        availableUntil: null,
        windowDefaultState: "locked",
        windowState: "available",
        requestAccessEnabled: false,
        isRequired: true,
        lessons: [lesson()],
      },
    ],
    ...overrides,
  };
}

function linkModule(overrides: Record<string, unknown> = {}) {
  const base = strictSnapshot().modules[0];
  return {
    ...base,
    id: linkModuleId,
    kind: "link",
    indentLevel: 1,
    linkedCourseId,
    targetVersionIdAtCapture: linkedVersionId,
    isRequired: false,
    lessons: [],
    ...overrides,
  };
}

test("exact v6 access-policy snapshots validate recursively", () => {
  assert.equal(
    isValidPublishedCourseSnapshot(strictSnapshot(), courseId, organizationId),
    true,
  );
});

test("legacy and unknown snapshot versions fail closed", () => {
  for (const schemaVersion of [2, 3, 4, 5, 7]) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        { ...strictSnapshot(), schemaVersion },
        courseId,
        organizationId,
      ),
      false,
    );
  }
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...strictSnapshot(), accessPolicyVersion: 1 },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("v6 snapshots reject legacy section containers and lesson references", () => {
  const base = strictSnapshot();
  assert.equal(
    isValidPublishedCourseSnapshot(
      {
        ...base,
        modules: [{ ...base.modules[0], sections: [] }],
      },
      courseId,
      organizationId,
    ),
    false,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      {
        ...base,
        modules: [
          {
            ...base.modules[0],
            lessons: [lesson({ sectionId: null })],
          },
        ],
      },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("lesson release policy fields are required and bounded", () => {
  const base = strictSnapshot();
  for (const invalidLesson of [
    lesson({ dripDays: -1 }),
    lesson({ dripDays: 36_501 }),
    lesson({ dripDays: 0.5 }),
    lesson({ unlockAfterPrevious: undefined }),
    lesson({ availableAt: "invalid" }),
  ]) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        {
          ...base,
          modules: [{ ...base.modules[0], lessons: [invalidLesson] }],
        },
        courseId,
        organizationId,
      ),
      false,
    );
  }
});

test("published block revisions are optional but positive when present", () => {
  const base = strictSnapshot();
  const withBlocks = (blocks: unknown[]) => ({
    ...base,
    modules: [
      {
        ...base.modules[0],
        lessons: [lesson({ blocks })],
      },
    ],
  });
  assert.equal(
    isValidPublishedCourseSnapshot(
      withBlocks([{ revision: 2 }]),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      withBlocks([{ revision: 0 }]),
      courseId,
      organizationId,
    ),
    false,
  );
});

test("published video poster selections are versioned and validated", () => {
  const base = strictSnapshot();
  const withPoster = (videoPoster: unknown) => ({
    ...base,
    modules: [
      {
        ...base.modules[0],
        lessons: [
          lesson({ blocks: [{ type: "video", data: { videoPoster } }] }),
        ],
      },
    ],
  });
  assert.equal(
    isValidPublishedCourseSnapshot(
      withPoster({ version: 1, source: "frame", atMilliseconds: 1_000 }),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      withPoster({ version: 1, source: "frame", atMilliseconds: -1 }),
      courseId,
      organizationId,
    ),
    false,
  );
});

test("v6 snapshots bind private widget images to canonical media URLs", () => {
  const widget = {
    id: widgetId,
    organizationId,
    courseId,
    type: "image_link",
    sortOrder: 0,
    authorUserId: null,
    authorRole: null,
    authorDescription: null,
    title: null,
    text: null,
    linkUrl: "/academy/courses",
    imageUrl: `/api/media-assets/${mediaAssetId}/download`,
    mediaAssetId,
    altText: "Privates Kursbild",
    createdAt: capturedAt,
    updatedAt: capturedAt,
    author: null,
  };
  assert.equal(
    isValidPublishedCourseSnapshot(
      strictSnapshot({ widgets: [widget] }),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      strictSnapshot({
        widgets: [
          {
            ...widget,
            imageUrl:
              "/api/media-assets/b0000000-0000-4000-8000-00000000000b/download",
          },
        ],
      }),
      courseId,
      organizationId,
    ),
    false,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      strictSnapshot({ widgets: undefined }),
      courseId,
      organizationId,
    ),
    false,
  );
});

test("v6 snapshots accept content and link modules with captured targets", () => {
  const base = strictSnapshot();
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, modules: [...base.modules, linkModule()] },
      courseId,
      organizationId,
    ),
    true,
  );
});

test("link modules reject invalid targets, content, and required state", () => {
  const base = strictSnapshot();
  const invalidLinks = [
    linkModule({ linkedCourseId: null }),
    linkModule({ linkedCourseId: courseId }),
    linkModule({ targetVersionIdAtCapture: null }),
    linkModule({ lessons: [lesson({ moduleId: linkModuleId })] }),
    linkModule({ isRequired: true }),
  ];

  for (const invalidLink of invalidLinks) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        { ...base, modules: [...base.modules, invalidLink] },
        courseId,
        organizationId,
      ),
      false,
    );
  }
});

test("v6 outlines reject missing versions, invalid indentation, and content targets", () => {
  const base = strictSnapshot();
  for (const invalidSnapshot of [
    { ...base, moduleKindVersion: undefined },
    { ...base, courseOutlineVersion: undefined },
    {
      ...base,
      modules: base.modules.map((learningModule) => ({
        ...learningModule,
        kind: undefined,
      })),
    },
    {
      ...base,
      modules: base.modules.map((learningModule) => ({
        ...learningModule,
        indentLevel: 1,
      })),
    },
    { ...base, modules: [...base.modules, linkModule({ indentLevel: 2 })] },
    {
      ...base,
      modules: [{ ...base.modules[0], linkedCourseId }],
    },
  ]) {
    assert.equal(
      isValidPublishedCourseSnapshot(invalidSnapshot, courseId, organizationId),
      false,
    );
  }
});

test("tenant and parent mismatches fail closed", () => {
  const base = strictSnapshot();
  assert.equal(
    isValidPublishedCourseSnapshot(
      {
        ...base,
        modules: [
          {
            ...base.modules[0],
            lessons: [
              lesson({
                organizationId: "60000000-0000-4000-8000-000000000006",
              }),
            ],
          },
        ],
      },
      courseId,
      organizationId,
    ),
    false,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      {
        ...base,
        modules: [
          {
            ...base.modules[0],
            lessons: [
              lesson({
                moduleId: "70000000-0000-4000-8000-000000000007",
              }),
            ],
          },
        ],
      },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("duplicate ids and malformed module policy fail closed", () => {
  const duplicate = strictSnapshot();
  duplicate.modules.push(structuredClone(duplicate.modules[0]));
  assert.equal(
    isValidPublishedCourseSnapshot(duplicate, courseId, organizationId),
    false,
  );

  const base = strictSnapshot();
  for (const invalidModule of [
    { ...base.modules[0], dripDays: 0.5 },
    {
      ...base.modules[0],
      accessMode: "date_window",
      availableFrom: "invalid",
    },
  ]) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        { ...base, modules: [invalidModule] },
        courseId,
        organizationId,
      ),
      false,
    );
  }
});

test("video snapshots accept legacy policies and validate multiple cuts", () => {
  const withVideoPolicy = (videoPlayback: unknown) => {
    const base = strictSnapshot();
    return {
      ...base,
      modules: [
        {
          ...base.modules[0],
          lessons: [
            lesson({
              blocks: [
                {
                  type: "video",
                  revision: 1,
                  data: { videoPlayback },
                },
              ],
            }),
          ],
        },
      ],
    };
  };
  const legacy = {
    version: 1,
    trimStartMs: 1_000,
    trimEndMs: 10_000,
    completionMode: "required",
    minimumWatchPercent: 90,
    seeking: "watched_only",
  };
  const multipleCuts = {
    ...legacy,
    version: 2,
    removedSegments: [
      { startMs: 2_000, endMs: 3_000 },
      { startMs: 6_000, endMs: 7_500 },
    ],
  };
  const overlappingCuts = {
    ...multipleCuts,
    removedSegments: [
      { startMs: 2_000, endMs: 4_000 },
      { startMs: 3_000, endMs: 5_000 },
    ],
  };

  assert.equal(
    isValidPublishedCourseSnapshot(
      withVideoPolicy(legacy),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      withVideoPolicy(multipleCuts),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      withVideoPolicy(overlappingCuts),
      courseId,
      organizationId,
    ),
    false,
  );
});
