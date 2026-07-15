import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bundles,
  eventCalendarSettings,
  eventAttendees,
  eventAudienceGrants,
  eventLifecycleHistory,
  events,
  groupBundles,
  groupMembers,
  groups,
  memberBundles,
  users,
} from "@/db/schema";
import { eventVisibilitySql } from "@/lib/event-access";
import { resolveEventCalendarTheme } from "@/lib/event-calendar-theme";

async function getEventCalendarTheme(organizationId: string) {
  const [row] = await db
    .select({
      backgroundColor: eventCalendarSettings.backgroundColor,
      surfaceColor: eventCalendarSettings.surfaceColor,
      borderColor: eventCalendarSettings.borderColor,
      headingColor: eventCalendarSettings.headingColor,
      bodyColor: eventCalendarSettings.bodyColor,
      accentColor: eventCalendarSettings.accentColor,
      liveColor: eventCalendarSettings.liveColor,
      cancelledColor: eventCalendarSettings.cancelledColor,
      density: eventCalendarSettings.density,
      cardRadius: eventCalendarSettings.cardRadius,
    })
    .from(eventCalendarSettings)
    .where(eq(eventCalendarSettings.organizationId, organizationId))
    .limit(1);
  return resolveEventCalendarTheme(row);
}

export async function getEventsData(userId: string, organizationId: string) {
  const [eventRows, calendarTheme] = await Promise.all([
    db.select({
      id: events.id,
      title: events.title,
      description: events.description,
      type: events.type,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      timezone: events.timezone,
      meetingUrl: events.meetingUrl,
      location: events.location,
      color: events.color,
      capacity: events.capacity,
      status: events.status,
      lifecycleRevision: events.lifecycleRevision,
      attendeeCount:
        sql<number>`(select count(*) from event_attendees ea where ea.event_id = ${events.id} and ea.status = 'going')`.mapWith(
          Number,
        ),
      myStatus: sql<
        "going" | "maybe" | "declined" | null
      >`(select ea.status from event_attendees ea where ea.event_id = ${events.id} and ea.user_id = ${userId})`,
    })
    .from(events)
    .where(
      and(
        eq(events.organizationId, organizationId),
        eventVisibilitySql(userId, organizationId),
      ),
    )
    .orderBy(asc(events.startsAt)),
    getEventCalendarTheme(organizationId),
  ]);

  const historyRows = eventRows.length
    ? await db
        .select({
          id: eventLifecycleHistory.id,
          eventId: eventLifecycleHistory.eventId,
          action: eventLifecycleHistory.action,
          fromStatus: eventLifecycleHistory.fromStatus,
          toStatus: eventLifecycleHistory.toStatus,
          previousStartsAt: eventLifecycleHistory.previousStartsAt,
          previousEndsAt: eventLifecycleHistory.previousEndsAt,
          startsAt: eventLifecycleHistory.startsAt,
          endsAt: eventLifecycleHistory.endsAt,
          timezone: eventLifecycleHistory.timezone,
          reason: eventLifecycleHistory.reason,
          revision: eventLifecycleHistory.revision,
          createdAt: eventLifecycleHistory.createdAt,
        })
        .from(eventLifecycleHistory)
        .where(
          and(
            eq(eventLifecycleHistory.organizationId, organizationId),
            inArray(
              eventLifecycleHistory.eventId,
              eventRows.map((event) => event.id),
            ),
          ),
        )
        .orderBy(desc(eventLifecycleHistory.revision))
    : [];

  return {
    events: eventRows.map((event) => ({
      ...event,
      statusHistory: historyRows.filter((entry) => entry.eventId === event.id),
    })),
    calendarTheme,
  };
}

export async function getAdminEventManagementData(organizationId: string) {
  const [
    eventRows,
    attendeeRows,
    memberRows,
    groupRows,
    bundleRows,
    grantRows,
    lifecycleRows,
    groupMemberRows,
    memberBundleRows,
    groupBundleMemberRows,
    calendarTheme,
  ] = await Promise.all([
    db
      .select({
        id: events.id,
        title: events.title,
        description: events.description,
        type: events.type,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
        meetingUrl: events.meetingUrl,
        location: events.location,
        color: events.color,
        capacity: events.capacity,
        audienceMode: events.audienceMode,
        status: events.status,
        lifecycleRevision: events.lifecycleRevision,
        createdAt: events.createdAt,
        updatedAt: events.updatedAt,
      })
      .from(events)
      .where(eq(events.organizationId, organizationId))
      .orderBy(asc(events.startsAt)),
    db
      .select({
        eventId: eventAttendees.eventId,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: eventAttendees.status,
        respondedAt: eventAttendees.respondedAt,
      })
      .from(eventAttendees)
      .innerJoin(users, eq(users.id, eventAttendees.userId))
      .innerJoin(events, eq(events.id, eventAttendees.eventId))
      .where(
        and(
          eq(events.organizationId, organizationId),
          eq(users.organizationId, organizationId),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(
        and(eq(users.organizationId, organizationId), eq(users.role, "member")),
      )
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.organizationId, organizationId))
      .orderBy(asc(groups.name)),
    db
      .select({ id: bundles.id, name: bundles.name })
      .from(bundles)
      .where(eq(bundles.organizationId, organizationId))
      .orderBy(asc(bundles.name)),
    db
      .select({
        eventId: eventAudienceGrants.eventId,
        userId: eventAudienceGrants.userId,
        groupId: eventAudienceGrants.groupId,
        bundleId: eventAudienceGrants.bundleId,
      })
      .from(eventAudienceGrants)
      .where(eq(eventAudienceGrants.organizationId, organizationId)),
    db
      .select({
        id: eventLifecycleHistory.id,
        eventId: eventLifecycleHistory.eventId,
        action: eventLifecycleHistory.action,
        fromStatus: eventLifecycleHistory.fromStatus,
        toStatus: eventLifecycleHistory.toStatus,
        previousStartsAt: eventLifecycleHistory.previousStartsAt,
        previousEndsAt: eventLifecycleHistory.previousEndsAt,
        startsAt: eventLifecycleHistory.startsAt,
        endsAt: eventLifecycleHistory.endsAt,
        timezone: eventLifecycleHistory.timezone,
        reason: eventLifecycleHistory.reason,
        revision: eventLifecycleHistory.revision,
        createdAt: eventLifecycleHistory.createdAt,
      })
      .from(eventLifecycleHistory)
      .where(eq(eventLifecycleHistory.organizationId, organizationId))
      .orderBy(desc(eventLifecycleHistory.revision)),
    db
      .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(groups.organizationId, organizationId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      ),
    db
      .select({ bundleId: memberBundles.bundleId, userId: memberBundles.userId })
      .from(memberBundles)
      .innerJoin(bundles, eq(bundles.id, memberBundles.bundleId))
      .innerJoin(users, eq(users.id, memberBundles.userId))
      .where(
        and(
          eq(bundles.organizationId, organizationId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      ),
    db
      .select({ bundleId: groupBundles.bundleId, userId: groupMembers.userId })
      .from(groupBundles)
      .innerJoin(bundles, eq(bundles.id, groupBundles.bundleId))
      .innerJoin(groups, eq(groups.id, groupBundles.groupId))
      .innerJoin(groupMembers, eq(groupMembers.groupId, groupBundles.groupId))
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(
        and(
          eq(bundles.organizationId, organizationId),
          eq(groups.organizationId, organizationId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      ),
    getEventCalendarTheme(organizationId),
  ]);

  const groupMembersByGroup = new Map<string, Set<string>>();
  for (const row of groupMemberRows) {
    const memberIds = groupMembersByGroup.get(row.groupId) ?? new Set<string>();
    memberIds.add(row.userId);
    groupMembersByGroup.set(row.groupId, memberIds);
  }
  const bundleMembersByBundle = new Map<string, Set<string>>();
  for (const row of [...memberBundleRows, ...groupBundleMemberRows]) {
    const memberIds =
      bundleMembersByBundle.get(row.bundleId) ?? new Set<string>();
    memberIds.add(row.userId);
    bundleMembersByBundle.set(row.bundleId, memberIds);
  }

  return {
    events: eventRows.map((event) => {
      const attendees = attendeeRows.filter((row) => row.eventId === event.id);
      const eventGrants = grantRows.filter((row) => row.eventId === event.id);
      const eligibleMemberIds = new Set<string>();
      if (event.audienceMode === "tenant") {
        for (const member of memberRows) eligibleMemberIds.add(member.id);
      } else {
        for (const grant of eventGrants) {
          if (grant.userId) eligibleMemberIds.add(grant.userId);
          if (grant.groupId) {
            for (const userId of groupMembersByGroup.get(grant.groupId) ?? []) {
              eligibleMemberIds.add(userId);
            }
          }
          if (grant.bundleId) {
            for (const userId of
              bundleMembersByBundle.get(grant.bundleId) ?? []) {
              eligibleMemberIds.add(userId);
            }
          }
        }
      }
      return {
        ...event,
        audience: {
          mode: event.audienceMode,
          userIds: eventGrants.flatMap((row) =>
            row.userId ? [row.userId] : [],
          ),
          groupIds: eventGrants.flatMap((row) =>
            row.groupId ? [row.groupId] : [],
          ),
          bundleIds: eventGrants.flatMap((row) =>
            row.bundleId ? [row.bundleId] : [],
          ),
        },
        eligibleMemberIds: [...eligibleMemberIds],
        attendees,
        attendeeCount: attendees.filter((row) => row.status === "going").length,
        statusHistory: lifecycleRows.filter((row) => row.eventId === event.id),
      };
    }),
    members: memberRows,
    groups: groupRows,
    bundles: bundleRows,
    calendarTheme,
  };
}
