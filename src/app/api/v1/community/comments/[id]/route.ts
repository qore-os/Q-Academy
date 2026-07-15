import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { comments, posts } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { commentUpdateSchema } from "@/lib/api/schemas";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { communityAttachmentsForComments } from "@/lib/community-attachments";
import { communityCommentApiDto } from "@/lib/community-api-dto";
import {
  deleteCommunityCommentWithPointReversal,
  updateCommunityCommentMutation,
} from "@/lib/community-mutations";
import { communityCommentAndPostAuthorsAreActiveSql } from "@/lib/community-content-visibility";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function commentForOrganization(
  id: string,
  organizationId: string,
  publishedOnly = false,
) {
  const [comment] = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      spaceId: posts.spaceId,
      parentId: comments.parentId,
      authorId: comments.authorId,
      content: comments.content,
      contentFormat: comments.contentFormat,
      richText: comments.richText,
      contentProjectionVersion: comments.contentProjectionVersion,
      moderationState: comments.moderationState,
      moderationVersion: comments.moderationVersion,
      publishedAt: comments.publishedAt,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
    })
    .from(comments)
    .innerJoin(posts, and(eq(posts.id, comments.postId), eq(posts.organizationId, organizationId)))
    .where(
      and(
        eq(comments.id, id),
        eq(comments.organizationId, organizationId),
        publishedOnly ? eq(comments.moderationState, "published") : undefined,
        publishedOnly ? eq(posts.moderationState, "published") : undefined,
        publishedOnly
          ? communityCommentAndPostAuthorsAreActiveSql()
          : undefined,
      ),
    )
    .limit(1);
  if (!comment) throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
  return comment;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:read"], action: "community.comment.read", resourceType: "comment" }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const comment = await commentForOrganization(id, context.organizationId, true);
    const access = await resolveCommunitySpacePermissions({ actor, spaceId: comment.spaceId });
    assertCommunityPermission(access.permissions, "canView");
    const attachments = await communityAttachmentsForComments({
      organizationId: context.organizationId,
      commentIds: [comment.id],
      downloadContext: "api",
    });
    return {
      data: {
        ...communityCommentApiDto(comment),
        attachments: attachments.get(comment.id) ?? [],
      },
      resourceId: id,
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "community.comment.update", resourceType: "comment", idempotent: true }, async (context) => {
    const current = await commentForOrganization(id, context.organizationId);
    const actor = await communityApiActorForContext(context);
    const visibleAccess = await resolveCommunitySpacePermissions({
      actor,
      spaceId: current.spaceId,
    });
    assertCommunityPermission(visibleAccess.permissions, "canView");
    assertCommunityApiActorCanActAs(actor, current.authorId);
    const input = await parseJson(request, commentUpdateSchema);
    const comment = await updateCommunityCommentMutation({
      organizationId: context.organizationId,
      actorId: actor.id,
      commentId: id,
      expectedContentVersion: input.expectedContentVersion,
      content: input.content,
      richText: input.richText,
    });
    const attachments = await communityAttachmentsForComments({
      organizationId: context.organizationId,
      commentIds: [comment.id],
      downloadContext: "api",
    });
    return {
      data: {
        ...communityCommentApiDto(comment),
        attachments: attachments.get(comment.id) ?? [],
      },
      resourceId: id,
    };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "community.comment.delete", resourceType: "comment", idempotent: true }, async (context) => {
    const current = await commentForOrganization(id, context.organizationId);
    const actor = await communityApiActorForContext(context);
    if (
      actor.id !== current.authorId &&
      actor.role !== "owner" &&
      actor.role !== "admin"
    ) {
      const access = await resolveCommunitySpacePermissions({
        actor,
        spaceId: current.spaceId,
      });
      assertCommunityPermission(access.permissions, "canView");
      assertCommunityApiActorCanActAs(actor, current.authorId);
    }
    const deleted = await db.transaction((tx) =>
      deleteCommunityCommentWithPointReversal(tx, {
        organizationId: context.organizationId,
        commentId: id,
        actorId: actor.id,
        authorization:
          actor.role === "owner" || actor.role === "admin"
            ? "manage"
            : "own",
      }),
    );
    if (!deleted) {
      throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
    }
    return { data: { id, deleted: true }, resourceId: id };
  });
}
