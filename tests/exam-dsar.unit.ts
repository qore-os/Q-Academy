import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeAssessmentSnapshot } from "../scripts/export-user-data";

test("exam DSAR snapshots recursively remove every solution-key field", () => {
  const exported = sanitizeAssessmentSnapshot({
    schemaVersion: 3,
    questions: [
      {
        blockId: "10000000-0000-4000-8000-000000000001",
        prompt: "Public prompt",
        correctOption: 1,
        correctOptions: [0, 2],
        acceptedAnswers: ["secret"],
        correctOrder: ["secret-a", "secret-b"],
        feedback: "secret feedback",
        presentationOrder: ["secret-b", "secret-a"],
        nested: {
          correct_option: 0,
          CORRECT_OPTIONS: [1],
          accepted_answers: ["nested-secret"],
          correct_order: ["nested-secret"],
          presentation_order: ["nested-secret"],
          safe: "retained",
        },
      },
    ],
  });
  const serialized = JSON.stringify(exported);
  assert.doesNotMatch(
    serialized,
    /accepted[_-]?answers|correct[_-]?(?:option|options|order)|feedback|presentation[_-]?order/i,
  );
  assert.match(serialized, /Public prompt/);
  assert.match(serialized, /retained/);
  assert.doesNotMatch(serialized, /secret/);
});
