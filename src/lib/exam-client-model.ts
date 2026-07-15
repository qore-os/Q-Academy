export type ExamQuestionType =
  | "multiple_choice"
  | "true_false"
  | "multi_select"
  | "fill_blank"
  | "ordering"
  | "submission";

export type ExamQuestionPayload = {
  blockId: string;
  type: ExamQuestionType;
  title: string | null;
  required: boolean;
  data: Record<string, unknown>;
};

export type ExamDraftAnswerPayload =
  | { blockId: string; selectedOption: number }
  | { blockId: string; selectedOptions: number[] }
  | { blockId: string; textAnswer: string }
  | { blockId: string; orderedItemIds: string[] };

export type ExamAttemptPayload = {
  id: string;
  courseId: string;
  lessonId: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "graded";
  draftRevision: number;
  draftAnswers: ExamDraftAnswerPayload[];
  questions: ExamQuestionPayload[];
  supplementalBlocks: ExamQuestionPayload[];
  deadlineAt: string | null;
  startedAt: string;
  lastSavedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  finalizationReason: "submitted" | "timeout" | "administrator" | null;
  contentAccessMode: "allow" | "block_course" | "block_academy";
  release: {
    resultMode: "immediate" | "after_deadline" | "manual";
    reviewMode: "never" | "after_result" | "manual";
    resultReleasedAt: string | null;
    reviewReleasedAt: string | null;
  };
  resumed?: boolean;
};

export type ExamPendingAttempt = {
  id: string;
  attemptNumber: number;
  status: "in_progress" | "submitted" | "graded";
  deadlineAt: string | Date | null;
  startedAt?: string | Date | null;
  submittedAt?: string | Date | null;
  finalizationReason?: "submitted" | "timeout" | "administrator" | null;
  resultReleaseMode?: "immediate" | "after_deadline" | "manual";
  reviewReleaseMode?: "never" | "after_result" | "manual";
  resultReleasedAt: string | Date | null;
  reviewReleasedAt: string | Date | null;
};

export type ExamReviewEntry = {
  blockId: string;
  questionSnapshot: {
    title: string | null;
    prompt: string;
    feedback: string | null;
    type: ExamQuestionType;
    options?: string[];
    correctOption?: number;
    correctOptions?: number[];
    acceptedAnswers?: string[];
    caseSensitive?: boolean;
    correctOrder?: string[];
  };
  answerSnapshot:
    | { selectedOption: number; optionText: string }
    | { selectedOptions: number[]; optionTexts: string[] }
    | { textAnswer: string }
    | { orderedItemIds: string[] };
  correct: boolean;
  answeredAt: string;
};

export type ExamResultPayload = {
  attempt: Pick<
    ExamAttemptPayload,
    | "id"
    | "attemptNumber"
    | "status"
    | "deadlineAt"
    | "submittedAt"
    | "gradedAt"
    | "finalizationReason"
    | "release"
  > & {
    questions?: ExamQuestionPayload[];
    supplementalBlocks?: ExamQuestionPayload[];
  };
  result: {
    score: number;
    passed: boolean;
    questionCount: number;
    correctCount: number;
    finalizationReason: "submitted" | "timeout" | "administrator" | null;
  } | null;
  review: ExamReviewEntry[] | null;
};

export type ExamAnswerMap = Record<string, ExamDraftAnswerPayload>;

export function isAutomaticExamQuestion(question: ExamQuestionPayload) {
  return question.type !== "submission";
}

export function examAnswerMap(answers: readonly ExamDraftAnswerPayload[]) {
  return Object.fromEntries(
    answers.map((answer) => [answer.blockId, answer]),
  ) as ExamAnswerMap;
}

function stringArray(value: unknown) {
  return Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
    ? value
    : [];
}

export function examQuestionAnswer(
  question: ExamQuestionPayload,
  answers: ExamAnswerMap,
): ExamDraftAnswerPayload | null {
  const answer = answers[question.blockId];
  if (!answer || answer.blockId !== question.blockId) return null;
  if (
    (question.type === "multiple_choice" || question.type === "true_false") &&
    "selectedOption" in answer &&
    Number.isInteger(answer.selectedOption)
  ) {
    const options = stringArray(question.data.options);
    return answer.selectedOption >= 0 && answer.selectedOption < options.length
      ? answer
      : null;
  }
  if (
    question.type === "multi_select" &&
    "selectedOptions" in answer &&
    answer.selectedOptions.length > 0
  ) {
    const options = stringArray(question.data.options);
    const selected = [...new Set(answer.selectedOptions)].sort(
      (left, right) => left - right,
    );
    return selected.every(
      (option) =>
        Number.isInteger(option) && option >= 0 && option < options.length,
    )
      ? { blockId: question.blockId, selectedOptions: selected }
      : null;
  }
  if (question.type === "fill_blank" && "textAnswer" in answer) {
    const textAnswer = answer.textAnswer.trim();
    return textAnswer
      ? { blockId: question.blockId, textAnswer: textAnswer.slice(0, 500) }
      : null;
  }
  if (question.type === "ordering" && "orderedItemIds" in answer) {
    const optionIds = stringArray(question.data.optionIds);
    return optionIds.length >= 2 &&
      answer.orderedItemIds.length === optionIds.length &&
      new Set(answer.orderedItemIds).size === optionIds.length &&
      optionIds.every((id) => answer.orderedItemIds.includes(id))
      ? answer
      : null;
  }
  return null;
}

export function examAnswersForSubmission(
  questions: readonly ExamQuestionPayload[],
  answers: ExamAnswerMap,
) {
  const submitted = questions
    .filter(isAutomaticExamQuestion)
    .map((question) => examQuestionAnswer(question, answers));
  return submitted.every(
    (answer): answer is ExamDraftAnswerPayload => answer !== null,
  )
    ? submitted
    : null;
}

export function examDraftAnswers(
  questions: readonly ExamQuestionPayload[],
  answers: ExamAnswerMap,
) {
  return questions.filter(isAutomaticExamQuestion).flatMap((question) => {
    const answer = examQuestionAnswer(question, answers);
    return answer ? [answer] : [];
  });
}

export function remainingExamSeconds(
  deadlineAt: string | Date | null,
  nowMs: number,
) {
  if (!deadlineAt) return null;
  const deadlineMs = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1_000));
}

export function formatExamDuration(seconds: number | null) {
  if (seconds === null) return "Ohne Zeitlimit";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.ceil((seconds % 3_600) / 60);
  return hours
    ? `${hours} Std.${minutes ? ` ${minutes} Min.` : ""}`
    : `${minutes} Min.`;
}
