import "server-only";

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
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
import { MediaStorageError } from "@/lib/media/s3-storage";
import { accessibleLessonsReferenceMediaAsset } from "@/lib/media/course-media-access-policy";
import {
  createMediaUploadAuthorization,
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
import {
  escapeCourseMediaLibrarySearch,
  type SessionCourseMediaListInput,
} from "@/lib/media/course-media-library";

export { sessionCourseMediaListSchema } from "@/lib/media/course-media-library";

const STAFF_ROLES = new Set<User["role"]>(["owner", "admin", "trainer"]);
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
  if (purpose === "branding" && user.role !== "owner" && user.role !== "admin") {
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

function sameSessionUploadIntent(
  user: User,
  asset: MediaAsset,
  input: SessionMediaCreateInput,
  policy: ReturnType<typeof validateMediaUploadPolicy>,
  storageDriver: MediaAsset["storageDriver"],
) {
  return (
    asset.organizationId === user.organizationId &&
    asset.uploadedById === user.id &&
    asset.ownerUserId ===
      (input.purpose === "submission" ||
      input.purpose === "community" ||
      input.purpose === "avatar" ||
      input.purpose === "profile"
        ? (input.ownerUserId ?? user.id)
        : null) &&
    asset.purpose === input.purpose &&
    asset.storageDriver === storageDriver &&
    asset.originalFileName === input.originalFileName &&
    asset.declaredMimeType === policy.mimeType &&
    asset.declaredSizeBytes === policy.sizeBytes &&
    asset.status !== "deleted"
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
  if (
    input.purpose === "profile" &&
    input.ownerUserId &&
    input.ownerUserId !== user.id &&
    user.role !== "owner" &&
    user.role !== "admin"
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Administratoren duerfen Profilmedien fuer andere Mitglieder hochladen.",
    );
  }
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
      });
    }
    throw error;
  }

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

  await consumeSessionUploadIntentRateLimit(user);

  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, user.organizationId))
      .limit(1)
      .for("update");
    if (!tenant) {
      throw new ApiError(404, "not_found", "Organisation nicht gefunden.");
    }
    const profileOwnerId =
      input.purpose === "profile" ? input.ownerUserId ?? user.id : null;
    if (profileOwnerId) {
      const [owner] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, profileOwnerId),
            eq(users.organizationId, user.organizationId),
            eq(users.status, "active"),
          ),
        )
        .limit(1);
      if (!owner) {
        throw new ApiError(404, "not_found", "Profilmitglied nicht gefunden.");
      }
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
        )
      ) {
        throw new ApiError(
          409,
          "conflict",
          "clientUploadId wurde bereits fuer einen anderen Upload verwendet.",
        );
      }
      return sessionUploadIntentResponse(raced);
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
      ownerUserId:
        input.purpose === "submission" ||
        input.purpose === "community" ||
        input.purpose === "avatar" ||
        input.purpose === "profile"
          ? (input.ownerUserId ?? user.id)
          : null,
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
    return sessionUploadIntentResponse(asset);
  });
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
          ? [sql`${mediaAssets.originalFileName} ilike ${`%${search}%`} escape '\\'`]
          : []),
      ),
    )
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(input.limit);
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
        throw new ApiError(409, "conflict", "Der Upload hat zu lange gedauert.");
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
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
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
    (!/^\d+$/.test(contentLength) || Number(contentLength) !== asset.declaredSizeBytes)
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
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "object_exists"
        )
      ) {
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

export async function completeSessionMediaAsset(
  user: User,
  id: string,
) {
  const asset = await getSessionMediaAsset(user, id);
  assertUploadedBy(user, asset);
  await assertSessionMutationVisibility(user, asset);
  if (
    asset.storageDriver === "s3" &&
    ["uploaded", "scanning", "ready", "quarantined", "failed"].includes(
      asset.status,
    )
  ) {
    return sessionAssetDto(asset);
  }
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
      );
    }
    throw error;
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
  return db.transaction(async (tx) => {
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
        transport: "s3",
        sizeBytes: stored.sizeBytes,
        source: "browser_session",
      },
    });
    return sessionAssetDto(updated);
  });
}

export async function deleteSessionMediaAsset(
  user: User,
  id: string,
) {
  return db.transaction(async (tx) => {
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
    return sessionAssetDto(deleted);
  });
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
            profileAsset.ownerUserId ??
              "00000000-0000-0000-0000-000000000000",
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
          eq(
            communityPublicProfileFields.organizationId,
            users.organizationId,
          ),
          eq(communityPublicProfileFields.standardField, "avatar"),
        ),
      )
      .where(
        and(
          eq(users.id, avatarAsset.ownerUserId ?? "00000000-0000-0000-0000-000000000000"),
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
          eq(courseCollaborators.organizationId, courseMediaAssets.organizationId),
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
          ? bindings[0]?.courseId ?? null
          : binding?.courseId ?? null;
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
