import "server-only";

import type { MediaAsset } from "@/lib/media/asset-service";
import { mediaAssetIdentity } from "@/lib/media/asset-service";
import {
  InvalidHttpByteRangeError,
  parseHttpByteRange,
} from "@/lib/media/http-byte-range";
import {
  createMediaDownloadAuthorization,
  getFilesystemMediaObjectForDownload,
} from "@/lib/media/storage";

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

export async function mediaDownloadResponse(input: {
  request: Request;
  asset: MediaAsset;
  disposition: "inline" | "attachment";
  cacheControl: string;
}) {
  const { asset, request } = input;
  if (
    !Number.isSafeInteger(asset.actualSizeBytes) ||
    (asset.actualSizeBytes ?? 0) <= 0
  ) {
    throw new Error("The ready media asset has no valid content length.");
  }
  if (asset.storageDriver === "s3") {
    const authorization = await createMediaDownloadAuthorization({
      identity: mediaAssetIdentity(asset, "ready"),
      safeFileName: asset.safeFileName,
      disposition: input.disposition,
      storageVersionId: asset.storageVersionId,
      expectedEtag: asset.etag,
      expectedSha256: asset.contentSha256,
      expectedSizeBytes: asset.actualSizeBytes,
      expectedMimeType: asset.detectedMimeType ?? asset.declaredMimeType,
    });
    if (authorization.transport !== "s3") {
      throw new Error("The media download transport is inconsistent.");
    }
    return new Response(null, {
      status: 307,
      headers: {
        "Cache-Control": input.cacheControl,
        Location: authorization.url,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const expectedSizeBytes = asset.actualSizeBytes!;
  let range;
  try {
    range = parseHttpByteRange(request.headers.get("range"), expectedSizeBytes);
  } catch (error) {
    if (!(error instanceof InvalidHttpByteRangeError)) throw error;
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": input.cacheControl,
        "Content-Range": `bytes */${expectedSizeBytes}`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const stored = await getFilesystemMediaObjectForDownload(
    mediaAssetIdentity(asset, "ready"),
    range ?? undefined,
  );
  const sizeBytes = stored.sizeBytes;
  if (
    typeof sizeBytes !== "number" ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes !== expectedSizeBytes ||
    sizeBytes <= 0
  ) {
    throw new Error("The stored media object does not match its asset record.");
  }
  const responseSize = range ? range.end - range.start + 1 : sizeBytes;
  return new Response(streamBody(stored.body), {
    status: range ? 206 : 200,
    headers: {
      "Accept-Ranges": "bytes",
      "Cache-Control": input.cacheControl,
      "Content-Disposition": `${input.disposition}; filename="${asset.safeFileName}"`,
      "Content-Length": String(responseSize),
      ...(range
        ? { "Content-Range": `bytes ${range.start}-${range.end}/${sizeBytes}` }
        : {}),
      "Content-Type": asset.detectedMimeType ?? asset.declaredMimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
