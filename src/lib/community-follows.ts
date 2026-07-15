import "server-only";

import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  communityFollows,
  communitySpaces,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import {
  communitySpaceVisibilitySql,
  resolveCommunitySpacePermissions,
  type CommunityPolicyActor,
} from "@/lib/community-access";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";

export const COMMUNITY_FOLLOW_TARGET_TYPES = ["author", "space"] as const;
export const COMMUNITY_FOLLOW_MAX_PER_ACTOR = 1_000;
export const COMMUNITY_FOLLOW_PAGE_MAX = 200;
export type CommunityFollowTargetType =
  (typeof COMMUNITY_FOLLOW_TARGET_TYPES)[number];

export type CommunityFollowDto = Readonly<{
  id: string;
  targetType: CommunityFollowTargetType;
  targetId: string;
  notify: boolean;
  createdAt: string;
  updatedAt: string;
  targetLabel: string;
  targetAvatarUrl: string | null;
}>;

function presentFollow(
  row: {
  id: string;
  targetType: CommunityFollowTargetType;
  targetAuthorId: string | null;
  targetSpaceId: string | null;
  notify: boolean;
  createdAt: Date;
  updatedAt: Date;
  authorFirstName: string | null;
  authorLastName: string | null;
  spaceTitle: string | null;
  },
  authorAvatarUrl: string | null,
): CommunityFollowDto {
  const targetId =
    row.targetType === "author" ? row.targetAuthorId : row.targetSpaceId;
  if (!targetId) {
    throw new Error("Community follow target shape is invalid.");
  }
  return {
    id: row.id,
    targetType: row.targetType,
    targetId,
    notify: row.notify,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    targetLabel:
      row.targetType === "author"
        ? `${row.authorFirstName ?? ""} ${row.authorLastName ?? ""}`.trim()
        : (row.spaceTitle ?? "Community-Bereich"),
    targetAvatarUrl: row.targetType === "author" ? authorAvatarUrl : null,
  };
}

async function queryCommunityFollows(
  actor: CommunityPolicyActor,
  limit: number,
  offset: number,
  downloadContext: "session" | "api" = "session",
) {
  const [currentActor] = await db
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
  if (!currentActor) {
    throw new ApiError(403, "forbidden", "Community-Akteur ist nicht aktiv.");
  }
  const rows = await db
    .select({
      id: communityFollows.id,
      targetType: communityFollows.targetType,
      targetAuthorId: communityFollows.targetAuthorId,
      targetSpaceId: communityFollows.targetSpaceId,
      notify: communityFollows.notify,
      createdAt: communityFollows.createdAt,
      updatedAt: communityFollows.updatedAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
      spaceTitle: communitySpaces.title,
      authorStatus: users.status,
    })
    .from(communityFollows)
    .leftJoin(
      users,
      and(
        eq(users.id, communityFollows.targetAuthorId),
        eq(users.organizationId, communityFollows.organizationId),
      ),
    )
    .leftJoin(
      communitySpaces,
      and(
        eq(communitySpaces.id, communityFollows.targetSpaceId),
        eq(communitySpaces.organizationId, communityFollows.organizationId),
      ),
    )
    .where(
      and(
        eq(communityFollows.organizationId, actor.organizationId),
        eq(communityFollows.followerId, actor.id),
        or(
          and(
            eq(communityFollows.targetType, "author"),
            eq(users.status, "active"),
          ),
          and(
            eq(communityFollows.targetType, "space"),
            communitySpaceVisibilitySql(currentActor),
          ),
        ),
        sql`exists (
          select 1 from users follow_actor
          where follow_actor.id = ${currentActor.id}
            and follow_actor.organization_id = ${currentActor.organizationId}
            and follow_actor.status = 'active'
            and follow_actor.role = ${currentActor.role}
        )`,
      ),
    )
    .orderBy(asc(communityFollows.createdAt), asc(communityFollows.id))
    .limit(limit + 1)
    .offset(offset);

  const [unchangedActor] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, currentActor.id),
        eq(users.organizationId, currentActor.organizationId),
        eq(users.status, "active"),
        eq(users.role, currentActor.role),
      ),
    )
    .limit(1);
  if (!unchangedActor) {
    throw new ApiError(
      403,
      "forbidden",
      "Community-Berechtigung hat sich geaendert.",
    );
  }
  const profilesByUser = await getCommunityPublicProfiles({
    organizationId: actor.organizationId,
    memberIds: rows.flatMap((row) =>
      row.targetAuthorId ? [row.targetAuthorId] : [],
    ),
    downloadContext,
  });
  return rows.map((row) =>
    presentFollow(
      row,
      row.targetAuthorId
        ? profilesByUser.get(row.targetAuthorId)?.avatarUrl ?? null
        : null,
    ),
  );
}

export async function listCommunityFollowsPage(
  actor: CommunityPolicyActor,
  input: {
    limit?: number;
    offset?: number;
    downloadContext?: "session" | "api";
  } = {},
) {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > COMMUNITY_FOLLOW_PAGE_MAX ||
    !Number.isInteger(offset) ||
    offset < 0
  ) {
    throw new ApiError(422, "validation_error", "Follow-Seite ist ungueltig.");
  }
  const rows = await queryCommunityFollows(
    actor,
    limit,
    offset,
    input.downloadContext,
  );
  return {
    items: rows.slice(0, limit),
    hasMore: rows.length > limit,
    nextOffset: rows.length > limit ? offset + limit : null,
  };
}

export async function listCommunityFollows(actor: CommunityPolicyActor) {
  const rows = await queryCommunityFollows(
    actor,
    COMMUNITY_FOLLOW_MAX_PER_ACTOR,
    0,
  );
  return rows.slice(0, COMMUNITY_FOLLOW_MAX_PER_ACTOR);
}

async function consumeFollowMutationRateLimit(actor: CommunityPolicyActor) {
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "community_follow_mutation_tenant",
        identifier: actor.organizationId,
      },
    ],
    primary: {
      action: "community_follow_mutation",
      identifier: `${actor.organizationId}\0${actor.id}`,
    },
  });
  if (rateLimit.limited) {
    throw new ApiError(
      429,
      "rate_limit_exceeded",
      "Zu viele Follow-Aenderungen. Bitte versuche es spaeter erneut.",
      { limit: rateLimit.limit, resetAt: rateLimit.resetAt.toISOString() },
    );
  }
}

async function lockFollowTarget(input: {
  tx: ApiTransaction;
  actor: CommunityPolicyActor;
  targetType: CommunityFollowTargetType;
  targetId: string;
}) {
  if (input.targetType === "author") {
    if (input.targetId === input.actor.id) {
      throw new ApiError(
        422,
        "validation_error",
        "Mitglieder koennen sich nicht selbst folgen.",
      );
    }
    const actorIds = [...new Set([input.actor.id, input.targetId])].sort();
    const actorRows = await input.tx
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
          inArray(users.id, actorIds),
          eq(users.organizationId, input.actor.organizationId),
        ),
      )
      .orderBy(asc(users.id))
      .for("share");
    const follower = actorRows.find((row) => row.id === input.actor.id);
    const author = actorRows.find((row) => row.id === input.targetId);
    if (!follower || follower.status !== "active") {
      throw new ApiError(403, "forbidden", "Community-Akteur ist nicht aktiv.");
    }
    if (!author || author.status !== "active") {
      throw new ApiError(404, "not_found", "Community-Autor nicht gefunden.");
    }
    return {
      targetLabel: `${author.firstName} ${author.lastName}`.trim(),
      targetAvatarUrl: null,
    };
  }

  const [space] = await input.tx
    .select({ id: communitySpaces.id, title: communitySpaces.title })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, input.targetId),
        eq(communitySpaces.organizationId, input.actor.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!space) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }
  const [follower] = await input.tx
    .select({ id: users.id, role: users.role, status: users.status })
    .from(users)
    .where(
      and(
        eq(users.id, input.actor.id),
        eq(users.organizationId, input.actor.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!follower || follower.status !== "active") {
    throw new ApiError(403, "forbidden", "Community-Akteur ist nicht aktiv.");
  }
  const access = await resolveCommunitySpacePermissions({
    executor: input.tx,
    actor: {
      id: follower.id,
      role: follower.role,
      organizationId: input.actor.organizationId,
    },
    spaceId: input.targetId,
  });
  if (!access.permissions.canView) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }
  return { targetLabel: space.title, targetAvatarUrl: null };
}

export async function upsertCommunityFollow(input: {
  actor: CommunityPolicyActor;
  targetType: CommunityFollowTargetType;
  targetId: string;
  notify: boolean;
  tx?: ApiTransaction;
  downloadContext?: "session" | "api";
}) {
  await consumeFollowMutationRateLimit(input.actor);
  const now = new Date();
  const execute = async (tx: ApiTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-follow-actor-limit-v1",
        input.actor.organizationId,
        input.actor.id,
      ].join(":")}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-follow-v1",
        input.actor.organizationId,
        input.actor.id,
        input.targetType,
        input.targetId,
      ].join(":")}, 0))`,
    );
    const target = await lockFollowTarget({
      tx,
      actor: input.actor,
      targetType: input.targetType,
      targetId: input.targetId,
    });
    const targetCondition =
      input.targetType === "author"
        ? eq(communityFollows.targetAuthorId, input.targetId)
        : eq(communityFollows.targetSpaceId, input.targetId);
    const [current] = await tx
      .select()
      .from(communityFollows)
      .where(
        and(
          eq(communityFollows.organizationId, input.actor.organizationId),
          eq(communityFollows.followerId, input.actor.id),
          eq(communityFollows.targetType, input.targetType),
          targetCondition,
        ),
      )
      .limit(1)
      .for("update");

    if (!current) {
      const [total] = await tx
        .select({ value: count() })
        .from(communityFollows)
        .where(
          and(
            eq(communityFollows.organizationId, input.actor.organizationId),
            eq(communityFollows.followerId, input.actor.id),
          ),
        );
      if (Number(total?.value ?? 0) >= COMMUNITY_FOLLOW_MAX_PER_ACTOR) {
        throw new ApiError(
          409,
          "conflict",
          `Pro Mitglied sind hoechstens ${COMMUNITY_FOLLOW_MAX_PER_ACTOR} Follows erlaubt.`,
        );
      }
    }

    if (current && current.notify === input.notify) {
      return {
        id: current.id,
        targetType: current.targetType,
        targetId: input.targetId,
        notify: current.notify,
        createdAt: current.createdAt.toISOString(),
        updatedAt: current.updatedAt.toISOString(),
        ...target,
      } satisfies CommunityFollowDto;
    }

    const [saved] = current
      ? await tx
          .update(communityFollows)
          .set({ notify: input.notify, updatedAt: now })
          .where(eq(communityFollows.id, current.id))
          .returning()
      : await tx
          .insert(communityFollows)
          .values({
            organizationId: input.actor.organizationId,
            followerId: input.actor.id,
            targetType: input.targetType,
            targetAuthorId:
              input.targetType === "author" ? input.targetId : null,
            targetSpaceId: input.targetType === "space" ? input.targetId : null,
            notify: input.notify,
          })
          .returning();

    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: current ? "community.follow.updated" : "community.follow.created",
      entityType: "community_follow",
      entityId: saved.id,
      metadata: {
        targetType: input.targetType,
        notify: input.notify,
      },
    });
    return {
      id: saved.id,
      targetType: saved.targetType,
      targetId: input.targetId,
      notify: saved.notify,
      createdAt: saved.createdAt.toISOString(),
      updatedAt: saved.updatedAt.toISOString(),
      ...target,
    } satisfies CommunityFollowDto;
  };
  const saved = input.tx ? await execute(input.tx) : await db.transaction(execute);
  if (input.targetType !== "author") return saved;
  const profiles = await getCommunityPublicProfiles({
    organizationId: input.actor.organizationId,
    memberIds: [input.targetId],
    downloadContext: input.downloadContext,
  });
  return {
    ...saved,
    targetAvatarUrl: profiles.get(input.targetId)?.avatarUrl ?? null,
  };
}

export async function removeCommunityFollow(input: {
  actor: CommunityPolicyActor;
  targetType: CommunityFollowTargetType;
  targetId: string;
  tx?: ApiTransaction;
}) {
  await consumeFollowMutationRateLimit(input.actor);
  const execute = async (tx: ApiTransaction) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${[
        "community-follow-v1",
        input.actor.organizationId,
        input.actor.id,
        input.targetType,
        input.targetId,
      ].join(":")}, 0))`,
    );
    const [follower] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actor.id),
          eq(users.organizationId, input.actor.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1)
      .for("share");
    if (!follower) {
      throw new ApiError(403, "forbidden", "Community-Akteur ist nicht aktiv.");
    }
    const targetCondition =
      input.targetType === "author"
        ? eq(communityFollows.targetAuthorId, input.targetId)
        : eq(communityFollows.targetSpaceId, input.targetId);
    const [removed] = await tx
      .delete(communityFollows)
      .where(
        and(
          eq(communityFollows.organizationId, input.actor.organizationId),
          eq(communityFollows.followerId, input.actor.id),
          eq(communityFollows.targetType, input.targetType),
          targetCondition,
        ),
      )
      .returning({ id: communityFollows.id });
    if (removed) {
      await tx.insert(activityEvents).values({
        organizationId: input.actor.organizationId,
        userId: input.actor.id,
        type: "community.follow.removed",
        entityType: "community_follow",
        entityId: removed.id,
        metadata: { targetType: input.targetType },
      });
    }
    return { removed: Boolean(removed) };
  };
  return input.tx ? execute(input.tx) : db.transaction(execute);
}
