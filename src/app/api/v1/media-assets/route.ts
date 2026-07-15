import { and, desc, eq, inArray, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { mediaAssets } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { mediaAssetCreateSchema } from "@/lib/media/api-schemas";
import {
  assertMediaPurposeAccess,
  apiMediaReadVisibility,
  mediaActorForContext,
  readableMediaPurposes,
  resolveMediaOwner,
} from "@/lib/media/api-scopes";
import {
  mediaAssetIdentity,
  consumeMediaUploadIntentRateLimit,
  publicMediaAsset,
  publicMediaAssetFields,
  reserveMediaAsset,
} from "@/lib/media/asset-service";
import {
  MEDIA_PURPOSES,
  MediaPolicyError,
  validateMediaUploadPolicy,
} from "@/lib/media/mime-policy";
import { createMediaUploadAuthorization } from "@/lib/media/storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const statuses = [
  "pending",
  "uploaded",
  "scanning",
  "ready",
  "quarantined",
  "failed",
] as const;

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: [], action: "media_asset.list", resourceType: "media_asset" },
    async (context) => {
      const readable = readableMediaPurposes(context);
      if (!readable.length) {
        throw new ApiError(
          403,
          "insufficient_scope",
          "Dem API-Schluessel fehlt ein passender Media-Lese-Scope.",
        );
      }
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const conditions: SQL[] = [
        eq(mediaAssets.organizationId, context.organizationId),
        inArray(mediaAssets.purpose, readable),
        inArray(mediaAssets.status, statuses),
      ];
      const purpose = url.searchParams.get("purpose");
      if (purpose) {
        if (!MEDIA_PURPOSES.includes(purpose as (typeof MEDIA_PURPOSES)[number])) {
          throw new ApiError(400, "bad_request", "purpose ist ungueltig.");
        }
        assertMediaPurposeAccess(
          context,
          purpose as (typeof MEDIA_PURPOSES)[number],
          "read",
        );
        conditions.push(
          eq(mediaAssets.purpose, purpose as (typeof MEDIA_PURPOSES)[number]),
        );
      }
      const actor = await mediaActorForContext(context);
      conditions.push(apiMediaReadVisibility(actor));
      const status = url.searchParams.get("status");
      if (status) {
        if (!statuses.includes(status as (typeof statuses)[number])) {
          throw new ApiError(400, "bad_request", "status ist ungueltig.");
        }
        conditions.push(
          eq(mediaAssets.status, status as (typeof statuses)[number]),
        );
      }

      const rows = await db
        .select(publicMediaAssetFields)
        .from(mediaAssets)
        .where(and(...conditions))
        .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;
      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: [],
      action: "media_asset.create",
      resourceType: "media_asset",
      idempotent: true,
    },
    {
      async prepare(context) {
        const input = await parseJson(request, mediaAssetCreateSchema);
        assertMediaPurposeAccess(context, input.purpose, "write");
        const actor = await mediaActorForContext(context);
        await consumeMediaUploadIntentRateLimit(context);
        const ownerUserId = await resolveMediaOwner({
          context,
          actor,
          purpose: input.purpose,
          requestedOwnerUserId: input.ownerUserId,
        });
        const configuration = getMediaStorageConfiguration();
        try {
          const policy = validateMediaUploadPolicy({
            purpose: input.purpose,
            declaredMimeType: input.declaredMimeType,
            originalFileName: input.originalFileName,
            sizeBytes: input.sizeBytes,
            globalMaxUploadBytes: configuration.limits.maxUploadBytes,
          });
          return { input, actor, ownerUserId, configuration, policy };
        } catch (error) {
          if (error instanceof MediaPolicyError) {
            throw new ApiError(422, "validation_error", error.message, {
              code: error.code,
            });
          }
          throw error;
        }
      },
      async execute(tools, prepared) {
        const asset = await reserveMediaAsset({
          tx: tools.tx,
          organizationId: tools.context.organizationId,
          actor: prepared.actor,
          ownerUserId: prepared.ownerUserId,
          policy: prepared.policy,
          originalFileName: prepared.input.originalFileName,
          configuration: prepared.configuration,
        });
        const upload = await createMediaUploadAuthorization({
          ...mediaAssetIdentity(asset, "staging"),
          mimeType: asset.declaredMimeType,
          sizeBytes: asset.declaredSizeBytes,
        });
        await tools.activity({
          type: "media_asset.created",
          entityType: "media_asset",
          entityId: asset.id,
          userId: prepared.actor.id,
          metadata: {
            purpose: asset.purpose,
            kind: asset.kind,
            sizeBytes: asset.declaredSizeBytes,
          },
        });
        return {
          data: { ...publicMediaAsset(asset), upload },
          status: 201,
          resourceId: asset.id,
        };
      },
    },
  );
}
