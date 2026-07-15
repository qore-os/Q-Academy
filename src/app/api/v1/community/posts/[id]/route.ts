import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { communitySpaces, posts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communityPostParamsSchema, postUpdateSchema } from "@/lib/api/schemas";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  communitySpaceVisibilitySql,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { communityAttachmentsForPosts } from "@/lib/community-attachments";
import { communityPostApiDto } from "@/lib/community-api-dto";
import { communityCourseLinkForActor } from "@/lib/community-course-links";
import { getCommunityCommentsPage } from "@/lib/community-feed";
import {
  deleteCommunityPostWithPointReversal,
  updateCommunityPostMutation,
} from "@/lib/community-mutations";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function postForOrganization(id: string, organizationId: string) {
  const [post] = await db
    .select()
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.organizationId, organizationId)))
    .limit(1);
  if (!post) throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
  return post;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.post.read",
      resourceType: "post",
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const [row] = await db
        .select({
          post: posts,
          commentCount:
            sql<number>`(select count(*) from comments c where c.organization_id = ${context.organizationId} and c.post_id = ${posts.id} and c.moderation_state = 'published')`.mapWith(
              Number,
            ),
        })
        .from(posts)
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
            eq(users.id, posts.authorId),
            eq(users.organizationId, posts.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(posts.id, id),
            eq(posts.organizationId, context.organizationId),
            eq(posts.moderationState, "published"),
            communitySpaceVisibilitySql(actor),
            sql`exists (
            select 1 from users api_post_detail_actor
            where api_post_detail_actor.id = ${actor.id}
              and api_post_detail_actor.organization_id = ${actor.organizationId}
              and api_post_detail_actor.status = 'active'
              and api_post_detail_actor.role = ${actor.role}
          )`,
          ),
        )
        .limit(1);
      if (!row) throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
      const [postAttachments, commentPreview, courseLink] = await Promise.all([
        communityAttachmentsForPosts({
          organizationId: context.organizationId,
          postIds: [row.post.id],
          downloadContext: "api",
        }),
        getCommunityCommentsPage({
          actor,
          postId: row.post.id,
          limit: 3,
          downloadContext: "api",
        }),
        row.post.linkedCourseId
          ? communityCourseLinkForActor(actor, row.post.linkedCourseId)
          : Promise.resolve(null),
      ]);
      const finalActor = await communityApiActorForContext(context);
      if (finalActor.id !== actor.id || finalActor.role !== actor.role) {
        throw new ApiError(
          403,
          "forbidden",
          "Community-Berechtigung hat sich geaendert.",
        );
      }
      return {
        data: {
          ...communityPostApiDto(row.post),
          courseLink: row.post.linkedCourseId ? courseLink : null,
          commentCount: row.commentCount,
          attachments: postAttachments.get(row.post.id) ?? [],
          comments: commentPreview.items,
          hasMoreComments: commentPreview.hasMore,
        },
        resourceId: id,
      };
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.post.update",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const current = await postForOrganization(id, context.organizationId);
      const actor = await communityApiActorForContext(context);
      const visibleAccess = await resolveCommunitySpacePermissions({
        actor,
        spaceId: current.spaceId,
      });
      assertCommunityPermission(visibleAccess.permissions, "canView");
      assertCommunityApiActorCanActAs(actor, current.authorId);
      const input = await parseJson(request, postUpdateSchema);
      if (
        (input.pinned !== undefined || input.locked !== undefined) &&
        actor.role !== "owner" &&
        actor.role !== "admin"
      ) {
        throw new ApiError(
          403,
          "forbidden",
          "Nur Administratoren duerfen Beitraege fixieren oder sperren.",
        );
      }
      const { expectedContentVersion, ...changes } = input;
      const post = await updateCommunityPostMutation({
        organizationId: context.organizationId,
        actorId: actor.id,
        postId: id,
        expectedContentVersion,
        ...changes,
        allowModeration: actor.role === "owner" || actor.role === "admin",
      });
      const attachments = await communityAttachmentsForPosts({
        organizationId: context.organizationId,
        postIds: [post.id],
        downloadContext: "api",
      });
      const courseLink = post.linkedCourseId
        ? await communityCourseLinkForActor(actor, post.linkedCourseId)
        : null;
      return {
        data: {
          ...communityPostApiDto(post),
          courseLink,
          attachments: attachments.get(post.id) ?? [],
        },
        resourceId: id,
      };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.post.delete",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const current = await postForOrganization(id, context.organizationId);
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
        deleteCommunityPostWithPointReversal(tx, {
          organizationId: context.organizationId,
          postId: id,
          actorId: actor.id,
          authorization:
            actor.role === "owner" || actor.role === "admin" ? "manage" : "own",
        }),
      );
      if (!deleted) {
        throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
      }
      return { data: { id, deleted: true }, resourceId: id };
    },
  );
}
