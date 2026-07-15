import assert from "node:assert/strict";
import test from "node:test";

import {
  courseCreateSchema,
  courseUpdateSchema,
} from "../src/lib/api/schemas";
import {
  courseAuthorIdsSchema,
  courseLearningGoalsSchema,
} from "../src/lib/course-information";

const baseCourse = {
  title: "Sicherer Informationskurs",
  shortDescription: "Ein vollstaendiger Kurs fuer den Create-Vertrag.",
  description: "Dieser Kurs prueft Defaults ohne die PATCH-Semantik zu beeinflussen.",
};

test("course create applies information defaults explicitly", () => {
  assert.deepEqual(courseCreateSchema.parse(baseCourse), {
    ...baseCourse,
    status: "draft",
    difficulty: "Grundlagen",
    estimatedMinutes: 60,
    certificateEnabled: true,
    featured: false,
    visibleInCatalog: true,
    showProgressPercentage: true,
    notifyMembersOnModuleRelease: false,
    learningGoals: [],
    authorIds: [],
  });
});

test("course PATCH returns only keys supplied by the caller", () => {
  assert.deepEqual(
    courseUpdateSchema.parse({ title: "Nur dieser Titel wird geaendert" }),
    { title: "Nur dieser Titel wird geaendert" },
  );
  assert.deepEqual(
    courseUpdateSchema.parse({
      visibleInCatalog: false,
      learningGoals: ["Den sicheren PATCH-Vertrag anwenden."],
    }),
    {
      visibleInCatalog: false,
      learningGoals: ["Den sicheren PATCH-Vertrag anwenden."],
    },
  );
});

test("course information collections reject duplicates and unsafe text", () => {
  assert.equal(
    courseLearningGoalsSchema.safeParse([
      "Praxis anwenden",
      "  PRAXIS   ANWENDEN ",
    ]).success,
    false,
  );
  assert.equal(
    courseLearningGoalsSchema.safeParse(["Unsicher\u0000"]).success,
    false,
  );
  const authorId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    courseAuthorIdsSchema.safeParse([authorId, authorId]).success,
    false,
  );
});
