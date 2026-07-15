export const VIDEO_COMPOSITION_VERSION = 1 as const;
export const MAX_VIDEO_COMPOSITION_AUDIO_TRACKS = 8;
export const MAX_VIDEO_COMPOSITION_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
export const MAX_VIDEO_COMPOSITION_SOURCE_BYTES = 1_000_000_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type VideoCompositionAudioTrack = {
  id: string;
  mediaAssetId: string;
  mediaAssetName?: string;
  timelineStartMs: number;
  sourceStartMs: number;
  sourceEndMs: number | null;
  volume: number;
};

export type VideoCompositionDocument = {
  version: typeof VIDEO_COMPOSITION_VERSION;
  audioTracks: VideoCompositionAudioTrack[];
  renderJobId?: string;
};

export type ImmutableCompositionSource = {
  assetId: string;
  storageDriver: "filesystem" | "s3";
  storageKey: string;
  storageVersionId: string | null;
  etag: string | null;
  contentSha256: string;
  sizeBytes: number;
  durationMilliseconds: number;
};

export type BoundVideoCompositionAudioTrack = Omit<
  VideoCompositionAudioTrack,
  "mediaAssetName" | "sourceEndMs"
> & {
  sourceEndMs: number;
  source: ImmutableCompositionSource;
};

export type BoundVideoComposition = {
  version: typeof VIDEO_COMPOSITION_VERSION;
  audioTracks: BoundVideoCompositionAudioTrack[];
};

export function videoProcessingOptionsConflict(input: {
  videoEdit?: unknown;
  videoComposition?: unknown;
}) {
  return input.videoEdit !== undefined && input.videoComposition !== undefined;
}

export function canUseVideoCompositionSource(input: {
  role: "owner" | "admin" | "trainer" | "member";
  uploadedByActor: boolean;
  boundToCurrentCourse: boolean;
  boundAnywhere: boolean;
}) {
  if (input.role === "owner" || input.role === "admin") return true;
  if (input.role !== "trainer") return false;
  return (
    input.boundToCurrentCourse ||
    (input.uploadedByActor && !input.boundAnywhere)
  );
}

export function publishedSnapshotReferencesVideoComposition(
  snapshot: unknown,
  input: { renderJobId: string; primaryAssetId: string },
) {
  if (
    !UUID_PATTERN.test(input.renderJobId) ||
    !UUID_PATTERN.test(input.primaryAssetId) ||
    !isRecord(snapshot) ||
    !Array.isArray(snapshot.modules)
  ) {
    return false;
  }
  for (const learningModule of snapshot.modules) {
    if (!isRecord(learningModule)) continue;
    const lessons = [
      ...(Array.isArray(learningModule.lessons) ? learningModule.lessons : []),
      ...(Array.isArray(learningModule.sections)
        ? learningModule.sections.flatMap((section) =>
            isRecord(section) && Array.isArray(section.lessons)
              ? section.lessons
              : [],
          )
        : []),
    ];
    for (const lesson of lessons) {
      if (!isRecord(lesson)) continue;
      const blocks = [
        ...(Array.isArray(lesson.blocks) ? lesson.blocks : []),
        ...(Array.isArray(lesson.pages)
          ? lesson.pages.flatMap((page) =>
              isRecord(page) && Array.isArray(page.blocks) ? page.blocks : [],
            )
          : []),
      ];
      for (const block of blocks) {
        if (
          !isRecord(block) ||
          block.type !== "video" ||
          !isRecord(block.data) ||
          block.data.mediaAssetId !== input.primaryAssetId
        ) {
          continue;
        }
        const composition = sanitizeVideoComposition(
          block.data.videoComposition,
        );
        if (composition?.renderJobId === input.renderJobId) return true;
      }
    }
  }
  return false;
}

export function canDownloadVideoCompositionDerivative(input: {
  role: "owner" | "admin" | "trainer" | "member";
  coursePermission?: "view" | "edit" | "manage" | null;
  publishedReference?: boolean;
}) {
  if (input.role === "owner" || input.role === "admin") return true;
  if (input.role === "trainer") {
    return (
      input.coursePermission === "edit" || input.coursePermission === "manage"
    );
  }
  return input.role === "member" && input.publishedReference === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function boundedVolume(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 2) return null;
  return Math.round(number * 100) / 100;
}

function normalizedTrackOrder<T extends VideoCompositionAudioTrack>(
  tracks: T[],
) {
  return tracks.sort(
    (left, right) =>
      left.timelineStartMs - right.timelineStartMs ||
      left.id.localeCompare(right.id),
  );
}

export function sanitizeVideoComposition(
  value: unknown,
  assetDurations?: ReadonlyMap<string, number>,
): VideoCompositionDocument | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "audioTracks", "renderJobId"]) ||
    value.version !== VIDEO_COMPOSITION_VERSION ||
    !Array.isArray(value.audioTracks) ||
    value.audioTracks.length < 1 ||
    value.audioTracks.length > MAX_VIDEO_COMPOSITION_AUDIO_TRACKS ||
    (value.renderJobId !== undefined &&
      (typeof value.renderJobId !== "string" ||
        !UUID_PATTERN.test(value.renderJobId)))
  ) {
    return null;
  }

  const tracks: VideoCompositionAudioTrack[] = [];
  const trackIds = new Set<string>();
  for (const candidate of value.audioTracks) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "mediaAssetId",
        "mediaAssetName",
        "timelineStartMs",
        "sourceStartMs",
        "sourceEndMs",
        "volume",
      ]) ||
      typeof candidate.id !== "string" ||
      !UUID_PATTERN.test(candidate.id) ||
      trackIds.has(candidate.id) ||
      typeof candidate.mediaAssetId !== "string" ||
      !UUID_PATTERN.test(candidate.mediaAssetId)
    ) {
      return null;
    }
    const timelineStartMs = boundedInteger(
      candidate.timelineStartMs,
      0,
      MAX_VIDEO_COMPOSITION_DURATION_MS - 1,
    );
    const sourceStartMs = boundedInteger(
      candidate.sourceStartMs,
      0,
      MAX_VIDEO_COMPOSITION_DURATION_MS - 1,
    );
    const sourceEndMs =
      candidate.sourceEndMs === null
        ? null
        : boundedInteger(
            candidate.sourceEndMs,
            1,
            MAX_VIDEO_COMPOSITION_DURATION_MS,
          );
    const volume = boundedVolume(candidate.volume);
    const duration = assetDurations?.get(candidate.mediaAssetId) ?? null;
    if (
      timelineStartMs === null ||
      sourceStartMs === null ||
      volume === null ||
      (sourceEndMs !== null && sourceEndMs <= sourceStartMs) ||
      (duration !== null &&
        (!Number.isInteger(duration) ||
          duration <= 0 ||
          sourceStartMs >= duration ||
          (sourceEndMs !== null && sourceEndMs > duration)))
    ) {
      return null;
    }
    const mediaAssetName =
      typeof candidate.mediaAssetName === "string"
        ? candidate.mediaAssetName.trim()
        : "";
    if (mediaAssetName.length > 255) return null;
    trackIds.add(candidate.id);
    tracks.push({
      id: candidate.id.toLowerCase(),
      mediaAssetId: candidate.mediaAssetId.toLowerCase(),
      ...(mediaAssetName ? { mediaAssetName } : {}),
      timelineStartMs,
      sourceStartMs,
      sourceEndMs,
      volume,
    });
  }

  return {
    version: VIDEO_COMPOSITION_VERSION,
    audioTracks: normalizedTrackOrder(tracks),
    ...(typeof value.renderJobId === "string"
      ? { renderJobId: value.renderJobId.toLowerCase() }
      : {}),
  };
}

export function sanitizeBoundVideoComposition(
  value: unknown,
): BoundVideoComposition | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["version", "audioTracks"]) ||
    value.version !== VIDEO_COMPOSITION_VERSION ||
    !Array.isArray(value.audioTracks) ||
    value.audioTracks.length < 1 ||
    value.audioTracks.length > MAX_VIDEO_COMPOSITION_AUDIO_TRACKS
  ) {
    return null;
  }
  const tracks: BoundVideoCompositionAudioTrack[] = [];
  const trackIds = new Set<string>();
  let totalBytes = 0;
  for (const candidate of value.audioTracks) {
    if (
      !isRecord(candidate) ||
      !hasOnlyKeys(candidate, [
        "id",
        "mediaAssetId",
        "timelineStartMs",
        "sourceStartMs",
        "sourceEndMs",
        "volume",
        "source",
      ]) ||
      !isRecord(candidate.source) ||
      !hasOnlyKeys(candidate.source, [
        "assetId",
        "storageDriver",
        "storageKey",
        "storageVersionId",
        "etag",
        "contentSha256",
        "sizeBytes",
        "durationMilliseconds",
      ]) ||
      typeof candidate.id !== "string" ||
      !UUID_PATTERN.test(candidate.id) ||
      trackIds.has(candidate.id) ||
      typeof candidate.mediaAssetId !== "string" ||
      !UUID_PATTERN.test(candidate.mediaAssetId) ||
      candidate.source.assetId !== candidate.mediaAssetId ||
      !["filesystem", "s3"].includes(String(candidate.source.storageDriver)) ||
      typeof candidate.source.storageKey !== "string" ||
      candidate.source.storageKey.length < 8 ||
      candidate.source.storageKey.length > 2_048 ||
      /[\0\r\n]/.test(candidate.source.storageKey) ||
      typeof candidate.source.contentSha256 !== "string" ||
      !SHA256_PATTERN.test(candidate.source.contentSha256)
    ) {
      return null;
    }
    const timelineStartMs = boundedInteger(
      candidate.timelineStartMs,
      0,
      MAX_VIDEO_COMPOSITION_DURATION_MS - 1,
    );
    const sourceStartMs = boundedInteger(
      candidate.sourceStartMs,
      0,
      MAX_VIDEO_COMPOSITION_DURATION_MS - 1,
    );
    const sourceEndMs = boundedInteger(
      candidate.sourceEndMs,
      1,
      MAX_VIDEO_COMPOSITION_DURATION_MS,
    );
    const durationMilliseconds = boundedInteger(
      candidate.source.durationMilliseconds,
      1,
      MAX_VIDEO_COMPOSITION_DURATION_MS,
    );
    const sizeBytes = boundedInteger(
      candidate.source.sizeBytes,
      1,
      MAX_VIDEO_COMPOSITION_SOURCE_BYTES,
    );
    const volume = boundedVolume(candidate.volume);
    const storageDriver = candidate.source.storageDriver as "filesystem" | "s3";
    const storageVersionId =
      candidate.source.storageVersionId === null
        ? null
        : typeof candidate.source.storageVersionId === "string" &&
            candidate.source.storageVersionId.trim() &&
            candidate.source.storageVersionId.length <= 1_024
          ? candidate.source.storageVersionId
          : null;
    const etag =
      candidate.source.etag === null
        ? null
        : typeof candidate.source.etag === "string" &&
            candidate.source.etag.trim() &&
            candidate.source.etag.length <= 255
          ? candidate.source.etag
          : null;
    if (
      timelineStartMs === null ||
      sourceStartMs === null ||
      sourceEndMs === null ||
      durationMilliseconds === null ||
      sizeBytes === null ||
      volume === null ||
      sourceEndMs <= sourceStartMs ||
      sourceEndMs > durationMilliseconds ||
      (storageDriver === "s3" && (!storageVersionId || !etag)) ||
      (storageDriver === "filesystem" &&
        (candidate.source.storageVersionId !== null ||
          candidate.source.etag !== null))
    ) {
      return null;
    }
    totalBytes += sizeBytes;
    if (totalBytes > MAX_VIDEO_COMPOSITION_SOURCE_BYTES) return null;
    trackIds.add(candidate.id);
    tracks.push({
      id: candidate.id.toLowerCase(),
      mediaAssetId: candidate.mediaAssetId.toLowerCase(),
      timelineStartMs,
      sourceStartMs,
      sourceEndMs,
      volume,
      source: {
        assetId: candidate.mediaAssetId.toLowerCase(),
        storageDriver,
        storageKey: candidate.source.storageKey,
        storageVersionId,
        etag,
        contentSha256: candidate.source.contentSha256,
        sizeBytes,
        durationMilliseconds,
      },
    });
  }
  return {
    version: VIDEO_COMPOSITION_VERSION,
    audioTracks: normalizedTrackOrder(tracks),
  };
}

export function bindVideoCompositionSources(
  value: unknown,
  sources: readonly ImmutableCompositionSource[],
) {
  const durations = new Map(
    sources.map((source) => [source.assetId, source.durationMilliseconds]),
  );
  const document = sanitizeVideoComposition(value, durations);
  if (!document) return null;
  const sourcesById = new Map(
    sources.map((source) => [source.assetId, source]),
  );
  return sanitizeBoundVideoComposition({
    version: VIDEO_COMPOSITION_VERSION,
    audioTracks: document.audioTracks.map((track) => {
      const source = sourcesById.get(track.mediaAssetId);
      return {
        id: track.id,
        mediaAssetId: track.mediaAssetId,
        timelineStartMs: track.timelineStartMs,
        sourceStartMs: track.sourceStartMs,
        sourceEndMs: track.sourceEndMs ?? source?.durationMilliseconds ?? null,
        volume: track.volume,
        source,
      };
    }),
  });
}

function renderTrackShape(track: VideoCompositionAudioTrack) {
  return {
    id: track.id,
    mediaAssetId: track.mediaAssetId,
    timelineStartMs: track.timelineStartMs,
    sourceStartMs: track.sourceStartMs,
    sourceEndMs: track.sourceEndMs,
    volume: track.volume,
  };
}

export function boundVideoCompositionMatchesDocument(
  boundValue: unknown,
  documentValue: unknown,
) {
  const bound = sanitizeBoundVideoComposition(boundValue);
  if (!bound) return false;
  const durations = new Map(
    bound.audioTracks.map((track) => [
      track.mediaAssetId,
      track.source.durationMilliseconds,
    ]),
  );
  const document = sanitizeVideoComposition(documentValue, durations);
  if (!document) return false;
  return (
    JSON.stringify(
      bound.audioTracks.map((track) =>
        renderTrackShape({
          ...track,
          sourceEndMs: track.sourceEndMs,
        }),
      ),
    ) ===
    JSON.stringify(
      document.audioTracks.map((track) =>
        renderTrackShape({
          ...track,
          sourceEndMs:
            track.sourceEndMs ?? durations.get(track.mediaAssetId) ?? null,
        }),
      ),
    )
  );
}

function seconds(milliseconds: number) {
  return (milliseconds / 1_000).toFixed(3).replace(/\.?0+$/, "");
}

export function buildVideoCompositionFfmpegGraph(input: {
  composition: BoundVideoComposition;
  expectedDurationMs: number;
  includePrimaryAudio: boolean;
}) {
  const composition = sanitizeBoundVideoComposition(input.composition);
  if (
    !composition ||
    !Number.isInteger(input.expectedDurationMs) ||
    input.expectedDurationMs <= 0 ||
    input.expectedDurationMs > MAX_VIDEO_COMPOSITION_DURATION_MS
  ) {
    return null;
  }
  const duration = seconds(input.expectedDurationMs);
  const filters: string[] = [];
  const audioLabels: string[] = [];
  if (input.includePrimaryAudio) {
    filters.push(
      `[0:a:0]atrim=end=${duration},asetpts=PTS-STARTPTS[audio_base]`,
    );
    audioLabels.push("[audio_base]");
  }
  for (const [index, track] of composition.audioTracks.entries()) {
    const label = `audio_track_${index}`;
    filters.push(
      `[${index + 1}:a:0]atrim=start=${seconds(track.sourceStartMs)}:end=${seconds(track.sourceEndMs)},asetpts=PTS-STARTPTS,volume=${track.volume.toFixed(2)},adelay=${track.timelineStartMs}:all=1,aresample=async=1:first_pts=0[${label}]`,
    );
    audioLabels.push(`[${label}]`);
  }
  filters.push(
    `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,apad=pad_dur=${duration},atrim=end=${duration}[audio_out]`,
  );
  return {
    filterComplex: filters.join(";"),
    videoMap: "0:v:0",
    audioMap: "[audio_out]",
    expectedDurationMs: input.expectedDurationMs,
  };
}
