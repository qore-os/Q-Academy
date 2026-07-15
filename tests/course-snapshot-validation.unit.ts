import assert from "node:assert/strict";
import test from "node:test";

import { isValidPublishedCourseSnapshot } from "../src/lib/course-snapshot-validation";

const organizationId = "10000000-0000-4000-8000-000000000001";
const courseId = "20000000-0000-4000-8000-000000000002";
const moduleId = "30000000-0000-4000-8000-000000000003";
const sectionId = "40000000-0000-4000-8000-000000000004";
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
    sectionId,
    status: "published",
    visibility: "visible",
    availableAt: null,
    blocks: [],
    pages: [],
    ...overrides,
  };
}

function strictSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 3,
    accessPolicyVersion: 1,
    capturedAt,
    course: { id: courseId, organizationId, firstPublishedAt: capturedAt },
    modules: [
      {
        id: moduleId,
        organizationId,
        sortOrder: 0,
        accessMode: "visible",
        dripDays: 0,
        delayPendingState: "locked",
        availableFrom: null,
        availableUntil: null,
        windowDefaultState: "locked",
        windowState: "available",
        requestAccessEnabled: false,
        lessons: [],
        sections: [
          {
            id: sectionId,
            organizationId,
            moduleId,
            status: "published",
            visibility: "visible",
            lessons: [lesson()],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function strictV4Snapshot(overrides: Record<string, unknown> = {}) {
  const base = strictSnapshot();
  return {
    ...base,
    schemaVersion: 4,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    modules: base.modules.map((learningModule) => ({
      ...learningModule,
      kind: "learning",
      indentLevel: 0,
    })),
    ...overrides,
  };
}

function strictV5Snapshot(overrides: Record<string, unknown> = {}) {
  return {
    ...strictV4Snapshot(),
    schemaVersion: 5,
    widgets: [],
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
    sections: [],
    ...overrides,
  };
}

test("v2 and pre-policy v3 snapshots remain readable", () => {
  const legacyModule = {
    id: moduleId,
    sortOrder: 0,
    dripDays: 0,
    isRequired: true,
    lessons: [],
    sections: [
      {
        id: sectionId,
        moduleId,
        status: "published",
        lessons: [
          {
            id: lessonId,
            moduleId,
            sectionId,
            status: "published",
            blocks: [],
            pages: [],
          },
        ],
      },
    ],
  };
  for (const schemaVersion of [2, 3]) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        {
          schemaVersion,
          capturedAt,
          course: { id: courseId, organizationId },
          modules: [legacyModule],
        },
        courseId,
        organizationId,
      ),
      true,
    );
  }
});

test("strict access-policy snapshots validate recursively", () => {
  assert.equal(
    isValidPublishedCourseSnapshot(
      strictSnapshot(),
      courseId,
      organizationId,
    ),
    true,
  );
});

test("published block revisions are optional for legacy data but positive when present", () => {
  const base = strictV4Snapshot();
  const withRevision = {
    ...base,
    modules: base.modules.map((learningModule) => ({
      ...learningModule,
      sections: learningModule.sections.map((section) => ({
        ...section,
        lessons: [lesson({ blocks: [{ revision: 2 }] })],
      })),
    })),
  };
  assert.equal(
    isValidPublishedCourseSnapshot(withRevision, courseId, organizationId),
    true,
  );
  const invalidRevision = {
    ...base,
    modules: base.modules.map((learningModule) => ({
      ...learningModule,
      sections: learningModule.sections.map((section) => ({
        ...section,
        lessons: [lesson({ blocks: [{ revision: 0 }] })],
      })),
    })),
  };
  assert.equal(
    isValidPublishedCourseSnapshot(
      invalidRevision,
      courseId,
      organizationId,
    ),
    false,
  );
});

test("unknown schema and access policy versions fail closed", () => {
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...strictV5Snapshot(), schemaVersion: 6 },
      courseId,
      organizationId,
    ),
    false,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...strictSnapshot(), accessPolicyVersion: 2 },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("v5 snapshots bind private widget images to their canonical media URL", () => {
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
      strictV5Snapshot({ widgets: [widget] }),
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      strictV5Snapshot({
        widgets: [
          {
            ...widget,
            imageUrl: "/api/media-assets/b0000000-0000-4000-8000-00000000000b/download",
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
      { ...strictV5Snapshot(), widgets: undefined },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("v4 snapshots accept content and link modules with a captured target", () => {
  const base = strictV4Snapshot();
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, modules: [...base.modules, linkModule()] },
      courseId,
      organizationId,
    ),
    true,
  );
});

test("v4 link modules reject invalid targets, content, and required state", () => {
  const base = strictV4Snapshot();
  const invalidLinks = [
    linkModule({ linkedCourseId: null }),
    linkModule({ linkedCourseId: courseId }),
    linkModule({ targetVersionIdAtCapture: null }),
    linkModule({ lessons: [lesson({ moduleId: linkModuleId, sectionId: null })] }),
    linkModule({ sections: base.modules[0].sections }),
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

test("v4 outlines reject invalid indentation and targets on content modules", () => {
  const base = strictV4Snapshot();
  const invalidModuleSets = [
    base.modules.map((learningModule) => ({
      ...learningModule,
      indentLevel: 1,
    })),
    [
      ...base.modules,
      linkModule({ indentLevel: 2 }),
    ],
    [
      {
        ...base.modules[0],
        linkedCourseId,
      },
    ],
  ];

  for (const modules of invalidModuleSets) {
    assert.equal(
      isValidPublishedCourseSnapshot(
        { ...base, modules },
        courseId,
        organizationId,
      ),
      false,
    );
  }
});

test("module kind snapshots are strict while legacy snapshots default to learning", () => {
  const base = strictSnapshot();
  assert.equal(
    isValidPublishedCourseSnapshot(
      {
        ...base,
        moduleKindVersion: 1,
        modules: base.modules.map((learningModule) => ({
          ...learningModule,
          kind: "learning",
        })),
      },
      courseId,
      organizationId,
    ),
    true,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, moduleKindVersion: 1 },
      courseId,
      organizationId,
    ),
    false,
  );
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, moduleKindVersion: 2 },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("tenant and parent-child mismatches fail closed", () => {
  const base = strictSnapshot();
  const learningModule = structuredClone(base.modules[0]);
  learningModule.sections[0].organizationId =
    "60000000-0000-4000-8000-000000000006";
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, modules: [learningModule] },
      courseId,
      organizationId,
    ),
    false,
  );

  const wrongParent = structuredClone(base.modules[0]);
  wrongParent.sections[0].lessons[0].moduleId =
    "70000000-0000-4000-8000-000000000007";
  assert.equal(
    isValidPublishedCourseSnapshot(
      { ...base, modules: [wrongParent] },
      courseId,
      organizationId,
    ),
    false,
  );
});

test("duplicate ids and malformed policy dates fail closed", () => {
  const duplicate = strictSnapshot();
  duplicate.modules.push(structuredClone(duplicate.modules[0]));
  assert.equal(
    isValidPublishedCourseSnapshot(
      duplicate,
      courseId,
      organizationId,
    ),
    false,
  );

  const valid = strictSnapshot();
  const invalidModule: Record<string, unknown> = {
    ...valid.modules[0],
    accessMode: "date_window",
    availableFrom: "invalid",
  };
  const invalidDate: Record<string, unknown> = {
    ...valid,
    modules: [invalidModule],
  };
  assert.equal(
    isValidPublishedCourseSnapshot(
      invalidDate,
      courseId,
      organizationId,
    ),
    false,
  );
});

test("video snapshots accept legacy policies and validate multiple cuts", () => {
  const withVideoPolicy = (videoPlayback: unknown) => {
    const base = strictV4Snapshot();
    return {
      ...base,
      modules: base.modules.map((learningModule) => ({
        ...learningModule,
        sections: learningModule.sections.map((section) => ({
          ...section,
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
        })),
      })),
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
