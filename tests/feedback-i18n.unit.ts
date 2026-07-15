import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("course feedback exposes localized member result copy", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getMainPageDictionary(locale).academy.courseDetail;
    assert.ok(copy.feedbackError.length > 0);
    assert.ok(copy.feedbackSuccess.length > 0);
  }
});

test("member feedback actions return stable result codes", () => {
  const actions = readFileSync("src/lib/feedback-actions.ts", "utf8");
  const memberActions = actions.slice(
    actions.indexOf("export async function submitCourseFeedbackAction"),
    actions.indexOf("export async function reviewFeedbackAction"),
  );

  assert.match(memberActions, /memberCode: "submitInvalid"/);
  assert.match(memberActions, /memberCode: "submitFailed"/);
  assert.match(memberActions, /memberCode: "submitted"/);
});

test("course feedback never renders raw action text", () => {
  const component = readFileSync(
    "src/components/academy/course-feedback.tsx",
    "utf8",
  );
  assert.match(component, /copy\.feedbackError/);
  assert.match(component, /copy\.feedbackSuccess/);
  assert.doesNotMatch(component, />\{state\.error\}</);
  assert.doesNotMatch(component, />\{state\.success\}</);
});
