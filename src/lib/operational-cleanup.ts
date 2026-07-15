import "server-only";

import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  apiIdempotencyKeys,
  authRateLimits,
  communityAuthorBoosts,
  emailDeliveries,
  emailSuppressions,
  invitations,
  lessonAvailabilitySubscriptions,
  mfaLoginChallenges,
  nativePushDeliveries,
  passwordResetTokens,
  privacyLegalHolds,
  pushNotificationDeliveries,
  userMfaConfigurations,
  userSessions,
  webhookDeliveries,
} from "@/db/schema";
import {
  resolveOperationalCleanupPolicy,
  type CleanupEnvironment,
} from "@/lib/operational-cleanup-policy";

const DEFAULT_BATCH_SIZE = 250;
const MAX_BATCH_SIZE = 1_000;

export const OPERATIONAL_CLEANUP_CATEGORIES = [
  "expiredSessions",
  "expiredInvitations",
  "expiredPasswordResetTokens",
  "expiredRateLimits",
  "expiredIdempotencyKeys",
  "oldEmailDeliveries",
  "oldEmailSuppressions",
  "oldWebhookDeliveries",
  "oldPushDeliveries",
  "oldNativePushDeliveries",
  "expiredCommunityAuthorBoosts",
  "expiredMfaChallenges",
  "abandonedMfaEnrollments",
] as const;

export type OperationalCleanupCategory =
  (typeof OPERATIONAL_CLEANUP_CATEGORIES)[number];
export type OperationalCleanupCounts = Record<
  OperationalCleanupCategory,
  number
>;

export type OperationalCleanupResult = {
  mode: "delete" | "dry-run";
  batchSize: number;
  retentionDays: {
    emailDeliveries: number;
    emailSuppressions: number;
    webhookDeliveries: number;
    pushDeliveries: number;
    communityAuthorBoosts: number;
    mfaChallenges: number;
    mfaPendingEnrollments: number;
  };
  counts: OperationalCleanupCounts;
  mayHaveMore: boolean;
};

type CleanupOptions = {
  batchSize?: number;
  dryRun?: boolean;
  now?: Date;
  environment?: CleanupEnvironment;
};

function boundedBatchSize(value: number | undefined) {
  if (value === undefined) return DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Cleanup batch size must be a positive whole number.");
  }
  return Math.min(value, MAX_BATCH_SIZE);
}

function emptyCounts(): OperationalCleanupCounts {
  return {
    expiredSessions: 0,
    expiredInvitations: 0,
    expiredPasswordResetTokens: 0,
    expiredRateLimits: 0,
    expiredIdempotencyKeys: 0,
    oldEmailDeliveries: 0,
    oldEmailSuppressions: 0,
    oldWebhookDeliveries: 0,
    oldPushDeliveries: 0,
    oldNativePushDeliveries: 0,
    expiredCommunityAuthorBoosts: 0,
    expiredMfaChallenges: 0,
    abandonedMfaEnrollments: 0,
  };
}

export async function cleanupOperationalData(
  options: CleanupOptions = {},
): Promise<OperationalCleanupResult> {
  const now = options.now ?? new Date();
  const batchSize = boundedBatchSize(options.batchSize);
  const policy = resolveOperationalCleanupPolicy(
    options.environment ?? process.env,
    now,
  );
  const mfaEphemeralCutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const expiredMfaChallengeCondition = or(
    lte(mfaLoginChallenges.expiresAt, mfaEphemeralCutoff),
    lte(mfaLoginChallenges.consumedAt, mfaEphemeralCutoff),
  );
  const abandonedMfaEnrollmentCondition = and(
    eq(userMfaConfigurations.status, "pending"),
    lte(userMfaConfigurations.updatedAt, mfaEphemeralCutoff),
    notExists(
      db
        .select({ id: mfaLoginChallenges.id })
        .from(mfaLoginChallenges)
        .where(
          and(
            eq(
              mfaLoginChallenges.organizationId,
              userMfaConfigurations.organizationId,
            ),
            eq(mfaLoginChallenges.userId, userMfaConfigurations.userId),
            isNull(mfaLoginChallenges.consumedAt),
            gt(mfaLoginChallenges.expiresAt, now),
          ),
        ),
    ),
  );
  const terminalEmailCondition = and(
    inArray(emailDeliveries.status, ["delivered", "failed"]),
    lte(emailDeliveries.updatedAt, policy.emailDeliveryCutoff),
    notExists(
      db
        .select({ id: lessonAvailabilitySubscriptions.id })
        .from(lessonAvailabilitySubscriptions)
        .where(
          eq(
            lessonAvailabilitySubscriptions.emailDeliveryId,
            emailDeliveries.id,
          ),
        ),
    ),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              emailDeliveries.organizationId,
            ),
            eq(privacyLegalHolds.subjectUserId, emailDeliveries.userId),
            inArray(privacyLegalHolds.scope, [
              "all",
              "authentication",
              "communications",
            ]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  const terminalEmailSuppressionCondition = and(
    or(
      and(
        isNotNull(emailSuppressions.releasedAt),
        lte(emailSuppressions.releasedAt, policy.emailDeliveryCutoff),
      ),
      and(
        isNull(emailSuppressions.releasedAt),
        isNotNull(emailSuppressions.expiresAt),
        lte(emailSuppressions.expiresAt, policy.emailDeliveryCutoff),
      ),
    ),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              emailSuppressions.organizationId,
            ),
            eq(privacyLegalHolds.subjectUserId, emailSuppressions.userId),
            inArray(privacyLegalHolds.scope, ["all", "communications"]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  const expiredSessionCondition = and(
    lte(userSessions.expiresAt, now),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              userSessions.organizationId,
            ),
            eq(privacyLegalHolds.subjectUserId, userSessions.userId),
            inArray(privacyLegalHolds.scope, ["all", "authentication"]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  const terminalWebhookCondition = and(
    inArray(webhookDeliveries.status, ["delivered", "failed"]),
    lte(webhookDeliveries.updatedAt, policy.webhookDeliveryCutoff),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              webhookDeliveries.organizationId,
            ),
            inArray(privacyLegalHolds.scope, [
              "all",
              "integrations",
              "communications",
            ]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
            or(
              isNull(privacyLegalHolds.subjectUserId),
              sql<boolean>`jsonb_path_exists(
                ${webhookDeliveries.payload},
                '$.** ? (@ == $subjectId)',
                jsonb_build_object(
                  'subjectId',
                  to_jsonb(${privacyLegalHolds.subjectUserId}::text)
                )
              )`,
            ),
          ),
        ),
    ),
  );
  const terminalPushCondition = and(
    inArray(pushNotificationDeliveries.status, ["delivered", "failed"]),
    lte(pushNotificationDeliveries.updatedAt, policy.pushDeliveryCutoff),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              pushNotificationDeliveries.organizationId,
            ),
            eq(
              privacyLegalHolds.subjectUserId,
              pushNotificationDeliveries.userId,
            ),
            inArray(privacyLegalHolds.scope, ["all", "communications"]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  const terminalNativePushCondition = and(
    inArray(nativePushDeliveries.status, ["delivered", "failed"]),
    lte(nativePushDeliveries.updatedAt, policy.pushDeliveryCutoff),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              nativePushDeliveries.organizationId,
            ),
            eq(privacyLegalHolds.subjectUserId, nativePushDeliveries.userId),
            inArray(privacyLegalHolds.scope, ["all", "communications"]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );
  const expiredCommunityAuthorBoostCondition = and(
    lte(communityAuthorBoosts.endsAt, policy.communityAuthorBoostCutoff),
    notExists(
      db
        .select({ id: privacyLegalHolds.id })
        .from(privacyLegalHolds)
        .where(
          and(
            eq(
              privacyLegalHolds.organizationId,
              communityAuthorBoosts.organizationId,
            ),
            or(
              eq(privacyLegalHolds.subjectUserId, communityAuthorBoosts.authorId),
              eq(
                privacyLegalHolds.subjectUserId,
                communityAuthorBoosts.createdById,
              ),
            ),
            inArray(privacyLegalHolds.scope, ["all", "community"]),
            isNull(privacyLegalHolds.releasedAt),
            lte(privacyLegalHolds.startsAt, now),
            or(
              isNull(privacyLegalHolds.expiresAt),
              gt(privacyLegalHolds.expiresAt, now),
            ),
          ),
        ),
    ),
  );

  if (options.dryRun) {
    const [
      sessions,
      invitationRows,
      resetTokens,
      rateLimits,
      idempotencyKeys,
      emails,
      emailSuppressionsRows,
      webhooks,
      pushes,
      nativePushes,
      communityBoosts,
      mfaChallenges,
      mfaEnrollments,
    ] = await Promise.all([
      db
        .select({ value: count() })
        .from(userSessions)
        .where(expiredSessionCondition),
      db
        .select({ value: count() })
        .from(invitations)
        .where(lte(invitations.expiresAt, now)),
      db
        .select({ value: count() })
        .from(passwordResetTokens)
        .where(lte(passwordResetTokens.expiresAt, now)),
      db
        .select({ value: count() })
        .from(authRateLimits)
        .where(lte(authRateLimits.resetAt, now)),
      db
        .select({ value: count() })
        .from(apiIdempotencyKeys)
        .where(lte(apiIdempotencyKeys.expiresAt, now)),
      db
        .select({ value: count() })
        .from(emailDeliveries)
        .where(terminalEmailCondition),
      db
        .select({ value: count() })
        .from(emailSuppressions)
        .where(terminalEmailSuppressionCondition),
      db
        .select({ value: count() })
        .from(webhookDeliveries)
        .where(terminalWebhookCondition),
      db
        .select({ value: count() })
        .from(pushNotificationDeliveries)
        .where(terminalPushCondition),
      db
        .select({ value: count() })
        .from(nativePushDeliveries)
        .where(terminalNativePushCondition),
      db
        .select({ value: count() })
        .from(communityAuthorBoosts)
        .where(expiredCommunityAuthorBoostCondition),
      db
        .select({ value: count() })
        .from(mfaLoginChallenges)
        .where(expiredMfaChallengeCondition),
      db
        .select({ value: count() })
        .from(userMfaConfigurations)
        .where(abandonedMfaEnrollmentCondition),
    ]);
    const counts: OperationalCleanupCounts = {
      expiredSessions: Number(sessions[0]?.value ?? 0),
      expiredInvitations: Number(invitationRows[0]?.value ?? 0),
      expiredPasswordResetTokens: Number(resetTokens[0]?.value ?? 0),
      expiredRateLimits: Number(rateLimits[0]?.value ?? 0),
      expiredIdempotencyKeys: Number(idempotencyKeys[0]?.value ?? 0),
      oldEmailDeliveries: Number(emails[0]?.value ?? 0),
      oldEmailSuppressions: Number(
        emailSuppressionsRows[0]?.value ?? 0,
      ),
      oldWebhookDeliveries: Number(webhooks[0]?.value ?? 0),
      oldPushDeliveries: Number(pushes[0]?.value ?? 0),
      oldNativePushDeliveries: Number(nativePushes[0]?.value ?? 0),
      expiredCommunityAuthorBoosts: Number(communityBoosts[0]?.value ?? 0),
      expiredMfaChallenges: Number(mfaChallenges[0]?.value ?? 0),
      abandonedMfaEnrollments: Number(mfaEnrollments[0]?.value ?? 0),
    };
    return {
      mode: "dry-run",
      batchSize,
      retentionDays: {
        emailDeliveries: policy.emailDeliveryRetentionDays,
        emailSuppressions: policy.emailDeliveryRetentionDays,
        webhookDeliveries: policy.webhookDeliveryRetentionDays,
        pushDeliveries: policy.pushDeliveryRetentionDays,
        communityAuthorBoosts: policy.communityAuthorBoostRetentionDays,
        mfaChallenges: 1,
        mfaPendingEnrollments: 1,
      },
      counts,
      mayHaveMore: Object.values(counts).some((value) => value > batchSize),
    };
  }

  const counts = await db.transaction(async (tx) => {
    const deleted = emptyCounts();

    const sessionCandidates = await tx
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(expiredSessionCondition)
      .orderBy(asc(userSessions.expiresAt), asc(userSessions.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (sessionCandidates.length > 0) {
      const rows = await tx
        .delete(userSessions)
        .where(
          inArray(
            userSessions.id,
            sessionCandidates.map(({ id }) => id),
          ),
        )
        .returning({ id: userSessions.id });
      deleted.expiredSessions = rows.length;
    }

    const invitationCandidates = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(lte(invitations.expiresAt, now))
      .orderBy(asc(invitations.expiresAt), asc(invitations.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (invitationCandidates.length > 0) {
      const rows = await tx
        .delete(invitations)
        .where(
          inArray(
            invitations.id,
            invitationCandidates.map(({ id }) => id),
          ),
        )
        .returning({ id: invitations.id });
      deleted.expiredInvitations = rows.length;
    }

    const tokenCandidates = await tx
      .select({ id: passwordResetTokens.id })
      .from(passwordResetTokens)
      .where(lte(passwordResetTokens.expiresAt, now))
      .orderBy(
        asc(passwordResetTokens.expiresAt),
        asc(passwordResetTokens.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (tokenCandidates.length > 0) {
      const rows = await tx
        .delete(passwordResetTokens)
        .where(
          inArray(
            passwordResetTokens.id,
            tokenCandidates.map(({ id }) => id),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      deleted.expiredPasswordResetTokens = rows.length;
    }

    const rateLimitCandidates = await tx
      .select({
        action: authRateLimits.action,
        keyHash: authRateLimits.keyHash,
      })
      .from(authRateLimits)
      .where(lte(authRateLimits.resetAt, now))
      .orderBy(
        asc(authRateLimits.resetAt),
        asc(authRateLimits.action),
        asc(authRateLimits.keyHash),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (rateLimitCandidates.length > 0) {
      const rows = await tx
        .delete(authRateLimits)
        .where(
          or(
            ...rateLimitCandidates.map((candidate) =>
              and(
                eq(authRateLimits.action, candidate.action),
                eq(authRateLimits.keyHash, candidate.keyHash),
              ),
            ),
          ),
        )
        .returning({ action: authRateLimits.action });
      deleted.expiredRateLimits = rows.length;
    }

    const idempotencyCandidates = await tx
      .select({ id: apiIdempotencyKeys.id })
      .from(apiIdempotencyKeys)
      .where(lte(apiIdempotencyKeys.expiresAt, now))
      .orderBy(
        asc(apiIdempotencyKeys.expiresAt),
        asc(apiIdempotencyKeys.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (idempotencyCandidates.length > 0) {
      const rows = await tx
        .delete(apiIdempotencyKeys)
        .where(
          inArray(
            apiIdempotencyKeys.id,
            idempotencyCandidates.map(({ id }) => id),
          ),
        )
        .returning({ id: apiIdempotencyKeys.id });
      deleted.expiredIdempotencyKeys = rows.length;
    }

    const emailCandidates = await tx
      .select({ id: emailDeliveries.id })
      .from(emailDeliveries)
      .where(terminalEmailCondition)
      .orderBy(asc(emailDeliveries.updatedAt), asc(emailDeliveries.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (emailCandidates.length > 0) {
      const rows = await tx
        .delete(emailDeliveries)
        .where(
          and(
            inArray(
              emailDeliveries.id,
              emailCandidates.map(({ id }) => id),
            ),
            terminalEmailCondition,
          ),
        )
        .returning({ id: emailDeliveries.id });
      deleted.oldEmailDeliveries = rows.length;
    }

    const suppressionCandidates = await tx
      .select({ id: emailSuppressions.id })
      .from(emailSuppressions)
      .where(terminalEmailSuppressionCondition)
      .orderBy(asc(emailSuppressions.updatedAt), asc(emailSuppressions.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (suppressionCandidates.length > 0) {
      const rows = await tx
        .delete(emailSuppressions)
        .where(
          and(
            inArray(
              emailSuppressions.id,
              suppressionCandidates.map(({ id }) => id),
            ),
            terminalEmailSuppressionCondition,
          ),
        )
        .returning({ id: emailSuppressions.id });
      deleted.oldEmailSuppressions = rows.length;
    }

    const webhookCandidates = await tx
      .select({ id: webhookDeliveries.id })
      .from(webhookDeliveries)
      .where(terminalWebhookCondition)
      .orderBy(asc(webhookDeliveries.updatedAt), asc(webhookDeliveries.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (webhookCandidates.length > 0) {
      const rows = await tx
        .delete(webhookDeliveries)
        .where(
          inArray(
            webhookDeliveries.id,
            webhookCandidates.map(({ id }) => id),
          ),
        )
        .returning({ id: webhookDeliveries.id });
      deleted.oldWebhookDeliveries = rows.length;
    }

    const pushCandidates = await tx
      .select({ id: pushNotificationDeliveries.id })
      .from(pushNotificationDeliveries)
      .where(terminalPushCondition)
      .orderBy(
        asc(pushNotificationDeliveries.updatedAt),
        asc(pushNotificationDeliveries.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (pushCandidates.length > 0) {
      const rows = await tx
        .delete(pushNotificationDeliveries)
        .where(
          and(
            inArray(
              pushNotificationDeliveries.id,
              pushCandidates.map(({ id }) => id),
            ),
            terminalPushCondition,
          ),
        )
        .returning({ id: pushNotificationDeliveries.id });
      deleted.oldPushDeliveries = rows.length;
    }

    const nativePushCandidates = await tx
      .select({ id: nativePushDeliveries.id })
      .from(nativePushDeliveries)
      .where(terminalNativePushCondition)
      .orderBy(
        asc(nativePushDeliveries.updatedAt),
        asc(nativePushDeliveries.id),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (nativePushCandidates.length > 0) {
      const rows = await tx
        .delete(nativePushDeliveries)
        .where(
          and(
            inArray(
              nativePushDeliveries.id,
              nativePushCandidates.map(({ id }) => id),
            ),
            terminalNativePushCondition,
          ),
        )
        .returning({ id: nativePushDeliveries.id });
      deleted.oldNativePushDeliveries = rows.length;
    }

    const boostCandidates = await tx
      .select({ id: communityAuthorBoosts.id })
      .from(communityAuthorBoosts)
      .where(expiredCommunityAuthorBoostCondition)
      .orderBy(asc(communityAuthorBoosts.endsAt), asc(communityAuthorBoosts.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (boostCandidates.length > 0) {
      const rows = await tx
        .delete(communityAuthorBoosts)
        .where(
          and(
            inArray(
              communityAuthorBoosts.id,
              boostCandidates.map(({ id }) => id),
            ),
            expiredCommunityAuthorBoostCondition,
          ),
        )
        .returning({ id: communityAuthorBoosts.id });
      deleted.expiredCommunityAuthorBoosts = rows.length;
    }

    const enrollmentCandidates = await tx
      .select({ userId: userMfaConfigurations.userId })
      .from(userMfaConfigurations)
      .where(abandonedMfaEnrollmentCondition)
      .orderBy(
        asc(userMfaConfigurations.updatedAt),
        asc(userMfaConfigurations.userId),
      )
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (enrollmentCandidates.length > 0) {
      const rows = await tx
        .delete(userMfaConfigurations)
        .where(
          and(
            inArray(
              userMfaConfigurations.userId,
              enrollmentCandidates.map(({ userId }) => userId),
            ),
            abandonedMfaEnrollmentCondition,
          ),
        )
        .returning({ userId: userMfaConfigurations.userId });
      deleted.abandonedMfaEnrollments = rows.length;
    }

    const challengeCandidates = await tx
      .select({ id: mfaLoginChallenges.id })
      .from(mfaLoginChallenges)
      .where(expiredMfaChallengeCondition)
      .orderBy(asc(mfaLoginChallenges.expiresAt), asc(mfaLoginChallenges.id))
      .limit(batchSize)
      .for("update", { skipLocked: true });
    if (challengeCandidates.length > 0) {
      const rows = await tx
        .delete(mfaLoginChallenges)
        .where(
          and(
            inArray(
              mfaLoginChallenges.id,
              challengeCandidates.map(({ id }) => id),
            ),
            expiredMfaChallengeCondition,
          ),
        )
        .returning({ id: mfaLoginChallenges.id });
      deleted.expiredMfaChallenges = rows.length;
    }

    return deleted;
  });

  return {
    mode: "delete",
    batchSize,
    retentionDays: {
      emailDeliveries: policy.emailDeliveryRetentionDays,
      emailSuppressions: policy.emailDeliveryRetentionDays,
      webhookDeliveries: policy.webhookDeliveryRetentionDays,
      pushDeliveries: policy.pushDeliveryRetentionDays,
      communityAuthorBoosts: policy.communityAuthorBoostRetentionDays,
      mfaChallenges: 1,
      mfaPendingEnrollments: 1,
    },
    counts,
    mayHaveMore: Object.values(counts).some(
      (value) => value === batchSize,
    ),
  };
}
