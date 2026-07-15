import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/lib/exam-lifecycle.ts", import.meta.url),
  "utf8",
);

function functionBody(start: string, end: string) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

test("browser-owned attempt operations revalidate current course access", () => {
  const accessGuard = functionBody(
    "async function requireAttemptUserCourseAccess",
    "function evaluatedAnswers",
  );
  assert.match(accessGuard, /getCourseLearningAccess/);
  assert.match(accessGuard, /if \(!access\)/);
  assert.match(accessGuard, /404/);

  for (const [start, end] of [
    ["export async function getExamAttempt", "export async function saveExamAttemptDraft"],
    ["export async function saveExamAttemptDraft", "export async function submitExamAttempt"],
    ["export async function submitExamAttempt", "export async function getExamAttemptResult"],
    ["export async function getExamAttemptResult", "export async function releaseExamAttempt"],
  ] as const) {
    assert.match(
      functionBody(start, end),
      /requireAttemptUserCourseAccess/,
    );
  }
});

test("pending-release attempts are returned without opening another attempt", () => {
  const startBody = functionBody(
    "export async function startOrResumeExamAttempt",
    "export async function getExamAttempt",
  );
  assert.match(startBody, /pendingReleaseAttempt/);
  assert.match(startBody, /pendingRelease: true/);
  assert.ok(
    startBody.indexOf("pendingReleaseAttempt") <
      startBody.indexOf("maxAttempts"),
  );
});

test("attempt public view omits scores and definition hash before release", () => {
  const publicView = functionBody("function publicAttempt", "async function lockedAttempt");
  assert.doesNotMatch(publicView, /score:|passed:|correctCount:|definitionHash:/);
  assert.match(publicView, /supplementalBlocks|presentation/);
});

test("learner attempt reads respect current lesson locks while frozen active attempts remain finishable", () => {
  const start = source.indexOf("async function requireAttemptUserCourseAccess");
  const end = source.indexOf("function evaluatedAnswers", start);
  const guard = source.slice(start, end);
  assert.match(guard, /access\.lessons\.get\(attempt\.lessonId\)/);
  assert.match(guard, /currentLesson\?\.access\.canInteract/);
  assert.match(guard, /attempt\.status === "in_progress"/);
  assert.match(guard, /attempt\.status === "submitted"/);
  assert.match(guard, /!currentLesson\?\.access\.canInteract && !activeFrozenAttempt/);
});
