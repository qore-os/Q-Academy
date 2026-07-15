import "server-only";

import { createHash } from "node:crypto";
import { and, asc, count, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { activityEvents, communityAuthorBoosts, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import type { CommunityPolicyActor } from "@/lib/community-access";

export const COMMUNITY_BOOST_STRENGTHS = ["light", "medium", "high"] as const;
export const COMMUNITY_AUTHOR_BOOST_MAX_PER_TENANT = 500;
export const COMMUNITY_AUTHOR_BOOST_PAGE_MAX = 200;
export type CommunityBoostStrength = (typeof COMMUNITY_BOOST_STRENGTHS)[number];
export const COMMUNITY_BOOST_STATES = [
  "all",
  "active",
  "scheduled",
  "expired",
] as const;
export type CommunityBoostState = (typeof COMMUNITY_BOOST_STATES)[number];

export type CommunityAuthorBoostDto = Readonly<{
  id: string;
  authorId: string;
  authorName: string;
  strength: CommunityBoostStrength;
  startsAt: string;
  endsAt: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
}>;

function assertAdminActor(actor: CommunityPolicyActor) {
  if (actor.role !== "owner" && actor.role !== "admin") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Organisationsadministratoren duerfen Community-Boosts verwalten.",
    );
  }
}

async function assertActiveAdminActor(actor: CommunityPolicyActor) {
  assertAdminActor(actor);
  const [current] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!current || (current.role !== "owner" && current.role !== "admin")) {
    throw new ApiError(
      403,
      "forbidden",
      "Community-Boost-Akteur ist nicht berechtigt.",
    );
  }
}

async function consumeBoostMutationRateLimit(actor: CommunityPolicyActor) {
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "community_boost_mutation_tenant",
        identifier: actor.organizationId,
      },
    ],
    primary: {
      action: "community_boost_mutation",
      identifier: `${actor.organizationId}\0${actor.id}`,
    },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Zu viele Community-Boost-Aenderungen. Bitte versuche es spaeter erneut.",
      { limit: rateLimit.limit, resetAt: rateLimit.resetAt.toISOString() },
    );
  }
}

function presentBoost(row: {
  id: string;
  authorId: string;
  authorFirstName: string;
  authorLastName: string;
  strength: CommunityBoostStrength;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}): CommunityAuthorBoostDto {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: `${row.authorFirstName} ${row.authorLastName}`.trim(),
    strength: row.strength,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCommunityAuthorBoosts(input: {
  actor: CommunityPolicyActor;
  state?: CommunityBoostState;
  referenceTime?: Date;
  limit?: number;
  offset?: number;
}) {
  await assertActiveAdminActor(input.actor);
  const referenceTime = input.referenceTime ?? new Date();
  const state = input.state ?? "all";
  const limit = input.limit ?? COMMUNITY_AUTHOR_BOOST_MAX_PER_TENANT;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > COMMUNITY_AUTHOR_BOOST_MAX_PER_TENANT ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new ApiError(422, "validation_error", "Boost-Seite ist ungueltig.");
  }
  const stateCondition =
    state === "active"
      ? and(
          lte(communityAuthorBoosts.startsAt, referenceTime),
          gt(communityAuthorBoosts.endsAt, referenceTime),
        )
      : state === "scheduled"
        ? gt(communityAuthorBoosts.startsAt, referenceTime)
        : state === "expired"
          ? lte(communityAuthorBoosts.endsAt, referenceTime)
          : undefined;
  const rows = await db
    .select({
      id: communityAuthorBoosts.id,
      authorId: communityAuthorBoosts.authorId,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      strength: communityAuthorBoosts.strength,
      startsAt: communityAuthorBoosts.startsAt,
      endsAt: communityAuthorBoosts.endsAt,
      reason: communityAuthorBoosts.reason,
      createdAt: communityAuthorBoosts.createdAt,
      updatedAt: communityAuthorBoosts.updatedAt,
    })
    .from(communityAuthorBoosts)
    .innerJoin(
      users,
      and(
        eq(users.id, communityAuthorBoosts.authorId),
        eq(users.organizationId, communityAuthorBoosts.organizationId),
      ),
    )
    .where(
      and(
        eq(communityAuthorBoosts.organizationId, input.actor.organizationId),
        stateCondition,
        sql`exists (
          select 1 from users boost_actor
          where boost_actor.id = ${input.actor.id}
            and boost_actor.organization_id = ${input.actor.organizationId}
            and boost_actor.status = 'active'
            and boost_actor.role in ('owner', 'admin')
        )`,
      ),
    )
    .orderBy(
      asc(communityAuthorBoosts.startsAt),
      asc(communityAuthorBoosts.authorId),
    )
    .limit(limit)
    .offset(offset);
  await assertActiveAdminActor(input.actor);
  return rows.map(presentBoost);
}

export async function listCommunityAuthorBoostsPage(input: {
  actor: CommunityPolicyActor;
  state?: CommunityBoostState;
  referenceTime?: Date;
  limit?: number;
  offset?: number;
}) {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  if (limit > COMMUNITY_AUTHOR_BOOST_PAGE_MAX) {
    throw new ApiError(422, "validation_error", "Boost-Seite ist zu gross.");
  }
  const rows = await listCommunityAuthorBoosts({
    ...input,
    limit: limit + 1,
    offset,
  });
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

function reasonDigest(reason: string) {
  return createHash("sha256")
    .update("q-academy:community-boost-reason:v1\0")
    .update(reason)
    .digest("hex");
}

function auditSnapshot(
  value:
    | {
        strength: CommunityBoostStrength;
        startsAt: Date;
        endsAt: Date;
        reason: string;
      }
    | undefined,
) {
  return value
    ? {
        strength: value.strength,
        startsAt: value.startsAt.toISOString(),
        endsAt: value.endsAt.toISOString(),
        reasonDigest: reasonDigest(value.reason),
      }
    : null;
}

async function lockBoostActors(input: {
  actor: CommunityPolicyActor;
  authorId: string;
  tx: ApiTransaction;
}) {
  const ids = [...new Set([input.actor.id, input.authorId])].sort();
  const rows = await input.tx
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
        inArray(users.id, ids),
        eq(users.organizationId, input.actor.organizationId),
      ),
    )
    .orderBy(asc(users.id))
    .for("update");
  const actor = rows.find((row) => row.id === input.actor.id);
  const author = rows.find((row) => row.id === input.authorId);
  if (
    !actor ||
    actor.status !== "active" ||
    (actor.role !== "owner" && actor.role !== "admin")
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Community-Boost-Akteur ist nicht berechtigt.",
    );
  }
  if (!author || author.status !== "active") {
    throw new ApiError(404, "not_found", "Community-Autor nicht gefunden.");
  }
  return { actor, author };
}

async function lockBoostAdminActor(input: {
  actor: CommunityPolicyActor;
  tx: ApiTransaction;
}) {
  const [actor] = await input.tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(
      and(
        eq(users.id, input.actor.id),
        eq(users.organizationId, input.actor.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (
    !actor ||
    actor.status !== "active" ||
    (actor.role !== "owner" && actor.role !== "admin")
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Community-Boost-Akteur ist nicht berechtigt.",
    );
  }
  return actor;
}

export async function replaceCommunityAuthorBoost(input: {
  actor: CommunityPolicyActor;
  authorId: string;
  strength: CommunityBoostStrength;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  tx?: ApiTransaction;
}) {
  assertAdminActor(input.actor);
  await assertActiveAdminActor(input.actor);
  await consumeBoostMutationRateLimit(input.actor);
  const reason = input.reason.trim();
  if (
    !COMMUNITY_BOOST_STRENGTHS.includes(input.strength) ||
    !Number.isFinite(input.startsAt.getTime()) ||
    !Number.isFinite(input.endsAt.getTime()) ||
    input.startsAt >= input.endsAt ||
    input.endsAt.getTime() - input.startsAt.getTime() > 90 * 24 * 60 * 60_000 ||
    reason.length < 3 ||
    reason.length > 500
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Community-Boost-Zeitraum, Staerke oder Begruendung ist ungueltig.",
    );
  }

  const now = new Date();
  const execute = async (tx: ApiTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-author-boost-tenant-limit-v1",
        input.actor.organizationId,
      ].join(":")}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-author-boost-v1",
        input.actor.organizationId,
        input.authorId,
      ].join(":")}, 0))`,
    );
    const locked = await lockBoostActors({
      actor: input.actor,
      authorId: input.authorId,
      tx,
    });
    const [current] = await tx
      .select()
      .from(communityAuthorBoosts)
      .where(
        and(
          eq(communityAuthorBoosts.organizationId, input.actor.organizationId),
          eq(communityAuthorBoosts.authorId, input.authorId),
        ),
      )
      .limit(1)
      .for("update");
    const currentActive = Boolean(current && current.endsAt > now);
    const nextActive = input.endsAt > now;
    if (nextActive && !currentActive) {
      const [activeTotal] = await tx
        .select({ value: count() })
        .from(communityAuthorBoosts)
        .where(
          and(
            eq(
              communityAuthorBoosts.organizationId,
              input.actor.organizationId,
            ),
            gt(communityAuthorBoosts.endsAt, now),
          ),
        );
      if (
        Number(activeTotal?.value ?? 0) >= COMMUNITY_AUTHOR_BOOST_MAX_PER_TENANT
      ) {
        throw new ApiError(
          409,
          "conflict",
          `Pro Organisation sind hoechstens ${COMMUNITY_AUTHOR_BOOST_MAX_PER_TENANT} aktive oder geplante Autoren-Boosts erlaubt.`,
        );
      }
    }
    if (
      current &&
      current.strength === input.strength &&
      current.startsAt.getTime() === input.startsAt.getTime() &&
      current.endsAt.getTime() === input.endsAt.getTime() &&
      current.reason === reason
    ) {
      return presentBoost({
        ...current,
        authorFirstName: locked.author.firstName,
        authorLastName: locked.author.lastName,
      });
    }
    const [saved] = current
      ? await tx
          .update(communityAuthorBoosts)
          .set({
            strength: input.strength,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reason,
            createdById: input.actor.id,
            updatedAt: now,
          })
          .where(eq(communityAuthorBoosts.id, current.id))
          .returning()
      : await tx
          .insert(communityAuthorBoosts)
          .values({
            organizationId: input.actor.organizationId,
            authorId: input.authorId,
            strength: input.strength,
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            reason,
            createdById: input.actor.id,
          })
          .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "community.author_boost.replaced",
      entityType: "community_author_boost",
      entityId: saved.id,
      metadata: {
        previous: auditSnapshot(current),
        current: auditSnapshot(saved),
      },
    });
    return presentBoost({
      ...saved,
      authorFirstName: locked.author.firstName,
      authorLastName: locked.author.lastName,
    });
  };
  return input.tx ? execute(input.tx) : db.transaction(execute);
}

export async function removeCommunityAuthorBoost(input: {
  actor: CommunityPolicyActor;
  authorId: string;
  tx?: ApiTransaction;
}) {
  assertAdminActor(input.actor);
  await assertActiveAdminActor(input.actor);
  await consumeBoostMutationRateLimit(input.actor);
  const execute = async (tx: ApiTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-author-boost-tenant-limit-v1",
        input.actor.organizationId,
      ].join(":")}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-author-boost-v1",
        input.actor.organizationId,
        input.authorId,
      ].join(":")}, 0))`,
    );
    await lockBoostAdminActor({ actor: input.actor, tx });
    const [current] = await tx
      .select({ id: communityAuthorBoosts.id })
      .from(communityAuthorBoosts)
      .where(
        and(
          eq(communityAuthorBoosts.organizationId, input.actor.organizationId),
          eq(communityAuthorBoosts.authorId, input.authorId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return { removed: false };
    const [removed] = await tx
      .delete(communityAuthorBoosts)
      .where(
        and(
          eq(communityAuthorBoosts.id, current.id),
          eq(communityAuthorBoosts.organizationId, input.actor.organizationId),
          eq(communityAuthorBoosts.authorId, input.authorId),
        ),
      )
      .returning();
    if (removed) {
      await tx.insert(activityEvents).values({
        organizationId: input.actor.organizationId,
        userId: input.actor.id,
        type: "community.author_boost.removed",
        entityType: "community_author_boost",
        entityId: removed.id,
        metadata: { previous: auditSnapshot(removed) },
      });
    }
    return { removed: Boolean(removed) };
  };
  return input.tx ? execute(input.tx) : db.transaction(execute);
}
