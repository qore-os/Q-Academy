import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COURSE_LIFECYCLE_PRESERVED_DATA,
  courseLifecycleTransition,
} from "../src/lib/course-lifecycle";

test("course archive and restore transitions never imply physical deletion", () => {
  assert.equal(courseLifecycleTransition("draft", "archive"), "archived");
  assert.equal(courseLifecycleTransition("published", "archive"), "archived");
  assert.equal(courseLifecycleTransition("archived", "archive"), null);
  assert.equal(courseLifecycleTransition("archived", "restore"), "draft");
  assert.equal(courseLifecycleTransition("draft", "restore"), null);
  assert.deepEqual(COURSE_LIFECYCLE_PRESERVED_DATA, [
    "course_versions",
    "enrollments",
    "assessment_attempts",
    "submissions",
  ]);

  const actions = readFileSync("src/lib/course-lifecycle-actions.ts", "utf8");
  assert.doesNotMatch(actions, /\.delete\((?:courses|courseVersions|enrollments|assessmentAttempts|submissions)\)/);
  assert.match(actions, /"course\.archived"/);
  assert.match(actions, /"course\.restored"/);
});
