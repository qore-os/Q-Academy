import assert from "node:assert/strict";
import test from "node:test";

import { courseCreateSchema, courseUpdateSchema } from "@/lib/api/schemas";
import {
  COURSE_COVER_PRESETS,
  DEFAULT_COURSE_COVER,
  courseCoverImageProps,
  courseCoverMediaAssetId,
  safeCourseCoverSource,
  isCourseCoverPreset,
} from "@/lib/course-cover";

const mediaAssetId = "10000000-0000-4000-8000-000000000001";
const mediaCover = `/api/media-assets/${mediaAssetId}/download`;

test("course cover policy accepts only local public images and session media", () => {
  for (const source of [
    "/images/courses/foundations.webp",
    "/images/tenant/course-cover-2.AVIF",
    mediaCover,
  ]) {
    assert.equal(safeCourseCoverSource(`  ${source}  `), source);
  }
  assert.equal(courseCoverMediaAssetId(mediaCover), mediaAssetId);
  assert.equal(
    courseCoverMediaAssetId("/images/courses/foundations.webp"),
    null,
  );
});

test("course cover editor exposes the four curated local presets", () => {
  assert.deepEqual(COURSE_COVER_PRESETS, [
    "/images/courses/foundations.webp",
    "/images/courses/workflows.webp",
    "/images/courses/prompts.webp",
    "/images/courses/responsible-ai.webp",
  ]);
  assert.equal(isCourseCoverPreset(COURSE_COVER_PRESETS[2]), true);
  assert.equal(isCourseCoverPreset("/images/tenant/custom.webp"), false);
});

test("course cover policy rejects remote, credentialed and ambiguous sources", () => {
  const invalid = [
    "",
    "https://images.example.test/cover.webp",
    "https://user:secret@images.example.test/cover.webp",
    "//images.example.test/cover.webp",
    "data:image/png;base64,AA==",
    "javascript:alert(1)",
    "/images/../secrets.png",
    "/images/%2e%2e/secrets.png",
    "/images/courses/cover.svg",
    "/images/courses/cover.webp?version=1",
    "/images\\courses\\cover.webp",
    `/api/media-assets/${mediaAssetId}/download?disposition=inline`,
    "/api/media-assets/not-a-uuid/download",
    "/api/v1/media-assets/10000000-0000-4000-8000-000000000001/download",
  ];
  for (const source of invalid) {
    assert.equal(safeCourseCoverSource(source), null, source);
  }
});

test("course cover image props fall back safely and bypass optimization for authenticated media", () => {
  assert.deepEqual(courseCoverImageProps("https://127.0.0.1/private"), {
    src: DEFAULT_COURSE_COVER,
    unoptimized: false,
  });
  assert.deepEqual(courseCoverImageProps(mediaCover), {
    src: mediaCover,
    unoptimized: true,
  });
});

test("course API schemas normalize clearing and reject unsafe cover URLs", () => {
  const base = {
    title: "Sicherer Kurs",
    shortDescription: "Eine ausreichend lange Kurzbeschreibung.",
    description: "Eine ausreichend lange Kursbeschreibung.",
    status: "draft" as const,
    difficulty: "Grundlagen",
    estimatedMinutes: 45,
    certificateEnabled: true,
    featured: false,
    visibleInCatalog: true,
    showProgressPercentage: true,
    learningGoals: [],
    authorIds: [],
  };

  assert.equal(
    courseCreateSchema.parse({ ...base, coverImage: "  " }).coverImage,
    null,
  );
  assert.equal(
    courseCreateSchema.parse({ ...base, coverImage: mediaCover }).coverImage,
    mediaCover,
  );
  assert.equal(
    courseCreateSchema.safeParse({
      ...base,
      coverImage: "https://example.test/cover.webp",
    }).success,
    false,
  );
  assert.equal(
    courseUpdateSchema.safeParse({ coverImage: "//example.test/cover.webp" })
      .success,
    false,
  );
});
