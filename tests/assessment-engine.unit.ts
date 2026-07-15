import assert from "node:assert/strict";
import test from "node:test";

import type { AssessmentQuestionSnapshot } from "../src/db/schema";
import {
  buildAssessmentQuestionSnapshot,
  compatibleAssessmentSnapshots,
  evaluateAssessmentAnswer,
  publicAssessmentBlockData,
  redactAssessmentAnswerKeys,
  type AssessmentBlockSource,
  type CurrentAssessmentDefinition,
} from "../src/lib/assessment-engine";
import {
  assessmentSubmissionSchema,
  validateAssessmentContentBlock,
} from "../src/lib/api/schemas";

const blockId = "10000000-0000-4000-8000-000000000001";

function question(
  type: AssessmentBlockSource["type"],
  data: AssessmentBlockSource["data"],
) {
  return buildAssessmentQuestionSnapshot({
    id: blockId,
    type,
    title: "Testfrage",
    required: true,
    data,
  });
}

test("multi-select evaluation requires one exact unique option set", () => {
  const snapshot = question("multi_select", {
    prompt: "Welche Antworten gehoeren dazu?",
    options: ["Analyse", "Planung", "Umsetzung"],
    correctOptions: [0, 2],
  });
  assert.equal(snapshot?.type, "multi_select");
  if (!snapshot || snapshot.type !== "multi_select") return;

  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      selectedOptions: [2, 0],
    })?.correct,
    true,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      selectedOptions: [0],
    })?.correct,
    false,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      selectedOptions: [0, 0],
    }),
    null,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, { blockId, selectedOption: 0 }),
    null,
  );
});

test("fill-blank evaluation normalizes unicode and whitespace on the server", () => {
  const snapshot = question("fill_blank", {
    prompt: "Ergaenze den Fachbegriff.",
    acceptedAnswers: ["KI-Strategie", "AI strategy"],
    caseSensitive: false,
  });
  assert.equal(snapshot?.type, "fill_blank");
  if (!snapshot || snapshot.type !== "fill_blank") return;

  const correct = evaluateAssessmentAnswer(snapshot, {
    blockId,
    textAnswer: "  ki-strategie  ",
  });
  assert.equal(correct?.correct, true);
  assert.deepEqual(correct?.answerSnapshot, { textAnswer: "ki-strategie" });
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      textAnswer: "Strategie",
    })?.correct,
    false,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, { blockId, textAnswer: "   " }),
    null,
  );
});

test("ordering snapshots grade stable item IDs without exposing target order", () => {
  const correctOptions = ["Analysieren", "Planen", "Umsetzen"];
  const snapshot = question("ordering", {
    prompt: "Sortiere die Arbeitsschritte.",
    options: correctOptions,
  });
  assert.equal(snapshot?.type, "ordering");
  if (!snapshot || snapshot.type !== "ordering") return;

  const presentationOrder = [
    ...snapshot.correctOrder.slice(1),
    snapshot.correctOrder[0],
  ];
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      orderedItemIds: snapshot.correctOrder,
    })?.correct,
    true,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      orderedItemIds: presentationOrder,
    })?.correct,
    false,
  );
  assert.equal(
    evaluateAssessmentAnswer(snapshot, {
      blockId,
      orderedItemIds: [
        snapshot.correctOrder[0],
        snapshot.correctOrder[0],
        snapshot.correctOrder[1],
      ],
    }),
    null,
  );

  const publicData = publicAssessmentBlockData({
    id: blockId,
    type: "ordering",
    title: "Sortieren",
    required: true,
    data: {
      prompt: "Sortiere die Arbeitsschritte.",
      options: correctOptions,
      presentationOrder,
      feedback: "Interne Erklaerung",
    },
  });
  assert.deepEqual(publicData.options, ["Planen", "Umsetzen", "Analysieren"]);
  assert.deepEqual(publicData.optionIds, presentationOrder);
  assert.equal("feedback" in publicData, false);
});

test("answer-key redaction covers every advanced assessment secret recursively", () => {
  const redacted = redactAssessmentAnswerKeys({
    correctOption: 1,
    correctOptions: [0, 2],
    acceptedAnswers: ["secret"],
    correctOrder: [2, 0, 1],
    feedback: "secret feedback",
    nested: [{ prompt: "public", correctOptions: [1] }],
  });
  assert.deepEqual(redacted, { nested: [{ prompt: "public" }] });
});

test("snapshot v3 preserves v1/v2 identity only for compatible legacy questions", () => {
  const choice = question("multiple_choice", {
    prompt: "Welche Antwort ist richtig?",
    options: ["A", "B"],
    correctOption: 0,
  });
  assert.ok(choice);
  const legacyCompatible: CurrentAssessmentDefinition = {
    schemaVersion: 3,
    passingScore: 100,
    maxAttempts: null,
    shuffleQuestions: false,
    questions: [choice as AssessmentQuestionSnapshot],
  };
  assert.deepEqual(
    compatibleAssessmentSnapshots(legacyCompatible).map(
      (snapshot) => snapshot.schemaVersion,
    ),
    [3, 2, 1],
  );

  const advanced = question("multi_select", {
    prompt: "Welche Antworten sind richtig?",
    options: ["A", "B"],
    correctOptions: [0],
  });
  assert.ok(advanced);
  assert.deepEqual(
    compatibleAssessmentSnapshots({
      ...legacyCompatible,
      questions: [advanced as AssessmentQuestionSnapshot],
    }).map((snapshot) => snapshot.schemaVersion),
    [3],
  );
});

test("assessment submission schema rejects mixed and duplicate answer shapes", () => {
  const base = {
    courseId: "10000000-0000-4000-8000-000000000010",
    lessonId: "10000000-0000-4000-8000-000000000011",
  };
  assert.equal(
    assessmentSubmissionSchema.safeParse({
      ...base,
      answers: [{ blockId, selectedOptions: [0, 2] }],
    }).success,
    true,
  );
  assert.equal(
    assessmentSubmissionSchema.safeParse({
      ...base,
      answers: [
        { blockId, selectedOptions: [0, 0] },
      ],
    }).success,
    false,
  );
  assert.equal(
    assessmentSubmissionSchema.safeParse({
      ...base,
      answers: [{ blockId, selectedOption: 0, textAnswer: "injected" }],
    }).success,
    false,
  );
});

test("course block API validates every advanced answer key", () => {
  assert.equal(
    validateAssessmentContentBlock({
      type: "multi_select",
      data: {
        prompt: "Welche Antworten sind richtig?",
        options: ["A", "B", "C"],
        correctOptions: [0, 2],
      },
    }).success,
    true,
  );
  assert.equal(
    validateAssessmentContentBlock({
      type: "multi_select",
      data: {
        prompt: "Welche Antworten sind richtig?",
        options: ["A", "B"],
        correctOptions: [2],
      },
    }).success,
    false,
  );
  assert.equal(
    validateAssessmentContentBlock({
      type: "fill_blank",
      data: {
        prompt: "Ergaenze die Luecke.",
        acceptedAnswers: ["Strategie", "strategie"],
      },
    }).success,
    false,
  );
  assert.equal(
    validateAssessmentContentBlock({
      type: "ordering",
      data: {
        prompt: "Sortiere die Schritte.",
        options: ["Planen", "Planen"],
      },
    }).success,
    false,
  );
});
