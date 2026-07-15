const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;

export function boundedPrivacyRetentionBatchSize(value?: number) {
  const resolved = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new TypeError("Privacy retention batch size must be positive.");
  }
  return Math.min(resolved, MAX_BATCH_SIZE);
}
