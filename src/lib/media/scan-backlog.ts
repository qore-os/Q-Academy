export type MediaScanBacklogMetrics = {
  depth: number;
  failed: number;
  oldestQueuedAt: Date | null;
  oldestAgeSeconds: number;
  overloaded: boolean;
};

function validTimestamp(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim().length === 0) return null;

  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

export function buildMediaScanBacklogMetrics(input: {
  depth: number;
  failed: number;
  oldestQueuedAt: unknown;
  nowMilliseconds?: number;
}): MediaScanBacklogMetrics {
  const depth = Number.isFinite(input.depth)
    ? Math.max(0, Math.floor(input.depth))
    : 0;
  const failed = Number.isFinite(input.failed)
    ? Math.max(0, Math.floor(input.failed))
    : 0;
  const oldestQueuedAt = validTimestamp(input.oldestQueuedAt);
  const suppliedNow = input.nowMilliseconds ?? Date.now();
  const nowMilliseconds = Number.isFinite(suppliedNow) ? suppliedNow : Date.now();
  const oldestAgeSeconds = oldestQueuedAt
    ? Math.max(
        0,
        Math.floor((nowMilliseconds - oldestQueuedAt.getTime()) / 1000),
      )
    : 0;

  return {
    depth,
    failed,
    oldestQueuedAt,
    oldestAgeSeconds,
    overloaded: depth >= 80 || oldestAgeSeconds >= 60 * 60,
  };
}
