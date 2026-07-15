import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  communityAreas,
  communitySpaces,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { CommunitySpaceType } from "@/lib/community-domain";
import { assertCommunityManager } from "@/lib/community-management-auth";

type CommunityLayoutTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const DEFAULT_AREA_TITLE = "Allgemein";
const DEFAULT_AREA_SLUG = "allgemein";

export async function lockCommunityLayoutForTransaction(
  tx: CommunityLayoutTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`community-layout:${organizationId}`}))`,
  );
}

async function rewriteAreaOrder(
  tx: CommunityLayoutTransaction,
  organizationId: string,
  orderedIds: readonly string[],
) {
  if (!orderedIds.length) return;
  const offset = orderedIds.length + 1_000_000;
  await tx
    .update(communityAreas)
    .set({
      sortOrder: sql`${communityAreas.sortOrder} + ${offset}`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(communityAreas.organizationId, organizationId));
  for (const [sortOrder, id] of orderedIds.entries()) {
    await tx
      .update(communityAreas)
      .set({ sortOrder, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(communityAreas.id, id),
          eq(communityAreas.organizationId, organizationId),
        ),
      );
  }
}

async function rewriteSpaceOrder(
  tx: CommunityLayoutTransaction,
  organizationId: string,
  areaId: string,
  orderedIds: readonly string[],
) {
  if (!orderedIds.length) return;
  const offset = orderedIds.length + 1_000_000;
  await tx
    .update(communitySpaces)
    .set({
      sortOrder: sql`${communitySpaces.sortOrder} + ${offset}`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(communitySpaces.organizationId, organizationId),
        eq(communitySpaces.areaId, areaId),
      ),
    );
  for (const [sortOrder, id] of orderedIds.entries()) {
    await tx
      .update(communitySpaces)
      .set({ areaId, sortOrder, updatedAt: sql`clock_timestamp()` })
      .where(
        and(
          eq(communitySpaces.id, id),
          eq(communitySpaces.organizationId, organizationId),
        ),
      );
  }
}

export async function resequenceCommunitySpacesInArea(
  tx: CommunityLayoutTransaction,
  organizationId: string,
  areaId: string,
) {
  const rows = await tx
    .select({ id: communitySpaces.id })
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.organizationId, organizationId),
        eq(communitySpaces.areaId, areaId),
      ),
    )
    .orderBy(asc(communitySpaces.sortOrder), asc(communitySpaces.id))
    .for("update", { of: communitySpaces });
  await rewriteSpaceOrder(
    tx,
    organizationId,
    areaId,
    rows.map((row) => row.id),
  );
}

async function ensureDefaultAreaInTransaction(
  tx: CommunityLayoutTransaction,
  organizationId: string,
) {
  const [existing] = await tx
    .select()
    .from(communityAreas)
    .where(eq(communityAreas.organizationId, organizationId))
    .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(communityAreas)
    .values({
      organizationId,
      title: DEFAULT_AREA_TITLE,
      slug: DEFAULT_AREA_SLUG,
      description: "Allgemeine Community-Bereiche",
      sortOrder: 0,
    })
    .returning();
  return created;
}

export async function ensureDefaultCommunityArea(organizationId: string) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, organizationId);
    return ensureDefaultAreaInTransaction(tx, organizationId);
  });
}

export async function listCommunityLayout(organizationId: string) {
  const [areas, spaces] = await Promise.all([
    db
      .select()
      .from(communityAreas)
      .where(eq(communityAreas.organizationId, organizationId))
      .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id)),
    db
      .select()
      .from(communitySpaces)
      .where(eq(communitySpaces.organizationId, organizationId))
      .orderBy(
        asc(communitySpaces.areaId),
        asc(communitySpaces.sortOrder),
        asc(communitySpaces.id),
      ),
  ]);
  const spacesByArea = new Map<string, typeof spaces>();
  for (const space of spaces) {
    const values = spacesByArea.get(space.areaId) ?? [];
    values.push(space);
    spacesByArea.set(space.areaId, values);
  }
  return areas.map((area) => ({
    ...area,
    spaces: spacesByArea.get(area.id) ?? [],
  }));
}

export async function createCommunityArea(input: {
  organizationId: string;
  actorId: string;
  title: string;
  slug: string;
  description?: string | null;
  position?: number;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const current = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(eq(communityAreas.organizationId, input.organizationId))
      .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id))
      .for("update", { of: communityAreas });
    const [duplicate] = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(
        and(
          eq(communityAreas.organizationId, input.organizationId),
          eq(communityAreas.slug, input.slug),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(
        409,
        "conflict",
        "Eine Community-Area mit diesem Slug existiert bereits.",
      );
    }
    await rewriteAreaOrder(
      tx,
      input.organizationId,
      current.map((area) => area.id),
    );
    const [created] = await tx
      .insert(communityAreas)
      .values({
        organizationId: input.organizationId,
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        sortOrder: current.length,
      })
      .returning();
    const orderedIds = current.map((area) => area.id);
    const position = Math.max(
      0,
      Math.min(input.position ?? orderedIds.length, orderedIds.length),
    );
    orderedIds.splice(position, 0, created.id);
    await rewriteAreaOrder(tx, input.organizationId, orderedIds);
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_area.created",
      entityType: "community_area",
      entityId: created.id,
      metadata: { title: created.title, slug: created.slug, position },
    });
    return { ...created, sortOrder: position };
  });
}

export async function updateCommunityArea(input: {
  organizationId: string;
  actorId: string;
  areaId: string;
  title: string;
  slug: string;
  description?: string | null;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const [current] = await tx
      .select()
      .from(communityAreas)
      .where(
        and(
          eq(communityAreas.id, input.areaId),
          eq(communityAreas.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityAreas });
    if (!current) {
      throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
    }
    const [duplicate] = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(
        and(
          eq(communityAreas.organizationId, input.organizationId),
          eq(communityAreas.slug, input.slug),
        ),
      )
      .limit(1);
    if (duplicate && duplicate.id !== current.id) {
      throw new ApiError(
        409,
        "conflict",
        "Eine Community-Area mit diesem Slug existiert bereits.",
      );
    }
    const [updated] = await tx
      .update(communityAreas)
      .set({
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(communityAreas.id, current.id),
          eq(communityAreas.organizationId, input.organizationId),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_area.updated",
      entityType: "community_area",
      entityId: current.id,
      metadata: { title: updated.title, slug: updated.slug },
    });
    return updated;
  });
}

export async function moveCommunityArea(input: {
  organizationId: string;
  actorId: string;
  areaId: string;
  position: number;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const current = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(eq(communityAreas.organizationId, input.organizationId))
      .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id))
      .for("update", { of: communityAreas });
    const index = current.findIndex((area) => area.id === input.areaId);
    if (index < 0) {
      throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
    }
    const orderedIds = current.map((area) => area.id);
    orderedIds.splice(index, 1);
    const position = Math.max(0, Math.min(input.position, orderedIds.length));
    orderedIds.splice(position, 0, input.areaId);
    await rewriteAreaOrder(tx, input.organizationId, orderedIds);
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_area.moved",
      entityType: "community_area",
      entityId: input.areaId,
      metadata: { from: index, to: position },
    });
    return { id: input.areaId, position };
  });
}

export async function deleteCommunityArea(input: {
  organizationId: string;
  actorId: string;
  areaId: string;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const areas = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(eq(communityAreas.organizationId, input.organizationId))
      .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id))
      .for("update", { of: communityAreas });
    if (!areas.some((area) => area.id === input.areaId)) {
      throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
    }
    const [child] = await tx
      .select({ id: communitySpaces.id })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, input.organizationId),
          eq(communitySpaces.areaId, input.areaId),
        ),
      )
      .limit(1);
    if (child) {
      throw new ApiError(
        409,
        "conflict",
        "Verschiebe oder loesche zuerst alle Bereiche dieser Community-Area.",
      );
    }
    if (areas.length === 1) {
      throw new ApiError(
        409,
        "conflict",
        "Die letzte Community-Area kann nicht geloescht werden.",
      );
    }
    await tx
      .delete(communityAreas)
      .where(
        and(
          eq(communityAreas.id, input.areaId),
          eq(communityAreas.organizationId, input.organizationId),
        ),
      );
    await rewriteAreaOrder(
      tx,
      input.organizationId,
      areas.filter((area) => area.id !== input.areaId).map((area) => area.id),
    );
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_area.deleted",
      entityType: "community_area",
      entityId: input.areaId,
    });
    return { id: input.areaId, deleted: true as const };
  });
}

export async function createCommunitySpaceWithLayout(input: {
  organizationId: string;
  actorId: string;
  areaId?: string | null;
  position?: number;
  title: string;
  slug: string;
  description?: string | null;
  color: string;
  type: CommunitySpaceType;
  accessMode?: "open" | "restricted";
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const area = input.areaId
      ? (
          await tx
            .select()
            .from(communityAreas)
            .where(
              and(
                eq(communityAreas.id, input.areaId),
                eq(communityAreas.organizationId, input.organizationId),
              ),
            )
            .limit(1)
            .for("update", { of: communityAreas })
        )[0]
      : await ensureDefaultAreaInTransaction(tx, input.organizationId);
    if (!area) {
      throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
    }
    const current = await tx
      .select({ id: communitySpaces.id })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, input.organizationId),
          eq(communitySpaces.areaId, area.id),
        ),
      )
      .orderBy(asc(communitySpaces.sortOrder), asc(communitySpaces.id))
      .for("update", { of: communitySpaces });
    const [duplicate] = await tx
      .select({ id: communitySpaces.id })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, input.organizationId),
          eq(communitySpaces.slug, input.slug),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(
        409,
        "conflict",
        "Ein Community-Bereich mit diesem Slug existiert bereits.",
      );
    }
    await rewriteSpaceOrder(
      tx,
      input.organizationId,
      area.id,
      current.map((space) => space.id),
    );
    const [created] = await tx
      .insert(communitySpaces)
      .values({
        organizationId: input.organizationId,
        areaId: area.id,
        title: input.title,
        slug: input.slug,
        description: input.description ?? null,
        color: input.color,
        type: input.type,
        accessMode: input.accessMode ?? "open",
        sortOrder: current.length,
      })
      .returning();
    const orderedIds = current.map((space) => space.id);
    const position = Math.max(
      0,
      Math.min(input.position ?? orderedIds.length, orderedIds.length),
    );
    orderedIds.splice(position, 0, created.id);
    await rewriteSpaceOrder(tx, input.organizationId, area.id, orderedIds);
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_space.created",
      entityType: "community_space",
      entityId: created.id,
      metadata: {
        title: created.title,
        slug: created.slug,
        type: created.type,
        areaId: area.id,
        position,
      },
    });
    return { ...created, sortOrder: position };
  });
}

export async function updateCommunitySpaceWithLayout(input: {
  organizationId: string;
  actorId: string;
  spaceId: string;
  title?: string;
  slug?: string;
  description?: string | null;
  color?: string;
  type?: CommunitySpaceType;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const [current] = await tx
      .select()
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.id, input.spaceId),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communitySpaces });
    if (!current) {
      throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
    }
    const slug = input.slug ?? current.slug;
    if (slug !== current.slug) {
      const [duplicate] = await tx
        .select({ id: communitySpaces.id })
        .from(communitySpaces)
        .where(
          and(
            eq(communitySpaces.organizationId, input.organizationId),
            eq(communitySpaces.slug, slug),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new ApiError(
          409,
          "conflict",
          "Ein Community-Bereich mit diesem Slug existiert bereits.",
        );
      }
    }
    const [updated] = await tx
      .update(communitySpaces)
      .set({
        title: input.title ?? current.title,
        slug,
        description:
          input.description === undefined
            ? current.description
            : input.description,
        color: input.color ?? current.color,
        type: input.type ?? current.type,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(communitySpaces.id, current.id),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_space.updated",
      entityType: "community_space",
      entityId: current.id,
      metadata: {
        title: updated.title,
        slug: updated.slug,
        type: updated.type,
      },
    });
    return updated;
  });
}

export async function moveCommunitySpace(input: {
  organizationId: string;
  actorId: string;
  spaceId: string;
  areaId: string;
  position: number;
}) {
  return db.transaction(async (tx) => {
    await lockCommunityLayoutForTransaction(tx, input.organizationId);
    await assertCommunityManager(tx, input);
    const [space] = await tx
      .select()
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.id, input.spaceId),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communitySpaces });
    const [targetArea] = await tx
      .select({ id: communityAreas.id })
      .from(communityAreas)
      .where(
        and(
          eq(communityAreas.id, input.areaId),
          eq(communityAreas.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communityAreas });
    if (!space || !targetArea) {
      throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
    }
    const affectedAreaIds = [...new Set([space.areaId, targetArea.id])];
    const rows = await tx
      .select({
        id: communitySpaces.id,
        areaId: communitySpaces.areaId,
      })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, input.organizationId),
          inArray(communitySpaces.areaId, affectedAreaIds),
        ),
      )
      .orderBy(
        asc(communitySpaces.areaId),
        asc(communitySpaces.sortOrder),
        asc(communitySpaces.id),
      )
      .for("update", { of: communitySpaces });
    const sourceIds = rows
      .filter((row) => row.areaId === space.areaId && row.id !== space.id)
      .map((row) => row.id);
    const targetIds =
      space.areaId === targetArea.id
        ? sourceIds
        : rows
            .filter((row) => row.areaId === targetArea.id)
            .map((row) => row.id);
    const position = Math.max(0, Math.min(input.position, targetIds.length));
    targetIds.splice(position, 0, space.id);

    if (space.areaId === targetArea.id) {
      await rewriteSpaceOrder(
        tx,
        input.organizationId,
        targetArea.id,
        targetIds,
      );
    } else {
      const offset = rows.length + 1_000_000;
      await tx
        .update(communitySpaces)
        .set({
          sortOrder: sql`${communitySpaces.sortOrder} + ${offset}`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(communitySpaces.organizationId, input.organizationId),
            inArray(communitySpaces.areaId, affectedAreaIds),
          ),
        );
      for (const [sortOrder, id] of sourceIds.entries()) {
        await tx
          .update(communitySpaces)
          .set({
            areaId: space.areaId,
            sortOrder,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(communitySpaces.id, id),
              eq(communitySpaces.organizationId, input.organizationId),
            ),
          );
      }
      for (const [sortOrder, id] of targetIds.entries()) {
        await tx
          .update(communitySpaces)
          .set({
            areaId: targetArea.id,
            sortOrder,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(communitySpaces.id, id),
              eq(communitySpaces.organizationId, input.organizationId),
            ),
          );
      }
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_space.moved",
      entityType: "community_space",
      entityId: space.id,
      metadata: {
        fromAreaId: space.areaId,
        toAreaId: targetArea.id,
        from: space.sortOrder,
        to: position,
      },
    });
    return { id: space.id, areaId: targetArea.id, position };
  });
}
