import "server-only";

import { and, eq, gt, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { badgeDefinitions, pointTransactions, userBadges, users } from "@/db/schema";

type GamificationExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PointAwardInput = {
  organizationId: string;
  userId: string;
  amount: number;
  reason: string;
  entityType?: string;
  entityId?: string;
};

function assertPointAward(input: PointAwardInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
    throw new Error("Point awards must use a non-zero safe integer amount.");
  }
  if (!input.reason.trim()) {
    throw new Error("Point awards require a reason.");
  }
}

async function reconcileThresholdBadges(
  executor: GamificationExecutor,
  input: { organizationId: string; userId: string; points: number },
) {
  const earned = await executor
    .select({ id: badgeDefinitions.id, slug: badgeDefinitions.slug })
    .from(badgeDefinitions)
    .where(
      and(
        eq(badgeDefinitions.organizationId, input.organizationId),
        eq(badgeDefinitions.active, true),
        isNotNull(badgeDefinitions.pointsThreshold),
        lte(badgeDefinitions.pointsThreshold, input.points),
      ),
    );
  if (earned.length) {
    await executor
      .insert(userBadges)
      .values(
        earned.map((badge) => ({
          organizationId: input.organizationId,
          userId: input.userId,
          badgeId: badge.id,
          source: `points:${input.points}`,
        })),
      )
      .onConflictDoNothing();
  }

  const automaticAboveThreshold = await executor
    .select({ id: userBadges.id })
    .from(userBadges)
    .innerJoin(
      badgeDefinitions,
      and(
        eq(badgeDefinitions.id, userBadges.badgeId),
        eq(badgeDefinitions.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(userBadges.organizationId, input.organizationId),
        eq(userBadges.userId, input.userId),
        sql`${userBadges.source} ~ '^points:[0-9]+$'`,
        isNotNull(badgeDefinitions.pointsThreshold),
        gt(badgeDefinitions.pointsThreshold, input.points),
      ),
    );
  if (automaticAboveThreshold.length) {
    await executor
      .delete(userBadges)
      .where(
        inArray(
          userBadges.id,
          automaticAboveThreshold.map((badge) => badge.id),
        ),
      );
  }

  return {
    earned,
    revokedBadgeIds: automaticAboveThreshold.map((badge) => badge.id),
  };
}

export async function awardPointsBatch(
  executor: GamificationExecutor,
  inputs: readonly PointAwardInput[],
) {
  if (!inputs.length) return { transactions: [], balances: [] };
  inputs.forEach(assertPointAward);

  const transactions = await executor
    .insert(pointTransactions)
    .values(
      inputs.map((input) => ({
        ...input,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({
      id: pointTransactions.id,
      organizationId: pointTransactions.organizationId,
      userId: pointTransactions.userId,
      amount: pointTransactions.amount,
      reason: pointTransactions.reason,
      entityType: pointTransactions.entityType,
      entityId: pointTransactions.entityId,
    });
  if (!transactions.length) return { transactions, balances: [] };

  const adjustments = new Map<
    string,
    { organizationId: string; userId: string; amount: number }
  >();
  for (const transaction of transactions) {
    const key = `${transaction.organizationId}\0${transaction.userId}`;
    const current = adjustments.get(key);
    if (current) current.amount += transaction.amount;
    else {
      adjustments.set(key, {
        organizationId: transaction.organizationId,
        userId: transaction.userId,
        amount: transaction.amount,
      });
    }
  }

  const balances = [];
  for (const adjustment of [...adjustments.values()].sort((left, right) =>
    `${left.organizationId}:${left.userId}`.localeCompare(
      `${right.organizationId}:${right.userId}`,
    ),
  )) {
    const [currentUser] = await executor
      .select({ points: users.points })
      .from(users)
      .where(
        and(
          eq(users.id, adjustment.userId),
          eq(users.organizationId, adjustment.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: users });
    if (!currentUser) {
      throw new Error("The point recipient no longer exists in the tenant.");
    }
    const nextPoints = currentUser.points + adjustment.amount;
    if (!Number.isSafeInteger(nextPoints) || nextPoints < 0) {
      throw new Error(
        "The point adjustment would violate the non-negative balance invariant.",
      );
    }
    const [user] = await executor
      .update(users)
      .set({ points: nextPoints })
      .where(
        and(
          eq(users.id, adjustment.userId),
          eq(users.organizationId, adjustment.organizationId),
        ),
      )
      .returning({ points: users.points });
    if (!user) {
      throw new Error("The locked point recipient could not be updated.");
    }
    const badges = await reconcileThresholdBadges(executor, {
      organizationId: adjustment.organizationId,
      userId: adjustment.userId,
      points: user.points,
    });
    balances.push({ ...adjustment, points: user.points, ...badges });
  }

  return { transactions, balances };
}

export async function awardPoints(
  executor: GamificationExecutor,
  input: PointAwardInput,
) {
  const result = await awardPointsBatch(executor, [input]);
  const balance = result.balances[0];
  return result.transactions.length && balance
    ? {
        points: balance.points,
        earned: balance.earned,
        revokedBadgeIds: balance.revokedBadgeIds,
      }
    : null;
}
