import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bundles,
  eventAttendees,
  eventAudienceGrants,
  events,
  groups,
  users,
} from "@/db/schema";
import {
  eventAudienceSchema,
} from "@/lib/api/schemas";
import type { z } from "zod";

type EventTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type EventAudienceInput = z.infer<typeof eventAudienceSchema>;

export type EventAudience = {
  mode: "tenant" | "restricted";
  userIds: string[];
  groupIds: string[];
  bundleIds: string[];
};

export type EventAudienceGrantRow = {
  eventId: string;
  userId: string | null;
  groupId: string | null;
  bundleId: string | null;
};

function unique(values: string[]) {
  return [...new Set(values)];
}

export function normalizeEventAudience(
  input: EventAudienceInput | undefined,
): EventAudience {
  if (!input || input.mode === "tenant") {
    return { mode: "tenant", userIds: [], groupIds: [], bundleIds: [] };
  }
  return {
    mode: "restricted",
    userIds: unique(input.userIds),
    groupIds: unique(input.groupIds),
    bundleIds: unique(input.bundleIds),
  };
}

export function eventVisibilitySql(
  userId: string | typeof users.id,
  organizationId: string,
) {
  return sql<boolean>`(
    "events"."audience_mode" = 'tenant'
    or exists (
      select 1
      from "event_audience_grants" eag
      where eag."event_id" = "events"."id"
        and eag."organization_id" = ${organizationId}
        and (
          eag."user_id" = ${userId}
          or exists (
            select 1
            from "group_members" gm
            inner join "groups" g on g."id" = gm."group_id"
            inner join "users" gu on gu."id" = gm."user_id"
            where gm."group_id" = eag."group_id"
              and gm."user_id" = ${userId}
              and g."organization_id" = ${organizationId}
              and gu."organization_id" = ${organizationId}
          )
          or exists (
            select 1
            from "member_bundles" mb
            inner join "bundles" b on b."id" = mb."bundle_id"
            inner join "users" bu on bu."id" = mb."user_id"
            where mb."bundle_id" = eag."bundle_id"
              and mb."user_id" = ${userId}
              and b."organization_id" = ${organizationId}
              and bu."organization_id" = ${organizationId}
          )
          or exists (
            select 1
            from "group_bundles" gb
            inner join "bundles" b on b."id" = gb."bundle_id"
            inner join "groups" g on g."id" = gb."group_id"
            inner join "group_members" gm on gm."group_id" = gb."group_id"
            inner join "users" gu on gu."id" = gm."user_id"
            where gb."bundle_id" = eag."bundle_id"
              and gm."user_id" = ${userId}
              and b."organization_id" = ${organizationId}
              and g."organization_id" = ${organizationId}
              and gu."organization_id" = ${organizationId}
          )
        )
    )
  )`;
}

async function validateTargets(
  tx: EventTransaction,
  organizationId: string,
  audience: EventAudience,
) {
  const [userRows, groupRows, bundleRows] = await Promise.all([
    audience.userIds.length
      ? tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.role, "member"),
              inArray(users.id, audience.userIds),
            ),
          )
      : Promise.resolve([]),
    audience.groupIds.length
      ? tx
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, organizationId),
              inArray(groups.id, audience.groupIds),
            ),
          )
      : Promise.resolve([]),
    audience.bundleIds.length
      ? tx
          .select({ id: bundles.id })
          .from(bundles)
          .where(
            and(
              eq(bundles.organizationId, organizationId),
              inArray(bundles.id, audience.bundleIds),
            ),
          )
      : Promise.resolve([]),
  ]);

  return (
    userRows.length === audience.userIds.length &&
    groupRows.length === audience.groupIds.length &&
    bundleRows.length === audience.bundleIds.length
  );
}

async function pruneIneligibleAttendees(
  tx: EventTransaction,
  eventId: string,
  organizationId: string,
) {
  const [attendees, eligible] = await Promise.all([
    tx
      .select({ userId: eventAttendees.userId })
      .from(eventAttendees)
      .where(eq(eventAttendees.eventId, eventId)),
    tx
      .select({ userId: eventAttendees.userId })
      .from(eventAttendees)
      .innerJoin(users, eq(users.id, eventAttendees.userId))
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(
        and(
          eq(eventAttendees.eventId, eventId),
          eq(events.organizationId, organizationId),
          eq(users.organizationId, organizationId),
          eventVisibilitySql(users.id, organizationId),
        ),
      ),
  ]);
  const eligibleIds = new Set(eligible.map((row) => row.userId));
  const staleIds = attendees
    .map((row) => row.userId)
    .filter((userId) => !eligibleIds.has(userId));
  if (!staleIds.length) return 0;

  await tx
    .delete(eventAttendees)
    .where(
      and(
        eq(eventAttendees.eventId, eventId),
        inArray(eventAttendees.userId, staleIds),
      ),
    );
  return staleIds.length;
}

export async function replaceEventAudience(
  tx: EventTransaction,
  eventId: string,
  organizationId: string,
  input: EventAudienceInput,
) {
  const audience = normalizeEventAudience(input);
  const [event] = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!event) {
    return { ok: false as const, reason: "missing" as const };
  }

  if (
    audience.mode === "restricted" &&
    (audience.userIds.length +
      audience.groupIds.length +
      audience.bundleIds.length ===
      0 ||
      !(await validateTargets(tx, organizationId, audience)))
  ) {
    return { ok: false as const, reason: "invalid_target" as const };
  }

  await tx
    .update(events)
    .set({ audienceMode: audience.mode })
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
      ),
    );
  await tx
    .delete(eventAudienceGrants)
    .where(
      and(
        eq(eventAudienceGrants.eventId, eventId),
        eq(eventAudienceGrants.organizationId, organizationId),
      ),
    );

  if (audience.mode === "restricted") {
    await tx.insert(eventAudienceGrants).values([
      ...audience.userIds.map((userId) => ({
        organizationId,
        eventId,
        userId,
      })),
      ...audience.groupIds.map((groupId) => ({
        organizationId,
        eventId,
        groupId,
      })),
      ...audience.bundleIds.map((bundleId) => ({
        organizationId,
        eventId,
        bundleId,
      })),
    ]);
  }

  const prunedAttendees =
    audience.mode === "restricted"
      ? await pruneIneligibleAttendees(tx, eventId, organizationId)
      : 0;
  return { ok: true as const, audience, prunedAttendees };
}

export async function getEventAudienceGrants(
  eventIds: string[],
  organizationId: string,
): Promise<EventAudienceGrantRow[]> {
  if (!eventIds.length) return [];
  return db
    .select({
      eventId: eventAudienceGrants.eventId,
      userId: eventAudienceGrants.userId,
      groupId: eventAudienceGrants.groupId,
      bundleId: eventAudienceGrants.bundleId,
    })
    .from(eventAudienceGrants)
    .where(
      and(
        eq(eventAudienceGrants.organizationId, organizationId),
        inArray(eventAudienceGrants.eventId, eventIds),
      ),
    );
}

export function audienceFromGrantRows(
  mode: "tenant" | "restricted",
  rows: EventAudienceGrantRow[],
): EventAudience {
  if (mode === "tenant") return normalizeEventAudience(undefined);
  return {
    mode,
    userIds: rows.flatMap((row) => (row.userId ? [row.userId] : [])),
    groupIds: rows.flatMap((row) => (row.groupId ? [row.groupId] : [])),
    bundleIds: rows.flatMap((row) => (row.bundleId ? [row.bundleId] : [])),
  };
}
