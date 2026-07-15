import { ApiError } from "@/lib/api/errors";
import { apiOptions } from "@/lib/api/handler";
import {
  assertApiPublicCommunityAvatarReadVisibility,
  assertApiMediaReadVisibility,
  assertMediaPurposeAccess,
} from "@/lib/media/api-scopes";
import { apiScopeIsGranted } from "@/lib/api/scopes";
import {
  mediaAssetForTenant,
  mediaAssetIdentity,
} from "@/lib/media/asset-service";
import { handleMediaRawResponse } from "@/lib/media/raw-api";
import { createMediaDownloadAuthorization } from "@/lib/media/storage";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleMediaRawResponse(
    request,
    "media_asset.download",
    id,
    async (context) => {
      const asset = await mediaAssetForTenant(id, context.organizationId);
      if (
        asset.purpose === "avatar" &&
        !apiScopeIsGranted(context.scopes, "members:read") &&
        apiScopeIsGranted(context.scopes, "community:read")
      ) {
        await assertApiPublicCommunityAvatarReadVisibility(context, asset);
      } else {
        await assertApiMediaReadVisibility(context, asset);
        assertMediaPurposeAccess(context, asset.purpose, "read");
      }
      if (asset.status !== "ready") {
        throw new ApiError(404, "not_found", "Media-Inhalt nicht gefunden.");
      }
      const disposition =
        asset.kind !== "document" &&
        new URL(request.url).searchParams.get("disposition") === "inline"
          ? "inline"
          : "attachment";
      const authorization = await createMediaDownloadAuthorization({
        identity: mediaAssetIdentity(asset, "ready"),
        safeFileName: asset.safeFileName,
        disposition,
        storageVersionId: asset.storageVersionId,
        expectedEtag: asset.etag,
        expectedSha256: asset.contentSha256,
        expectedSizeBytes: asset.actualSizeBytes,
        expectedMimeType:
          asset.detectedMimeType ?? asset.declaredMimeType,
      });
      return new Response(null, {
        status: 307,
        headers: {
          "Cache-Control": "private, no-store",
          Location: authorization.url,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
}
