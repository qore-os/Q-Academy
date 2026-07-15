import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, communitySpaces, posts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  commentCreateSchema,
  communityPostParamsSchema,
} from "@/lib/api/schemas";
import { createCommunityCommentMutation } from "@/lib/community-mutations";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  communitySpaceVisibilitySql,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { communityAttachmentsForComments } from "@/lib/community-attachments";
import { communityCommentApiDto } from "@/lib/community-api-dto";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";
import { communityPostAuthorIsActiveSql } from "@/lib/community-content-visibility";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.comment.list",
      resourceType: "comment",
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const [post] = await db
        .select({ id: posts.id, spaceId: posts.spaceId })
        .from(posts)
        .where(
          and(
            eq(posts.id, id),
            eq(posts.organizationId, context.organizationId),
            eq(posts.moderationState, "published"),
            communityPostAuthorIsActiveSql(),
          ),
        )
        .limit(1);
      if (!post)
        throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
      const access = await resolveCommunitySpacePermissions({
        actor,
        spaceId: post.spaceId,
      });
      assertCommunityPermission(access.permissions, "canView");
      const pagination = parsePagination(new URL(request.url));
      const rows = await db
        .select({
          id: comments.id,
          parentId: comments.parentId,
          content: comments.content,
          contentFormat: comments.contentFormat,
          richText: comments.richText,
          contentProjectionVersion: comments.contentProjectionVersion,
          createdAt: comments.createdAt,
          updatedAt: comments.updatedAt,
          authorId: users.id,
          authorFirstName: users.firstName,
          authorLastName: users.lastName,
        })
        .from(comments)
        .innerJoin(
          posts,
          and(
            eq(posts.id, comments.postId),
            eq(posts.organizationId, comments.organizationId),
          ),
        )
        .innerJoin(
          communitySpaces,
          and(
            eq(communitySpaces.id, posts.spaceId),
            eq(communitySpaces.organizationId, posts.organizationId),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, comments.authorId),
            eq(users.organizationId, context.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(comments.organizationId, context.organizationId),
            eq(comments.postId, id),
            eq(comments.moderationState, "published"),
            eq(posts.moderationState, "published"),
            communitySpaceVisibilitySql(actor),
            sql`exists (
            select 1 from users api_comment_list_actor
            where api_comment_list_actor.id = ${actor.id}
              and api_comment_list_actor.organization_id = ${actor.organizationId}
              and api_comment_list_actor.status = 'active'
              and api_comment_list_actor.role = ${actor.role}
          )`,
            sql`exists (
            select 1 from users api_comment_post_author
            where api_comment_post_author.id = ${posts.authorId}
              and api_comment_post_author.organization_id = ${posts.organizationId}
              and api_comment_post_author.status = 'active'
          )`,
          ),
        )
        .orderBy(asc(comments.createdAt))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
      const [attachments, profilesByUser] = await Promise.all([
        communityAttachmentsForComments({
          organizationId: context.organizationId,
          commentIds: pageRows.map((comment) => comment.id),
          downloadContext: "api",
        }),
        getCommunityPublicProfiles({
          organizationId: context.organizationId,
          memberIds: pageRows.map((comment) => comment.authorId),
          downloadContext: "api",
        }),
      ]);
      const data = pageRows.map((comment) => ({
        ...comment,
        authorAvatarUrl:
          profilesByUser.get(comment.authorId)?.avatarUrl ?? null,
        authorProfile: profilesByUser.get(comment.authorId) ?? null,
        attachments: attachments.get(comment.id) ?? [],
      }));
      const finalActor = await communityApiActorForContext(context);
      if (finalActor.id !== actor.id || finalActor.role !== actor.role) {
        throw new ApiError(
          403,
          "forbidden",
          "Community-Berechtigung hat sich geaendert.",
        );
      }
      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
      };
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.comment.create",
      resourceType: "comment",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const input = await parseJson(request, commentCreateSchema);
      const actor = await communityApiActorForContext(context);
      assertCommunityApiActorCanActAs(actor, input.authorId);
      const comment = await createCommunityCommentMutation({
        organizationId: context.organizationId,
        postId: id,
        ...input,
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
        status: 201,
        resourceId: comment.id,
      };
    },
  );
}
