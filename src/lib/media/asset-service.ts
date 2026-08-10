import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssetDerivatives, mediaAssets, organizations } from "@/db/schema";
import type { ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import type { MediaActor } from "@/lib/media/api-scopes";
import type { MediaUploadPolicyDecision } from "@/lib/media/mime-policy";
import { mediaTenantQuotaLockQuery } from "@/lib/media/quota-lock";
import {
  createMediaObjectKey,
  createMediaStagingObjectKey,
} from "@/lib/media/storage-key";
import type { MediaStorageConfiguration } from "@/lib/media/storage-configuration";
import { assertOrganizationStorageCapacity } from "@/lib/organization-contracts";

export const publicMediaAssetFields = {
  id: mediaAssets.id,
  uploadedById: mediaAssets.uploadedById,
  ownerUserId: mediaAssets.ownerUserId,
  purpose: mediaAssets.purpose,
  kind: mediaAssets.kind,
  status: mediaAssets.status,
  originalFileName: mediaAssets.originalFileName,
  safeFileName: mediaAssets.safeFileName,
  declaredMimeType: mediaAssets.declaredMimeType,
  detectedMimeType: mediaAssets.detectedMimeType,
  declaredSizeBytes: mediaAssets.declaredSizeBytes,
  actualSizeBytes: mediaAssets.actualSizeBytes,
  uploadExpiresAt: mediaAssets.uploadExpiresAt,
  uploadedAt: mediaAssets.uploadedAt,
  scanAttempt: mediaAssets.scanAttempt,
  scanCompletedAt: mediaAssets.scanCompletedAt,
  scanFailureCode: mediaAssets.scanFailureCode,
  deletedAt: mediaAssets.deletedAt,
  createdAt: mediaAssets.createdAt,
  updatedAt: mediaAssets.updatedAt,
};

export type MediaAsset = typeof mediaAssets.$inferSelect;
const MAX_RESERVED_MEDIA_ASSETS_PER_ACTOR = 25;
const MAX_RESERVED_MEDIA_ASSETS_PER_TENANT = 100;

export async function consumeMediaUploadIntentRateLimit(context: ApiContext) {
  const result = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_upload_intent_tenant",
        identifier: context.organizationId,
      },
    ],
    primary: {
      action: "media_upload_intent",
      identifier: context.apiKeyId,
    },
  });
  if (result.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Das Ratenlimit fuer Media-Upload-Intents wurde erreicht.",
      { limit: result.limit, resetAt: result.resetAt.toISOString() },
    );
  }
}

export function publicMediaAsset(asset: MediaAsset) {
  return {
    id: asset.id,
    uploadedById: asset.uploadedById,
    ownerUserId: asset.ownerUserId,
    purpose: asset.purpose,
    kind: asset.kind,
    status: asset.status,
    originalFileName: asset.originalFileName,
    safeFileName: asset.safeFileName,
    declaredMimeType: asset.declaredMimeType,
    detectedMimeType: asset.detectedMimeType,
    declaredSizeBytes: asset.declaredSizeBytes,
    actualSizeBytes: asset.actualSizeBytes,
    durationMilliseconds: asset.durationMilliseconds,
    uploadExpiresAt: asset.uploadExpiresAt,
    uploadedAt: asset.uploadedAt,
    scanAttempt: asset.scanAttempt,
    scanCompletedAt: asset.scanCompletedAt,
    scanFailureCode: asset.scanFailureCode,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export async function mediaAssetForTenant(
  id: string,
  organizationId: string,
  includeDeleted = false,
) {
  const [asset] = await db
    .select()
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        eq(mediaAssets.organizationId, organizationId),
        ...(includeDeleted ? [] : [sql`${mediaAssets.status} <> 'deleted'`]),
      ),
    )
    .limit(1);
  if (!asset) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
  return asset;
}

function fixedObjectName(stage: "incoming" | "ready", extension: string) {
  return `${stage}.${extension}`;
}

export function mediaAssetIdentity(
  asset: Pick<MediaAsset, "id" | "organizationId" | "storageKey" | "stagingStorageKey">,
  stage: "staging" | "ready",
) {
  return {
    organizationId: asset.organizationId,
    assetId: asset.id,
    key: stage === "staging" ? asset.stagingStorageKey : asset.storageKey,
  };
}

export async function reserveMediaAsset(input: {
  tx: ApiTransaction;
  id?: string;
  organizationId: string;
  actor: MediaActor;
  ownerUserId: string | null;
  policy: MediaUploadPolicyDecision;
  originalFileName: string;
  configuration: MediaStorageConfiguration;
  uploadTtlSeconds?: number;
}) {
  await input.tx.execute(mediaTenantQuotaLockQuery(input.organizationId));
  const [tenant] = await input.tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!tenant) {
    throw new ApiError(404, "not_found", "Organisation nicht gefunden.");
  }

  const [usage] = await input.tx
    .select({
      bytes: sql<number>`(
        coalesce(sum(${mediaAssets.quotaBytes}), 0) +
        coalesce((
          select sum(${mediaAssetDerivatives.sizeBytes})
          from ${mediaAssetDerivatives}
          where ${mediaAssetDerivatives.organizationId} = ${input.organizationId}
        ), 0)
      )::bigint`,
      reservedAssets: sql<number>`count(*) filter (where ${mediaAssets.status} in ('pending', 'uploaded', 'scanning'))::int`,
      actorReservedAssets: sql<number>`count(*) filter (where ${mediaAssets.status} in ('pending', 'uploaded', 'scanning') and ${mediaAssets.uploadedById} = ${input.actor.id})::int`,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.organizationId, input.organizationId));
  const usedBytes = Number(usage?.bytes ?? 0);
  const reservedAssets = Number(usage?.reservedAssets ?? 0);
  const actorReservedAssets = Number(usage?.actorReservedAssets ?? 0);
  const requestedBytes = input.policy.sizeBytes;
  await assertOrganizationStorageCapacity(input.tx, {
    organizationId: input.organizationId,
    requestedBytes,
  });
  if (
    reservedAssets >= MAX_RESERVED_MEDIA_ASSETS_PER_TENANT ||
    actorReservedAssets >= MAX_RESERVED_MEDIA_ASSETS_PER_ACTOR
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die maximale Anzahl aktiver Media-Assets ist erreicht.",
      {
        reservedAssets,
        actorReservedAssets,
        tenantLimit: MAX_RESERVED_MEDIA_ASSETS_PER_TENANT,
        actorLimit: MAX_RESERVED_MEDIA_ASSETS_PER_ACTOR,
      },
    );
  }
  if (
    !Number.isSafeInteger(usedBytes) ||
    usedBytes + requestedBytes > input.configuration.limits.tenantQuotaBytes
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Das Media-Speicherkontingent der Organisation ist ausgeschöpft.",
      {
        usedBytes,
        requestedBytes,
        quotaBytes: input.configuration.limits.tenantQuotaBytes,
      },
    );
  }

  const id = input.id ?? randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Media-Asset-ID ist ungueltig.",
    );
  }
  const storageKey = createMediaObjectKey({
    organizationId: input.organizationId,
    assetId: id,
    safeFileName: fixedObjectName("ready", input.policy.extension),
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId: input.organizationId,
    assetId: id,
    safeFileName: fixedObjectName("incoming", input.policy.extension),
  });
  if (!storageKey || !stagingStorageKey || storageKey === stagingStorageKey) {
    throw new ApiError(
      500,
      "internal_error",
      "Der Media-Speicherschluessel konnte nicht erzeugt werden.",
    );
  }

  const uploadExpiresAt = new Date(
    Date.now() +
      (input.uploadTtlSeconds ??
        input.configuration.limits.signedUploadTtlSeconds) *
        1000,
  );
  const [asset] = await input.tx
    .insert(mediaAssets)
    .values({
      id,
      organizationId: input.organizationId,
      uploadedById: input.actor.id,
      ownerUserId: input.ownerUserId,
      purpose: input.policy.purpose,
      kind: input.policy.kind,
      storageDriver: input.configuration.driver,
      storageKey,
      stagingStorageKey,
      originalFileName: input.originalFileName,
      safeFileName: input.policy.safeFileName,
      declaredMimeType: input.policy.mimeType,
      declaredSizeBytes: input.policy.sizeBytes,
      quotaBytes: input.policy.sizeBytes,
      uploadExpiresAt,
    })
    .returning();
  return asset;
}
