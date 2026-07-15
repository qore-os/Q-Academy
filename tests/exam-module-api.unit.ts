import assert from "node:assert/strict";
import test from "node:test";

import { publicApiContentBlock } from "../src/lib/api/public-content-block";
import {
  courseModuleOutlineSchema,
  moduleCreateSchema,
  moduleUpdateSchema,
} from "../src/lib/api/schemas";

const linkedCourseId = "10000000-0000-4000-8000-000000000001";
const moduleIds = [
  "20000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
  "40000000-0000-4000-8000-000000000004",
  "50000000-0000-4000-8000-000000000005",
];

test("module API creates learning by default and accepts explicit exams and links", () => {
  const common = {
    title: "Abschlusspruefung",
    description: null,
    folder: "Pruefungen",
    isReusable: true,
    estimatedMinutes: 30,
  };
  const learning = moduleCreateSchema.parse(common);
  const exam = moduleCreateSchema.parse({ ...common, kind: "exam" });
  const link = moduleCreateSchema.parse({
    ...common,
    kind: "link",
    linkedCourseId,
  });
  assert.equal(learning.kind, "learning");
  assert.equal(exam.kind, "exam");
  assert.equal(link.kind, "link");
  assert.equal(link.linkedCourseId, linkedCourseId);
});

test("only link modules accept and require a target course", () => {
  const common = {
    title: "Kursverknuepfung",
    description: null,
    folder: "Allgemein",
    isReusable: true,
    estimatedMinutes: 1,
  };
  assert.equal(
    moduleCreateSchema.safeParse({ ...common, kind: "link" }).success,
    false,
  );
  assert.equal(
    moduleCreateSchema.safeParse({ ...common, linkedCourseId }).success,
    false,
  );
  assert.equal(
    moduleCreateSchema.safeParse({
      ...common,
      kind: "exam",
      linkedCourseId,
    }).success,
    false,
  );
});

test("module kind is immutable through the module update contract", () => {
  assert.equal(moduleUpdateSchema.safeParse({ title: "Neuer Titel" }).success, true);
  assert.equal(
    moduleUpdateSchema.safeParse({ linkedCourseId }).success,
    true,
  );
  assert.equal(moduleUpdateSchema.safeParse({ kind: "exam" }).success, false);
});

test("course outline accepts contiguous nesting up to three levels", () => {
  const result = courseModuleOutlineSchema.safeParse({
    items: moduleIds.map((moduleId, index) => ({
      moduleId,
      sortOrder: index,
      indentLevel: [0, 1, 2, 1][index],
    })),
  });
  assert.equal(result.success, true);
});

test("course outline rejects duplicate modules, gaps, and invalid indent jumps", () => {
  const invalidOutlines = [
    [
      { moduleId: moduleIds[0], sortOrder: 0, indentLevel: 1 },
    ],
    [
      { moduleId: moduleIds[0], sortOrder: 0, indentLevel: 0 },
      { moduleId: moduleIds[1], sortOrder: 1, indentLevel: 2 },
    ],
    [
      { moduleId: moduleIds[0], sortOrder: 0, indentLevel: 0 },
      { moduleId: moduleIds[0], sortOrder: 1, indentLevel: 1 },
    ],
    [
      { moduleId: moduleIds[0], sortOrder: 0, indentLevel: 0 },
      { moduleId: moduleIds[1], sortOrder: 2, indentLevel: 1 },
    ],
  ];

  for (const items of invalidOutlines) {
    assert.equal(courseModuleOutlineSchema.safeParse({ items }).success, false);
  }
});

test("content block API representation removes every assessment answer key", () => {
  const block = publicApiContentBlock({
    id: "10000000-0000-4000-8000-000000000001",
    lessonId: "20000000-0000-4000-8000-000000000002",
    pageId: null,
    type: "multi_select",
    title: "Mehrfachauswahl",
    sortOrder: 0,
    required: true,
    revision: 1,
    style: { width: "content", alignment: "left", surface: "plain" },
    data: {
      prompt: "Welche Antworten sind richtig?",
      options: ["A", "B", "C"],
      correctOption: 0,
      correctOptions: [0, 2],
      acceptedAnswers: ["A"],
      presentationOrder: ["secret"],
      feedback: "Interne Musterloesung",
    },
  });
  assert.deepEqual(block.data, {
    prompt: "Welche Antworten sind richtig?",
    options: ["A", "B", "C"],
  });
  const serialized = JSON.stringify(block);
  for (const secret of [
    "correctOption",
    "correctOptions",
    "acceptedAnswers",
    "presentationOrder",
    "feedback",
    "Interne Musterloesung",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});
