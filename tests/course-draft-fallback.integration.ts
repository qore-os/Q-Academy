import assert from "node:assert/strict";
import test from "node:test";

import { fallbackCourseDraft } from "../src/lib/ai/course-draft";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const brief = {
  topic: "Secure AI workflows",
  targetAudience: "Operations teams",
  learningGoal: "Teams can plan and verify a secure workflow.",
  level: "beginner",
  tone: "practical",
  scope: "compact",
  categoryId: "",
} as const;

test("fallback course drafts localize all generated learner structures", () => {
  const titles = new Set<string>();
  const moduleTitles = new Set<string>();
  const assessmentTitles = new Set<string>();

  for (const locale of SUPPORTED_LOCALES) {
    const draft = fallbackCourseDraft(brief, locale);
    const finalLesson = draft.modules.at(-1)?.lessons.at(-1);
    const assessmentPage = finalLesson?.pages.at(-1);

    assert.equal(draft.modules.length, 2);
    assert.equal(finalLesson?.type, "quiz");
    assert.deepEqual(
      assessmentPage?.blocks.map((block) => block.type),
      ["multiple_choice", "true_false", "multi_select", "fill_blank", "ordering"],
    );
    titles.add(draft.title);
    moduleTitles.add(draft.modules[0].title);
    const firstAssessment = assessmentPage?.blocks[0];
    assert.equal(firstAssessment?.type, "multiple_choice");
    if (firstAssessment?.type === "multiple_choice") {
      assessmentTitles.add(firstAssessment.title);
    }
  }

  assert.equal(titles.size, SUPPORTED_LOCALES.length);
  assert.equal(moduleTitles.size, SUPPORTED_LOCALES.length);
  assert.equal(assessmentTitles.size, SUPPORTED_LOCALES.length);
});
