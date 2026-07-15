import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  badgeDefinitions,
  badgeGroups,
  userBadges,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { isAutomaticPointBadgeSource } from "@/lib/community-badge-policy";

const id = z.string().uuid();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const badgeGroupInputSchema = z
  .object({
    id: id.optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).default(""),
    displayMode: z.enum(["all", "highest"]),
    sortOrder: z.number().int().min(0).max(1_000),
    active: z.boolean(),
  })
  .strict();

export const communityBadgeInputSchema = z
  .object({
    id: id.optional(),
    groupId: id.nullable(),
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().min(3).max(5_000),
    icon: z.string().trim().min(1).max(60),
    color,
    pointsThreshold: z.number().int().min(0).max(10_000_000).nullable(),
    sortOrder: z.number().int().min(0).max(1_000),
    active: z.boolean(),
  })
  .strict();

function slug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 110);
}

export async function getCommunityBadgeAdminData(organizationId: string) {
  const [groups, badges, members, awards] = await Promise.all([
    db
      .select()
      .from(badgeGroups)
      .where(eq(badgeGroups.organizationId, organizationId))
      .orderBy(asc(badgeGroups.sortOrder), asc(badgeGroups.name)),
    db
      .select({
        id: badgeDefinitions.id,
        groupId: badgeDefinitions.groupId,
        name: badgeDefinitions.name,
        slug: badgeDefinitions.slug,
        description: badgeDefinitions.description,
        icon: badgeDefinitions.icon,
        color: badgeDefinitions.color,
        pointsThreshold: badgeDefinitions.pointsThreshold,
        sortOrder: badgeDefinitions.sortOrder,
        active: badgeDefinitions.active,
        groupName: badgeGroups.name,
      })
      .from(badgeDefinitions)
      .leftJoin(
        badgeGroups,
        and(
          eq(badgeGroups.id, badgeDefinitions.groupId),
          eq(badgeGroups.organizationId, badgeDefinitions.organizationId),
        ),
      )
      .where(eq(badgeDefinitions.organizationId, organizationId))
      .orderBy(
        asc(badgeGroups.sortOrder),
        asc(badgeDefinitions.sortOrder),
        asc(badgeDefinitions.name),
      ),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(and(eq(users.organizationId, organizationId), eq(users.status, "active")))
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({
        id: userBadges.id,
        userId: userBadges.userId,
        badgeId: userBadges.badgeId,
        awardedAt: userBadges.awardedAt,
        source: userBadges.source,
      })
      .from(userBadges)
      .where(eq(userBadges.organizationId, organizationId))
      .orderBy(asc(userBadges.awardedAt)),
  ]);
  return { groups, badges, members, awards };
}

export async function saveBadgeGroup(input: {
  organizationId: string;
  actorId: string;
  value: z.infer<typeof badgeGroupInputSchema>;
}) {
  const value = badgeGroupInputSchema.parse(input.value);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`badges:${input.organizationId}`}, 0))`,
    );
    const rows = value.id
      ? await tx
          .update(badgeGroups)
          .set({ ...value, id: undefined, updatedAt: new Date() })
          .where(
            and(
              eq(badgeGroups.id, value.id),
              eq(badgeGroups.organizationId, input.organizationId),
            ),
          )
          .returning()
      : await tx
          .insert(badgeGroups)
          .values({ ...value, organizationId: input.organizationId })
          .returning();
    const saved = rows[0];
    if (!saved) throw new ApiError(404, "not_found", "Badge-Gruppe nicht gefunden.");
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: value.id ? "community.badge_group.updated" : "community.badge_group.created",
      entityType: "badge_group",
      entityId: saved.id,
      metadata: { displayMode: saved.displayMode },
    });
    return saved;
  });
}

export async function saveCommunityBadge(input: {
  organizationId: string;
  actorId: string;
  value: z.infer<typeof communityBadgeInputSchema>;
}) {
  const value = communityBadgeInputSchema.parse(input.value);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`badges:${input.organizationId}`}, 0))`,
    );
    if (value.groupId) {
      const [group] = await tx
        .select({ id: badgeGroups.id })
        .from(badgeGroups)
        .where(
          and(
            eq(badgeGroups.id, value.groupId),
            eq(badgeGroups.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!group) throw new ApiError(404, "not_found", "Badge-Gruppe nicht gefunden.");
    }
    const badgeSlug = slug(value.name);
    if (!badgeSlug) throw new ApiError(422, "validation_error", "Der Badge-Name ist ungueltig.");
    const rows = value.id
      ? await tx
          .update(badgeDefinitions)
          .set({ ...value, id: undefined, updatedAt: new Date() })
          .where(
            and(
              eq(badgeDefinitions.id, value.id),
              eq(badgeDefinitions.organizationId, input.organizationId),
            ),
          )
          .returning()
      : await tx
          .insert(badgeDefinitions)
          .values({
            ...value,
            slug: badgeSlug,
            organizationId: input.organizationId,
          })
          .returning();
    const saved = rows[0];
    if (!saved) throw new ApiError(404, "not_found", "Badge nicht gefunden.");
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: value.id ? "community.badge.updated" : "community.badge.created",
      entityType: "badge",
      entityId: saved.id,
      metadata: { groupId: saved.groupId, automatic: saved.pointsThreshold !== null },
    });
    return saved;
  });
}

export async function setManualCommunityBadge(input: {
  organizationId: string;
  actorId: string;
  userId: string;
  badgeId: string;
  awarded: boolean;
}) {
  return db.transaction(async (tx) => {
    const [[member], [badge]] = await Promise.all([
      tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.organizationId, input.organizationId),
            eq(users.status, "active"),
          ),
        )
        .limit(1),
      tx
        .select({ id: badgeDefinitions.id, pointsThreshold: badgeDefinitions.pointsThreshold })
        .from(badgeDefinitions)
        .where(
          and(
            eq(badgeDefinitions.id, input.badgeId),
            eq(badgeDefinitions.organizationId, input.organizationId),
            eq(badgeDefinitions.active, true),
          ),
        )
        .limit(1),
    ]);
    if (!member || !badge) throw new ApiError(404, "not_found", "Mitglied oder Badge nicht gefunden.");
    let changed = false;
    if (input.awarded) {
      const [award] = await tx
        .insert(userBadges)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          badgeId: input.badgeId,
          source: `manual:${input.actorId}`,
        })
        .onConflictDoUpdate({
          target: [userBadges.userId, userBadges.badgeId],
          set: { source: `manual:${input.actorId}`, awardedAt: new Date() },
          setWhere: sql`coalesce(${userBadges.source}, '') !~ '^points:[0-9]+$'`,
        })
        .returning({ id: userBadges.id });
      if (!award) {
        throw new ApiError(
          409,
          "conflict",
          "Ein automatisch vergebener Punkte-Badge kann nicht manuell ueberschrieben werden.",
        );
      }
      changed = true;
    } else {
      const [removed] = await tx
        .delete(userBadges)
        .where(
          and(
            eq(userBadges.organizationId, input.organizationId),
            eq(userBadges.userId, input.userId),
            eq(userBadges.badgeId, input.badgeId),
            sql`coalesce(${userBadges.source}, '') !~ '^points:[0-9]+$'`,
          ),
        )
        .returning({ id: userBadges.id });
      if (!removed) {
        const [current] = await tx
          .select({ source: userBadges.source })
          .from(userBadges)
          .where(
            and(
              eq(userBadges.organizationId, input.organizationId),
              eq(userBadges.userId, input.userId),
              eq(userBadges.badgeId, input.badgeId),
            ),
          )
          .limit(1);
        if (current && isAutomaticPointBadgeSource(current.source)) {
          throw new ApiError(
            409,
            "conflict",
            "Ein automatisch vergebener Punkte-Badge wird nur durch die Punkteberechnung entfernt.",
          );
        }
        return { awarded: false, changed: false };
      }
      changed = true;
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: input.awarded ? "community.badge.awarded" : "community.badge.revoked",
      entityType: "badge",
      entityId: input.badgeId,
      metadata: { subjectUserId: input.userId },
    });
    return { awarded: input.awarded, changed };
  });
}
