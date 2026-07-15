import assert from "node:assert/strict";
import test from "node:test";

import type {
  AssessmentQuestionSnapshot,
  ExamDraftAnswer,
} from "../src/db/schema";
import {
  assessmentResultIsReleased,
  assessmentReviewIsReleased,
  legacyCompatibleAssessmentResultIsReleased,
  pendingAssessmentAttemptView,
} from "../src/lib/assessment-release-policy";
import { activeExamBlocksContent } from "../src/lib/exam-content-access-policy";
import { conflictingExamAttemptForStart } from "../src/lib/exam-attempt-start-policy";
import {
  evaluateExamDraftAnswers,
  ExamDraftValidationError,
} from "../src/lib/exam-answer-policy";
import {
  examDefinitionHash,
  examLifecycleConfigurationErrors,
  freezeExamQuestionSelection,
  type ExamLifecycleConfiguration,
} from "../src/lib/exam-lifecycle-policy";
import type { CurrentAssessmentDefinition } from "../src/lib/assessment-engine";
import { examAttemptPresentationView } from "../src/lib/exam-lifecycle-view";

const questionIds = Array.from(
  { length: 6 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const definition: CurrentAssessmentDefinition = {
  schemaVersion: 3,
  passingScore: 60,
  maxAttempts: 3,
  shuffleQuestions: true,
  questions: questionIds.map(
    (blockId, index) =>
      ({
        blockId,
        title: `Question ${index + 1}`,
        prompt: `Choose answer ${index + 1}.`,
        required: true,
        feedback: `Internal feedback ${index + 1}`,
        type: "multiple_choice",
        options: ["A", "B", "C"],
        correctOption: index % 3,
      }) satisfies AssessmentQuestionSnapshot,
  ),
};

const configuration: ExamLifecycleConfiguration = {
  durationSeconds: 900,
  questionPools: [
    { id: "core", questionIds: questionIds.slice(0, 5), drawCount: 2 },
  ],
  resultReleaseMode: "after_deadline",
  reviewReleaseMode: "manual",
  contentAccessMode: "block_academy",
};

test("definition identity stays stable while selection remains secret-keyed", () => {
  const input = {
    lessonId: "30000000-0000-4000-8000-000000000001",
    definition,
    configuration,
  };
  const firstHash = examDefinitionHash(input);
  assert.equal(firstHash, examDefinitionHash(input));
  assert.notEqual(
    firstHash,
    examDefinitionHash({
      ...input,
      configuration: { ...configuration, durationSeconds: 1200 },
    }),
  );
  assert.notEqual(
    firstHash,
    examDefinitionHash({
      ...input,
      definition: { ...definition, passingScore: 80 },
    }),
  );

  const frozen = freezeExamQuestionSelection({
    definition,
    configuration,
    definitionHash: firstHash,
    userId: "40000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    selectionSecret: "selection-secret-alpha-32-characters",
  });
  assert.equal(frozen.questionPools[0]?.selectedQuestionIds.length, 2);
  assert.equal(frozen.questionOrder.length, 3);
  assert.ok(frozen.questionOrder.includes(questionIds[5]));
  assert.deepEqual(
    frozen,
    freezeExamQuestionSelection({
      definition,
      configuration,
      definitionHash: firstHash,
      userId: "40000000-0000-4000-8000-000000000001",
      attemptNumber: 1,
      selectionSecret: "selection-secret-alpha-32-characters",
    }),
  );
  assert.notDeepEqual(
    frozen,
    freezeExamQuestionSelection({
      definition,
      configuration,
      definitionHash: firstHash,
      userId: "40000000-0000-4000-8000-000000000001",
      attemptNumber: 1,
      selectionSecret: "selection-secret-bravo-32-characters",
    }),
  );
});

test("exam configuration rejects deadline release without a deadline", () => {
  assert.deepEqual(
    examLifecycleConfigurationErrors({
      configuration: { ...configuration, durationSeconds: null },
      questionIds,
    }),
    ["Eine Ergebnisfreigabe nach Frist benoetigt eine Pruefungsdauer."],
  );
});

test("active exam content locks preserve only the permitted learning surface", () => {
  const lock = {
    attemptId: "50000000-0000-4000-8000-000000000001",
    courseId: "60000000-0000-4000-8000-000000000001",
    lessonId: "70000000-0000-4000-8000-000000000001",
    mode: "block_academy" as const,
    deadlineAt: null,
  };
  assert.equal(
    activeExamBlocksContent(lock, {
      courseId: lock.courseId,
      lessonId: lock.lessonId,
    }),
    false,
  );
  assert.equal(
    activeExamBlocksContent(lock, {
      courseId: "60000000-0000-4000-8000-000000000002",
      lessonId: "70000000-0000-4000-8000-000000000002",
    }),
    true,
  );
  assert.equal(
    activeExamBlocksContent(
      { ...lock, mode: "block_course" },
      {
        courseId: "60000000-0000-4000-8000-000000000002",
        lessonId: "70000000-0000-4000-8000-000000000002",
      },
    ),
    false,
  );
});

test("exam starts enforce existing locks and at most one non-allow attempt", () => {
  const blockCourse = {
    id: "80000000-0000-4000-8000-000000000001",
    courseId: "81000000-0000-4000-8000-000000000001",
    lessonId: "82000000-0000-4000-8000-000000000001",
    contentAccessMode: "block_course" as const,
  };
  assert.equal(
    conflictingExamAttemptForStart([blockCourse], {
      courseId: blockCourse.courseId,
      lessonId: "82000000-0000-4000-8000-000000000002",
      contentAccessMode: "allow",
    })?.id,
    blockCourse.id,
  );
  assert.equal(
    conflictingExamAttemptForStart([blockCourse], {
      courseId: "81000000-0000-4000-8000-000000000002",
      lessonId: "82000000-0000-4000-8000-000000000002",
      contentAccessMode: "allow",
    }),
    undefined,
  );
  assert.equal(
    conflictingExamAttemptForStart([blockCourse], {
      courseId: "81000000-0000-4000-8000-000000000002",
      lessonId: "82000000-0000-4000-8000-000000000002",
      contentAccessMode: "block_course",
    })?.id,
    blockCourse.id,
  );
  const academyLock = {
    ...blockCourse,
    id: "80000000-0000-4000-8000-000000000002",
    contentAccessMode: "block_academy" as const,
  };
  assert.equal(
    conflictingExamAttemptForStart([academyLock], {
      courseId: "81000000-0000-4000-8000-000000000099",
      lessonId: "82000000-0000-4000-8000-000000000099",
      contentAccessMode: "allow",
    })?.id,
    academyLock.id,
  );
});

test("autosave accepts incomplete valid answers but rejects invalid draft data", () => {
  const validAnswer = {
    blockId: questionIds[0],
    selectedOption: 0,
  } as const;
  assert.equal(
    evaluateExamDraftAnswers({
      definition,
      questionOrder: questionIds.slice(0, 2),
      answers: [validAnswer],
      requireComplete: false,
    }).length,
    1,
  );
  const invalidCases: Array<{
    answers: ExamDraftAnswer[];
    expectedCode: ExamDraftValidationError["code"];
  }> = [
    {
      answers: [{ blockId: questionIds[5], selectedOption: 0 }],
      expectedCode: "unknown_question",
    },
    {
      answers: [{ blockId: questionIds[0], selectedOptions: [0] }],
      expectedCode: "invalid_answer",
    },
    { answers: [validAnswer, validAnswer], expectedCode: "duplicate_answer" },
  ];
  for (const { answers, expectedCode } of invalidCases) {
    assert.throws(
      () =>
        evaluateExamDraftAnswers({
          definition,
          questionOrder: questionIds.slice(0, 2),
          answers,
          requireComplete: false,
        }),
      (error: unknown) =>
        error instanceof ExamDraftValidationError &&
        error.code === expectedCode,
    );
  }
});

test("started exam presentation separates auto questions and supplemental submissions", () => {
  const view = examAttemptPresentationView({
    questionOrder: [questionIds[0]],
    presentation: [
      {
        blockId: questionIds[0],
        type: "multiple_choice",
        title: "Auto",
        required: true,
        data: {
          prompt: "Welche Antwort ist richtig?",
          options: ["A", "B"],
          correctOption: 0,
          feedback: "secret",
        },
      },
      {
        blockId: questionIds[1],
        type: "submission",
        title: "Transfer",
        required: true,
        data: { prompt: "Reiche deine begruendete Loesung ein." },
      },
    ],
  });
  assert.deepEqual(view.questions.map((block) => block.blockId), [questionIds[0]]);
  assert.deepEqual(view.supplementalBlocks, [
    {
      blockId: questionIds[1],
      type: "submission",
      title: "Transfer",
      required: true,
      data: { prompt: "Reiche deine begruendete Loesung ein." },
    },
  ]);
  assert.equal("correctOption" in view.questions[0].data, false);
  assert.equal("feedback" in view.questions[0].data, false);
});

test("result and solution review remain hidden until their separate releases", () => {
  const pending = { resultReleasedAt: null, reviewReleasedAt: null };
  assert.equal(assessmentResultIsReleased(pending), false);
  assert.equal(assessmentReviewIsReleased(pending), false);
  assert.equal(
    legacyCompatibleAssessmentResultIsReleased({
      definitionHash: "a".repeat(64),
      resultReleasedAt: null,
    }),
    false,
  );
  assert.equal(
    legacyCompatibleAssessmentResultIsReleased({
      definitionHash: null,
      resultReleasedAt: null,
    }),
    true,
  );
  assert.equal(
    assessmentReviewIsReleased({ reviewReleasedAt: new Date() }),
    true,
  );
  const pendingAttempt = pendingAssessmentAttemptView({
    id: "90000000-0000-4000-8000-000000000001",
    attemptNumber: 2,
    status: "graded",
    submittedAt: new Date("2026-07-11T10:00:00Z"),
    deadlineAt: new Date("2026-07-11T10:30:00Z"),
    resultReleaseMode: "manual",
    reviewReleaseMode: "after_result",
    resultReleasedAt: null,
    reviewReleasedAt: null,
  });
  assert.deepEqual(Object.keys(pendingAttempt ?? {}).sort(), [
    "attemptNumber",
    "deadlineAt",
    "id",
    "resultReleaseMode",
    "resultReleasedAt",
    "reviewReleaseMode",
    "reviewReleasedAt",
    "status",
    "submittedAt",
  ]);
  assert.equal("score" in (pendingAttempt ?? {}), false);
  assert.equal("passed" in (pendingAttempt ?? {}), false);
  assert.equal("questions" in (pendingAttempt ?? {}), false);
  assert.equal("draftAnswers" in (pendingAttempt ?? {}), false);
  assert.equal("questionOrder" in (pendingAttempt ?? {}), false);
});
