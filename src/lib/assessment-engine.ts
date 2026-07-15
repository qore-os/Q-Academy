import { createHash } from "node:crypto";

import type {
  AssessmentAnswerSnapshot,
  AssessmentAttemptSnapshot,
  AssessmentChoiceQuestionSnapshot,
  AssessmentQuestionSnapshot,
  ContentBlockData,
} from "@/db/schema";

export const assessmentQuestionTypes = [
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
] as const;

export type AssessmentQuestionType = (typeof assessmentQuestionTypes)[number];

export type AssessmentAnswerInput =
  | { blockId: string; selectedOption: number }
  | { blockId: string; selectedOptions: number[] }
  | { blockId: string; textAnswer: string }
  | { blockId: string; orderedItemIds: string[] };

export type AssessmentBlockSource = {
  id: string;
  type: string;
  title: string | null;
  required: boolean;
  data: ContentBlockData;
};

export type CurrentAssessmentDefinition = Extract<
  AssessmentAttemptSnapshot,
  { schemaVersion: 3 }
>;

const answerKeyFields = new Set([
  "correctOption",
  "correctOptions",
  "acceptedAnswers",
  "correctOrder",
  "presentationOrder",
  "feedback",
]);

export function isAssessmentQuestionType(
  value: string,
): value is AssessmentQuestionType {
  return assessmentQuestionTypes.some((type) => type === value);
}

export function redactAssessmentAnswerKeys<T>(value: T): T {
  if (value instanceof Date || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactAssessmentAnswerKeys(entry)) as T;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !answerKeyFields.has(key))
      .map(([key, entry]) => [key, redactAssessmentAnswerKeys(entry)]),
  ) as T;
}

export function normalizeFillBlankAnswer(
  value: string,
  caseSensitive: boolean,
) {
  const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  return caseSensitive ? normalized : normalized.toLocaleLowerCase("de-DE");
}

export function orderingItemId(blockId: string, item: string) {
  return createHash("sha256")
    .update("q-academy:ordering-item:v1\0")
    .update(blockId)
    .update("\0")
    .update(item.normalize("NFKC").trim().replace(/\s+/g, " "))
    .digest("hex");
}

function normalizedStrings(
  value: unknown,
  input: { min: number; max: number; itemMax: number },
) {
  if (
    !Array.isArray(value) ||
    value.length < input.min ||
    value.length > input.max
  ) {
    return null;
  }
  const strings = value.map((entry) =>
    typeof entry === "string" ? entry.trim() : "",
  );
  if (
    strings.some((entry) => !entry || entry.length > input.itemMax) ||
    new Set(
      strings.map((entry) => normalizeFillBlankAnswer(entry, false)),
    ).size !== strings.length
  ) {
    return null;
  }
  return strings;
}

function commonQuestion(source: AssessmentBlockSource) {
  const prompt = source.data.prompt?.trim();
  const feedback = source.data.feedback?.trim() || null;
  if (!prompt || prompt.length < 3 || prompt.length > 2_000) return null;
  if (feedback && feedback.length > 2_000) return null;
  return {
    blockId: source.id,
    title: source.title,
    prompt,
    required: source.required,
    feedback,
  };
}

export function buildAssessmentQuestionSnapshot(
  source: AssessmentBlockSource,
): AssessmentQuestionSnapshot | null {
  if (!isAssessmentQuestionType(source.type)) return null;
  const common = commonQuestion(source);
  if (!common) return null;

  if (source.type === "fill_blank") {
    const acceptedAnswers = normalizedStrings(source.data.acceptedAnswers, {
      min: 1,
      max: 20,
      itemMax: 500,
    });
    const caseSensitive = source.data.caseSensitive === true;
    if (
      !acceptedAnswers ||
      new Set(
        acceptedAnswers.map((answer) =>
          normalizeFillBlankAnswer(answer, caseSensitive),
        ),
      ).size !== acceptedAnswers.length
    ) {
      return null;
    }
    return {
      ...common,
      type: source.type,
      acceptedAnswers,
      caseSensitive,
    };
  }

  const options = normalizedStrings(source.data.options, {
    min: 2,
    max: 20,
    itemMax: 1_000,
  });
  if (!options) return null;

  if (source.type === "ordering") {
    return {
      ...common,
      type: source.type,
      correctOrder: options.map((option) => orderingItemId(source.id, option)),
    };
  }

  if (source.type === "multi_select") {
    const correctOptions = source.data.correctOptions;
    if (
      !Array.isArray(correctOptions) ||
      !correctOptions.length ||
      correctOptions.some(
        (option) =>
          !Number.isInteger(option) || option < 0 || option >= options.length,
      ) ||
      new Set(correctOptions).size !== correctOptions.length
    ) {
      return null;
    }
    return {
      ...common,
      type: source.type,
      options,
      correctOptions: [...correctOptions].sort((left, right) => left - right),
    };
  }

  const correctOption = source.data.correctOption;
  if (
    (source.type === "true_false" && options.length !== 2) ||
    !Number.isInteger(correctOption) ||
    Number(correctOption) < 0 ||
    Number(correctOption) >= options.length
  ) {
    return null;
  }
  return {
    ...common,
    type: source.type,
    options,
    correctOption: Number(correctOption),
  };
}

export function publicAssessmentBlockData(source: AssessmentBlockSource) {
  const redacted = redactAssessmentAnswerKeys(source.data);
  if (source.type !== "ordering") return redacted;
  const correctOptions = normalizedStrings(source.data.options, {
    min: 2,
    max: 20,
    itemMax: 1_000,
  });
  const correctOrder = correctOptions?.map((option) =>
    orderingItemId(source.id, option),
  );
  const presentation = source.data.presentationOrder;
  const validPresentation =
    correctOptions &&
    correctOrder &&
    Array.isArray(presentation) &&
    correctOrder.length === presentation.length &&
    presentation.every(
      (id) => typeof id === "string" && /^[0-9a-f]{64}$/.test(id),
    ) &&
    new Set(presentation).size === presentation.length &&
    correctOrder.every((id) => presentation.includes(id)) &&
    presentation.some((id, index) => id !== correctOrder[index]);
  return {
    ...redacted,
    options: validPresentation
      ? presentation.map(
          (id) => correctOptions[correctOrder.indexOf(id)],
        )
      : [],
    optionIds: validPresentation ? presentation : [],
  };
}

export function compatibleAssessmentSnapshots(
  definition: CurrentAssessmentDefinition,
): AssessmentAttemptSnapshot[] {
  const snapshots: AssessmentAttemptSnapshot[] = [definition];
  if (
    definition.questions.some(
      (question) =>
        question.type !== "multiple_choice" && question.type !== "true_false",
    )
  ) {
    return snapshots;
  }
  const choiceQuestions =
    definition.questions as AssessmentChoiceQuestionSnapshot[];
  snapshots.push({
    schemaVersion: 2,
    passingScore: definition.passingScore,
    maxAttempts: definition.maxAttempts,
    shuffleQuestions: definition.shuffleQuestions,
    questions: choiceQuestions,
  });
  if (
    definition.passingScore === 100 &&
    definition.maxAttempts === null &&
    !definition.shuffleQuestions &&
    choiceQuestions.every(
      (question) =>
        question.type === "multiple_choice" && question.feedback === null,
    )
  ) {
    snapshots.push({
      schemaVersion: 1,
      questions: choiceQuestions.map((question) => ({
        blockId: question.blockId,
        title: question.title,
        prompt: question.prompt,
        options: question.options,
        correctOption: question.correctOption,
        required: question.required,
      })),
    });
  }
  return snapshots;
}

type AssessmentEvaluation = {
  selectedOption: number;
  answerSnapshot: AssessmentAnswerSnapshot;
  correct: boolean;
};

function sameNumbers(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export function evaluateAssessmentAnswer(
  question: AssessmentQuestionSnapshot,
  answer: AssessmentAnswerInput,
): AssessmentEvaluation | null {
  if (question.blockId !== answer.blockId) return null;

  if (
    question.type === "multiple_choice" ||
    question.type === "true_false"
  ) {
    if (!("selectedOption" in answer)) return null;
    const selectedOption = answer.selectedOption;
    if (
      !Number.isInteger(selectedOption) ||
      selectedOption < 0 ||
      selectedOption >= question.options.length
    ) {
      return null;
    }
    return {
      selectedOption,
      answerSnapshot: {
        selectedOption,
        optionText: question.options[selectedOption],
      },
      correct: selectedOption === question.correctOption,
    };
  }

  if (question.type === "multi_select") {
    if (!("selectedOptions" in answer)) return null;
    const selectedOptions = [...answer.selectedOptions].sort(
      (left, right) => left - right,
    );
    if (
      !selectedOptions.length ||
      selectedOptions.some(
        (option) =>
          !Number.isInteger(option) ||
          option < 0 ||
          option >= question.options.length,
      ) ||
      new Set(selectedOptions).size !== selectedOptions.length
    ) {
      return null;
    }
    return {
      selectedOption: selectedOptions[0],
      answerSnapshot: {
        selectedOptions,
        optionTexts: selectedOptions.map((option) => question.options[option]),
      },
      correct: sameNumbers(selectedOptions, question.correctOptions),
    };
  }

  if (question.type === "fill_blank") {
    if (!("textAnswer" in answer)) return null;
    const textAnswer = answer.textAnswer.trim();
    if (!textAnswer || textAnswer.length > 500) return null;
    const normalized = normalizeFillBlankAnswer(
      textAnswer,
      question.caseSensitive,
    );
    return {
      selectedOption: 0,
      answerSnapshot: { textAnswer },
      correct: question.acceptedAnswers.some(
        (accepted) =>
          normalizeFillBlankAnswer(accepted, question.caseSensitive) ===
          normalized,
      ),
    };
  }

  if (question.type !== "ordering" || !("orderedItemIds" in answer)) {
    return null;
  }
  const orderedItemIds = [...answer.orderedItemIds];
  if (
    orderedItemIds.length !== question.correctOrder.length ||
    orderedItemIds.some((id) => !/^[0-9a-f]{64}$/.test(id)) ||
    new Set(orderedItemIds).size !== orderedItemIds.length ||
    question.correctOrder.some((id) => !orderedItemIds.includes(id))
  ) {
    return null;
  }
  return {
    selectedOption: 0,
    answerSnapshot: { orderedItemIds },
    correct:
      orderedItemIds.length === question.correctOrder.length &&
      orderedItemIds.every(
        (id, index) => id === question.correctOrder[index],
      ),
  };
}
