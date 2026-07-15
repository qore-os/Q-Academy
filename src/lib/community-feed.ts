import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  commentReactions,
  comments,
  communityFeedRevisions,
  communityFollows,
  communityLevels,
  communityLevelSettings,
  communitySpaces,
  posts,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import {
  communitySpaceVisibilitySql,
  communitySpacePermissionSql,
  type CommunitySpacePermissions,
  type CommunityPolicyActor,
} from "@/lib/community-access";
import {
  communityAttachmentsForComments,
  communityAttachmentsForPosts,
  type CommunityAttachmentView,
} from "@/lib/community-attachments";
import {
  communityCourseLinksForPosts,
  type CommunityCourseLink,
} from "@/lib/community-course-links";
import type {
  CommunityReactionType,
  CommunitySpaceType,
} from "@/lib/community-domain";
import {
  resolveCommunityLevelProgress,
  type CommunityLevelProgressDto,
} from "@/lib/community-level-domain";
import type { CommunityBadgeView } from "@/lib/community-badges";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";
import { getSessionSecret } from "@/lib/server-environment";
import type { RichTextDocument } from "@/lib/rich-text/document";

export const COMMUNITY_FEED_MODES = ["for_you", "following", "latest"] as const;
export type CommunityFeedMode = (typeof COMMUNITY_FEED_MODES)[number];

export const COMMUNITY_FEED_REASON_CODES = [
  "pinned",
  "followed_author",
  "followed_space",
  "boosted",
  "trending",
  "recent",
] as const;
export type CommunityFeedReasonCode =
  (typeof COMMUNITY_FEED_REASON_CODES)[number];

export type CommunityFeedCommentDto = Readonly<{
  id: string;
  moderationVersion: number;
  authorId: string;
  parentId: string | null;
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
  contentProjectionVersion: number;
  createdAt: string;
  updatedAt: string;
  firstName: string;
  lastName: string;
  authorAvatarUrl: string | null;
  badges: CommunityBadgeView[];
  reported: boolean;
  replyCount: number;
  reactionCount: number;
  likeReactionCount: number;
  celebrateReactionCount: number;
  insightfulReactionCount: number;
  questionReactionCount: number;
  myReaction: CommunityReactionType | null;
  attachments: CommunityAttachmentView[];
  replies: CommunityFeedCommentDto[];
}>;

export type CommunityFeedPostDto = Readonly<{
  id: string;
  moderationVersion: number;
  title: string | null;
  content: string;
  contentFormat: "plain_text" | "rich_text";
  richText: RichTextDocument | null;
  contentProjectionVersion: number;
  imageUrl: string | null;
  pinned: boolean;
  locked: boolean;
  courseLink: CommunityCourseLink | null;
  createdAt: string;
  updatedAt: string;
  authorId: string;
  firstName: string;
  lastName: string;
  authorAvatarUrl: string | null;
  badges: CommunityBadgeView[];
  jobTitle: string | null;
  points: number | null;
  spaceId: string;
  spaceTitle: string;
  spaceColor: string;
  spaceType: CommunitySpaceType;
  likeCount: number;
  likeReactionCount: number;
  celebrateReactionCount: number;
  insightfulReactionCount: number;
  questionReactionCount: number;
  commentCount: number;
  myReaction: CommunityReactionType | null;
  voteScore: number;
  myVote: number;
  reported: boolean;
  reasonCodes: CommunityFeedReasonCode[];
  isFollowingAuthor: boolean;
  isFollowingSpace: boolean;
  attachments: CommunityAttachmentView[];
  comments: CommunityFeedCommentDto[];
}>;

export type CommunityFeedPageDto = Readonly<{
  mode: CommunityFeedMode;
  asOf: string;
  items: CommunityFeedPostDto[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export type CommunityCommentsPageDto = Readonly<{
  items: CommunityFeedCommentDto[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

const cursorSchema = z
  .object({
    v: z.literal(1),
    organizationId: z.string().uuid(),
    actorId: z.string().uuid(),
    mode: z.enum(COMMUNITY_FEED_MODES),
    asOf: z.string().datetime({ offset: true }),
    personalizationRevision: z.string().regex(/^[a-f0-9]{64}$/),
    rank: z.number().int().min(0).max(100_000),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

type FeedCursor = z.infer<typeof cursorSchema>;
const CURSOR_MAX_AGE_MS = 24 * 60 * 60_000;

const commentCursorSchema = z
  .object({
    v: z.literal(1),
    organizationId: z.string().uuid(),
    actorId: z.string().uuid(),
    postId: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

function cursorSignature(body: string) {
  return createHmac("sha256", getSessionSecret())
    .update("q-academy:community-feed-cursor:v1\0")
    .update(body)
    .digest();
}

function commentCursorSignature(body: string) {
  return createHmac("sha256", getSessionSecret())
    .update("q-academy:community-comment-cursor:v1\0")
    .update(body)
    .digest();
}

function encodeCommentCursor(cursor: z.infer<typeof commentCursorSchema>) {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  return `${body}.${commentCursorSignature(body).toString("base64url")}`;
}

function decodeCommentCursor(input: {
  value: string;
  actor: CommunityPolicyActor;
  postId: string;
  parentId: string | null;
}) {
  if (input.value.length > 2_048) {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Cursor ist ungueltig.",
    );
  }
  const [body, signature, extra] = input.value.split(".");
  if (!body || !signature || extra) {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Cursor ist ungueltig.",
    );
  }
  const expected = commentCursorSignature(body);
  const supplied = Buffer.from(signature, "base64url");
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Cursor ist ungueltig.",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Cursor ist ungueltig.",
    );
  }
  const parsed = commentCursorSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.organizationId !== input.actor.organizationId ||
    parsed.data.actorId !== input.actor.id ||
    parsed.data.postId !== input.postId ||
    parsed.data.parentId !== input.parentId
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Cursor passt nicht zur Anfrage.",
    );
  }
  return {
    ...parsed.data,
    createdAtDate: new Date(parsed.data.createdAt),
  };
}

function encodeCursor(cursor: FeedCursor) {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  return `${body}.${cursorSignature(body).toString("base64url")}`;
}

function decodeCursor(input: {
  value: string;
  actor: CommunityPolicyActor;
  mode: CommunityFeedMode;
  referenceTime: Date;
}) {
  if (input.value.length > 2_048) {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  const [body, signature, extra] = input.value.split(".");
  if (!body || !signature || extra) {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  let supplied: Buffer;
  try {
    supplied = Buffer.from(signature, "base64url");
  } catch {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  const expected = cursorSignature(body);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  const parsed = cursorSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(422, "validation_error", "Feed-Cursor ist ungueltig.");
  }
  const asOf = new Date(parsed.data.asOf);
  if (
    parsed.data.organizationId !== input.actor.organizationId ||
    parsed.data.actorId !== input.actor.id ||
    parsed.data.mode !== input.mode ||
    asOf.getTime() > input.referenceTime.getTime() + 60_000 ||
    input.referenceTime.getTime() - asOf.getTime() > CURSOR_MAX_AGE_MS
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Feed-Cursor passt nicht zu diesem Feed oder ist abgelaufen.",
    );
  }
  return {
    ...parsed.data,
    asOfDate: asOf,
    createdAtDate: new Date(parsed.data.createdAt),
  };
}

async function currentFeedActor(actor: CommunityPolicyActor) {
  const [current] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!current) {
    throw new ApiError(403, "forbidden", "Community-Akteur ist nicht aktiv.");
  }
  return current;
}

async function assertFeedActorUnchanged(actor: CommunityPolicyActor) {
  const [current] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
        eq(users.role, actor.role),
      ),
    )
    .limit(1);
  if (!current) {
    throw new ApiError(
      403,
      "forbidden",
      "Community-Akteur oder Berechtigung hat sich geaendert.",
    );
  }
}

function currentActorSql(actor: CommunityPolicyActor) {
  return sql<boolean>`exists (
    select 1 from users current_feed_actor
    where current_feed_actor.id = ${actor.id}
      and current_feed_actor.organization_id = ${actor.organizationId}
      and current_feed_actor.status = 'active'
      and current_feed_actor.role = ${actor.role}
  )`;
}

async function consumeCommunityReadRateLimit(
  actor: CommunityPolicyActor,
  kind: "feed" | "comment",
) {
  const action =
    kind === "feed" ? "community_feed_read" : "community_comment_read";
  const tenantAction =
    kind === "feed"
      ? "community_feed_read_tenant"
      : "community_comment_read_tenant";
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [{ action: tenantAction, identifier: actor.organizationId }],
    primary: {
      action,
      identifier: `${actor.organizationId}\0${actor.id}`,
    },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Zu viele Community-Leseanfragen. Bitte versuche es spaeter erneut.",
      { limit: rateLimit.limit, resetAt: rateLimit.resetAt.toISOString() },
    );
  }
}

function followExpressions(actor: CommunityPolicyActor, asOf: Date) {
  const followedAuthor = exists(
    db
      .select({ id: communityFollows.id })
      .from(communityFollows)
      .where(
        and(
          eq(communityFollows.organizationId, posts.organizationId),
          eq(communityFollows.followerId, actor.id),
          eq(communityFollows.targetType, "author"),
          eq(communityFollows.targetAuthorId, posts.authorId),
          lte(communityFollows.createdAt, asOf),
        ),
      ),
  ).mapWith(Boolean);
  const followedSpace = exists(
    db
      .select({ id: communityFollows.id })
      .from(communityFollows)
      .where(
        and(
          eq(communityFollows.organizationId, posts.organizationId),
          eq(communityFollows.followerId, actor.id),
          eq(communityFollows.targetType, "space"),
          eq(communityFollows.targetSpaceId, posts.spaceId),
          lte(communityFollows.createdAt, asOf),
        ),
      ),
  ).mapWith(Boolean);
  return { followedAuthor, followedSpace };
}

function rankExpressions(input: { actor: CommunityPolicyActor; asOf: Date }) {
  const asOfIso = input.asOf.toISOString();
  const recency6Hours = new Date(
    input.asOf.getTime() - 6 * 60 * 60_000,
  ).toISOString();
  const recency24Hours = new Date(
    input.asOf.getTime() - 24 * 60 * 60_000,
  ).toISOString();
  const recency3Days = new Date(
    input.asOf.getTime() - 3 * 24 * 60 * 60_000,
  ).toISOString();
  const recency7Days = new Date(
    input.asOf.getTime() - 7 * 24 * 60 * 60_000,
  ).toISOString();
  const { followedAuthor, followedSpace } = followExpressions(
    input.actor,
    input.asOf,
  );
  const activeBoost = sql<boolean>`exists (
    select 1 from community_author_boosts cab
    where cab.organization_id = ${posts.organizationId}
      and cab.author_id = ${posts.authorId}
      and cab.created_at <= ${asOfIso}::timestamptz
      and cab.starts_at <= ${asOfIso}::timestamptz
      and cab.ends_at > ${asOfIso}::timestamptz
  )`.mapWith(Boolean);
  const boostScore = sql<number>`coalesce((
    select case cab.strength
      when 'light' then 70
      when 'medium' then 140
      when 'high' then 240
      else 0
    end
    from community_author_boosts cab
    where cab.organization_id = ${posts.organizationId}
      and cab.author_id = ${posts.authorId}
      and cab.created_at <= ${asOfIso}::timestamptz
      and cab.starts_at <= ${asOfIso}::timestamptz
      and cab.ends_at > ${asOfIso}::timestamptz
    limit 1
  ), 0)`.mapWith(Number);
  const foreignInteractions = sql<number>`(
    select count(*)::int from (
      select pl.user_id
      from post_likes pl
      join users iu on iu.id = pl.user_id
        and iu.organization_id = pl.organization_id
        and iu.status = 'active'
      where pl.organization_id = ${posts.organizationId}
        and pl.post_id = ${posts.id}
        and pl.user_id <> ${posts.authorId}
        and pl.created_at <= ${asOfIso}::timestamptz
      union
      select pv.user_id
      from post_votes pv
      join users iu on iu.id = pv.user_id
        and iu.organization_id = pv.organization_id
        and iu.status = 'active'
      where pv.organization_id = ${posts.organizationId}
        and pv.post_id = ${posts.id}
        and pv.user_id <> ${posts.authorId}
        and pv.created_at <= ${asOfIso}::timestamptz
      union
      select c.author_id
      from comments c
      join users iu on iu.id = c.author_id
        and iu.organization_id = c.organization_id
        and iu.status = 'active'
      where c.organization_id = ${posts.organizationId}
        and c.post_id = ${posts.id}
        and c.moderation_state = 'published'
        and c.author_id <> ${posts.authorId}
        and c.created_at <= ${asOfIso}::timestamptz
    ) foreign_interactors
  )`.mapWith(Number);
  const recencyScore = sql<number>`case
    when ${posts.createdAt} > ${recency6Hours}::timestamptz then 120
    when ${posts.createdAt} > ${recency24Hours}::timestamptz then 80
    when ${posts.createdAt} > ${recency3Days}::timestamptz then 45
    when ${posts.createdAt} > ${recency7Days}::timestamptz then 20
    else 0 end`.mapWith(Number);
  return {
    followedAuthor,
    followedSpace,
    activeBoost,
    boostScore,
    foreignInteractions,
    recencyScore,
  };
}

function eligibleCandidateIds(input: {
  actor: CommunityPolicyActor;
  asOf: Date;
  condition?: SQL;
  limit: number;
}) {
  return db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(
      users,
      and(
        eq(users.id, posts.authorId),
        eq(users.organizationId, posts.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      communitySpaces,
      and(
        eq(communitySpaces.id, posts.spaceId),
        eq(communitySpaces.organizationId, posts.organizationId),
      ),
    )
    .where(
      and(
        eq(posts.organizationId, input.actor.organizationId),
        eq(posts.moderationState, "published"),
        lte(posts.createdAt, input.asOf),
        communitySpaceVisibilitySql(input.actor),
        currentActorSql(input.actor),
        input.condition,
      ),
    )
    .orderBy(
      sql`${posts.createdAt} desc nulls last`,
      sql`${posts.id} desc nulls last`,
    )
    .limit(input.limit);
}

function candidateCondition(input: {
  actor: CommunityPolicyActor;
  mode: CommunityFeedMode;
  asOf: Date;
  followedTarget: SQL;
  boostedTarget: SQL;
}) {
  if (input.mode === "latest") return sql<boolean>`true`;
  if (input.mode === "following") return input.followedTarget;

  const recent = eligibleCandidateIds({
    actor: input.actor,
    asOf: input.asOf,
    limit: 750,
  });
  const followed = eligibleCandidateIds({
    actor: input.actor,
    asOf: input.asOf,
    condition: input.followedTarget,
    limit: 750,
  });
  const pinned = eligibleCandidateIds({
    actor: input.actor,
    asOf: input.asOf,
    condition: eq(posts.pinned, true),
    limit: 250,
  });
  const boosted = eligibleCandidateIds({
    actor: input.actor,
    asOf: input.asOf,
    condition: input.boostedTarget,
    limit: 250,
  });
  return or(
    inArray(posts.id, recent),
    inArray(posts.id, followed),
    inArray(posts.id, pinned),
    inArray(posts.id, boosted),
  )!;
}

function keysetCondition(input: {
  rank: SQLWrapper;
  createdAt: SQLWrapper;
  id: SQLWrapper;
  cursor: ReturnType<typeof decodeCursor>;
}) {
  return or(
    lt(input.rank, input.cursor.rank),
    and(
      eq(input.rank, input.cursor.rank),
      lt(input.createdAt, input.cursor.createdAtDate),
    ),
    and(
      eq(input.rank, input.cursor.rank),
      eq(input.createdAt, input.cursor.createdAtDate),
      lt(input.id, input.cursor.id),
    ),
  )!;
}

function diversify<T extends { authorId: string; id: string }>(rows: T[]) {
  const remaining = [...rows];
  const result: T[] = [];
  while (remaining.length) {
    const recentAuthors = result.slice(-2).map((row) => row.authorId);
    const diverseIndex = remaining.findIndex(
      (row) => !recentAuthors.includes(row.authorId),
    );
    result.push(remaining.splice(diverseIndex >= 0 ? diverseIndex : 0, 1)[0]!);
  }
  return result;
}

function reasonCodes(
  row: {
    pinned: boolean;
    followedAuthor: boolean;
    followedSpace: boolean;
    activeBoost: boolean;
    foreignInteractions: number;
    createdAt: Date;
  },
  asOf: Date,
) {
  const reasons: CommunityFeedReasonCode[] = [];
  if (row.pinned) reasons.push("pinned");
  if (row.followedAuthor) reasons.push("followed_author");
  if (row.followedSpace) reasons.push("followed_space");
  if (row.activeBoost) reasons.push("boosted");
  if (row.foreignInteractions >= 3) reasons.push("trending");
  if (row.createdAt.getTime() > asOf.getTime() - 24 * 60 * 60_000) {
    reasons.push("recent");
  }
  return reasons.slice(0, 3);
}

async function personalizationRevision(input: { actor: CommunityPolicyActor }) {
  const [row] = await db
    .select({ revision: communityFeedRevisions.revision })
    .from(communityFeedRevisions)
    .where(
      eq(communityFeedRevisions.organizationId, input.actor.organizationId),
    )
    .limit(1);
  return createHash("sha256")
    .update(
      `community-feed:v1:${input.actor.organizationId}:${row?.revision ?? 0}`,
    )
    .digest("hex");
}

type CommentReactionSummary = Readonly<{
  reactionCount: number;
  likeReactionCount: number;
  celebrateReactionCount: number;
  insightfulReactionCount: number;
  questionReactionCount: number;
  myReaction: CommunityReactionType | null;
}>;

const emptyCommentReactionSummary = (): CommentReactionSummary => ({
  reactionCount: 0,
  likeReactionCount: 0,
  celebrateReactionCount: 0,
  insightfulReactionCount: 0,
  questionReactionCount: 0,
  myReaction: null,
});

async function commentReactionSummaries(input: {
  organizationId: string;
  actorId: string;
  commentIds: string[];
}) {
  const result = new Map<string, CommentReactionSummary>();
  if (!input.commentIds.length) return result;
  const rows = await db
    .select({
      commentId: commentReactions.commentId,
      reaction: commentReactions.reaction,
      value: count(),
      selected:
        sql<boolean>`bool_or(${commentReactions.userId} = ${input.actorId})`.mapWith(
          Boolean,
        ),
    })
    .from(commentReactions)
    .where(
      and(
        eq(commentReactions.organizationId, input.organizationId),
        inArray(commentReactions.commentId, input.commentIds),
      ),
    )
    .groupBy(commentReactions.commentId, commentReactions.reaction);
  for (const row of rows) {
    const current = result.get(row.commentId) ?? emptyCommentReactionSummary();
    const value = Number(row.value);
    result.set(row.commentId, {
      ...current,
      reactionCount: current.reactionCount + value,
      likeReactionCount:
        current.likeReactionCount + (row.reaction === "like" ? value : 0),
      celebrateReactionCount:
        current.celebrateReactionCount +
        (row.reaction === "celebrate" ? value : 0),
      insightfulReactionCount:
        current.insightfulReactionCount +
        (row.reaction === "insightful" ? value : 0),
      questionReactionCount:
        current.questionReactionCount +
        (row.reaction === "question" ? value : 0),
      myReaction: row.selected ? row.reaction : current.myReaction,
    });
  }
  return result;
}

async function commentPreviews(input: {
  actor: CommunityPolicyActor;
  organizationId: string;
  postIds: string[];
  downloadContext: "session" | "api";
}) {
  const result = new Map<string, CommunityFeedCommentDto[]>();
  if (!input.postIds.length) return result;
  const topRanked = db
    .select({
      id: comments.id,
      moderationVersion: comments.moderationVersion,
      postId: comments.postId,
      authorId: comments.authorId,
      parentId: comments.parentId,
      content: comments.content,
      contentFormat: comments.contentFormat,
      richText: comments.richText,
      contentProjectionVersion: comments.contentProjectionVersion,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      firstName: users.firstName,
      lastName: users.lastName,
      reported: sql<boolean>`exists (
        select 1 from community_reports cr
        where cr.organization_id = ${comments.organizationId}
          and cr.reporter_id = ${input.actor.id}
          and cr.target_type = 'comment'
          and cr.target_id = ${comments.id}
      )`
        .mapWith(Boolean)
        .as("reported"),
      previewRank:
        sql<number>`row_number() over (partition by ${comments.postId} order by ${comments.createdAt} desc, ${comments.id} desc)`.as(
          "preview_rank",
        ),
    })
    .from(comments)
    .innerJoin(
      users,
      and(
        eq(users.id, comments.authorId),
        eq(users.organizationId, comments.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        inArray(comments.postId, input.postIds),
        eq(comments.moderationState, "published"),
        isNull(comments.parentId),
      ),
    )
    .as("community_top_comment_previews");
  const topRows = await db
    .select()
    .from(topRanked)
    .where(lte(topRanked.previewRank, 3))
    .orderBy(
      asc(topRanked.postId),
      desc(topRanked.createdAt),
      desc(topRanked.id),
    );

  const parentIds = topRows.map((row) => row.id);
  const replyRows = parentIds.length
    ? await (async () => {
        const replyRanked = db
          .select({
            id: comments.id,
            moderationVersion: comments.moderationVersion,
            postId: comments.postId,
            authorId: comments.authorId,
            parentId: comments.parentId,
            content: comments.content,
            contentFormat: comments.contentFormat,
            richText: comments.richText,
            contentProjectionVersion: comments.contentProjectionVersion,
            createdAt: comments.createdAt,
            updatedAt: comments.updatedAt,
            firstName: users.firstName,
            lastName: users.lastName,
            reported: sql<boolean>`exists (
              select 1 from community_reports cr
              where cr.organization_id = ${comments.organizationId}
                and cr.reporter_id = ${input.actor.id}
                and cr.target_type = 'comment'
                and cr.target_id = ${comments.id}
            )`
              .mapWith(Boolean)
              .as("reported"),
            previewRank:
              sql<number>`row_number() over (partition by ${comments.parentId} order by ${comments.createdAt} asc, ${comments.id} asc)`.as(
                "preview_rank",
              ),
          })
          .from(comments)
          .innerJoin(
            users,
            and(
              eq(users.id, comments.authorId),
              eq(users.organizationId, comments.organizationId),
              eq(users.status, "active"),
            ),
          )
          .where(
            and(
              eq(comments.organizationId, input.organizationId),
              inArray(comments.parentId, parentIds),
              eq(comments.moderationState, "published"),
            ),
          )
          .as("community_reply_previews");
        return db
          .select()
          .from(replyRanked)
          .where(lte(replyRanked.previewRank, 2))
          .orderBy(
            asc(replyRanked.parentId),
            asc(replyRanked.createdAt),
            asc(replyRanked.id),
          );
      })()
    : [];

  const replyCountRows = parentIds.length
    ? await db
        .select({ parentId: comments.parentId, value: count() })
        .from(comments)
        .where(
          and(
            eq(comments.organizationId, input.organizationId),
            inArray(comments.parentId, parentIds),
            eq(comments.moderationState, "published"),
          ),
        )
        .groupBy(comments.parentId)
    : [];
  const replyCounts = new Map(
    replyCountRows.flatMap((row) =>
      row.parentId ? [[row.parentId, Number(row.value)] as const] : [],
    ),
  );
  const loadedCommentIds = [
    ...topRows.map((row) => row.id),
    ...replyRows.map((row) => row.id),
  ];
  const [attachments, reactionSummaries, profilesByUser] = await Promise.all([
    communityAttachmentsForComments({
      organizationId: input.organizationId,
      commentIds: loadedCommentIds,
      downloadContext: input.downloadContext,
    }),
    commentReactionSummaries({
      organizationId: input.organizationId,
      actorId: input.actor.id,
      commentIds: loadedCommentIds,
    }),
    getCommunityPublicProfiles({
      organizationId: input.organizationId,
      memberIds: [...topRows, ...replyRows].map((row) => row.authorId),
      downloadContext: input.downloadContext,
    }),
  ]);
  const present = (
    row: (typeof topRows)[number] | (typeof replyRows)[number],
    replies: CommunityFeedCommentDto[] = [],
    replyCount = 0,
  ): CommunityFeedCommentDto => ({
    id: row.id,
    moderationVersion: row.moderationVersion,
    authorId: row.authorId,
    parentId: row.parentId,
    content: row.content,
    contentFormat: row.contentFormat,
    richText: row.richText,
    contentProjectionVersion: row.contentProjectionVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    firstName: row.firstName,
    lastName: row.lastName,
    authorAvatarUrl: profilesByUser.get(row.authorId)?.avatarUrl ?? null,
    badges: profilesByUser.get(row.authorId)?.badges ?? [],
    reported: Boolean(row.reported),
    replyCount,
    ...(reactionSummaries.get(row.id) ?? emptyCommentReactionSummary()),
    attachments: attachments.get(row.id) ?? [],
    replies,
  });
  const repliesByParent = new Map<string, CommunityFeedCommentDto[]>();
  for (const row of replyRows) {
    if (!row.parentId) continue;
    const values = repliesByParent.get(row.parentId) ?? [];
    values.push(present(row));
    repliesByParent.set(row.parentId, values);
  }
  for (const row of topRows) {
    const values = result.get(row.postId) ?? [];
    values.push(
      present(
        row,
        repliesByParent.get(row.id) ?? [],
        replyCounts.get(row.id) ?? 0,
      ),
    );
    result.set(row.postId, values);
  }
  return result;
}

export async function getExplainableCommunityFeed(input: {
  actor: CommunityPolicyActor;
  mode?: CommunityFeedMode;
  limit?: number;
  cursor?: string | null;
  referenceTime?: Date;
  downloadContext?: "session" | "api";
}): Promise<CommunityFeedPageDto> {
  const actor = await currentFeedActor(input.actor);
  await consumeCommunityReadRateLimit(actor, "feed");
  const mode = input.mode ?? "for_you";
  const limit = input.limit ?? 20;
  if (
    !COMMUNITY_FEED_MODES.includes(mode) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Feed-Modus oder Limit ist ungueltig.",
    );
  }
  const referenceTime = input.referenceTime ?? new Date();
  const cursor = input.cursor
    ? decodeCursor({ value: input.cursor, actor, mode, referenceTime })
    : null;
  const asOf = cursor?.asOfDate ?? referenceTime;
  const revision = await personalizationRevision({ actor });
  if (cursor && cursor.personalizationRevision !== revision) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Feed hat sich geaendert. Bitte laden Sie ihn neu.",
    );
  }
  const ranking = rankExpressions({ actor, asOf });
  const followedTarget = or(ranking.followedAuthor, ranking.followedSpace)!;
  const conditions: SQL[] = [
    eq(posts.organizationId, actor.organizationId),
    eq(posts.moderationState, "published"),
    lte(posts.createdAt, asOf),
    communitySpaceVisibilitySql(actor),
    currentActorSql(actor),
    candidateCondition({
      actor,
      mode,
      asOf,
      followedTarget,
      boostedTarget: ranking.activeBoost,
    }),
  ];
  const zeroRank = sql<number>`cast(0 as integer)`.mapWith(Number);
  const rawCandidates =
    mode === "latest"
      ? await (async () => {
          const latestConditions = [...conditions];
          if (cursor) {
            latestConditions.push(
              keysetCondition({
                rank: zeroRank,
                createdAt: posts.createdAt,
                id: posts.id,
                cursor,
              }),
            );
          }
          return db
            .select({
              id: posts.id,
              authorId: posts.authorId,
              createdAt: posts.createdAt,
              rank: zeroRank,
            })
            .from(posts)
            .innerJoin(
              users,
              and(
                eq(users.id, posts.authorId),
                eq(users.organizationId, posts.organizationId),
                eq(users.status, "active"),
              ),
            )
            .innerJoin(
              communitySpaces,
              and(
                eq(communitySpaces.id, posts.spaceId),
                eq(communitySpaces.organizationId, posts.organizationId),
              ),
            )
            .where(and(...latestConditions))
            .orderBy(
              sql`${posts.createdAt} desc nulls last`,
              sql`${posts.id} desc nulls last`,
            )
            .limit(limit + 1);
        })()
      : await (async () => {
          const signalCandidates = db
            .select({
              id: posts.id,
              authorId: posts.authorId,
              createdAt: posts.createdAt,
              pinned: posts.pinned,
              followedAuthor: ranking.followedAuthor.as("followed_author"),
              followedSpace: ranking.followedSpace.as("followed_space"),
              activeBoost: ranking.activeBoost.as("active_boost"),
              boostScore: ranking.boostScore.as("boost_score"),
              foreignInteractions: ranking.foreignInteractions.as(
                "foreign_interactions",
              ),
              recencyScore: ranking.recencyScore.as("recency_score"),
            })
            .from(posts)
            .innerJoin(
              users,
              and(
                eq(users.id, posts.authorId),
                eq(users.organizationId, posts.organizationId),
                eq(users.status, "active"),
              ),
            )
            .innerJoin(
              communitySpaces,
              and(
                eq(communitySpaces.id, posts.spaceId),
                eq(communitySpaces.organizationId, posts.organizationId),
              ),
            )
            .where(and(...conditions))
            .offset(0)
            .as("community_feed_signal_candidates");
          const computedRank = sql<number>`(
          case when ${signalCandidates.pinned} then 600 else 0 end
          + case when ${signalCandidates.followedAuthor} then 210 else 0 end
          + case when ${signalCandidates.followedSpace} then 150 else 0 end
          + ${signalCandidates.boostScore}
          + least(${signalCandidates.foreignInteractions}, 25) * 12
          + ${signalCandidates.recencyScore}
        )`.mapWith(Number);
          const rankedCandidates = db
            .select({
              id: signalCandidates.id,
              authorId: signalCandidates.authorId,
              createdAt: signalCandidates.createdAt,
              rank: computedRank.as("feed_rank"),
            })
            .from(signalCandidates)
            .offset(0)
            .as("community_feed_ranked_candidates");
          const rankedConditions: SQL[] = [];
          if (cursor) {
            rankedConditions.push(
              keysetCondition({
                rank: rankedCandidates.rank,
                createdAt: rankedCandidates.createdAt,
                id: rankedCandidates.id,
                cursor,
              }),
            );
          }
          return db
            .select()
            .from(rankedCandidates)
            .where(
              rankedConditions.length ? and(...rankedConditions) : undefined,
            )
            .orderBy(
              sql`${rankedCandidates.rank} desc nulls last`,
              sql`${rankedCandidates.createdAt} desc nulls last`,
              sql`${rankedCandidates.id} desc nulls last`,
            )
            .limit(limit + 1);
        })();
  const hasMore = rawCandidates.length > limit;
  const rawPage = rawCandidates.slice(0, limit);
  const pageCandidates = diversify(rawPage);
  const postIds = pageCandidates.map((row) => row.id);

  const detailRows = await db
    .select({
      id: posts.id,
      moderationVersion: posts.moderationVersion,
      title: posts.title,
      content: posts.content,
      contentFormat: posts.contentFormat,
      richText: posts.richText,
      contentProjectionVersion: posts.contentProjectionVersion,
      imageUrl: posts.imageUrl,
      pinned: posts.pinned,
      locked: posts.locked,
      linkedCourseId: posts.linkedCourseId,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      authorId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      spaceId: communitySpaces.id,
      spaceTitle: communitySpaces.title,
      spaceColor: communitySpaces.color,
      spaceType: communitySpaces.type,
      likeCount:
        sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${actor.organizationId} and pl.post_id = ${posts.id})`.mapWith(
          Number,
        ),
      likeReactionCount:
        sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${actor.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'like')`.mapWith(
          Number,
        ),
      celebrateReactionCount:
        sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${actor.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'celebrate')`.mapWith(
          Number,
        ),
      insightfulReactionCount:
        sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${actor.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'insightful')`.mapWith(
          Number,
        ),
      questionReactionCount:
        sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${actor.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'question')`.mapWith(
          Number,
        ),
      commentCount:
        sql<number>`(select count(*) from comments c where c.organization_id = ${actor.organizationId} and c.post_id = ${posts.id} and c.moderation_state = 'published')`.mapWith(
          Number,
        ),
      myReaction: sql<CommunityReactionType | null>`(
        select pl.reaction from post_likes pl
        where pl.organization_id = ${actor.organizationId}
          and pl.post_id = ${posts.id}
          and pl.user_id = ${actor.id}
        limit 1
      )`,
      voteScore:
        sql<number>`coalesce((select sum(pv.value) from post_votes pv where pv.organization_id = ${actor.organizationId} and pv.post_id = ${posts.id}), 0)`.mapWith(
          Number,
        ),
      myVote:
        sql<number>`coalesce((select pv.value from post_votes pv where pv.organization_id = ${actor.organizationId} and pv.post_id = ${posts.id} and pv.user_id = ${actor.id}), 0)`.mapWith(
          Number,
        ),
      reported: sql<boolean>`exists (
        select 1 from community_reports cr
        where cr.organization_id = ${actor.organizationId}
          and cr.reporter_id = ${actor.id}
          and cr.target_type = 'post'
          and cr.target_id = ${posts.id}
      )`.mapWith(Boolean),
      followedAuthor: ranking.followedAuthor,
      followedSpace: ranking.followedSpace,
      activeBoost: ranking.activeBoost,
      foreignInteractions: ranking.foreignInteractions,
    })
    .from(posts)
    .innerJoin(
      users,
      and(
        eq(users.id, posts.authorId),
        eq(users.organizationId, posts.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      communitySpaces,
      and(
        eq(communitySpaces.id, posts.spaceId),
        eq(communitySpaces.organizationId, posts.organizationId),
      ),
    )
    .where(
      and(
        eq(posts.organizationId, actor.organizationId),
        eq(posts.moderationState, "published"),
        inArray(posts.id, postIds),
        lte(posts.createdAt, asOf),
        communitySpaceVisibilitySql(actor),
        currentActorSql(actor),
      ),
    )
    .limit(limit);
  const detailById = new Map(detailRows.map((row) => [row.id, row]));
  const pageRows = pageCandidates.map((candidate) => {
    const detail = detailById.get(candidate.id);
    if (!detail) {
      throw new ApiError(
        409,
        "conflict",
        "Der Feed hat sich geaendert. Bitte laden Sie ihn neu.",
      );
    }
    return { ...detail, rank: candidate.rank };
  });
  const downloadContext = input.downloadContext ?? "session";
  const [attachments, previews, profilesByUser, courseLinks] = await Promise.all([
    communityAttachmentsForPosts({
      organizationId: actor.organizationId,
      postIds,
      downloadContext,
    }),
    commentPreviews({
      actor,
      organizationId: actor.organizationId,
      postIds,
      downloadContext,
    }),
    getCommunityPublicProfiles({
      organizationId: actor.organizationId,
      memberIds: pageRows.map((row) => row.authorId),
      downloadContext,
    }),
    communityCourseLinksForPosts(actor, pageRows),
  ]);
  const items = pageRows.map((row): CommunityFeedPostDto => ({
    id: row.id,
    moderationVersion: row.moderationVersion,
    title: row.title,
    content: row.content,
    contentFormat: row.contentFormat,
    richText: row.richText,
    contentProjectionVersion: row.contentProjectionVersion,
    imageUrl: row.imageUrl,
    pinned: row.pinned,
    locked: row.locked,
    courseLink: courseLinks.get(row.id) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    authorId: row.authorId,
    firstName: row.firstName,
    lastName: row.lastName,
    authorAvatarUrl: profilesByUser.get(row.authorId)?.avatarUrl ?? null,
    badges: profilesByUser.get(row.authorId)?.badges ?? [],
    jobTitle: profilesByUser.get(row.authorId)?.jobTitle ?? null,
    points: profilesByUser.get(row.authorId)?.communityPoints ?? null,
    spaceId: row.spaceId,
    spaceTitle: row.spaceTitle,
    spaceColor: row.spaceColor,
    spaceType: row.spaceType,
    likeCount: row.likeCount,
    likeReactionCount: row.likeReactionCount,
    celebrateReactionCount: row.celebrateReactionCount,
    insightfulReactionCount: row.insightfulReactionCount,
    questionReactionCount: row.questionReactionCount,
    commentCount: row.commentCount,
    myReaction: row.myReaction,
    voteScore: row.voteScore,
    myVote: row.myVote,
    reported: Boolean(row.reported),
    reasonCodes: reasonCodes(row, asOf),
    isFollowingAuthor: Boolean(row.followedAuthor),
    isFollowingSpace: Boolean(row.followedSpace),
    attachments: attachments.get(row.id) ?? [],
    comments: previews.get(row.id) ?? [],
  }));
  const boundary = rawPage.at(-1);
  const finalRevision = await personalizationRevision({ actor });
  if (finalRevision !== revision) {
    throw new ApiError(
      409,
      "conflict",
      "Der Feed hat sich geaendert. Bitte laden Sie ihn neu.",
    );
  }
  await assertFeedActorUnchanged(actor);
  return {
    mode,
    asOf: asOf.toISOString(),
    items,
    hasMore,
    nextCursor:
      hasMore && boundary
        ? encodeCursor({
            v: 1,
            organizationId: actor.organizationId,
            actorId: actor.id,
            mode,
            asOf: asOf.toISOString(),
            personalizationRevision: revision,
            rank: boundary.rank,
            createdAt: boundary.createdAt.toISOString(),
            id: boundary.id,
          })
        : null,
  };
}

export async function getCommunityCommentsPage(input: {
  actor: CommunityPolicyActor;
  postId: string;
  parentId?: string | null;
  limit?: number;
  cursor?: string | null;
  downloadContext?: "session" | "api";
}): Promise<CommunityCommentsPageDto> {
  const actor = await currentFeedActor(input.actor);
  await consumeCommunityReadRateLimit(actor, "comment");
  const parentId = input.parentId ?? null;
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new ApiError(
      422,
      "validation_error",
      "Kommentar-Limit ist ungueltig.",
    );
  }
  const cursor = input.cursor
    ? decodeCommentCursor({
        value: input.cursor,
        actor,
        postId: input.postId,
        parentId,
      })
    : null;
  const [visiblePost] = await db
    .select({ id: posts.id })
    .from(posts)
    .innerJoin(
      users,
      and(
        eq(users.id, posts.authorId),
        eq(users.organizationId, posts.organizationId),
        eq(users.status, "active"),
      ),
    )
    .innerJoin(
      communitySpaces,
      and(
        eq(communitySpaces.id, posts.spaceId),
        eq(communitySpaces.organizationId, posts.organizationId),
      ),
    )
    .where(
      and(
        eq(posts.id, input.postId),
        eq(posts.organizationId, actor.organizationId),
        eq(posts.moderationState, "published"),
        communitySpaceVisibilitySql(actor),
        currentActorSql(actor),
      ),
    )
    .limit(1);
  if (!visiblePost) {
    throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
  }
  if (parentId) {
    const [parent] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.id, parentId),
          eq(comments.organizationId, actor.organizationId),
          eq(comments.postId, input.postId),
          eq(comments.moderationState, "published"),
          isNull(comments.parentId),
        ),
      )
      .limit(1);
    if (!parent) {
      throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
    }
  }
  const pageCondition = cursor
    ? parentId
      ? or(
          gt(comments.createdAt, cursor.createdAtDate),
          and(
            eq(comments.createdAt, cursor.createdAtDate),
            gt(comments.id, cursor.id),
          ),
        )
      : or(
          lt(comments.createdAt, cursor.createdAtDate),
          and(
            eq(comments.createdAt, cursor.createdAtDate),
            lt(comments.id, cursor.id),
          ),
        )
    : undefined;
  const rows = await db
    .select({
      id: comments.id,
      moderationVersion: comments.moderationVersion,
      postId: comments.postId,
      authorId: comments.authorId,
      parentId: comments.parentId,
      content: comments.content,
      contentFormat: comments.contentFormat,
      richText: comments.richText,
      contentProjectionVersion: comments.contentProjectionVersion,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      firstName: users.firstName,
      lastName: users.lastName,
      reported: sql<boolean>`exists (
        select 1 from community_reports cr
        where cr.organization_id = ${comments.organizationId}
          and cr.reporter_id = ${actor.id}
          and cr.target_type = 'comment'
          and cr.target_id = ${comments.id}
      )`.mapWith(Boolean),
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
        eq(users.organizationId, comments.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(comments.organizationId, actor.organizationId),
        eq(comments.postId, input.postId),
        eq(comments.moderationState, "published"),
        eq(posts.moderationState, "published"),
        parentId ? eq(comments.parentId, parentId) : isNull(comments.parentId),
        communitySpaceVisibilitySql(actor),
        currentActorSql(actor),
        sql`exists (
          select 1 from users post_author
          where post_author.id = ${posts.authorId}
            and post_author.organization_id = ${posts.organizationId}
            and post_author.status = 'active'
        )`,
        pageCondition,
      ),
    )
    .orderBy(
      parentId ? asc(comments.createdAt) : desc(comments.createdAt),
      parentId ? asc(comments.id) : desc(comments.id),
    )
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const [attachments, replyCountRows, reactionSummaries, profilesByUser] = await Promise.all([
    communityAttachmentsForComments({
      organizationId: actor.organizationId,
      commentIds: pageRows.map((row) => row.id),
      downloadContext: input.downloadContext ?? "session",
    }),
    !parentId && pageRows.length
      ? db
          .select({ parentId: comments.parentId, value: count() })
          .from(comments)
          .where(
            and(
              eq(comments.organizationId, actor.organizationId),
              eq(comments.postId, input.postId),
              eq(comments.moderationState, "published"),
              inArray(
                comments.parentId,
                pageRows.map((row) => row.id),
              ),
            ),
          )
          .groupBy(comments.parentId)
      : Promise.resolve([]),
    commentReactionSummaries({
      organizationId: actor.organizationId,
      actorId: actor.id,
      commentIds: pageRows.map((row) => row.id),
    }),
    getCommunityPublicProfiles({
      organizationId: actor.organizationId,
      memberIds: pageRows.map((row) => row.authorId),
      downloadContext: input.downloadContext,
    }),
  ]);
  const replyCounts = new Map(
    replyCountRows.flatMap((row) =>
      row.parentId ? [[row.parentId, Number(row.value)] as const] : [],
    ),
  );
  const items = pageRows.map((row): CommunityFeedCommentDto => ({
    id: row.id,
    moderationVersion: row.moderationVersion,
    authorId: row.authorId,
    parentId: row.parentId,
    content: row.content,
    contentFormat: row.contentFormat,
    richText: row.richText,
    contentProjectionVersion: row.contentProjectionVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    firstName: row.firstName,
    lastName: row.lastName,
    authorAvatarUrl: profilesByUser.get(row.authorId)?.avatarUrl ?? null,
    badges: profilesByUser.get(row.authorId)?.badges ?? [],
    reported: row.reported,
    replyCount: replyCounts.get(row.id) ?? 0,
    ...(reactionSummaries.get(row.id) ?? emptyCommentReactionSummary()),
    attachments: attachments.get(row.id) ?? [],
    replies: [],
  }));
  const boundary = pageRows.at(-1);
  await assertFeedActorUnchanged(actor);
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && boundary
        ? encodeCommentCursor({
            v: 1,
            organizationId: actor.organizationId,
            actorId: actor.id,
            postId: input.postId,
            parentId,
            createdAt: boundary.createdAt.toISOString(),
            id: boundary.id,
          })
        : null,
  };
}

export type CommunityOverviewDto = Readonly<{
  spaces: Array<
    typeof communitySpaces.$inferSelect & {
      permissions: Awaited<CommunitySpacePermissions>;
      postCount: number;
      answerCount: number;
    }
  >;
  memberCount: number;
  totalPostCount: number;
  totalAnswerCount: number;
  leaderboard: Array<{
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    communityPoints: number;
    level: CommunityLevelProgressDto["current"];
  }>;
  currentUser: { communityPoints: number };
  levelProgress: CommunityLevelProgressDto;
}>;

export async function getCommunityOverviewData(
  userId: string,
  organizationId: string,
): Promise<CommunityOverviewDto> {
  const actor = await currentFeedActor({
    id: userId,
    organizationId,
    role: "member",
  });
  const permissionSql = communitySpacePermissionSql(actor);
  const postCounts = db
    .select({
      spaceId: posts.spaceId,
      value: count(posts.id).as("post_count"),
    })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, organizationId),
        eq(posts.moderationState, "published"),
      ),
    )
    .groupBy(posts.spaceId)
    .as("community_space_post_counts");
  const answerCounts = db
    .select({
      spaceId: posts.spaceId,
      value: count(comments.id).as("answer_count"),
    })
    .from(comments)
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, comments.organizationId),
      ),
    )
    .where(
      and(
        eq(comments.organizationId, organizationId),
        eq(comments.moderationState, "published"),
        eq(posts.moderationState, "published"),
      ),
    )
    .groupBy(posts.spaceId)
    .as("community_space_answer_counts");
  const [
    spaceRows,
    memberCountRows,
    leaderboardRows,
    currentUserRows,
    levelSettingRows,
    levelRows,
  ] = await Promise.all([
    db
      .select({
        space: communitySpaces,
        postCount: sql<number>`coalesce(${postCounts.value}, 0)`.mapWith(
          Number,
        ),
        answerCount: sql<number>`coalesce(${answerCounts.value}, 0)`.mapWith(
          Number,
        ),
        canView: permissionSql.canView,
        canPost: permissionSql.canPost,
        canComment: permissionSql.canComment,
      })
      .from(communitySpaces)
      .leftJoin(postCounts, eq(postCounts.spaceId, communitySpaces.id))
      .leftJoin(answerCounts, eq(answerCounts.spaceId, communitySpaces.id))
      .where(
        and(
          eq(communitySpaces.organizationId, organizationId),
          communitySpaceVisibilitySql(actor),
          currentActorSql(actor),
        ),
      )
      .orderBy(asc(communitySpaces.title)),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
        ),
      ),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        communityPoints: users.communityPoints,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
        ),
      )
      .orderBy(
        desc(users.communityPoints),
        asc(users.lastName),
        asc(users.firstName),
      )
      .limit(5),
    db
      .select({
        communityPoints: users.communityPoints,
      })
      .from(users)
      .where(
        and(eq(users.id, userId), eq(users.organizationId, organizationId)),
      )
      .limit(1),
    db
      .select({
        enabled: communityLevelSettings.enabled,
      })
      .from(communityLevelSettings)
      .where(eq(communityLevelSettings.organizationId, organizationId))
      .limit(1),
    db
      .select({
        id: communityLevels.id,
        position: communityLevels.position,
        name: communityLevels.name,
        description: communityLevels.description,
        minPoints: communityLevels.minPoints,
        icon: communityLevels.icon,
        color: communityLevels.color,
        active: communityLevels.active,
      })
      .from(communityLevels)
      .where(eq(communityLevels.organizationId, organizationId))
      .orderBy(asc(communityLevels.position), asc(communityLevels.id)),
  ]);
  const currentUser = currentUserRows[0] ?? { communityPoints: 0 };
  const levelConfiguration = {
    enabled: levelSettingRows[0]?.enabled ?? false,
    levels: levelRows,
  };
  const levelProgress = resolveCommunityLevelProgress({
    configuration: levelConfiguration,
    communityPoints: currentUser.communityPoints,
  });
  const leaderboardProfiles = await getCommunityPublicProfiles({
    organizationId,
    memberIds: leaderboardRows.map((row) => row.id),
  });
  await assertFeedActorUnchanged(actor);
  return {
    spaces: spaceRows.map((row) => ({
      ...row.space,
      permissions: {
        canView: row.canView,
        canPost: row.canPost,
        canComment: row.canComment,
        canManage: actor.role === "owner" || actor.role === "admin",
      },
      postCount: row.postCount,
      answerCount: row.answerCount,
    })),
    memberCount: Number(memberCountRows[0]?.value ?? 0),
    totalPostCount: spaceRows.reduce((sum, row) => sum + row.postCount, 0),
    totalAnswerCount: spaceRows.reduce((sum, row) => sum + row.answerCount, 0),
    leaderboard: leaderboardRows.flatMap((row) => {
      const profile = leaderboardProfiles.get(row.id);
      if (!profile || profile.communityPoints === null) return [];
      return [
        {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          avatarUrl: profile.avatarUrl,
          communityPoints: profile.communityPoints,
          level: resolveCommunityLevelProgress({
            configuration: levelConfiguration,
            communityPoints: profile.communityPoints,
          }).current,
        },
      ];
    }),
    currentUser,
    levelProgress,
  };
}
