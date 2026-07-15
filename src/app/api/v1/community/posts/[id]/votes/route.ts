import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { postVotes, posts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { communityPostParamsSchema, postVoteSchema } from "@/lib/api/schemas";
import { setPostVoteMutation } from "@/lib/community-mutations";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { communityPostAuthorIsActiveSql } from "@/lib/community-content-visibility";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertPost(postId: string, organizationId: string) {
  const [post] = await db
    .select({ id: posts.id, spaceId: posts.spaceId })
    .from(posts)
    .where(
      and(
        eq(posts.id, postId),
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
      action: "community.vote.list",
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
          value: postVotes.value,
          createdAt: postVotes.createdAt,
          updatedAt: postVotes.updatedAt,
        })
        .from(postVotes)
        .innerJoin(
          posts,
          and(
            eq(posts.id, postVotes.postId),
            eq(posts.organizationId, postVotes.organizationId),
            eq(posts.moderationState, "published"),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, postVotes.userId),
            eq(users.organizationId, context.organizationId),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(postVotes.organizationId, context.organizationId),
            eq(postVotes.postId, id),
          ),
        )
        .orderBy(asc(postVotes.createdAt))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;
      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
        resourceId: id,
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
      action: "community.vote.set",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityPostParamsSchema.parse(await params);
      const input = await parseJson(request, postVoteSchema);
      const actor = await communityApiActorForContext(context);
      assertCommunityApiActorCanActAs(actor, input.userId);
      const vote = await setPostVoteMutation({
        organizationId: context.organizationId,
        postId: id,
        userId: input.userId,
        value: input.value,
      });
      return { data: vote, resourceId: id };
    },
  );
}
