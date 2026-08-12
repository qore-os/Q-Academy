import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import {
  activityEvents,
  contentBlocks,
  courseMediaAssets,
  courseModules,
  lessons,
  mediaAssets,
  mediaAssetTranscripts,
  modules,
  privacyLegalHolds,
  videoDescriptionJobs,
  type ContentBlockData,
  type VideoDescriptionJobStatus,
} from "@/db/schema";
import { generateVideoDescription } from "@/lib/ai/video-description-provider";
import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
} from "@/lib/auth-rate-limit";
import { sanitizeVideoTranscriptDocument } from "@/lib/content-blocks/video-transcript";
import type { AppLocale } from "@/lib/i18n/model";
import {
  acquireProviderCircuitPermission,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
} from "@/lib/provider-circuit-breaker";
import { logServerError } from "@/lib/server-error-logging";
import { lockPrivacyLegalHoldSubjects } from "@/lib/privacy/legal-hold-lock";
import { privacySubjectReference } from "@/lib/privacy/subject-reference";
import { enqueueReadyTranscriptInTransaction } from "@/lib/media/processing-worker";

const JOB_LEASE_MS = 2 * 60_000;
const TRANSCRIPT_WAIT_MS = 30_000;
const MAXIMUM_TRANSCRIPT_WAIT_MS = 24 * 60 * 60_000;
const FAILURE_DETAIL_LIMIT = 80;
const TRANSCRIPT_LANGUAGE_PATTERN =
  /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

type VideoDescriptionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

function copiedVideoTranscriptLanguage(
  data: ContentBlockData,
  fallback: AppLocale,
) {
  const candidate = data.transcriptLanguage ?? data.transcript?.language ?? fallback;
  if (typeof candidate !== "string") return fallback;
  const normalized = candidate.trim().toLowerCase();
  return TRANSCRIPT_LANGUAGE_PATTERN.test(normalized) ? normalized : fallback;
}

function requestKey(input: {
  organizationId: string;
  blockId: string;
  sourceAssetId: string;
  sourceContentSha256: string;
  expectedBlockRevision: number;
  locale: AppLocale;
  transcriptLanguage: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

export async function enqueueVideoDescriptionJobInTransaction(
  transaction: VideoDescriptionTransaction,
  input: {
    organizationId: string;
    originCourseId: string;
    blockId: string;
    sourceAssetId: string;
    sourceContentSha256: string;
    expectedBlockRevision: number;
    locale: AppLocale;
    transcriptLanguage: string;
    requestedById: string;
  },
) {
  if (!/^[0-9a-f]{64}$/.test(input.sourceContentSha256)) {
    throw new Error("Only immutable ready video content can be described.");
  }
  const [eligible] = await transaction
    .select({
      blockId: contentBlocks.id,
      blockData: contentBlocks.data,
      assetId: mediaAssets.id,
    })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.organizationId, input.organizationId),
        eq(courseModules.courseId, input.originCourseId),
      ),
    )
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, input.sourceAssetId),
        eq(mediaAssets.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      courseMediaAssets,
      and(
        eq(courseMediaAssets.organizationId, input.organizationId),
        eq(courseMediaAssets.courseId, input.originCourseId),
        eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
      ),
    )
    .where(
      and(
        eq(contentBlocks.id, input.blockId),
        eq(contentBlocks.type, "video"),
        eq(contentBlocks.revision, input.expectedBlockRevision),
        eq(modules.organizationId, input.organizationId),
        eq(mediaAssets.kind, "video"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
        eq(mediaAssets.contentSha256, input.sourceContentSha256),
      ),
    )
    .limit(1);
  if (!eligible || eligible.blockData.mediaAssetId !== input.sourceAssetId) {
    throw new Error("Video description context is unavailable.");
  }
  const key = requestKey({
    organizationId: input.organizationId,
    blockId: input.blockId,
    sourceAssetId: input.sourceAssetId,
    sourceContentSha256: input.sourceContentSha256,
    expectedBlockRevision: input.expectedBlockRevision,
    locale: input.locale,
    transcriptLanguage: input.transcriptLanguage,
  });
  await transaction
    .insert(videoDescriptionJobs)
    .values({
      organizationId: input.organizationId,
      originCourseId: input.originCourseId,
      liveBlockId: input.blockId,
      blockReferenceId: input.blockId,
      liveSourceAssetId: input.sourceAssetId,
      sourceAssetReferenceId: input.sourceAssetId,
      requestedById: input.requestedById,
      requesterSubjectReference: privacySubjectReference(
        input.organizationId,
        input.requestedById,
      ),
      sourceContentSha256: input.sourceContentSha256,
      locale: input.locale,
      transcriptLanguage: input.transcriptLanguage,
      expectedBlockRevision: input.expectedBlockRevision,
      requestKey: key,
      deadlineAt: new Date(Date.now() + MAXIMUM_TRANSCRIPT_WAIT_MS),
    })
    .onConflictDoNothing({ target: videoDescriptionJobs.requestKey });
  const [job] = await transaction
    .select({ id: videoDescriptionJobs.id })
    .from(videoDescriptionJobs)
    .where(eq(videoDescriptionJobs.requestKey, key))
    .limit(1);
  if (!job) throw new Error("Video description job could not be queued.");
  return job;
}

async function claimNextVideoDescriptionJob() {
  const now = new Date();
  const claimToken = randomUUID();
  return db.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(videoDescriptionJobs)
      .where(
        and(
          sql`${videoDescriptionJobs.attempt} < ${videoDescriptionJobs.maxAttempts}`,
          or(
            and(
              eq(videoDescriptionJobs.status, "queued"),
              or(
                isNull(videoDescriptionJobs.nextRetryAt),
                lte(videoDescriptionJobs.nextRetryAt, now),
              ),
            ),
            and(
              eq(videoDescriptionJobs.status, "processing"),
              lte(videoDescriptionJobs.leaseExpiresAt, now),
            ),
          ),
        ),
      )
      .orderBy(
        sql`coalesce(${videoDescriptionJobs.nextRetryAt}, ${videoDescriptionJobs.createdAt}) asc`,
        asc(videoDescriptionJobs.createdAt),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await transaction
      .update(videoDescriptionJobs)
      .set({
        status: "processing",
        claimToken,
        claimedAt: now,
        leaseExpiresAt: new Date(now.getTime() + JOB_LEASE_MS),
        nextRetryAt: null,
        updatedAt: now,
      })
      .where(eq(videoDescriptionJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

export async function enqueueCopiedVideoDescriptionJobsInTransaction(
  transaction: VideoDescriptionTransaction,
  input: {
    organizationId: string;
    originCourseId: string;
    requestedById: string;
    blocks: Array<{
      id: string;
      type: string;
      data: ContentBlockData;
      revision?: number;
    }>;
    locale: AppLocale;
  },
) {
  const candidates = input.blocks.filter(
    (block) =>
      block.type === "video" &&
      block.data.videoDescriptionIntent === "automatic" &&
      !(block.data.caption ?? "").trim() &&
      typeof block.data.mediaAssetId === "string" &&
      Boolean(block.data.mediaAssetId),
  );
  if (!candidates.length) return [];
  const assetIds = [
    ...new Set(candidates.map((block) => block.data.mediaAssetId!)),
  ];
  const assets = await transaction
    .select({ id: mediaAssets.id, contentSha256: mediaAssets.contentSha256 })
    .from(mediaAssets)
    .innerJoin(
      courseMediaAssets,
      and(
        eq(courseMediaAssets.organizationId, input.organizationId),
        eq(courseMediaAssets.courseId, input.originCourseId),
        eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
      ),
    )
    .where(
      and(
        inArray(mediaAssets.id, assetIds),
        eq(mediaAssets.organizationId, input.organizationId),
        eq(mediaAssets.kind, "video"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
      ),
    )
    .for("share", { of: mediaAssets });
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const jobs = [];
  for (const block of candidates) {
    const asset = assetsById.get(block.data.mediaAssetId!);
    if (!asset?.contentSha256) {
      throw new Error("Copied automatic video description is unavailable.");
    }
    const transcriptLanguage = copiedVideoTranscriptLanguage(
      block.data,
      input.locale,
    );
    await enqueueReadyTranscriptInTransaction(transaction, {
      organizationId: input.organizationId,
      sourceAssetId: asset.id,
      sourceContentSha256: asset.contentSha256,
      requestedById: input.requestedById,
      language: transcriptLanguage,
    });
    jobs.push(
      await enqueueVideoDescriptionJobInTransaction(transaction, {
        organizationId: input.organizationId,
        originCourseId: input.originCourseId,
        blockId: block.id,
        sourceAssetId: asset.id,
        sourceContentSha256: asset.contentSha256,
        expectedBlockRevision: block.revision ?? 1,
        locale: input.locale,
        transcriptLanguage,
        requestedById: input.requestedById,
      }),
    );
  }
  return jobs;
}

async function releaseClaim(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
  input: {
    status?: VideoDescriptionJobStatus;
    failureCode?: string | null;
    nextRetryAt?: Date | null;
    completedAt?: Date | null;
    incrementAttempt?: boolean;
    clearGeneratedDescription?: boolean;
  },
) {
  const now = new Date();
  const status = input.status ?? "queued";
  await db
    .update(videoDescriptionJobs)
    .set({
      status,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      nextRetryAt: input.nextRetryAt ?? null,
      completedAt: input.completedAt ?? null,
      failureCode: input.failureCode ?? null,
      ...(input.incrementAttempt
        ? { attempt: sql`${videoDescriptionJobs.attempt} + 1` }
        : {}),
      ...(input.clearGeneratedDescription
        ? { generatedDescription: null }
        : {}),
      updatedAt: now,
    })
    .where(
      and(
        eq(videoDescriptionJobs.id, job.id),
        eq(videoDescriptionJobs.status, "processing"),
        eq(videoDescriptionJobs.claimToken, job.claimToken!),
      ),
    );
}

async function readJobContext(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
) {
  if (!job.liveBlockId || !job.liveSourceAssetId) return null;
  const [context] = await db
    .select({
      blockType: contentBlocks.type,
      blockTitle: contentBlocks.title,
      blockData: contentBlocks.data,
      blockRevision: contentBlocks.revision,
      assetStatus: mediaAssets.status,
      assetKind: mediaAssets.kind,
      assetContentSha256: mediaAssets.contentSha256,
      assetOriginalFileName: mediaAssets.originalFileName,
      assetDurationMilliseconds: mediaAssets.durationMilliseconds,
      assetDeletedAt: mediaAssets.deletedAt,
    })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(modules, eq(modules.id, lessons.moduleId))
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.organizationId, job.organizationId),
      ),
    )
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, job.liveSourceAssetId),
        eq(mediaAssets.organizationId, job.organizationId),
      ),
    )
    .where(
      and(
        eq(contentBlocks.id, job.liveBlockId),
        eq(modules.organizationId, job.organizationId),
      ),
    )
    .limit(1);
  return context ?? null;
}

function contextStillEligible(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
  context: NonNullable<Awaited<ReturnType<typeof readJobContext>>>,
) {
  return (
    context.blockType === "video" &&
    context.blockRevision === job.expectedBlockRevision &&
    context.blockData.mediaAssetId === job.liveSourceAssetId &&
    !(context.blockData.caption ?? "").trim() &&
    context.assetStatus === "ready" &&
    context.assetKind === "video" &&
    context.assetDeletedAt === null &&
    context.assetContentSha256 === job.sourceContentSha256 &&
    Boolean(context.assetDurationMilliseconds)
  );
}

async function applyDescription(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
  description: string,
) {
  const now = new Date();
  if (!job.liveBlockId || !job.liveSourceAssetId) {
    await releaseClaim(job, {
      status: "superseded",
      failureCode: "content_deleted",
      completedAt: now,
      clearGeneratedDescription: true,
    });
    return { status: "superseded" as const, courseIds: [] };
  }
  const liveBlockId = job.liveBlockId;
  const liveSourceAssetId = job.liveSourceAssetId;
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        type: contentBlocks.type,
        title: contentBlocks.title,
        data: contentBlocks.data,
        revision: contentBlocks.revision,
        moduleOrganizationId: modules.organizationId,
        moduleId: modules.id,
      })
      .from(contentBlocks)
      .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(eq(contentBlocks.id, liveBlockId))
      .limit(1)
      .for("update", { of: contentBlocks });
    const courseMemberships = current
      ? await transaction
          .select({ courseId: courseModules.courseId })
          .from(courseModules)
          .where(
            and(
              eq(courseModules.moduleId, current.moduleId),
              eq(courseModules.organizationId, job.organizationId),
            ),
          )
          .for("share", { of: courseModules })
      : [];
    const [currentAsset] = await transaction
      .select({
        status: mediaAssets.status,
        kind: mediaAssets.kind,
        contentSha256: mediaAssets.contentSha256,
        deletedAt: mediaAssets.deletedAt,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, liveSourceAssetId),
          eq(mediaAssets.organizationId, job.organizationId),
        ),
      )
      .limit(1)
      .for("share");
    const [ownedJob] = await transaction
      .select({
        id: videoDescriptionJobs.id,
        requestedById: videoDescriptionJobs.requestedById,
        generatedDescription: videoDescriptionJobs.generatedDescription,
        liveBlockId: videoDescriptionJobs.liveBlockId,
        liveSourceAssetId: videoDescriptionJobs.liveSourceAssetId,
      })
      .from(videoDescriptionJobs)
      .where(
        and(
          eq(videoDescriptionJobs.id, job.id),
          eq(videoDescriptionJobs.status, "processing"),
          eq(videoDescriptionJobs.claimToken, job.claimToken!),
        ),
      )
      .limit(1)
      .for("update");
    if (!ownedJob) return { status: "claim_lost" as const, courseIds: [] };
    if (
      !ownedJob.requestedById ||
      ownedJob.requestedById !== job.requestedById ||
      ownedJob.generatedDescription !== description
    ) {
      const [superseded] = await transaction
        .update(videoDescriptionJobs)
        .set({
          status: "superseded",
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          generatedDescription: null,
          completedAt: now,
          failureCode: "requester_unlinked",
          updatedAt: now,
        })
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        )
        .returning({ id: videoDescriptionJobs.id });
      if (!superseded) throw new Error("Video description claim was lost.");
      return { status: "superseded" as const, courseIds: [] };
    }
    if (
      ownedJob.liveBlockId !== liveBlockId ||
      ownedJob.liveSourceAssetId !== liveSourceAssetId ||
      !current ||
      !courseMemberships.length ||
      !currentAsset ||
      currentAsset.status !== "ready" ||
      currentAsset.kind !== "video" ||
      currentAsset.contentSha256 !== job.sourceContentSha256 ||
      currentAsset.deletedAt !== null ||
      current.moduleOrganizationId !== job.organizationId ||
      current.type !== "video" ||
      current.revision !== job.expectedBlockRevision ||
      current.data.mediaAssetId !== liveSourceAssetId ||
      (current.data.caption ?? "").trim()
    ) {
      const [superseded] = await transaction
        .update(videoDescriptionJobs)
        .set({
          status: "superseded",
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
          generatedDescription: null,
          completedAt: now,
          failureCode: "content_changed",
          updatedAt: now,
        })
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        )
        .returning({ id: videoDescriptionJobs.id });
      if (!superseded) throw new Error("Video description claim was lost.");
      return { status: "superseded" as const, courseIds: [] };
    }
    const data: ContentBlockData = { ...current.data, caption: description };
    const [updated] = await transaction
      .update(contentBlocks)
      .set({
        data,
        revision: sql`${contentBlocks.revision} + 1`,
      })
      .where(
        and(
          eq(contentBlocks.id, liveBlockId),
          eq(contentBlocks.revision, job.expectedBlockRevision),
        ),
      )
      .returning({ id: contentBlocks.id });
    if (!updated) throw new Error("Video block CAS failed.");
    const [completed] = await transaction
      .update(videoDescriptionJobs)
      .set({
        status: "succeeded",
        claimToken: null,
        claimedAt: null,
        leaseExpiresAt: null,
        generatedDescription: null,
        completedAt: now,
        failureCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(videoDescriptionJobs.id, job.id),
          eq(videoDescriptionJobs.status, "processing"),
          eq(videoDescriptionJobs.claimToken, job.claimToken!),
        ),
      )
      .returning({ id: videoDescriptionJobs.id });
    if (!completed) throw new Error("Video description claim was lost.");
    await transaction.insert(activityEvents).values({
      organizationId: job.organizationId,
      userId: job.requestedById,
      type: "course.video_description.applied",
      entityType: "content_block",
      entityId: job.blockReferenceId,
      metadata: {
        originCourseId: job.originCourseId,
        courseIds: [...new Set(courseMemberships.map((row) => row.courseId))],
        sourceAssetReferenceId: job.sourceAssetReferenceId,
        outputLength: description.length,
      },
    });
    return {
      status: "succeeded" as const,
      courseIds: [...new Set(courseMemberships.map((row) => row.courseId))],
    };
  });
}

async function persistGeneratedDescription(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
  description: string,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const [persisted] = await db
        .update(videoDescriptionJobs)
        .set({ generatedDescription: description, updatedAt: new Date() })
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
            isNull(videoDescriptionJobs.generatedDescription),
          ),
        )
        .returning({ id: videoDescriptionJobs.id });
      if (persisted) return true;
    } catch (error) {
      lastError = error;
    }
    try {
      const [stored] = await db
        .select({
          generatedDescription: videoDescriptionJobs.generatedDescription,
        })
        .from(videoDescriptionJobs)
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        )
        .limit(1);
      if (stored?.generatedDescription === description) return true;
      if (!stored) return false;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
  return false;
}

async function applyPersistedDescription(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
  description: string,
) {
  try {
    const applied = await applyDescription(job, description);
    try {
      for (const courseId of applied.courseIds) {
        revalidatePath(`/admin/courses/${courseId}`);
      }
      revalidatePath("/admin/courses");
    } catch (error) {
      logServerError(error, { action: "video_description_job.revalidate" });
    }
    return applied.status;
  } catch (error) {
    logServerError(error, { action: "video_description_job.apply" });
    const finalAttempt = job.attempt + 1 >= job.maxAttempts;
    const retryAt = new Date(
      Date.now() + Math.min(15 * 60_000, 15_000 * 2 ** job.attempt),
    );
    const deadlineExceeded = retryAt >= job.deadlineAt;
    await releaseClaim(job, finalAttempt || deadlineExceeded
      ? {
          status: "failed",
          failureCode: deadlineExceeded
            ? "job_deadline_exceeded"
            : "description_apply_failed",
          completedAt: new Date(),
          clearGeneratedDescription: true,
          incrementAttempt: true,
        }
      : { nextRetryAt: retryAt, incrementAttempt: true });
    return finalAttempt || deadlineExceeded
      ? ("failed" as const)
      : ("retrying" as const);
  }
}

async function processClaimedVideoDescriptionJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextVideoDescriptionJob>>>,
) {
  const context = await readJobContext(job);
  if (!context || !job.requestedById || !contextStillEligible(job, context)) {
    if (!context || !job.liveBlockId || !job.liveSourceAssetId) {
      await db
        .update(videoDescriptionJobs)
        .set({ liveBlockId: null, liveSourceAssetId: null })
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        );
    }
    await releaseClaim(job, {
      status: "superseded",
      failureCode: "content_changed",
      completedAt: new Date(),
      clearGeneratedDescription: true,
    });
    return "superseded" as const;
  }
  if (job.generatedDescription) {
    return applyPersistedDescription(job, job.generatedDescription);
  }
  const [storedTranscript] = await db
    .select({
      document: mediaAssetTranscripts.document,
      sourceContentSha256: mediaAssetTranscripts.sourceContentSha256,
    })
    .from(mediaAssetTranscripts)
    .where(
      and(
        eq(mediaAssetTranscripts.organizationId, job.organizationId),
        eq(mediaAssetTranscripts.sourceAssetId, job.liveSourceAssetId!),
        eq(mediaAssetTranscripts.sourceContentSha256, job.sourceContentSha256),
        eq(mediaAssetTranscripts.language, job.transcriptLanguage),
      ),
    )
    .orderBy(desc(mediaAssetTranscripts.createdAt))
    .limit(1);
  const transcript = sanitizeVideoTranscriptDocument(storedTranscript?.document);
  if (!transcript) {
    if (Date.now() >= job.deadlineAt.getTime()) {
      await releaseClaim(job, {
        status: "failed",
        failureCode: "transcript_timeout",
        completedAt: new Date(),
      });
      return "failed" as const;
    }
    await releaseClaim(job, {
      nextRetryAt: new Date(Date.now() + TRANSCRIPT_WAIT_MS),
    });
    return "waiting" as const;
  }
  if (
    transcript.segments.some(
      (segment) =>
        segment.endMs > context.assetDurationMilliseconds! + 2_000,
    )
  ) {
    await releaseClaim(job, {
      status: "failed",
      failureCode: "invalid_transcript",
      completedAt: new Date(),
    });
    return "failed" as const;
  }

  if (Date.now() >= job.deadlineAt.getTime()) {
    await releaseClaim(job, {
      status: "failed",
      failureCode: "job_deadline_exceeded",
      completedAt: new Date(),
    });
    return "failed" as const;
  }

  const circuit = await acquireProviderCircuitPermission({
    providerKey: "ai-compatible",
  });
  if (!circuit.allowed) {
    const retryAt = new Date(Date.now() + 60_000);
    await releaseClaim(job, {
      ...(retryAt >= job.deadlineAt
        ? {
            status: "failed" as const,
            failureCode: "job_deadline_exceeded",
            completedAt: new Date(),
          }
        : { nextRetryAt: retryAt }),
    });
    return retryAt >= job.deadlineAt ? ("failed" as const) : ("retrying" as const);
  }

  const rateIdentifier = `${job.organizationId}\0${job.requestedById}`;
  const concurrent = await consumePersistentRateLimit({
    action: "ai_message_concurrent",
    identifier: rateIdentifier,
  });
  if (concurrent.limited) {
    const expired = concurrent.resetAt >= job.deadlineAt;
    await releaseClaim(job, expired
      ? {
          status: "failed",
          failureCode: "job_deadline_exceeded",
          completedAt: new Date(),
        }
      : { nextRetryAt: concurrent.resetAt });
    return expired ? ("failed" as const) : ("retrying" as const);
  }
  try {
    const quota = await consumeGuardedPersistentRateLimit({
      guards: [
        { action: "ai_message_tenant", identifier: job.organizationId },
      ],
      primary: { action: "ai_message", identifier: rateIdentifier },
    });
    if (quota.limited) {
      const expired = quota.resetAt >= job.deadlineAt;
      await releaseClaim(job, expired
        ? {
            status: "failed",
            failureCode: "job_deadline_exceeded",
            completedAt: new Date(),
          }
        : { nextRetryAt: quota.resetAt });
      return expired ? ("failed" as const) : ("retrying" as const);
    }
    const providerController = new AbortController();
    let heartbeatRunning = false;
    const heartbeat = setInterval(() => {
      if (heartbeatRunning || providerController.signal.aborted) return;
      heartbeatRunning = true;
      void db
        .update(videoDescriptionJobs)
        .set({
          leaseExpiresAt: new Date(Date.now() + JOB_LEASE_MS),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        )
        .returning({ id: videoDescriptionJobs.id })
        .then((rows) => {
          if (!rows.length) providerController.abort();
        })
        .catch(() => providerController.abort())
        .finally(() => {
          heartbeatRunning = false;
        });
    }, 15_000);
    let description: string;
    try {
      description = await generateVideoDescription({
        locale: job.locale as AppLocale,
        transcript,
        title: context.blockTitle ?? "",
        originalFileName: context.assetOriginalFileName,
        durationMilliseconds: context.assetDurationMilliseconds!,
        signal: providerController.signal,
      });
    } catch (error) {
      clearInterval(heartbeat);
      if (providerController.signal.aborted) return "claim_lost" as const;
      const claimStillOwned = await db
        .select({ id: videoDescriptionJobs.id })
        .from(videoDescriptionJobs)
        .where(
          and(
            eq(videoDescriptionJobs.id, job.id),
            eq(videoDescriptionJobs.status, "processing"),
            eq(videoDescriptionJobs.claimToken, job.claimToken!),
          ),
        )
        .limit(1);
      if (!claimStillOwned.length) return "claim_lost" as const;
      await recordProviderCircuitFailure({ providerKey: "ai-compatible" }).catch(
        (circuitError) =>
          logServerError(circuitError, {
            action: "video_description_job.circuit_failure",
          }),
      );
      logServerError(error, { action: "video_description_job.provider" });
      const finalAttempt = job.attempt + 1 >= job.maxAttempts;
      const retryAt = new Date(
        Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** job.attempt),
      );
      const deadlineExceeded = retryAt >= job.deadlineAt;
      await releaseClaim(job, {
        status: finalAttempt || deadlineExceeded ? "failed" : "queued",
        failureCode: finalAttempt || deadlineExceeded
          ? (deadlineExceeded
              ? "job_deadline_exceeded"
              : "provider_unavailable"
            ).slice(0, FAILURE_DETAIL_LIMIT)
          : null,
        nextRetryAt: finalAttempt || deadlineExceeded
          ? null
          : retryAt,
        completedAt: finalAttempt || deadlineExceeded ? new Date() : null,
        incrementAttempt: true,
      });
      return finalAttempt || deadlineExceeded
        ? ("failed" as const)
        : ("retrying" as const);
    }
    clearInterval(heartbeat);
    if (providerController.signal.aborted) return "claim_lost" as const;
    try {
      const persisted = await persistGeneratedDescription(job, description);
      if (!persisted) return "claim_lost" as const;
    } catch (error) {
      logServerError(error, {
        action: "video_description_job.persist_generated_output",
      });
      const finalAttempt = job.attempt + 1 >= job.maxAttempts;
      const retryAt = new Date(
        Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** job.attempt),
      );
      const deadlineExceeded = retryAt >= job.deadlineAt;
      await releaseClaim(job, {
        status: finalAttempt || deadlineExceeded ? "failed" : "queued",
        failureCode: finalAttempt || deadlineExceeded
          ? deadlineExceeded
            ? "job_deadline_exceeded"
            : "description_output_persist_failed"
          : null,
        nextRetryAt: finalAttempt || deadlineExceeded ? null : retryAt,
        completedAt: finalAttempt || deadlineExceeded ? new Date() : null,
        incrementAttempt: true,
        clearGeneratedDescription: finalAttempt || deadlineExceeded,
      });
      return finalAttempt || deadlineExceeded
        ? ("failed" as const)
        : ("retrying" as const);
    }
    await recordProviderCircuitSuccess("ai-compatible").catch((error) =>
      logServerError(error, {
        action: "video_description_job.circuit_success",
      }),
    );
    return applyPersistedDescription(job, description);
  } finally {
    await clearPersistentRateLimit({
      action: "ai_message_concurrent",
      identifier: rateIdentifier,
      expectedResetAt: concurrent.resetAt,
    }).catch((error) =>
      logServerError(error, {
        action: "video_description_job.concurrency_release",
      }),
    );
  }
}

export async function processVideoDescriptionJobs(limit: number) {
  const results: string[] = [];
  for (let index = 0; index < Math.max(0, Math.min(limit, 1)); index += 1) {
    const job = await claimNextVideoDescriptionJob();
    if (!job) break;
    results.push(await processClaimedVideoDescriptionJob(job));
  }
  return results;
}

export async function cleanupTerminalVideoDescriptionJobs(
  batchSize: number,
  now?: Date,
) {
  return db.transaction(async (transaction) => {
    const retentionNow = now ?? new Date();
    const cutoff = new Date(
      retentionNow.getTime() - 30 * 24 * 60 * 60_000,
    );
    const prospective = await transaction
      .select({
        id: videoDescriptionJobs.id,
        organizationId: videoDescriptionJobs.organizationId,
        requesterSubjectReference:
          videoDescriptionJobs.requesterSubjectReference,
      })
      .from(videoDescriptionJobs)
      .where(
        and(
          inArray(videoDescriptionJobs.status, [
            "succeeded",
            "failed",
            "superseded",
          ]),
          lte(videoDescriptionJobs.completedAt, cutoff),
        ),
      )
      .orderBy(
        asc(videoDescriptionJobs.completedAt),
        asc(videoDescriptionJobs.id),
      )
      .limit(Math.max(1, Math.min(batchSize, 1_000)));
    if (!prospective.length) return 0;
    const subjectCandidates = prospective
      .filter(
        (
          candidate,
        ): candidate is typeof candidate & {
          requesterSubjectReference: string;
        } => Boolean(candidate.requesterSubjectReference),
      )
      .map((candidate) => ({
        ...candidate,
        subjectReference: candidate.requesterSubjectReference,
      }));
    await lockPrivacyLegalHoldSubjects(transaction, subjectCandidates);
    const holdNow = now ?? new Date();
    const candidates = await transaction
      .select({
        id: videoDescriptionJobs.id,
        organizationId: videoDescriptionJobs.organizationId,
        requesterSubjectReference:
          videoDescriptionJobs.requesterSubjectReference,
      })
      .from(videoDescriptionJobs)
      .where(
        and(
          inArray(
            videoDescriptionJobs.id,
            prospective.map((candidate) => candidate.id),
          ),
          inArray(videoDescriptionJobs.status, [
            "succeeded",
            "failed",
            "superseded",
          ]),
          lte(videoDescriptionJobs.completedAt, cutoff),
        ),
      )
      .orderBy(
        asc(videoDescriptionJobs.completedAt),
        asc(videoDescriptionJobs.id),
      )
      .for("update", { skipLocked: true });
    if (!candidates.length) return 0;
    const activeHolds = subjectCandidates.length
      ? await transaction
          .select({
            organizationId: privacyLegalHolds.organizationId,
            subjectReference: privacyLegalHolds.subjectReference,
          })
          .from(privacyLegalHolds)
          .where(
            and(
              or(
                ...subjectCandidates.map((candidate) =>
                  and(
                    eq(
                      privacyLegalHolds.organizationId,
                      candidate.organizationId,
                    ),
                    eq(
                      privacyLegalHolds.subjectReference,
                      candidate.subjectReference,
                    ),
                  ),
                ),
              ),
              inArray(privacyLegalHolds.scope, ["all", "learning", "audit"]),
              isNull(privacyLegalHolds.releasedAt),
              lte(privacyLegalHolds.startsAt, holdNow),
              or(
                isNull(privacyLegalHolds.expiresAt),
                gt(privacyLegalHolds.expiresAt, holdNow),
              ),
            ),
          )
      : [];
    const heldSubjects = new Set(
      activeHolds.map(
        (hold) => `${hold.organizationId}\0${hold.subjectReference}`,
      ),
    );
    const deletableIds = candidates
      .filter((candidate) => {
        const subjectReference = candidate.requesterSubjectReference;
        if (!subjectReference) return true;
        return !heldSubjects.has(
          `${candidate.organizationId}\0${subjectReference}`,
        );
      })
      .map((candidate) => candidate.id);
    if (!deletableIds.length) return 0;
    const deleted = await transaction
      .delete(videoDescriptionJobs)
      .where(inArray(videoDescriptionJobs.id, deletableIds))
      .returning({ id: videoDescriptionJobs.id });
    return deleted.length;
  });
}
