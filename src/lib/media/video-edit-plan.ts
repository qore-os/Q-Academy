export const VIDEO_EDIT_PLAN_VERSION = 1 as const;
export const MAX_VIDEO_REMOVED_SEGMENTS = 50;
export const MAX_VIDEO_EDIT_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

export type VideoRemovedSegment = {
  startMs: number;
  endMs: number;
};

export type VideoEditPlan = {
  version: typeof VIDEO_EDIT_PLAN_VERSION;
  trimStartMs: number;
  trimEndMs: number | null;
  removedSegments: VideoRemovedSegment[];
};

export type VideoKeptSegment = {
  startMs: number;
  endMs: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeVideoEditPlan(
  value: unknown,
  durationMilliseconds: number | null = null,
): VideoEditPlan | null {
  if (!isRecord(value) || value.version !== VIDEO_EDIT_PLAN_VERSION) return null;
  const trimStartMs = Number(value.trimStartMs);
  const trimEndMs = value.trimEndMs === null ? null : Number(value.trimEndMs);
  const duration =
    Number.isInteger(durationMilliseconds) && Number(durationMilliseconds) > 0
      ? Number(durationMilliseconds)
      : null;
  if (
    !Number.isInteger(trimStartMs) ||
    trimStartMs < 0 ||
    trimStartMs >= MAX_VIDEO_EDIT_DURATION_MS ||
    (trimEndMs !== null &&
      (!Number.isInteger(trimEndMs) ||
        trimEndMs <= trimStartMs ||
        trimEndMs > MAX_VIDEO_EDIT_DURATION_MS)) ||
    (duration !== null &&
      (trimStartMs >= duration || (trimEndMs !== null && trimEndMs > duration))) ||
    !Array.isArray(value.removedSegments) ||
    value.removedSegments.length > MAX_VIDEO_REMOVED_SEGMENTS
  ) {
    return null;
  }

  const effectiveEndMs = trimEndMs ?? duration;
  const removedSegments: VideoRemovedSegment[] = [];
  for (const candidate of value.removedSegments) {
    if (!isRecord(candidate)) return null;
    const startMs = Number(candidate.startMs);
    const endMs = Number(candidate.endMs);
    const previous = removedSegments.at(-1);
    if (
      !Number.isInteger(startMs) ||
      !Number.isInteger(endMs) ||
      startMs < trimStartMs ||
      endMs <= startMs ||
      endMs > MAX_VIDEO_EDIT_DURATION_MS ||
      (effectiveEndMs !== null && endMs > effectiveEndMs) ||
      (previous && startMs < previous.endMs)
    ) {
      return null;
    }
    removedSegments.push({ startMs, endMs });
  }

  if (effectiveEndMs !== null) {
    const removedDuration = removedSegments.reduce(
      (total, segment) => total + segment.endMs - segment.startMs,
      0,
    );
    if (removedDuration >= effectiveEndMs - trimStartMs) return null;
  }
  return {
    version: VIDEO_EDIT_PLAN_VERSION,
    trimStartMs,
    trimEndMs,
    removedSegments,
  };
}

export function videoEditKeptSegments(
  value: unknown,
  durationMilliseconds: number,
): VideoKeptSegment[] | null {
  const plan = sanitizeVideoEditPlan(value, durationMilliseconds);
  if (!plan) return null;
  const endMs = plan.trimEndMs ?? durationMilliseconds;
  const kept: VideoKeptSegment[] = [];
  let cursor = plan.trimStartMs;
  for (const removed of plan.removedSegments) {
    if (removed.startMs > cursor) kept.push({ startMs: cursor, endMs: removed.startMs });
    cursor = removed.endMs;
  }
  if (cursor < endMs) kept.push({ startMs: cursor, endMs });
  return kept.length ? kept : null;
}

export function effectiveVideoEditDuration(
  value: unknown,
  durationMilliseconds: number,
) {
  const kept = videoEditKeptSegments(value, durationMilliseconds);
  return kept
    ? kept.reduce((total, segment) => total + segment.endMs - segment.startMs, 0)
    : null;
}

export function videoPositionAfterRemovedSegment(
  value: unknown,
  positionMs: number,
) {
  const plan = sanitizeVideoEditPlan(value);
  if (!plan) return null;
  const removed = plan.removedSegments.find(
    (segment) => positionMs >= segment.startMs && positionMs < segment.endMs,
  );
  return removed?.endMs ?? null;
}

export function videoSourcePositionToPlaybackOffset(
  value: unknown,
  durationMilliseconds: number,
  positionMs: number,
) {
  const kept = videoEditKeptSegments(value, durationMilliseconds);
  if (!kept) return null;
  let offset = 0;
  for (const segment of kept) {
    if (positionMs <= segment.startMs) return offset;
    const visibleEnd = Math.min(positionMs, segment.endMs);
    offset += Math.max(0, visibleEnd - segment.startMs);
    if (positionMs < segment.endMs) return offset;
  }
  return offset;
}

export function videoPlaybackOffsetToSourcePosition(
  value: unknown,
  durationMilliseconds: number,
  offsetMs: number,
) {
  const kept = videoEditKeptSegments(value, durationMilliseconds);
  if (!kept) return null;
  let remaining = Math.max(0, offsetMs);
  for (const [index, segment] of kept.entries()) {
    const length = segment.endMs - segment.startMs;
    if (remaining < length) return segment.startMs + remaining;
    if (remaining === length) {
      return kept[index + 1]?.startMs ?? segment.endMs;
    }
    remaining -= length;
  }
  return kept.at(-1)!.endMs;
}

function seconds(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3).replace(/\.?0+$/, "");
}

export function buildVideoEditFfmpegFilters(
  value: unknown,
  durationMilliseconds: number,
) {
  const kept = videoEditKeptSegments(value, durationMilliseconds);
  if (!kept) return null;
  const expression = kept
    .map(
      (segment) =>
        `between(t\\,${seconds(segment.startMs)}\\,${seconds(segment.endMs)})`,
    )
    .join("+");
  return {
    video: `select=${expression},setpts=N/FRAME_RATE/TB`,
    audio: `aselect=${expression},asetpts=N/SR/TB`,
    expectedDurationMs: kept.reduce(
      (total, segment) => total + segment.endMs - segment.startMs,
      0,
    ),
  };
}
