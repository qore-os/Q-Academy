import { and, eq } from "drizzle-orm";

import { mediaAssets } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleTransactionalApiCommand,
} from "@/lib/api/handler";
import {
  assertApiMediaManageVisibility,
  assertMediaPurposeAccess,
  apiMediaManageVisibility,
} from "@/lib/media/api-scopes";
import {
  mediaAssetForTenant,
  mediaAssetIdentity,
  publicMediaAsset,
} from "@/lib/media/asset-service";
import { normalizeDeclaredMediaMimeType } from "@/lib/media/mime-policy";
import { MediaStorageError } from "@/lib/media/s3-storage";
import { inspectStoredMediaObject } from "@/lib/media/storage";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

function storageProblem(error: unknown): never {
  if (error instanceof MediaStorageError) {
    if (error.code === "object_missing") {
      throw new ApiError(
        409,
        "conflict",
        "Das hochgeladene Media-Objekt wurde noch nicht gefunden.",
      );
    }
    if (error.code === "object_mismatch") {
      throw new ApiError(422, "validation_error", error.message);
    }
  }
  throw error;
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: [],
      action: "media_asset.complete",
      resourceType: "media_asset",
      idempotent: true,
    },
    {
      async prepare(context) {
        const asset = await mediaAssetForTenant(id, context.organizationId);
        const actor = await assertApiMediaManageVisibility(context, asset);
        assertMediaPurposeAccess(context, asset.purpose, "write");
        if (asset.storageDriver !== "s3") {
          throw new ApiError(
            409,
            "conflict",
            "Complete ist nur fuer direkte S3-Uploads verfuegbar.",
          );
        }
        if (
          asset.status !== "pending" ||
          asset.uploadExpiresAt.getTime() <= Date.now()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der Upload-Intent ist nicht mehr aktiv.",
          );
        }
        try {
          const object = await inspectStoredMediaObject(
            mediaAssetIdentity(asset, "staging"),
          );
          if (!("mimeType" in object)) {
            throw new ApiError(
              409,
              "conflict",
              "Complete ist nur fuer direkte S3-Uploads verfuegbar.",
            );
          }
          const mimeType = normalizeDeclaredMediaMimeType(object.mimeType);
          if (
            object.sizeBytes !== asset.declaredSizeBytes ||
            mimeType !== asset.declaredMimeType ||
            !object.etag ||
            !object.versionId
          ) {
            throw new ApiError(
              422,
              "validation_error",
              "Das Media-Objekt stimmt nicht mit dem Upload-Intent ueberein.",
            );
          }
          return { actor, object, asset };
        } catch (error) {
          storageProblem(error);
        }
      },
      async execute(tools, prepared) {
        const [current] = await tools.tx
          .select()
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, id),
              eq(mediaAssets.organizationId, tools.context.organizationId),
              apiMediaManageVisibility(prepared.actor),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) {
          throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
        }
        if (
          current.status !== "pending" ||
          current.uploadExpiresAt.getTime() <= Date.now()
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der Upload-Intent ist nicht mehr aktiv.",
          );
        }
        const now = new Date();
        const [asset] = await tools.tx
          .update(mediaAssets)
          .set({
            status: "uploaded",
            actualSizeBytes: prepared.object.sizeBytes,
            etag: prepared.object.etag,
            stagingStorageVersionId: prepared.object.versionId,
            uploadedAt: now,
            scanNextRetryAt: now,
            updatedAt: now,
          })
          .where(eq(mediaAssets.id, current.id))
          .returning();
        await tools.activity({
          type: "media_asset.uploaded",
          entityType: "media_asset",
          entityId: asset.id,
          userId: prepared.actor.id,
          metadata: { transport: "s3", sizeBytes: asset.actualSizeBytes },
        });
        return { data: publicMediaAsset(asset), resourceId: asset.id };
      },
    },
  );
}
