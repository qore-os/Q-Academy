type PrivacyRetentionDispatchResult =
  | {
      mode: "delete";
      cleanupFailures: number;
      budgetExhausted: boolean;
      mayHaveMore: boolean;
    }
  | { mode: "busy" | "dry-run" | "skipped" };

export function privacyRetentionNeedsRetry(
  result: PrivacyRetentionDispatchResult,
) {
  return (
    result.mode === "busy" ||
    (result.mode === "delete" &&
      (result.cleanupFailures > 0 ||
        result.budgetExhausted ||
        result.mayHaveMore))
  );
}
