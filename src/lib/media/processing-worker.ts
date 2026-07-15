import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { parse, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";

import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { parseFile } from "music-metadata";
import sharp from "sharp";

import { db } from "@/db";
import {
  mediaAssetDerivatives,
  mediaAssets,
  mediaAssetTranscripts,
  mediaProcessingJobs,
  organizations,
  type MediaProcessingOptions,
} from "@/db/schema";
import { assertMediaContentSignature } from "@/lib/media/content-inspection";
import {
  configuredTranscriptProvider,
  MediaProcessingProviderError,
  runBoundedMediaCommand,
} from "@/lib/media/processing-provider";
import {
  deleteStoredMediaObject,
  deleteStoredMediaObjectRevision,
  getStoredMediaObjectForScanning,
  writeProcessedMediaObject,
} from "@/lib/media/storage";
import { mediaTenantQuotaLockQuery } from "@/lib/media/quota-lock";
import { resolveFilesystemMediaObjectPath } from "@/lib/media/filesystem-storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { buildMediaScanBacklogMetrics } from "@/lib/media/scan-backlog";
import {
  buildVideoEditFfmpegFilters,
  sanitizeVideoEditPlan,
} from "@/lib/media/video-edit-plan";
import {
  bindVideoCompositionSources,
  buildVideoCompositionFfmpegGraph,
  sanitizeBoundVideoComposition,
  type VideoCompositionDocument,
  videoProcessingOptionsConflict,
} from "@/lib/media/video-composition";

const PROCESSING_LEASE_MS = 30 * 60_000;
const PROCESSING_LEASE_HEARTBEAT_MS = 5 * 60_000;
const MAX_OUTPUT_BYTES = 2_000_000_000;
const MAX_FAILURE_DETAIL = 2_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type JobType = "thumbnail" | "transcode" | "transcript";

export function mediaProcessingWorkRoot(environment = process.env) {
  const configured = environment.MEDIA_PROCESSING_WORK_ROOT?.trim();
  const root = configured
    ? resolve(/* turbopackIgnore: true */ configured)
    : resolve(
        /* turbopackIgnore: true */ process.cwd(),
        ".data",
        "media-processing",
      );
  if (
    !root ||
    root === parse(root).root ||
    root.length < 8 ||
    root.includes("\0")
  ) {
    throw new MediaProcessingProviderError(
      "provider_unavailable",
      "MEDIA_PROCESSING_WORK_ROOT is not a safe isolated work directory.",
    );
  }
  return root;
}

function requestKey(input: {
  sourceAssetId: string;
  sourceContentSha256: string;
  type: JobType;
  options: MediaProcessingOptions;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        asset: input.sourceAssetId,
        digest: input.sourceContentSha256,
        type: input.type,
        options: Object.fromEntries(
          Object.entries(input.options).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      }),
    )
    .digest("hex");
}

function providerFor(type: JobType, options: MediaProcessingOptions) {
  return type === "transcript"
    ? "configured-transcript-v1"
    : options.videoComposition
      ? "ffmpeg-multitrack-v1"
      : "ffmpeg-v2";
}

type MediaProcessingRequestOptions = Omit<
  MediaProcessingOptions,
  "videoComposition" | "videoCompositionCourseId"
> & {
  videoComposition?: VideoCompositionDocument;
};

export async function enqueueMediaProcessingJob(input: {
  organizationId: string;
  sourceAssetId: string;
  requestedById?: string | null;
  type: JobType;
  options?: MediaProcessingRequestOptions;
  compositionCourseId?: string;
}) {
  const options = input.options ?? {};
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      organizationId: mediaAssets.organizationId,
      kind: mediaAssets.kind,
      status: mediaAssets.status,
      contentSha256: mediaAssets.contentSha256,
      durationMilliseconds: mediaAssets.durationMilliseconds,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, input.sourceAssetId),
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (!asset?.contentSha256 || !/^[0-9a-f]{64}$/.test(asset.contentSha256)) {
    throw new Error("Only immutable ready media can be processed.");
  }
  if (
    (input.type === "thumbnail" || input.type === "transcode") &&
    asset.kind !== "video"
  ) {
    throw new Error("The requested media processing type is incompatible.");
  }
  if (input.type === "transcript" && !["audio", "video"].includes(asset.kind)) {
    throw new Error("Only audio and video media can be transcribed.");
  }
  if (options.videoEdit && input.type !== "transcode") {
    throw new Error("Video edit options are only valid for transcodes.");
  }
  if (options.videoComposition && input.type !== "transcode") {
    throw new Error("Video compositions are only valid for transcodes.");
  }
  if (videoProcessingOptionsConflict(options)) {
    throw new Error(
      "Video compositions cannot be combined with physical video edits.",
    );
  }
  if (
    Boolean(options.videoComposition) !== Boolean(input.compositionCourseId) ||
    (input.compositionCourseId && !UUID_PATTERN.test(input.compositionCourseId))
  ) {
    throw new Error("Video compositions require an explicit course binding.");
  }
  const videoEdit = options.videoEdit
    ? sanitizeVideoEditPlan(options.videoEdit, asset.durationMilliseconds)
    : null;
  if (options.videoEdit && !videoEdit) {
    throw new Error("The video edit plan is invalid for the source duration.");
  }
  const compositionAssetIds = options.videoComposition
    ? [
        ...new Set(
          options.videoComposition.audioTracks.map(
            (track) => track.mediaAssetId,
          ),
        ),
      ]
    : [];
  const compositionSources = compositionAssetIds.length
    ? await db
        .select({
          assetId: mediaAssets.id,
          storageDriver: mediaAssets.storageDriver,
          storageKey: mediaAssets.storageKey,
          storageVersionId: mediaAssets.storageVersionId,
          etag: mediaAssets.etag,
          contentSha256: mediaAssets.contentSha256,
          sizeBytes: mediaAssets.actualSizeBytes,
          durationMilliseconds: mediaAssets.durationMilliseconds,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.organizationId, input.organizationId),
            eq(mediaAssets.purpose, "course_content"),
            eq(mediaAssets.kind, "audio"),
            eq(mediaAssets.status, "ready"),
            isNull(mediaAssets.deletedAt),
            inArray(mediaAssets.id, compositionAssetIds),
          ),
        )
    : [];
  const boundComposition = options.videoComposition
    ? bindVideoCompositionSources(
        options.videoComposition,
        compositionSources.flatMap((source) =>
          source.contentSha256 &&
          source.sizeBytes &&
          source.durationMilliseconds
            ? [
                {
                  ...source,
                  contentSha256: source.contentSha256,
                  sizeBytes: source.sizeBytes,
                  durationMilliseconds: source.durationMilliseconds,
                },
              ]
            : [],
        ),
      )
    : null;
  if (options.videoComposition && !boundComposition) {
    throw new Error(
      "The video composition contains unavailable or mutable audio sources.",
    );
  }
  const normalizedOptions: MediaProcessingOptions = {
    language: options.language,
    width: options.width,
    height: options.height,
    atMilliseconds: options.atMilliseconds,
    videoCodec: options.videoCodec,
    audioCodec: options.audioCodec,
    ...(videoEdit ? { videoEdit } : {}),
    ...(boundComposition ? { videoComposition: boundComposition } : {}),
    ...(boundComposition && input.compositionCourseId
      ? { videoCompositionCourseId: input.compositionCourseId.toLowerCase() }
      : {}),
  };
  const key = requestKey({
    sourceAssetId: asset.id,
    sourceContentSha256: asset.contentSha256,
    type: input.type,
    options: normalizedOptions,
  });
  await db
    .insert(mediaProcessingJobs)
    .values({
      organizationId: asset.organizationId,
      sourceAssetId: asset.id,
      requestedById: input.requestedById ?? null,
      type: input.type,
      requestKey: key,
      sourceContentSha256: asset.contentSha256,
      provider: providerFor(input.type, normalizedOptions),
      options: normalizedOptions,
    })
    .onConflictDoNothing({ target: mediaProcessingJobs.requestKey });
  let [job] = await db
    .select()
    .from(mediaProcessingJobs)
    .where(eq(mediaProcessingJobs.requestKey, key))
    .limit(1);
  if (!job) throw new Error("Media processing job could not be queued.");
  if (job.status === "failed" || job.status === "cancelled") {
    const [requeued] = await db
      .update(mediaProcessingJobs)
      .set({
        status: "queued",
        requestedById: input.requestedById ?? job.requestedById,
        attempt: 0,
        completedAt: null,
        failureCode: null,
        failureDetail: null,
        nextRetryAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          inArray(mediaProcessingJobs.status, ["failed", "cancelled"]),
        ),
      )
      .returning();
    if (requeued) job = requeued;
  }
  return job;
}

export async function enqueueDefaultMediaProcessingJobs(input: {
  organizationId: string;
  sourceAssetId: string;
}) {
  const [row] = await db
    .select({
      asset: mediaAssets,
      defaultLocale: organizations.defaultLocale,
    })
    .from(mediaAssets)
    .innerJoin(organizations, eq(organizations.id, mediaAssets.organizationId))
    .where(
      and(
        eq(mediaAssets.id, input.sourceAssetId),
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
      ),
    )
    .limit(1);
  if (!row || !["audio", "video"].includes(row.asset.kind)) return [];

  const requests: Array<Promise<unknown>> = [];
  if (row.asset.kind === "video") {
    requests.push(
      enqueueMediaProcessingJob({
        organizationId: input.organizationId,
        sourceAssetId: input.sourceAssetId,
        type: "thumbnail",
        options: { width: 1_280, height: 720 },
      }),
      enqueueMediaProcessingJob({
        organizationId: input.organizationId,
        sourceAssetId: input.sourceAssetId,
        type: "transcode",
        options: { videoCodec: "h264", audioCodec: "aac" },
      }),
    );
  }
  requests.push(
    enqueueMediaProcessingJob({
      organizationId: input.organizationId,
      sourceAssetId: input.sourceAssetId,
      type: "transcript",
      options: { language: row.defaultLocale },
    }),
  );
  return Promise.all(requests);
}

async function claimNextJob(now: Date) {
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select()
      .from(mediaProcessingJobs)
      .where(
        and(
          sql`${mediaProcessingJobs.attempt} < ${mediaProcessingJobs.maxAttempts}`,
          or(
            and(
              eq(mediaProcessingJobs.status, "queued"),
              or(
                isNull(mediaProcessingJobs.nextRetryAt),
                lte(mediaProcessingJobs.nextRetryAt, now),
              ),
            ),
            and(
              eq(mediaProcessingJobs.status, "processing"),
              lte(mediaProcessingJobs.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(
        asc(mediaProcessingJobs.nextRetryAt),
        asc(mediaProcessingJobs.createdAt),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const token = randomUUID();
    const [claimed] = await tx
      .update(mediaProcessingJobs)
      .set({
        status: "processing",
        attempt: sql`${mediaProcessingJobs.attempt} + 1`,
        claimToken: token,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
        nextRetryAt: null,
        failureCode: null,
        failureDetail: null,
        updatedAt: now,
      })
      .where(eq(mediaProcessingJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function withMediaProcessingLease<T>(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  if (!job.claimToken) {
    throw new Error("Media processing job has no claim token.");
  }
  const leaseController = new AbortController();
  const stopController = new AbortController();
  const heartbeat = (async () => {
    while (!stopController.signal.aborted) {
      try {
        await delay(PROCESSING_LEASE_HEARTBEAT_MS, undefined, {
          signal: stopController.signal,
        });
      } catch (error) {
        if (stopController.signal.aborted) return;
        leaseController.abort(error);
        return;
      }
      try {
        const now = new Date();
        const [extended] = await db
          .update(mediaProcessingJobs)
          .set({
            leaseExpiresAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
            updatedAt: now,
          })
          .where(
            and(
              eq(mediaProcessingJobs.id, job.id),
              eq(mediaProcessingJobs.organizationId, job.organizationId),
              eq(mediaProcessingJobs.status, "processing"),
              eq(mediaProcessingJobs.claimToken, job.claimToken!),
            ),
          )
          .returning({ id: mediaProcessingJobs.id });
        if (!extended) {
          leaseController.abort(
            new Error("Media processing claim was lost during execution."),
          );
          return;
        }
      } catch {
        leaseController.abort(
          new Error("Media processing lease heartbeat failed."),
        );
        return;
      }
    }
  })();
  try {
    return await operation(leaseController.signal);
  } finally {
    stopController.abort();
    await heartbeat;
  }
}

async function hashFile(path: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    /* turbopackIgnore: true */ path,
  )) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  signal?.throwIfAborted();
  return hash.digest("hex");
}

async function terminalFailure(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  error: unknown,
) {
  const code =
    error instanceof MediaProcessingProviderError
      ? error.code
      : "processing_failed";
  const detail =
    error instanceof Error
      ? error.message.slice(0, MAX_FAILURE_DETAIL)
      : "Media processing failed.";
  const retryable = [
    "provider_timeout",
    "provider_failed",
    "processing_failed",
  ].includes(code);
  const canRetry = retryable && job.attempt < job.maxAttempts;
  const now = new Date();
  await db
    .update(mediaProcessingJobs)
    .set({
      status: canRetry ? "queued" : "failed",
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      nextRetryAt: canRetry
        ? new Date(
            now.getTime() +
              Math.min(30_000 * 2 ** (job.attempt - 1), 3_600_000),
          )
        : null,
      completedAt: canRetry ? null : now,
      failureCode: canRetry ? null : code,
      failureDetail: canRetry ? null : detail,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaProcessingJobs.id, job.id),
        eq(mediaProcessingJobs.claimToken, job.claimToken!),
        eq(mediaProcessingJobs.status, "processing"),
      ),
    );
  return {
    id: job.id,
    type: job.type,
    status: canRetry ? "retry" : "failed",
    code,
  };
}

async function completeTranscript(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  inputPath: string,
  workDirectory: string,
  signal: AbortSignal,
) {
  const provider = configuredTranscriptProvider();
  const language =
    typeof job.options.language === "string" &&
    /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(job.options.language)
      ? job.options.language
      : "de";
  const document = await provider.transcribe({
    inputPath,
    outputPath: resolve(
      /* turbopackIgnore: true */ workDirectory,
      "transcript.vtt",
    ),
    language,
    sourceSha256: job.sourceContentSha256,
    signal,
  });
  signal.throwIfAborted();
  return db.transaction(async (tx) => {
    const [transcript] = await tx
      .insert(mediaAssetTranscripts)
      .values({
        organizationId: job.organizationId,
        sourceAssetId: job.sourceAssetId,
        processingJobId: job.id,
        sourceContentSha256: job.sourceContentSha256,
        language: document.language,
        provider: provider.id,
        document,
      })
      .returning({ id: mediaAssetTranscripts.id });
    if (!transcript) throw new Error("Transcript result could not be stored.");
    const [completed] = await tx
      .update(mediaProcessingJobs)
      .set({
        status: "succeeded",
        result: { transcriptId: transcript.id },
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          eq(mediaProcessingJobs.claimToken, job.claimToken!),
          eq(mediaProcessingJobs.status, "processing"),
        ),
      )
      .returning({ id: mediaProcessingJobs.id });
    if (!completed) throw new Error("Media processing claim was lost.");
    return { id: job.id, type: job.type, status: "succeeded" as const };
  });
}

async function deleteFailedDerivativeWhileClaimOwned(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  identity: Readonly<{
    organizationId: string;
    assetId: string;
    key: string;
  }>,
) {
  if (!job.claimToken) return false;
  return db.transaction(async (tx) => {
    const [ownedClaim] = await tx
      .select({ id: mediaProcessingJobs.id })
      .from(mediaProcessingJobs)
      .where(
        and(
          eq(mediaProcessingJobs.id, job.id),
          eq(mediaProcessingJobs.organizationId, job.organizationId),
          eq(mediaProcessingJobs.sourceAssetId, job.sourceAssetId),
          eq(mediaProcessingJobs.status, "processing"),
          eq(mediaProcessingJobs.claimToken, job.claimToken!),
        ),
      )
      .limit(1)
      .for("update");
    if (!ownedClaim) return false;

    const [derivative] = await tx
      .select({ id: mediaAssetDerivatives.id })
      .from(mediaAssetDerivatives)
      .where(
        and(
          eq(mediaAssetDerivatives.processingJobId, job.id),
          eq(mediaAssetDerivatives.organizationId, job.organizationId),
        ),
      )
      .limit(1);
    if (derivative) return false;

    // Keep the claim row locked across the unversioned delete. A reclaimer must
    // not be able to publish the same job key between authorization and cleanup.
    await deleteStoredMediaObject(identity);
    return true;
  });
}

async function completeDerivative(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  inputPath: string,
  workDirectory: string,
  sourceDurationMilliseconds: number | null,
  compositionInputPaths: readonly string[],
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const ffmpeg = process.env.MEDIA_FFMPEG_PATH?.trim() || "ffmpeg";
  const thumbnail = job.type === "thumbnail";
  if (!thumbnail && videoProcessingOptionsConflict(job.options)) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "Video compositions cannot be combined with physical video edits.",
    );
  }
  const extension = thumbnail ? "jpg" : "mp4";
  const outputPath = resolve(
    /* turbopackIgnore: true */ workDirectory,
    `output.${extension}`,
  );
  const editFilters =
    !thumbnail && job.options.videoEdit && sourceDurationMilliseconds
      ? buildVideoEditFfmpegFilters(
          job.options.videoEdit,
          sourceDurationMilliseconds,
        )
      : null;
  if (!thumbnail && job.options.videoEdit && !editFilters) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The video edit plan cannot be applied to this source.",
    );
  }
  const composition =
    !thumbnail && job.options.videoComposition
      ? sanitizeBoundVideoComposition(job.options.videoComposition)
      : null;
  if (!thumbnail && job.options.videoComposition && !composition) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The bound video composition is invalid.",
    );
  }
  if (
    composition &&
    compositionInputPaths.length !== composition.audioTracks.length
  ) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The video composition sources are incomplete.",
    );
  }
  const compositionDurationMs = sourceDurationMilliseconds;
  let compositionGraph: ReturnType<typeof buildVideoCompositionFfmpegGraph> =
    null;
  if (composition) {
    if (!compositionDurationMs) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "The primary video duration is unavailable for composition.",
      );
    }
    const ffprobe = process.env.MEDIA_FFPROBE_PATH?.trim() || "ffprobe";
    const primaryAudioStream = await runBoundedMediaCommand({
      executable: ffprobe,
      arguments: [
        "-v",
        "error",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=index",
        "-of",
        "csv=p=0",
        inputPath,
      ],
      captureStdoutBytes: 1_024,
      timeoutMs: 30_000,
      signal,
    });
    compositionGraph = buildVideoCompositionFfmpegGraph({
      composition,
      expectedDurationMs: compositionDurationMs,
      includePrimaryAudio: Boolean(primaryAudioStream.trim()),
    });
    if (!compositionGraph) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "The video composition filter graph cannot be built.",
      );
    }
  }
  const args = thumbnail
    ? [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(
          Math.max(0, Math.min(job.options.atMilliseconds ?? 0, 604_800_000)) /
            1_000,
        ),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        "-y",
        outputPath,
      ]
    : compositionGraph
      ? [
          "-nostdin",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          inputPath,
          ...compositionInputPaths.flatMap((path) => ["-i", path]),
          "-map_metadata",
          "-1",
          "-filter_complex",
          compositionGraph.filterComplex,
          "-map",
          compositionGraph.videoMap,
          "-map",
          compositionGraph.audioMap,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-y",
          outputPath,
        ]
      : editFilters
        ? [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            inputPath,
            "-map_metadata",
            "-1",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            editFilters.video,
            "-af",
            editFilters.audio,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            outputPath,
          ]
        : [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            inputPath,
            "-map_metadata",
            "-1",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            outputPath,
          ];
  await runBoundedMediaCommand({
    executable: ffmpeg,
    arguments: args,
    signal,
  });
  signal.throwIfAborted();
  const details = await stat(/* turbopackIgnore: true */ outputPath);
  if (
    !details.isFile() ||
    details.size <= 0 ||
    details.size > MAX_OUTPUT_BYTES
  ) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "Media derivative has an invalid size.",
    );
  }
  const prefix = await readFilePrefix(outputPath, 512);
  const mimeType = thumbnail ? "image/jpeg" : "video/mp4";
  assertMediaContentSignature(mimeType, prefix);
  const digest = await hashFile(outputPath, signal);
  let width: number | null = null;
  let height: number | null = null;
  let durationMilliseconds: number | null = null;
  if (thumbnail) {
    const metadata = await sharp(outputPath, {
      limitInputPixels: 40_000_000,
    }).metadata();
    width = metadata.width ?? null;
    height = metadata.height ?? null;
    if (!width || !height || width > 1_280 || height > 720) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "Thumbnail dimensions are invalid.",
      );
    }
  } else {
    const metadata = await parseFile(outputPath, {
      duration: true,
      skipCovers: true,
    });
    durationMilliseconds = Math.round(Number(metadata.format.duration) * 1_000);
    if (
      !Number.isSafeInteger(durationMilliseconds) ||
      durationMilliseconds <= 0
    ) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "Transcoded video duration is invalid.",
      );
    }
    const expectedDurationMs =
      compositionGraph?.expectedDurationMs ??
      editFilters?.expectedDurationMs ??
      null;
    if (
      expectedDurationMs &&
      Math.abs(durationMilliseconds - expectedDurationMs) >
        Math.max(1_500, expectedDurationMs * 0.03)
    ) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "The edited derivative duration does not match the requested segments.",
      );
    }
  }
  signal.throwIfAborted();
  const storageKey = `tenants/${job.organizationId}/assets/${job.sourceAssetId}/${thumbnail ? "thumbnail" : "transcode"}-${job.id}.${extension}`;
  const identity = {
    organizationId: job.organizationId,
    assetId: job.sourceAssetId,
    key: storageKey,
  };
  const storageConfiguration = getMediaStorageConfiguration();
  let stored: Awaited<ReturnType<typeof writeProcessedMediaObject>> | null =
    null;
  try {
    const storedObject = await writeProcessedMediaObject({
      identity,
      body: createReadStream(/* turbopackIgnore: true */ outputPath),
      mimeType,
      expectedSizeBytes: details.size,
      contentSha256: digest,
      sourceSha256: job.sourceContentSha256,
      processingJobId: job.id,
    });
    stored = storedObject;
    signal.throwIfAborted();
    return await db.transaction(async (tx) => {
      const [ownedClaim] = await tx
        .select({ id: mediaProcessingJobs.id })
        .from(mediaProcessingJobs)
        .where(
          and(
            eq(mediaProcessingJobs.id, job.id),
            eq(mediaProcessingJobs.organizationId, job.organizationId),
            eq(mediaProcessingJobs.status, "processing"),
            eq(mediaProcessingJobs.claimToken, job.claimToken!),
          ),
        )
        .limit(1)
        .for("update");
      if (!ownedClaim) throw new Error("Media processing claim was lost.");

      await tx.execute(mediaTenantQuotaLockQuery(job.organizationId));
      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, job.organizationId))
        .limit(1);
      if (!organization) {
        throw new MediaProcessingProviderError(
          "provider_failed",
          "Media processing organization no longer exists.",
        );
      }
      const [usage] = await tx
        .select({
          bytes: sql<number>`coalesce((select sum(${mediaAssets.quotaBytes}) from ${mediaAssets} where ${mediaAssets.organizationId} = ${job.organizationId}), 0) + coalesce(sum(${mediaAssetDerivatives.sizeBytes}), 0)`,
        })
        .from(mediaAssetDerivatives)
        .where(eq(mediaAssetDerivatives.organizationId, job.organizationId));
      const quota = storageConfiguration.limits.tenantQuotaBytes;
      if (Number(usage?.bytes ?? 0) + details.size > quota) {
        throw new MediaProcessingProviderError(
          "invalid_output",
          "Media derivative exceeds tenant quota.",
        );
      }
      const [derivative] = await tx
        .insert(mediaAssetDerivatives)
        .values({
          organizationId: job.organizationId,
          sourceAssetId: job.sourceAssetId,
          processingJobId: job.id,
          kind: thumbnail ? "thumbnail" : "transcode",
          storageDriver: storageConfiguration.driver,
          storageKey,
          storageVersionId: storedObject.versionId,
          storageEtag: storedObject.etag,
          mimeType,
          sizeBytes: details.size,
          contentSha256: digest,
          durationMilliseconds,
          width,
          height,
        })
        .returning({ id: mediaAssetDerivatives.id });
      if (!derivative) throw new Error("Media derivative could not be stored.");
      const [completed] = await tx
        .update(mediaProcessingJobs)
        .set({
          status: "succeeded",
          result: { derivativeId: derivative.id },
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaProcessingJobs.id, job.id),
            eq(mediaProcessingJobs.claimToken, job.claimToken!),
            eq(mediaProcessingJobs.status, "processing"),
          ),
        )
        .returning({ id: mediaProcessingJobs.id });
      if (!completed) throw new Error("Media processing claim was lost.");
      return { id: job.id, type: job.type, status: "succeeded" as const };
    });
  } catch (error) {
    if (storageConfiguration.driver === "filesystem" && stored) {
      try {
        await deleteFailedDerivativeWhileClaimOwned(job, identity);
      } catch {
        throw new Error("Filesystem derivative cleanup could not be verified.");
      }
    } else if (
      storageConfiguration.driver === "s3" &&
      storageConfiguration.compatibilityMode === "versioned" &&
      stored?.versionId
    ) {
      try {
        await deleteStoredMediaObjectRevision(identity, stored.versionId);
      } catch {
        throw new Error("Versioned S3 derivative cleanup could not be verified.");
      }
    } else if (
      storageConfiguration.driver === "s3" &&
      storageConfiguration.compatibilityMode === "strato-hidrive"
    ) {
      try {
        await deleteFailedDerivativeWhileClaimOwned(job, identity);
      } catch {
        // Do not finalize a quota or provider failure while an untracked STRATO
        // object may remain. A generic error keeps cleanup retryable and fenced.
        throw new Error("STRATO derivative cleanup could not be verified.");
      }
    }
    throw error;
  }
}

async function readFilePrefix(path: string, length: number) {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of createReadStream(/* turbopackIgnore: true */ path, {
    start: 0,
    end: length - 1,
  })) {
    const bytes = Buffer.from(chunk);
    chunks.push(bytes);
    received += bytes.length;
  }
  return Buffer.concat(chunks, received);
}

async function materializeImmutableSource(
  source: {
    id: string;
    organizationId: string;
    storageKey: string;
    etag: string | null;
    storageVersionId: string | null;
    contentSha256: string | null;
    actualSizeBytes: number | null;
  },
  workDirectory: string,
  fileName = "source.bin",
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (
    !source.etag ||
    !source.storageVersionId ||
    !source.contentSha256 ||
    !Number.isSafeInteger(source.actualSizeBytes) ||
    Number(source.actualSizeBytes) <= 0 ||
    Number(source.actualSizeBytes) > MAX_OUTPUT_BYTES
  ) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The S3 source has no bounded immutable object identity.",
    );
  }
  const object = await getStoredMediaObjectForScanning(
    {
      organizationId: source.organizationId,
      assetId: source.id,
      key: source.storageKey,
    },
    source.etag,
    source.storageVersionId,
  );
  signal?.throwIfAborted();
  if (object.sizeBytes !== source.actualSizeBytes) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The immutable S3 source size no longer matches the database identity.",
    );
  }
  const inputPath = resolve(
    /* turbopackIgnore: true */ workDirectory,
    fileName,
  );
  await pipeline(
    object.body,
    createWriteStream(/* turbopackIgnore: true */ inputPath, {
      flags: "wx",
      mode: 0o600,
    }),
    { signal },
  );
  signal?.throwIfAborted();
  const details = await stat(/* turbopackIgnore: true */ inputPath);
  const digest = await hashFile(inputPath, signal);
  if (
    details.size !== source.actualSizeBytes ||
    digest !== source.contentSha256
  ) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The downloaded S3 source failed digest verification.",
    );
  }
  return inputPath;
}

async function materializeCompositionInputs(
  organizationId: string,
  compositionValue: unknown,
  workDirectory: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const composition = sanitizeBoundVideoComposition(compositionValue);
  if (!composition) return [];
  const ids = [
    ...new Set(composition.audioTracks.map((track) => track.mediaAssetId)),
  ];
  const rows = await db
    .select({
      id: mediaAssets.id,
      organizationId: mediaAssets.organizationId,
      storageDriver: mediaAssets.storageDriver,
      storageKey: mediaAssets.storageKey,
      storageVersionId: mediaAssets.storageVersionId,
      etag: mediaAssets.etag,
      contentSha256: mediaAssets.contentSha256,
      actualSizeBytes: mediaAssets.actualSizeBytes,
      durationMilliseconds: mediaAssets.durationMilliseconds,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.kind, "audio"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
        inArray(mediaAssets.id, ids),
      ),
    );
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const configuration = getMediaStorageConfiguration();
  const paths: string[] = [];
  for (const [index, track] of composition.audioTracks.entries()) {
    signal.throwIfAborted();
    const row = rowsById.get(track.mediaAssetId);
    const identity = track.source;
    if (
      !row ||
      row.storageDriver !== identity.storageDriver ||
      row.storageKey !== identity.storageKey ||
      row.storageVersionId !== identity.storageVersionId ||
      row.etag !== identity.etag ||
      row.contentSha256 !== identity.contentSha256 ||
      row.actualSizeBytes !== identity.sizeBytes ||
      row.durationMilliseconds !== identity.durationMilliseconds
    ) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "A bound composition source no longer matches its immutable identity.",
      );
    }
    if (configuration.driver !== row.storageDriver) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "The composition source storage driver no longer matches the runtime.",
      );
    }
    const path =
      configuration.driver === "filesystem"
        ? resolveFilesystemMediaObjectPath(configuration, {
            organizationId,
            assetId: row.id,
            key: row.storageKey,
          })
        : await materializeImmutableSource(
            row,
            workDirectory,
            `source-audio-${index + 1}.bin`,
            signal,
          );
    const details = await stat(/* turbopackIgnore: true */ path);
    const digest = await hashFile(path, signal);
    if (
      details.size !== identity.sizeBytes ||
      digest !== identity.contentSha256
    ) {
      throw new MediaProcessingProviderError(
        "invalid_output",
        "A composition source failed immutable digest verification.",
      );
    }
    paths.push(path);
  }
  return paths;
}

async function processClaimedJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const configuration = getMediaStorageConfiguration();
  const [source] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, job.sourceAssetId),
        eq(mediaAssets.organizationId, job.organizationId),
        eq(mediaAssets.status, "ready"),
        eq(mediaAssets.contentSha256, job.sourceContentSha256),
      ),
    )
    .limit(1);
  if (!source) {
    throw new MediaProcessingProviderError(
      "invalid_output",
      "The immutable source media is no longer available.",
    );
  }
  signal.throwIfAborted();
  const root = mediaProcessingWorkRoot();
  const workDirectory = resolve(/* turbopackIgnore: true */ root, job.id);
  if (
    !workDirectory.startsWith(`${root}\\`) &&
    !workDirectory.startsWith(`${root}/`)
  ) {
    throw new Error("Invalid media processing work directory.");
  }
  await mkdir(/* turbopackIgnore: true */ workDirectory, {
    recursive: true,
    mode: 0o700,
  });
  try {
    const inputPath =
      configuration.driver === "filesystem"
        ? resolveFilesystemMediaObjectPath(configuration, {
            organizationId: source.organizationId,
            assetId: source.id,
            key: source.storageKey,
          })
        : await materializeImmutableSource(
            source,
            workDirectory,
            "source.bin",
            signal,
          );
    const compositionInputPaths = job.options.videoComposition
      ? await materializeCompositionInputs(
          job.organizationId,
          job.options.videoComposition,
          workDirectory,
          signal,
        )
      : [];
    signal.throwIfAborted();
    return job.type === "transcript"
      ? await completeTranscript(job, inputPath, workDirectory, signal)
      : await completeDerivative(
          job,
          inputPath,
          workDirectory,
          source.durationMilliseconds,
          compositionInputPaths,
          signal,
        );
  } finally {
    await rm(/* turbopackIgnore: true */ workDirectory, {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}

export async function processMediaProcessingQueue(limit = 1) {
  const boundedLimit = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), 5)
    : 1;
  const results = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const job = await claimNextJob(new Date());
    if (!job) break;
    try {
      results.push(
        await withMediaProcessingLease(job, (signal) =>
          processClaimedJob(job, signal),
        ),
      );
    } catch (error) {
      results.push(await terminalFailure(job, error));
    }
  }
  return results;
}

export async function readMediaProcessingBacklogMetrics(now = new Date()) {
  const [backlog] = await db
    .select({
      depth: sql<number>`count(*) filter (where ${mediaProcessingJobs.status} in ('queued', 'processing'))::int`,
      failed: sql<number>`count(*) filter (where ${mediaProcessingJobs.status} = 'failed')::int`,
      oldestQueuedAt: sql<unknown>`min(${mediaProcessingJobs.createdAt}) filter (where ${mediaProcessingJobs.status} in ('queued', 'processing'))`,
    })
    .from(mediaProcessingJobs)
    .where(
      inArray(mediaProcessingJobs.status, ["queued", "processing", "failed"]),
    );
  return buildMediaScanBacklogMetrics({
    depth: Number(backlog?.depth ?? 0),
    failed: Number(backlog?.failed ?? 0),
    oldestQueuedAt: backlog?.oldestQueuedAt ?? null,
    nowMilliseconds: now.getTime(),
  });
}

export async function cleanupMediaProcessingArtifacts(limit = 5) {
  const boundedLimit = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), 25)
    : 5;
  const rows = await db
    .select({ derivative: mediaAssetDerivatives })
    .from(mediaAssetDerivatives)
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, mediaAssetDerivatives.sourceAssetId),
        eq(mediaAssets.organizationId, mediaAssetDerivatives.organizationId),
        inArray(mediaAssets.status, ["deleted", "quarantined", "failed"]),
      ),
    )
    .orderBy(asc(mediaAssetDerivatives.createdAt))
    .limit(boundedLimit);
  let removed = 0;
  for (const { derivative } of rows) {
    await deleteStoredMediaObject({
      organizationId: derivative.organizationId,
      assetId: derivative.sourceAssetId,
      key: derivative.storageKey,
    });
    const [deleted] = await db
      .delete(mediaAssetDerivatives)
      .where(
        and(
          eq(mediaAssetDerivatives.id, derivative.id),
          eq(mediaAssetDerivatives.contentSha256, derivative.contentSha256),
        ),
      )
      .returning({ id: mediaAssetDerivatives.id });
    if (deleted) removed += 1;
  }
  const now = new Date();
  await db
    .update(mediaProcessingJobs)
    .set({
      status: "cancelled",
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      nextRetryAt: null,
      completedAt: now,
      failureCode: "source_unavailable",
      failureDetail: "Source media left the ready state.",
      updatedAt: now,
    })
    .where(
      and(
        inArray(mediaProcessingJobs.status, ["queued", "processing"]),
        sql`exists (
          select 1 from ${mediaAssets}
          where ${mediaAssets.id} = ${mediaProcessingJobs.sourceAssetId}
            and ${mediaAssets.organizationId} = ${mediaProcessingJobs.organizationId}
            and ${mediaAssets.status} in ('deleted', 'quarantined', 'failed')
        )`,
      ),
    );
  return removed;
}
