import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  courseCollaborators,
  courseMediaAssets,
  communityAssetBindings,
  communityPublicProfileFields,
  customFieldDefinitions,
  customFieldValues,
  dataProfileValues,
  mediaAssets,
  mediaUploadSessions,
  organizations,
  platformSettings,
  submissionAttachments,
  submissions,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import {
  mediaAssetIdentity,
  publicMediaAsset,
  reserveMediaAsset,
  type MediaAsset,
} from "@/lib/media/asset-service";
import {
  MediaPolicyError,
  validateMediaUploadPolicy,
} from "@/lib/media/mime-policy";
import {
  abortS3MultipartUpload,
  completeS3MultipartUpload,
  createS3MultipartPartUploadAuthorization,
  createS3MultipartUpload,
  listS3MultipartUploadParts,
  MediaStorageError,
} from "@/lib/media/s3-storage";
import {
  createS3MultipartUploadPlan,
  expectedS3MultipartPartSize,
  S3_MULTIPART_COMPLETION_RECOVERY_MS,
  S3_MULTIPART_DEFAULT_PART_BYTES,
} from "@/lib/media/s3-multipart-policy";
import { accessibleLessonsReferenceMediaAsset } from "@/lib/media/course-media-access-policy";
import {
  createMediaUploadAuthorization,
  deleteStoredMediaObject,
  inspectStoredMediaObject,
  writeDevelopmentMediaObject,
} from "@/lib/media/storage";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { canReadCourseMedia } from "@/lib/media/access-policy";
import {
  sessionMediaAssetManageVisibility,
  sessionMediaAssetReadVisibility,
} from "@/lib/media/api-scopes";
import { courseCoverMediaAssetId } from "@/lib/course-cover";
import { courseSnapshotWidgetsReferenceMediaAsset } from "@/lib/media/course-assets";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";
import {
  escapeCourseMediaLibrarySearch,
  type SessionCourseMediaListInput,
} from "@/lib/media/course-media-library";

export { sessionCourseMediaListSchema } from "@/lib/media/course-media-library";

const STAFF_ROLES = new Set<User["role"]>(["owner", "admin", "trainer"]);
const SESSION_MULTIPART_THRESHOLD_BYTES = 2 * S3_MULTIPART_DEFAULT_PART_BYTES;
const SESSION_MULTIPART_CONCURRENCY = 3;
// ListParts plus Complete/HEAD can consume just over eleven minutes at their
// hard S3 deadlines. Keep takeover outside that entire operation window.
const SESSION_MULTIPART_STALE_CLAIM_MS = 15 * 60_000;
const SESSION_MULTIPART_INITIALIZATION_LEASE_MS = 2 * 60_000;
const SESSION_MULTIPART_COMPLETION_OPERATION_RESERVE_MS = 12 * 60_000;
const globalForSessionMedia = globalThis as unknown as {
  sessionMediaUploads?: Set<string>;
};

function globalSessionMediaUploads() {
  globalForSessionMedia.sessionMediaUploads ??= new Set<string>();
  return globalForSessionMedia.sessionMediaUploads;
}

export const sessionMediaCreateSchema = z
  .object({
    purpose: z
      .enum([
        "submission",
        "course_content",
        "community",
        "avatar",
        "branding",
        "profile",
      ])
      .default("submission"),
    originalFileName: z.string().trim().min(1).max(255),
    declaredMimeType: z.string().trim().min(3).max(180),
    sizeBytes: z.number().int().positive(),
    clientUploadId: z.string().uuid(),
    ownerUserId: z.string().uuid().optional(),
  })
  .strict();

type SessionMediaCreateInput = z.infer<typeof sessionMediaCreateSchema>;

const OWNER_BOUND_SESSION_PURPOSES = new Set<
  SessionMediaCreateInput["purpose"]
>(["submission", "community", "avatar", "profile"]);

function assertSessionPurposeAccess(
  user: User,
  purpose: SessionMediaCreateInput["purpose"],
) {
  if (purpose === "course_content" && !STAFF_ROLES.has(user.role)) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Academy-Mitarbeitende duerfen Kursmedien hochladen.",
    );
  }
  if (
    purpose === "branding" &&
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Organisationsadministratoren duerfen Branding-Bilder hochladen.",
    );
  }
  if (purpose === "profile") {
    return;
  }
}

async function resolveSessionMediaOwner(
  user: User,
  input: SessionMediaCreateInput,
) {
  if (!OWNER_BOUND_SESSION_PURPOSES.has(input.purpose)) return null;
  const ownerUserId = input.ownerUserId ?? user.id;
  if (
    ownerUserId !== user.id &&
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Administratoren duerfen Media-Assets fuer andere Mitglieder anlegen.",
    );
  }
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, ownerUserId),
        eq(users.organizationId, user.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!owner) {
    throw new ApiError(
      404,
      "not_found",
      "Media-Eigentuemer nicht gefunden oder nicht aktiv.",
    );
  }
  return owner.id;
}

function canManageAsset(user: User, asset: MediaAsset) {
  if (asset.purpose === "submission" || asset.purpose === "community") {
    return asset.uploadedById === user.id && asset.ownerUserId === user.id;
  }
  if (asset.purpose === "avatar" || asset.purpose === "profile") {
    return (
      asset.ownerUserId === user.id ||
      user.role === "owner" ||
      user.role === "admin"
    );
  }
  if (asset.purpose === "branding") {
    return user.role === "owner" || user.role === "admin";
  }
  return (
    asset.purpose === "course_content" &&
    STAFF_ROLES.has(user.role) &&
    (asset.uploadedById === user.id ||
      user.role === "owner" ||
      user.role === "admin")
  );
}

function assertCanManageAsset(user: User, asset: MediaAsset) {
  if (!canManageAsset(user, asset)) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
}

function assertUploadedBy(user: User, asset: MediaAsset) {
  if (asset.uploadedById !== user.id) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
}

async function assertSessionMutationVisibility(user: User, asset: MediaAsset) {
  const [visible] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, asset.id),
        eq(mediaAssets.organizationId, user.organizationId),
        sessionMediaAssetManageVisibility(user),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
}

function sessionAssetDto(asset: MediaAsset) {
  return {
    ...publicMediaAsset(asset),
    statusUrl: `/api/media-assets/${asset.id}`,
  };
}

async function consumeSessionUploadIntentRateLimit(user: User) {
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_upload_intent_tenant",
        identifier: user.organizationId,
      },
    ],
    primary: { action: "media_upload_intent", identifier: user.id },
  });
  if (result.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Das Ratenlimit fuer Datei-Uploads wurde erreicht.",
      { limit: result.limit, resetAt: result.resetAt.toISOString() },
    );
  }
}

async function consumeSessionMultipartPartRateLimit(
  user: User,
  assetId: string,
) {
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_upload_part_tenant",
        identifier: user.organizationId,
      },
    ],
    primary: {
      action: "media_upload_part",
      identifier: `${user.id}:${assetId}`,
    },
  });
  if (result.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Das Ratenlimit fuer Multipart-Upload-Teile wurde erreicht.",
      { limit: result.limit, resetAt: result.resetAt.toISOString() },
    );
  }
}

async function consumeSessionMultipartCompleteRateLimit(
  user: User,
  assetId: string,
) {
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_upload_complete_tenant",
        identifier: user.organizationId,
      },
    ],
    primary: {
      action: "media_upload_complete",
      identifier: `${user.id}:${assetId}`,
    },
  });
  if (result.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Das Ratenlimit fuer Upload-Abschluesse wurde erreicht.",
      { limit: result.limit, resetAt: result.resetAt.toISOString() },
    );
  }
}

function sameSessionUploadIntent(
  user: User,
  asset: MediaAsset,
  input: SessionMediaCreateInput,
  policy: ReturnType<typeof validateMediaUploadPolicy>,
  storageDriver: MediaAsset["storageDriver"],
  ownerUserId: string | null,
) {
  return (
    asset.organizationId === user.organizationId &&
    asset.uploadedById === user.id &&
    asset.ownerUserId === ownerUserId &&
    asset.purpose === input.purpose &&
    asset.storageDriver === storageDriver &&
    asset.originalFileName === input.originalFileName &&
    asset.declaredMimeType === policy.mimeType &&
    asset.declaredSizeBytes === policy.sizeBytes &&
    asset.status !== "deleted"
  );
}

function usesSessionMultipartUpload(
  asset: Pick<MediaAsset, "declaredSizeBytes" | "storageDriver">,
) {
  const configuration = getMediaStorageConfiguration();
  return (
    asset.storageDriver === "s3" &&
    configuration.driver === "s3" &&
    configuration.compatibilityMode === "versioned" &&
    asset.declaredSizeBytes >= SESSION_MULTIPART_THRESHOLD_BYTES
  );
}

function sessionMultipartUploadUrls(assetId: string) {
  const statusUrl = `/api/media-assets/${assetId}/multipart`;
  return {
    statusUrl,
    partsUrl: `${statusUrl}/parts`,
  };
}

async function sessionMultipartUploadRecord(
  asset: MediaAsset,
  recoveryDeadline?: Date,
  ownedInitializationToken?: string,
) {
  const staleInitializationBefore = new Date(
    Date.now() - SESSION_MULTIPART_INITIALIZATION_LEASE_MS,
  );
  const [existing] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.assetId, asset.id),
        eq(mediaUploadSessions.organizationId, asset.organizationId),
      ),
    )
    .limit(1);
  const ownsExistingClaim =
    (existing?.state === "initializing" || existing?.state === "recovering") &&
    !existing.providerUploadId &&
    existing.initializationToken === ownedInitializationToken;
  if (
    existing &&
    !ownsExistingClaim &&
    !(
      (existing.state === "initializing" || existing.state === "recovering") &&
      existing.updatedAt <= staleInitializationBefore
    )
  ) {
    return existing;
  }
  const effectiveRecoveryDeadline =
    recoveryDeadline ??
    (existing?.state === "recovering" ? existing.uploadDeadlineAt : undefined);

  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    configuration.compatibilityMode !== "versioned"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Multipart-Uploads sind fuer diesen Speicher nicht verfuegbar.",
    );
  }
  if (
    effectiveRecoveryDeadline &&
    effectiveRecoveryDeadline.getTime() - Date.now() <
      SESSION_MULTIPART_STALE_CLAIM_MS
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die verbleibende Upload-Zeit reicht nicht fuer eine sichere Wiederherstellung.",
      { reason: "upload_session_expiring" },
    );
  }
  const plan = createS3MultipartUploadPlan(asset.declaredSizeBytes);
  const initializationToken = ownedInitializationToken ?? randomUUID();
  const claim = ownsExistingClaim
    ? { ownsClaim: true as const, session: existing! }
    : await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, asset.id),
              eq(mediaAssets.organizationId, asset.organizationId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !current ||
          current.status !== "pending" ||
          current.uploadExpiresAt.getTime() <= Date.now()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der Multipart-Upload ist nicht mehr aktiv.",
          );
        }
        const [winner] = await tx
          .select()
          .from(mediaUploadSessions)
          .where(
            and(
              eq(mediaUploadSessions.assetId, current.id),
              eq(mediaUploadSessions.organizationId, current.organizationId),
            ),
          )
          .limit(1)
          .for("update");
        if (winner) {
          if (
            !["initializing", "recovering"].includes(winner.state) ||
            winner.updatedAt > staleInitializationBefore
          ) {
            return { ownsClaim: false as const, session: winner };
          }
          await tx
            .delete(mediaUploadSessions)
            .where(
              and(
                eq(mediaUploadSessions.assetId, winner.assetId),
                eq(
                  mediaUploadSessions.initializationToken,
                  winner.initializationToken,
                ),
                eq(mediaUploadSessions.state, winner.state),
              ),
            );
        }
        const [session] = await tx
          .insert(mediaUploadSessions)
          .values({
            assetId: current.id,
            organizationId: current.organizationId,
            initializationToken,
            providerUploadId: null,
            partSizeBytes: plan.partSizeBytes,
            expectedPartCount: plan.partCount,
            expiresAt: current.uploadExpiresAt,
            uploadDeadlineAt:
              effectiveRecoveryDeadline ?? current.uploadExpiresAt,
            state: effectiveRecoveryDeadline ? "recovering" : "initializing",
          })
          .returning();
        if (!session) {
          throw new ApiError(
            503,
            "internal_error",
            "Die Multipart-Upload-Sitzung konnte nicht reserviert werden.",
          );
        }
        return { ownsClaim: true as const, session };
      });
  if (!claim.ownsClaim) return claim.session;

  let created: Awaited<ReturnType<typeof createS3MultipartUpload>> | undefined;
  try {
    created = await createS3MultipartUpload(configuration, {
      ...mediaAssetIdentity(asset, "staging"),
      mimeType: asset.declaredMimeType,
      sizeBytes: asset.declaredSizeBytes,
    });
    if (
      created.uploadId.length > 1024 ||
      created.plan.partSizeBytes !== plan.partSizeBytes ||
      created.plan.partCount !== plan.partCount
    ) {
      throw new ApiError(
        503,
        "internal_error",
        "Der Objektspeicher hat eine ungueltige Upload-Sitzung geliefert.",
      );
    }
  } catch (error) {
    if (created) {
      await abortS3MultipartUpload(configuration, {
        ...mediaAssetIdentity(asset, "staging"),
        uploadId: created.uploadId,
      }).catch((abortError) => {
        logServerError(abortError, {
          action: "media.multipart.invalid_create_rollback",
        });
      });
    }
    await db
      .transaction(async (tx) => {
        const [current] = await tx
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, asset.id),
              eq(mediaAssets.organizationId, asset.organizationId),
              eq(mediaAssets.status, "pending"),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) return;
        const [removedClaim] = await tx
          .delete(mediaUploadSessions)
          .where(
            and(
              eq(mediaUploadSessions.assetId, asset.id),
              eq(mediaUploadSessions.initializationToken, initializationToken),
              isNull(mediaUploadSessions.providerUploadId),
              or(
                eq(mediaUploadSessions.state, "initializing"),
                eq(mediaUploadSessions.state, "recovering"),
                eq(mediaUploadSessions.state, "aborting"),
              ),
            ),
          )
          .returning({ assetId: mediaUploadSessions.assetId });
        if (!removedClaim) return;
        await tx
          .delete(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, asset.id),
              eq(mediaAssets.organizationId, asset.organizationId),
              eq(mediaAssets.status, "pending"),
            ),
          );
      })
      .catch((cleanupError) => {
        logServerError(cleanupError, {
          action: "media.multipart.initialization_cleanup",
        });
      });
    throw error;
  }

  let activationError: unknown;
  let activated: typeof mediaUploadSessions.$inferSelect | undefined;
  try {
    activated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, asset.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !current ||
        current.status !== "pending" ||
        current.uploadExpiresAt.getTime() <= Date.now()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Der Multipart-Upload ist nicht mehr aktiv.",
        );
      }
      const multipartExpiresAt = new Date(
        Math.min(
          Date.now() + configuration.limits.multipartUploadTtlSeconds * 1000,
          effectiveRecoveryDeadline?.getTime() ?? Number.MAX_SAFE_INTEGER,
        ),
      );
      const [record] = await tx
        .update(mediaUploadSessions)
        .set({
          providerUploadId: created.uploadId,
          expiresAt: multipartExpiresAt,
          uploadDeadlineAt: effectiveRecoveryDeadline ?? multipartExpiresAt,
          state: "uploading",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaUploadSessions.assetId, current.id),
            eq(mediaUploadSessions.organizationId, current.organizationId),
            eq(mediaUploadSessions.initializationToken, initializationToken),
            eq(mediaUploadSessions.state, claim.session.state),
            isNull(mediaUploadSessions.providerUploadId),
          ),
        )
        .returning();
      if (!record) return undefined;
      await tx
        .update(mediaAssets)
        .set({ uploadExpiresAt: multipartExpiresAt, updatedAt: new Date() })
        .where(eq(mediaAssets.id, current.id));
      return record;
    });
  } catch (error) {
    activationError = error;
  }
  if (activated) return activated;

  let persisted: typeof mediaUploadSessions.$inferSelect | undefined;
  let reconciliationSucceeded = false;
  try {
    [persisted] = await db
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, asset.organizationId),
        ),
      )
      .limit(1);
    reconciliationSucceeded = true;
  } catch (reconciliationError) {
    logServerError(reconciliationError, {
      action: "media.multipart.create_reconcile",
    });
  }
  if (
    persisted?.providerUploadId === created.uploadId &&
    persisted.state === "uploading"
  ) {
    return persisted;
  }
  if (reconciliationSucceeded) {
    await abortS3MultipartUpload(configuration, {
      ...mediaAssetIdentity(asset, "staging"),
      uploadId: created.uploadId,
    }).catch((abortError) => {
      logServerError(abortError, {
        action: "media.multipart.create_rollback",
      });
    });
    await db
      .delete(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.initializationToken, initializationToken),
          isNull(mediaUploadSessions.providerUploadId),
        ),
      );
  }
  if (activationError) throw activationError;
  throw new ApiError(
    409,
    "conflict",
    "Die Multipart-Upload-Sitzung wurde waehrend der Initialisierung beendet.",
  );
}

async function sessionUploadIntentResponse(asset: MediaAsset) {
  if (asset.status !== "pending") {
    return {
      ...sessionAssetDto(asset),
      upload: null,
      completeUrl: null,
    };
  }
  if (asset.uploadExpiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      409,
      "conflict",
      "Der idempotente Upload-Intent ist abgelaufen.",
      { reason: "upload_expired" },
    );
  }
  if (usesSessionMultipartUpload(asset)) {
    const session = await sessionMultipartUploadRecord(asset);
    if (session.state === "initializing" || session.state === "recovering") {
      throw new ApiError(
        503,
        "internal_error",
        "Die Multipart-Upload-Sitzung wird gerade initialisiert.",
        { reason: "upload_session_initializing", retryAfterSeconds: 2 },
      );
    }
    if (
      session.state === "completing" &&
      session.expiresAt.getTime() > Date.now()
    ) {
      return {
        ...sessionAssetDto(asset),
        upload: null,
        completeUrl: `/api/media-assets/${asset.id}/complete`,
        completionPending: true,
      };
    }
    if (
      session.state === "uploading" &&
      session.uploadDeadlineAt.getTime() <= Date.now() &&
      session.expiresAt.getTime() > Date.now()
    ) {
      return {
        ...sessionAssetDto(asset),
        upload: null,
        completeUrl: `/api/media-assets/${asset.id}/complete`,
        completionPending: true,
      };
    }
    if (
      session.expiresAt.getTime() <= Date.now() ||
      session.state !== "uploading"
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
      );
    }
    return {
      ...sessionAssetDto(asset),
      upload: {
        transport: "s3-multipart" as const,
        ...sessionMultipartUploadUrls(asset.id),
        partSizeBytes: session.partSizeBytes,
        partCount: session.expectedPartCount,
        concurrency: SESSION_MULTIPART_CONCURRENCY,
      },
      completeUrl: `/api/media-assets/${asset.id}/complete`,
    };
  }
  const authorization = await createMediaUploadAuthorization({
    ...mediaAssetIdentity(asset, "staging"),
    mimeType: asset.declaredMimeType,
    sizeBytes: asset.declaredSizeBytes,
  });
  return {
    ...sessionAssetDto(asset),
    upload:
      authorization.transport === "s3"
        ? authorization
        : {
            ...authorization,
            url: `/api/media-assets/${asset.id}/content`,
          },
    completeUrl:
      authorization.transport === "s3"
        ? `/api/media-assets/${asset.id}/complete`
        : null,
  };
}

export async function createSessionMediaAsset(
  user: User,
  input: SessionMediaCreateInput,
) {
  assertSessionPurposeAccess(user, input.purpose);
  const ownerUserId = await resolveSessionMediaOwner(user, input);
  const configuration = getMediaStorageConfiguration();
  let policy;
  try {
    policy = validateMediaUploadPolicy({
      purpose: input.purpose,
      originalFileName: input.originalFileName,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.sizeBytes,
      globalMaxUploadBytes: configuration.limits.maxUploadBytes,
    });
  } catch (error) {
    if (error instanceof MediaPolicyError) {
      throw new ApiError(422, "validation_error", error.message, {
        code: error.code,
        ...error.details,
      });
    }
    throw error;
  }

  await consumeSessionUploadIntentRateLimit(user);

  const [existing] = await db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.id, input.clientUploadId))
    .limit(1);
  if (existing) {
    if (
      !sameSessionUploadIntent(
        user,
        existing,
        input,
        policy,
        configuration.driver,
        ownerUserId,
      )
    ) {
      throw new ApiError(
        409,
        "conflict",
        "clientUploadId wurde bereits fuer einen anderen Upload verwendet.",
      );
    }
    return sessionUploadIntentResponse(existing);
  }

  const asset = await db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1)
      .for("update");
    if (!tenant) {
      throw new ApiError(404, "not_found", "Organisation nicht gefunden.");
    }
    const [raced] = await tx
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, input.clientUploadId))
      .limit(1)
      .for("update");
    if (raced) {
      if (
        !sameSessionUploadIntent(
          user,
          raced,
          input,
          policy,
          configuration.driver,
          ownerUserId,
        )
      ) {
        throw new ApiError(
          409,
          "conflict",
          "clientUploadId wurde bereits fuer einen anderen Upload verwendet.",
        );
      }
      return raced;
    }
    const asset = await reserveMediaAsset({
      tx,
      id: input.clientUploadId,
      organizationId: user.organizationId,
      actor: {
        id: user.id,
        organizationId: user.organizationId,
        role: user.role,
      },
      ownerUserId,
      policy,
      originalFileName: input.originalFileName,
      configuration,
    });
    await tx.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: "media_asset.created",
      entityType: "media_asset",
      entityId: asset.id,
      metadata: {
        purpose: asset.purpose,
        kind: asset.kind,
        sizeBytes: asset.declaredSizeBytes,
        source: "browser_session",
      },
    });
    return asset;
  });
  return sessionUploadIntentResponse(asset);
}

export async function getSessionMediaAsset(user: User, id: string) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        or(
          eq(mediaAssets.purpose, "submission"),
          eq(mediaAssets.purpose, "course_content"),
          eq(mediaAssets.purpose, "community"),
          eq(mediaAssets.purpose, "avatar"),
          eq(mediaAssets.purpose, "branding"),
          eq(mediaAssets.purpose, "profile"),
        )!,
        sessionMediaAssetReadVisibility(user),
      ),
    )
    .limit(1);
  if (!asset || asset.status === "deleted") {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
  return asset;
}

export async function listSessionCourseMediaAssets(
  user: User,
  input: SessionCourseMediaListInput,
) {
  assertSessionPurposeAccess(user, "course_content");
  const search = escapeCourseMediaLibrarySearch(input.search);
  return db
    .select({
      id: mediaAssets.id,
      originalFileName: mediaAssets.originalFileName,
      declaredSizeBytes: mediaAssets.declaredSizeBytes,
      actualSizeBytes: mediaAssets.actualSizeBytes,
      durationMilliseconds: mediaAssets.durationMilliseconds,
      createdAt: mediaAssets.createdAt,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.kind, input.kind),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
        sessionMediaAssetReadVisibility(user),
        ...(search
          ? [
              sql`${mediaAssets.originalFileName} ilike ${`%${search}%`} escape '\\'`,
            ]
          : []),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(input.limit);
}

function multipartApiFailure(error: unknown): never {
  if (error instanceof MediaStorageError) {
    throw new ApiError(
      error.code === "object_missing"
        ? 409
        : error.code === "storage_unavailable"
          ? 503
          : 422,
      error.code === "object_missing"
        ? "conflict"
        : error.code === "storage_unavailable"
          ? "internal_error"
          : "validation_error",
      error.message,
    );
  }
  throw error;
}

async function activeSessionMultipartUpload(
  user: User,
  id: string,
  options: Readonly<{ allowCompletionRecovery?: boolean }> = {},
) {
  const now = Date.now();
  const asset = await getSessionMediaAsset(user, id);
  assertUploadedBy(user, asset);
  await assertSessionMutationVisibility(user, asset);
  if (
    asset.storageDriver !== "s3" ||
    asset.status !== "pending" ||
    asset.uploadExpiresAt.getTime() <= now
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
    );
  }
  const [session] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.assetId, asset.id),
        eq(mediaUploadSessions.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (
    !session ||
    session.state !== "uploading" ||
    !session.providerUploadId ||
    session.expiresAt.getTime() <= now ||
    (!options.allowCompletionRecovery &&
      session.uploadDeadlineAt.getTime() <= now)
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
    );
  }
  const plan = createS3MultipartUploadPlan(
    asset.declaredSizeBytes,
    session.partSizeBytes,
  );
  if (plan.partCount !== session.expectedPartCount) {
    throw new Error("The persisted multipart upload plan is inconsistent.");
  }
  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    configuration.compatibilityMode !== "versioned"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Multipart-Uploads sind fuer diesen Speicher nicht verfuegbar.",
    );
  }
  return {
    asset,
    configuration,
    plan,
    session,
    uploadId: session.providerUploadId,
  };
}

export async function getSessionMultipartUploadStatus(user: User, id: string) {
  const context = await activeSessionMultipartUpload(user, id);
  await consumeSessionMultipartPartRateLimit(user, context.asset.id);
  try {
    const listed = await listS3MultipartUploadParts(context.configuration, {
      ...mediaAssetIdentity(context.asset, "staging"),
      uploadId: context.uploadId,
      expectedSizeBytes: context.asset.declaredSizeBytes,
      partSizeBytes: context.session.partSizeBytes,
    });
    return {
      partSizeBytes: listed.plan.partSizeBytes,
      partCount: listed.plan.partCount,
      uploadedBytes: listed.uploadedBytes,
      uploadedParts: listed.parts.map((part) => ({
        partNumber: part.partNumber,
        sizeBytes: part.sizeBytes,
      })),
      expiresAt: context.session.expiresAt,
    };
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "object_missing") {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung existiert beim Objektspeicher nicht mehr.",
        { reason: "upload_session_missing" },
      );
    }
    multipartApiFailure(error);
  }
}

export async function recoverSessionMultipartUploadStatus(
  user: User,
  id: string,
) {
  const context = await activeSessionMultipartUpload(user, id, {
    allowCompletionRecovery: true,
  });
  await consumeSessionMultipartPartRateLimit(user, context.asset.id);
  try {
    const listed = await listS3MultipartUploadParts(context.configuration, {
      ...mediaAssetIdentity(context.asset, "staging"),
      uploadId: context.uploadId,
      expectedSizeBytes: context.asset.declaredSizeBytes,
      partSizeBytes: context.session.partSizeBytes,
    });
    return {
      partSizeBytes: listed.plan.partSizeBytes,
      partCount: listed.plan.partCount,
      uploadedBytes: listed.uploadedBytes,
      uploadedParts: listed.parts.map((part) => ({
        partNumber: part.partNumber,
        sizeBytes: part.sizeBytes,
      })),
      expiresAt: context.session.expiresAt,
    };
  } catch (error) {
    if (
      !(error instanceof MediaStorageError) ||
      error.code !== "object_missing"
    ) {
      multipartApiFailure(error);
    }
  }

  try {
    const completed = await inspectStoredMediaObject(
      mediaAssetIdentity(context.asset, "staging"),
    );
    if (
      completed.sizeBytes !== context.asset.declaredSizeBytes ||
      !("mimeType" in completed) ||
      completed.mimeType !== context.asset.declaredMimeType ||
      !("etag" in completed) ||
      !completed.etag ||
      !("versionId" in completed) ||
      !completed.versionId
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Das abgeschlossene Multipart-Objekt stimmt nicht mit dem Upload-Intent ueberein.",
      );
    }
    return {
      partSizeBytes: context.plan.partSizeBytes,
      partCount: context.plan.partCount,
      uploadedBytes: context.asset.declaredSizeBytes,
      uploadedParts: Array.from(
        { length: context.plan.partCount },
        (_, index) => ({
          partNumber: index + 1,
          sizeBytes: expectedS3MultipartPartSize(context.plan, index + 1),
        }),
      ),
      expiresAt: context.session.expiresAt,
    };
  } catch (error) {
    if (
      !(error instanceof MediaStorageError) ||
      error.code !== "object_missing"
    ) {
      multipartApiFailure(error);
    }
  }

  if (context.session.uploadDeadlineAt.getTime() <= Date.now()) {
    throw new ApiError(
      409,
      "conflict",
      "Die Upload-Frist ist abgelaufen und beim Objektspeicher liegt kein abgeschlossenes Objekt vor.",
      { reason: "upload_expired" },
    );
  }

  const recoveryToken = randomUUID();
  const recoveryClaim = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: mediaAssets.id,
        status: mediaAssets.status,
        uploadExpiresAt: mediaAssets.uploadExpiresAt,
      })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, context.asset.id),
          eq(mediaAssets.organizationId, context.asset.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (
      !current ||
      current.status !== "pending" ||
      current.uploadExpiresAt.getTime() <= Date.now()
    ) {
      return undefined;
    }
    const [claimed] = await tx
      .update(mediaUploadSessions)
      .set({
        initializationToken: recoveryToken,
        providerUploadId: null,
        state: "recovering",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, context.asset.id),
          eq(mediaUploadSessions.organizationId, context.asset.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            context.session.initializationToken,
          ),
          eq(mediaUploadSessions.providerUploadId, context.uploadId),
          eq(
            mediaUploadSessions.uploadDeadlineAt,
            context.session.uploadDeadlineAt,
          ),
          eq(mediaUploadSessions.state, "uploading"),
        ),
      )
      .returning();
    return claimed;
  });
  if (!recoveryClaim) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung wurde bereits von einem neueren Versuch uebernommen.",
      { reason: "upload_session_recovery_in_progress", retryAfterSeconds: 2 },
    );
  }
  const recovered = await sessionMultipartUploadRecord(
    context.asset,
    context.session.uploadDeadlineAt,
    recoveryToken,
  );
  if (
    recovered.state !== "uploading" ||
    !recovered.providerUploadId ||
    recovered.expiresAt.getTime() <= Date.now()
  ) {
    throw new ApiError(
      ["initializing", "recovering"].includes(recovered.state) ? 503 : 409,
      ["initializing", "recovering"].includes(recovered.state)
        ? "internal_error"
        : "conflict",
      ["initializing", "recovering"].includes(recovered.state)
        ? "Die Multipart-Upload-Sitzung wird gerade wiederhergestellt."
        : "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
      ["initializing", "recovering"].includes(recovered.state)
        ? { reason: "upload_session_initializing" }
        : undefined,
    );
  }
  return {
    partSizeBytes: recovered.partSizeBytes,
    partCount: recovered.expectedPartCount,
    uploadedBytes: 0,
    uploadedParts: [],
    expiresAt: recovered.expiresAt,
  };
}

export async function authorizeSessionMultipartUploadPart(
  user: User,
  id: string,
  input: Readonly<{ partNumber: number; checksumSha256: string }>,
) {
  const context = await activeSessionMultipartUpload(user, id);
  await consumeSessionMultipartPartRateLimit(user, context.asset.id);
  if (input.partNumber < 1 || input.partNumber > context.plan.partCount) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Multipart-Teilnummer ist ungueltig.",
    );
  }
  const sizeBytes = expectedS3MultipartPartSize(context.plan, input.partNumber);
  try {
    return await createS3MultipartPartUploadAuthorization(
      context.configuration,
      {
        ...mediaAssetIdentity(context.asset, "staging"),
        uploadId: context.uploadId,
        expectedSizeBytes: context.asset.declaredSizeBytes,
        partSizeBytes: context.session.partSizeBytes,
        partNumber: input.partNumber,
        sizeBytes,
        checksumSha256: input.checksumSha256,
      },
    );
  } catch (error) {
    multipartApiFailure(error);
  }
}

async function* requestChunks(request: Request) {
  if (!request.body) {
    throw new ApiError(400, "bad_request", "Der Upload-Body fehlt.");
  }
  const reader = request.body.getReader();
  const timeoutMs = 10 * 60_000;
  const deadline = Date.now() + timeoutMs;
  try {
    while (true) {
      if (request.signal.aborted) {
        throw new ApiError(400, "bad_request", "Der Upload wurde abgebrochen.");
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new ApiError(
          409,
          "conflict",
          "Der Upload hat zu lange gedauert.",
        );
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new ApiError(
                409,
                "conflict",
                "Der Upload hat zu lange gedauert.",
              ),
            ),
          remaining,
        );
      });
      const chunk = await Promise.race([reader.read(), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (chunk.done) break;
      if (chunk.value.byteLength) yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function uploadSessionMediaAsset(
  user: User,
  id: string,
  request: Request,
) {
  const asset = await getSessionMediaAsset(user, id);
  assertUploadedBy(user, asset);
  await assertSessionMutationVisibility(user, asset);
  if (
    asset.storageDriver === "filesystem" &&
    ["uploaded", "scanning", "ready", "quarantined", "failed"].includes(
      asset.status,
    )
  ) {
    return sessionAssetDto(asset);
  }
  if (
    asset.status !== "pending" ||
    asset.uploadExpiresAt.getTime() <= Date.now()
  ) {
    throw new ApiError(409, "conflict", "Der Upload ist nicht mehr aktiv.");
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== asset.declaredMimeType) {
    throw new ApiError(
      422,
      "validation_error",
      "Content-Type stimmt nicht mit dem Upload-Intent ueberein.",
    );
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) !== asset.declaredSizeBytes)
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Content-Length stimmt nicht mit dem Upload-Intent ueberein.",
    );
  }

  if (asset.storageDriver !== "filesystem") {
    throw new ApiError(
      409,
      "conflict",
      "Direkte S3-Uploads werden ueber die signierte Upload-URL uebertragen.",
    );
  }
  const uploads = globalSessionMediaUploads();
  if (uploads.has(asset.id)) {
    throw new ApiError(409, "conflict", "Der Upload wird bereits verarbeitet.");
  }
  uploads.add(asset.id);
  try {
    try {
      await writeDevelopmentMediaObject({
        identity: mediaAssetIdentity(asset, "staging"),
        body: requestChunks(request),
        expectedSizeBytes: asset.declaredSizeBytes,
      });
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "object_exists"
      )) {
        throw error;
      }
    }

    let stored;
    try {
      stored = await inspectStoredMediaObject(
        mediaAssetIdentity(asset, "staging"),
      );
    } catch (error) {
      if (error instanceof MediaStorageError) {
        throw new ApiError(
          error.code === "object_missing" ? 409 : 422,
          error.code === "object_missing" ? "conflict" : "validation_error",
          error.message,
          { reason: error.code },
        );
      }
      throw error;
    }
    if (
      stored.sizeBytes !== asset.declaredSizeBytes ||
      ("mimeType" in stored && stored.mimeType !== asset.declaredMimeType)
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Die gespeicherte Datei stimmt nicht mit dem Upload-Intent ueberein.",
      );
    }

    const now = new Date();
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, user.organizationId),
            sessionMediaAssetManageVisibility(user),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) {
        throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
      }
      if (
        current.status !== "pending" ||
        current.uploadExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ApiError(409, "conflict", "Der Upload ist nicht mehr aktiv.");
      }
      assertUploadedBy(user, current);
      const [updated] = await tx
        .update(mediaAssets)
        .set({
          status: "uploaded",
          actualSizeBytes: stored.sizeBytes,
          etag: "etag" in stored ? stored.etag : null,
          uploadedAt: now,
          scanNextRetryAt: now,
          updatedAt: now,
        })
        .where(eq(mediaAssets.id, current.id))
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.uploaded",
        entityType: "media_asset",
        entityId: current.id,
        metadata: {
          transport: current.storageDriver,
          sizeBytes: stored.sizeBytes,
          source: "browser_session",
        },
      });
      return sessionAssetDto(updated);
    });
  } finally {
    uploads.delete(asset.id);
  }
}

export async function completeSessionMediaAsset(user: User, id: string) {
  const asset = await getSessionMediaAsset(user, id);
  assertUploadedBy(user, asset);
  await assertSessionMutationVisibility(user, asset);
  if (
    asset.storageDriver === "s3" &&
    ["uploaded", "scanning", "ready", "quarantined", "failed"].includes(
      asset.status,
    )
  ) {
    await db
      .delete(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, user.organizationId),
        ),
      );
    return sessionAssetDto(asset);
  }
  await consumeSessionMultipartCompleteRateLimit(user, asset.id);
  if (
    asset.storageDriver !== "s3" ||
    asset.status !== "pending" ||
    asset.uploadExpiresAt.getTime() <= Date.now()
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Der direkte Upload kann nicht abgeschlossen werden.",
    );
  }
  const [multipartSession] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.assetId, asset.id),
        eq(mediaUploadSessions.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  let stored;
  let uploadTransport: "s3" | "s3_multipart" = "s3";
  let completionClaim:
    Readonly<{ providerUploadId: string; updatedAt: Date }> | undefined;
  let releaseMultipartCompletionClaim: (() => Promise<void>) | undefined;
  if (multipartSession) {
    const configuration = getMediaStorageConfiguration();
    if (
      configuration.driver !== "s3" ||
      configuration.compatibilityMode !== "versioned"
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Multipart-Uploads sind fuer diesen Speicher nicht verfuegbar.",
      );
    }
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - SESSION_MULTIPART_STALE_CLAIM_MS,
    );
    const absoluteUploadDeadline = multipartSession.uploadDeadlineAt;
    const completionLeaseExpiresAt = new Date(
      absoluteUploadDeadline.getTime() + S3_MULTIPART_COMPLETION_RECOVERY_MS,
    );
    const claimed = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, user.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !current ||
        current.status !== "pending" ||
        current.uploadExpiresAt.getTime() <= now.getTime()
      ) {
        return undefined;
      }
      const claimableState = or(
        eq(mediaUploadSessions.state, "uploading"),
        and(
          eq(mediaUploadSessions.state, "completing"),
          lt(mediaUploadSessions.updatedAt, staleBefore),
        ),
      );
      if (
        completionLeaseExpiresAt.getTime() - now.getTime() <
        SESSION_MULTIPART_COMPLETION_OPERATION_RESERVE_MS
      ) {
        return undefined;
      }
      const [session] = await tx
        .update(mediaUploadSessions)
        .set({
          state: "completing",
          expiresAt: completionLeaseExpiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaUploadSessions.assetId, current.id),
            eq(mediaUploadSessions.organizationId, current.organizationId),
            gt(mediaUploadSessions.expiresAt, now),
            claimableState,
          ),
        )
        .returning();
      if (!session) return undefined;
      await tx
        .update(mediaAssets)
        .set({
          uploadExpiresAt: completionLeaseExpiresAt,
          updatedAt: now,
        })
        .where(eq(mediaAssets.id, current.id));
      return session;
    });
    if (!claimed) {
      throw new ApiError(
        409,
        "conflict",
        "Der Multipart-Upload wird bereits abgeschlossen.",
        { reason: "completion_in_progress", retryAfterSeconds: 5 },
      );
    }
    if (!claimed.providerUploadId) {
      throw new Error("The claimed multipart upload has no provider identity.");
    }
    const claimedProviderUploadId = claimed.providerUploadId;
    completionClaim = {
      providerUploadId: claimedProviderUploadId,
      updatedAt: claimed.updatedAt,
    };
    releaseMultipartCompletionClaim = async () => {
      const releaseNow = new Date();
      const uploadDeadlinePassed =
        releaseNow.getTime() >= absoluteUploadDeadline.getTime();
      await db
        .update(mediaUploadSessions)
        .set({
          state: uploadDeadlinePassed ? "completing" : "uploading",
          updatedAt: uploadDeadlinePassed
            ? new Date(
                releaseNow.getTime() - SESSION_MULTIPART_STALE_CLAIM_MS - 1,
              )
            : releaseNow,
        })
        .where(
          and(
            eq(mediaUploadSessions.assetId, asset.id),
            eq(mediaUploadSessions.organizationId, user.organizationId),
            eq(mediaUploadSessions.providerUploadId, claimedProviderUploadId),
            eq(mediaUploadSessions.state, "completing"),
            eq(mediaUploadSessions.updatedAt, claimed.updatedAt),
          ),
        );
    };
    try {
      stored = await completeS3MultipartUpload(configuration, {
        ...mediaAssetIdentity(asset, "staging"),
        uploadId: claimedProviderUploadId,
        expectedSizeBytes: asset.declaredSizeBytes,
        partSizeBytes: claimed.partSizeBytes,
        mimeType: asset.declaredMimeType,
      });
    } catch (error) {
      if (
        error instanceof MediaStorageError &&
        error.code === "object_missing"
      ) {
        try {
          stored = await inspectStoredMediaObject(
            mediaAssetIdentity(asset, "staging"),
          );
        } catch (recoveryError) {
          await releaseMultipartCompletionClaim();
          multipartApiFailure(recoveryError);
        }
      } else {
        await releaseMultipartCompletionClaim();
        multipartApiFailure(error);
      }
    }
    uploadTransport = "s3_multipart";
  } else {
    try {
      stored = await inspectStoredMediaObject(
        mediaAssetIdentity(asset, "staging"),
      );
    } catch (error) {
      if (error instanceof MediaStorageError) {
        throw new ApiError(
          error.code === "object_missing" ? 409 : 422,
          error.code === "object_missing" ? "conflict" : "validation_error",
          error.message,
          { reason: error.code },
        );
      }
      throw error;
    }
  }
  if (
    stored.sizeBytes !== asset.declaredSizeBytes ||
    !("mimeType" in stored) ||
    stored.mimeType !== asset.declaredMimeType ||
    !("etag" in stored) ||
    !stored.etag ||
    !("versionId" in stored) ||
    !stored.versionId
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Die gespeicherte Datei stimmt nicht mit dem Upload-Intent ueberein.",
    );
  }
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, user.organizationId),
            sessionMediaAssetManageVisibility(user),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) {
        throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
      }
      if (
        current.storageDriver !== "s3" ||
        current.status !== "pending" ||
        current.uploadExpiresAt.getTime() <= now.getTime()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Der direkte Upload kann nicht abgeschlossen werden.",
        );
      }
      assertUploadedBy(user, current);
      if (completionClaim) {
        const [currentClaim] = await tx
          .select({
            providerUploadId: mediaUploadSessions.providerUploadId,
            state: mediaUploadSessions.state,
            updatedAt: mediaUploadSessions.updatedAt,
          })
          .from(mediaUploadSessions)
          .where(
            and(
              eq(mediaUploadSessions.assetId, current.id),
              eq(mediaUploadSessions.organizationId, user.organizationId),
            ),
          )
          .limit(1)
          .for("update");
        if (
          !currentClaim ||
          currentClaim.state !== "completing" ||
          currentClaim.providerUploadId !== completionClaim.providerUploadId ||
          currentClaim.updatedAt.getTime() !==
            completionClaim.updatedAt.getTime()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der Abschluss-Claim wurde von einem neueren Versuch uebernommen.",
            { reason: "completion_claim_lost", retryAfterSeconds: 2 },
          );
        }
      }
      const [updated] = await tx
        .update(mediaAssets)
        .set({
          status: "uploaded",
          actualSizeBytes: stored.sizeBytes,
          etag: stored.etag,
          stagingStorageVersionId: stored.versionId,
          uploadedAt: now,
          scanNextRetryAt: now,
          updatedAt: now,
        })
        .where(eq(mediaAssets.id, current.id))
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.uploaded",
        entityType: "media_asset",
        entityId: current.id,
        metadata: {
          transport: uploadTransport,
          sizeBytes: stored.sizeBytes,
          source: "browser_session",
        },
      });
      if (multipartSession) {
        await tx
          .delete(mediaUploadSessions)
          .where(
            and(
              eq(mediaUploadSessions.assetId, current.id),
              eq(mediaUploadSessions.organizationId, user.organizationId),
              eq(mediaUploadSessions.state, "completing"),
              eq(
                mediaUploadSessions.providerUploadId,
                completionClaim?.providerUploadId ?? "",
              ),
              eq(
                mediaUploadSessions.updatedAt,
                completionClaim?.updatedAt ?? new Date(0),
              ),
            ),
          );
      }
      return sessionAssetDto(updated);
    });
  } catch (error) {
    await releaseMultipartCompletionClaim?.();
    throw error;
  }
}

export async function deleteSessionMediaAsset(user: User, id: string) {
  const uploadAsset = await getSessionMediaAsset(user, id);
  assertCanManageAsset(user, uploadAsset);
  await assertSessionMutationVisibility(user, uploadAsset);
  const result = await db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, id),
          eq(mediaAssets.organizationId, user.organizationId),
          sessionMediaAssetManageVisibility(user),
        ),
      )
      .limit(1)
      .for("update");
    if (!asset || asset.status === "deleted") {
      throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
    }
    assertCanManageAsset(user, asset);
    if (asset.status === "scanning") {
      throw new ApiError(
        409,
        "conflict",
        "Eine laufende Sicherheitspruefung kann nicht geloescht werden.",
      );
    }
    const [attachment] =
      asset.purpose === "submission"
        ? await tx
            .select({ id: submissionAttachments.id })
            .from(submissionAttachments)
            .where(eq(submissionAttachments.mediaAssetId, asset.id))
            .limit(1)
        : [];
    if (attachment) {
      throw new ApiError(
        409,
        "conflict",
        "Eine bereits eingereichte Datei kann nicht entfernt werden.",
      );
    }
    const [communityBinding] =
      asset.purpose === "community"
        ? await tx
            .select({ id: communityAssetBindings.mediaAssetId })
            .from(communityAssetBindings)
            .where(eq(communityAssetBindings.mediaAssetId, asset.id))
            .limit(1)
        : [];
    if (communityBinding) {
      throw new ApiError(
        409,
        "conflict",
        "Ein gebundener Community-Anhang kann nicht entfernt werden.",
      );
    }
    const [courseBinding] =
      asset.purpose === "course_content"
        ? await tx
            .select({ courseId: courseMediaAssets.courseId })
            .from(courseMediaAssets)
            .where(
              and(
                eq(courseMediaAssets.organizationId, user.organizationId),
                eq(courseMediaAssets.mediaAssetId, asset.id),
              ),
            )
            .limit(1)
        : [];
    if (courseBinding) {
      throw new ApiError(
        409,
        "conflict",
        "Ein mit einem Kurs verknuepftes Medium kann nicht entfernt werden.",
      );
    }
    const avatarPath = `/api/media-assets/${asset.id}/download`;
    const [avatarBinding] =
      asset.purpose === "avatar"
        ? await tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organizationId, user.organizationId),
                eq(users.avatarUrl, avatarPath),
              ),
            )
            .limit(1)
        : [];
    if (avatarBinding) {
      throw new ApiError(
        409,
        "conflict",
        "Ein verwendetes Profilbild kann nicht entfernt werden.",
      );
    }
    const [brandingBinding] =
      asset.purpose === "branding"
        ? await tx
            .select({ id: platformSettings.id })
            .from(platformSettings)
            .where(
              and(
                eq(platformSettings.organizationId, user.organizationId),
                eq(platformSettings.key, "design"),
                sql`(
                  ${platformSettings.value} ->> 'logoAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'logoLightAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'logoDarkAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'faviconAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'socialPreviewImageAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'loginBackgroundAssetId' = ${asset.id}
                  or ${platformSettings.value} ->> 'logoUrl' = ${avatarPath}
                  or ${platformSettings.value} ->> 'logoLightUrl' = ${avatarPath}
                  or ${platformSettings.value} ->> 'logoDarkUrl' = ${avatarPath}
                  or ${platformSettings.value} ->> 'faviconUrl' = ${avatarPath}
                  or ${platformSettings.value} ->> 'socialPreviewImageUrl' = ${avatarPath}
                  or ${platformSettings.value} ->> 'loginBackgroundUrl' = ${avatarPath}
                )`,
              ),
            )
            .limit(1)
        : [];
    if (brandingBinding) {
      throw new ApiError(
        409,
        "conflict",
        "Ein verwendetes Branding-Bild kann nicht entfernt werden.",
      );
    }
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - SESSION_MULTIPART_STALE_CLAIM_MS,
    );
    const [session] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, user.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    let multipartSession: typeof mediaUploadSessions.$inferSelect | null = null;
    if (session) {
      const [claimed] = await tx
        .update(mediaUploadSessions)
        .set({ state: "aborting", updatedAt: now })
        .where(
          and(
            eq(mediaUploadSessions.assetId, asset.id),
            eq(mediaUploadSessions.organizationId, user.organizationId),
            or(
              eq(mediaUploadSessions.state, "initializing"),
              eq(mediaUploadSessions.state, "recovering"),
              eq(mediaUploadSessions.state, "uploading"),
              and(
                or(
                  eq(mediaUploadSessions.state, "completing"),
                  eq(mediaUploadSessions.state, "aborting"),
                ),
                lt(mediaUploadSessions.updatedAt, staleBefore),
              ),
            ),
          ),
        )
        .returning();
      if (!claimed) {
        throw new ApiError(
          409,
          "conflict",
          "Der Multipart-Upload wird gerade verarbeitet.",
        );
      }
      multipartSession = claimed;
    }
    const [deleted] = await tx
      .update(mediaAssets)
      .set({
        status: "deleted",
        deletedAt: now,
        scanClaimToken: null,
        scanClaimedAt: null,
        scanLeaseExpiresAt: null,
        scanNextRetryAt: null,
        updatedAt: now,
      })
      .where(eq(mediaAssets.id, asset.id))
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: "media_asset.deleted",
      entityType: "media_asset",
      entityId: asset.id,
      metadata: { source: "browser_session" },
    });
    return { asset: sessionAssetDto(deleted), multipartSession, source: asset };
  });
  if (result.multipartSession) {
    const configuration = getMediaStorageConfiguration();
    let aborted = false;
    if (
      configuration.driver === "s3" &&
      configuration.compatibilityMode === "versioned"
    ) {
      if (!result.multipartSession.providerUploadId) {
        aborted = true;
      } else
        try {
          await abortS3MultipartUpload(configuration, {
            ...mediaAssetIdentity(result.source, "staging"),
            uploadId: result.multipartSession.providerUploadId,
          });
          aborted = true;
        } catch (error) {
          if (
            error instanceof MediaStorageError &&
            error.code === "object_missing"
          ) {
            aborted = true;
          } else {
            logServerError(error, { action: "media.multipart.delete_cleanup" });
          }
        }
    } else {
      logServerError(
        new Error(
          "A deleted multipart upload has no versioned S3 configuration.",
        ),
        { action: "media.multipart.delete_cleanup" },
      );
    }
    if (aborted) {
      try {
        await deleteStoredMediaObject(
          mediaAssetIdentity(result.source, "staging"),
        );
        const cleanedAt = new Date();
        await db.transaction(async (tx) => {
          await tx
            .delete(mediaUploadSessions)
            .where(
              and(
                eq(mediaUploadSessions.assetId, result.source.id),
                eq(
                  mediaUploadSessions.organizationId,
                  result.source.organizationId,
                ),
                eq(mediaUploadSessions.state, "aborting"),
              ),
            );
          await tx
            .update(mediaAssets)
            .set({
              quotaBytes: 0,
              stagingDeletedAt: cleanedAt,
              storageDeletedAt: cleanedAt,
              multipartAbortVerifiedAt: cleanedAt,
              updatedAt: cleanedAt,
            })
            .where(
              and(
                eq(mediaAssets.id, result.source.id),
                eq(mediaAssets.organizationId, result.source.organizationId),
                eq(mediaAssets.status, "deleted"),
              ),
            );
        });
      } catch (error) {
        logServerError(error, {
          action: "media.multipart.delete_object_cleanup",
        });
      }
    }
  }
  return result.asset;
}

export async function getSessionMediaDownload(
  user: User,
  id: string,
  options: Readonly<{ audit?: boolean }> = {},
) {
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_download_tenant",
        identifier: user.organizationId,
      },
    ],
    primary: { action: "media_download", identifier: `${user.id}:${id}` },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Das Download-Ratenlimit wurde erreicht.",
      { limit: rateLimit.limit, resetAt: rateLimit.resetAt.toISOString() },
    );
  }
  const [profileAsset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "profile"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (profileAsset) {
    const [binding] = await db
      .select({
        userId: customFieldValues.userId,
        visibility: customFieldDefinitions.visibility,
      })
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
          eq(customFieldValues.organizationId, user.organizationId),
          eq(
            customFieldValues.userId,
            profileAsset.ownerUserId ?? "00000000-0000-0000-0000-000000000000",
          ),
          sql`${customFieldValues.value} = to_jsonb(${profileAsset.id}::text)`,
        ),
      )
      .limit(1);
    const [profileBinding] = binding
      ? []
      : await db
          .select({
            userId: dataProfileValues.userId,
            visibility: customFieldDefinitions.visibility,
          })
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
              eq(dataProfileValues.organizationId, user.organizationId),
              eq(
                dataProfileValues.userId,
                profileAsset.ownerUserId ??
                  "00000000-0000-0000-0000-000000000000",
              ),
              sql`${dataProfileValues.value} = to_jsonb(${profileAsset.id}::text)`,
            ),
          )
          .limit(1);
    const visibleBinding = binding ?? profileBinding;
    const authorized =
      profileAsset.ownerUserId === user.id ||
      user.role === "owner" ||
      user.role === "admin" ||
      (user.role === "trainer" &&
        Boolean(visibleBinding) &&
        visibleBinding?.visibility !== "admin");
    if (!authorized) {
      throw new ApiError(404, "not_found", "Profilmedium nicht gefunden.");
    }
    if (options.audit !== false) {
      await db.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.downloaded",
        entityType: "media_asset",
        entityId: profileAsset.id,
        metadata: {
          viewerRole: user.role,
          ownerUserId: profileAsset.ownerUserId,
          result: "authorized",
          purpose: "profile",
          source: "browser_session",
        },
      });
    }
    return profileAsset;
  }
  const [avatarAsset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "avatar"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (avatarAsset) {
    const [binding] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        communityPublicProfileFields,
        and(
          eq(communityPublicProfileFields.organizationId, users.organizationId),
          eq(communityPublicProfileFields.standardField, "avatar"),
        ),
      )
      .where(
        and(
          eq(
            users.id,
            avatarAsset.ownerUserId ?? "00000000-0000-0000-0000-000000000000",
          ),
          eq(users.organizationId, user.organizationId),
          eq(users.status, "active"),
          eq(users.avatarUrl, `/api/media-assets/${avatarAsset.id}/download`),
        ),
      )
      .limit(1);
    if (avatarAsset.ownerUserId !== user.id && !binding) {
      throw new ApiError(404, "not_found", "Profilbild nicht gefunden.");
    }
    if (options.audit !== false) {
      await db.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.downloaded",
        entityType: "media_asset",
        entityId: avatarAsset.id,
        metadata: {
          viewerRole: user.role,
          ownerUserId: avatarAsset.ownerUserId,
          result: "authorized",
          purpose: "avatar",
          source: "browser_session",
        },
      });
    }
    return avatarAsset;
  }
  const [brandingAsset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "branding"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (brandingAsset) {
    if (user.role !== "owner" && user.role !== "admin") {
      throw new ApiError(404, "not_found", "Branding-Bild nicht gefunden.");
    }
    if (options.audit !== false) {
      await db.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.downloaded",
        entityType: "media_asset",
        entityId: brandingAsset.id,
        metadata: {
          viewerRole: user.role,
          result: "authorized",
          purpose: "branding",
          source: "browser_session",
        },
      });
    }
    return brandingAsset;
  }
  const [courseAsset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .limit(1);
  if (courseAsset) {
    let courseId: string | null = null;
    const bindings = await db
      .select({
        courseId: courseMediaAssets.courseId,
        permission: courseCollaborators.permission,
      })
      .from(courseMediaAssets)
      .leftJoin(
        courseCollaborators,
        and(
          eq(
            courseCollaborators.organizationId,
            courseMediaAssets.organizationId,
          ),
          eq(courseCollaborators.courseId, courseMediaAssets.courseId),
          eq(courseCollaborators.userId, user.id),
        ),
      )
      .where(
        and(
          eq(courseMediaAssets.organizationId, user.organizationId),
          eq(courseMediaAssets.mediaAssetId, courseAsset.id),
        ),
      )
      .limit(100);
    let authorized = false;
    if (user.role !== "member") {
      const binding = bindings.find((candidate) => candidate.permission);
      courseId =
        user.role === "owner" || user.role === "admin"
          ? (bindings[0]?.courseId ?? null)
          : (binding?.courseId ?? null);
      authorized = canReadCourseMedia({
        role: user.role,
        uploadedByActor: courseAsset.uploadedById === user.id,
        isBound: bindings.length > 0,
        hasViewGrant: Boolean(binding),
      });
    } else {
      for (const binding of bindings) {
        const access = await getCourseLearningAccess(db, {
          organizationId: user.organizationId,
          userId: user.id,
          courseId: binding.courseId,
        });
        if (
          access &&
          (courseCoverMediaAssetId(
            access.published.snapshot.course.coverImage,
          ) === courseAsset.id ||
            courseSnapshotWidgetsReferenceMediaAsset(
              access.published.snapshot,
              courseAsset.id,
            ) ||
            accessibleLessonsReferenceMediaAsset(
              access.lessons.values(),
              courseAsset.id,
            ))
        ) {
          courseId = binding.courseId;
          authorized = true;
          break;
        }
      }
    }
    if (authorized) {
      if (options.audit !== false) {
        await db.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "media_asset.downloaded",
          entityType: "media_asset",
          entityId: courseAsset.id,
          metadata: {
            courseId,
            viewerRole: user.role,
            result: "authorized",
            source: "browser_session",
          },
        });
      }
      return courseAsset;
    }
    throw new ApiError(404, "not_found", "Kursmedium nicht gefunden.");
  }
  const [communityAsset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "community"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
        sessionMediaAssetReadVisibility(user),
      ),
    )
    .limit(1);
  if (communityAsset) {
    if (options.audit !== false) {
      await db.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "media_asset.downloaded",
        entityType: "media_asset",
        entityId: communityAsset.id,
        metadata: {
          viewerRole: user.role,
          result: "authorized",
          purpose: "community",
          source: "browser_session",
        },
      });
    }
    return communityAsset;
  }
  const conditions = [
    eq(mediaAssets.id, id),
    eq(mediaAssets.organizationId, user.organizationId),
    eq(mediaAssets.purpose, "submission"),
    eq(mediaAssets.status, "ready"),
    sql`${mediaAssets.deletedAt} is null`,
    sessionMediaAssetReadVisibility(user),
  ];
  const [row] = await db
    .select({
      asset: mediaAssets,
      submissionId: submissions.id,
      submissionUserId: submissions.userId,
    })
    .from(submissionAttachments)
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, submissionAttachments.mediaAssetId),
        eq(mediaAssets.organizationId, submissionAttachments.organizationId),
      ),
    )
    .innerJoin(
      submissions,
      and(
        eq(submissions.id, submissionAttachments.submissionId),
        eq(submissions.organizationId, submissionAttachments.organizationId),
      ),
    )
    .where(and(...conditions))
    .limit(1);
  if (!row) {
    throw new ApiError(404, "not_found", "Dateianhang nicht gefunden.");
  }
  if (options.audit !== false) {
    await db.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: "media_asset.downloaded",
      entityType: "media_asset",
      entityId: row.asset.id,
      metadata: {
        submissionId: row.submissionId,
        submissionOwnerId: row.submissionUserId,
        viewerRole: user.role,
        result: "authorized",
        source: "browser_session",
      },
    });
  }
  return row.asset;
}
