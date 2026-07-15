import { and, desc, eq, inArray } from "drizzle-orm";

import {
  comments,
  communityModerationAppeals,
  communityModerationCases,
  communitySpaces,
  posts,
} from "@/db/schema";
import type { CommunityModerationReason } from "@/lib/community-moderation-lifecycle-core";

type CommunityModerationReadExecutor = Pick<
  (typeof import("@/db"))["db"],
  "select"
>;

type ModerationCaseStatus = "open" | "reviewing" | "resolved" | "appealed";
type ModerationContentState =
  "pending" | "published" | "held" | "rejected" | null;

export type CommunityOwnModerationStatus =
  | "awaiting_review"
  | "in_review"
  | "appeal_pending"
  | "published"
  | "held"
  | "rejected"
  | "appeal_upheld"
  | "appeal_accepted"
  | "unavailable";

export type CommunityOwnModerationSubmission = Readonly<{
  caseId: string;
  targetType: "post" | "comment";
  title: string;
  targetTitle: string | null;
  excerpt: string;
  spaceTitle: string;
  reason: CommunityModerationReason;
  reasonLabel: string;
  status: CommunityOwnModerationStatus;
  submittedAt: string;
  appealDeadline: string | null;
  canAppeal: boolean;
  appeal: Readonly<{
    status: "pending" | "upheld" | "accepted";
    submittedAt: string;
    resolvedAt: string | null;
  }> | null;
}>;

const COMMUNITY_APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function communityModerationReasonForAuthor(
  reason: CommunityModerationReason,
) {
  if (reason === "approval_required") return "Freigabe erforderlich";
  if (reason === "duplicate") return "Aehnlicher Inhalt wird geprueft";
  if (reason === "link_limit") return "Linklimit des Bereichs ueberschritten";
  if (reason === "report_threshold") return "Community-Pruefung erforderlich";
  return "Manuelle Pruefung erforderlich";
}

export function communityModerationAppealAvailability(input: {
  caseStatus: ModerationCaseStatus;
  contentState: ModerationContentState;
  contentAvailable: boolean;
  resolvedAt: Date | null;
  hasOpenAppeal: boolean;
  now: Date;
}) {
  const hidden =
    input.contentState === "held" || input.contentState === "rejected";
  const deadline =
    hidden && input.resolvedAt
      ? new Date(input.resolvedAt.getTime() + COMMUNITY_APPEAL_WINDOW_MS)
      : null;
  return {
    deadline: deadline?.toISOString() ?? null,
    canAppeal: Boolean(
      input.contentAvailable &&
      input.caseStatus === "resolved" &&
      hidden &&
      deadline &&
      input.now.getTime() <= deadline.getTime() &&
      !input.hasOpenAppeal,
    ),
  } as const;
}

function publicStatus(input: {
  caseStatus: ModerationCaseStatus;
  contentState: ModerationContentState;
  contentAvailable: boolean;
  appealAction: "appeal_upheld" | "appeal_overturned" | null;
}) {
  if (!input.contentAvailable) return "unavailable" as const;
  if (input.caseStatus === "appealed") return "appeal_pending" as const;
  if (input.caseStatus === "open") return "awaiting_review" as const;
  if (input.caseStatus === "reviewing") return "in_review" as const;
  if (input.appealAction === "appeal_upheld") {
    return "appeal_upheld" as const;
  }
  if (input.appealAction === "appeal_overturned") {
    return "appeal_accepted" as const;
  }
  if (input.contentState === "published") return "published" as const;
  if (input.contentState === "held") return "held" as const;
  return "rejected" as const;
}

function appealStatus(action: "appeal_upheld" | "appeal_overturned" | null) {
  if (action === "appeal_upheld") return "upheld" as const;
  if (action === "appeal_overturned") return "accepted" as const;
  return "pending" as const;
}

export async function queryOwnCommunityModerationSubmissions(
  executor: CommunityModerationReadExecutor,
  input: {
    organizationId: string;
    authorId: string;
    limit?: number;
    now?: Date;
  },
): Promise<CommunityOwnModerationSubmission[]> {
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(input.limit ?? 12)));
  const now = input.now ?? new Date();
  const cases = await executor
    .select({
      id: communityModerationCases.id,
      targetType: communityModerationCases.targetType,
      targetId: communityModerationCases.targetId,
      reason: communityModerationCases.reason,
      status: communityModerationCases.status,
      resolvedAt: communityModerationCases.resolvedAt,
      createdAt: communityModerationCases.createdAt,
    })
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.organizationId, input.organizationId),
        eq(communityModerationCases.targetAuthorId, input.authorId),
      ),
    )
    .orderBy(
      desc(communityModerationCases.createdAt),
      desc(communityModerationCases.id),
    )
    .limit(boundedLimit);
  if (!cases.length) return [];

  const caseIds = cases.map((moderationCase) => moderationCase.id);
  const postIds = cases
    .filter((moderationCase) => moderationCase.targetType === "post")
    .map((moderationCase) => moderationCase.targetId);
  const commentIds = cases
    .filter((moderationCase) => moderationCase.targetType === "comment")
    .map((moderationCase) => moderationCase.targetId);
  const [postRows, commentRows, appealRows] = await Promise.all([
    postIds.length
      ? executor
          .select({
            id: posts.id,
            title: posts.title,
            content: posts.content,
            state: posts.moderationState,
            spaceTitle: communitySpaces.title,
          })
          .from(posts)
          .innerJoin(
            communitySpaces,
            and(
              eq(communitySpaces.id, posts.spaceId),
              eq(communitySpaces.organizationId, posts.organizationId),
            ),
          )
          .where(
            and(
              eq(posts.organizationId, input.organizationId),
              eq(posts.authorId, input.authorId),
              inArray(posts.id, postIds),
            ),
          )
      : Promise.resolve([]),
    commentIds.length
      ? executor
          .select({
            id: comments.id,
            content: comments.content,
            state: comments.moderationState,
            spaceTitle: communitySpaces.title,
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
          .where(
            and(
              eq(comments.organizationId, input.organizationId),
              eq(comments.authorId, input.authorId),
              inArray(comments.id, commentIds),
            ),
          )
      : Promise.resolve([]),
    executor
      .select({
        id: communityModerationAppeals.id,
        caseId: communityModerationAppeals.caseId,
        action: communityModerationAppeals.resolutionAction,
        createdAt: communityModerationAppeals.createdAt,
        resolvedAt: communityModerationAppeals.resolvedAt,
      })
      .from(communityModerationAppeals)
      .where(
        and(
          eq(communityModerationAppeals.organizationId, input.organizationId),
          inArray(communityModerationAppeals.caseId, caseIds),
        ),
      )
      .orderBy(
        desc(communityModerationAppeals.createdAt),
        desc(communityModerationAppeals.id),
      ),
  ]);

  const postTargets = new Map(
    postRows.map((row) => [
      row.id,
      {
        title: row.title?.trim() || null,
        excerpt: row.content.trim().slice(0, 320),
        state: row.state,
        spaceTitle: row.spaceTitle,
      },
    ]),
  );
  const commentTargets = new Map(
    commentRows.map((row) => [
      row.id,
      {
        title: null,
        excerpt: row.content.trim().slice(0, 320),
        state: row.state,
        spaceTitle: row.spaceTitle,
      },
    ]),
  );
  const latestAppeals = new Map<string, (typeof appealRows)[number]>();
  for (const appeal of appealRows) {
    if (!latestAppeals.has(appeal.caseId)) {
      latestAppeals.set(appeal.caseId, appeal);
    }
  }

  const seenTargets = new Set<string>();
  return cases.map((moderationCase) => {
    const targetKey = `${moderationCase.targetType}:${moderationCase.targetId}`;
    const latestCaseForTarget = !seenTargets.has(targetKey);
    seenTargets.add(targetKey);
    const target =
      moderationCase.targetType === "post"
        ? postTargets.get(moderationCase.targetId)
        : commentTargets.get(moderationCase.targetId);
    const appeal = latestAppeals.get(moderationCase.id) ?? null;
    const appealAction =
      appeal?.action === "appeal_upheld" ||
      appeal?.action === "appeal_overturned"
        ? appeal.action
        : null;
    const availability = communityModerationAppealAvailability({
      caseStatus: moderationCase.status,
      contentState: target?.state ?? null,
      contentAvailable: Boolean(target),
      resolvedAt: moderationCase.resolvedAt,
      hasOpenAppeal: Boolean(appeal && !appealAction),
      now,
    });
    return {
      caseId: moderationCase.id,
      targetType: moderationCase.targetType,
      title:
        target?.title ??
        (moderationCase.targetType === "post"
          ? "Community-Beitrag"
          : "Community-Antwort"),
      targetTitle: target?.title ?? null,
      excerpt: target?.excerpt ?? "",
      spaceTitle: target?.spaceTitle ?? "Community",
      reason: moderationCase.reason,
      reasonLabel: communityModerationReasonForAuthor(moderationCase.reason),
      status: publicStatus({
        caseStatus: moderationCase.status,
        contentState: target?.state ?? null,
        contentAvailable: Boolean(target),
        appealAction,
      }),
      submittedAt: moderationCase.createdAt.toISOString(),
      appealDeadline: availability.deadline,
      canAppeal: latestCaseForTarget && availability.canAppeal,
      appeal: appeal
        ? {
            status: appealStatus(appealAction),
            submittedAt: appeal.createdAt.toISOString(),
            resolvedAt: appeal.resolvedAt?.toISOString() ?? null,
          }
        : null,
    };
  });
}
