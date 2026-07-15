import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  availableExamOperationActions,
  examOperationStatus,
} from "../src/lib/exam-operations-policy";

const graded = {
  status: "graded" as const,
  resultReleaseMode: "manual" as const,
  reviewReleaseMode: "manual" as const,
  resultReleasedAt: null,
  reviewReleasedAt: null,
};

test("admin exam operation policy exposes only valid lifecycle commands", () => {
  assert.equal(examOperationStatus(graded), "result_manual");
  assert.deepEqual(availableExamOperationActions(graded), ["release_result"]);
  const reviewPending = {
    ...graded,
    resultReleasedAt: new Date("2026-07-11T10:00:00Z"),
  };
  assert.equal(examOperationStatus(reviewPending), "review_manual");
  assert.deepEqual(availableExamOperationActions(reviewPending), [
    "release_review",
  ]);
  assert.deepEqual(
    availableExamOperationActions({
      ...graded,
      status: "in_progress",
    }),
    ["finalize"],
  );
  assert.deepEqual(
    availableExamOperationActions({
      ...graded,
      resultReleaseMode: "after_deadline",
    }),
    [],
  );
});

test("staff release and finalization recheck course ACL inside the transaction", () => {
  const source = readFileSync(
    new URL("../src/lib/exam-lifecycle.ts", import.meta.url),
    "utf8",
  );
  for (const [start, end] of [
    ["export async function releaseExamAttempt", "export async function finalizeExamAttemptByAdministrator"],
    ["export async function finalizeExamAttemptByAdministrator", "export async function processExamLifecycleDeadlines"],
  ] as const) {
    const body = source.slice(source.indexOf(start), source.indexOf(end));
    assert.ok(body.includes("requireCoursePermissionInTransaction"));
    assert.ok(
      body.indexOf("requireCoursePermissionInTransaction") <
        body.indexOf("settleLockedAttempt"),
    );
  }
});

test("admin exam list is tenant scoped and filters current course edit access", () => {
  const source = readFileSync(
    new URL("../src/lib/admin/exam-operations.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /eq\(assessmentAttempts\.organizationId, actor\.organizationId\)/,
  );
  assert.match(source, /coursePermissionMapForUser/);
  assert.match(source, /coursePermissionAllows/);
  assert.match(source, /"edit"/);
  assert.doesNotMatch(source, /assessmentSnapshot|draftAnswers|questionPresentation/);
});
