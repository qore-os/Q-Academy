import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitLessonFeedback } from "../src/lib/feedback-policy";

test("lesson feedback is available for interactive and read-only lessons", () => {
  assert.equal(canSubmitLessonFeedback({ canOpen: true }), true);
});

test("lesson feedback fails closed for locked, hidden, or missing lessons", () => {
  assert.equal(canSubmitLessonFeedback({ canOpen: false }), false);
  assert.equal(canSubmitLessonFeedback(null), false);
  assert.equal(canSubmitLessonFeedback(undefined), false);
});
