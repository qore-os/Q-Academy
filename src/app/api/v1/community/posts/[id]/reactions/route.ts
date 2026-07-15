import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { postLikes, posts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  communityPostParamsSchema,
  postReactionSchema,
} from "@/lib/api/schemas";
import { setPostReactionMutation } from "@/lib/community-mutations";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { communityPostAuthorIsActiveSql } from "@/lib/community-content-visibility";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertPost(id: string, organizationId: string) {
  const [post] = await db
    .select({ id: posts.id, spaceId: posts.spaceId })
    .from(posts)
    .where(
      and(
        eq(posts.id, id),
        eq(posts.organizationId, organizationId),
        eq(posts.moderationState, "published"),
        communityPostAuthorIsActiveSql(),
      ),
    )
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
      action: "community.reaction.list",
      resourceType: "post",
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const post = await assertPost(id, context.organizationId);
      const access = await resolveCommunitySpacePermissions({
        actor,
        spaceId: post.spaceId,
      });
      assertCommunityPermission(access.permissions, "canView");
      const pagination = parsePagination(new URL(request.url));
      const rows = await db
        .select({
          userId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          reaction: postLikes.reaction,
          createdAt: postLikes.createdAt,
        })
        .from(postLikes)
        .innerJoin(
          posts,
          and(
            eq(posts.id, postLikes.postId),
            eq(posts.organizationId, postLikes.organizationId),
            eq(posts.moderationState, "published"),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, postLikes.userId),
            eq(users.organizationId, context.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(postLikes.organizationId, context.organizationId),
            eq(postLikes.postId, id),
          ),
        )
        .orderBy(asc(postLikes.createdAt))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
      const profilesByUser = await getCommunityPublicProfiles({
        organizationId: context.organizationId,
        memberIds: pageRows.map((row) => row.userId),
        downloadContext: "api",
      });
      const data = pageRows.map((row) => ({
        ...row,
        avatarUrl: profilesByUser.get(row.userId)?.avatarUrl ?? null,
        profile: profilesByUser.get(row.userId) ?? null,
      }));
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
      action: "community.reaction.add",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const input = await parseJson(request, postReactionSchema);
      const actor = await communityApiActorForContext(context);
      assertCommunityApiActorCanActAs(actor, input.userId);
      const reaction = await setPostReactionMutation({
        organizationId: context.organizationId,
        postId: id,
        userId: input.userId,
        reaction: input.reaction,
      });
      return { data: reaction, status: 201, resourceId: id };
    },
  );
}
