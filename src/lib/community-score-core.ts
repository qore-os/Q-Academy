import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  commentReactions,
  comments,
  communityScoreContributions,
  postLikes,
  posts,
} from "@/db/schema";

export type CommunityScoreTransaction = Parameters<
  Parameters<(typeof import("@/db"))["db"]["transaction"]>[0]
>[0];

export type CommunityScoreSyncResult = Readonly<{
  created: boolean;
  kind: "post_reaction" | "post_comment" | "comment_reply" | "comment_reaction";
  recipientId: string;
  actorId: string;
  points: 1 | 2;
}>;

export type CommunityScoreRestoreResult = Readonly<{
  created: number;
  postReactions: number;
  comments: number;
  commentReactions: number;
}>;

async function insertContribution(
  tx: CommunityScoreTransaction,
  values: typeof communityScoreContributions.$inferInsert,
): Promise<CommunityScoreSyncResult> {
  const [inserted] = await tx
    .insert(communityScoreContributions)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: communityScoreContributions.id });
  return {
    created: Boolean(inserted),
    kind: values.kind,
    recipientId: values.recipientId,
    actorId: values.actorId,
    points: values.points as 1 | 2,
  };
}

export async function syncPostReactionCommunityScore(
  tx: CommunityScoreTransaction,
  input: {
    organizationId: string;
    postId: string;
    actorId: string;
  },
) {
  const [source] = await tx
    .select({
      recipientId: posts.authorId,
      actorId: postLikes.userId,
    })
    .from(postLikes)
    .innerJoin(
      posts,
      and(
        eq(posts.id, postLikes.postId),
        eq(posts.organizationId, postLikes.organizationId),
      ),
    )
    .where(
      and(
        eq(postLikes.organizationId, input.organizationId),
        eq(postLikes.postId, input.postId),
        eq(postLikes.userId, input.actorId),
        eq(posts.moderationState, "published"),
      ),
    )
    .limit(1);
  if (!source || source.recipientId === source.actorId) return null;
  return insertContribution(tx, {
    organizationId: input.organizationId,
    recipientId: source.recipientId,
    actorId: source.actorId,
    kind: "post_reaction",
    postId: input.postId,
    points: 1,
  });
}

export async function syncCommunityCommentFirstPublishScore(
  tx: CommunityScoreTransaction,
  input: {
    organizationId: string;
    commentId: string;
  },
) {
  const parent = alias(comments, "community_score_parent_comment");
  const [source] = await tx
    .select({
      actorId: comments.authorId,
      parentId: comments.parentId,
      postAuthorId: posts.authorId,
      parentAuthorId: parent.authorId,
    })
    .from(comments)
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, comments.organizationId),
      ),
    )
    .leftJoin(
      parent,
      and(
        eq(parent.id, comments.parentId),
        eq(parent.postId, comments.postId),
        eq(parent.organizationId, comments.organizationId),
        eq(parent.moderationState, "published"),
      ),
    )
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        eq(comments.id, input.commentId),
        eq(comments.moderationState, "published"),
        eq(posts.moderationState, "published"),
      ),
    )
    .limit(1);
  if (!source) return null;

  const recipientId = source.parentId
    ? source.parentAuthorId
    : source.postAuthorId;
  if (!recipientId || recipientId === source.actorId) return null;
  return insertContribution(tx, {
    organizationId: input.organizationId,
    recipientId,
    actorId: source.actorId,
    kind: source.parentId ? "comment_reply" : "post_comment",
    commentId: input.commentId,
    points: source.parentId ? 1 : 2,
  });
}

export async function syncCommentReactionCommunityScore(
  tx: CommunityScoreTransaction,
  input: {
    organizationId: string;
    commentId: string;
    actorId: string;
  },
) {
  const [source] = await tx
    .select({
      recipientId: comments.authorId,
      actorId: commentReactions.userId,
    })
    .from(commentReactions)
    .innerJoin(
      comments,
      and(
        eq(comments.id, commentReactions.commentId),
        eq(comments.postId, commentReactions.postId),
        eq(comments.organizationId, commentReactions.organizationId),
      ),
    )
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, comments.organizationId),
      ),
    )
    .where(
      and(
        eq(commentReactions.organizationId, input.organizationId),
        eq(commentReactions.commentId, input.commentId),
        eq(commentReactions.userId, input.actorId),
        eq(comments.moderationState, "published"),
        eq(posts.moderationState, "published"),
      ),
    )
    .limit(1);
  if (!source || source.recipientId === source.actorId) return null;
  return insertContribution(tx, {
    organizationId: input.organizationId,
    recipientId: source.recipientId,
    actorId: source.actorId,
    kind: "comment_reaction",
    reactionCommentId: input.commentId,
    points: 1,
  });
}

export async function restoreCommunityScoreContributionsForPost(
  tx: CommunityScoreTransaction,
  input: { organizationId: string; postId: string },
): Promise<CommunityScoreRestoreResult> {
  const [restoredPostReactions] = await tx.execute(sql<{ count: number }>`
    with restored as (
    insert into public.community_score_contributions (
      organization_id, recipient_id, actor_id, kind, post_id, points,
      created_at
    )
    select reaction.organization_id, post.author_id, reaction.user_id,
           'post_reaction'::public.community_score_contribution_kind,
           reaction.post_id, 1, reaction.created_at
    from public.post_likes reaction
    inner join public.posts post
      on post.id = reaction.post_id
      and post.organization_id = reaction.organization_id
    where reaction.organization_id = ${input.organizationId}
      and reaction.post_id = ${input.postId}
      and post.moderation_state = 'published'
      and post.author_id <> reaction.user_id
    order by post.author_id, reaction.user_id
    on conflict do nothing
    returning 1
    )
    select count(*)::integer as count from restored
  `);
  const [restoredComments] = await tx.execute(sql<{ count: number }>`
    with restored as (
    insert into public.community_score_contributions (
      organization_id, recipient_id, actor_id, kind, comment_id, points,
      created_at
    )
    select comment.organization_id,
           case
             when comment.parent_id is null then post.author_id
             else parent.author_id
           end,
           comment.author_id,
           case
             when comment.parent_id is null
               then 'post_comment'::public.community_score_contribution_kind
             else 'comment_reply'::public.community_score_contribution_kind
           end,
           comment.id,
           case when comment.parent_id is null then 2 else 1 end,
           comment.created_at
    from public.comments comment
    inner join public.posts post
      on post.id = comment.post_id
      and post.organization_id = comment.organization_id
    left join public.comments parent
      on parent.id = comment.parent_id
      and parent.post_id = comment.post_id
      and parent.organization_id = comment.organization_id
      and parent.moderation_state = 'published'
    where comment.organization_id = ${input.organizationId}
      and comment.post_id = ${input.postId}
      and comment.moderation_state = 'published'
      and post.moderation_state = 'published'
      and (comment.parent_id is null or parent.id is not null)
      and comment.author_id <>
        case
          when comment.parent_id is null then post.author_id
          else parent.author_id
        end
    order by
      case
        when comment.parent_id is null then post.author_id
        else parent.author_id
      end,
      comment.id
    on conflict do nothing
    returning 1
    )
    select count(*)::integer as count from restored
  `);
  const [restoredCommentReactions] = await tx.execute(sql<{ count: number }>`
    with restored as (
    insert into public.community_score_contributions (
      organization_id, recipient_id, actor_id, kind, reaction_comment_id,
      points, created_at
    )
    select reaction.organization_id, comment.author_id, reaction.user_id,
           'comment_reaction'::public.community_score_contribution_kind,
           reaction.comment_id, 1, reaction.created_at
    from public.comment_reactions reaction
    inner join public.comments comment
      on comment.id = reaction.comment_id
      and comment.post_id = reaction.post_id
      and comment.organization_id = reaction.organization_id
    inner join public.posts post
      on post.id = comment.post_id
      and post.organization_id = comment.organization_id
    left join public.comments parent
      on parent.id = comment.parent_id
      and parent.post_id = comment.post_id
      and parent.organization_id = comment.organization_id
      and parent.moderation_state = 'published'
    where reaction.organization_id = ${input.organizationId}
      and reaction.post_id = ${input.postId}
      and comment.moderation_state = 'published'
      and post.moderation_state = 'published'
      and (comment.parent_id is null or parent.id is not null)
      and comment.author_id <> reaction.user_id
    order by comment.author_id, reaction.comment_id, reaction.user_id
    on conflict do nothing
    returning 1
    )
    select count(*)::integer as count from restored
  `);
  const postReactionCount = Number(restoredPostReactions?.count ?? 0);
  const commentCount = Number(restoredComments?.count ?? 0);
  const commentReactionCount = Number(restoredCommentReactions?.count ?? 0);
  return {
    created: postReactionCount + commentCount + commentReactionCount,
    postReactions: postReactionCount,
    comments: commentCount,
    commentReactions: commentReactionCount,
  };
}

export async function restoreCommunityScoreContributionsForComment(
  tx: CommunityScoreTransaction,
  input: { organizationId: string; commentId: string },
): Promise<CommunityScoreRestoreResult> {
  const [restoredComments] = await tx.execute(sql<{ count: number }>`
    with restored as (
    insert into public.community_score_contributions (
      organization_id, recipient_id, actor_id, kind, comment_id, points,
      created_at
    )
    with target as (
      select target.id, target.post_id, target.organization_id
      from public.comments target
      inner join public.posts post
        on post.id = target.post_id
        and post.organization_id = target.organization_id
      left join public.comments target_parent
        on target_parent.id = target.parent_id
        and target_parent.post_id = target.post_id
        and target_parent.organization_id = target.organization_id
        and target_parent.moderation_state = 'published'
      where target.id = ${input.commentId}
        and target.organization_id = ${input.organizationId}
        and target.moderation_state = 'published'
        and post.moderation_state = 'published'
        and (target.parent_id is null or target_parent.id is not null)
    )
    select comment.organization_id,
           case
             when comment.parent_id is null then post.author_id
             else parent.author_id
           end,
           comment.author_id,
           case
             when comment.parent_id is null
               then 'post_comment'::public.community_score_contribution_kind
             else 'comment_reply'::public.community_score_contribution_kind
           end,
           comment.id,
           case when comment.parent_id is null then 2 else 1 end,
           comment.created_at
    from public.comments comment
    inner join target
      on target.post_id = comment.post_id
      and target.organization_id = comment.organization_id
      and (comment.id = target.id or comment.parent_id = target.id)
    inner join public.posts post
      on post.id = comment.post_id
      and post.organization_id = comment.organization_id
    left join public.comments parent
      on parent.id = comment.parent_id
      and parent.post_id = comment.post_id
      and parent.organization_id = comment.organization_id
      and parent.moderation_state = 'published'
    where comment.moderation_state = 'published'
      and (comment.parent_id is null or parent.id is not null)
      and comment.author_id <>
        case
          when comment.parent_id is null then post.author_id
          else parent.author_id
        end
    order by
      case
        when comment.parent_id is null then post.author_id
        else parent.author_id
      end,
      comment.id
    on conflict do nothing
    returning 1
    )
    select count(*)::integer as count from restored
  `);
  const [restoredCommentReactions] = await tx.execute(sql<{ count: number }>`
    with restored as (
    insert into public.community_score_contributions (
      organization_id, recipient_id, actor_id, kind, reaction_comment_id,
      points, created_at
    )
    with target as (
      select target.id, target.post_id, target.organization_id
      from public.comments target
      inner join public.posts post
        on post.id = target.post_id
        and post.organization_id = target.organization_id
      left join public.comments target_parent
        on target_parent.id = target.parent_id
        and target_parent.post_id = target.post_id
        and target_parent.organization_id = target.organization_id
        and target_parent.moderation_state = 'published'
      where target.id = ${input.commentId}
        and target.organization_id = ${input.organizationId}
        and target.moderation_state = 'published'
        and post.moderation_state = 'published'
        and (target.parent_id is null or target_parent.id is not null)
    ), affected as (
      select comment.id, comment.post_id, comment.organization_id,
             comment.author_id
      from public.comments comment
      inner join target
        on target.post_id = comment.post_id
        and target.organization_id = comment.organization_id
        and (comment.id = target.id or comment.parent_id = target.id)
      left join public.comments parent
        on parent.id = comment.parent_id
        and parent.post_id = comment.post_id
        and parent.organization_id = comment.organization_id
        and parent.moderation_state = 'published'
      where comment.moderation_state = 'published'
        and (comment.parent_id is null or parent.id is not null)
    )
    select reaction.organization_id, affected.author_id, reaction.user_id,
           'comment_reaction'::public.community_score_contribution_kind,
           reaction.comment_id, 1, reaction.created_at
    from public.comment_reactions reaction
    inner join affected
      on affected.id = reaction.comment_id
      and affected.post_id = reaction.post_id
      and affected.organization_id = reaction.organization_id
    where affected.author_id <> reaction.user_id
    order by affected.author_id, reaction.comment_id, reaction.user_id
    on conflict do nothing
    returning 1
    )
    select count(*)::integer as count from restored
  `);
  const commentCount = Number(restoredComments?.count ?? 0);
  const commentReactionCount = Number(restoredCommentReactions?.count ?? 0);
  return {
    created: commentCount + commentReactionCount,
    postReactions: 0,
    comments: commentCount,
    commentReactions: commentReactionCount,
  };
}

export async function removePostReactionCommunityScore(
  tx: CommunityScoreTransaction,
  input: {
    organizationId: string;
    postId: string;
    actorId: string;
  },
) {
  return tx
    .delete(communityScoreContributions)
    .where(
      and(
        eq(communityScoreContributions.organizationId, input.organizationId),
        eq(communityScoreContributions.kind, "post_reaction"),
        eq(communityScoreContributions.postId, input.postId),
        eq(communityScoreContributions.actorId, input.actorId),
      ),
    )
    .returning({ id: communityScoreContributions.id });
}

export async function removeCommentReactionCommunityScore(
  tx: CommunityScoreTransaction,
  input: {
    organizationId: string;
    commentId: string;
    actorId: string;
  },
) {
  return tx
    .delete(communityScoreContributions)
    .where(
      and(
        eq(communityScoreContributions.organizationId, input.organizationId),
        eq(communityScoreContributions.kind, "comment_reaction"),
        eq(communityScoreContributions.reactionCommentId, input.commentId),
        eq(communityScoreContributions.actorId, input.actorId),
      ),
    )
    .returning({ id: communityScoreContributions.id });
}

export async function removeCommunityScoreContributionsForPost(
  tx: CommunityScoreTransaction,
  input: { organizationId: string; postId: string },
) {
  const commentIds = tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        eq(comments.postId, input.postId),
      ),
    );
  return tx
    .delete(communityScoreContributions)
    .where(
      and(
        eq(communityScoreContributions.organizationId, input.organizationId),
        or(
          eq(communityScoreContributions.postId, input.postId),
          inArray(communityScoreContributions.commentId, commentIds),
          inArray(communityScoreContributions.reactionCommentId, commentIds),
        ),
      ),
    )
    .returning({ id: communityScoreContributions.id });
}

export async function removeCommunityScoreContributionsForComment(
  tx: CommunityScoreTransaction,
  input: { organizationId: string; commentId: string },
) {
  const affectedCommentIds = tx
    .select({ id: comments.id })
    .from(comments)
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        or(
          eq(comments.id, input.commentId),
          eq(comments.parentId, input.commentId),
        ),
      ),
    );
  return tx
    .delete(communityScoreContributions)
    .where(
      and(
        eq(communityScoreContributions.organizationId, input.organizationId),
        or(
          inArray(communityScoreContributions.commentId, affectedCommentIds),
          inArray(
            communityScoreContributions.reactionCommentId,
            affectedCommentIds,
          ),
        ),
      ),
    )
    .returning({ id: communityScoreContributions.id });
}

export async function removeCommunityCommentCreationScore(
  tx: CommunityScoreTransaction,
  input: { organizationId: string; commentId: string },
) {
  return tx
    .delete(communityScoreContributions)
    .where(
      and(
        eq(communityScoreContributions.organizationId, input.organizationId),
        inArray(communityScoreContributions.kind, [
          "post_comment",
          "comment_reply",
        ]),
        eq(communityScoreContributions.commentId, input.commentId),
        isNull(communityScoreContributions.postId),
      ),
    )
    .returning({ id: communityScoreContributions.id });
}
