import assert from "node:assert/strict";
import test from "node:test";

import {
  courseModuleValuesForClone,
  courseWidgetValuesForClone,
  moduleValuesForClone,
  shouldCloneModuleContent,
} from "@/lib/course-clone-policy";

const organizationId = "10000000-0000-4000-8000-000000000001";
const sourceCourseId = "10000000-0000-4000-8000-000000000002";
const clonedCourseId = "10000000-0000-4000-8000-000000000003";
const sourceModuleId = "10000000-0000-4000-8000-000000000004";
const clonedModuleId = "10000000-0000-4000-8000-000000000005";
const targetCourseId = "10000000-0000-4000-8000-000000000006";

const association = {
  organizationId,
  courseId: sourceCourseId,
  moduleId: sourceModuleId,
  sortOrder: 2,
  indentLevel: 3,
  accessMode: "after_previous" as const,
  dripDays: 0,
  delayPendingState: "locked" as const,
  availableFrom: null,
  availableUntil: null,
  windowDefaultState: "locked" as const,
  windowState: "available" as const,
  requestAccessEnabled: false,
  isRequired: true,
};

test("clones link metadata and target without making the link required", () => {
  const values = moduleValuesForClone(organizationId, {
    title: "Vertiefungskurs",
    kind: "link",
    linkedCourseId: targetCourseId,
    description: "Direkter Uebergang zur Vertiefung",
    folder: "Verknuepfungen",
    isReusable: true,
    estimatedMinutes: 0,
  });
  const relation = courseModuleValuesForClone(
    organizationId,
    clonedCourseId,
    clonedModuleId,
    association,
    "link",
  );

  assert.deepEqual(values, {
    organizationId,
    title: "Vertiefungskurs",
    kind: "link",
    linkedCourseId: targetCourseId,
    description: "Direkter Uebergang zur Vertiefung",
    folder: "Verknuepfungen",
    isReusable: true,
    estimatedMinutes: 0,
  });
  assert.equal(relation.courseId, clonedCourseId);
  assert.equal(relation.moduleId, clonedModuleId);
  assert.equal(relation.indentLevel, 3);
  assert.equal(relation.isRequired, false);
  assert.equal(shouldCloneModuleContent("link"), false);
});

test("preserves learning and exam association semantics", () => {
  for (const kind of ["learning", "exam"] as const) {
    const relation = courseModuleValuesForClone(
      organizationId,
      clonedCourseId,
      clonedModuleId,
      association,
      kind,
    );

    assert.equal(relation.indentLevel, association.indentLevel);
    assert.equal(relation.isRequired, association.isRequired);
    assert.equal(shouldCloneModuleContent(kind), true);
  }
});

test("preserves the canonical private image identity when cloning widgets", () => {
  const mediaAssetId = "20000000-0000-4000-8000-000000000001";
  const values = courseWidgetValuesForClone(organizationId, clonedCourseId, {
    type: "image_link",
    sortOrder: 1,
    authorUserId: null,
    authorRole: null,
    authorDescription: null,
    title: null,
    text: null,
    linkUrl: "/academy/courses",
    imageUrl: `/api/media-assets/${mediaAssetId}/download`,
    mediaAssetId,
    altText: "Privates Kursbild",
  });
  assert.equal(values.organizationId, organizationId);
  assert.equal(values.courseId, clonedCourseId);
  assert.equal(values.mediaAssetId, mediaAssetId);
  assert.equal(
    values.imageUrl,
    `/api/media-assets/${mediaAssetId}/download`,
  );
});
