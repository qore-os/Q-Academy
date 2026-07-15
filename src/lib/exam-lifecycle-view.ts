import type { ExamQuestionPresentation } from "@/db/schema";
import { redactAssessmentAnswerKeys } from "@/lib/assessment-engine";

export function examAttemptPresentationView(input: {
  questionOrder: readonly string[];
  presentation: readonly ExamQuestionPresentation[];
}) {
  const questionIds = new Set(input.questionOrder);
  return {
    questions: redactAssessmentAnswerKeys(
      input.presentation.filter((block) => questionIds.has(block.blockId)),
    ),
    supplementalBlocks: redactAssessmentAnswerKeys(
      input.presentation.filter((block) => !questionIds.has(block.blockId)),
    ),
  };
}
