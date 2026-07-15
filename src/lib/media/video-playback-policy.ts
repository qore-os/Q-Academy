import {
  effectiveVideoEditDuration,
  MAX_VIDEO_EDIT_DURATION_MS,
  sanitizeVideoEditPlan,
  videoPlaybackOffsetToSourcePosition,
  videoPositionAfterRemovedSegment,
  videoSourcePositionToPlaybackOffset,
  type VideoEditPlan,
  type VideoRemovedSegment,
} from "@/lib/media/video-edit-plan";

export const VIDEO_PLAYBACK_POLICY_VERSION = 2 as const;
export const MAX_MEDIA_DURATION_MS = MAX_VIDEO_EDIT_DURATION_MS;

export type VideoPlaybackPolicy = {
  version: typeof VIDEO_PLAYBACK_POLICY_VERSION;
  trimStartMs: number;
  trimEndMs: number | null;
  removedSegments: VideoRemovedSegment[];
  completionMode: "optional" | "required";
  minimumWatchPercent: number;
  seeking: "allowed" | "watched_only" | "disabled";
};

const DEFAULT_POLICY: VideoPlaybackPolicy = Object.freeze({
  version: VIDEO_PLAYBACK_POLICY_VERSION,
  trimStartMs: 0,
  trimEndMs: null,
  removedSegments: [],
  completionMode: "optional",
  minimumWatchPercent: 90,
  seeking: "allowed",
});

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseVideoPlaybackPolicy(
  value: unknown,
): VideoPlaybackPolicy | null {
  const input = record(value);
  if (!input || (input.version !== 1 && input.version !== 2)) return null;
  const minimumWatchPercent = Number(input.minimumWatchPercent);
  const editPlan = sanitizeVideoEditPlan({
    version: 1,
    trimStartMs: input.trimStartMs,
    trimEndMs: input.trimEndMs,
    removedSegments: input.version === 2 ? input.removedSegments : [],
  });
  if (
    !editPlan ||
    !Number.isInteger(minimumWatchPercent) ||
    minimumWatchPercent < 50 ||
    minimumWatchPercent > 100 ||
    !["optional", "required"].includes(String(input.completionMode)) ||
    !["allowed", "watched_only", "disabled"].includes(String(input.seeking))
  ) {
    return null;
  }
  return {
    version: VIDEO_PLAYBACK_POLICY_VERSION,
    trimStartMs: editPlan.trimStartMs,
    trimEndMs: editPlan.trimEndMs,
    removedSegments: editPlan.removedSegments,
    completionMode: input.completionMode as VideoPlaybackPolicy["completionMode"],
    minimumWatchPercent,
    seeking: input.seeking as VideoPlaybackPolicy["seeking"],
  };
}

export function sanitizeVideoPlaybackPolicy(
  value: unknown,
): VideoPlaybackPolicy {
  return parseVideoPlaybackPolicy(value) ?? {
    ...DEFAULT_POLICY,
    removedSegments: [],
  };
}

function removedSegmentsFromForm(value: unknown): VideoRemovedSegment[] | null {
  if (value === undefined || value === null || value === "") return [];
  let candidates: unknown = value;
  if (typeof value === "string") {
    if (value.length > 10_000) return null;
    try {
      candidates = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(candidates) || candidates.length > 50) return null;
  const segments: VideoRemovedSegment[] = [];
  for (const candidate of candidates) {
    const input = record(candidate);
    if (!input) return null;
    const startSeconds = Number(input.startSeconds);
    const endSeconds = Number(input.endSeconds);
    if (
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      !Number.isInteger(startSeconds * 1_000) ||
      !Number.isInteger(endSeconds * 1_000)
    ) {
      return null;
    }
    segments.push({
      startMs: startSeconds * 1_000,
      endMs: endSeconds * 1_000,
    });
  }
  return segments.sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs,
  );
}

export function videoPlaybackPolicyFromForm(input: {
  trimStartSeconds: string;
  trimEndSeconds: string;
  removedSegments?: unknown;
  requiredPlayback: boolean;
  minimumWatchPercent: string;
  seeking: string;
}): VideoPlaybackPolicy | null {
  const startSeconds = input.trimStartSeconds.trim()
    ? Number(input.trimStartSeconds)
    : 0;
  const endSeconds = input.trimEndSeconds.trim()
    ? Number(input.trimEndSeconds)
    : null;
  const minimumWatchPercent = Number(input.minimumWatchPercent || "90");
  const removedSegments = removedSegmentsFromForm(input.removedSegments);
  if (
    removedSegments === null ||
    !Number.isFinite(startSeconds) ||
    startSeconds < 0 ||
    !Number.isInteger(startSeconds * 1_000) ||
    (endSeconds !== null &&
      (!Number.isFinite(endSeconds) ||
        endSeconds <= startSeconds ||
        !Number.isInteger(endSeconds * 1_000)))
  ) {
    return null;
  }
  return parseVideoPlaybackPolicy({
    version: VIDEO_PLAYBACK_POLICY_VERSION,
    trimStartMs: startSeconds * 1_000,
    trimEndMs: endSeconds === null ? null : endSeconds * 1_000,
    removedSegments,
    completionMode: input.requiredPlayback ? "required" : "optional",
    minimumWatchPercent,
    seeking: input.seeking,
  });
}

export function videoEditPlanFromPlaybackPolicy(value: unknown): VideoEditPlan {
  const policy = sanitizeVideoPlaybackPolicy(value);
  return {
    version: 1,
    trimStartMs: policy.trimStartMs,
    trimEndMs: policy.trimEndMs,
    removedSegments: policy.removedSegments,
  };
}

export function videoPlaybackPolicyHasEdits(value: unknown) {
  const policy = sanitizeVideoPlaybackPolicy(value);
  return (
    policy.trimStartMs > 0 ||
    policy.trimEndMs !== null ||
    policy.removedSegments.length > 0
  );
}

export function playbackWindowMilliseconds(
  policyValue: unknown,
  durationMilliseconds: number | null,
) {
  const policy = sanitizeVideoPlaybackPolicy(policyValue);
  const trustedDuration =
    Number.isInteger(durationMilliseconds) && Number(durationMilliseconds) > 0
      ? Number(durationMilliseconds)
      : null;
  const endMs = policy.trimEndMs ?? trustedDuration;
  if (endMs === null || endMs <= policy.trimStartMs) return null;
  const durationMs = effectiveVideoEditDuration(
    videoEditPlanFromPlaybackPolicy(policy),
    trustedDuration ?? endMs,
  );
  if (durationMs === null || durationMs <= 0) return null;
  return {
    startMs: policy.trimStartMs,
    endMs,
    durationMs,
    requiredMs: Math.ceil((durationMs * policy.minimumWatchPercent) / 100),
  };
}

export function playbackPositionAfterRemovedSegment(
  policyValue: unknown,
  positionMs: number,
) {
  return videoPositionAfterRemovedSegment(
    videoEditPlanFromPlaybackPolicy(policyValue),
    positionMs,
  );
}

export function sourcePositionToPlaybackOffset(
  policyValue: unknown,
  durationMilliseconds: number,
  positionMs: number,
) {
  return videoSourcePositionToPlaybackOffset(
    videoEditPlanFromPlaybackPolicy(policyValue),
    durationMilliseconds,
    positionMs,
  );
}

export function playbackOffsetToSourcePosition(
  policyValue: unknown,
  durationMilliseconds: number,
  offsetMs: number,
) {
  return videoPlaybackOffsetToSourcePosition(
    videoEditPlanFromPlaybackPolicy(policyValue),
    durationMilliseconds,
    offsetMs,
  );
}
