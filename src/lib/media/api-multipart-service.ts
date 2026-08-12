import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { activityEvents, mediaAssets, mediaUploadSessions } from "@/db/schema";
import type { ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import {
  apiMediaManageVisibility,
  assertApiMediaManageVisibility,
  assertMediaPurposeAccess,
  type MediaActor,
} from "@/lib/media/api-scopes";
import {
  mediaAssetForTenant,
  mediaAssetIdentity,
  publicMediaAsset,
  reserveMediaAsset,
  type MediaAsset,
} from "@/lib/media/asset-service";
import type { MediaUploadPolicyDecision } from "@/lib/media/mime-policy";
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
  S3_MULTIPART_DEFAULT_PART_BYTES,
} from "@/lib/media/s3-multipart-policy";
import {
  deleteStoredMediaObject,
  inspectStoredMediaObject,
} from "@/lib/media/storage";
import type {
  MediaStorageConfiguration,
  S3MediaStorageConfiguration,
} from "@/lib/media/storage-configuration";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";

export const API_MULTIPART_THRESHOLD_BYTES =
  2 * S3_MULTIPART_DEFAULT_PART_BYTES;

const API_MULTIPART_CONCURRENCY = 3;
const API_MULTIPART_INITIALIZATION_LEASE_MS = 2 * 60_000;
// ListParts, CompleteMultipartUpload, and the final HEAD are bounded below this.
const API_MULTIPART_STALE_CLAIM_MS = 15 * 60_000;
const API_MULTIPART_COMPLETION_GRACE_MS = 30 * 60_000;
const API_MULTIPART_COMPLETION_RESERVE_MS = 12 * 60_000;

const completedAssetStatuses = new Set<MediaAsset["status"]>([
  "uploaded",
  "scanning",
  "ready",
  "quarantined",
  "failed",
]);

type MultipartSession = typeof mediaUploadSessions.$inferSelect;
type VerifiedStoredObject = Readonly<{
  sizeBytes: number;
  mimeType: string;
  etag: string;
  versionId: string;
}>;

type ManagedAsset = Readonly<{
  actor: MediaActor;
  asset: MediaAsset;
}>;

type MultipartContext = ManagedAsset &
  Readonly<{
    configuration: S3MediaStorageConfiguration;
    plan: ReturnType<typeof createS3MultipartUploadPlan>;
    session: MultipartSession;
  }>;

function multipartUrls(assetId: string) {
  const statusUrl = `/api/v1/media-assets/${assetId}/multipart`;
  return {
    statusUrl,
    partsUrl: `${statusUrl}/parts`,
    completeUrl: `/api/v1/media-assets/${assetId}/complete`,
    abortUrl: statusUrl,
  };
}

export function shouldUseApiMultipartUpload(
  configuration: MediaStorageConfiguration,
  sizeBytes: number,
) {
  return (
    configuration.driver === "s3" &&
    configuration.compatibilityMode === "versioned" &&
    sizeBytes >= API_MULTIPART_THRESHOLD_BYTES
  );
}

function requireVersionedS3Configuration() {
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
  return configuration;
}

function multipartApiFailure(error: unknown): never {
  if (error instanceof MediaStorageError) {
    if (error.code === "object_missing") {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung existiert beim Objektspeicher nicht mehr.",
        { reason: "upload_session_missing" },
      );
    }
    if (error.code === "storage_unavailable") {
      throw new ApiError(503, "internal_error", error.message);
    }
    throw new ApiError(422, "validation_error", error.message);
  }
  throw error;
}

async function consumeMultipartRateLimit(
  context: ApiContext,
  assetId: string,
  operation: "part" | "complete",
) {
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action:
          operation === "part"
            ? "media_upload_part_tenant"
            : "media_upload_complete_tenant",
        identifier: context.organizationId,
      },
    ],
    primary: {
      action:
        operation === "part" ? "media_upload_part" : "media_upload_complete",
      identifier: `${context.apiKeyId}:${assetId}`,
    },
  });
  if (result.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      operation === "part"
        ? "Das Ratenlimit fuer Multipart-Upload-Teile wurde erreicht."
        : "Das Ratenlimit fuer Upload-Abschluesse wurde erreicht.",
      { limit: result.limit, resetAt: result.resetAt.toISOString() },
    );
  }
}

async function managedAsset(
  context: ApiContext,
  id: string,
  includeDeleted = false,
): Promise<ManagedAsset> {
  const asset = await mediaAssetForTenant(
    id,
    context.organizationId,
    includeDeleted,
  );
  const actor = await assertApiMediaManageVisibility(context, asset);
  assertMediaPurposeAccess(context, asset.purpose, "write");
  return { actor, asset };
}

function planForSession(asset: MediaAsset, session: MultipartSession) {
  const plan = createS3MultipartUploadPlan(
    asset.declaredSizeBytes,
    session.partSizeBytes,
  );
  if (plan.partCount !== session.expectedPartCount) {
    throw new Error("The persisted multipart upload plan is inconsistent.");
  }
  return plan;
}

function verifiedStoredObject(
  asset: MediaAsset,
  object: Awaited<ReturnType<typeof inspectStoredMediaObject>>,
): VerifiedStoredObject {
  if (
    object.sizeBytes !== asset.declaredSizeBytes ||
    !("mimeType" in object) ||
    object.mimeType !== asset.declaredMimeType ||
    !("etag" in object) ||
    !object.etag ||
    !("versionId" in object) ||
    !object.versionId
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Das gespeicherte Media-Objekt stimmt nicht mit dem Upload-Intent ueberein.",
    );
  }
  return {
    sizeBytes: object.sizeBytes,
    mimeType: object.mimeType,
    etag: object.etag,
    versionId: object.versionId,
  };
}

async function completedStagingObject(asset: MediaAsset) {
  try {
    return verifiedStoredObject(
      asset,
      await inspectStoredMediaObject(mediaAssetIdentity(asset, "staging")),
    );
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "object_missing") {
      return null;
    }
    multipartApiFailure(error);
  }
}

function statusResponse(input: {
  asset: MediaAsset;
  plan: ReturnType<typeof createS3MultipartUploadPlan>;
  state: "uploading" | "completing" | "completion_pending" | "completed";
  uploadedBytes: number;
  uploadedParts?: readonly Readonly<{
    partNumber: number;
    sizeBytes: number;
  }>[];
  expiresAt: Date | null;
}) {
  return {
    state: input.state,
    partSizeBytes: input.plan.partSizeBytes,
    partCount: input.plan.partCount,
    uploadedBytes: input.uploadedBytes,
    uploadedParts: input.uploadedParts ?? [],
    expiresAt: input.expiresAt,
    completeUrl: multipartUrls(input.asset.id).completeUrl,
  };
}

function completedStatus(asset: MediaAsset) {
  const plan = createS3MultipartUploadPlan(asset.declaredSizeBytes);
  return statusResponse({
    asset,
    plan,
    state: "completed",
    uploadedBytes: asset.actualSizeBytes ?? asset.declaredSizeBytes,
    expiresAt: null,
  });
}

function completionPendingStatus(
  asset: MediaAsset,
  plan: ReturnType<typeof createS3MultipartUploadPlan>,
  expiresAt: Date,
) {
  return statusResponse({
    asset,
    plan,
    state: "completion_pending",
    uploadedBytes: asset.declaredSizeBytes,
    expiresAt,
  });
}

async function multipartContext(
  context: ApiContext,
  id: string,
): Promise<MultipartContext | (ManagedAsset & { session: null })> {
  const managed = await managedAsset(context, id);
  if (completedAssetStatuses.has(managed.asset.status)) {
    return { ...managed, session: null };
  }
  if (
    managed.asset.storageDriver !== "s3" ||
    managed.asset.status !== "pending"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
    );
  }
  const configuration = requireVersionedS3Configuration();
  const [session] = await db
    .select()
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.assetId, managed.asset.id),
        eq(mediaUploadSessions.organizationId, context.organizationId),
      ),
    )
    .limit(1);
  if (!session) return { ...managed, session: null };
  return {
    ...managed,
    configuration,
    plan: planForSession(managed.asset, session),
    session,
  };
}

function uuidFromDigest(digest: Buffer) {
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function apiMediaUploadIntentId(
  context: Pick<ApiContext, "organizationId" | "apiKeyId">,
  idempotencyKey: string | null,
) {
  if (!idempotencyKey) return randomUUID();
  const digest = createHash("sha256")
    .update("q-academy:api-media-upload:v1\0")
    .update(context.organizationId)
    .update("\0")
    .update(context.apiKeyId)
    .update("\0")
    .update(idempotencyKey)
    .digest();
  return uuidFromDigest(digest);
}

function sameApiUploadIntent(input: {
  asset: MediaAsset;
  context: ApiContext;
  actor: MediaActor;
  ownerUserId: string | null;
  policy: MediaUploadPolicyDecision;
  originalFileName: string;
  configuration: MediaStorageConfiguration;
}) {
  return (
    input.asset.organizationId === input.context.organizationId &&
    input.asset.uploadedById === input.actor.id &&
    input.asset.ownerUserId === input.ownerUserId &&
    input.asset.purpose === input.policy.purpose &&
    input.asset.storageDriver === input.configuration.driver &&
    input.asset.originalFileName === input.originalFileName &&
    input.asset.declaredMimeType === input.policy.mimeType &&
    input.asset.declaredSizeBytes === input.policy.sizeBytes &&
    input.asset.status !== "deleted"
  );
}

export async function reserveApiMediaUploadIntent(input: {
  context: ApiContext;
  actor: MediaActor;
  ownerUserId: string | null;
  policy: MediaUploadPolicyDecision;
  originalFileName: string;
  configuration: MediaStorageConfiguration;
  idempotencyKey: string | null;
}) {
  const assetId = apiMediaUploadIntentId(input.context, input.idempotencyKey);
  const multipart = shouldUseApiMultipartUpload(
    input.configuration,
    input.policy.sizeBytes,
  );
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.organizationId, input.context.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    if (existing) {
      if (!sameApiUploadIntent({ ...input, asset: existing })) {
        throw new ApiError(
          409,
          "idempotency_conflict",
          "Dieser Idempotency-Key gehoert zu einem anderen Upload-Intent.",
        );
      }
      if (
        existing.status !== "pending" ||
        existing.uploadExpiresAt.getTime() <= Date.now()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Der idempotente Upload-Intent ist nicht mehr aktiv.",
          { reason: "upload_expired" },
        );
      }
      const [session] = await tx
        .select()
        .from(mediaUploadSessions)
        .where(
          and(
            eq(mediaUploadSessions.assetId, existing.id),
            eq(
              mediaUploadSessions.organizationId,
              input.context.organizationId,
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (!multipart) {
        if (session) {
          throw new ApiError(
            409,
            "conflict",
            "Der gespeicherte Upload-Intent verwendet einen anderen Transport.",
          );
        }
        return {
          asset: existing,
          multipart: false as const,
          ownedInitializationToken: null,
        };
      }
      if (session) {
        planForSession(existing, session);
        return {
          asset: existing,
          multipart: true as const,
          ownedInitializationToken: null,
        };
      }
      const plan = createS3MultipartUploadPlan(existing.declaredSizeBytes);
      const initializationToken = randomUUID();
      await tx.insert(mediaUploadSessions).values({
        assetId: existing.id,
        organizationId: existing.organizationId,
        initializationToken,
        providerUploadId: null,
        partSizeBytes: plan.partSizeBytes,
        expectedPartCount: plan.partCount,
        expiresAt: existing.uploadExpiresAt,
        uploadDeadlineAt: existing.uploadExpiresAt,
        state: "initializing",
      });
      return {
        asset: existing,
        multipart: true as const,
        ownedInitializationToken: initializationToken,
      };
    }

    const asset = await reserveMediaAsset({
      tx,
      id: assetId,
      organizationId: input.context.organizationId,
      actor: input.actor,
      ownerUserId: input.ownerUserId,
      policy: input.policy,
      originalFileName: input.originalFileName,
      configuration: input.configuration,
      uploadTtlSeconds: multipart
        ? input.configuration.limits.multipartUploadTtlSeconds
        : undefined,
    });
    const initializationToken = multipart ? randomUUID() : null;
    if (multipart) {
      const plan = createS3MultipartUploadPlan(asset.declaredSizeBytes);
      await tx.insert(mediaUploadSessions).values({
        assetId: asset.id,
        organizationId: asset.organizationId,
        initializationToken: initializationToken!,
        providerUploadId: null,
        partSizeBytes: plan.partSizeBytes,
        expectedPartCount: plan.partCount,
        expiresAt: asset.uploadExpiresAt,
        uploadDeadlineAt: asset.uploadExpiresAt,
        state: "initializing",
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.context.organizationId,
      userId: input.actor.id,
      type: "media_asset.created",
      entityType: "media_asset",
      entityId: asset.id,
      metadata: {
        purpose: asset.purpose,
        kind: asset.kind,
        sizeBytes: asset.declaredSizeBytes,
        transport: multipart
          ? "s3-multipart"
          : input.configuration.driver === "s3"
            ? "s3"
            : "application",
        source: "api",
        apiKeyId: input.context.apiKeyId,
      },
    });
    return { asset, multipart, ownedInitializationToken: initializationToken };
  });
}

function multipartUploadAuthorization(
  asset: MediaAsset,
  session: MultipartSession,
) {
  return {
    transport: "s3-multipart" as const,
    ...multipartUrls(asset.id),
    partSizeBytes: session.partSizeBytes,
    partCount: session.expectedPartCount,
    concurrency: API_MULTIPART_CONCURRENCY,
    expiresAt: session.uploadDeadlineAt,
  };
}

export async function initializeApiMultipartUpload(
  asset: MediaAsset,
  configuration: MediaStorageConfiguration,
  ownedInitializationToken: string | null,
) {
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
  const staleBefore = new Date(
    Date.now() - API_MULTIPART_INITIALIZATION_LEASE_MS,
  );
  const initializationToken = ownedInitializationToken ?? randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [currentAsset] = await tx
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
      !currentAsset ||
      currentAsset.status !== "pending" ||
      currentAsset.uploadExpiresAt.getTime() <= Date.now()
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Der Multipart-Upload ist nicht mehr aktiv.",
      );
    }
    const [current] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, currentAsset.id),
          eq(mediaUploadSessions.organizationId, currentAsset.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (current?.state === "uploading" && current.providerUploadId) {
      return { ownsClaim: false as const, session: current };
    }
    if (current) {
      const initializing =
        (current.state === "initializing" || current.state === "recovering") &&
        !current.providerUploadId;
      if (
        initializing &&
        current.initializationToken === ownedInitializationToken
      ) {
        return { ownsClaim: true as const, session: current };
      }
      if (!initializing || current.updatedAt > staleBefore) {
        return { ownsClaim: false as const, session: current };
      }
      const [takenOver] = await tx
        .update(mediaUploadSessions)
        .set({ initializationToken, updatedAt: new Date() })
        .where(
          and(
            eq(mediaUploadSessions.assetId, current.assetId),
            eq(mediaUploadSessions.organizationId, current.organizationId),
            eq(
              mediaUploadSessions.initializationToken,
              current.initializationToken,
            ),
            eq(mediaUploadSessions.state, current.state),
            eq(mediaUploadSessions.updatedAt, current.updatedAt),
            isNull(mediaUploadSessions.providerUploadId),
          ),
        )
        .returning();
      return takenOver
        ? { ownsClaim: true as const, session: takenOver }
        : { ownsClaim: false as const, session: current };
    }
    const plan = createS3MultipartUploadPlan(currentAsset.declaredSizeBytes);
    const [inserted] = await tx
      .insert(mediaUploadSessions)
      .values({
        assetId: currentAsset.id,
        organizationId: currentAsset.organizationId,
        initializationToken,
        providerUploadId: null,
        partSizeBytes: plan.partSizeBytes,
        expectedPartCount: plan.partCount,
        expiresAt: currentAsset.uploadExpiresAt,
        uploadDeadlineAt: currentAsset.uploadExpiresAt,
        state: "initializing",
      })
      .returning();
    return { ownsClaim: true as const, session: inserted };
  });

  if (!claim.ownsClaim) {
    if (claim.session.state === "uploading") {
      return multipartUploadAuthorization(asset, claim.session);
    }
    if (
      claim.session.state === "initializing" ||
      claim.session.state === "recovering"
    ) {
      throw new ApiError(
        503,
        "internal_error",
        "Die Multipart-Upload-Sitzung wird gerade initialisiert.",
        { reason: "upload_session_initializing", retryAfterSeconds: 2 },
      );
    }
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung wird bereits verarbeitet.",
      { reason: "upload_session_changed", retryAfterSeconds: 2 },
    );
  }
  if (
    claim.session.uploadDeadlineAt.getTime() - Date.now() <
    API_MULTIPART_STALE_CLAIM_MS
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die verbleibende Upload-Zeit reicht nicht fuer eine sichere Initialisierung.",
      { reason: "upload_session_expiring" },
    );
  }
  const plan = planForSession(asset, claim.session);
  let created: Awaited<ReturnType<typeof createS3MultipartUpload>> | undefined;
  try {
    created = await createS3MultipartUpload(configuration, {
      ...mediaAssetIdentity(asset, "staging"),
      mimeType: asset.declaredMimeType,
      sizeBytes: asset.declaredSizeBytes,
    });
    if (
      created.plan.partSizeBytes !== plan.partSizeBytes ||
      created.plan.partCount !== plan.partCount ||
      created.uploadId.length > 1024
    ) {
      throw new ApiError(
        503,
        "internal_error",
        "Der Objektspeicher hat eine ungueltige Upload-Sitzung geliefert.",
      );
    }
  } catch (error) {
    if (created?.uploadId) {
      await abortS3MultipartUpload(configuration, {
        ...mediaAssetIdentity(asset, "staging"),
        uploadId: created.uploadId,
      }).catch((abortError) => {
        logServerError(abortError, {
          action: "api.media.multipart.create_rollback",
        });
      });
    }
    await db
      .update(mediaUploadSessions)
      .set({
        updatedAt: new Date(Date.now() - API_MULTIPART_INITIALIZATION_LEASE_MS),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, asset.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            claim.session.initializationToken,
          ),
          eq(mediaUploadSessions.state, claim.session.state),
          eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
          isNull(mediaUploadSessions.providerUploadId),
        ),
      )
      .catch((claimError) => {
        logServerError(claimError, {
          action: "api.media.multipart.create_claim_release",
        });
      });
    multipartApiFailure(error);
  }

  const createdUpload = created!;
  let activationError: unknown;
  let activated: MultipartSession | undefined;
  try {
    activated = await db.transaction(async (tx) => {
      const [currentAsset] = await tx
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
      if (!currentAsset) return undefined;
      const [session] = await tx
        .update(mediaUploadSessions)
        .set({
          providerUploadId: createdUpload.uploadId,
          state: "uploading",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaUploadSessions.assetId, asset.id),
            eq(mediaUploadSessions.organizationId, asset.organizationId),
            eq(
              mediaUploadSessions.initializationToken,
              claim.session.initializationToken,
            ),
            eq(mediaUploadSessions.state, claim.session.state),
            eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
            isNull(mediaUploadSessions.providerUploadId),
          ),
        )
        .returning();
      if (!session) return undefined;
      await tx
        .update(mediaAssets)
        .set({
          uploadExpiresAt: session.uploadDeadlineAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, asset.organizationId),
            eq(mediaAssets.status, "pending"),
          ),
        );
      return session;
    });
  } catch (error) {
    activationError = error;
  }
  if (activated) return multipartUploadAuthorization(asset, activated);

  let persisted: MultipartSession | undefined;
  let reconciled = false;
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
    reconciled = true;
  } catch (error) {
    logServerError(error, { action: "api.media.multipart.create_reconcile" });
  }
  if (
    persisted?.state === "uploading" &&
    persisted.providerUploadId === createdUpload.uploadId
  ) {
    return multipartUploadAuthorization(asset, persisted);
  }
  if (reconciled) {
    await abortS3MultipartUpload(configuration, {
      ...mediaAssetIdentity(asset, "staging"),
      uploadId: createdUpload.uploadId,
    }).catch((error) => {
      logServerError(error, { action: "api.media.multipart.create_rollback" });
    });
    await db
      .update(mediaUploadSessions)
      .set({
        updatedAt: new Date(Date.now() - API_MULTIPART_INITIALIZATION_LEASE_MS),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, asset.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            claim.session.initializationToken,
          ),
          eq(mediaUploadSessions.state, claim.session.state),
          eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
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

async function listMultipartStatus(context: MultipartContext) {
  if (!context.session.providerUploadId) {
    throw new ApiError(
      503,
      "internal_error",
      "Die Multipart-Upload-Sitzung wird gerade initialisiert.",
      { reason: "upload_session_initializing", retryAfterSeconds: 2 },
    );
  }
  const listed = await listS3MultipartUploadParts(context.configuration, {
    ...mediaAssetIdentity(context.asset, "staging"),
    uploadId: context.session.providerUploadId,
    expectedSizeBytes: context.asset.declaredSizeBytes,
    partSizeBytes: context.session.partSizeBytes,
  });
  return statusResponse({
    asset: context.asset,
    plan: listed.plan,
    state: "uploading",
    uploadedBytes: listed.uploadedBytes,
    uploadedParts: listed.parts.map((part) => ({
      partNumber: part.partNumber,
      sizeBytes: part.sizeBytes,
    })),
    expiresAt: context.session.uploadDeadlineAt,
  });
}

export async function getApiMultipartUploadStatus(
  apiContext: ApiContext,
  id: string,
) {
  const context = await multipartContext(apiContext, id);
  await consumeMultipartRateLimit(apiContext, context.asset.id, "part");
  if (completedAssetStatuses.has(context.asset.status)) {
    return completedStatus(context.asset);
  }
  if (!context.session || !("plan" in context)) {
    throw new ApiError(
      409,
      "conflict",
      "Fuer das Media-Asset existiert keine Multipart-Upload-Sitzung.",
      { reason: "upload_session_missing" },
    );
  }
  if (
    context.session.state === "initializing" ||
    context.session.state === "recovering"
  ) {
    throw new ApiError(
      503,
      "internal_error",
      "Die Multipart-Upload-Sitzung wird gerade initialisiert.",
      { reason: "upload_session_initializing", retryAfterSeconds: 2 },
    );
  }
  if (context.session.state === "completing") {
    const stored = await completedStagingObject(context.asset);
    return stored
      ? completionPendingStatus(
          context.asset,
          context.plan,
          context.session.expiresAt,
        )
      : statusResponse({
          asset: context.asset,
          plan: context.plan,
          state: "completing",
          uploadedBytes: 0,
          expiresAt: context.session.expiresAt,
        });
  }
  if (
    context.session.state !== "uploading" ||
    context.session.uploadDeadlineAt.getTime() <= Date.now()
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
    );
  }
  try {
    return await listMultipartStatus(context);
  } catch (error) {
    multipartApiFailure(error);
  }
}

async function activateRecoveredMultipartUpload(input: {
  context: ApiContext;
  actor: MediaActor;
  asset: MediaAsset;
  configuration: S3MediaStorageConfiguration;
  previousSession: MultipartSession | null;
}) {
  const now = new Date();
  const uploadDeadlineAt =
    input.previousSession?.uploadDeadlineAt ?? input.asset.uploadExpiresAt;
  if (
    uploadDeadlineAt.getTime() - now.getTime() <
    API_MULTIPART_STALE_CLAIM_MS
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die verbleibende Upload-Zeit reicht nicht fuer eine sichere Wiederherstellung.",
      { reason: "upload_session_expiring" },
    );
  }
  const plan = createS3MultipartUploadPlan(
    input.asset.declaredSizeBytes,
    input.previousSession?.partSizeBytes,
  );
  const initializationToken = randomUUID();
  const claim = await db.transaction(async (tx) => {
    const [asset] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, input.asset.id),
          eq(mediaAssets.organizationId, input.context.organizationId),
          apiMediaManageVisibility(input.actor),
        ),
      )
      .limit(1)
      .for("update");
    if (!asset || asset.status !== "pending") {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
      );
    }
    const [current] = await tx
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
    if (input.previousSession) {
      if (
        !current ||
        current.initializationToken !==
          input.previousSession.initializationToken ||
        current.updatedAt.getTime() !==
          input.previousSession.updatedAt.getTime() ||
        current.providerUploadId !== input.previousSession.providerUploadId
      ) {
        return { ownsClaim: false as const, session: current ?? null };
      }
      await tx
        .delete(mediaUploadSessions)
        .where(
          and(
            eq(mediaUploadSessions.assetId, current.assetId),
            eq(mediaUploadSessions.organizationId, current.organizationId),
            eq(
              mediaUploadSessions.initializationToken,
              current.initializationToken,
            ),
            eq(mediaUploadSessions.state, current.state),
            eq(mediaUploadSessions.updatedAt, current.updatedAt),
            current.providerUploadId
              ? eq(
                  mediaUploadSessions.providerUploadId,
                  current.providerUploadId,
                )
              : isNull(mediaUploadSessions.providerUploadId),
          ),
        );
    } else if (current) {
      return { ownsClaim: false as const, session: current };
    }
    const [session] = await tx
      .insert(mediaUploadSessions)
      .values({
        assetId: asset.id,
        organizationId: asset.organizationId,
        initializationToken,
        providerUploadId: null,
        partSizeBytes: plan.partSizeBytes,
        expectedPartCount: plan.partCount,
        expiresAt: uploadDeadlineAt,
        uploadDeadlineAt,
        state: "recovering",
      })
      .returning();
    return { ownsClaim: true as const, session };
  });
  if (!claim.ownsClaim) {
    throw new ApiError(
      claim.session?.state === "initializing" ||
        claim.session?.state === "recovering"
        ? 503
        : 409,
      claim.session?.state === "initializing" ||
        claim.session?.state === "recovering"
        ? "internal_error"
        : "conflict",
      "Die Multipart-Upload-Sitzung wurde bereits von einem anderen Versuch uebernommen.",
      { reason: "upload_session_changed", retryAfterSeconds: 2 },
    );
  }

  let created: Awaited<ReturnType<typeof createS3MultipartUpload>> | undefined;
  try {
    created = await createS3MultipartUpload(input.configuration, {
      ...mediaAssetIdentity(input.asset, "staging"),
      mimeType: input.asset.declaredMimeType,
      sizeBytes: input.asset.declaredSizeBytes,
    });
    if (
      created.plan.partSizeBytes !== plan.partSizeBytes ||
      created.plan.partCount !== plan.partCount ||
      created.uploadId.length > 1024
    ) {
      throw new ApiError(
        503,
        "internal_error",
        "Der Objektspeicher hat eine ungueltige Upload-Sitzung geliefert.",
      );
    }
  } catch (error) {
    if (created?.uploadId) {
      await abortS3MultipartUpload(input.configuration, {
        ...mediaAssetIdentity(input.asset, "staging"),
        uploadId: created.uploadId,
      }).catch((abortError) => {
        logServerError(abortError, {
          action: "api.media.multipart.recover_create_rollback",
        });
      });
    }
    await db
      .update(mediaUploadSessions)
      .set({
        updatedAt: new Date(Date.now() - API_MULTIPART_INITIALIZATION_LEASE_MS),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, input.asset.id),
          eq(mediaUploadSessions.organizationId, input.context.organizationId),
          eq(mediaUploadSessions.initializationToken, initializationToken),
          eq(mediaUploadSessions.state, "recovering"),
          eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
          isNull(mediaUploadSessions.providerUploadId),
        ),
      );
    multipartApiFailure(error);
  }

  const createdUpload = created!;
  let activationError: unknown;
  let activated: MultipartSession | undefined;
  try {
    activated = await db.transaction(async (tx) => {
      const [session] = await tx
        .update(mediaUploadSessions)
        .set({
          providerUploadId: createdUpload.uploadId,
          state: "uploading",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaUploadSessions.assetId, input.asset.id),
            eq(
              mediaUploadSessions.organizationId,
              input.context.organizationId,
            ),
            eq(mediaUploadSessions.initializationToken, initializationToken),
            eq(mediaUploadSessions.state, "recovering"),
            eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
            isNull(mediaUploadSessions.providerUploadId),
          ),
        )
        .returning();
      if (!session) return undefined;
      const [activeAsset] = await tx
        .update(mediaAssets)
        .set({ uploadExpiresAt: uploadDeadlineAt, updatedAt: new Date() })
        .where(
          and(
            eq(mediaAssets.id, input.asset.id),
            eq(mediaAssets.organizationId, input.context.organizationId),
            eq(mediaAssets.status, "pending"),
          ),
        )
        .returning({ id: mediaAssets.id });
      if (!activeAsset) {
        throw new ApiError(
          409,
          "conflict",
          "Die Multipart-Upload-Sitzung wurde waehrend der Wiederherstellung beendet.",
        );
      }
      return session;
    });
  } catch (error) {
    activationError = error;
  }
  if (activated) {
    return statusResponse({
      asset: input.asset,
      plan,
      state: "uploading",
      uploadedBytes: 0,
      expiresAt: activated.uploadDeadlineAt,
    });
  }

  let persisted: MultipartSession | undefined;
  let reconciled = false;
  try {
    [persisted] = await db
      .select()
      .from(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, input.asset.id),
          eq(mediaUploadSessions.organizationId, input.context.organizationId),
        ),
      )
      .limit(1);
    reconciled = true;
  } catch (error) {
    logServerError(error, { action: "api.media.multipart.recover_reconcile" });
  }
  if (
    persisted?.state === "uploading" &&
    persisted.providerUploadId === createdUpload.uploadId
  ) {
    return statusResponse({
      asset: input.asset,
      plan,
      state: "uploading",
      uploadedBytes: 0,
      expiresAt: persisted.uploadDeadlineAt,
    });
  }
  if (reconciled) {
    await abortS3MultipartUpload(input.configuration, {
      ...mediaAssetIdentity(input.asset, "staging"),
      uploadId: createdUpload.uploadId,
    }).catch((error) => {
      logServerError(error, {
        action: "api.media.multipart.recover_rollback",
      });
    });
    await db
      .update(mediaUploadSessions)
      .set({
        updatedAt: new Date(Date.now() - API_MULTIPART_INITIALIZATION_LEASE_MS),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, input.asset.id),
          eq(mediaUploadSessions.organizationId, input.context.organizationId),
          eq(mediaUploadSessions.initializationToken, initializationToken),
          eq(mediaUploadSessions.state, "recovering"),
          eq(mediaUploadSessions.updatedAt, claim.session.updatedAt),
          isNull(mediaUploadSessions.providerUploadId),
        ),
      );
  }
  if (activationError) throw activationError;
  throw new ApiError(
    409,
    "conflict",
    "Die Multipart-Upload-Sitzung wurde waehrend der Wiederherstellung beendet.",
  );
}

export async function recoverApiMultipartUploadStatus(
  apiContext: ApiContext,
  id: string,
) {
  const context = await multipartContext(apiContext, id);
  await consumeMultipartRateLimit(apiContext, context.asset.id, "part");
  if (completedAssetStatuses.has(context.asset.status)) {
    return completedStatus(context.asset);
  }
  const configuration = requireVersionedS3Configuration();
  const now = Date.now();
  const session = context.session;
  if (session?.state === "aborting") {
    throw new ApiError(
      409,
      "conflict",
      "Der Multipart-Upload wird abgebrochen.",
    );
  }
  if (
    (session?.state === "initializing" || session?.state === "recovering") &&
    session.updatedAt.getTime() > now - API_MULTIPART_INITIALIZATION_LEASE_MS
  ) {
    throw new ApiError(
      503,
      "internal_error",
      "Die Multipart-Upload-Sitzung wird gerade initialisiert.",
      { reason: "upload_session_initializing", retryAfterSeconds: 2 },
    );
  }

  const stored = await completedStagingObject(context.asset);
  const plan = session
    ? planForSession(context.asset, session)
    : createS3MultipartUploadPlan(context.asset.declaredSizeBytes);
  if (stored) {
    return completionPendingStatus(
      context.asset,
      plan,
      session?.expiresAt ?? context.asset.uploadExpiresAt,
    );
  }

  if (session?.state === "completing") {
    if (session.updatedAt.getTime() > now - API_MULTIPART_STALE_CLAIM_MS) {
      throw new ApiError(
        409,
        "conflict",
        "Der Multipart-Upload wird bereits abgeschlossen.",
        { reason: "completion_in_progress", retryAfterSeconds: 5 },
      );
    }
    if (session.providerUploadId) {
      const providerUploadId = session.providerUploadId;
      try {
        const listed = await listS3MultipartUploadParts(configuration, {
          ...mediaAssetIdentity(context.asset, "staging"),
          uploadId: providerUploadId,
          expectedSizeBytes: context.asset.declaredSizeBytes,
          partSizeBytes: session.partSizeBytes,
        });
        if (session.uploadDeadlineAt.getTime() <= now) {
          return statusResponse({
            asset: context.asset,
            plan: listed.plan,
            state: "completing",
            uploadedBytes: listed.uploadedBytes,
            uploadedParts: listed.parts.map((part) => ({
              partNumber: part.partNumber,
              sizeBytes: part.sizeBytes,
            })),
            expiresAt: session.expiresAt,
          });
        }
        const released = await db.transaction(async (tx) => {
          const [current] = await tx
            .update(mediaUploadSessions)
            .set({
              state: "uploading",
              expiresAt: session.uploadDeadlineAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(mediaUploadSessions.assetId, context.asset.id),
                eq(
                  mediaUploadSessions.organizationId,
                  apiContext.organizationId,
                ),
                eq(
                  mediaUploadSessions.initializationToken,
                  session.initializationToken,
                ),
                eq(mediaUploadSessions.providerUploadId, providerUploadId),
                eq(mediaUploadSessions.state, "completing"),
                eq(mediaUploadSessions.updatedAt, session.updatedAt),
              ),
            )
            .returning();
          if (!current) return undefined;
          await tx
            .update(mediaAssets)
            .set({
              uploadExpiresAt: session.uploadDeadlineAt,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(mediaAssets.id, context.asset.id),
                eq(mediaAssets.organizationId, apiContext.organizationId),
                eq(mediaAssets.status, "pending"),
              ),
            );
          return current;
        });
        if (!released) {
          throw new ApiError(
            409,
            "conflict",
            "Der Completion-Claim wurde bereits uebernommen.",
            { reason: "completion_claim_lost", retryAfterSeconds: 2 },
          );
        }
        return statusResponse({
          asset: context.asset,
          plan: listed.plan,
          state: "uploading",
          uploadedBytes: listed.uploadedBytes,
          uploadedParts: listed.parts.map((part) => ({
            partNumber: part.partNumber,
            sizeBytes: part.sizeBytes,
          })),
          expiresAt: released.uploadDeadlineAt,
        });
      } catch (error) {
        if (
          !(error instanceof MediaStorageError) ||
          error.code !== "object_missing"
        ) {
          multipartApiFailure(error);
        }
      }
    }
  } else if (session?.state === "uploading" && session.providerUploadId) {
    if (session.uploadDeadlineAt.getTime() <= now) {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung ist abgelaufen.",
        { reason: "upload_expired" },
      );
    }
    try {
      return await listMultipartStatus({
        ...context,
        configuration,
        plan,
        session,
      });
    } catch (error) {
      if (
        !(error instanceof MediaStorageError) ||
        error.code !== "object_missing"
      ) {
        multipartApiFailure(error);
      }
    }
  }

  return activateRecoveredMultipartUpload({
    context: apiContext,
    actor: context.actor,
    asset: context.asset,
    configuration,
    previousSession: session,
  });
}

export async function authorizeApiMultipartUploadPart(
  apiContext: ApiContext,
  id: string,
  input: Readonly<{ partNumber: number; checksumSha256: string }>,
) {
  const context = await multipartContext(apiContext, id);
  await consumeMultipartRateLimit(apiContext, context.asset.id, "part");
  if (
    !context.session ||
    !("plan" in context) ||
    context.session.state !== "uploading" ||
    !context.session.providerUploadId ||
    context.session.uploadDeadlineAt.getTime() <= Date.now()
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
    );
  }
  if (input.partNumber < 1 || input.partNumber > context.plan.partCount) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Multipart-Teilnummer ist ungueltig.",
    );
  }
  try {
    return await createS3MultipartPartUploadAuthorization(
      context.configuration,
      {
        ...mediaAssetIdentity(context.asset, "staging"),
        uploadId: context.session.providerUploadId,
        expectedSizeBytes: context.asset.declaredSizeBytes,
        partSizeBytes: context.session.partSizeBytes,
        partNumber: input.partNumber,
        sizeBytes: expectedS3MultipartPartSize(context.plan, input.partNumber),
        checksumSha256: input.checksumSha256,
      },
    );
  } catch (error) {
    multipartApiFailure(error);
  }
}

async function resetCompletionClaim(
  asset: MediaAsset,
  claim: MultipartSession,
) {
  const beforeDeadline = Date.now() < claim.uploadDeadlineAt.getTime();
  await db.transaction(async (tx) => {
    const [released] = await tx
      .update(mediaUploadSessions)
      .set({
        state: beforeDeadline ? "uploading" : "completing",
        expiresAt: beforeDeadline ? claim.uploadDeadlineAt : claim.expiresAt,
        updatedAt: beforeDeadline
          ? new Date()
          : new Date(Date.now() - API_MULTIPART_STALE_CLAIM_MS - 1_000),
      })
      .where(
        and(
          eq(mediaUploadSessions.assetId, asset.id),
          eq(mediaUploadSessions.organizationId, asset.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            claim.initializationToken,
          ),
          eq(mediaUploadSessions.providerUploadId, claim.providerUploadId!),
          eq(mediaUploadSessions.state, "completing"),
          eq(mediaUploadSessions.updatedAt, claim.updatedAt),
        ),
      )
      .returning({ assetId: mediaUploadSessions.assetId });
    if (released && beforeDeadline) {
      await tx
        .update(mediaAssets)
        .set({ uploadExpiresAt: claim.uploadDeadlineAt, updatedAt: new Date() })
        .where(
          and(
            eq(mediaAssets.id, asset.id),
            eq(mediaAssets.organizationId, asset.organizationId),
            eq(mediaAssets.status, "pending"),
          ),
        );
    }
  });
}

async function claimMultipartCompletion(
  apiContext: ApiContext,
  actor: MediaActor,
  asset: MediaAsset,
) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - API_MULTIPART_STALE_CLAIM_MS);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, apiContext.organizationId),
          apiMediaManageVisibility(actor),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
    }
    if (completedAssetStatuses.has(current.status)) {
      return { completed: current, claim: null };
    }
    if (current.storageDriver !== "s3" || current.status !== "pending") {
      throw new ApiError(
        409,
        "conflict",
        "Der direkte Upload kann nicht abgeschlossen werden.",
      );
    }
    const [session] = await tx
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
    if (!session) return { completed: null, claim: null };
    const providerUploadId = session.providerUploadId;
    if (!providerUploadId) {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung ist noch nicht initialisiert.",
        { reason: "upload_session_initializing", retryAfterSeconds: 2 },
      );
    }
    const staleCompletion =
      session.state === "completing" && session.updatedAt <= staleBefore;
    if (session.state !== "uploading" && !staleCompletion) {
      throw new ApiError(
        409,
        "conflict",
        session.state === "completing"
          ? "Der Multipart-Upload wird bereits abgeschlossen."
          : "Die Multipart-Upload-Sitzung ist nicht mehr aktiv.",
        session.state === "completing"
          ? { reason: "completion_in_progress", retryAfterSeconds: 5 }
          : undefined,
      );
    }
    if (
      session.state === "uploading" &&
      session.uploadDeadlineAt.getTime() <= now.getTime()
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung ist abgelaufen.",
        { reason: "upload_expired" },
      );
    }
    const completionLeaseExpiresAt = new Date(
      session.uploadDeadlineAt.getTime() + API_MULTIPART_COMPLETION_GRACE_MS,
    );
    const requiredCompletionReserve = staleCompletion
      ? API_MULTIPART_COMPLETION_RESERVE_MS
      : API_MULTIPART_STALE_CLAIM_MS + API_MULTIPART_COMPLETION_RESERVE_MS;
    if (
      completionLeaseExpiresAt.getTime() - now.getTime() <
      requiredCompletionReserve
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die sichere Wiederherstellungsfrist fuer den Upload ist abgelaufen.",
        { reason: "completion_expired" },
      );
    }
    const [claim] = await tx
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
          eq(
            mediaUploadSessions.initializationToken,
            session.initializationToken,
          ),
          eq(mediaUploadSessions.providerUploadId, providerUploadId),
          eq(mediaUploadSessions.state, session.state),
          eq(mediaUploadSessions.updatedAt, session.updatedAt),
        ),
      )
      .returning();
    if (!claim) {
      throw new ApiError(
        409,
        "conflict",
        "Der Completion-Claim wurde bereits uebernommen.",
        { reason: "completion_claim_lost", retryAfterSeconds: 2 },
      );
    }
    await tx
      .update(mediaAssets)
      .set({ uploadExpiresAt: completionLeaseExpiresAt, updatedAt: now })
      .where(
        and(
          eq(mediaAssets.id, current.id),
          eq(mediaAssets.organizationId, current.organizationId),
        ),
      );
    return {
      completed: null,
      claim,
      asset: current,
      recoveredCompletion: staleCompletion,
    };
  });
}

async function finalizeMultipartUpload(input: {
  apiContext: ApiContext;
  actor: MediaActor;
  asset: MediaAsset;
  claim: MultipartSession;
  stored: VerifiedStoredObject;
}) {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, input.asset.id),
          eq(mediaAssets.organizationId, input.apiContext.organizationId),
          apiMediaManageVisibility(input.actor),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
    }
    if (completedAssetStatuses.has(current.status)) {
      return current;
    }
    if (current.storageDriver !== "s3" || current.status !== "pending") {
      throw new ApiError(
        409,
        "conflict",
        "Der direkte Upload kann nicht abgeschlossen werden.",
      );
    }
    const [currentClaim] = await tx
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
    if (
      !currentClaim ||
      currentClaim.state !== "completing" ||
      currentClaim.initializationToken !== input.claim.initializationToken ||
      currentClaim.providerUploadId !== input.claim.providerUploadId ||
      currentClaim.updatedAt.getTime() !== input.claim.updatedAt.getTime()
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Der Completion-Claim wurde von einem neueren Versuch uebernommen.",
        { reason: "completion_claim_lost", retryAfterSeconds: 2 },
      );
    }
    const [updated] = await tx
      .update(mediaAssets)
      .set({
        status: "uploaded",
        actualSizeBytes: input.stored.sizeBytes,
        etag: input.stored.etag,
        stagingStorageVersionId: input.stored.versionId,
        uploadedAt: now,
        scanNextRetryAt: now,
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAssets.id, current.id),
          eq(mediaAssets.organizationId, current.organizationId),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.apiContext.organizationId,
      userId: input.actor.id,
      type: "media_asset.uploaded",
      entityType: "media_asset",
      entityId: current.id,
      metadata: {
        transport: "s3_multipart",
        sizeBytes: input.stored.sizeBytes,
        source: "api",
        apiKeyId: input.apiContext.apiKeyId,
      },
    });
    await tx
      .delete(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, current.id),
          eq(mediaUploadSessions.organizationId, current.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            input.claim.initializationToken,
          ),
          eq(
            mediaUploadSessions.providerUploadId,
            input.claim.providerUploadId!,
          ),
          eq(mediaUploadSessions.state, "completing"),
          eq(mediaUploadSessions.updatedAt, input.claim.updatedAt),
        ),
      );
    return updated;
  });
}

async function completeMultipartAsset(
  apiContext: ApiContext,
  actor: MediaActor,
  asset: MediaAsset,
) {
  const claimed = await claimMultipartCompletion(apiContext, actor, asset);
  if (claimed.completed) return publicMediaAsset(claimed.completed);
  if (!claimed.claim || !claimed.asset) {
    throw new ApiError(
      409,
      "conflict",
      "Fuer das Media-Asset existiert keine Multipart-Upload-Sitzung.",
    );
  }
  const configuration = requireVersionedS3Configuration();
  const claim = claimed.claim;
  let stored: VerifiedStoredObject | null = null;
  try {
    if (claimed.recoveredCompletion) {
      stored = await completedStagingObject(claimed.asset);
    }
    if (!stored) {
      stored = verifiedStoredObject(
        claimed.asset,
        await completeS3MultipartUpload(configuration, {
          ...mediaAssetIdentity(claimed.asset, "staging"),
          uploadId: claim.providerUploadId!,
          expectedSizeBytes: claimed.asset.declaredSizeBytes,
          partSizeBytes: claim.partSizeBytes,
          mimeType: claimed.asset.declaredMimeType,
        }),
      );
    }
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "object_missing") {
      try {
        stored = await completedStagingObject(claimed.asset);
      } catch (recoveryError) {
        await resetCompletionClaim(claimed.asset, claim);
        throw recoveryError;
      }
      if (!stored) {
        await resetCompletionClaim(claimed.asset, claim);
        throw new ApiError(
          409,
          "conflict",
          "Weder die Multipart-Sitzung noch ein fertiggestelltes Staging-Objekt wurde gefunden.",
          { reason: "upload_session_missing" },
        );
      }
    } else {
      await resetCompletionClaim(claimed.asset, claim);
      multipartApiFailure(error);
    }
  }

  try {
    return publicMediaAsset(
      await finalizeMultipartUpload({
        apiContext,
        actor,
        asset: claimed.asset,
        claim,
        stored,
      }),
    );
  } catch (error) {
    await resetCompletionClaim(claimed.asset, claim).catch((resetError) => {
      logServerError(resetError, {
        action: "api.media.multipart.complete_recover",
      });
    });
    throw error;
  }
}

async function completeLegacyS3Asset(
  apiContext: ApiContext,
  actor: MediaActor,
  asset: MediaAsset,
) {
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
  let stored: VerifiedStoredObject;
  try {
    stored = verifiedStoredObject(
      asset,
      await inspectStoredMediaObject(mediaAssetIdentity(asset, "staging")),
    );
  } catch (error) {
    multipartApiFailure(error);
  }
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, apiContext.organizationId),
          apiMediaManageVisibility(actor),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
    }
    if (completedAssetStatuses.has(current.status)) return current;
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
    const [result] = await tx
      .update(mediaAssets)
      .set({
        status: "uploaded",
        actualSizeBytes: stored.sizeBytes,
        etag: stored.etag,
        stagingStorageVersionId: stored.versionId,
        uploadedAt: now,
        scanNextRetryAt: now,
        directUploadClaimToken: null,
        directUploadClaimedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(mediaAssets.id, current.id),
          eq(mediaAssets.organizationId, current.organizationId),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: apiContext.organizationId,
      userId: actor.id,
      type: "media_asset.uploaded",
      entityType: "media_asset",
      entityId: current.id,
      metadata: {
        transport: "s3",
        sizeBytes: stored.sizeBytes,
        source: "api",
        apiKeyId: apiContext.apiKeyId,
      },
    });
    return result;
  });
  return publicMediaAsset(updated);
}

export async function completeApiMediaAsset(
  apiContext: ApiContext,
  id: string,
) {
  const { actor, asset } = await managedAsset(apiContext, id);
  await consumeMultipartRateLimit(apiContext, asset.id, "complete");
  if (completedAssetStatuses.has(asset.status)) {
    return publicMediaAsset(asset);
  }
  const [session] = await db
    .select({ assetId: mediaUploadSessions.assetId })
    .from(mediaUploadSessions)
    .where(
      and(
        eq(mediaUploadSessions.assetId, asset.id),
        eq(mediaUploadSessions.organizationId, apiContext.organizationId),
      ),
    )
    .limit(1);
  return session
    ? completeMultipartAsset(apiContext, actor, asset)
    : completeLegacyS3Asset(apiContext, actor, asset);
}

export async function abortApiMultipartUpload(
  apiContext: ApiContext,
  id: string,
) {
  const { actor, asset } = await managedAsset(apiContext, id, true);
  await consumeMultipartRateLimit(apiContext, asset.id, "complete");
  const configuration = requireVersionedS3Configuration();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - API_MULTIPART_STALE_CLAIM_MS);
  const claimed = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, asset.id),
          eq(mediaAssets.organizationId, apiContext.organizationId),
          apiMediaManageVisibility(actor),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) {
      throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
    }
    const [session] = await tx
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
    if (!session) {
      if (current.status === "deleted") return null;
      throw new ApiError(
        409,
        "conflict",
        "Fuer das Media-Asset existiert keine Multipart-Upload-Sitzung.",
      );
    }
    const providerUploadId = session.providerUploadId;
    if (
      !providerUploadId &&
      session.state !== "initializing" &&
      session.state !== "recovering" &&
      session.state !== "aborting"
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die Multipart-Upload-Sitzung hat keine gueltige Provider-Identitaet.",
      );
    }
    if (session.state === "completing" && session.updatedAt > staleBefore) {
      throw new ApiError(
        409,
        "conflict",
        "Der Multipart-Upload wird gerade abgeschlossen.",
        { reason: "completion_in_progress", retryAfterSeconds: 5 },
      );
    }
    if (session.state === "aborting" && session.updatedAt > staleBefore) {
      throw new ApiError(
        409,
        "conflict",
        "Der Multipart-Upload wird bereits abgebrochen.",
        { reason: "abort_in_progress", retryAfterSeconds: 5 },
      );
    }
    const [claim] = await tx
      .update(mediaUploadSessions)
      .set({ state: "aborting", updatedAt: now })
      .where(
        and(
          eq(mediaUploadSessions.assetId, current.id),
          eq(mediaUploadSessions.organizationId, current.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            session.initializationToken,
          ),
          providerUploadId
            ? eq(mediaUploadSessions.providerUploadId, providerUploadId)
            : isNull(mediaUploadSessions.providerUploadId),
          eq(mediaUploadSessions.state, session.state),
          eq(mediaUploadSessions.updatedAt, session.updatedAt),
        ),
      )
      .returning();
    if (!claim) {
      throw new ApiError(
        409,
        "conflict",
        "Der Abort-Claim wurde bereits uebernommen.",
        { reason: "abort_claim_lost", retryAfterSeconds: 2 },
      );
    }
    if (current.status !== "deleted") {
      await tx
        .update(mediaAssets)
        .set({
          status: "deleted",
          deletedAt: now,
          scanClaimToken: null,
          scanClaimedAt: null,
          scanLeaseExpiresAt: null,
          scanNextRetryAt: null,
          directUploadClaimToken: null,
          directUploadClaimedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaAssets.id, current.id),
            eq(mediaAssets.organizationId, current.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: apiContext.organizationId,
        userId: actor.id,
        type: "media_asset.deleted",
        entityType: "media_asset",
        entityId: current.id,
        metadata: {
          previousStatus: current.status,
          transport: "s3_multipart",
          source: "api",
          apiKeyId: apiContext.apiKeyId,
        },
      });
    }
    return { asset: current, session: claim };
  });

  if (!claimed) return { id: asset.id, aborted: true, deleted: true };
  if (claimed.session.providerUploadId) {
    try {
      await abortS3MultipartUpload(configuration, {
        ...mediaAssetIdentity(claimed.asset, "staging"),
        uploadId: claimed.session.providerUploadId,
      });
      await deleteStoredMediaObject(
        mediaAssetIdentity(claimed.asset, "staging"),
      );
    } catch (error) {
      multipartApiFailure(error);
    }
  }

  const cleanedAt = new Date();
  await db.transaction(async (tx) => {
    const [removedClaim] = await tx
      .delete(mediaUploadSessions)
      .where(
        and(
          eq(mediaUploadSessions.assetId, claimed.asset.id),
          eq(mediaUploadSessions.organizationId, claimed.asset.organizationId),
          eq(
            mediaUploadSessions.initializationToken,
            claimed.session.initializationToken,
          ),
          claimed.session.providerUploadId
            ? eq(
                mediaUploadSessions.providerUploadId,
                claimed.session.providerUploadId,
              )
            : isNull(mediaUploadSessions.providerUploadId),
          eq(mediaUploadSessions.state, "aborting"),
          eq(mediaUploadSessions.updatedAt, claimed.session.updatedAt),
        ),
      )
      .returning({ assetId: mediaUploadSessions.assetId });
    if (!removedClaim) {
      throw new ApiError(
        409,
        "conflict",
        "Der Abort-Claim wurde von einem neueren Versuch uebernommen.",
        { reason: "abort_claim_lost", retryAfterSeconds: 2 },
      );
    }
    const [cleaned] = await tx
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
          eq(mediaAssets.id, claimed.asset.id),
          eq(mediaAssets.organizationId, claimed.asset.organizationId),
          eq(mediaAssets.status, "deleted"),
        ),
      )
      .returning({ id: mediaAssets.id });
    if (!cleaned) {
      throw new ApiError(
        409,
        "conflict",
        "Das abgebrochene Media-Asset konnte nicht bereinigt werden.",
      );
    }
  });
  return { id: asset.id, aborted: true, deleted: true };
}
