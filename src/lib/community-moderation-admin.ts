import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import {
  activityEvents,
  comments,
  communityModerationAppeals,
  communityModerationCases,
  communityModerationEvents,
  communityReports,
  notifications,
  posts,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { requireActiveCommunityAdmin } from "@/lib/community-admin";
import {
  decideCommunityModerationCase,
  loadCommunityModerationPolicy,
  resolveCommunityModerationAppeal,
} from "@/lib/community-moderation-lifecycle";
import { applyCommunityFirstPublishEffects } from "@/lib/community-mutations";
import {
  removeCommunityScoreContributionsForComment,
  removeCommunityScoreContributionsForPost,
  restoreCommunityScoreContributionsForComment,
  restoreCommunityScoreContributionsForPost,
} from "@/lib/community-score";
import { resolveCommunityRecipientLocales } from "@/lib/community-notification-locales";
import { getCommunityNotificationCopy } from "@/lib/i18n/community-actions";

export type CommunityModerationClaimResult = Readonly<{
  caseId: string;
  status: "reviewing" | "appealed";
  claimedById: string;
  claimedAt: string;
  contentVersion: number;
  decisionVersion: number;
}>;

export type CommunityModerationAdminDecisionResult = Readonly<{
  caseId: string;
  action: "approve" | "reject" | "restore";
  targetType: "post" | "comment";
  targetId: string;
  state: "pending" | "published" | "held" | "rejected";
  contentVersion: number;
  decisionVersion: number;
}>;

export type CommunityModerationAdminAppealResult = Readonly<{
  appealId: string;
  caseId: string;
  action: "uphold" | "overturn";
  status: "resolved";
  state: "pending" | "published" | "held" | "rejected";
  contentVersion: number;
  decisionVersion: number;
}>;

export async function rejectCommunityContentAsAdmin(
  tx: ApiTransaction,
  input: Readonly<{
    organizationId: string;
    actorId: string;
    targetType: "post" | "comment";
    targetId: string;
    note: string;
  }>,
): Promise<CommunityModerationAdminDecisionResult> {
  const [reference] =
    input.targetType === "post"
      ? await tx
          .select({ spaceId: posts.spaceId })
          .from(posts)
          .where(
            and(
              eq(posts.id, input.targetId),
              eq(posts.organizationId, input.organizationId),
            ),
          )
          .limit(1)
      : await tx
          .select({ spaceId: posts.spaceId })
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
              eq(comments.id, input.targetId),
              eq(comments.organizationId, input.organizationId),
            ),
          )
          .limit(1);
  if (!reference) {
    throw new ApiError(404, "not_found", "Community-Inhalt nicht gefunden.");
  }
  const policy = await loadCommunityModerationPolicy(tx, {
    organizationId: input.organizationId,
    spaceId: reference.spaceId,
  });
  const targetLockKey = [
    "community-moderation-target-v1",
    input.organizationId,
    input.targetType,
    input.targetId,
  ].join(":");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${targetLockKey}, 0))`,
  );

  const [content] =
    input.targetType === "post"
      ? await tx
          .select({
            id: posts.id,
            authorId: posts.authorId,
            moderationState: posts.moderationState,
            moderationVersion: posts.moderationVersion,
          })
          .from(posts)
          .where(
            and(
              eq(posts.id, input.targetId),
              eq(posts.organizationId, input.organizationId),
            ),
          )
          .limit(1)
          .for("update", { of: posts })
      : await tx
          .select({
            id: comments.id,
            authorId: comments.authorId,
            moderationState: comments.moderationState,
            moderationVersion: comments.moderationVersion,
          })
          .from(comments)
          .where(
            and(
              eq(comments.id, input.targetId),
              eq(comments.organizationId, input.organizationId),
            ),
          )
          .limit(1)
          .for("update", { of: comments });
  if (!content) {
    throw new ApiError(404, "not_found", "Community-Inhalt nicht gefunden.");
  }
  if (content.moderationState === "rejected") {
    throw new ApiError(
      409,
      "conflict",
      "Der Community-Inhalt wurde bereits abgelehnt.",
    );
  }

  let [moderationCase] = await tx
    .select()
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.organizationId, input.organizationId),
        eq(communityModerationCases.targetType, input.targetType),
        eq(communityModerationCases.targetId, input.targetId),
        inArray(communityModerationCases.status, [
          "open",
          "reviewing",
          "appealed",
        ]),
      ),
    )
    .limit(1)
    .for("update", { of: communityModerationCases });
  if (moderationCase?.status === "appealed") {
    throw new ApiError(
      409,
      "conflict",
      "Ein offener Einspruch muss ueber den Einspruchsworkflow entschieden werden.",
    );
  }
  if (!moderationCase) {
    [moderationCase] = await tx
      .insert(communityModerationCases)
      .values({
        organizationId: input.organizationId,
        targetType: input.targetType,
        targetId: input.targetId,
        targetAuthorId: content.authorId,
        contentVersion: content.moderationVersion,
        policyVersion: policy.version,
        reason: "manual",
        priority: 50,
        status: "open",
        decisionVersion: 1,
      })
      .returning();
    await tx.insert(communityModerationEvents).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      action: "flagged",
      actorId: input.actorId,
      reasonCode: "manual",
      contentVersion: content.moderationVersion,
      policyVersion: policy.version,
      decisionVersion: 1,
      note: "Manual administration review",
    });
  }

  return decideCommunityModerationCaseAsAdmin(tx, {
    organizationId: input.organizationId,
    actorId: input.actorId,
    caseId: moderationCase.id,
    action: "reject",
    expectedDecisionVersion: moderationCase.decisionVersion,
    expectedContentVersion: moderationCase.contentVersion,
    note: input.note,
  });
}

export async function claimCommunityModerationCase(
  tx: ApiTransaction,
  input: Readonly<{
    organizationId: string;
    actorId: string;
    caseId: string;
    expectedDecisionVersion: number;
    expectedContentVersion: number;
  }>,
): Promise<CommunityModerationClaimResult> {
  const [current] = await tx
    .select()
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.id, input.caseId),
        eq(communityModerationCases.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: communityModerationCases });
  if (!current) {
    throw new ApiError(404, "not_found", "Moderationsfall nicht gefunden.");
  }

  await requireActiveCommunityAdmin(tx, input);
  if (
    current.decisionVersion !== input.expectedDecisionVersion ||
    current.contentVersion !== input.expectedContentVersion
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Der Moderationsfall wurde zwischenzeitlich geaendert.",
      {
        decisionVersion: current.decisionVersion,
        contentVersion: current.contentVersion,
      },
    );
  }
  if (current.status === "resolved") {
    throw new ApiError(
      409,
      "conflict",
      "Der Moderationsfall ist bereits abgeschlossen.",
    );
  }

  const now = new Date();
  const status = current.status === "appealed" ? "appealed" : "reviewing";
  const decisionVersion = current.decisionVersion + 1;
  const [claimed] = await tx
    .update(communityModerationCases)
    .set({
      status,
      claimedById: input.actorId,
      claimedAt: now,
      decisionVersion,
      updatedAt: now,
    })
    .where(
      and(
        eq(communityModerationCases.id, current.id),
        eq(communityModerationCases.organizationId, input.organizationId),
        eq(
          communityModerationCases.decisionVersion,
          input.expectedDecisionVersion,
        ),
        eq(
          communityModerationCases.contentVersion,
          input.expectedContentVersion,
        ),
      ),
    )
    .returning({ id: communityModerationCases.id });
  if (!claimed) {
    throw new ApiError(
      409,
      "conflict",
      "Der Moderationsfall wurde zwischenzeitlich geaendert.",
    );
  }

  await tx
    .update(communityReports)
    .set({
      status: "reviewing",
      handledById: input.actorId,
      updatedAt: now,
    })
    .where(
      and(
        eq(communityReports.organizationId, input.organizationId),
        eq(communityReports.caseId, current.id),
        inArray(communityReports.status, ["open", "reviewing"]),
      ),
    );
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorId,
    type: "community_moderation.case_claimed",
    entityType: "community_moderation_case",
    entityId: current.id,
    metadata: {
      contentVersion: current.contentVersion,
      decisionVersion,
    },
  });

  return {
    caseId: current.id,
    status,
    claimedById: input.actorId,
    claimedAt: now.toISOString(),
    contentVersion: current.contentVersion,
    decisionVersion,
  };
}

export async function decideCommunityModerationCaseAsAdmin(
  tx: ApiTransaction,
  input: Readonly<{
    organizationId: string;
    actorId: string;
    caseId: string;
    action: "approve" | "reject" | "restore";
    expectedDecisionVersion: number;
    expectedContentVersion: number;
    note: string;
  }>,
): Promise<CommunityModerationAdminDecisionResult> {
  const [moderationCase] = await tx
    .select({
      targetAuthorId: communityModerationCases.targetAuthorId,
      targetType: communityModerationCases.targetType,
      targetId: communityModerationCases.targetId,
    })
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.id, input.caseId),
        eq(communityModerationCases.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  const [targetBeforeDecision] = moderationCase
    ? moderationCase.targetType === "post"
      ? await tx
          .select({ state: posts.moderationState })
          .from(posts)
          .where(
            and(
              eq(posts.id, moderationCase.targetId),
              eq(posts.organizationId, input.organizationId),
            ),
          )
          .limit(1)
      : await tx
          .select({ state: comments.moderationState })
          .from(comments)
          .where(
            and(
              eq(comments.id, moderationCase.targetId),
              eq(comments.organizationId, input.organizationId),
            ),
          )
          .limit(1)
    : [];
  const reports = await tx
    .select({
      id: communityReports.id,
      reporterId: communityReports.reporterId,
    })
    .from(communityReports)
    .where(
      and(
        eq(communityReports.organizationId, input.organizationId),
        eq(communityReports.caseId, input.caseId),
      ),
    );

  const result = await decideCommunityModerationCase(tx, {
    ...input,
    onFirstPublish: (effect) => applyCommunityFirstPublishEffects(tx, effect),
  });
  if (input.action === "reject") {
    if (result.targetType === "post") {
      await removeCommunityScoreContributionsForPost(tx, {
        organizationId: input.organizationId,
        postId: result.targetId,
      });
    } else {
      await removeCommunityScoreContributionsForComment(tx, {
        organizationId: input.organizationId,
        commentId: result.targetId,
      });
    }
  } else if (result.targetType === "post") {
    await restoreCommunityScoreContributionsForPost(tx, {
      organizationId: input.organizationId,
      postId: result.targetId,
    });
  } else {
    await restoreCommunityScoreContributionsForComment(tx, {
      organizationId: input.organizationId,
      commentId: result.targetId,
    });
  }

  if (reports.length) {
    const now = new Date();
    const dismissed = input.action !== "reject";
    await tx
      .update(communityReports)
      .set({
        status: dismissed ? "dismissed" : "resolved",
        handledById: input.actorId,
        outcome: dismissed ? "dismissed" : "content_removed",
        resolutionNote: input.note,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(communityReports.organizationId, input.organizationId),
          inArray(
            communityReports.id,
            reports.map((report) => report.id),
          ),
        ),
      );
    const reporterIds = [
      ...new Set(
        reports
          .map((report) => report.reporterId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (reporterIds.length) {
      const recipientLocales = await resolveCommunityRecipientLocales(tx, {
        organizationId: input.organizationId,
        userIds: reporterIds,
      });
      await tx.insert(notifications).values(
        reporterIds.map((userId) => {
          const locale = recipientLocales.get(userId);
          if (!locale) {
            throw new Error("Community reporter locale is unavailable.");
          }
          const copy = getCommunityNotificationCopy(locale);
          return {
            userId,
            title: copy.reportReviewedTitle,
            body: copy.reportReviewedBody(dismissed),
            type: "community" as const,
            category: "community" as const,
            href: "/academy/community",
          };
        }),
      );
    }
  }
  if (
    moderationCase?.targetAuthorId &&
    moderationCase.targetAuthorId !== input.actorId &&
    (input.action === "reject" || targetBeforeDecision?.state !== "published")
  ) {
    const recipientLocales = await resolveCommunityRecipientLocales(tx, {
      organizationId: input.organizationId,
      userIds: [moderationCase.targetAuthorId],
    });
    const locale = recipientLocales.get(moderationCase.targetAuthorId);
    if (!locale) {
      throw new Error("Community content author locale is unavailable.");
    }
    const copy = getCommunityNotificationCopy(locale);
    const rejected = input.action === "reject";
    await tx.insert(notifications).values({
      userId: moderationCase.targetAuthorId,
      title: copy.contentDecisionTitle(rejected),
      body: copy.contentDecisionBody(rejected),
      type: "community",
      category: "community",
      href: "/academy/community",
    });
  }

  return {
    caseId: result.caseId,
    action: input.action,
    targetType: result.targetType,
    targetId: result.targetId,
    state: result.state,
    contentVersion: result.contentVersion,
    decisionVersion: result.decisionVersion,
  };
}

export async function resolveCommunityModerationAppealAsAdmin(
  tx: ApiTransaction,
  input: Readonly<{
    organizationId: string;
    actorId: string;
    appealId: string;
    action: "uphold" | "overturn";
    expectedDecisionVersion: number;
    expectedContentVersion: number;
    note: string;
  }>,
): Promise<CommunityModerationAdminAppealResult> {
  const [target] = await tx
    .select({
      caseId: communityModerationAppeals.caseId,
      targetType: communityModerationCases.targetType,
      targetId: communityModerationCases.targetId,
      appellantId: communityModerationAppeals.appellantId,
    })
    .from(communityModerationAppeals)
    .innerJoin(
      communityModerationCases,
      and(
        eq(communityModerationCases.id, communityModerationAppeals.caseId),
        eq(
          communityModerationCases.organizationId,
          communityModerationAppeals.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(communityModerationAppeals.id, input.appealId),
        eq(communityModerationAppeals.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new ApiError(404, "not_found", "Einspruch nicht gefunden.");
  }

  const result = await resolveCommunityModerationAppeal(tx, {
    ...input,
    onFirstPublish: (effect) => applyCommunityFirstPublishEffects(tx, effect),
  });
  if (input.action === "overturn") {
    if (target.targetType === "post") {
      await restoreCommunityScoreContributionsForPost(tx, {
        organizationId: input.organizationId,
        postId: target.targetId,
      });
    } else {
      await restoreCommunityScoreContributionsForComment(tx, {
        organizationId: input.organizationId,
        commentId: target.targetId,
      });
    }
  }
  if (target.appellantId !== input.actorId) {
    const recipientLocales = await resolveCommunityRecipientLocales(tx, {
      organizationId: input.organizationId,
      userIds: [target.appellantId],
    });
    const locale = recipientLocales.get(target.appellantId);
    if (!locale) {
      throw new Error("Community appellant locale is unavailable.");
    }
    const copy = getCommunityNotificationCopy(locale);
    await tx.insert(notifications).values({
      userId: target.appellantId,
      title: copy.appealDecisionTitle,
      body: copy.appealDecisionBody(input.action === "overturn"),
      type: "community",
      category: "community",
      href: "/academy/community",
    });
  }

  return {
    appealId: result.appealId,
    caseId: target.caseId,
    action: result.action,
    status: result.status,
    state: result.state,
    contentVersion: result.contentVersion,
    decisionVersion: result.decisionVersion,
  };
}
