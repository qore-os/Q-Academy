export type QueueHealthMetrics = {
  depth: number;
  failed: number;
  oldestAgeSeconds: number;
};

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function validTimestamp(value: unknown) {
  if (value === null || value === undefined) return null;
  if (!(value instanceof Date) && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim().length === 0) return null;

  const milliseconds =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function buildQueueHealthMetrics(input: {
  depth: number;
  failed: number;
  oldestAt: unknown;
  nowMilliseconds?: number;
}): QueueHealthMetrics {
  const suppliedNow = input.nowMilliseconds ?? Date.now();
  const nowMilliseconds = Number.isFinite(suppliedNow)
    ? suppliedNow
    : Date.now();
  const oldestMilliseconds = validTimestamp(input.oldestAt);

  return {
    depth: nonNegativeInteger(input.depth),
    failed: nonNegativeInteger(input.failed),
    oldestAgeSeconds:
      oldestMilliseconds === null
        ? 0
        : Math.max(
            0,
            Math.floor((nowMilliseconds - oldestMilliseconds) / 1_000),
          ),
  };
}
