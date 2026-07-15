import { and, eq, gt } from "drizzle-orm";

import { db } from "@/db";
import { activityEvents, mediaAssets } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions } from "@/lib/api/handler";
import {
  assertApiMediaReadVisibility,
  assertApiMediaManageVisibility,
  assertMediaPurposeAccess,
  apiMediaManageVisibility,
} from "@/lib/media/api-scopes";
import {
  mediaAssetForTenant,
  mediaAssetIdentity,
} from "@/lib/media/asset-service";
import { FilesystemMediaStorageError } from "@/lib/media/filesystem-storage";
import { normalizeDeclaredMediaMimeType } from "@/lib/media/mime-policy";
import {
  InvalidHttpByteRangeError,
  parseHttpByteRange,
} from "@/lib/media/http-byte-range";
import { handleMediaRawResponse } from "@/lib/media/raw-api";
import {
  deleteStoredMediaObject,
  getFilesystemMediaObjectForDownload,
  writeDevelopmentMediaObject,
} from "@/lib/media/storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

async function* requestBody(request: Request) {
  if (!request.body) {
    throw new ApiError(400, "bad_request", "Der Upload-Body fehlt.");
  }
  const reader = request.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (result.value.byteLength) yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function streamBody(body: AsyncIterable<Uint8Array>) {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  return handleMediaRawResponse(
    request,
    "media_asset.content.upload",
    id,
    async (context) => {
      const configuration = getMediaStorageConfiguration();
      if (
        configuration.runtimeEnvironment === "production" ||
        configuration.driver !== "filesystem"
      ) {
        throw new ApiError(404, "not_found", "Route nicht gefunden.");
      }
      const asset = await mediaAssetForTenant(id, context.organizationId);
      const actor = await assertApiMediaManageVisibility(context, asset);
      assertMediaPurposeAccess(context, asset.purpose, "write");
      if (
        asset.status !== "pending" ||
        asset.storageDriver !== "filesystem" ||
        asset.uploadExpiresAt.getTime() <= Date.now()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Der Upload-Intent ist nicht mehr aktiv.",
        );
      }
      let mimeType: string;
      try {
        mimeType = normalizeDeclaredMediaMimeType(
          request.headers.get("content-type") ?? "",
        );
      } catch {
        throw new ApiError(422, "validation_error", "Content-Type ist ungueltig.");
      }
      if (mimeType !== asset.declaredMimeType) {
        throw new ApiError(
          422,
          "validation_error",
          "Content-Type stimmt nicht mit dem Upload-Intent ueberein.",
        );
      }
      const contentLength = request.headers.get("content-length");
      if (contentLength && Number(contentLength) !== asset.declaredSizeBytes) {
        throw new ApiError(
          422,
          "validation_error",
          "Content-Length stimmt nicht mit dem Upload-Intent ueberein.",
        );
      }

      try {
        await writeDevelopmentMediaObject({
          identity: mediaAssetIdentity(asset, "staging"),
          body: requestBody(request),
          expectedSizeBytes: asset.declaredSizeBytes,
        });
      } catch (error) {
        if (
          error instanceof FilesystemMediaStorageError &&
          error.code === "object_exists"
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Das Media-Objekt wurde bereits hochgeladen.",
          );
        }
        if (
          error instanceof FilesystemMediaStorageError &&
          error.code === "invalid_upload_size"
        ) {
          throw new ApiError(422, "validation_error", error.message);
        }
        throw error;
      }

      const now = new Date();
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(mediaAssets)
          .set({
            status: "uploaded",
            actualSizeBytes: asset.declaredSizeBytes,
            uploadedAt: now,
            scanNextRetryAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(mediaAssets.id, asset.id),
              eq(mediaAssets.organizationId, context.organizationId),
              eq(mediaAssets.status, "pending"),
              gt(mediaAssets.uploadExpiresAt, now),
              apiMediaManageVisibility(actor),
            ),
          )
          .returning({ id: mediaAssets.id });
        if (!row) return false;
        await tx.insert(activityEvents).values({
          organizationId: context.organizationId,
          userId: actor.id,
          type: "media_asset.uploaded",
          entityType: "media_asset",
          entityId: asset.id,
          metadata: { transport: "application", sizeBytes: asset.declaredSizeBytes },
        });
        return true;
      });
      if (!updated) {
        await deleteStoredMediaObject(
          mediaAssetIdentity(asset, "staging"),
        ).catch(() => undefined);
        await assertApiMediaManageVisibility(context, asset);
        throw new ApiError(
          409,
          "conflict",
          "Der Upload-Intent ist nicht mehr aktiv.",
        );
      }
      return new Response(null, { status: 204 });
    },
  );
}

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleMediaRawResponse(
    request,
    "media_asset.content.read",
    id,
    async (context) => {
      const configuration = getMediaStorageConfiguration();
      if (
        configuration.runtimeEnvironment === "production" ||
        configuration.driver !== "filesystem"
      ) {
        throw new ApiError(404, "not_found", "Route nicht gefunden.");
      }
      const asset = await mediaAssetForTenant(id, context.organizationId);
      await assertApiMediaReadVisibility(context, asset);
      assertMediaPurposeAccess(context, asset.purpose, "read");
      if (asset.status !== "ready" || asset.storageDriver !== "filesystem") {
        throw new ApiError(404, "not_found", "Media-Inhalt nicht gefunden.");
      }
      const identity = mediaAssetIdentity(asset, "ready");
      const expectedSizeBytes = asset.actualSizeBytes;
      if (
        !Number.isSafeInteger(expectedSizeBytes) ||
        (expectedSizeBytes ?? 0) <= 0
      ) {
        throw new Error("The ready media asset has no valid content length.");
      }
      let range;
      try {
        range = parseHttpByteRange(
          request.headers.get("range"),
          expectedSizeBytes!,
        );
      } catch (error) {
        if (!(error instanceof InvalidHttpByteRangeError)) throw error;
        return new Response(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
            "Content-Range": `bytes */${expectedSizeBytes}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const stored = await getFilesystemMediaObjectForDownload(
        identity,
        range ?? undefined,
      );
      if (stored.sizeBytes !== expectedSizeBytes) {
        throw new Error("The stored media object does not match its asset record.");
      }
      const disposition =
        asset.kind === "document" ||
        new URL(request.url).searchParams.get("disposition") === "attachment"
          ? "attachment"
          : "inline";
      const responseSize = range
        ? range.end - range.start + 1
        : stored.sizeBytes;
      return new Response(streamBody(stored.body), {
        status: range ? 206 : 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `${disposition}; filename="${asset.safeFileName}"`,
          "Content-Length": String(responseSize),
          ...(range
            ? {
                "Content-Range": `bytes ${range.start}-${range.end}/${stored.sizeBytes}`,
              }
            : {}),
          "Content-Type": asset.detectedMimeType ?? asset.declaredMimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
}
