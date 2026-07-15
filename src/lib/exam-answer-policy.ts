import type {
  AssessmentAnswerSnapshot,
  ExamDraftAnswer,
} from "@/db/schema";
import {
  evaluateAssessmentAnswer,
  type CurrentAssessmentDefinition,
} from "@/lib/assessment-engine";

export type ExamDraftValidationCode =
  | "duplicate_answer"
  | "unknown_question"
  | "invalid_answer"
  | "incomplete_answers";

export class ExamDraftValidationError extends TypeError {
  constructor(
    readonly code: ExamDraftValidationCode,
    readonly blockId?: string,
  ) {
    super(code);
    this.name = "ExamDraftValidationError";
  }
}

export function evaluateExamDraftAnswers(input: {
  definition: CurrentAssessmentDefinition;
  questionOrder: readonly string[];
  answers: readonly ExamDraftAnswer[];
  requireComplete: boolean;
}) {
  const selectedQuestions = new Map(
    input.definition.questions
      .filter((question) => input.questionOrder.includes(question.blockId))
      .map((question) => [question.blockId, question]),
  );
  const submitted = new Map<string, ExamDraftAnswer>();
  const evaluated: Array<{
    question: CurrentAssessmentDefinition["questions"][number];
    selectedOption: number;
    answerSnapshot: AssessmentAnswerSnapshot;
    correct: boolean;
  }> = [];

  for (const answer of input.answers) {
    if (submitted.has(answer.blockId)) {
      throw new ExamDraftValidationError("duplicate_answer", answer.blockId);
    }
    submitted.set(answer.blockId, answer);
    const question = selectedQuestions.get(answer.blockId);
    if (!question) {
      throw new ExamDraftValidationError("unknown_question", answer.blockId);
    }
    const evaluation = evaluateAssessmentAnswer(question, answer);
    if (!evaluation) {
      throw new ExamDraftValidationError("invalid_answer", answer.blockId);
    }
    evaluated.push({ question, ...evaluation });
  }

  if (
    input.requireComplete &&
    (submitted.size !== selectedQuestions.size ||
      [...selectedQuestions.keys()].some((id) => !submitted.has(id)))
  ) {
    throw new ExamDraftValidationError("incomplete_answers");
  }
  return evaluated;
}
