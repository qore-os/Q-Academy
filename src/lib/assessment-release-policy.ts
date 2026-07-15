export function assessmentResultIsReleased(input: {
  resultReleasedAt: Date | string | null;
}) {
  return input.resultReleasedAt !== null;
}

export function assessmentReviewIsReleased(input: {
  reviewReleasedAt: Date | string | null;
}) {
  return input.reviewReleasedAt !== null;
}

export function legacyCompatibleAssessmentResultIsReleased(input: {
  definitionHash: string | null;
  resultReleasedAt: Date | string | null;
}) {
  return input.definitionHash === null || assessmentResultIsReleased(input);
}

export function pendingAssessmentAttemptView(input: {
  id: string;
  attemptNumber: number;
  status: "graded";
  submittedAt: Date | string | null;
  deadlineAt: Date | string | null;
  resultReleaseMode: "immediate" | "after_deadline" | "manual";
  reviewReleaseMode: "never" | "after_result" | "manual";
  resultReleasedAt: Date | string | null;
  reviewReleasedAt: Date | string | null;
}) {
  if (assessmentResultIsReleased(input)) return null;
  return {
    id: input.id,
    attemptNumber: input.attemptNumber,
    status: input.status,
    submittedAt: input.submittedAt,
    deadlineAt: input.deadlineAt,
    resultReleaseMode: input.resultReleaseMode,
    reviewReleaseMode: input.reviewReleaseMode,
    resultReleasedAt: input.resultReleasedAt,
    reviewReleasedAt: input.reviewReleasedAt,
  };
}
