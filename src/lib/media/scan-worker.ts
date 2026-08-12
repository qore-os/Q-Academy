import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { db, postgresClient } from "@/db";
import {
  courseMediaAssets,
  communityAssetBindings,
  customFieldValues,
  customFieldDefinitions,
  dataProfileValues,
  mediaAssets,
  mediaUploadSessions,
  platformSettings,
  submissionAttachments,
  users,
} from "@/db/schema";
import { mediaAssetIdentity, type MediaAsset } from "@/lib/media/asset-service";
import { scanMediaStreamWithClamAv } from "@/lib/media/clamav-scanner";
import {
  MediaMaintenanceDeadlineError,
  type MediaMaintenanceBudget,
  runMediaMaintenanceWithinBudget,
} from "@/lib/media/maintenance-budget";
import { buildMediaScanBacklogMetrics } from "@/lib/media/scan-backlog";
import {
  inspectAndScanMediaStream,
  MediaContentInspectionError,
  MediaContentStreamError,
} from "@/lib/media/scan-core";
import type { AllowedMediaMimeType } from "@/lib/media/mime-policy";
import {
  deleteStoredMediaObject,
  getStoredMediaObjectForScanning,
  mediaMalwareScannerConfiguration,
  promoteStoredMediaObject,
} from "@/lib/media/storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import {
  abortS3MultipartUpload,
  MediaStorageError,
} from "@/lib/media/s3-storage";
import { logServerError } from "@/lib/server-error-logging";
import { reconcileStaleOrbitTransfers } from "@/lib/orbit/transfer-reconciliation";
import {
  cancelUnavailableMediaProcessingJobs,
  cleanupMediaProcessingArtifacts,
  enqueueDefaultMediaProcessingJobs,
} from "@/lib/media/processing-worker";
import {
  isWebmDurationProbeMimeType,
  probeWebmDurationStream,
} from "@/lib/media/webm-duration-probe";

const SCAN_LEASE_MS = 15 * 60_000;
const FINAL_CLEANUP_GRACE_MS = 60 * 60_000;
const MAX_SCAN_ATTEMPTS = 5;
const BASE_RETRY_MS = 30_000;
const MAX_BATCH_SIZE = 100;
const INCOMING_CLEANUP_GRACE_MS = 60 * 60_000;
const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const UNATTACHED_SUBMISSION_READY_RETENTION_MS = 24 * 60 * 60_000;
const UNATTACHED_COURSE_READY_RETENTION_MS = 24 * 60 * 60_000;
const UNATTACHED_COMMUNITY_READY_RETENTION_MS = 24 * 60 * 60_000;
const UNATTACHED_PROFILE_READY_RETENTION_MS = 24 * 60 * 60_000;
const UNATTACHED_PROFILE_FIELD_READY_RETENTION_MS = 24 * 60 * 60_000;
const UNATTACHED_BRANDING_READY_RETENTION_MS = 24 * 60 * 60_000;
const MAX_MAINTENANCE_BATCH_SIZE = 5;
const MAX_QUOTA_RELEASE_BATCH_SIZE = 100;
const FAIR_IO_PHASE_ASSET_LIMIT = 1;
const MULTIPART_STALE_CLAIM_MS = 15 * 60_000;
export const MEDIA_MAINTENANCE_ADVISORY_LOCK_KEY =
  "q-academy:media-maintenance:v1";
const VERIFIED_DELETED_STATUSES = ["deleted", "quarantined", "failed"] as const;
let mediaMaintenanceIoPhaseCursor = 0;
const mediaMaintenanceTenantCursors = {
  expiredUploadWithoutSession: null as string | null,
  expiredUpload: null as string | null,
  detachedMultipart: null as string | null,
  storedObject: null as string | null,
  quotaRelease: null as string | null,
  tombstone: null as string | null,
  unattachedSubmission: null as string | null,
  unattachedCourse: null as string | null,
  unattachedCommunity: null as string | null,
  unattachedProfile: null as string | null,
  unattachedProfileField: null as string | null,
  unattachedBranding: null as string | null,
};

function batchSize(value: number) {
  if (!Number.isInteger(value) || value < 1) return 25;
  return Math.min(value, MAX_BATCH_SIZE);
}

function maintenanceBatchSize(value: number) {
  if (!Number.isInteger(value) || value < 1) return MAX_MAINTENANCE_BATCH_SIZE;
  return Math.min(value, MAX_MAINTENANCE_BATCH_SIZE);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : null;
}

function retryAt(attempt: number, now: Date) {
  const delay = Math.min(
    BASE_RETRY_MS * 2 ** Math.max(0, attempt - 1),
    60 * 60_000,
  );
  return new Date(now.getTime() + delay);
}

async function claimNextScan(now: Date) {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(mediaAssets)
      .where(
        or(
          and(
            eq(mediaAssets.status, "uploaded"),
            or(
              isNull(mediaAssets.scanNextRetryAt),
              lte(mediaAssets.scanNextRetryAt, now),
            ),
          ),
          and(
            eq(mediaAssets.status, "scanning"),
            lte(mediaAssets.scanLeaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(mediaAssets.scanNextRetryAt), asc(mediaAssets.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    const candidate = candidates[0];
    if (!candidate) return null;
    const claimToken = randomUUID();
    const [row] = await tx
      .update(mediaAssets)
      .set({
        status: "scanning",
        scanAttempt: sql`${mediaAssets.scanAttempt} + 1`,
        scanClaimToken: claimToken,
        scanClaimedAt: now,
        scanLeaseExpiresAt: new Date(now.getTime() + SCAN_LEASE_MS),
        scanNextRetryAt: null,
        scanCompletedAt: null,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, candidate.id))
      .returning();
    return row ?? null;
  });
}

function claimCondition(asset: MediaAsset) {
  return and(
    eq(mediaAssets.id, asset.id),
    eq(mediaAssets.organizationId, asset.organizationId),
    eq(mediaAssets.status, "scanning"),
    eq(mediaAssets.scanClaimToken, asset.scanClaimToken!),
  );
}

async function renewScanLease(asset: MediaAsset) {
  const now = new Date();
  const [renewed] = await db
    .update(mediaAssets)
    .set({
      scanLeaseExpiresAt: new Date(now.getTime() + SCAN_LEASE_MS),
      updatedAt: now,
    })
    .where(claimCondition(asset))
    .returning({ id: mediaAssets.id });
  return Boolean(renewed);
}

function startScanLeaseHeartbeat(asset: MediaAsset) {
  let stopped = false;
  let renewing = false;
  let leaseLost = false;
  const timer = setInterval(
    async () => {
      if (stopped || renewing) return;
      renewing = true;
      try {
        if (!(await renewScanLease(asset))) {
          leaseLost = true;
          stopped = true;
        }
      } catch (error) {
        leaseLost = true;
        stopped = true;
        logServerError(error, {
          action: "media.scan.lease_heartbeat",
        });
      } finally {
        renewing = false;
      }
    },
    Math.floor(SCAN_LEASE_MS / 3),
  );
  timer.unref?.();
  return {
    lost: () => leaseLost,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

async function markTerminal(
  asset: MediaAsset,
  input: {
    status: "ready" | "quarantined" | "failed";
    now: Date;
    failureCode?: string | null;
    failureDetail?: string | null;
    malwareSignature?: string | null;
    etag?: string | null;
    storageVersionId?: string | null;
    contentSha256?: string | null;
    durationMilliseconds?: number | null;
    stagingDeleted?: boolean;
  },
) {
  const [updated] = await db
    .update(mediaAssets)
    .set({
      status: input.status,
      detectedMimeType: asset.declaredMimeType,
      etag: input.etag === undefined ? asset.etag : input.etag,
      storageVersionId:
        input.storageVersionId === undefined
          ? asset.storageVersionId
          : input.storageVersionId,
      contentSha256:
        input.contentSha256 === undefined
          ? asset.contentSha256
          : input.contentSha256,
      durationMilliseconds:
        input.durationMilliseconds === undefined
          ? asset.durationMilliseconds
          : input.durationMilliseconds,
      scanClaimToken: null,
      scanClaimedAt: null,
      scanLeaseExpiresAt: null,
      scanNextRetryAt: null,
      scanCompletedAt: input.now,
      scanFailureCode: input.failureCode ?? null,
      scanFailureDetail: input.failureDetail ?? null,
      malwareSignature: input.malwareSignature ?? null,
      stagingDeletedAt: input.stagingDeleted
        ? input.now
        : asset.stagingDeletedAt,
      updatedAt: input.now,
    })
    .where(claimCondition(asset))
    .returning({ id: mediaAssets.id });
  return Boolean(updated);
}

async function deleteStage(
  asset: MediaAsset,
  stage: "staging" | "ready",
  budget?: MediaMaintenanceBudget,
) {
  try {
    if (budget) {
      await budget.runAbortable((signal) =>
        deleteStoredMediaObject(mediaAssetIdentity(asset, stage), signal),
      );
      if (!budget.canStartPhase()) return false;
    } else {
      await deleteStoredMediaObject(mediaAssetIdentity(asset, stage));
    }
    const now = new Date();
    await db
      .update(mediaAssets)
      .set(
        stage === "staging"
          ? { stagingDeletedAt: now, updatedAt: now }
          : { storageDeletedAt: now, updatedAt: now },
      )
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, asset.organizationId),
        ),
      );
    return true;
  } catch {
    return false;
  }
}

async function quarantine(
  asset: MediaAsset,
  now: Date,
  code: string,
  detail: string,
  signature: string | null = null,
) {
  await markTerminal(asset, {
    status: "quarantined",
    now,
    failureCode: code,
    failureDetail: detail,
    malwareSignature: signature,
  });
  return "quarantined" as const;
}

async function retryOrFail(asset: MediaAsset, now: Date, code: string) {
  if (asset.scanAttempt >= MAX_SCAN_ATTEMPTS) {
    await markTerminal(asset, {
      status: "failed",
      now,
      failureCode: code,
      failureDetail:
        "Der Media-Scan ist nach mehreren Versuchen fehlgeschlagen.",
    });
    return "failed" as const;
  }
  await db
    .update(mediaAssets)
    .set({
      status: "uploaded",
      scanClaimToken: null,
      scanClaimedAt: null,
      scanLeaseExpiresAt: null,
      scanNextRetryAt: retryAt(asset.scanAttempt, now),
      scanFailureCode: code,
      scanFailureDetail: "Der Media-Scan wird erneut versucht.",
      updatedAt: now,
    })
    .where(claimCondition(asset));
  return "retrying" as const;
}

async function processClaimedAsset(asset: MediaAsset) {
  const heartbeat = startScanLeaseHeartbeat(asset);
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver !== asset.storageDriver) {
    heartbeat.stop();
    return retryOrFail(asset, new Date(), "storage_driver_mismatch");
  }

  try {
    const stored = await getStoredMediaObjectForScanning(
      mediaAssetIdentity(asset, "staging"),
      asset.etag,
      asset.stagingStorageVersionId,
    );
    if (stored.sizeBytes !== asset.declaredSizeBytes) {
      throw new MediaContentStreamError(
        "The stored object size differs from its upload intent.",
      );
    }
    if (
      stored.mimeType !== null &&
      stored.mimeType.toLowerCase() !== asset.declaredMimeType
    ) {
      throw new MediaContentInspectionError(
        "signature_mismatch",
        "The stored object MIME type differs from its upload intent.",
      );
    }

    const clamAv = mediaMalwareScannerConfiguration();
    const result = await inspectAndScanMediaStream({
      body: stored.body,
      expectedSizeBytes: asset.declaredSizeBytes,
      mimeType: asset.declaredMimeType as AllowedMediaMimeType,
      scanner: clamAv.required
        ? (body, expectedSizeBytes) =>
            scanMediaStreamWithClamAv({
              configuration: clamAv,
              body,
              expectedSizeBytes,
            })
        : undefined,
    });
    if (!result.clean) {
      heartbeat.stop();
      return quarantine(
        asset,
        new Date(),
        "malware_detected",
        "Der Malware-Scanner hat die Datei abgelehnt.",
        result.signature,
      );
    }

    let durationMilliseconds: number | null = result.durationMilliseconds;
    if (
      durationMilliseconds === null &&
      isWebmDurationProbeMimeType(asset.declaredMimeType)
    ) {
      if (heartbeat.lost()) return "lost_claim" as const;
      const probeStored = await getStoredMediaObjectForScanning(
        mediaAssetIdentity(asset, "staging"),
        asset.etag,
        asset.stagingStorageVersionId,
      );
      if (probeStored.sizeBytes !== asset.declaredSizeBytes) {
        throw new MediaContentStreamError(
          "The stored WebM object size differs from its upload intent.",
        );
      }
      if (
        probeStored.mimeType !== null &&
        probeStored.mimeType.toLowerCase() !== asset.declaredMimeType
      ) {
        throw new MediaContentInspectionError(
          "signature_mismatch",
          "The stored WebM object MIME type differs from its upload intent.",
        );
      }
      const probedDuration = await probeWebmDurationStream({
        body: probeStored.body,
        expectedSizeBytes: asset.declaredSizeBytes,
      });
      durationMilliseconds = probedDuration.durationMilliseconds;
    }

    if (heartbeat.lost() || !(await renewScanLease(asset))) {
      return "lost_claim" as const;
    }
    const promoted = await promoteStoredMediaObject({
      source: mediaAssetIdentity(asset, "staging"),
      target: mediaAssetIdentity(asset, "ready"),
      expectedEtag: asset.etag,
      expectedSourceVersionId: asset.stagingStorageVersionId,
      expectedSha256: result.sha256,
      expectedSizeBytes: asset.declaredSizeBytes,
      mimeType: asset.declaredMimeType,
    });
    const ready = await markTerminal(asset, {
      status: "ready",
      now: new Date(),
      etag: promoted.etag ?? asset.etag,
      storageVersionId: promoted.versionId,
      contentSha256: result.sha256,
      durationMilliseconds,
      stagingDeleted: false,
    });
    if (!ready) {
      const [current] = await db
        .select({ status: mediaAssets.status })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, asset.organizationId),
          ),
        )
        .limit(1);
      if (
        current &&
        ["deleted", "quarantined", "failed"].includes(current.status)
      ) {
        await deleteStage(asset, "ready");
      }
    }
    if (ready) {
      await enqueueDefaultMediaProcessingJobs({
        organizationId: asset.organizationId,
        sourceAssetId: asset.id,
      }).catch((error) => {
        logServerError(error, {
          action: "media.processing.enqueue_defaults",
        });
      });
    }
    return ready ? ("ready" as const) : ("lost_claim" as const);
  } catch (error) {
    if (
      error instanceof MediaContentInspectionError ||
      error instanceof MediaContentStreamError ||
      errorCode(error) === "object_mismatch"
    ) {
      return quarantine(
        asset,
        new Date(),
        errorCode(error) ?? "content_mismatch",
        "Die hochgeladene Datei stimmt nicht mit dem Upload-Intent überein.",
      );
    }
    return retryOrFail(
      asset,
      new Date(),
      errorCode(error) ?? "scan_unavailable",
    );
  } finally {
    heartbeat.stop();
  }
}

function expiredPendingUploadWithoutSessionCondition(now: Date) {
  return and(
    eq(mediaAssets.status, "pending"),
    lte(mediaAssets.uploadExpiresAt, now),
    notExists(
      db
        .select({ assetId: mediaUploadSessions.assetId })
        .from(mediaUploadSessions)
        .where(
          and(
            eq(mediaUploadSessions.assetId, mediaAssets.id),
            eq(
              mediaUploadSessions.organizationId,
              mediaAssets.organizationId,
            ),
          ),
        ),
    ),
  );
}

async function expirePendingUploadsWithoutSessions(limit: number, now: Date) {
  const tenantCursor =
    mediaMaintenanceTenantCursors.expiredUploadWithoutSession;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(expiredPendingUploadWithoutSessionCondition(now))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.uploadExpiresAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    mediaMaintenanceTenantCursors.expiredUploadWithoutSession =
      candidates[candidates.length - 1]!.organizationId;

    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
        scanFailureCode: "upload_expired",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          expiredPendingUploadWithoutSessionCondition(now),
        ),
      )
      .returning({ id: mediaAssets.id });
    return expired.length;
  });
}

async function expirePendingUploads(
  budget: MediaMaintenanceBudget,
  limit: number,
  now: Date,
) {
  const tenantCursor = mediaMaintenanceTenantCursors.expiredUpload;
  const candidates = await db
    .select({ asset: mediaAssets, session: mediaUploadSessions })
    .from(mediaAssets)
    .innerJoin(
      mediaUploadSessions,
      and(
        eq(mediaUploadSessions.assetId, mediaAssets.id),
        eq(mediaUploadSessions.organizationId, mediaAssets.organizationId),
      ),
    )
    .where(
      and(
        eq(mediaAssets.status, "pending"),
        lte(mediaAssets.uploadExpiresAt, now),
      ),
    )
    .orderBy(
      ...(tenantCursor
        ? [
            sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
          ]
        : []),
      asc(mediaAssets.organizationId),
      asc(mediaAssets.uploadExpiresAt),
      asc(mediaAssets.id),
    )
    .limit(Math.min(batchSize(limit), FAIR_IO_PHASE_ASSET_LIMIT));
  if (!candidates.length) return 0;
  mediaMaintenanceTenantCursors.expiredUpload =
    candidates[candidates.length - 1]!.asset.organizationId;

  let expired = 0;
  for (const candidate of candidates) {
    const result = await cleanupMultipartSession(
      candidate,
      now,
      "media.multipart.expire",
      budget,
      "expired",
    );
    if (result.assetExpired) expired += 1;
  }
  return expired;
}

type MultipartCleanupCandidate = Readonly<{
  asset: MediaAsset;
  session: typeof mediaUploadSessions.$inferSelect;
}>;

type MultipartCleanupReason = "detached" | "expired";

type MultipartCleanupClaim = Readonly<{
  asset: MediaAsset;
  session: typeof mediaUploadSessions.$inferSelect;
  previousState: typeof mediaUploadSessions.$inferSelect.state;
  previousUpdatedAt: Date;
}>;

function sameNullableValue(left: string | null, right: string | null) {
  return left === right;
}

function sameInstant(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}

function multipartSessionMatchesSnapshot(
  current: typeof mediaUploadSessions.$inferSelect,
  snapshot: typeof mediaUploadSessions.$inferSelect,
) {
  return (
    current.initializationToken === snapshot.initializationToken &&
    sameNullableValue(current.providerUploadId, snapshot.providerUploadId) &&
    current.state === snapshot.state &&
    current.partSizeBytes === snapshot.partSizeBytes &&
    current.expectedPartCount === snapshot.expectedPartCount &&
    sameInstant(current.expiresAt, snapshot.expiresAt) &&
    sameInstant(current.uploadDeadlineAt, snapshot.uploadDeadlineAt) &&
    sameInstant(current.updatedAt, snapshot.updatedAt)
  );
}

function multipartSessionCanBeClaimed(
  assetStatus: MediaAsset["status"],
  session: typeof mediaUploadSessions.$inferSelect,
  now: Date,
) {
  if (session.state === "uploading") return true;
  const staleBefore = now.getTime() - MULTIPART_STALE_CLAIM_MS;
  if (session.state === "initializing" || session.state === "recovering") {
    return (
      assetStatus !== "pending" || session.updatedAt.getTime() <= staleBefore
    );
  }
  return session.updatedAt.getTime() <= staleBefore;
}

async function claimMultipartSessionForCleanup(
  candidate: MultipartCleanupCandidate,
  now: Date,
  reason: MultipartCleanupReason,
  budget: MediaMaintenanceBudget,
) {
  if (candidate.session.providerUploadId && !budget.canStartIoAsset()) {
    return null;
  }
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, candidate.asset.id),
          eq(mediaAssets.organizationId, candidate.asset.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !asset ||
      asset.status !== candidate.asset.status ||
      !sameInstant(asset.uploadExpiresAt, candidate.asset.uploadExpiresAt) ||
      (reason === "expired" &&
        (asset.status !== "pending" ||
          asset.uploadExpiresAt.getTime() > now.getTime())) ||
      (reason === "detached" && asset.status === "pending")
    ) {
      return null;
    }

    const [session] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, asset.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !session ||
      !multipartSessionMatchesSnapshot(session, candidate.session) ||
      (reason === "expired" &&
        (session.expiresAt.getTime() > now.getTime() ||
          session.uploadDeadlineAt.getTime() > now.getTime())) ||
      !multipartSessionCanBeClaimed(asset.status, session, now)
    ) {
      return null;
    }

    const claimedAt = new Date();
    const providerUploadCondition = session.providerUploadId
      ? eq(mediaUploadSessions.providerUploadId, session.providerUploadId)
      : isNull(mediaUploadSessions.providerUploadId);
    const [claimed] = await tx
      .update(mediaUploadSessions)
      .set({ state: "aborting", updatedAt: claimedAt })
      .where(
        and(
          eq(mediaUploadSessions.assetId, session.assetId),
          eq(mediaUploadSessions.organizationId, session.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            session.initializationToken,
          ),
          providerUploadCondition,
          eq(mediaUploadSessions.state, session.state),
          eq(mediaUploadSessions.expiresAt, session.expiresAt),
          eq(mediaUploadSessions.uploadDeadlineAt, session.uploadDeadlineAt),
          eq(mediaUploadSessions.updatedAt, session.updatedAt),
        ),
      )
      .returning();
    return claimed
      ? ({
          asset,
          session: claimed,
          previousState: session.state,
          previousUpdatedAt: session.updatedAt,
        } satisfies MultipartCleanupClaim)
      : null;
  });
}

function multipartCleanupClaimCondition(claim: MultipartCleanupClaim) {
  return and(
    eq(mediaUploadSessions.assetId, claim.session.assetId),
    eq(mediaUploadSessions.organizationId, claim.session.organizationId),
    eq(
      mediaUploadSessions.initializationToken,
      claim.session.initializationToken,
    ),
    claim.session.providerUploadId
      ? eq(mediaUploadSessions.providerUploadId, claim.session.providerUploadId)
      : isNull(mediaUploadSessions.providerUploadId),
    eq(mediaUploadSessions.state, "aborting"),
    eq(mediaUploadSessions.expiresAt, claim.session.expiresAt),
    eq(mediaUploadSessions.uploadDeadlineAt, claim.session.uploadDeadlineAt),
    eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
  );
}

async function restoreMultipartCleanupClaim(claim: MultipartCleanupClaim) {
  await db
    .update(mediaUploadSessions)
    .set({
      state: claim.previousState,
      updatedAt: claim.previousUpdatedAt,
    })
    .where(multipartCleanupClaimCondition(claim));
}

async function finalizeMultipartCleanupClaim(
  claim: MultipartCleanupClaim,
  now: Date,
  reason: MultipartCleanupReason,
) {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, claim.asset.id),
          eq(mediaAssets.organizationId, claim.asset.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!asset) return { sessionRemoved: false, assetExpired: false };
    const [session] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, claim.session.assetId),
          eq(mediaUploadSessions.organizationId, claim.session.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!session || !multipartSessionMatchesSnapshot(session, claim.session)) {
      return { sessionRemoved: false, assetExpired: false };
    }
    const [removed] = await tx
      .delete(mediaUploadSessions)
      .where(multipartCleanupClaimCondition(claim))
      .returning({ assetId: mediaUploadSessions.assetId });
    if (!removed) return { sessionRemoved: false, assetExpired: false };

    if (
      reason !== "expired" ||
      asset.status !== "pending" ||
      !sameInstant(asset.uploadExpiresAt, claim.asset.uploadExpiresAt) ||
      asset.uploadExpiresAt.getTime() > now.getTime()
    ) {
      return { sessionRemoved: true, assetExpired: false };
    }
    const [expired] = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
        scanFailureCode: "upload_expired",
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, asset.organizationId),
          eq(mediaAssets.status, "pending"),
          eq(mediaAssets.uploadExpiresAt, asset.uploadExpiresAt),
        ),
      )
      .returning({ id: mediaAssets.id });
    return { sessionRemoved: true, assetExpired: Boolean(expired) };
  });
}

async function cleanupMultipartSession(
  candidate: MultipartCleanupCandidate,
  now: Date,
  action: string,
  budget: MediaMaintenanceBudget,
  reason: MultipartCleanupReason,
) {
  const claimed = await claimMultipartSessionForCleanup(
    candidate,
    now,
    reason,
    budget,
  );
  if (!claimed) return { sessionRemoved: false, assetExpired: false };

  if (!claimed.session.providerUploadId) {
    return finalizeMultipartCleanupClaim(claimed, now, reason);
  }
  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    configuration.compatibilityMode !== "versioned"
  ) {
    await restoreMultipartCleanupClaim(claimed);
    logServerError(
      new Error("A multipart upload has no versioned S3 configuration."),
      { action },
    );
    return { sessionRemoved: false, assetExpired: false };
  }
  if (!budget.tryClaimIoAsset()) {
    await restoreMultipartCleanupClaim(claimed);
    return { sessionRemoved: false, assetExpired: false };
  }
  try {
    await budget.runAbortable((signal) =>
      abortS3MultipartUpload(
        configuration,
        {
          ...mediaAssetIdentity(claimed.asset, "staging"),
          uploadId: claimed.session.providerUploadId!,
        },
        signal,
      ),
    );
  } catch (error) {
    if (!(
      error instanceof MediaStorageError && error.code === "object_missing"
    )) {
      logServerError(error, { action });
      return { sessionRemoved: false, assetExpired: false };
    }
  }
  return finalizeMultipartCleanupClaim(claimed, now, reason);
}

async function cleanupDetachedMultipartUploads(
  budget: MediaMaintenanceBudget,
  limit: number,
  now: Date,
) {
  const tenantCursor = mediaMaintenanceTenantCursors.detachedMultipart;
  const sessions = await db
    .select({ asset: mediaAssets, session: mediaUploadSessions })
    .from(mediaUploadSessions)
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, mediaUploadSessions.assetId),
        eq(mediaAssets.organizationId, mediaUploadSessions.organizationId),
      ),
    )
    .where(ne(mediaAssets.status, "pending"))
    .orderBy(
      ...(tenantCursor
        ? [
            sql<number>`case when ${mediaUploadSessions.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
          ]
        : []),
      asc(mediaUploadSessions.organizationId),
      asc(mediaUploadSessions.updatedAt),
      asc(mediaUploadSessions.assetId),
    )
    .limit(Math.min(batchSize(limit), FAIR_IO_PHASE_ASSET_LIMIT));
  if (sessions.length) {
    mediaMaintenanceTenantCursors.detachedMultipart =
      sessions[sessions.length - 1]!.session.organizationId;
  }
  let cleaned = 0;
  for (const candidate of sessions) {
    const result = await cleanupMultipartSession(
      candidate,
      now,
      "media.multipart.detached_cleanup",
      budget,
      "detached",
    );
    if (result.sessionRemoved) cleaned += 1;
  }
  return cleaned;
}

function unattachedSubmissionReadyCondition(cutoff: Date) {
  return and(
    eq(mediaAssets.purpose, "submission"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ id: submissionAttachments.id })
        .from(submissionAttachments)
        .where(
          and(
            eq(
              submissionAttachments.organizationId,
              mediaAssets.organizationId,
            ),
            eq(submissionAttachments.mediaAssetId, mediaAssets.id),
          ),
        ),
    ),
  );
}

async function expireUnattachedSubmissionAssets(limit: number, now: Date) {
  const cutoff = new Date(
    now.getTime() - UNATTACHED_SUBMISSION_READY_RETENTION_MS,
  );
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedSubmission;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedSubmissionReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;

    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_submission_expired",
        scanFailureDetail:
          "Der geprüfte Abgabeanhang wurde nicht innerhalb von 24 Stunden eingereicht.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedSubmissionReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedSubmission =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function unattachedCourseReadyCondition(cutoff: Date) {
  return and(
    eq(mediaAssets.purpose, "course_content"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ courseId: courseMediaAssets.courseId })
        .from(courseMediaAssets)
        .where(
          and(
            eq(courseMediaAssets.organizationId, mediaAssets.organizationId),
            eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
          ),
        ),
    ),
  );
}

async function expireUnattachedCourseAssets(limit: number, now: Date) {
  const cutoff = new Date(now.getTime() - UNATTACHED_COURSE_READY_RETENTION_MS);
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedCourse;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedCourseReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_course_content_expired",
        scanFailureDetail:
          "Das geprüfte Kursmedium wurde nicht innerhalb von 24 Stunden an einen Kurs gebunden.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedCourseReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedCourse =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function unattachedCommunityReadyCondition(cutoff: Date) {
  return and(
    eq(mediaAssets.purpose, "community"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ id: communityAssetBindings.mediaAssetId })
        .from(communityAssetBindings)
        .where(
          and(
            eq(
              communityAssetBindings.organizationId,
              mediaAssets.organizationId,
            ),
            eq(communityAssetBindings.mediaAssetId, mediaAssets.id),
          ),
        ),
    ),
  );
}

async function expireUnattachedCommunityAssets(limit: number, now: Date) {
  const cutoff = new Date(
    now.getTime() - UNATTACHED_COMMUNITY_READY_RETENTION_MS,
  );
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedCommunity;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedCommunityReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_community_expired",
        scanFailureDetail:
          "Der geprüfte Community-Anhang wurde nicht innerhalb von 24 Stunden veröffentlicht.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedCommunityReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedCommunity =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function unattachedProfileReadyCondition(cutoff: Date) {
  return and(
    eq(mediaAssets.purpose, "avatar"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, mediaAssets.organizationId),
            sql`${users.avatarUrl} = '/api/media-assets/' || ${mediaAssets.id}::text || '/download'`,
          ),
        ),
    ),
  );
}

async function expireUnattachedProfileAssets(limit: number, now: Date) {
  const cutoff = new Date(
    now.getTime() - UNATTACHED_PROFILE_READY_RETENTION_MS,
  );
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedProfile;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedProfileReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_avatar_expired",
        scanFailureDetail:
          "Das geprüfte Profilbild wurde nicht innerhalb von 24 Stunden gebunden.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedProfileReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedProfile =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function unattachedProfileFieldReadyCondition(cutoff: Date) {
  const valueMatchesAsset = (value: typeof customFieldValues.value) =>
    sql`${value} = to_jsonb(${mediaAssets.id}::text)`;
  return and(
    eq(mediaAssets.purpose, "profile"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ id: customFieldValues.id })
        .from(customFieldValues)
        .innerJoin(
          customFieldDefinitions,
          and(
            eq(customFieldDefinitions.id, customFieldValues.fieldId),
            eq(
              customFieldDefinitions.organizationId,
              customFieldValues.organizationId,
            ),
            eq(customFieldDefinitions.type, "media"),
          ),
        )
        .where(
          and(
            eq(customFieldValues.organizationId, mediaAssets.organizationId),
            eq(customFieldValues.userId, mediaAssets.ownerUserId),
            valueMatchesAsset(customFieldValues.value),
          ),
        ),
    ),
    notExists(
      db
        .select({ id: dataProfileValues.id })
        .from(dataProfileValues)
        .innerJoin(
          customFieldDefinitions,
          and(
            eq(customFieldDefinitions.id, dataProfileValues.fieldId),
            eq(
              customFieldDefinitions.organizationId,
              dataProfileValues.organizationId,
            ),
            eq(customFieldDefinitions.type, "media"),
          ),
        )
        .where(
          and(
            eq(dataProfileValues.organizationId, mediaAssets.organizationId),
            eq(dataProfileValues.userId, mediaAssets.ownerUserId),
            sql`${dataProfileValues.value} = to_jsonb(${mediaAssets.id}::text)`,
          ),
        ),
    ),
  );
}

async function expireUnattachedProfileFieldAssets(limit: number, now: Date) {
  const cutoff = new Date(
    now.getTime() - UNATTACHED_PROFILE_FIELD_READY_RETENTION_MS,
  );
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedProfileField;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedProfileFieldReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_profile_media_expired",
        scanFailureDetail:
          "Das geprüfte Profilmedium wurde nicht innerhalb von 24 Stunden gebunden.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedProfileFieldReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedProfileField =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function unattachedBrandingReadyCondition(cutoff: Date) {
  return and(
    eq(mediaAssets.purpose, "branding"),
    eq(mediaAssets.status, "ready"),
    isNull(mediaAssets.deletedAt),
    lte(mediaAssets.scanCompletedAt, cutoff),
    notExists(
      db
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(
          and(
            eq(platformSettings.organizationId, mediaAssets.organizationId),
            eq(platformSettings.key, "design"),
            sql`(
              ${platformSettings.value} ->> 'logoAssetId' = ${mediaAssets.id}::text
              or ${platformSettings.value} ->> 'logoLightAssetId' = ${mediaAssets.id}::text
              or ${platformSettings.value} ->> 'logoDarkAssetId' = ${mediaAssets.id}::text
              or ${platformSettings.value} ->> 'faviconAssetId' = ${mediaAssets.id}::text
              or ${platformSettings.value} ->> 'socialPreviewImageAssetId' = ${mediaAssets.id}::text
              or ${platformSettings.value} ->> 'loginBackgroundAssetId' = ${mediaAssets.id}::text
            )`,
          ),
        ),
    ),
  );
}

async function expireUnattachedBrandingAssets(limit: number, now: Date) {
  const cutoff = new Date(
    now.getTime() - UNATTACHED_BRANDING_READY_RETENTION_MS,
  );
  const tenantCursor = mediaMaintenanceTenantCursors.unattachedBranding;
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({
        id: mediaAssets.id,
        organizationId: mediaAssets.organizationId,
      })
      .from(mediaAssets)
      .where(unattachedBrandingReadyCondition(cutoff))
      .orderBy(
        ...(tenantCursor
          ? [
              sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
            ]
          : []),
        asc(mediaAssets.organizationId),
        asc(mediaAssets.scanCompletedAt),
        asc(mediaAssets.id),
      )
      .limit(batchSize(limit))
      .for("update", { of: mediaAssets, skipLocked: true });
    if (!candidates.length) return 0;
    const expired = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "unattached_branding_expired",
        scanFailureDetail:
          "Das geprüfte Branding-Bild wurde nicht innerhalb von 24 Stunden gebunden.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(
            mediaAssets.id,
            candidates.map(({ id }) => id),
          ),
          unattachedBrandingReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
    mediaMaintenanceTenantCursors.unattachedBranding =
      candidates[candidates.length - 1]!.organizationId;
    return expired.length;
  });
}

function releasableMediaQuotaCondition() {
  return and(
    inArray(mediaAssets.status, VERIFIED_DELETED_STATUSES),
    gt(mediaAssets.quotaBytes, 0),
    isNotNull(mediaAssets.storageDeletedAt),
    isNotNull(mediaAssets.stagingDeletedAt),
    or(
      gte(
        mediaAssets.stagingDeletedAt,
        sql`${mediaAssets.uploadExpiresAt} + interval '1 hour'`,
      ),
      sql`(
        ${mediaAssets.status} = 'deleted'
        and ${mediaAssets.deletedAt} is not null
        and ${mediaAssets.multipartAbortVerifiedAt} is not null
        and ${mediaAssets.multipartAbortVerifiedAt} >= ${mediaAssets.deletedAt}
        and ${mediaAssets.storageDeletedAt} >= ${mediaAssets.multipartAbortVerifiedAt}
        and ${mediaAssets.stagingDeletedAt} >= ${mediaAssets.multipartAbortVerifiedAt}
      )`,
    ),
  );
}

async function releaseVerifiedDeletedQuota(now: Date) {
  const rankedReleasable = db
    .select({
      id: mediaAssets.id,
      organizationId: mediaAssets.organizationId,
      updatedAt: mediaAssets.updatedAt,
      tenantRank:
        sql<number>`row_number() over (partition by ${mediaAssets.organizationId} order by ${mediaAssets.updatedAt}, ${mediaAssets.id})`.as(
          "tenant_rank",
        ),
    })
    .from(mediaAssets)
    .where(releasableMediaQuotaCondition())
    .as("ranked_releasable_media_quota");
  const tenantCursor = mediaMaintenanceTenantCursors.quotaRelease;
  const releasable = await db
    .select({
      id: rankedReleasable.id,
      organizationId: rankedReleasable.organizationId,
    })
    .from(rankedReleasable)
    .orderBy(
      asc(rankedReleasable.tenantRank),
      ...(tenantCursor
        ? [
            sql<number>`case when ${rankedReleasable.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
          ]
        : []),
      asc(rankedReleasable.organizationId),
      asc(rankedReleasable.updatedAt),
      asc(rankedReleasable.id),
    )
    .limit(MAX_QUOTA_RELEASE_BATCH_SIZE);
  if (!releasable.length) return 0;
  mediaMaintenanceTenantCursors.quotaRelease =
    releasable[releasable.length - 1]!.organizationId;
  const released = await db
    .update(mediaAssets)
    .set({ quotaBytes: 0, updatedAt: now })
    .where(
      and(
        inArray(
          mediaAssets.id,
          releasable.map(({ id }) => id),
        ),
        releasableMediaQuotaCondition(),
      ),
    )
    .returning({ id: mediaAssets.id });
  return released.length;
}

async function cleanupStoredObjects(
  budget: MediaMaintenanceBudget,
  now: Date,
  limit = budget.remainingIoAssets,
) {
  if (!budget.canStartIoAsset()) return 0;
  const tenantCursor = mediaMaintenanceTenantCursors.storedObject;
  const boundedLimit = Math.min(
    Math.max(Number.isInteger(limit) ? limit : 1, 1),
    FAIR_IO_PHASE_ASSET_LIMIT,
    budget.remainingIoAssets,
  );
  const candidates = await db
    .select()
    .from(mediaAssets)
    .where(
      or(
        and(
          inArray(mediaAssets.status, [
            "ready",
            "quarantined",
            "failed",
            "deleted",
          ]),
          lte(
            mediaAssets.uploadExpiresAt,
            new Date(now.getTime() - INCOMING_CLEANUP_GRACE_MS),
          ),
          or(
            isNull(mediaAssets.stagingDeletedAt),
            lte(mediaAssets.stagingDeletedAt, mediaAssets.uploadExpiresAt),
          ),
        ),
        and(
          eq(mediaAssets.status, "deleted"),
          isNull(mediaAssets.storageDeletedAt),
          lte(
            mediaAssets.deletedAt,
            new Date(now.getTime() - FINAL_CLEANUP_GRACE_MS),
          ),
        ),
        and(
          inArray(mediaAssets.status, ["quarantined", "failed"]),
          isNull(mediaAssets.storageDeletedAt),
          lte(
            mediaAssets.scanCompletedAt,
            new Date(now.getTime() - FINAL_CLEANUP_GRACE_MS),
          ),
        ),
      ),
    )
    .orderBy(
      ...(tenantCursor
        ? [
            sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
          ]
        : []),
      asc(mediaAssets.organizationId),
      asc(mediaAssets.uploadExpiresAt),
      asc(mediaAssets.id),
    )
    .limit(boundedLimit);
  if (candidates.length) {
    mediaMaintenanceTenantCursors.storedObject =
      candidates[candidates.length - 1]!.organizationId;
  }
  let cleaned = 0;
  for (const asset of candidates) {
    if (!budget.canStartPhase()) break;
    const stagingCleanupDue =
      asset.uploadExpiresAt.getTime() + INCOMING_CLEANUP_GRACE_MS <=
        now.getTime() &&
      (!asset.stagingDeletedAt ||
        asset.stagingDeletedAt.getTime() <= asset.uploadExpiresAt.getTime());
    const finalCleanupDue =
      !asset.storageDeletedAt &&
      ((asset.status === "deleted" &&
        asset.deletedAt &&
        asset.deletedAt.getTime() + FINAL_CLEANUP_GRACE_MS <= now.getTime()) ||
        (["quarantined", "failed"].includes(asset.status) &&
          asset.scanCompletedAt &&
          asset.scanCompletedAt.getTime() + FINAL_CLEANUP_GRACE_MS <=
            now.getTime()));
    if (!stagingCleanupDue && !finalCleanupDue) continue;
    if (!budget.tryClaimIoAsset()) break;
    const staging = stagingCleanupDue
      ? await deleteStage(asset, "staging", budget)
      : true;
    if (!budget.canStartPhase()) break;
    const ready = finalCleanupDue
      ? await deleteStage(asset, "ready", budget)
      : true;
    if (staging && ready) cleaned += 1;
  }
  return cleaned;
}

async function purgeVerifiedTombstones(
  budget: MediaMaintenanceBudget,
  now: Date,
  limit = budget.remainingIoAssets,
) {
  if (!budget.canStartIoAsset()) return 0;
  const tenantCursor = mediaMaintenanceTenantCursors.tombstone;
  const boundedLimit = Math.min(
    Math.max(Number.isInteger(limit) ? limit : 1, 1),
    FAIR_IO_PHASE_ASSET_LIMIT,
    budget.remainingIoAssets,
  );
  const cutoff = new Date(now.getTime() - TOMBSTONE_RETENTION_MS);
  const candidates = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        or(
          and(
            eq(mediaAssets.status, "deleted"),
            lte(mediaAssets.deletedAt, cutoff),
          ),
          and(
            inArray(mediaAssets.status, ["quarantined", "failed"]),
            lte(mediaAssets.scanCompletedAt, cutoff),
          ),
        ),
        eq(mediaAssets.quotaBytes, 0),
        isNotNull(mediaAssets.storageDeletedAt),
        isNotNull(mediaAssets.stagingDeletedAt),
      ),
    )
    .orderBy(
      ...(tenantCursor
        ? [
            sql<number>`case when ${mediaAssets.organizationId}::text > ${tenantCursor} then 0 else 1 end`,
          ]
        : []),
      asc(mediaAssets.organizationId),
      asc(mediaAssets.createdAt),
      asc(mediaAssets.id),
    )
    .limit(boundedLimit);
  if (candidates.length) {
    mediaMaintenanceTenantCursors.tombstone =
      candidates[candidates.length - 1]!.organizationId;
  }
  let purged = 0;
  for (const asset of candidates) {
    if (!budget.tryClaimIoAsset()) break;
    const [staging, ready] = await Promise.all([
      deleteStage(asset, "staging", budget),
      deleteStage(asset, "ready", budget),
    ]);
    if (!budget.canStartPhase()) break;
    if (!staging || !ready) continue;
    const [deleted] = await db
      .delete(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, asset.organizationId),
          inArray(mediaAssets.status, VERIFIED_DELETED_STATUSES),
          eq(mediaAssets.quotaBytes, 0),
        ),
      )
      .returning({ id: mediaAssets.id });
    if (deleted) purged += 1;
  }
  return purged;
}

export async function readMediaScanBacklogMetrics(now = new Date()) {
  const [backlog] = await db
    .select({
      depth: sql<number>`count(*) filter (where ${mediaAssets.status} in ('uploaded', 'scanning'))::int`,
      failed: sql<number>`count(*) filter (where ${mediaAssets.status} = 'failed')::int`,
      oldestQueuedAt: sql<unknown>`min(${mediaAssets.createdAt}) filter (where ${mediaAssets.status} in ('uploaded', 'scanning'))`,
    })
    .from(mediaAssets)
    .where(inArray(mediaAssets.status, ["uploaded", "scanning", "failed"]));
  return buildMediaScanBacklogMetrics({
    depth: Number(backlog?.depth ?? 0),
    failed: Number(backlog?.failed ?? 0),
    oldestQueuedAt: backlog?.oldestQueuedAt ?? null,
    nowMilliseconds: now.getTime(),
  });
}

export async function processMediaScanQueue(scanLimit = 1) {
  const scans = [];
  for (let index = 0; index < batchSize(scanLimit); index += 1) {
    const asset = await claimNextScan(new Date());
    if (!asset) break;
    scans.push(await processClaimedAsset(asset));
  }
  return { scans, backlog: await readMediaScanBacklogMetrics() };
}

export async function processMediaMaintenanceQueues(maintenanceLimit = 5) {
  const limit = maintenanceBatchSize(maintenanceLimit);
  const connection = await postgresClient.reserve();
  let lockAcquired = false;
  let lockReleased = false;
  const releaseLock = async () => {
    if (!lockAcquired || lockReleased) return;
    try {
      await connection`select pg_advisory_unlock_all()`;
      lockReleased = true;
    } catch (error) {
      // A lost PostgreSQL connection also releases all session locks.
      logServerError(error, { action: "media.maintenance.unlock" });
    }
  };
  try {
    const [lock] = await connection<Array<{ acquired: boolean }>>`
      select pg_try_advisory_lock(
        hashtextextended(${MEDIA_MAINTENANCE_ADVISORY_LOCK_KEY}, 0)
      ) as acquired
    `;
    if (!lock?.acquired) {
      return {
        skipped: true as const,
        cleanedMultipartSessions: 0,
        cancelledProcessingJobs: 0,
        reconciledOrbitTransfers: 0,
        releasedQuotaAssets: 0,
        removedProcessingArtifacts: 0,
        expired: 0,
        expiredUnattachedSubmissionAssets: 0,
        expiredUnattachedCourseAssets: 0,
        expiredUnattachedCommunityAssets: 0,
        expiredUnattachedProfileAssets: 0,
        expiredUnattachedProfileFieldAssets: 0,
        expiredUnattachedBrandingAssets: 0,
        cleaned: 0,
        purged: 0,
        timedOut: false,
      };
    }
    lockAcquired = true;
    const result = {
      skipped: false as const,
      cleanedMultipartSessions: 0,
      cancelledProcessingJobs: 0,
      reconciledOrbitTransfers: 0,
      releasedQuotaAssets: 0,
      removedProcessingArtifacts: 0,
      expired: 0,
      expiredUnattachedSubmissionAssets: 0,
      expiredUnattachedCourseAssets: 0,
      expiredUnattachedCommunityAssets: 0,
      expiredUnattachedProfileAssets: 0,
      expiredUnattachedProfileFieldAssets: 0,
      expiredUnattachedBrandingAssets: 0,
      cleaned: 0,
      purged: 0,
      timedOut: false,
    };
    try {
      await runMediaMaintenanceWithinBudget({
        ioLimit: limit,
        release: releaseLock,
        work: async (budget) => {
          // Pure database releases run before any provider backlog can consume
          // the shared I/O allowance.
          if (budget.canStartPhase()) {
            result.releasedQuotaAssets = await releaseVerifiedDeletedQuota(
              new Date(),
            );
          }
          if (budget.canStartPhase()) {
            result.cancelledProcessingJobs =
              await cancelUnavailableMediaProcessingJobs();
          }
          const now = new Date();
          if (budget.canStartPhase()) {
            result.reconciledOrbitTransfers =
              await reconcileStaleOrbitTransfers(limit, now);
          }
          if (budget.canStartPhase()) {
            result.expired = await expirePendingUploadsWithoutSessions(
              limit,
              now,
            );
          }
          if (budget.canStartPhase()) {
            result.expiredUnattachedSubmissionAssets =
              await expireUnattachedSubmissionAssets(limit, now);
          }
          if (budget.canStartPhase()) {
            result.expiredUnattachedCourseAssets =
              await expireUnattachedCourseAssets(limit, now);
          }
          if (budget.canStartPhase()) {
            result.expiredUnattachedCommunityAssets =
              await expireUnattachedCommunityAssets(limit, now);
          }
          if (budget.canStartPhase()) {
            result.expiredUnattachedProfileAssets =
              await expireUnattachedProfileAssets(limit, now);
            result.expiredUnattachedProfileFieldAssets =
              await expireUnattachedProfileFieldAssets(limit, now);
          }
          if (budget.canStartPhase()) {
            result.expiredUnattachedBrandingAssets =
              await expireUnattachedBrandingAssets(limit, now);
          }

          const fairIoPhases = [
            async () => {
              result.cleaned += await cleanupStoredObjects(
                budget,
                new Date(),
                FAIR_IO_PHASE_ASSET_LIMIT,
              );
            },
            async () => {
              result.removedProcessingArtifacts +=
                await cleanupMediaProcessingArtifacts(
                  budget,
                  FAIR_IO_PHASE_ASSET_LIMIT,
                );
            },
            async () => {
              result.expired += await expirePendingUploads(
                budget,
                FAIR_IO_PHASE_ASSET_LIMIT,
                now,
              );
            },
            async () => {
              result.cleanedMultipartSessions +=
                await cleanupDetachedMultipartUploads(
                  budget,
                  FAIR_IO_PHASE_ASSET_LIMIT,
                  now,
                );
            },
            async () => {
              result.purged += await purgeVerifiedTombstones(
                budget,
                new Date(),
                FAIR_IO_PHASE_ASSET_LIMIT,
              );
            },
          ] as const;
          let firstIoPhase =
            mediaMaintenanceIoPhaseCursor % fairIoPhases.length;
          mediaMaintenanceIoPhaseCursor =
            (mediaMaintenanceIoPhaseCursor + 1) % fairIoPhases.length;
          while (budget.canStartIoAsset()) {
            const remainingBeforeCycle = budget.remainingIoAssets;
            for (let offset = 0; offset < fairIoPhases.length; offset += 1) {
              if (!budget.canStartPhase()) break;
              await fairIoPhases[
                (firstIoPhase + offset) % fairIoPhases.length
              ]();
            }
            if (budget.remainingIoAssets === remainingBeforeCycle) break;
            firstIoPhase = (firstIoPhase + 1) % fairIoPhases.length;
          }
          if (budget.canStartPhase()) {
            result.releasedQuotaAssets += await releaseVerifiedDeletedQuota(
              new Date(),
            );
          }
        },
      });
    } catch (error) {
      if (!(error instanceof MediaMaintenanceDeadlineError)) throw error;
      result.timedOut = true;
    }
    return { ...result };
  } finally {
    await releaseLock();
    connection.release();
  }
}

export async function processMediaQueues(scanLimit = 1, maintenanceLimit = 5) {
  const scanResult = await processMediaScanQueue(scanLimit);
  const maintenance = await processMediaMaintenanceQueues(maintenanceLimit);
  return {
    ...maintenance,
    ...scanResult,
  };
}
