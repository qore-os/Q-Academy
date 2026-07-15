import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";

import {
  comments,
  communityModerationAppeals,
  communityModerationAssessments,
  communityModerationCases,
  communityModerationEvents,
  communityReports,
  communitySpaceModerationPolicies,
  communitySpaces,
  posts,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  analyzeCommunityModerationContent,
  type CommunityModerationAnalysis,
} from "@/lib/community-moderation-analyzer";

export type CommunityModerationTransaction = Parameters<
  Parameters<(typeof import("@/db"))["db"]["transaction"]>[0]
>[0];

export type CommunityModerationTargetType = "post" | "comment";
export type CommunityModerationRole = "owner" | "admin" | "trainer" | "member";
export type CommunityModerationState =
  "pending" | "published" | "held" | "rejected";
export type CommunityModerationDecision = "approve" | "reject" | "restore";
export type CommunityModerationReason =
  | "approval_required"
  | "report_threshold"
  | "duplicate"
  | "link_limit"
  | "manual";

export type CommunityModerationPolicy = Readonly<{
  organizationId: string;
  spaceId: string;
  postApproval: "off" | "members" | "non_admins";
  commentApproval: "off" | "members" | "non_admins";
  automationMode: "off" | "observe" | "enforce";
  reportThreshold: number | null;
  duplicateWindowMinutes: number;
  linkLimit: number;
  version: number;
}>;

export type CommunityModerationInsertFields = Readonly<{
  moderationState: CommunityModerationState;
  moderationVersion: number;
  moderationFingerprint: string;
  publishedAt: Date | null;
  moderatedAt: Date | null;
  moderatedById: string | null;
}>;

export type CommunityFirstPublishEffect = Readonly<{
  kind: "community_content_first_published";
  organizationId: string;
  spaceId: string;
  targetType: CommunityModerationTargetType;
  targetId: string;
  authorId: string;
  contentVersion: number;
  publishedAt: Date;
}>;

export type CommunityFirstPublishHook = (
  effect: CommunityFirstPublishEffect,
) => Promise<void>;

export type CommunityModeratedCreateResult<TRecord> = Readonly<{
  record: TRecord;
  state: CommunityModerationState;
  contentVersion: number;
  policyVersion: number;
  caseId: string | null;
  analysis: CommunityModerationAnalysis;
  firstPublish: CommunityFirstPublishEffect | null;
}>;

export type CommunityModerationDecisionResult = Readonly<{
  caseId: string;
  targetType: CommunityModerationTargetType;
  targetId: string;
  state: CommunityModerationState;
  contentVersion: number;
  decisionVersion: number;
  firstPublish: CommunityFirstPublishEffect | null;
}>;

export type CommunityModeratedUpdateResult<TPersisted> = Readonly<{
  persisted: TPersisted;
  targetType: CommunityModerationTargetType;
  targetId: string;
  previousState: CommunityModerationState;
  state: CommunityModerationState;
  contentVersion: number;
  policyVersion: number;
  caseId: string | null;
  analysis: CommunityModerationAnalysis;
  firstPublish: CommunityFirstPublishEffect | null;
}>;

export type CommunityReportThresholdResult = Readonly<{
  caseId: string;
  distinctReporterCount: number;
  threshold: number | null;
  thresholdReached: boolean;
  state: CommunityModerationState;
  contentVersion: number;
  decisionVersion: number;
  alreadyProcessed: boolean;
}>;

export type CommunityModerationAppealCreateResult = Readonly<{
  appealId: string;
  status: "appealed";
  decisionVersion: number;
  createdAt: Date;
}>;

export type CommunityModerationAppealResolutionResult = Readonly<{
  appealId: string;
  status: "resolved";
  action: "uphold" | "overturn";
  state: CommunityModerationState;
  contentVersion: number;
  decisionVersion: number;
  firstPublish: CommunityFirstPublishEffect | null;
}>;

type SecretProvider = () => string | Uint8Array | Promise<string | Uint8Array>;

type LockedContent = {
  id: string;
  organizationId: string;
  spaceId: string;
  authorId: string;
  content: string;
  moderationState: CommunityModerationState;
  moderationVersion: number;
  moderationFingerprint: string | null;
  publishedAt: Date | null;
  moderatedAt: Date | null;
  moderatedById: string | null;
};

const ACTIVE_CASE_STATUSES = ["open", "reviewing", "appealed"] as const;
const COMMUNITY_APPEAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const DEFAULT_COMMUNITY_MODERATION_POLICY = Object.freeze({
  postApproval: "off" as const,
  commentApproval: "off" as const,
  automationMode: "off" as const,
  reportThreshold: null,
  duplicateWindowMinutes: 0,
  linkLimit: 0,
  version: 1,
});

function conflict(message: string, details?: unknown): never {
  throw new ApiError(409, "conflict", message, details);
}

function moderationNote(note: string | null | undefined) {
  const normalized = note?.trim() || null;
  if (normalized && normalized.length > 1000) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Moderationsnotiz darf hoechstens 1000 Zeichen enthalten.",
    );
  }
  return normalized;
}

function appealStatement(statement: string) {
  const normalized = statement.trim();
  if (normalized.length < 3 || normalized.length > 2000) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Einspruch muss zwischen 3 und 2000 Zeichen enthalten.",
    );
  }
  return normalized;
}

function sameInstant(left: Date | null, right: Date | null) {
  if (!left || !right) return left === right;
  return left.getTime() === right.getTime();
}

async function lockModerationTarget(
  tx: CommunityModerationTransaction,
  input: {
    organizationId: string;
    targetType: CommunityModerationTargetType;
    targetId: string;
  },
) {
  const lockKey = [
    "community-moderation-target-v1",
    input.organizationId,
    input.targetType,
    input.targetId,
  ].join(":");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
}

export function communityApprovalRequired(input: {
  mode: "off" | "members" | "non_admins";
  role: CommunityModerationRole;
}) {
  if (input.mode === "off") return false;
  if (input.mode === "members") return input.role === "member";
  return input.role !== "owner" && input.role !== "admin";
}

export function communityEditModerationDecision(input: {
  previousState: CommunityModerationState;
  actorRole: CommunityModerationRole;
  authorEdit: boolean;
  approvalMode: "off" | "members" | "non_admins";
  automationMode: "off" | "observe" | "enforce";
  analysisReasonCodes: readonly ("duplicate" | "link_limit")[];
  activeCaseReason: CommunityModerationReason | null;
}) {
  const approvalRequired = communityApprovalRequired({
    mode: input.approvalMode,
    role: input.actorRole,
  });
  const automatedReasons =
    input.automationMode === "off" ? [] : input.analysisReasonCodes;
  let reason = primaryReason({
    approvalRequired,
    reasonCodes: automatedReasons,
  });
  let state: CommunityModerationState = approvalRequired
    ? "pending"
    : input.automationMode === "enforce" && automatedReasons.length > 0
      ? "held"
      : "published";
  const protectedReportOrManualCase =
    input.authorEdit &&
    (input.activeCaseReason === "report_threshold" ||
      input.activeCaseReason === "manual");
  const protectedManualHold =
    input.authorEdit &&
    input.previousState === "held" &&
    (!input.activeCaseReason ||
      input.activeCaseReason === "report_threshold" ||
      input.activeCaseReason === "manual");

  if (input.previousState === "rejected") {
    state = "pending";
    reason = approvalRequired
      ? "approval_required"
      : (input.activeCaseReason ?? "manual");
  } else if (protectedReportOrManualCase) {
    state = input.previousState;
    reason = input.activeCaseReason;
  } else if (protectedManualHold) {
    state = "held";
    reason = input.activeCaseReason ?? "manual";
  }
  return {
    approvalRequired,
    automatedReasons,
    reason,
    state,
    protectedReportOrManualCase,
    protectedManualHold,
  } as const;
}

async function loadPolicy(
  tx: CommunityModerationTransaction,
  input: { organizationId: string; spaceId: string },
): Promise<CommunityModerationPolicy> {
  const [space] = await tx
    .select({ id: communitySpaces.id })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, input.spaceId),
        eq(communitySpaces.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share", { of: communitySpaces });
  if (!space) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }

  const [stored] = await tx
    .select({
      organizationId: communitySpaceModerationPolicies.organizationId,
      spaceId: communitySpaceModerationPolicies.spaceId,
      postApproval: communitySpaceModerationPolicies.postApproval,
      commentApproval: communitySpaceModerationPolicies.commentApproval,
      automationMode: communitySpaceModerationPolicies.automationMode,
      reportThreshold: communitySpaceModerationPolicies.reportThreshold,
      duplicateWindowMinutes:
        communitySpaceModerationPolicies.duplicateWindowMinutes,
      linkLimit: communitySpaceModerationPolicies.linkLimit,
      version: communitySpaceModerationPolicies.version,
    })
    .from(communitySpaceModerationPolicies)
    .where(
      and(
        eq(
          communitySpaceModerationPolicies.organizationId,
          input.organizationId,
        ),
        eq(communitySpaceModerationPolicies.spaceId, input.spaceId),
      ),
    )
    .limit(1)
    .for("share", { of: communitySpaceModerationPolicies });

  return (
    stored ?? {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      ...DEFAULT_COMMUNITY_MODERATION_POLICY,
    }
  );
}

async function loadActiveActor(
  tx: CommunityModerationTransaction,
  input: { organizationId: string; userId: string },
) {
  const [actor] = await tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share", { of: users });
  if (!actor || actor.status !== "active") {
    throw new ApiError(404, "not_found", "Community-Mitglied nicht gefunden.");
  }
  return actor;
}

async function lockActiveModerators(
  tx: CommunityModerationTransaction,
  organizationId: string,
) {
  return tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    )
    .orderBy(asc(users.id))
    .for("share", { of: users });
}

function assertModerator(actor: { role: CommunityModerationRole }) {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Administratoren duerfen Moderationsentscheidungen treffen.",
    );
  }
}

async function contentSpaceReference(
  tx: CommunityModerationTransaction,
  input: {
    organizationId: string;
    targetType: CommunityModerationTargetType;
    targetId: string;
  },
) {
  if (input.targetType === "post") {
    const [reference] = await tx
      .select({ spaceId: posts.spaceId })
      .from(posts)
      .where(
        and(
          eq(posts.id, input.targetId),
          eq(posts.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!reference) {
      throw new ApiError(404, "not_found", "Community-Inhalt nicht gefunden.");
    }
    return reference;
  }
  const [reference] = await tx
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
  return reference;
}

async function lockContent(
  tx: CommunityModerationTransaction,
  input: {
    organizationId: string;
    targetType: CommunityModerationTargetType;
    targetId: string;
  },
): Promise<LockedContent> {
  if (input.targetType === "post") {
    const [post] = await tx
      .select({
        id: posts.id,
        organizationId: posts.organizationId,
        spaceId: posts.spaceId,
        authorId: posts.authorId,
        content: posts.content,
        moderationState: posts.moderationState,
        moderationVersion: posts.moderationVersion,
        moderationFingerprint: posts.moderationFingerprint,
        publishedAt: posts.publishedAt,
        moderatedAt: posts.moderatedAt,
        moderatedById: posts.moderatedById,
      })
      .from(posts)
      .where(
        and(
          eq(posts.id, input.targetId),
          eq(posts.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: posts });
    if (!post) {
      throw new ApiError(404, "not_found", "Community-Inhalt nicht gefunden.");
    }
    return post;
  }

  const [comment] = await tx
    .select({
      id: comments.id,
      organizationId: comments.organizationId,
      spaceId: posts.spaceId,
      authorId: comments.authorId,
      content: comments.content,
      moderationState: comments.moderationState,
      moderationVersion: comments.moderationVersion,
      moderationFingerprint: comments.moderationFingerprint,
      publishedAt: comments.publishedAt,
      moderatedAt: comments.moderatedAt,
      moderatedById: comments.moderatedById,
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
        eq(comments.id, input.targetId),
        eq(comments.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: comments });
  if (!comment) {
    throw new ApiError(404, "not_found", "Community-Inhalt nicht gefunden.");
  }
  return comment;
}

async function persistContentModeration(
  tx: CommunityModerationTransaction,
  input: {
    targetType: CommunityModerationTargetType;
    content: LockedContent;
    state: CommunityModerationState;
    version: number;
    publishedAt: Date | null;
    moderatedAt: Date;
    moderatedById: string | null;
    fingerprint?: string;
  },
) {
  const values = {
    moderationState: input.state,
    moderationVersion: input.version,
    moderatedAt: input.moderatedAt,
    moderatedById: input.moderatedById,
    ...(input.content.publishedAt === null
      ? { publishedAt: input.publishedAt }
      : {}),
    ...(input.fingerprint ? { moderationFingerprint: input.fingerprint } : {}),
  };
  if (input.targetType === "post") {
    const [updated] = await tx
      .update(posts)
      .set(values)
      .where(
        and(
          eq(posts.id, input.content.id),
          eq(posts.organizationId, input.content.organizationId),
          eq(posts.moderationVersion, input.content.moderationVersion),
        ),
      )
      .returning({ id: posts.id });
    if (!updated) conflict("Der Beitrag wurde parallel geaendert.");
    return;
  }
  const [updated] = await tx
    .update(comments)
    .set(values)
    .where(
      and(
        eq(comments.id, input.content.id),
        eq(comments.organizationId, input.content.organizationId),
        eq(comments.moderationVersion, input.content.moderationVersion),
      ),
    )
    .returning({ id: comments.id });
  if (!updated) conflict("Die Antwort wurde parallel geaendert.");
}

async function persistFingerprint(
  tx: CommunityModerationTransaction,
  input: {
    targetType: CommunityModerationTargetType;
    content: LockedContent;
    fingerprint: string;
  },
) {
  if (input.targetType === "post") {
    await tx
      .update(posts)
      .set({ moderationFingerprint: input.fingerprint })
      .where(
        and(
          eq(posts.id, input.content.id),
          eq(posts.organizationId, input.content.organizationId),
          eq(posts.moderationVersion, input.content.moderationVersion),
        ),
      );
    return;
  }
  await tx
    .update(comments)
    .set({ moderationFingerprint: input.fingerprint })
    .where(
      and(
        eq(comments.id, input.content.id),
        eq(comments.organizationId, input.content.organizationId),
        eq(comments.moderationVersion, input.content.moderationVersion),
      ),
    );
}

async function lockActiveCase(
  tx: CommunityModerationTransaction,
  input: {
    organizationId: string;
    targetType: CommunityModerationTargetType;
    targetId: string;
  },
) {
  const [moderationCase] = await tx
    .select()
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.organizationId, input.organizationId),
        eq(communityModerationCases.targetType, input.targetType),
        eq(communityModerationCases.targetId, input.targetId),
        inArray(communityModerationCases.status, [...ACTIVE_CASE_STATUSES]),
      ),
    )
    .limit(1)
    .for("update", { of: communityModerationCases });
  return moderationCase ?? null;
}

async function distinctReporterCount(
  tx: CommunityModerationTransaction,
  organizationId: string,
  caseId: string,
) {
  const [row] = await tx
    .select({
      count: sql<number>`count(distinct ${communityReports.reporterId})::int`,
    })
    .from(communityReports)
    .where(
      and(
        eq(communityReports.organizationId, organizationId),
        eq(communityReports.caseId, caseId),
      ),
    );
  return row?.count ?? 0;
}

async function nextAssessmentRevision(
  tx: CommunityModerationTransaction,
  organizationId: string,
  caseId: string,
) {
  const [row] = await tx
    .select({
      revision: sql<number>`coalesce(max(${communityModerationAssessments.revision}), 0)::int + 1`,
    })
    .from(communityModerationAssessments)
    .where(
      and(
        eq(communityModerationAssessments.organizationId, organizationId),
        eq(communityModerationAssessments.caseId, caseId),
      ),
    );
  return row?.revision ?? 1;
}

function firstPublishEffect(input: {
  content: LockedContent;
  targetType: CommunityModerationTargetType;
  contentVersion: number;
  publishedAt: Date;
}): CommunityFirstPublishEffect {
  return {
    kind: "community_content_first_published",
    organizationId: input.content.organizationId,
    spaceId: input.content.spaceId,
    targetType: input.targetType,
    targetId: input.content.id,
    authorId: input.content.authorId,
    contentVersion: input.contentVersion,
    publishedAt: input.publishedAt,
  };
}

async function runFirstPublishHook(
  effect: CommunityFirstPublishEffect | null,
  hook: CommunityFirstPublishHook | undefined,
) {
  if (effect && hook) await hook(effect);
}

function primaryReason(input: {
  approvalRequired: boolean;
  reasonCodes: readonly ("duplicate" | "link_limit")[];
}): CommunityModerationReason | null {
  if (input.approvalRequired) return "approval_required";
  if (input.reasonCodes.includes("duplicate")) return "duplicate";
  if (input.reasonCodes.includes("link_limit")) return "link_limit";
  return null;
}

function reasonPriority(reason: CommunityModerationReason) {
  if (reason === "report_threshold") return 90;
  if (reason === "duplicate") return 80;
  if (reason === "link_limit") return 70;
  if (reason === "approval_required") return 60;
  return 50;
}

function revisionEventAction(state: CommunityModerationState) {
  if (state === "pending") return "submitted" as const;
  if (state === "held") return "held" as const;
  return "flagged" as const;
}

async function knownDuplicate(
  tx: CommunityModerationTransaction,
  input: {
    organizationId: string;
    spaceId: string;
    targetType: CommunityModerationTargetType;
    fingerprint: string;
    duplicateWindowMinutes: number;
    now: Date;
    excludeTargetId?: string;
  },
) {
  if (input.duplicateWindowMinutes <= 0) return false;
  const lockKey = [
    "community-moderation-duplicate-v1",
    input.organizationId,
    input.spaceId,
    input.targetType,
    input.fingerprint,
  ].join(":");
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
  );
  const since = new Date(
    input.now.getTime() - input.duplicateWindowMinutes * 60_000,
  );
  if (input.targetType === "post") {
    const conditions = [
      eq(posts.organizationId, input.organizationId),
      eq(posts.spaceId, input.spaceId),
      eq(posts.moderationFingerprint, input.fingerprint),
      gte(posts.createdAt, since),
    ];
    if (input.excludeTargetId) {
      conditions.push(ne(posts.id, input.excludeTargetId));
    }
    const [duplicate] = await tx
      .select({ id: posts.id })
      .from(posts)
      .where(and(...conditions))
      .limit(1);
    return Boolean(duplicate);
  }
  const conditions = [
    eq(comments.organizationId, input.organizationId),
    eq(posts.spaceId, input.spaceId),
    eq(comments.moderationFingerprint, input.fingerprint),
    gte(comments.createdAt, since),
  ];
  if (input.excludeTargetId) {
    conditions.push(ne(comments.id, input.excludeTargetId));
  }
  const [duplicate] = await tx
    .select({ id: comments.id })
    .from(comments)
    .innerJoin(
      posts,
      and(
        eq(posts.id, comments.postId),
        eq(posts.organizationId, comments.organizationId),
      ),
    )
    .where(and(...conditions))
    .limit(1);
  return Boolean(duplicate);
}

export function createCommunityModerationLifecycle(dependencies: {
  getSecret: SecretProvider;
}) {
  async function analyzeContent(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      spaceId: string;
      targetType: CommunityModerationTargetType;
      analysisContent: string;
      policy: CommunityModerationPolicy;
      now: Date;
      excludeTargetId?: string;
    },
  ) {
    const secret = await dependencies.getSecret();
    const initial = analyzeCommunityModerationContent({
      content: input.analysisContent,
      tenantId: input.organizationId,
      secret,
      policy: { maxLinks: input.policy.linkLimit },
    });
    const duplicate = await knownDuplicate(tx, {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetType: input.targetType,
      fingerprint: initial.fingerprint,
      duplicateWindowMinutes: input.policy.duplicateWindowMinutes,
      now: input.now,
      excludeTargetId: input.excludeTargetId,
    });
    if (!duplicate) return initial;
    return analyzeCommunityModerationContent({
      content: input.analysisContent,
      tenantId: input.organizationId,
      secret,
      policy: { maxLinks: input.policy.linkLimit },
      knownFingerprints: new Set([initial.fingerprint]),
    });
  }

  async function createCommunityContentWithModeration<
    TRecord extends { id: string },
  >(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      spaceId: string;
      targetType: CommunityModerationTargetType;
      authorId: string;
      content: string;
      analysisContent?: string;
      persist: (fields: CommunityModerationInsertFields) => Promise<TRecord>;
      onFirstPublish?: CommunityFirstPublishHook;
      now?: Date;
    },
  ): Promise<CommunityModeratedCreateResult<TRecord>> {
    const now = input.now ?? new Date();
    const [policy, actor] = await Promise.all([
      loadPolicy(tx, input),
      loadActiveActor(tx, {
        organizationId: input.organizationId,
        userId: input.authorId,
      }),
    ]);
    const approvalMode =
      input.targetType === "post"
        ? policy.postApproval
        : policy.commentApproval;
    const approvalRequired = communityApprovalRequired({
      mode: approvalMode,
      role: actor.role,
    });
    const analysis = await analyzeContent(tx, {
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      targetType: input.targetType,
      analysisContent: input.analysisContent ?? input.content,
      policy,
      now,
    });
    const automatedReasons =
      policy.automationMode === "off" ? [] : analysis.reasonCodes;
    const reason = primaryReason({
      approvalRequired,
      reasonCodes: automatedReasons,
    });
    const state: CommunityModerationState = approvalRequired
      ? "pending"
      : policy.automationMode === "enforce" && automatedReasons.length > 0
        ? "held"
        : "published";
    const publishedAt = state === "published" ? now : null;
    const fields: CommunityModerationInsertFields = {
      moderationState: state,
      moderationVersion: 1,
      moderationFingerprint: analysis.fingerprint,
      publishedAt,
      moderatedAt: state === "held" ? now : null,
      moderatedById: null,
    };
    const record = await input.persist(fields);
    if (!record?.id) {
      throw new Error("Moderated community persistence did not return an id.");
    }
    const content = await lockContent(tx, {
      organizationId: input.organizationId,
      targetType: input.targetType,
      targetId: record.id,
    });
    if (
      content.authorId !== actor.id ||
      content.spaceId !== input.spaceId ||
      content.content !== input.content ||
      content.moderationState !== fields.moderationState ||
      content.moderationVersion !== 1 ||
      content.moderationFingerprint !== fields.moderationFingerprint ||
      !sameInstant(content.publishedAt, fields.publishedAt)
    ) {
      throw new Error(
        "Moderated community persistence violated the lifecycle contract.",
      );
    }

    let caseId: string | null = null;
    if (reason) {
      const [moderationCase] = await tx
        .insert(communityModerationCases)
        .values({
          organizationId: input.organizationId,
          targetType: input.targetType,
          targetId: content.id,
          targetAuthorId: actor.id,
          contentVersion: 1,
          policyVersion: policy.version,
          reason,
          priority:
            reason === "approval_required"
              ? 60
              : reason === "duplicate"
                ? 80
                : 70,
          status: "open",
          decisionVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: communityModerationCases.id });
      caseId = moderationCase.id;
      await tx.insert(communityModerationAssessments).values({
        organizationId: input.organizationId,
        caseId,
        revision: 1,
        policyVersion: policy.version,
        fingerprint: analysis.fingerprint,
        signals: {
          source: "create",
          approvalMode,
          approvalRequired,
          automationMode: policy.automationMode,
          reasonCodes: analysis.reasonCodes,
          linkCount: analysis.linkCount,
          domains: analysis.domains,
          duplicateWindowMinutes: policy.duplicateWindowMinutes,
        },
        outcome: state,
        createdAt: now,
      });
      await tx.insert(communityModerationEvents).values({
        organizationId: input.organizationId,
        caseId,
        action:
          reason === "approval_required"
            ? "submitted"
            : state === "held"
              ? "held"
              : "flagged",
        actorId: actor.id,
        reasonCode: reason,
        contentVersion: 1,
        policyVersion: policy.version,
        decisionVersion: 1,
        createdAt: now,
      });
    }

    const firstPublish = publishedAt
      ? firstPublishEffect({
          content,
          targetType: input.targetType,
          contentVersion: 1,
          publishedAt,
        })
      : null;
    await runFirstPublishHook(firstPublish, input.onFirstPublish);
    return {
      record,
      state,
      contentVersion: 1,
      policyVersion: policy.version,
      caseId,
      analysis,
      firstPublish,
    };
  }

  async function updateCommunityContentWithModeration<TPersisted>(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      targetType: CommunityModerationTargetType;
      targetId: string;
      actorId: string;
      expectedContentVersion: number;
      content: string;
      analysisContent?: string;
      persist: (input: {
        content: string;
        moderation: CommunityModerationInsertFields;
        preservePublishedAt: boolean;
      }) => Promise<TPersisted>;
      onFirstPublish?: CommunityFirstPublishHook;
      now?: Date;
    },
  ): Promise<CommunityModeratedUpdateResult<TPersisted>> {
    const now = input.now ?? new Date();
    const spaceReference = await contentSpaceReference(tx, input);
    const policy = await loadPolicy(tx, {
      organizationId: input.organizationId,
      spaceId: spaceReference.spaceId,
    });
    await lockModerationTarget(tx, input);
    const previous = await lockContent(tx, input);
    if (previous.spaceId !== spaceReference.spaceId) {
      conflict(
        "Der Community-Inhalt wurde in einen anderen Bereich verschoben.",
      );
    }
    if (previous.moderationVersion !== input.expectedContentVersion) {
      conflict("Der Community-Inhalt wurde parallel geaendert.", {
        contentVersion: previous.moderationVersion,
      });
    }
    const actor = await loadActiveActor(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
    });
    const authorEdit = actor.id === previous.authorId;
    if (!authorEdit && actor.role !== "owner" && actor.role !== "admin") {
      throw new ApiError(
        403,
        "forbidden",
        "Du darfst diesen Community-Inhalt nicht bearbeiten.",
      );
    }

    const activeCase = await lockActiveCase(tx, input);
    if (
      activeCase &&
      activeCase.contentVersion !== previous.moderationVersion
    ) {
      conflict("Der Moderationsfall besitzt eine andere Inhaltsrevision.", {
        caseContentVersion: activeCase.contentVersion,
        contentVersion: previous.moderationVersion,
      });
    }
    const approvalMode =
      input.targetType === "post"
        ? policy.postApproval
        : policy.commentApproval;
    const analysis = await analyzeContent(tx, {
      organizationId: input.organizationId,
      spaceId: previous.spaceId,
      targetType: input.targetType,
      analysisContent: input.analysisContent ?? input.content,
      policy,
      now,
      excludeTargetId: previous.id,
    });
    const {
      approvalRequired,
      reason,
      state,
      protectedReportOrManualCase,
      protectedManualHold,
    } = communityEditModerationDecision({
      previousState: previous.moderationState,
      actorRole: actor.role,
      authorEdit,
      approvalMode,
      automationMode: policy.automationMode,
      analysisReasonCodes: analysis.reasonCodes,
      activeCaseReason: activeCase?.reason ?? null,
    });

    const contentVersion = previous.moderationVersion + 1;
    const publishedAt =
      previous.publishedAt ?? (state === "published" ? now : null);
    const moderation: CommunityModerationInsertFields = {
      moderationState: state,
      moderationVersion: contentVersion,
      moderationFingerprint: analysis.fingerprint,
      publishedAt,
      moderatedAt: now,
      moderatedById: authorEdit ? null : actor.id,
    };
    const persisted = await input.persist({
      content: input.content,
      moderation,
      preservePublishedAt: previous.publishedAt !== null,
    });
    const updated = await lockContent(tx, input);
    if (
      updated.authorId !== previous.authorId ||
      updated.spaceId !== previous.spaceId ||
      updated.content !== input.content ||
      updated.moderationState !== moderation.moderationState ||
      updated.moderationVersion !== moderation.moderationVersion ||
      updated.moderationFingerprint !== moderation.moderationFingerprint ||
      !sameInstant(updated.publishedAt, moderation.publishedAt) ||
      !sameInstant(updated.moderatedAt, moderation.moderatedAt) ||
      updated.moderatedById !== moderation.moderatedById
    ) {
      throw new Error(
        "Community edit persistence violated the moderation contract.",
      );
    }

    let caseId: string | null = activeCase?.id ?? null;
    let decisionVersion = activeCase?.decisionVersion ?? 1;
    if (activeCase) {
      decisionVersion = activeCase.decisionVersion + 1;
      const assessmentRevision = await nextAssessmentRevision(
        tx,
        input.organizationId,
        activeCase.id,
      );
      if (reason) {
        await tx
          .update(communityModerationCases)
          .set({
            reason,
            priority: Math.max(activeCase.priority, reasonPriority(reason)),
            contentVersion,
            policyVersion: policy.version,
            decisionVersion,
            updatedAt: now,
          })
          .where(eq(communityModerationCases.id, activeCase.id));
      } else {
        await tx
          .update(communityModerationCases)
          .set({
            status: "resolved",
            contentVersion,
            policyVersion: policy.version,
            decisionVersion,
            resolvedById: authorEdit ? null : actor.id,
            resolvedAt: now,
            updatedAt: now,
          })
          .where(eq(communityModerationCases.id, activeCase.id));
      }
      await tx.insert(communityModerationAssessments).values({
        organizationId: input.organizationId,
        caseId: activeCase.id,
        revision: assessmentRevision,
        policyVersion: policy.version,
        fingerprint: analysis.fingerprint,
        signals: {
          source: "edit",
          previousState: previous.moderationState,
          approvalMode,
          approvalRequired,
          automationMode: policy.automationMode,
          reasonCodes: analysis.reasonCodes,
          linkCount: analysis.linkCount,
          domains: analysis.domains,
          duplicateWindowMinutes: policy.duplicateWindowMinutes,
          protectedReportOrManualCase,
        },
        outcome: state,
        createdAt: now,
      });
      await tx.insert(communityModerationEvents).values({
        organizationId: input.organizationId,
        caseId: activeCase.id,
        action: reason ? revisionEventAction(state) : "approved",
        actorId: actor.id,
        reasonCode: reason ?? activeCase.reason,
        contentVersion,
        policyVersion: policy.version,
        decisionVersion,
        note: "Content revised",
        createdAt: now,
      });
    } else if (reason) {
      const [moderationCase] = await tx
        .insert(communityModerationCases)
        .values({
          organizationId: input.organizationId,
          targetType: input.targetType,
          targetId: previous.id,
          targetAuthorId: previous.authorId,
          contentVersion,
          policyVersion: policy.version,
          reason,
          priority: reasonPriority(reason),
          status: "open",
          decisionVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: communityModerationCases.id });
      caseId = moderationCase.id;
      await tx.insert(communityModerationAssessments).values({
        organizationId: input.organizationId,
        caseId,
        revision: 1,
        policyVersion: policy.version,
        fingerprint: analysis.fingerprint,
        signals: {
          source: "edit",
          previousState: previous.moderationState,
          approvalMode,
          approvalRequired,
          automationMode: policy.automationMode,
          reasonCodes: analysis.reasonCodes,
          linkCount: analysis.linkCount,
          domains: analysis.domains,
          duplicateWindowMinutes: policy.duplicateWindowMinutes,
          protectedManualHold,
        },
        outcome: state,
        createdAt: now,
      });
      await tx.insert(communityModerationEvents).values({
        organizationId: input.organizationId,
        caseId,
        action: revisionEventAction(state),
        actorId: actor.id,
        reasonCode: reason,
        contentVersion,
        policyVersion: policy.version,
        decisionVersion: 1,
        note: "Content revised",
        createdAt: now,
      });
    }

    const firstPublish =
      state === "published" && !previous.publishedAt && publishedAt
        ? firstPublishEffect({
            content: updated,
            targetType: input.targetType,
            contentVersion,
            publishedAt,
          })
        : null;
    await runFirstPublishHook(firstPublish, input.onFirstPublish);
    return {
      persisted,
      targetType: input.targetType,
      targetId: previous.id,
      previousState: previous.moderationState,
      state,
      contentVersion,
      policyVersion: policy.version,
      caseId,
      analysis,
      firstPublish,
    };
  }

  async function decideCommunityModerationCase(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      caseId: string;
      actorId: string;
      action: CommunityModerationDecision;
      expectedDecisionVersion: number;
      expectedContentVersion: number;
      note?: string | null;
      onFirstPublish?: CommunityFirstPublishHook;
      now?: Date;
    },
  ): Promise<CommunityModerationDecisionResult> {
    const now = input.now ?? new Date();
    const note = moderationNote(input.note);
    const [caseReference] = await tx
      .select({
        id: communityModerationCases.id,
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
    if (!caseReference) {
      throw new ApiError(404, "not_found", "Moderationsfall nicht gefunden.");
    }
    const spaceReference = await contentSpaceReference(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    await loadPolicy(tx, {
      organizationId: input.organizationId,
      spaceId: spaceReference.spaceId,
    });
    await lockModerationTarget(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    const content = await lockContent(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    if (content.spaceId !== spaceReference.spaceId) {
      conflict(
        "Der Community-Inhalt wurde in einen anderen Bereich verschoben.",
      );
    }
    const [moderationCase] = await tx
      .select()
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.id, caseReference.id),
          eq(communityModerationCases.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationCases });
    if (
      !moderationCase ||
      moderationCase.targetType !== caseReference.targetType ||
      moderationCase.targetId !== caseReference.targetId
    ) {
      conflict("Der Moderationsfall wurde parallel geaendert.");
    }
    const actor = await loadActiveActor(tx, {
      organizationId: input.organizationId,
      userId: input.actorId,
    });
    assertModerator(actor);

    if (
      moderationCase.decisionVersion !== input.expectedDecisionVersion ||
      moderationCase.contentVersion !== input.expectedContentVersion ||
      content.moderationVersion !== input.expectedContentVersion
    ) {
      conflict("Der Moderationsfall wurde parallel geaendert.", {
        decisionVersion: moderationCase.decisionVersion,
        contentVersion: content.moderationVersion,
      });
    }
    const active = ACTIVE_CASE_STATUSES.includes(
      moderationCase.status as (typeof ACTIVE_CASE_STATUSES)[number],
    );
    if (input.action !== "restore" && !active) {
      conflict("Der Moderationsfall ist bereits abgeschlossen.");
    }
    if (
      input.action === "restore" &&
      content.moderationState !== "rejected" &&
      content.moderationState !== "held"
    ) {
      conflict(
        "Nur abgelehnte oder gesperrte Inhalte koennen wiederhergestellt werden.",
      );
    }
    if (
      input.action === "approve" &&
      !["pending", "held", "published"].includes(content.moderationState)
    ) {
      conflict("Dieser Inhalt kann nicht freigegeben werden.");
    }
    if (
      input.action === "reject" &&
      !["pending", "held", "published"].includes(content.moderationState)
    ) {
      conflict("Dieser Inhalt kann nicht abgelehnt werden.");
    }

    const [otherActiveCase] = await tx
      .select({ id: communityModerationCases.id })
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.organizationId, input.organizationId),
          eq(communityModerationCases.targetType, moderationCase.targetType),
          eq(communityModerationCases.targetId, moderationCase.targetId),
          inArray(communityModerationCases.status, [...ACTIVE_CASE_STATUSES]),
          ne(communityModerationCases.id, moderationCase.id),
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationCases });
    if (otherActiveCase) {
      conflict("Ein neuerer aktiver Moderationsfall existiert bereits.");
    }

    const state: CommunityModerationState =
      input.action === "reject" ? "rejected" : "published";
    const publishedAt =
      state === "published"
        ? (content.publishedAt ?? now)
        : content.publishedAt;
    const contentVersion = content.moderationVersion + 1;
    const decisionVersion = moderationCase.decisionVersion + 1;
    await persistContentModeration(tx, {
      targetType: moderationCase.targetType,
      content,
      state,
      version: contentVersion,
      publishedAt,
      moderatedAt: now,
      moderatedById: actor.id,
    });
    await tx
      .update(communityModerationCases)
      .set({
        status: "resolved",
        contentVersion,
        decisionVersion,
        resolvedById: actor.id,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(eq(communityModerationCases.id, moderationCase.id));
    await tx.insert(communityModerationEvents).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      action:
        input.action === "approve"
          ? "approved"
          : input.action === "reject"
            ? "rejected"
            : "restored",
      actorId: actor.id,
      reasonCode: moderationCase.reason,
      contentVersion,
      policyVersion: moderationCase.policyVersion,
      decisionVersion,
      note,
      createdAt: now,
    });

    const firstPublish =
      state === "published" && !content.publishedAt && publishedAt
        ? firstPublishEffect({
            content,
            targetType: moderationCase.targetType,
            contentVersion,
            publishedAt,
          })
        : null;
    await runFirstPublishHook(firstPublish, input.onFirstPublish);
    return {
      caseId: moderationCase.id,
      targetType: moderationCase.targetType,
      targetId: moderationCase.targetId,
      state,
      contentVersion,
      decisionVersion,
      firstPublish,
    };
  }

  async function createCommunityModerationAppeal(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      caseId: string;
      appellantId: string;
      expectedDecisionVersion: number;
      statement: string;
      now?: Date;
    },
  ): Promise<CommunityModerationAppealCreateResult> {
    const now = input.now ?? new Date();
    const statement = appealStatement(input.statement);
    const [caseReference] = await tx
      .select({
        id: communityModerationCases.id,
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
    if (!caseReference) {
      throw new ApiError(404, "not_found", "Moderationsfall nicht gefunden.");
    }
    const spaceReference = await contentSpaceReference(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    await loadPolicy(tx, {
      organizationId: input.organizationId,
      spaceId: spaceReference.spaceId,
    });
    await lockModerationTarget(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    const content = await lockContent(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    if (content.spaceId !== spaceReference.spaceId) {
      conflict(
        "Der Community-Inhalt wurde in einen anderen Bereich verschoben.",
      );
    }
    const [moderationCase] = await tx
      .select()
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.id, caseReference.id),
          eq(communityModerationCases.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationCases });
    if (
      !moderationCase ||
      moderationCase.targetType !== caseReference.targetType ||
      moderationCase.targetId !== caseReference.targetId
    ) {
      conflict("Der Moderationsfall wurde parallel geaendert.");
    }
    const otherActiveCase = await lockActiveCase(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    if (otherActiveCase && otherActiveCase.id !== moderationCase.id) {
      conflict("Ein neuerer aktiver Moderationsfall existiert bereits.");
    }
    const [latestCase] = await tx
      .select({ id: communityModerationCases.id })
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.organizationId, input.organizationId),
          eq(communityModerationCases.targetType, moderationCase.targetType),
          eq(communityModerationCases.targetId, moderationCase.targetId),
        ),
      )
      .orderBy(
        desc(communityModerationCases.createdAt),
        desc(communityModerationCases.id),
      )
      .limit(1)
      .for("update", { of: communityModerationCases });
    if (!latestCase || latestCase.id !== moderationCase.id) {
      conflict("Fuer diesen Inhalt existiert ein neuerer Moderationsfall.");
    }
    const appellant = await loadActiveActor(tx, {
      organizationId: input.organizationId,
      userId: input.appellantId,
    });
    if (
      appellant.id !== content.authorId ||
      (moderationCase.targetAuthorId &&
        moderationCase.targetAuthorId !== content.authorId)
    ) {
      throw new ApiError(
        403,
        "forbidden",
        "Nur der Autor dieses Inhalts darf Einspruch einlegen.",
      );
    }
    if (
      moderationCase.decisionVersion !== input.expectedDecisionVersion ||
      moderationCase.contentVersion !== content.moderationVersion
    ) {
      conflict("Der Moderationsfall wurde parallel geaendert.", {
        decisionVersion: moderationCase.decisionVersion,
        contentVersion: content.moderationVersion,
      });
    }
    if (
      moderationCase.status !== "resolved" ||
      (content.moderationState !== "rejected" &&
        content.moderationState !== "held")
    ) {
      conflict("Dieser Moderationsfall kann nicht angefochten werden.");
    }
    if (
      !moderationCase.resolvedAt ||
      now.getTime() >
        moderationCase.resolvedAt.getTime() + COMMUNITY_APPEAL_WINDOW_MS
    ) {
      conflict("Die Einspruchsfrist von 30 Tagen ist abgelaufen.");
    }
    const [openAppeal] = await tx
      .select({ id: communityModerationAppeals.id })
      .from(communityModerationAppeals)
      .where(
        and(
          eq(communityModerationAppeals.organizationId, input.organizationId),
          eq(communityModerationAppeals.caseId, moderationCase.id),
          sql`${communityModerationAppeals.resolutionAction} is null`,
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationAppeals });
    if (openAppeal) {
      conflict("Fuer diesen Moderationsfall existiert bereits ein Einspruch.");
    }

    const decisionVersion = moderationCase.decisionVersion + 1;
    const [appeal] = await tx
      .insert(communityModerationAppeals)
      .values({
        organizationId: input.organizationId,
        caseId: moderationCase.id,
        appellantId: appellant.id,
        statement,
        decisionVersion,
        createdAt: now,
        updatedAt: now,
      })
      .returning({
        id: communityModerationAppeals.id,
        createdAt: communityModerationAppeals.createdAt,
      });
    const [updatedCase] = await tx
      .update(communityModerationCases)
      .set({
        status: "appealed",
        decisionVersion,
        updatedAt: now,
      })
      .where(
        and(
          eq(communityModerationCases.id, moderationCase.id),
          eq(
            communityModerationCases.decisionVersion,
            input.expectedDecisionVersion,
          ),
          eq(communityModerationCases.status, "resolved"),
        ),
      )
      .returning({ id: communityModerationCases.id });
    if (!updatedCase) conflict("Der Moderationsfall wurde parallel geaendert.");
    await tx.insert(communityModerationEvents).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      action: "appealed",
      actorId: appellant.id,
      reasonCode: moderationCase.reason,
      contentVersion: content.moderationVersion,
      policyVersion: moderationCase.policyVersion,
      decisionVersion,
      createdAt: now,
    });
    return {
      appealId: appeal.id,
      status: "appealed",
      decisionVersion,
      createdAt: appeal.createdAt,
    };
  }

  async function resolveCommunityModerationAppeal(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      appealId: string;
      actorId: string;
      action: "uphold" | "overturn";
      expectedDecisionVersion: number;
      expectedContentVersion: number;
      note?: string | null;
      onFirstPublish?: CommunityFirstPublishHook;
      now?: Date;
    },
  ): Promise<CommunityModerationAppealResolutionResult> {
    const now = input.now ?? new Date();
    const note = moderationNote(input.note);
    const [appealReference] = await tx
      .select({
        id: communityModerationAppeals.id,
        caseId: communityModerationAppeals.caseId,
      })
      .from(communityModerationAppeals)
      .where(
        and(
          eq(communityModerationAppeals.id, input.appealId),
          eq(communityModerationAppeals.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!appealReference) {
      throw new ApiError(404, "not_found", "Einspruch nicht gefunden.");
    }
    const [caseReference] = await tx
      .select({
        id: communityModerationCases.id,
        targetType: communityModerationCases.targetType,
        targetId: communityModerationCases.targetId,
      })
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.id, appealReference.caseId),
          eq(communityModerationCases.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!caseReference) {
      throw new ApiError(404, "not_found", "Moderationsfall nicht gefunden.");
    }
    const spaceReference = await contentSpaceReference(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    await loadPolicy(tx, {
      organizationId: input.organizationId,
      spaceId: spaceReference.spaceId,
    });
    await lockModerationTarget(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    const content = await lockContent(tx, {
      organizationId: input.organizationId,
      targetType: caseReference.targetType,
      targetId: caseReference.targetId,
    });
    if (content.spaceId !== spaceReference.spaceId) {
      conflict(
        "Der Community-Inhalt wurde in einen anderen Bereich verschoben.",
      );
    }
    const [moderationCase] = await tx
      .select()
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.id, caseReference.id),
          eq(communityModerationCases.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationCases });
    const [appeal] = await tx
      .select()
      .from(communityModerationAppeals)
      .where(
        and(
          eq(communityModerationAppeals.id, appealReference.id),
          eq(communityModerationAppeals.organizationId, input.organizationId),
          eq(communityModerationAppeals.caseId, caseReference.id),
        ),
      )
      .limit(1)
      .for("update", { of: communityModerationAppeals });
    if (!moderationCase || !appeal) {
      conflict("Der Einspruch wurde parallel geaendert.");
    }
    if (
      moderationCase.targetType !== caseReference.targetType ||
      moderationCase.targetId !== caseReference.targetId
    ) {
      conflict("Der Moderationsfall wurde parallel geaendert.");
    }
    if (
      moderationCase.status !== "appealed" ||
      appeal.resolutionAction ||
      appeal.resolvedAt
    ) {
      conflict("Der Einspruch wurde bereits abgeschlossen.");
    }
    if (
      moderationCase.decisionVersion !== input.expectedDecisionVersion ||
      appeal.decisionVersion !== input.expectedDecisionVersion ||
      moderationCase.contentVersion !== input.expectedContentVersion ||
      content.moderationVersion !== input.expectedContentVersion
    ) {
      conflict("Der Einspruch wurde parallel geaendert.", {
        decisionVersion: moderationCase.decisionVersion,
        contentVersion: content.moderationVersion,
      });
    }
    if (
      content.moderationState !== "rejected" &&
      content.moderationState !== "held"
    ) {
      conflict("Der angefochtene Inhalt ist nicht mehr gesperrt.");
    }

    const moderators = await lockActiveModerators(tx, input.organizationId);
    const actor = moderators.find(
      (moderator) => moderator.id === input.actorId,
    );
    if (!actor) {
      throw new ApiError(
        403,
        "forbidden",
        "Nur Administratoren duerfen Einsprueche entscheiden.",
      );
    }
    if (actor.id === appeal.appellantId) {
      throw new ApiError(
        403,
        "forbidden",
        "Der eigene Einspruch darf nicht selbst entschieden werden.",
      );
    }
    const independentReviewerExists = moderators.some(
      (moderator) =>
        moderator.id !== moderationCase.resolvedById &&
        moderator.id !== appeal.appellantId,
    );
    if (actor.id === moderationCase.resolvedById && independentReviewerExists) {
      throw new ApiError(
        403,
        "forbidden",
        "Dieser Einspruch muss durch einen unabhaengigen Administrator entschieden werden.",
      );
    }

    const state: CommunityModerationState =
      input.action === "overturn" ? "published" : content.moderationState;
    const publishedAt =
      state === "published"
        ? (content.publishedAt ?? now)
        : content.publishedAt;
    const contentVersion = content.moderationVersion + 1;
    const decisionVersion = moderationCase.decisionVersion + 1;
    await persistContentModeration(tx, {
      targetType: moderationCase.targetType,
      content,
      state,
      version: contentVersion,
      publishedAt,
      moderatedAt: now,
      moderatedById: actor.id,
    });
    const resolutionAction =
      input.action === "uphold" ? "appeal_upheld" : "appeal_overturned";
    const [resolvedAppeal] = await tx
      .update(communityModerationAppeals)
      .set({
        decisionVersion,
        resolutionAction,
        resolvedById: actor.id,
        resolvedAt: now,
        resolutionNote: note,
        updatedAt: now,
      })
      .where(
        and(
          eq(communityModerationAppeals.id, appeal.id),
          eq(
            communityModerationAppeals.decisionVersion,
            input.expectedDecisionVersion,
          ),
          sql`${communityModerationAppeals.resolutionAction} is null`,
        ),
      )
      .returning({ id: communityModerationAppeals.id });
    if (!resolvedAppeal) conflict("Der Einspruch wurde parallel geaendert.");
    const [resolvedCase] = await tx
      .update(communityModerationCases)
      .set({
        status: "resolved",
        contentVersion,
        decisionVersion,
        resolvedById: actor.id,
        resolvedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(communityModerationCases.id, moderationCase.id),
          eq(
            communityModerationCases.decisionVersion,
            input.expectedDecisionVersion,
          ),
          eq(communityModerationCases.status, "appealed"),
        ),
      )
      .returning({ id: communityModerationCases.id });
    if (!resolvedCase)
      conflict("Der Moderationsfall wurde parallel geaendert.");
    await tx.insert(communityModerationEvents).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      action: resolutionAction,
      actorId: actor.id,
      reasonCode: moderationCase.reason,
      contentVersion,
      policyVersion: moderationCase.policyVersion,
      decisionVersion,
      note,
      createdAt: now,
    });
    const firstPublish =
      state === "published" && !content.publishedAt && publishedAt
        ? firstPublishEffect({
            content,
            targetType: moderationCase.targetType,
            contentVersion,
            publishedAt,
          })
        : null;
    await runFirstPublishHook(firstPublish, input.onFirstPublish);
    return {
      appealId: appeal.id,
      status: "resolved",
      action: input.action,
      state,
      contentVersion,
      decisionVersion,
      firstPublish,
    };
  }

  async function attachCommunityReportToModerationCase(
    tx: CommunityModerationTransaction,
    input: {
      organizationId: string;
      reportId: string;
      now?: Date;
    },
  ): Promise<CommunityReportThresholdResult> {
    const now = input.now ?? new Date();
    const [report] = await tx
      .select({
        id: communityReports.id,
        organizationId: communityReports.organizationId,
        caseId: communityReports.caseId,
        reporterId: communityReports.reporterId,
        targetType: communityReports.targetType,
        targetId: communityReports.targetId,
        targetAuthorId: communityReports.targetAuthorId,
      })
      .from(communityReports)
      .where(
        and(
          eq(communityReports.id, input.reportId),
          eq(communityReports.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityReports });
    if (!report || !report.reporterId) {
      throw new ApiError(404, "not_found", "Community-Meldung nicht gefunden.");
    }

    const spaceReference = await contentSpaceReference(tx, report);
    const policy = await loadPolicy(tx, {
      organizationId: input.organizationId,
      spaceId: spaceReference.spaceId,
    });
    await lockModerationTarget(tx, report);
    const content = await lockContent(tx, report);
    if (content.spaceId !== spaceReference.spaceId) {
      conflict(
        "Der Community-Inhalt wurde in einen anderen Bereich verschoben.",
      );
    }
    let moderationCase = report.caseId
      ? ((
          await tx
            .select()
            .from(communityModerationCases)
            .where(
              and(
                eq(communityModerationCases.id, report.caseId),
                eq(
                  communityModerationCases.organizationId,
                  input.organizationId,
                ),
              ),
            )
            .limit(1)
            .for("update", { of: communityModerationCases })
        )[0] ?? null)
      : await lockActiveCase(tx, report);
    if (report.targetAuthorId && report.targetAuthorId !== content.authorId) {
      conflict("Die Meldung verweist auf einen anderen Inhaltsautor.");
    }

    if (report.caseId) {
      if (!moderationCase) {
        conflict("Der zugeordnete Moderationsfall existiert nicht.");
      }
      const reporterCount = await distinctReporterCount(
        tx,
        input.organizationId,
        moderationCase.id,
      );
      return {
        caseId: moderationCase.id,
        distinctReporterCount: reporterCount,
        threshold: policy.reportThreshold,
        thresholdReached:
          policy.reportThreshold !== null &&
          reporterCount >= policy.reportThreshold,
        state: content.moderationState,
        contentVersion: content.moderationVersion,
        decisionVersion: moderationCase.decisionVersion,
        alreadyProcessed: true,
      };
    }

    let fingerprint = content.moderationFingerprint;
    if (!fingerprint) {
      const secret = await dependencies.getSecret();
      fingerprint = analyzeCommunityModerationContent({
        content: content.content,
        tenantId: input.organizationId,
        secret,
        policy: { maxLinks: policy.linkLimit },
      }).fingerprint;
      await persistFingerprint(tx, {
        targetType: report.targetType,
        content,
        fingerprint,
      });
    }
    if (!moderationCase) {
      [moderationCase] = await tx
        .insert(communityModerationCases)
        .values({
          organizationId: input.organizationId,
          targetType: report.targetType,
          targetId: report.targetId,
          targetAuthorId: content.authorId,
          contentVersion: content.moderationVersion,
          policyVersion: policy.version,
          reason:
            policy.reportThreshold === null ? "manual" : "report_threshold",
          priority: 30,
          status: "open",
          decisionVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }

    const [duplicateReporter] = await tx
      .select({ id: communityReports.id })
      .from(communityReports)
      .where(
        and(
          eq(communityReports.organizationId, input.organizationId),
          eq(communityReports.caseId, moderationCase.id),
          eq(communityReports.reporterId, report.reporterId),
          ne(communityReports.id, report.id),
        ),
      )
      .limit(1)
      .for("update", { of: communityReports });
    if (duplicateReporter) {
      conflict("Diese Person hat den aktuellen Fall bereits gemeldet.", {
        reason: "duplicate_reporter",
      });
    }
    const [attached] = await tx
      .update(communityReports)
      .set({ caseId: moderationCase.id, updatedAt: now })
      .where(
        and(
          eq(communityReports.id, report.id),
          eq(communityReports.organizationId, input.organizationId),
          sql`${communityReports.caseId} is null`,
        ),
      )
      .returning({ id: communityReports.id });
    if (!attached) conflict("Die Meldung wurde parallel zugeordnet.");

    const reporterCount = await distinctReporterCount(
      tx,
      input.organizationId,
      moderationCase.id,
    );
    const thresholdReached =
      policy.reportThreshold !== null &&
      reporterCount >= policy.reportThreshold;
    const shouldHold =
      thresholdReached &&
      policy.automationMode === "enforce" &&
      content.moderationState === "published";
    const state: CommunityModerationState = shouldHold
      ? "held"
      : content.moderationState;
    const contentVersion = shouldHold
      ? content.moderationVersion + 1
      : content.moderationVersion;
    const decisionVersion = shouldHold
      ? moderationCase.decisionVersion + 1
      : moderationCase.decisionVersion;
    if (shouldHold) {
      await persistContentModeration(tx, {
        targetType: report.targetType,
        content,
        state,
        version: contentVersion,
        publishedAt: content.publishedAt,
        moderatedAt: now,
        moderatedById: null,
      });
    }
    await tx
      .update(communityModerationCases)
      .set({
        priority: thresholdReached
          ? Math.max(moderationCase.priority, 90)
          : moderationCase.priority,
        contentVersion,
        decisionVersion,
        updatedAt: now,
      })
      .where(eq(communityModerationCases.id, moderationCase.id));
    const assessmentRevision = await nextAssessmentRevision(
      tx,
      input.organizationId,
      moderationCase.id,
    );
    await tx.insert(communityModerationAssessments).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      revision: assessmentRevision,
      policyVersion: policy.version,
      fingerprint,
      signals: {
        source: "report",
        distinctReporterCount: reporterCount,
        reportThreshold: policy.reportThreshold,
        thresholdReached,
        automationMode: policy.automationMode,
      },
      outcome: state,
      createdAt: now,
    });
    await tx.insert(communityModerationEvents).values({
      organizationId: input.organizationId,
      caseId: moderationCase.id,
      action: shouldHold ? "held" : "flagged",
      actorId: report.reporterId,
      reasonCode:
        policy.reportThreshold === null ? "manual" : "report_threshold",
      contentVersion,
      policyVersion: policy.version,
      decisionVersion,
      note: `Distinct reporters: ${reporterCount}`,
      createdAt: now,
    });
    return {
      caseId: moderationCase.id,
      distinctReporterCount: reporterCount,
      threshold: policy.reportThreshold,
      thresholdReached,
      state,
      contentVersion,
      decisionVersion,
      alreadyProcessed: false,
    };
  }

  return {
    loadCommunityModerationPolicy: loadPolicy,
    createCommunityContentWithModeration,
    updateCommunityContentWithModeration,
    decideCommunityModerationCase,
    createCommunityModerationAppeal,
    resolveCommunityModerationAppeal,
    attachCommunityReportToModerationCase,
  };
}
