import "server-only";

import { and, asc, eq, gt, inArray, ne, or } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  commentReactions,
  comments,
  communityFollows,
  communityModerationCases,
  communitySpaces,
  notifications,
  postLikes,
  pointTransactions,
  posts,
  postVotes,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  consumeGuardedPersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import {
  assertCommunityPermission,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { requireCommunityCourseLinkForActor } from "@/lib/community-course-links";
import {
  bindCommunityCommentAttachments,
  bindCommunityPostAttachments,
} from "@/lib/community-attachments";
import {
  canReplyToCommunityPost,
  communitySpaceRequiresTitle,
  type CommunityReactionType,
} from "@/lib/community-domain";
import { syncCommunityMentions } from "@/lib/community-mentions";
import { resolveCommunityRecipientLocales } from "@/lib/community-notification-locales";
import { getCommunityNotificationCopy } from "@/lib/i18n/community-actions";
import {
  communityContentAnalysisText,
  communityModerationAnalysisText,
  communityRichTextLinks,
  normalizeCommunityContent,
  type NormalizedCommunityContent,
} from "@/lib/community-rich-text";
import {
  createCommunityContentWithModeration,
  type CommunityFirstPublishEffect,
  updateCommunityContentWithModeration,
} from "@/lib/community-moderation-lifecycle";
import {
  removeCommentReactionCommunityScore,
  removePostReactionCommunityScore,
  syncCommentReactionCommunityScore,
  syncCommunityCommentFirstPublishScore,
  syncPostReactionCommunityScore,
} from "@/lib/community-score";
import { assertCommunityProfileComplete } from "@/lib/community-public-profile";
import {
  lockCommunityLayoutForTransaction,
  resequenceCommunitySpacesInArea,
} from "@/lib/community-layout";
import { awardPoints, awardPointsBatch } from "@/lib/gamification";
import {
  communityCommentAndPostAuthorsAreActiveSql,
  communityCommentAuthorIsActiveSql,
  communityPostAuthorIsActiveSql,
} from "@/lib/community-content-visibility";
import { assertCommunityManager } from "@/lib/community-management-auth";

type CommunityMutationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const POST_CREATION_REASON = "community.post.created";
const COMMENT_CREATION_REASON = "community.comment.created";
const POST_REVERSAL_REASON = "community.post.created.reversal";
const COMMENT_REVERSAL_REASON = "community.comment.created.reversal";

async function consumeCommunityCreateRateLimit(input: {
  organizationId: string;
  userId: string;
  kind: "post" | "comment";
}) {
  const action =
    input.kind === "post"
      ? ("community_post_create" as const)
      : ("community_comment_create" as const);
  const tenantAction =
    input.kind === "post"
      ? ("community_post_create_tenant" as const)
      : ("community_comment_create_tenant" as const);
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [{ action: tenantAction, identifier: input.organizationId }],
    primary: { action, identifier: input.userId },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      input.kind === "post"
        ? "Zu viele Community-Beitraege. Bitte versuche es spaeter erneut."
        : "Zu viele Community-Antworten. Bitte versuche es spaeter erneut.",
      {
        limit: rateLimit.limit,
        remaining: rateLimit.remaining,
        resetAt: rateLimit.resetAt.toISOString(),
        retryAfterSeconds: retryAfterSeconds(rateLimit.resetAt),
      },
    );
  }
}

async function consumeCommunityEngagementRateLimit(input: {
  organizationId: string;
  userId: string;
  kind: "reaction" | "vote";
}) {
  const action =
    input.kind === "reaction"
      ? ("community_reaction_mutation" as const)
      : ("community_vote_mutation" as const);
  const tenantAction =
    input.kind === "reaction"
      ? ("community_reaction_mutation_tenant" as const)
      : ("community_vote_mutation_tenant" as const);
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [{ action: tenantAction, identifier: input.organizationId }],
    primary: {
      action,
      identifier: `${input.organizationId}\0${input.userId}`,
    },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Zu viele Community-Interaktionen. Bitte versuche es spaeter erneut.",
      {
        limit: rateLimit.limit,
        resetAt: rateLimit.resetAt.toISOString(),
        retryAfterSeconds: retryAfterSeconds(rateLimit.resetAt),
      },
    );
  }
}

async function lockCommunitySpaceForMutation(
  tx: CommunityMutationTransaction,
  organizationId: string,
  spaceId: string,
) {
  const [space] = await tx
    .select({ id: communitySpaces.id })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, spaceId),
        eq(communitySpaces.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("share", { of: communitySpaces });
  if (!space) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }
  return space;
}

async function lockActiveCommunityInteractionUsers(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    memberId: string;
    contentAuthorIds: readonly string[];
    contentLabel: "Beitrag" | "Kommentar";
  },
) {
  const ids = [...new Set([input.memberId, ...input.contentAuthorIds])].sort();
  const rows = await tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        inArray(users.id, ids),
      ),
    )
    .orderBy(asc(users.id))
    .for("share", { of: users });
  const member = rows.find((row) => row.id === input.memberId);
  if (!member || member.status !== "active") {
    throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  }
  if (
    input.contentAuthorIds.some(
      (authorId) =>
        rows.find((row) => row.id === authorId)?.status !== "active",
    )
  ) {
    throw new ApiError(
      404,
      "not_found",
      `${input.contentLabel} nicht gefunden.`,
    );
  }
  return member;
}

async function notifyCommunityPostFollowers(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    postId: string;
    spaceId: string;
    authorId: string;
    authorName: string;
    postTitle: string | null;
  },
) {
  const candidates = await tx
    .select({
      id: users.id,
      role: users.role,
    })
    .from(communityFollows)
    .innerJoin(
      users,
      and(
        eq(users.id, communityFollows.followerId),
        eq(users.organizationId, communityFollows.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(communityFollows.organizationId, input.organizationId),
        eq(communityFollows.notify, true),
        ne(communityFollows.followerId, input.authorId),
        or(
          and(
            eq(communityFollows.targetType, "author"),
            eq(communityFollows.targetAuthorId, input.authorId),
          ),
          and(
            eq(communityFollows.targetType, "space"),
            eq(communityFollows.targetSpaceId, input.spaceId),
          ),
        ),
      ),
    );
  const recipients = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const permittedRecipientIds: string[] = [];
  for (const candidate of recipients.values()) {
    try {
      const access = await resolveCommunitySpacePermissions({
        executor: tx,
        actor: {
          id: candidate.id,
          role: candidate.role,
          organizationId: input.organizationId,
        },
        spaceId: input.spaceId,
      });
      if (access.permissions.canView) permittedRecipientIds.push(candidate.id);
    } catch (error) {
      if (error instanceof ApiError && [403, 404].includes(error.status)) {
        continue;
      }
      throw error;
    }
  }
  if (!permittedRecipientIds.length) return;

  const postTitle = input.postTitle?.trim().slice(0, 160) || null;
  const recipientLocales = await resolveCommunityRecipientLocales(tx, {
    organizationId: input.organizationId,
    userIds: permittedRecipientIds,
  });
  await tx.insert(notifications).values(
    permittedRecipientIds.map((userId) => {
      const locale = recipientLocales.get(userId);
      if (!locale) {
        throw new Error("Community follower locale is unavailable.");
      }
      const copy = getCommunityNotificationCopy(locale);
      return {
        userId,
        title: copy.followedPostTitle,
        body: copy.followedPostBody(input.authorName, postTitle),
        type: "community" as const,
        category: "community" as const,
        href: `/academy/community?post=${input.postId}#post-${input.postId}`,
      };
    }),
  );
}

export async function applyCommunityFirstPublishEffects(
  tx: CommunityMutationTransaction,
  effect: CommunityFirstPublishEffect,
) {
  if (effect.targetType === "post") {
    const [row] = await tx
      .select({
        post: posts,
        forumType: communitySpaces.type,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
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
          eq(posts.id, effect.targetId),
          eq(posts.organizationId, effect.organizationId),
          eq(posts.spaceId, effect.spaceId),
          eq(posts.authorId, effect.authorId),
          eq(posts.moderationState, "published"),
          eq(posts.moderationVersion, effect.contentVersion),
        ),
      )
      .limit(1);
    if (!row) {
      throw new Error("Published community post side effects lost their source.");
    }
    await tx.insert(activityEvents).values({
      organizationId: effect.organizationId,
      userId: row.post.authorId,
      type: "post.created",
      entityType: "community",
      entityId: row.post.id,
      metadata: {
        forumType: row.forumType,
        title: row.post.title,
        locked: row.post.locked,
      },
    });
    await awardPoints(tx, {
      organizationId: effect.organizationId,
      userId: row.post.authorId,
      amount: 10,
      reason: POST_CREATION_REASON,
      entityType: "post",
      entityId: row.post.id,
    });
    await syncCommunityMentions(tx, {
      organizationId: effect.organizationId,
      postId: row.post.id,
      mentionedById: row.post.authorId,
      mentionedByName: `${row.authorFirstName} ${row.authorLastName}`,
      content: row.post.content,
    });
    await notifyCommunityPostFollowers(tx, {
      organizationId: effect.organizationId,
      postId: row.post.id,
      spaceId: row.post.spaceId,
      authorId: row.post.authorId,
      authorName: `${row.authorFirstName} ${row.authorLastName}`,
      postTitle: row.post.title,
    });
    await enqueueWebhook(
      effect.organizationId,
      "community.post.created",
      row.post,
      tx,
    );
    return;
  }

  const [row] = await tx
    .select({
      comment: comments,
      postAuthorId: posts.authorId,
      spaceId: posts.spaceId,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
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
        eq(users.id, comments.authorId),
        eq(users.organizationId, comments.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(comments.id, effect.targetId),
        eq(comments.organizationId, effect.organizationId),
        eq(comments.authorId, effect.authorId),
        eq(comments.moderationState, "published"),
        eq(comments.moderationVersion, effect.contentVersion),
      ),
    )
    .limit(1);
  if (!row || row.spaceId !== effect.spaceId) {
    throw new Error(
      "Published community comment side effects lost their source.",
    );
  }
  await syncCommunityCommentFirstPublishScore(tx, {
    organizationId: effect.organizationId,
    commentId: row.comment.id,
  });
  await tx.insert(activityEvents).values({
    organizationId: effect.organizationId,
    userId: row.comment.authorId,
    type: "comment.created",
    entityType: "community",
    entityId: row.comment.id,
    metadata: {
      postId: row.comment.postId,
      parentId: row.comment.parentId,
    },
  });
  await awardPoints(tx, {
    organizationId: effect.organizationId,
    userId: row.comment.authorId,
    amount: 4,
    reason: COMMENT_CREATION_REASON,
    entityType: "comment",
    entityId: row.comment.id,
  });
  await syncCommunityMentions(tx, {
    organizationId: effect.organizationId,
    postId: row.comment.postId,
    commentId: row.comment.id,
    mentionedById: row.comment.authorId,
    mentionedByName: `${row.authorFirstName} ${row.authorLastName}`,
    content: row.comment.content,
  });

  let replyRecipientId = row.postAuthorId;
  let threadReply = false;
  if (row.comment.parentId) {
    const [parent] = await tx
      .select({ authorId: comments.authorId })
      .from(comments)
      .where(
        and(
          eq(comments.id, row.comment.parentId),
          eq(comments.postId, row.comment.postId),
          eq(comments.organizationId, effect.organizationId),
          eq(comments.moderationState, "published"),
        ),
      )
      .limit(1);
    if (parent) {
      replyRecipientId = parent.authorId;
      threadReply = true;
    }
  }
  if (replyRecipientId !== row.comment.authorId) {
    const [recipient] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, replyRecipientId),
          eq(users.organizationId, effect.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    const recipientAccess = recipient
      ? await resolveCommunitySpacePermissions({
          executor: tx,
          actor: {
            id: recipient.id,
            organizationId: effect.organizationId,
            role: recipient.role,
          },
          spaceId: row.spaceId,
        })
      : null;
    if (recipientAccess?.permissions.canView) {
      const recipientLocales = await resolveCommunityRecipientLocales(tx, {
        organizationId: effect.organizationId,
        userIds: [replyRecipientId],
      });
      const locale = recipientLocales.get(replyRecipientId);
      if (!locale) {
        throw new Error("Community reply recipient locale is unavailable.");
      }
      const copy = getCommunityNotificationCopy(locale);
      await tx.insert(notifications).values({
        userId: replyRecipientId,
        title: copy.replyTitle(threadReply),
        body: copy.replyBody(
          `${row.authorFirstName} ${row.authorLastName}`,
        ),
        type: "community",
        category: "community",
        href: `/academy/community?post=${row.comment.postId}#post-${row.comment.postId}`,
      });
    }
  }
  await enqueueWebhook(
    effect.organizationId,
    "community.comment.created",
    row.comment,
    tx,
  );
}

export async function createCommunityPostMutation(input: {
  organizationId: string;
  authorId: string;
  spaceId: string;
  courseId?: string | null;
  title?: string | null;
  content?: string | null;
  richText?: unknown;
  attachmentIds?: readonly string[];
  pinned?: boolean;
  locked?: boolean;
  allowModeration?: boolean;
}) {
  const normalizedContent = normalizeCommunityContent(input, "post");
  await consumeCommunityCreateRateLimit({
    organizationId: input.organizationId,
    userId: input.authorId,
    kind: "post",
  });
  return db.transaction(async (tx) => {
    await lockCommunitySpaceForMutation(
      tx,
      input.organizationId,
      input.spaceId,
    );
    const [author] = await tx
      .select({
        id: users.id,
        organizationId: users.organizationId,
        role: users.role,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(
        and(
          eq(users.id, input.authorId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1)
      .for("update", { of: users });
    if (!author) throw new ApiError(404, "not_found", "Autor nicht gefunden.");
    await assertCommunityProfileComplete(tx, {
      organizationId: input.organizationId,
      userId: author.id,
    });
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: author.id,
        organizationId: input.organizationId,
        role: author.role,
      },
      spaceId: input.spaceId,
    });
    assertCommunityPermission(access.permissions, "canPost");
    const space = access.space;
    if (input.courseId) {
      await requireCommunityCourseLinkForActor(tx, author, input.courseId);
    }
    if ((input.pinned || input.locked) && !input.allowModeration) {
      throw new ApiError(
        403,
        "forbidden",
        "Nur Administratoren duerfen Beitraege fixieren oder sperren.",
      );
    }

    const title = input.title?.trim() || null;
    if (communitySpaceRequiresTitle(space.type) && !title) {
      throw new ApiError(
        422,
        "validation_error",
        "Diskussionen und Ankuendigungen benoetigen einen Titel.",
      );
    }
    const locked = space.type === "announcement" ? true : Boolean(input.locked);
    const result = await createCommunityContentWithModeration(tx, {
      organizationId: input.organizationId,
      spaceId: space.id,
      targetType: "post",
      authorId: author.id,
      content: normalizedContent.content,
      analysisContent: communityModerationAnalysisText([
        title,
        communityContentAnalysisText(normalizedContent),
      ]),
      persist: async (moderation) => {
        const [post] = await tx
          .insert(posts)
          .values({
            organizationId: input.organizationId,
            authorId: author.id,
            spaceId: space.id,
            linkedCourseId: input.courseId ?? null,
            title,
            content: normalizedContent.content,
            contentFormat: normalizedContent.contentFormat,
            richText: normalizedContent.richText,
            contentProjectionVersion:
              normalizedContent.contentProjectionVersion,
            pinned: input.pinned ?? false,
            locked,
            ...moderation,
          })
          .returning();
        await bindCommunityPostAttachments({
          tx,
          organizationId: input.organizationId,
          authorId: author.id,
          postId: post.id,
          attachmentIds: input.attachmentIds,
        });
        return post;
      },
      onFirstPublish: (effect) =>
        applyCommunityFirstPublishEffects(tx, effect),
    });
    return result.record;
  });
}

export async function createCommunityCommentMutation(input: {
  organizationId: string;
  authorId: string;
  postId: string;
  parentId?: string | null;
  content?: string | null;
  richText?: unknown;
  attachmentIds?: readonly string[];
}) {
  const normalizedContent = normalizeCommunityContent(input, "comment");
  await consumeCommunityCreateRateLimit({
    organizationId: input.organizationId,
    userId: input.authorId,
    kind: "comment",
  });
  return db.transaction(async (tx) => {
    const [postReference] = await tx
      .select({ spaceId: posts.spaceId })
      .from(posts)
      .where(
        and(
          eq(posts.id, input.postId),
          eq(posts.organizationId, input.organizationId),
          eq(posts.moderationState, "published"),
          communityPostAuthorIsActiveSql(),
        ),
      )
      .limit(1);
    if (!postReference) {
      throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    }
    await lockCommunitySpaceForMutation(
      tx,
      input.organizationId,
      postReference.spaceId,
    );
    const [post] = await tx
      .select({
        id: posts.id,
        authorId: posts.authorId,
        spaceId: posts.spaceId,
        locked: posts.locked,
      })
      .from(posts)
      .where(
        and(
          eq(posts.id, input.postId),
          eq(posts.organizationId, input.organizationId),
          eq(posts.spaceId, postReference.spaceId),
          eq(posts.moderationState, "published"),
          communityPostAuthorIsActiveSql(),
        ),
      )
      .limit(1)
      .for("share", { of: posts });
    if (!post) throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    let parent: { id: string; authorId: string } | null = null;
    if (input.parentId) {
      const [parentRow] = await tx
        .select({
          id: comments.id,
          authorId: comments.authorId,
          parentId: comments.parentId,
        })
        .from(comments)
        .where(
          and(
            eq(comments.id, input.parentId),
            eq(comments.postId, post.id),
            eq(comments.organizationId, input.organizationId),
            eq(comments.moderationState, "published"),
            communityCommentAuthorIsActiveSql(),
          ),
        )
        .limit(1)
        .for("share", { of: comments });
      if (!parentRow || parentRow.parentId) {
        throw new ApiError(
          422,
          "validation_error",
          "Thread-Antworten sind auf genau eine Ebene begrenzt.",
        );
      }
      parent = parentRow;
    }

    const replyRecipientId = parent?.authorId ?? post.authorId;
    const participantIds = [
      ...new Set([input.authorId, replyRecipientId, post.authorId]),
    ].sort();
    const participants = await tx
      .select({
        id: users.id,
        role: users.role,
        status: users.status,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, input.organizationId),
          inArray(users.id, participantIds),
        ),
      )
      .orderBy(asc(users.id))
      .for("update", { of: users });
    const author = participants.find((row) => row.id === input.authorId);
    if (!author || author.status !== "active") {
      throw new ApiError(404, "not_found", "Autor nicht gefunden.");
    }
    if (
      [post.authorId, ...(parent ? [parent.authorId] : [])].some(
        (authorId) =>
          participants.find((row) => row.id === authorId)?.status !== "active",
      )
    ) {
      throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    }
    await assertCommunityProfileComplete(tx, {
      organizationId: input.organizationId,
      userId: author.id,
    });
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: author.id,
        organizationId: input.organizationId,
        role: author.role,
      },
      spaceId: post.spaceId,
    });
    assertCommunityPermission(access.permissions, "canComment");
    if (
      !canReplyToCommunityPost({
        type: access.space.type,
        locked: post.locked,
      })
    ) {
      throw new ApiError(
        403,
        "forbidden",
        "Dieser Beitrag ist fuer Antworten gesperrt.",
      );
    }

    const result = await createCommunityContentWithModeration(tx, {
      organizationId: input.organizationId,
      spaceId: post.spaceId,
      targetType: "comment",
      authorId: author.id,
      content: normalizedContent.content,
      analysisContent: communityContentAnalysisText(normalizedContent),
      persist: async (moderation) => {
        const [comment] = await tx
          .insert(comments)
          .values({
            organizationId: input.organizationId,
            postId: post.id,
            authorId: author.id,
            parentId: parent?.id ?? null,
            content: normalizedContent.content,
            contentFormat: normalizedContent.contentFormat,
            richText: normalizedContent.richText,
            contentProjectionVersion:
              normalizedContent.contentProjectionVersion,
            ...moderation,
          })
          .returning();
        await bindCommunityCommentAttachments({
          tx,
          organizationId: input.organizationId,
          authorId: author.id,
          postId: post.id,
          commentId: comment.id,
          attachmentIds: input.attachmentIds,
        });
        return comment;
      },
      onFirstPublish: (effect) =>
        applyCommunityFirstPublishEffects(tx, effect),
    });
    return result.record;
  });
}

export async function updateCommunityPostMutation(input: {
  organizationId: string;
  actorId: string;
  postId: string;
  expectedContentVersion: number;
  title?: string | null;
  content?: string;
  richText?: unknown;
  pinned?: boolean;
  locked?: boolean;
  allowModeration?: boolean;
}) {
  return db.transaction(async (tx) => {
    const [reference] = await tx
      .select({
        id: posts.id,
        authorId: posts.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        spaceId: posts.spaceId,
        title: posts.title,
        content: posts.content,
        contentFormat: posts.contentFormat,
        richText: posts.richText,
        contentProjectionVersion: posts.contentProjectionVersion,
        pinned: posts.pinned,
        locked: posts.locked,
        moderationVersion: posts.moderationVersion,
      })
      .from(posts)
      .innerJoin(
        users,
        and(
          eq(users.id, posts.authorId),
          eq(users.organizationId, posts.organizationId),
        ),
      )
      .where(
        and(
          eq(posts.id, input.postId),
          eq(posts.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!reference) {
      throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    }
    if (reference.moderationVersion !== input.expectedContentVersion) {
      throw new ApiError(
        409,
        "conflict",
        "Der Beitrag wurde zwischenzeitlich geaendert.",
      );
    }
    await lockCommunitySpaceForMutation(
      tx,
      input.organizationId,
      reference.spaceId,
    );
    const [actor] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!actor) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: actor.id,
        organizationId: input.organizationId,
        role: actor.role,
      },
      spaceId: reference.spaceId,
    });
    assertCommunityPermission(access.permissions, "canPost");
    if (
      (input.pinned !== undefined || input.locked !== undefined) &&
      !input.allowModeration
    ) {
      throw new ApiError(
        403,
        "forbidden",
        "Nur Administratoren duerfen Beitraege fixieren oder sperren.",
      );
    }

    const title =
      input.title === undefined ? reference.title : input.title?.trim() || null;
    const contentChanged =
      input.content !== undefined || input.richText !== undefined;
    const normalizedContent: NormalizedCommunityContent = contentChanged
      ? normalizeCommunityContent(
          { content: input.content, richText: input.richText },
          "post",
        )
      : {
          content: reference.content,
          contentFormat: reference.contentFormat,
          richText: reference.richText,
          contentProjectionVersion: reference.contentProjectionVersion as 1,
          analysisLinks: reference.richText
            ? communityRichTextLinks(reference.richText)
            : [],
        };
    if (communitySpaceRequiresTitle(access.space.type) && !title) {
      throw new ApiError(
        422,
        "validation_error",
        "Diskussionen und Ankuendigungen benoetigen einen Titel.",
      );
    }
    const pinned = input.pinned ?? reference.pinned;
    const locked =
      access.space.type === "announcement"
        ? true
        : (input.locked ?? reference.locked);
    const result = await updateCommunityContentWithModeration(tx, {
      organizationId: input.organizationId,
      targetType: "post",
      targetId: reference.id,
      actorId: actor.id,
      expectedContentVersion: input.expectedContentVersion,
      content: normalizedContent.content,
      analysisContent: communityModerationAnalysisText([
        title,
        communityContentAnalysisText(normalizedContent),
      ]),
      persist: async ({
        content: nextContent,
        moderation,
        preservePublishedAt,
      }) => {
        const { publishedAt, ...moderationFields } = moderation;
        const [updated] = await tx
          .update(posts)
          .set({
            title,
            content: nextContent,
            contentFormat: normalizedContent.contentFormat,
            richText: normalizedContent.richText,
            contentProjectionVersion:
              normalizedContent.contentProjectionVersion,
            pinned,
            locked,
            ...moderationFields,
            ...(preservePublishedAt ? {} : { publishedAt }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(posts.id, reference.id),
              eq(posts.organizationId, input.organizationId),
              eq(posts.moderationVersion, input.expectedContentVersion),
            ),
          )
          .returning();
        if (!updated) {
          throw new ApiError(
            409,
            "conflict",
            "Der Beitrag wurde zwischenzeitlich geaendert.",
          );
        }
        return updated;
      },
      onFirstPublish: (effect) =>
        applyCommunityFirstPublishEffects(tx, effect),
    });
    if (!result.firstPublish) {
      await syncCommunityMentions(tx, {
        organizationId: input.organizationId,
        postId: reference.id,
        mentionedById: reference.authorId,
        mentionedByName: `${reference.authorFirstName} ${reference.authorLastName}`,
        content:
          result.state === "published" ? normalizedContent.content : "",
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: actor.id,
      type: "community_post.updated",
      entityType: "post",
      entityId: reference.id,
      metadata: {
        moderationState: result.state,
        contentVersion: result.contentVersion,
      },
    });
    return result.persisted;
  });
}

export async function updateCommunityCommentMutation(input: {
  organizationId: string;
  actorId: string;
  commentId: string;
  expectedContentVersion: number;
  content?: string | null;
  richText?: unknown;
}) {
  const normalizedContent = normalizeCommunityContent(input, "comment");
  return db.transaction(async (tx) => {
    const [reference] = await tx
      .select({
        id: comments.id,
        authorId: comments.authorId,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        postId: comments.postId,
        spaceId: posts.spaceId,
        moderationVersion: comments.moderationVersion,
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
          eq(users.id, comments.authorId),
          eq(users.organizationId, comments.organizationId),
        ),
      )
      .where(
        and(
          eq(comments.id, input.commentId),
          eq(comments.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!reference) {
      throw new ApiError(404, "not_found", "Antwort nicht gefunden.");
    }
    if (reference.moderationVersion !== input.expectedContentVersion) {
      throw new ApiError(
        409,
        "conflict",
        "Die Antwort wurde zwischenzeitlich geaendert.",
      );
    }
    await lockCommunitySpaceForMutation(
      tx,
      input.organizationId,
      reference.spaceId,
    );
    const [actor] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!actor) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: actor.id,
        organizationId: input.organizationId,
        role: actor.role,
      },
      spaceId: reference.spaceId,
    });
    assertCommunityPermission(access.permissions, "canComment");
    const result = await updateCommunityContentWithModeration(tx, {
      organizationId: input.organizationId,
      targetType: "comment",
      targetId: reference.id,
      actorId: actor.id,
      expectedContentVersion: input.expectedContentVersion,
      content: normalizedContent.content,
      analysisContent: communityContentAnalysisText(normalizedContent),
      persist: async ({ content, moderation, preservePublishedAt }) => {
        const { publishedAt, ...moderationFields } = moderation;
        const [updated] = await tx
          .update(comments)
          .set({
            content,
            contentFormat: normalizedContent.contentFormat,
            richText: normalizedContent.richText,
            contentProjectionVersion:
              normalizedContent.contentProjectionVersion,
            ...moderationFields,
            ...(preservePublishedAt ? {} : { publishedAt }),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(comments.id, reference.id),
              eq(comments.organizationId, input.organizationId),
              eq(comments.moderationVersion, input.expectedContentVersion),
            ),
          )
          .returning();
        if (!updated) {
          throw new ApiError(
            409,
            "conflict",
            "Die Antwort wurde zwischenzeitlich geaendert.",
          );
        }
        return updated;
      },
      onFirstPublish: (effect) =>
        applyCommunityFirstPublishEffects(tx, effect),
    });
    if (!result.firstPublish) {
      await syncCommunityMentions(tx, {
        organizationId: input.organizationId,
        postId: reference.postId,
        commentId: reference.id,
        mentionedById: reference.authorId,
        mentionedByName: `${reference.authorFirstName} ${reference.authorLastName}`,
        content:
          result.state === "published" ? normalizedContent.content : "",
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: actor.id,
      type: "community_comment.updated",
      entityType: "comment",
      entityId: reference.id,
      metadata: {
        moderationState: result.state,
        contentVersion: result.contentVersion,
      },
    });
    return result.persisted;
  });
}

export async function setPostReactionMutation(input: {
  organizationId: string;
  userId: string;
  postId: string;
  reaction: CommunityReactionType | null;
}) {
  await consumeCommunityEngagementRateLimit({ ...input, kind: "reaction" });
  return db.transaction(async (tx) => {
    const [[post], [member]] = await Promise.all([
      tx
        .select({
          id: posts.id,
          spaceId: posts.spaceId,
          authorId: posts.authorId,
        })
        .from(posts)
        .where(
          and(
            eq(posts.id, input.postId),
            eq(posts.organizationId, input.organizationId),
            eq(posts.moderationState, "published"),
            communityPostAuthorIsActiveSql(),
          ),
        )
        .limit(1),
      tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, input.organizationId),
            eq(users.status, "active"),
          ),
        )
        .limit(1),
    ]);
    if (!post) throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    if (!member)
      throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: member.role,
      },
      spaceId: post.spaceId,
      lock: true,
    });
    const [lockedPost] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.id, post.id),
          eq(posts.organizationId, input.organizationId),
          eq(posts.moderationState, "published"),
          communityPostAuthorIsActiveSql(),
        ),
      )
      .limit(1)
      .for("share", { of: posts });
    if (!lockedPost) {
      throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    }
    const lockedMember = await lockActiveCommunityInteractionUsers(tx, {
      organizationId: input.organizationId,
      memberId: member.id,
      contentAuthorIds: [post.authorId],
      contentLabel: "Beitrag",
    });
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: lockedMember.role,
      },
      spaceId: post.spaceId,
    });
    assertCommunityPermission(access.permissions, "canView");

    if (input.reaction) {
      await tx
        .insert(postLikes)
        .values({
          organizationId: input.organizationId,
          postId: post.id,
          userId: member.id,
          reaction: input.reaction,
        })
        .onConflictDoUpdate({
          target: [postLikes.postId, postLikes.userId],
          set: { reaction: input.reaction },
        });
      await syncPostReactionCommunityScore(tx, {
        organizationId: input.organizationId,
        postId: post.id,
        actorId: member.id,
      });
    } else {
      await removePostReactionCommunityScore(tx, {
        organizationId: input.organizationId,
        postId: post.id,
        actorId: member.id,
      });
      await tx
        .delete(postLikes)
        .where(
          and(
            eq(postLikes.organizationId, input.organizationId),
            eq(postLikes.postId, post.id),
            eq(postLikes.userId, member.id),
          ),
        );
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: member.id,
      type: "community_post.reaction_changed",
      entityType: "post",
      entityId: post.id,
      metadata: { reaction: input.reaction },
    });
    return { postId: post.id, userId: member.id, reaction: input.reaction };
  });
}

export async function setCommentReactionMutation(input: {
  organizationId: string;
  userId: string;
  commentId: string;
  reaction: CommunityReactionType | null;
}) {
  await consumeCommunityEngagementRateLimit({ ...input, kind: "reaction" });
  return db.transaction(async (tx) => {
    const [[commentReference], [member]] = await Promise.all([
      tx
        .select({
          id: comments.id,
          postId: comments.postId,
          spaceId: posts.spaceId,
          commentAuthorId: comments.authorId,
          postAuthorId: posts.authorId,
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
            eq(comments.id, input.commentId),
            eq(comments.organizationId, input.organizationId),
            eq(comments.moderationState, "published"),
            eq(posts.moderationState, "published"),
            communityCommentAndPostAuthorsAreActiveSql(),
          ),
        )
        .limit(1),
      tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, input.organizationId),
            eq(users.status, "active"),
          ),
        )
        .limit(1),
    ]);
    if (!commentReference) {
      throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
    }
    if (!member) {
      throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    }
    await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: member.role,
      },
      spaceId: commentReference.spaceId,
      lock: true,
    });
    const [lockedPost] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.id, commentReference.postId),
          eq(posts.organizationId, input.organizationId),
          eq(posts.moderationState, "published"),
          communityPostAuthorIsActiveSql(),
        ),
      )
      .limit(1)
      .for("share", { of: posts });
    if (!lockedPost) {
      throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
    }
    const [comment] = await tx
      .select({ id: comments.id, postId: comments.postId })
      .from(comments)
      .where(
        and(
          eq(comments.id, commentReference.id),
          eq(comments.postId, lockedPost.id),
          eq(comments.organizationId, input.organizationId),
          eq(comments.moderationState, "published"),
          communityCommentAuthorIsActiveSql(),
        ),
      )
      .limit(1)
      .for("share", { of: comments });
    if (!comment) {
      throw new ApiError(404, "not_found", "Kommentar nicht gefunden.");
    }
    const lockedMember = await lockActiveCommunityInteractionUsers(tx, {
      organizationId: input.organizationId,
      memberId: member.id,
      contentAuthorIds: [
        commentReference.postAuthorId,
        commentReference.commentAuthorId,
      ],
      contentLabel: "Kommentar",
    });
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: lockedMember.role,
      },
      spaceId: commentReference.spaceId,
    });
    assertCommunityPermission(access.permissions, "canView");

    if (input.reaction) {
      await tx
        .insert(commentReactions)
        .values({
          organizationId: input.organizationId,
          commentId: comment.id,
          postId: comment.postId,
          userId: member.id,
          reaction: input.reaction,
        })
        .onConflictDoUpdate({
          target: [commentReactions.commentId, commentReactions.userId],
          set: { reaction: input.reaction },
        });
      await syncCommentReactionCommunityScore(tx, {
        organizationId: input.organizationId,
        commentId: comment.id,
        actorId: member.id,
      });
    } else {
      await removeCommentReactionCommunityScore(tx, {
        organizationId: input.organizationId,
        commentId: comment.id,
        actorId: member.id,
      });
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.organizationId, input.organizationId),
            eq(commentReactions.commentId, comment.id),
            eq(commentReactions.userId, member.id),
          ),
        );
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: member.id,
      type: "community_comment.reaction_changed",
      entityType: "comment",
      entityId: comment.id,
      metadata: { reaction: input.reaction },
    });
    return {
      commentId: comment.id,
      userId: member.id,
      reaction: input.reaction,
    };
  });
}

export async function setPostVoteMutation(input: {
  organizationId: string;
  userId: string;
  postId: string;
  value: -1 | 0 | 1;
}) {
  await consumeCommunityEngagementRateLimit({ ...input, kind: "vote" });
  return db.transaction(async (tx) => {
    const [[post], [member]] = await Promise.all([
      tx
        .select({
          id: posts.id,
          spaceId: posts.spaceId,
          forumType: communitySpaces.type,
          authorId: posts.authorId,
        })
        .from(posts)
        .innerJoin(
          communitySpaces,
          and(
            eq(communitySpaces.id, posts.spaceId),
            eq(communitySpaces.organizationId, input.organizationId),
          ),
        )
        .where(
          and(
            eq(posts.id, input.postId),
            eq(posts.organizationId, input.organizationId),
            eq(posts.moderationState, "published"),
            communityPostAuthorIsActiveSql(),
          ),
        )
        .limit(1),
      tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, input.organizationId),
            eq(users.status, "active"),
          ),
        )
        .limit(1),
    ]);
    if (!post) throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    if (!member)
      throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: member.role,
      },
      spaceId: post.spaceId,
      lock: true,
    });
    const [lockedPost] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(
        and(
          eq(posts.id, post.id),
          eq(posts.organizationId, input.organizationId),
          eq(posts.moderationState, "published"),
          communityPostAuthorIsActiveSql(),
        ),
      )
      .limit(1)
      .for("share", { of: posts });
    if (!lockedPost) {
      throw new ApiError(404, "not_found", "Beitrag nicht gefunden.");
    }
    const lockedMember = await lockActiveCommunityInteractionUsers(tx, {
      organizationId: input.organizationId,
      memberId: member.id,
      contentAuthorIds: [post.authorId],
      contentLabel: "Beitrag",
    });
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: member.id,
        organizationId: input.organizationId,
        role: lockedMember.role,
      },
      spaceId: post.spaceId,
    });
    assertCommunityPermission(access.permissions, "canView");
    if (post.forumType !== "discussion") {
      throw new ApiError(
        422,
        "validation_error",
        "Votes sind nur in Diskussionsforen verfuegbar.",
      );
    }

    if (input.value === 0) {
      await tx
        .delete(postVotes)
        .where(
          and(eq(postVotes.postId, post.id), eq(postVotes.userId, member.id)),
        );
    } else {
      await tx
        .insert(postVotes)
        .values({
          organizationId: input.organizationId,
          postId: post.id,
          userId: member.id,
          value: input.value,
        })
        .onConflictDoUpdate({
          target: [postVotes.postId, postVotes.userId],
          set: { value: input.value, updatedAt: new Date() },
        });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: member.id,
      type: "community_post.vote_changed",
      entityType: "post",
      entityId: post.id,
      metadata: { value: input.value },
    });
    return { postId: post.id, userId: member.id, value: input.value };
  });
}

type CommunityCreationPointTarget = {
  entityType: "post" | "comment";
  entityId: string;
  authorId: string;
};

async function reverseCommunityCreationPoints(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    actorId: string;
    targets: readonly CommunityCreationPointTarget[];
  },
) {
  const postIds = input.targets
    .filter((target) => target.entityType === "post")
    .map((target) => target.entityId);
  const commentIds = input.targets
    .filter((target) => target.entityType === "comment")
    .map((target) => target.entityId);
  if (!postIds.length && !commentIds.length) return 0;

  const creationConditions = [
    ...(postIds.length
      ? [
          and(
            eq(pointTransactions.reason, POST_CREATION_REASON),
            eq(pointTransactions.entityType, "post"),
            inArray(pointTransactions.entityId, postIds),
          ),
        ]
      : []),
    ...(commentIds.length
      ? [
          and(
            eq(pointTransactions.reason, COMMENT_CREATION_REASON),
            eq(pointTransactions.entityType, "comment"),
            inArray(pointTransactions.entityId, commentIds),
          ),
        ]
      : []),
  ];
  const originals = await tx
    .select({
      userId: pointTransactions.userId,
      amount: pointTransactions.amount,
      reason: pointTransactions.reason,
      entityType: pointTransactions.entityType,
      entityId: pointTransactions.entityId,
    })
    .from(pointTransactions)
    .where(
      and(
        eq(pointTransactions.organizationId, input.organizationId),
        gt(pointTransactions.amount, 0),
        or(...creationConditions),
      ),
    )
    .orderBy(asc(pointTransactions.userId), asc(pointTransactions.entityId))
    .for("update");

  const expectedAuthors = new Map(
    input.targets.map((target) => [
      `${target.entityType}:${target.entityId}`,
      target.authorId,
    ]),
  );
  const reversals = originals.flatMap((original) => {
    if (!original.entityId) return [];
    const entityType =
      original.entityType === "post"
        ? ("post" as const)
        : original.entityType === "comment"
          ? ("comment" as const)
          : null;
    if (!entityType) {
      return [];
    }
    const expectedAmount = entityType === "post" ? 10 : 4;
    if (
      expectedAuthors.get(`${entityType}:${original.entityId}`) !==
        original.userId ||
      original.amount !== expectedAmount
    ) {
      throw new Error(
        "Community creation points violate the ledger invariant.",
      );
    }
    return [
      {
        organizationId: input.organizationId,
        userId: original.userId,
        amount: -expectedAmount,
        reason:
          entityType === "post"
            ? POST_REVERSAL_REASON
            : COMMENT_REVERSAL_REASON,
        entityType,
        entityId: original.entityId,
      },
    ];
  });
  const result = await awardPointsBatch(tx, reversals);
  if (result.transactions.length) {
    await tx.insert(activityEvents).values(
      result.transactions.map((transaction) => ({
        organizationId: transaction.organizationId,
        userId: input.actorId,
        type: "community_points.reversed",
        entityType: transaction.entityType,
        entityId: transaction.entityId,
        metadata: {
          amount: transaction.amount,
          sourceReason:
            transaction.entityType === "post"
              ? POST_CREATION_REASON
              : COMMENT_CREATION_REASON,
        },
      })),
    );
  }
  return result.transactions.length;
}

async function lockCommunitySpaceForDeletion(
  tx: CommunityMutationTransaction,
  organizationId: string,
  spaceId: string,
) {
  const [space] = await tx
    .select({
      id: communitySpaces.id,
      title: communitySpaces.title,
      areaId: communitySpaces.areaId,
    })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, spaceId),
        eq(communitySpaces.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: communitySpaces });
  return space ?? null;
}

type CommunityDeleteAuthorization = "own" | "manage";

async function lockAndAuthorizeCommunityDeletionUsers(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    actorId: string;
    authorization: CommunityDeleteAuthorization;
    targetAuthorId?: string;
    affectedAuthorIds: readonly string[];
  },
) {
  // Runtime account removal is a status change, so community mutations can
  // consistently acquire space/content locks before deterministic user locks.
  const userIds = [
    ...new Set([input.actorId, ...input.affectedAuthorIds]),
  ].sort();
  const lockedUsers = await tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        inArray(users.id, userIds),
      ),
    )
    .orderBy(asc(users.id))
    .for("update", { of: users });
  const actor = lockedUsers.find((user) => user.id === input.actorId);
  if (!actor || actor.status !== "active") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur aktive Community-Akteure duerfen Inhalte loeschen.",
    );
  }
  if (input.authorization === "manage") {
    await assertCommunityManager(tx, {
      organizationId: input.organizationId,
      actorId: actor.id,
    });
  }
  if (input.authorization === "own" && input.targetAuthorId !== input.actorId) {
    throw new ApiError(
      403,
      "forbidden",
      "Du kannst nur eigene Community-Inhalte loeschen.",
    );
  }
}

async function assertNoActiveCommunityModerationCases(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    postIds?: readonly string[];
    commentIds?: readonly string[];
  },
) {
  const postIds = [...new Set(input.postIds ?? [])];
  const commentIds = [...new Set(input.commentIds ?? [])];
  const targetCondition = or(
    postIds.length
      ? and(
          eq(communityModerationCases.targetType, "post"),
          inArray(communityModerationCases.targetId, postIds),
        )
      : undefined,
    commentIds.length
      ? and(
          eq(communityModerationCases.targetType, "comment"),
          inArray(communityModerationCases.targetId, commentIds),
        )
      : undefined,
  );
  if (!targetCondition) return;
  const [activeCase] = await tx
    .select({ id: communityModerationCases.id })
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.organizationId, input.organizationId),
        inArray(communityModerationCases.status, [
          "open",
          "reviewing",
          "appealed",
        ]),
        targetCondition,
      ),
    )
    .limit(1)
    .for("update", { of: communityModerationCases });
  if (activeCase) {
    throw new ApiError(
      409,
      "conflict",
      "Der Inhalt besitzt einen aktiven Moderationsfall und kann erst nach dessen Abschluss geloescht werden.",
    );
  }
}

export async function deleteCommunityPostWithPointReversal(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    postId: string;
    actorId: string;
    authorization: CommunityDeleteAuthorization;
  },
) {
  const [reference] = await tx
    .select({ spaceId: posts.spaceId })
    .from(posts)
    .where(
      and(
        eq(posts.id, input.postId),
        eq(posts.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!reference) return null;
  if (
    !(await lockCommunitySpaceForDeletion(
      tx,
      input.organizationId,
      reference.spaceId,
    ))
  ) {
    return null;
  }

  const [post] = await tx
    .select({
      id: posts.id,
      authorId: posts.authorId,
      spaceId: posts.spaceId,
      content: posts.content,
    })
    .from(posts)
    .where(
      and(
        eq(posts.id, input.postId),
        eq(posts.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: posts });
  if (!post) return null;
  const cascadedComments = await tx
    .select({ id: comments.id, authorId: comments.authorId })
    .from(comments)
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        eq(comments.postId, post.id),
      ),
    )
    .orderBy(asc(comments.id))
    .for("update", { of: comments });
  await assertNoActiveCommunityModerationCases(tx, {
    organizationId: input.organizationId,
    postIds: [post.id],
    commentIds: cascadedComments.map((comment) => comment.id),
  });
  await lockAndAuthorizeCommunityDeletionUsers(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    authorization: input.authorization,
    targetAuthorId: post.authorId,
    affectedAuthorIds: [
      post.authorId,
      ...cascadedComments.map((comment) => comment.authorId),
    ],
  });
  const [deleted] = await tx
    .delete(posts)
    .where(
      and(
        eq(posts.id, post.id),
        eq(posts.organizationId, input.organizationId),
      ),
    )
    .returning({ id: posts.id });
  if (!deleted) return null;
  const reversedTransactions = await reverseCommunityCreationPoints(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    targets: [
      { entityType: "post", entityId: post.id, authorId: post.authorId },
      ...cascadedComments.map((comment) => ({
        entityType: "comment" as const,
        entityId: comment.id,
        authorId: comment.authorId,
      })),
    ],
  });
  return {
    post,
    deletedCommentCount: cascadedComments.length,
    reversedTransactions,
  };
}

export async function deleteCommunityCommentWithPointReversal(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    commentId: string;
    actorId: string;
    authorization: CommunityDeleteAuthorization;
  },
) {
  const [reference] = await tx
    .select({ postId: comments.postId, spaceId: posts.spaceId })
    .from(comments)
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!reference) return null;
  if (
    !(await lockCommunitySpaceForDeletion(
      tx,
      input.organizationId,
      reference.spaceId,
    ))
  ) {
    return null;
  }
  const [post] = await tx
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.id, reference.postId),
        eq(posts.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: posts });
  if (!post) return null;

  const [comment] = await tx
    .select({
      id: comments.id,
      authorId: comments.authorId,
      content: comments.content,
    })
    .from(comments)
    .where(
      and(
        eq(comments.id, input.commentId),
        eq(comments.organizationId, input.organizationId),
        eq(comments.postId, post.id),
      ),
    )
    .limit(1)
    .for("update", { of: comments });
  if (!comment) return null;
  const directReplies = await tx
    .select({ id: comments.id, authorId: comments.authorId })
    .from(comments)
    .where(
      and(
        eq(comments.organizationId, input.organizationId),
        eq(comments.postId, post.id),
        eq(comments.parentId, comment.id),
      ),
    )
    .orderBy(asc(comments.id))
    .for("update", { of: comments });
  await assertNoActiveCommunityModerationCases(tx, {
    organizationId: input.organizationId,
    commentIds: [comment.id, ...directReplies.map((reply) => reply.id)],
  });
  await lockAndAuthorizeCommunityDeletionUsers(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    authorization: input.authorization,
    targetAuthorId: comment.authorId,
    affectedAuthorIds: [
      comment.authorId,
      ...directReplies.map((reply) => reply.authorId),
    ],
  });
  const [deleted] = await tx
    .delete(comments)
    .where(
      and(
        eq(comments.id, comment.id),
        eq(comments.organizationId, input.organizationId),
      ),
    )
    .returning({ id: comments.id });
  if (!deleted) return null;
  const reversedTransactions = await reverseCommunityCreationPoints(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    targets: [
      {
        entityType: "comment",
        entityId: comment.id,
        authorId: comment.authorId,
      },
      ...directReplies.map((reply) => ({
        entityType: "comment" as const,
        entityId: reply.id,
        authorId: reply.authorId,
      })),
    ],
  });
  return {
    comment,
    deletedReplyCount: directReplies.length,
    reversedTransactions,
  };
}

export async function deleteCommunitySpaceWithPointReversal(
  tx: CommunityMutationTransaction,
  input: {
    organizationId: string;
    spaceId: string;
    actorId: string;
    authorization: "manage";
    confirmationTitle?: string;
  },
) {
  await lockCommunityLayoutForTransaction(tx, input.organizationId);
  await assertCommunityManager(tx, input);
  const space = await lockCommunitySpaceForDeletion(
    tx,
    input.organizationId,
    input.spaceId,
  );
  if (!space) return { status: "missing" as const };
  if (
    input.confirmationTitle !== undefined &&
    input.confirmationTitle !== space.title
  ) {
    return { status: "confirmation_mismatch" as const };
  }
  const spacePosts = await tx
    .select({ id: posts.id, authorId: posts.authorId })
    .from(posts)
    .where(
      and(
        eq(posts.organizationId, input.organizationId),
        eq(posts.spaceId, space.id),
      ),
    )
    .orderBy(asc(posts.id))
    .for("update", { of: posts });
  const spaceComments = spacePosts.length
    ? await tx
        .select({ id: comments.id, authorId: comments.authorId })
        .from(comments)
        .innerJoin(
          posts,
          and(
            eq(posts.id, comments.postId),
            eq(posts.organizationId, input.organizationId),
            eq(posts.spaceId, space.id),
          ),
        )
        .where(eq(comments.organizationId, input.organizationId))
        .orderBy(asc(comments.id))
         .for("update", { of: comments })
    : [];
  await assertNoActiveCommunityModerationCases(tx, {
    organizationId: input.organizationId,
    postIds: spacePosts.map((post) => post.id),
    commentIds: spaceComments.map((comment) => comment.id),
  });
  await lockAndAuthorizeCommunityDeletionUsers(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    authorization: input.authorization,
    affectedAuthorIds: [
      ...spacePosts.map((post) => post.authorId),
      ...spaceComments.map((comment) => comment.authorId),
    ],
  });
  const [deleted] = await tx
    .delete(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, space.id),
        eq(communitySpaces.organizationId, input.organizationId),
      ),
    )
    .returning({ id: communitySpaces.id });
  if (!deleted) return { status: "missing" as const };
  await resequenceCommunitySpacesInArea(
    tx,
    input.organizationId,
    space.areaId,
  );
  const reversedTransactions = await reverseCommunityCreationPoints(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    targets: [
      ...spacePosts.map((post) => ({
        entityType: "post" as const,
        entityId: post.id,
        authorId: post.authorId,
      })),
      ...spaceComments.map((comment) => ({
        entityType: "comment" as const,
        entityId: comment.id,
        authorId: comment.authorId,
      })),
    ],
  });
  return {
    status: "deleted" as const,
    space,
    deletedPostCount: spacePosts.length,
    deletedCommentCount: spaceComments.length,
    reversedTransactions,
  };
}
