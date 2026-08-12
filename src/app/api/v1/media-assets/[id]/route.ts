import { and, eq } from "drizzle-orm";

import {
  courseMediaAssets,
  communityAssetBindings,
  mediaAssets,
  submissionAttachments,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
} from "@/lib/api/handler";
import {
  assertApiMediaReadVisibility,
  assertApiMediaManageVisibility,
  assertMediaPurposeAccess,
  apiMediaManageVisibility,
} from "@/lib/media/api-scopes";
import {
  mediaAssetForTenant,
  publicMediaAsset,
} from "@/lib/media/asset-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: [], action: "media_asset.read", resourceType: "media_asset" },
    async (context) => {
      const asset = await mediaAssetForTenant(id, context.organizationId);
      await assertApiMediaReadVisibility(context, asset);
      assertMediaPurposeAccess(context, asset.purpose, "read");
      return { data: publicMediaAsset(asset), resourceId: asset.id };
    },
  );
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: [],
      action: "media_asset.delete",
      resourceType: "media_asset",
      idempotent: true,
    },
    {
      async prepare(context) {
        const asset = await mediaAssetForTenant(id, context.organizationId);
        const actor = await assertApiMediaManageVisibility(context, asset);
        assertMediaPurposeAccess(context, asset.purpose, "write");
        return { actor };
      },
      async execute(tools, prepared) {
        const [asset] = await tools.tx
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
        if (!asset) {
          throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
        }
        if (asset.status === "deleted") {
          return { data: { id, deleted: true }, resourceId: id };
        }
        if (asset.status === "scanning") {
          throw new ApiError(
            409,
            "conflict",
            "Ein laufender Media-Scan muss vor dem Loeschen abgeschlossen werden.",
          );
        }
        const [attachment] = await tools.tx
          .select({ id: submissionAttachments.id })
          .from(submissionAttachments)
          .where(
            and(
              eq(submissionAttachments.mediaAssetId, asset.id),
              eq(
                submissionAttachments.organizationId,
                tools.context.organizationId,
              ),
            ),
          )
          .limit(1);
        if (attachment) {
          throw new ApiError(
            409,
            "conflict",
            "Ein gebundenes Submission-Attachment kann nicht geloescht werden.",
          );
        }
        const [courseBinding] = await tools.tx
          .select({ courseId: courseMediaAssets.courseId })
          .from(courseMediaAssets)
          .where(
            and(
              eq(courseMediaAssets.mediaAssetId, asset.id),
              eq(
                courseMediaAssets.organizationId,
                tools.context.organizationId,
              ),
            ),
          )
          .limit(1);
        if (courseBinding) {
          throw new ApiError(
            409,
            "conflict",
            "Ein gebundenes Kursmedium kann nicht geloescht werden.",
          );
        }
        const [communityBinding] = await tools.tx
          .select({ id: communityAssetBindings.mediaAssetId })
          .from(communityAssetBindings)
          .where(
            and(
              eq(communityAssetBindings.mediaAssetId, asset.id),
              eq(
                communityAssetBindings.organizationId,
                tools.context.organizationId,
              ),
            ),
          )
          .limit(1);
        if (communityBinding) {
          throw new ApiError(
            409,
            "conflict",
            "Ein gebundener Community-Anhang kann nicht geloescht werden.",
          );
        }
        const now = new Date();
        await tools.tx
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
          .where(eq(mediaAssets.id, asset.id));
        await tools.activity({
          type: "media_asset.deleted",
          entityType: "media_asset",
          entityId: asset.id,
          userId: prepared.actor.id,
          metadata: { previousStatus: asset.status },
        });
        return { data: { id: asset.id, deleted: true }, resourceId: asset.id };
      },
    },
  );
}
