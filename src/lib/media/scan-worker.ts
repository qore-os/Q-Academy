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
  platformSettings,
  submissionAttachments,
  users,
} from "@/db/schema";
import {
  mediaAssetIdentity,
  type MediaAsset,
} from "@/lib/media/asset-service";
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
import { logServerError } from "@/lib/server-error-logging";
import { enqueueDefaultMediaProcessingJobs } from "@/lib/media/processing-worker";

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
export const MEDIA_MAINTENANCE_ADVISORY_LOCK_KEY =
  "q-academy:media-maintenance:v1";
const VERIFIED_DELETED_STATUSES = [
  "deleted",
  "quarantined",
  "failed",
] as const;

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
  const delay = Math.min(BASE_RETRY_MS * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
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
  const timer = setInterval(async () => {
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
  }, Math.floor(SCAN_LEASE_MS / 3));
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
      stagingDeletedAt: input.stagingDeleted ? input.now : asset.stagingDeletedAt,
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
      failureDetail: "Der Media-Scan ist nach mehreren Versuchen fehlgeschlagen.",
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
      durationMilliseconds: result.durationMilliseconds,
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
        "Die hochgeladene Datei stimmt nicht mit dem Upload-Intent ueberein.",
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

async function expirePendingUploads(limit: number, now: Date) {
  const expired = await db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.status, "pending"),
          lte(mediaAssets.uploadExpiresAt, now),
        ),
      )
      .orderBy(asc(mediaAssets.uploadExpiresAt))
      .limit(batchSize(limit))
      .for("update", { skipLocked: true });
    if (!candidates.length) return [];
    await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanFailureCode: "upload_expired",
        updatedAt: now,
      })
      .where(inArray(mediaAssets.id, candidates.map(({ id }) => id)));
    return candidates;
  });
  return expired.length;
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
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedSubmissionReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Der gepruefte Abgabeanhang wurde nicht innerhalb von 24 Stunden eingereicht.",
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
  const cutoff = new Date(
    now.getTime() - UNATTACHED_COURSE_READY_RETENTION_MS,
  );
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedCourseReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Das gepruefte Kursmedium wurde nicht innerhalb von 24 Stunden an einen Kurs gebunden.",
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
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedCommunityReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Der gepruefte Community-Anhang wurde nicht innerhalb von 24 Stunden veroeffentlicht.",
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
  const cutoff = new Date(now.getTime() - UNATTACHED_PROFILE_READY_RETENTION_MS);
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedProfileReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Das gepruefte Profilbild wurde nicht innerhalb von 24 Stunden gebunden.",
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
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedProfileFieldReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Das gepruefte Profilmedium wurde nicht innerhalb von 24 Stunden gebunden.",
        updatedAt: now,
      })
      .where(
        and(
          inArray(mediaAssets.id, candidates.map(({ id }) => id)),
          unattachedProfileFieldReadyCondition(cutoff),
        ),
      )
      .returning({ id: mediaAssets.id });
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
  const cutoff = new Date(now.getTime() - UNATTACHED_BRANDING_READY_RETENTION_MS);
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(unattachedBrandingReadyCondition(cutoff))
      .orderBy(asc(mediaAssets.scanCompletedAt), asc(mediaAssets.id))
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
          "Das gepruefte Branding-Bild wurde nicht innerhalb von 24 Stunden gebunden.",
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
    return expired.length;
  });
}

async function cleanupStoredObjects(
  budget: MediaMaintenanceBudget,
  now: Date,
) {
  if (!budget.canStartIoAsset()) return 0;
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
    .orderBy(asc(mediaAssets.uploadExpiresAt))
    .limit(budget.remainingIoAssets);
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
  if (!budget.canStartPhase()) return cleaned;
  const releasable = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        inArray(mediaAssets.status, VERIFIED_DELETED_STATUSES),
        gt(mediaAssets.quotaBytes, 0),
        isNotNull(mediaAssets.storageDeletedAt),
        isNotNull(mediaAssets.stagingDeletedAt),
        gte(
          mediaAssets.stagingDeletedAt,
          sql`${mediaAssets.uploadExpiresAt} + interval '1 hour'`,
        ),
      ),
    )
    .limit(MAX_MAINTENANCE_BATCH_SIZE);
  if (releasable.length) {
    await db
      .update(mediaAssets)
      .set({ quotaBytes: 0, updatedAt: new Date() })
      .where(inArray(mediaAssets.id, releasable.map(({ id }) => id)));
  }
  return cleaned;
}

async function purgeVerifiedTombstones(
  budget: MediaMaintenanceBudget,
  now: Date,
) {
  if (!budget.canStartIoAsset()) return 0;
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
    .orderBy(asc(mediaAssets.createdAt))
    .limit(budget.remainingIoAssets);
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
          // Purge old verified tombstones before cleanup can select them again.
          if (budget.canStartPhase()) {
            result.purged = await purgeVerifiedTombstones(budget, new Date());
          }
          const now = new Date();
          if (budget.canStartPhase()) {
            result.expired = await expirePendingUploads(limit, now);
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
          if (budget.canStartIoAsset()) {
            result.cleaned = await cleanupStoredObjects(budget, new Date());
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
