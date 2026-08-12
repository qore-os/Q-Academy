const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_VIDEO_POSTER_MILLISECONDS = 604_800_000;

export type VideoPoster =
  | {
      version: 1;
      source: "frame";
      atMilliseconds: number;
    }
  | {
      version: 1;
      source: "upload";
      mediaAssetId: string;
      mediaAssetName?: string;
    };

export type VideoThumbnailLookup =
  | { kind: "auto" }
  | { kind: "exact"; atMilliseconds: number };

export type ExactVideoThumbnailJobStatus =
  | "pending"
  | "processing"
  | "failed"
  | "succeeded";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeVideoPoster(value: unknown): VideoPoster | null {
  if (!isRecord(value) || value.version !== 1) return null;
  if (value.source === "frame") {
    if (
      !Number.isSafeInteger(value.atMilliseconds) ||
      Number(value.atMilliseconds) < 0 ||
      Number(value.atMilliseconds) > MAX_VIDEO_POSTER_MILLISECONDS
    ) {
      return null;
    }
    return {
      version: 1,
      source: "frame",
      atMilliseconds: Number(value.atMilliseconds),
    };
  }
  if (
    value.source !== "upload" ||
    typeof value.mediaAssetId !== "string" ||
    !UUID_PATTERN.test(value.mediaAssetId)
  ) {
    return null;
  }
  const mediaAssetName =
    typeof value.mediaAssetName === "string"
      ? value.mediaAssetName.trim().slice(0, 500)
      : "";
  return {
    version: 1,
    source: "upload",
    mediaAssetId: value.mediaAssetId.toLowerCase(),
    ...(mediaAssetName ? { mediaAssetName } : {}),
  };
}

export function parseVideoPosterJson(value: string): VideoPoster | null {
  if (!value.trim()) return null;
  try {
    return sanitizeVideoPoster(JSON.parse(value));
  } catch {
    return null;
  }
}

export function videoThumbnailLookup(
  atMilliseconds: number | null,
): VideoThumbnailLookup {
  return atMilliseconds === null
    ? { kind: "auto" }
    : { kind: "exact", atMilliseconds };
}

export function videoThumbnailLookupAcceptsJob(
  lookup: VideoThumbnailLookup,
  options: Readonly<Record<string, unknown>>,
) {
  if (lookup.kind === "auto") {
    return (
      !("atMilliseconds" in options) || options.atMilliseconds === 0
    );
  }
  return options.atMilliseconds === lookup.atMilliseconds;
}

export function exactVideoThumbnailJobStatus(
  jobs: readonly Readonly<Record<string, unknown>>[],
  jobId: string,
  atMilliseconds: number,
): ExactVideoThumbnailJobStatus | null {
  const job = jobs.find((candidate) => candidate.id === jobId);
  if (
    !job ||
    job.type !== "thumbnail" ||
    job.atMilliseconds !== atMilliseconds
  ) {
    return null;
  }
  if (job.status === "queued") return "pending";
  if (
    job.status === "processing" ||
    job.status === "failed" ||
    job.status === "succeeded"
  ) {
    return job.status;
  }
  return null;
}

export function videoPosterUrl(
  primaryMediaAssetId: string | undefined,
  value: unknown,
) {
  const poster = sanitizeVideoPoster(value);
  if (poster?.source === "upload") {
    return `/api/media-assets/${poster.mediaAssetId}/download`;
  }
  if (!primaryMediaAssetId) return undefined;
  if (poster?.source === "frame") {
    return `/api/media-assets/${primaryMediaAssetId}/derivatives/thumbnail?atMilliseconds=${poster.atMilliseconds}`;
  }
  return `/api/media-assets/${primaryMediaAssetId}/derivatives/thumbnail`;
}
