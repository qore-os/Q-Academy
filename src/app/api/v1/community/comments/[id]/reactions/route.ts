import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { commentReactions, comments, posts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  commentReactionActorQuerySchema,
  commentReactionUpdateSchema,
  communityCommentParamsSchema,
} from "@/lib/api/schemas";
import {
  assertCommunityApiActorCanActAs,
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import type { CommunityReactionType } from "@/lib/community-domain";
import { setCommentReactionMutation } from "@/lib/community-mutations";
import { communityCommentAndPostAuthorsAreActiveSql } from "@/lib/community-content-visibility";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function commentReactionSummary(input: {
  organizationId: string;
  commentId: string;
  userId: string;
}) {
  const [summary] = await db
    .select({
      commentId: comments.id,
      spaceId: posts.spaceId,
      memberRole: users.role,
      myReaction: sql<CommunityReactionType | null>`(
        array_agg(${commentReactions.reaction})
        filter (where ${commentReactions.userId} = ${input.userId})
      )[1]`,
      like: sql<number>`count(${commentReactions.commentId}) filter (
        where ${commentReactions.reaction} = 'like'
      )`.mapWith(Number),
      celebrate: sql<number>`count(${commentReactions.commentId}) filter (
        where ${commentReactions.reaction} = 'celebrate'
      )`.mapWith(Number),
      insightful: sql<number>`count(${commentReactions.commentId}) filter (
        where ${commentReactions.reaction} = 'insightful'
      )`.mapWith(Number),
      question: sql<number>`count(${commentReactions.commentId}) filter (
        where ${commentReactions.reaction} = 'question'
      )`.mapWith(Number),
      total: sql<number>`count(${commentReactions.commentId})`.mapWith(Number),
    })
    .from(comments)
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, comments.organizationId),
        eq(posts.moderationState, "published"),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, comments.organizationId),
        eq(users.status, "active"),
      ),
    )
    .leftJoin(
      commentReactions,
      and(
        eq(commentReactions.commentId, comments.id),
        eq(commentReactions.postId, comments.postId),
        eq(commentReactions.organizationId, comments.organizationId),
      ),
    )
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.organizationId, input.organizationId),
        eq(comments.moderationState, "published"),
        communityCommentAndPostAuthorsAreActiveSql(),
      ),
    )
    .groupBy(comments.id, posts.spaceId, users.role)
    .limit(1);

  if (!summary) {
    throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
  }

  const access = await resolveCommunitySpacePermissions({
    actor: {
      id: input.userId,
      organizationId: input.organizationId,
      role: summary.memberRole,
    },
    spaceId: summary.spaceId,
  });
  assertCommunityPermission(access.permissions, "canView");

  return {
    commentId: summary.commentId,
    userId: input.userId,
    myReaction: summary.myReaction,
    counts: {
      like: summary.like,
      celebrate: summary.celebrate,
      insightful: summary.insightful,
      question: summary.question,
      total: summary.total,
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.comment_reaction.read",
      resourceType: "comment",
    },
    async (context) => {
      const { id } = communityCommentParamsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const query = commentReactionActorQuerySchema.parse({
        userId:
          new URL(request.url).searchParams.get("userId") ?? undefined,
      });
      const userId = query.userId ?? actor.id;
      assertCommunityApiActorCanActAs(actor, userId);

      return {
        data: await commentReactionSummary({
          organizationId: context.organizationId,
          commentId: id,
          userId,
        }),
        resourceId: id,
      };
    },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.comment_reaction.set",
      resourceType: "comment",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityCommentParamsSchema.parse(await params);
      const input = await parseJson(request, commentReactionUpdateSchema);
      const actor = await communityApiActorForContext(context);
      const userId = input.userId ?? actor.id;
      assertCommunityApiActorCanActAs(actor, userId);

      await setCommentReactionMutation({
        organizationId: context.organizationId,
        commentId: id,
        userId,
        reaction: input.reaction,
      });
      return {
        data: { commentId: id, userId, reaction: input.reaction },
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
      action: "community.comment_reaction.remove",
      resourceType: "comment",
      idempotent: true,
    },
    async (context) => {
      const { id } = communityCommentParamsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const query = commentReactionActorQuerySchema.parse({
        userId:
          new URL(request.url).searchParams.get("userId") ?? undefined,
      });
      const userId = query.userId ?? actor.id;
      assertCommunityApiActorCanActAs(actor, userId);

      await setCommentReactionMutation({
        organizationId: context.organizationId,
        commentId: id,
        userId,
        reaction: null,
      });
      return {
        data: { commentId: id, userId, reaction: null },
        resourceId: id,
      };
    },
  );
}
