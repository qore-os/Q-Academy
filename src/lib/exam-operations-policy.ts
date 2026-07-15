export type ExamOperationAction =
  | "finalize"
  | "release_result"
  | "release_review";

export type ExamOperationStatus =
  | "active"
  | "result_manual"
  | "result_scheduled"
  | "result_pending"
  | "review_manual"
  | "review_pending";

type ExamOperationLifecycle = {
  status: "in_progress" | "submitted" | "graded";
  resultReleaseMode: "immediate" | "after_deadline" | "manual";
  reviewReleaseMode: "never" | "after_result" | "manual";
  resultReleasedAt: Date | string | null;
  reviewReleasedAt: Date | string | null;
};

export function examOperationStatus(
  attempt: ExamOperationLifecycle,
): ExamOperationStatus | null {
  if (attempt.status === "in_progress" || attempt.status === "submitted") {
    return "active";
  }
  if (!attempt.resultReleasedAt) {
    if (attempt.resultReleaseMode === "manual") return "result_manual";
    if (attempt.resultReleaseMode === "after_deadline") {
      return "result_scheduled";
    }
    return "result_pending";
  }
  if (attempt.reviewReleasedAt || attempt.reviewReleaseMode === "never") {
    return null;
  }
  return attempt.reviewReleaseMode === "manual"
    ? "review_manual"
    : "review_pending";
}

export function availableExamOperationActions(
  attempt: ExamOperationLifecycle,
): ExamOperationAction[] {
  const status = examOperationStatus(attempt);
  if (status === "active") return ["finalize"];
  if (status === "result_manual") return ["release_result"];
  if (status === "review_manual") return ["release_review"];
  return [];
}
