import "server-only";

import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  communityCommentAttachments,
  communityAssetBindings,
  communityPostAttachments,
  mediaAssets,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";

export type CommunityAttachmentView = Readonly<{
  id: string;
  name: string;
  kind: "image" | "audio" | "video" | "document";
  mimeType: string;
  sizeBytes: number;
  downloadHref: string;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeCommunityAttachmentIds(
  values: readonly unknown[],
  maximum: 3 | 6,
) {
  const ids = values.map((value) =>
    typeof value === "string" ? value.trim() : "",
  );
  if (ids.length > maximum || ids.some((id) => !UUID_PATTERN.test(id))) {
    throw new ApiError(
      422,
      "validation_error",
      `Es duerfen hoechstens ${maximum} gueltige Community-Anhaenge verwendet werden.`,
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(
      422,
      "validation_error",
      "Ein Community-Anhang darf nur einmal verwendet werden.",
    );
  }
  return ids;
}

async function lockCommunityAssets(input: {
  tx: ApiTransaction;
  organizationId: string;
  authorId: string;
  attachmentIds: readonly string[];
}) {
  if (!input.attachmentIds.length) return;
  const rows = await input.tx
    .select({
      id: mediaAssets.id,
      purpose: mediaAssets.purpose,
      status: mediaAssets.status,
      deletedAt: mediaAssets.deletedAt,
      ownerUserId: mediaAssets.ownerUserId,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, input.organizationId),
        inArray(mediaAssets.id, [...input.attachmentIds]),
      ),
    )
    .orderBy(asc(mediaAssets.id))
    .for("update");
  if (
    rows.length !== input.attachmentIds.length ||
    rows.some(
      (row) =>
        row.purpose !== "community" ||
        row.status !== "ready" ||
        row.deletedAt !== null ||
        row.ownerUserId !== input.authorId,
    )
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Community-Anhaenge muessen bereit, ungebunden und dem Autor zugeordnet sein.",
    );
  }
  const [binding] = await input.tx
    .select({ id: communityAssetBindings.mediaAssetId })
    .from(communityAssetBindings)
    .where(
      inArray(communityAssetBindings.mediaAssetId, [...input.attachmentIds]),
    )
    .limit(1);
  if (binding) {
    throw new ApiError(
      409,
      "conflict",
      "Mindestens ein Community-Anhang ist bereits gebunden.",
    );
  }
}

export async function bindCommunityPostAttachments(input: {
  tx: ApiTransaction;
  organizationId: string;
  authorId: string;
  postId: string;
  attachmentIds?: readonly string[];
}) {
  const ids = normalizeCommunityAttachmentIds(input.attachmentIds ?? [], 6);
  await lockCommunityAssets({ ...input, attachmentIds: ids });
  if (!ids.length) return;
  await input.tx.insert(communityPostAttachments).values(
    ids.map((mediaAssetId, sortOrder) => ({
      organizationId: input.organizationId,
      postId: input.postId,
      mediaAssetId,
      sortOrder,
    })),
  );
}

export async function bindCommunityCommentAttachments(input: {
  tx: ApiTransaction;
  organizationId: string;
  authorId: string;
  postId: string;
  commentId: string;
  attachmentIds?: readonly string[];
}) {
  const ids = normalizeCommunityAttachmentIds(input.attachmentIds ?? [], 3);
  await lockCommunityAssets({ ...input, attachmentIds: ids });
  if (!ids.length) return;
  await input.tx.insert(communityCommentAttachments).values(
    ids.map((mediaAssetId, sortOrder) => ({
      organizationId: input.organizationId,
      postId: input.postId,
      commentId: input.commentId,
      mediaAssetId,
      sortOrder,
    })),
  );
}

const attachmentFields = {
  id: mediaAssets.id,
  name: mediaAssets.originalFileName,
  kind: mediaAssets.kind,
  mimeType: sql<string>`coalesce(${mediaAssets.detectedMimeType}, ${mediaAssets.declaredMimeType})`,
  sizeBytes: sql<number>`coalesce(${mediaAssets.actualSizeBytes}, ${mediaAssets.declaredSizeBytes})`.mapWith(
    Number,
  ),
};

function attachmentView(
  row: Omit<CommunityAttachmentView, "downloadHref">,
  downloadContext: "session" | "api",
): CommunityAttachmentView {
  return {
    ...row,
    downloadHref:
      downloadContext === "api"
        ? `/api/v1/media-assets/${row.id}/download`
        : `/api/media-assets/${row.id}/download`,
  };
}

export async function communityAttachmentsForPosts(input: {
  organizationId: string;
  postIds: readonly string[];
  downloadContext?: "session" | "api";
}) {
  const result = new Map<string, CommunityAttachmentView[]>();
  if (!input.postIds.length) return result;
  const rows = await db
    .select({ postId: communityPostAttachments.postId, ...attachmentFields })
    .from(communityPostAttachments)
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, communityPostAttachments.mediaAssetId),
        eq(
          mediaAssets.organizationId,
          communityPostAttachments.organizationId,
        ),
        eq(mediaAssets.purpose, "community"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .where(
      and(
        eq(communityPostAttachments.organizationId, input.organizationId),
        inArray(communityPostAttachments.postId, [...input.postIds]),
      ),
    )
    .orderBy(
      asc(communityPostAttachments.postId),
      asc(communityPostAttachments.sortOrder),
    );
  for (const { postId, ...row } of rows) {
    const values = result.get(postId) ?? [];
    values.push(attachmentView(row, input.downloadContext ?? "session"));
    result.set(postId, values);
  }
  return result;
}

export async function communityAttachmentsForComments(input: {
  organizationId: string;
  commentIds: readonly string[];
  downloadContext?: "session" | "api";
}) {
  const result = new Map<string, CommunityAttachmentView[]>();
  if (!input.commentIds.length) return result;
  const rows = await db
    .select({
      commentId: communityCommentAttachments.commentId,
      ...attachmentFields,
    })
    .from(communityCommentAttachments)
    .innerJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, communityCommentAttachments.mediaAssetId),
        eq(
          mediaAssets.organizationId,
          communityCommentAttachments.organizationId,
        ),
        eq(mediaAssets.purpose, "community"),
        eq(mediaAssets.status, "ready"),
        sql`${mediaAssets.deletedAt} is null`,
      ),
    )
    .where(
      and(
        eq(communityCommentAttachments.organizationId, input.organizationId),
        inArray(communityCommentAttachments.commentId, [...input.commentIds]),
      ),
    )
    .orderBy(
      asc(communityCommentAttachments.commentId),
      asc(communityCommentAttachments.sortOrder),
    );
  for (const { commentId, ...row } of rows) {
    const values = result.get(commentId) ?? [];
    values.push(attachmentView(row, input.downloadContext ?? "session"));
    result.set(commentId, values);
  }
  return result;
}

export function communityAssetBindingExistsSql() {
  return exists(
    db
      .select({ id: communityAssetBindings.mediaAssetId })
      .from(communityAssetBindings)
      .where(
        and(
          eq(
            communityAssetBindings.organizationId,
            mediaAssets.organizationId,
          ),
          eq(communityAssetBindings.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}
