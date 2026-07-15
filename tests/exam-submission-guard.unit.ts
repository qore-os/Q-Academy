import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("initial exam submissions require a locked active non-expired exam attempt", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/lib/submissions.ts"),
    "utf8",
  );
  const start = source.indexOf("export async function createSubmissionAttemptInTransaction");
  const end = source.indexOf("export async function createSubmissionAttempt(", start);
  const action = source.slice(start, end);

  const access = action.indexOf("getCourseLearningAccess(transaction, input)");
  const block = action.indexOf("publishedSubmissionBlocks(accessibleLesson.lesson)");
  const attempt = action.indexOf(".from(assessmentAttempts)");
  const insert = action.indexOf(".insert(submissions)");
  assert.ok(access >= 0 && access < block && block < attempt && attempt < insert);
  assert.match(action, /accessibleLesson\.lesson\.type === "exam"/);
  assert.match(action, /latest\?\.status !== "revision"/);
  assert.match(action, /inArray\(assessmentAttempts\.status, \["in_progress", "submitted"\]\)/);
  assert.match(action, /isNotNull\(assessmentAttempts\.courseVersionId\)/);
  assert.match(action, /isNotNull\(assessmentAttempts\.definitionHash\)/);
  assert.match(action, /isNull\(assessmentAttempts\.finalizationReason\)/);
  assert.match(action, /gt\(assessmentAttempts\.deadlineAt, now\)/);
  assert.match(action, /\.for\("share", \{ of: assessmentAttempts \}\)/);
});

test("explicit exam submit requires every frozen manual task to be submitted", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/lib/exam-lifecycle.ts"),
    "utf8",
  );
  const guardStart = source.indexOf("async function requireSubmittedExamSupplementals");
  const guardEnd = source.indexOf("async function finalizeLockedAttempt", guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /block\.type === "submission"/);
  assert.match(guard, /block\.required/);
  assert.match(guard, /\.from\(submissions\)/);
  assert.match(guard, /\["open", "in_review", "approved"\]/);
  assert.doesNotMatch(guard, /"revision"/);

  const submitStart = source.indexOf("export async function submitExamAttempt");
  const submitEnd = source.indexOf("export async function getExamAttemptResult", submitStart);
  const submit = source.slice(submitStart, submitEnd);
  assert.ok(
    submit.indexOf("requireSubmittedExamSupplementals") <
      submit.indexOf("finalizeLockedAttempt"),
  );
});
