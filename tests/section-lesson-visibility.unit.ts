import assert from "node:assert/strict";
import test from "node:test";

import {
  sectionLessonVisibilitySuccessMessage,
  sectionLessonVisibilityUpdateSchema,
} from "../src/lib/section-lesson-visibility";

test("section lesson visibility accepts only explicit supported states", () => {
  for (const visibility of ["visible", "draft", "coming_soon"] as const) {
    assert.deepEqual(sectionLessonVisibilityUpdateSchema.parse({ visibility }), {
      visibility,
    });
  }

  for (const input of [
    {},
    { visibility: "hidden" },
    { visibility: "published" },
    { visibility: "visible", sectionId: crypto.randomUUID() },
  ]) {
    assert.equal(sectionLessonVisibilityUpdateSchema.safeParse(input).success, false);
  }
});

test("section lesson visibility reports empty, singular and plural updates", () => {
  assert.equal(
    sectionLessonVisibilitySuccessMessage("visible", 0),
    "Die Sektion enthaelt keine Lektionen.",
  );
  assert.equal(
    sectionLessonVisibilitySuccessMessage("draft", 1),
    "1 Lektion auf Entwurf gesetzt.",
  );
  assert.equal(
    sectionLessonVisibilitySuccessMessage("coming_soon", 3),
    "3 Lektionen auf Erscheint bald gesetzt.",
  );
});
