import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  examAnswerMap,
  examAnswersForSubmission,
  examDraftAnswers,
  formatExamDuration,
  remainingExamSeconds,
  type ExamQuestionPayload,
} from "@/lib/exam-client-model";

const questions: ExamQuestionPayload[] = [
  {
    blockId: "11111111-1111-4111-8111-111111111111",
    type: "multiple_choice",
    title: null,
    required: true,
    data: { prompt: "Frage", options: ["A", "B"] },
  },
  {
    blockId: "22222222-2222-4222-8222-222222222222",
    type: "ordering",
    title: null,
    required: true,
    data: {
      prompt: "Sortieren",
      options: ["Zwei", "Eins"],
      optionIds: ["a".repeat(64), "b".repeat(64)],
    },
  },
  {
    blockId: "33333333-3333-4333-8333-333333333333",
    type: "submission",
    title: "Praxisabgabe",
    required: true,
    data: { prompt: "Transfer dokumentieren" },
  },
];

test("exam submission payload contains every automatic answer but no supplemental block", () => {
  const answers = examAnswerMap([
    { blockId: questions[0].blockId, selectedOption: 1 },
    {
      blockId: questions[1].blockId,
      orderedItemIds: ["a".repeat(64), "b".repeat(64)],
    },
  ]);
  const submitted = examAnswersForSubmission(questions, answers);
  assert.equal(submitted?.length, 2);
  assert.equal(
    submitted?.some((answer) => answer.blockId === questions[2].blockId),
    false,
  );
  assert.deepEqual(examDraftAnswers(questions, answers), submitted);
});

test("exam submission stays incomplete until every automatic question is valid", () => {
  assert.equal(
    examAnswersForSubmission(
      questions,
      examAnswerMap([{ blockId: questions[0].blockId, selectedOption: 0 }]),
    ),
    null,
  );
});

test("countdown uses the supplied server-calibrated clock", () => {
  assert.equal(
    remainingExamSeconds(
      "2026-07-11T10:01:01.000Z",
      Date.parse("2026-07-11T10:00:00.100Z"),
    ),
    61,
  );
  assert.equal(
    remainingExamSeconds(
      "2026-07-11T10:00:00.000Z",
      Date.parse("2026-07-11T10:00:01.000Z"),
    ),
    0,
  );
  assert.equal(formatExamDuration(null), "Ohne Zeitlimit");
  assert.equal(formatExamDuration(5_400), "1 Std. 30 Min.");
});

test("lesson reader keeps exam definitions out of the pre-start render payload", () => {
  const data = readFileSync("src/lib/data.ts", "utf8");
  const page = readFileSync(
    "src/app/(member)/academy/courses/[slug]/learn/[lessonId]/page.tsx",
    "utf8",
  );
  const panel = readFileSync("src/components/academy/exam-lesson.tsx", "utf8");

  assert.match(data, /lesson\.type === "exam"\s*\? \[\]/);
  assert.match(data, /questionCount: selectedQuestionCount/);
  assert.match(data, /pendingAttempt: assessment\.pendingAttempt/);
  assert.match(data, /latestAttempt: assessment\.latestAttempt/);
  assert.match(page, /data\.lesson\.type === "exam" && data\.exam/);
  assert.match(page, /<ExamLesson/);
  assert.match(page, /submissions=\{data\.submissions\}/);
  assert.doesNotMatch(
    panel.slice(
      panel.indexOf("export type ExamLessonSummary"),
      panel.indexOf("type SaveStatus"),
    ),
    /questionIds|questionPools|assessmentSnapshot|blocks|pages/,
  );
});

test("exam UI starts explicitly, serializes autosave, and reuses manual submissions", () => {
  const panel = readFileSync("src/components/academy/exam-lesson.tsx", "utf8");
  assert.match(panel, /onClick=\{\(\) => void startExam\(\)\}/);
  assert.match(panel, /saveQueueRef\.current/);
  assert.match(panel, /saveGenerationRef\.current/);
  assert.match(panel, /keepalive/);
  assert.match(panel, /expectedRevision: revisionRef\.current/);
  assert.match(panel, /error\.status === 409/);
  assert.match(panel, /serverClockOffsetRef\.current/);
  assert.match(panel, /visibilitychange/);
  assert.match(panel, /<SubmissionBlock/);
  assert.match(panel, /requiredSubmissionsReady/);
  assert.match(panel, /orderingAnswer/);
  assert.doesNotMatch(panel, /correctOrder\?\.join/);
});

test("exam UI exposes accessible choices, bounded timer announcements, and guarded navigation", () => {
  const panel = readFileSync("src/components/academy/exam-lesson.tsx", "utf8");
  const guard = readFileSync(
    "src/components/academy/exam-navigation-guard.tsx",
    "utf8",
  );
  const page = readFileSync(
    "src/app/(member)/academy/courses/[slug]/learn/[lessonId]/page.tsx",
    "utf8",
  );
  const data = readFileSync("src/lib/data.ts", "utf8");

  assert.match(panel, /type="radio"/);
  assert.match(panel, /name=\{`exam-question-\$\{question\.blockId\}`\}/);
  assert.doesNotMatch(panel, /aria-pressed=\{selected === optionIndex\}/);
  assert.match(panel, /role="timer"\s+aria-live="off"/);
  assert.match(panel, /remainingSeconds === 60/);
  assert.match(panel, /questionPanelRef\.current\?\.focus\(\)/);
  assert.match(panel, /useExamNavigationLockController/);
  assert.match(guard, /data-exam-navigation-locked="true"/);
  assert.match(page, /<ExamNavigationBoundary/);
  assert.match(page, /<ExamGuardedLink/);
  assert.match(data, /getActiveExamContentLock/);
  assert.match(data, /navigationLock:/);
});
