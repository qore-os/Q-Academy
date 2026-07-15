import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_EXAM_POOL_ID,
  deriveAdminExamQuestionPools,
} from "@/lib/exam-admin-policy";

test("blank random selection keeps every automatic exam question unpooled", () => {
  assert.deepEqual(
    deriveAdminExamQuestionPools({
      questionIds: ["question-a", "question-b"],
      drawCount: null,
    }),
    { ok: true, questionPools: [] },
  );
});

test("admin random selection derives one pool from server question ids", () => {
  assert.deepEqual(
    deriveAdminExamQuestionPools({
      questionIds: ["question-b", "question-a", "question-c"],
      drawCount: 2,
    }),
    {
      ok: true,
      questionPools: [
        {
          id: ADMIN_EXAM_POOL_ID,
          questionIds: ["question-b", "question-a", "question-c"],
          drawCount: 2,
        },
      ],
    },
  );
});

test("admin pool derivation rejects impossible or oversized selections", () => {
  for (const drawCount of [0, 3, 1.5]) {
    assert.equal(
      deriveAdminExamQuestionPools({
        questionIds: ["question-a", "question-b"],
        drawCount,
      }).ok,
      false,
    );
  }
  assert.equal(
    deriveAdminExamQuestionPools({ questionIds: [], drawCount: 1 }).ok,
    false,
  );
  assert.equal(
    deriveAdminExamQuestionPools({
      questionIds: Array.from({ length: 101 }, (_, index) => `q-${index}`),
      drawCount: 10,
    }).ok,
    false,
  );
});

test("exam assessment mutation derives pools after transactional course and shared-module ACL", () => {
  const source = readFileSync("src/lib/course-builder-actions.ts", "utf8");
  const start = source.indexOf(
    "export async function updateCourseLessonAssessmentAction",
  );
  assert.notEqual(start, -1);
  const action = source.slice(start);
  const acl = action.indexOf("requireSharedModuleContentPermission(tx");
  const questionRead = action.indexOf(".from(contentBlocks)");
  const derivation = action.indexOf("deriveAdminExamQuestionPools");
  const mutation = action.indexOf("updateLessonWithTitleSync(tx");

  assert.ok(acl >= 0 && acl < questionRead);
  assert.ok(questionRead < derivation && derivation < mutation);
  assert.doesNotMatch(action, /formData\.get\([^)]*questionIds/);
  assert.match(action, /target\.lessonType !== "exam"/);
  assert.match(action, /target\.moduleKind !== "exam"/);
  assert.match(action, /examLifecycleConfigurationErrors/);
});

test("course builder gates lifecycle fields to exam lessons and keeps quiz basics", () => {
  const source = readFileSync("src/components/admin/course-builder.tsx", "utf8");
  assert.match(source, /selectedModuleIsExam && selectedLesson\?\.type === "exam"/);
  assert.match(source, /name="passingScore"/);
  assert.match(source, /name="maxAttempts"/);
  assert.match(source, /name="shuffleQuestions"/);
  assert.match(source, /selectedLessonIsExam \? \(/);
  for (const field of [
    "examDurationMinutes",
    "randomQuestionCount",
    "examResultReleaseMode",
    "examReviewReleaseMode",
    "examContentAccessMode",
  ]) {
    assert.match(source, new RegExp(`name="${field}"`));
  }
});
