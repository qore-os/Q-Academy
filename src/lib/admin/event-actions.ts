"use server";

import { and, count, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  eventCalendarSettings,
  eventAttendees,
  events,
  users,
} from "@/db/schema";
import {
  eventAudienceSchema,
  eventCreateSchema,
} from "@/lib/api/schemas";
import { requireTeamPermission } from "@/lib/auth";
import {
  applyEventLifecycleTransition,
  type EventLifecycleMutationResult,
} from "@/lib/event-lifecycle";
import {
  cancelEventLifecycleSchema,
  rescheduleEventLifecycleSchema,
} from "@/lib/event-lifecycle-model";
import { privacyActorReference } from "@/lib/privacy/subject-reference";
import { eventCalendarThemeSchema } from "@/lib/event-calendar-theme";
import {
  eventVisibilitySql,
  replaceEventAudience,
} from "@/lib/event-access";

export type EventAdminActionState = {
  ok: boolean | null;
  message: string;
  code?: EventAdminActionCode;
  params?: { count?: number };
};

export type EventAdminActionCode =
  | "invalid"
  | "notFound"
  | "capacityBelowAttendance"
  | "alreadyCancelled"
  | "scheduleUnchanged"
  | "invalidWindow"
  | "startNotFuture"
  | "concurrentChange"
  | "saved"
  | "rescheduled"
  | "cancelled"
  | "audienceInvalid"
  | "audienceTargetInvalid"
  | "audienceSaved"
  | "attendanceInvalid"
  | "attendanceNotFound"
  | "attendanceFull"
  | "attendanceCancelled"
  | "attendanceSaved"
  | "attendanceRemoved"
  | "failed";

export type EventCalendarThemeActionState = {
  ok: boolean | null;
  message: string;
};

const identifierSchema = z.string().uuid();

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function optionalValue(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function revalidateEvents() {
  revalidatePath("/admin/events");
  revalidatePath("/academy/events");
  revalidatePath("/academy");
}

export async function updateEventCalendarThemeAdminAction(
  _state: EventCalendarThemeActionState,
  formData: FormData,
): Promise<EventCalendarThemeActionState> {
  const actor = await requireTeamPermission("events.manage");
  const parsed = eventCalendarThemeSchema.safeParse({
    backgroundColor: value(formData, "backgroundColor"),
    surfaceColor: value(formData, "surfaceColor"),
    borderColor: value(formData, "borderColor"),
    headingColor: value(formData, "headingColor"),
    bodyColor: value(formData, "bodyColor"),
    accentColor: value(formData, "accentColor"),
    liveColor: value(formData, "liveColor"),
    cancelledColor: value(formData, "cancelledColor"),
    density: value(formData, "density"),
    cardRadius: Number(value(formData, "cardRadius")),
  });
  if (!parsed.success) {
    return { ok: false, message: "Das Kalender-Design ist ungueltig." };
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(eventCalendarSettings)
      .values({
        organizationId: actor.organizationId,
        ...parsed.data,
      })
      .onConflictDoUpdate({
        target: eventCalendarSettings.organizationId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "event.calendar_theme.updated",
      entityType: "event_calendar_settings",
      entityId: actor.organizationId,
      metadata: {
        density: parsed.data.density,
        cardRadius: parsed.data.cardRadius,
      },
    });
  });
  revalidateEvents();
  return { ok: true, message: "Kalender-Design gespeichert." };
}

function lifecycleError(
  reason: Extract<EventLifecycleMutationResult, { ok: false }>["reason"],
): EventAdminActionState {
  if (reason === "missing") return { ok: false, message: "Der Termin wurde nicht gefunden.", code: "notFound" };
  if (reason === "already_cancelled") return { ok: false, message: "Der Termin ist bereits abgesagt.", code: "alreadyCancelled" };
  if (reason === "unchanged") return { ok: false, message: "Der neue Zeitraum ist unveraendert.", code: "scheduleUnchanged" };
  if (reason === "invalid_window") return { ok: false, message: "Das Ende muss nach dem Beginn liegen.", code: "invalidWindow" };
  if (reason === "start_not_future") return { ok: false, message: "Der neue Beginn muss in der Zukunft liegen.", code: "startNotFuture" };
  return { ok: false, message: "Der Termin wurde parallel geaendert. Bitte lade die Seite neu.", code: "concurrentChange" };
}

export async function updateEventAdminAction(
  eventId: string,
  _state: EventAdminActionState,
  formData: FormData,
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  if (!identifierSchema.safeParse(eventId).success) {
    return { ok: false, message: "Der Termin ist ungueltig.", code: "invalid" };
  }

  const parsed = eventCreateSchema.safeParse({
    title: value(formData, "title"),
    description: optionalValue(formData, "description"),
    type: value(formData, "type"),
    startsAt: value(formData, "startsAt"),
    endsAt: value(formData, "endsAt"),
    timezone: value(formData, "timezone"),
    meetingUrl: optionalValue(formData, "meetingUrl"),
    location: optionalValue(formData, "location"),
    color: value(formData, "color"),
    capacity: value(formData, "capacity")
      ? Number(value(formData, "capacity"))
      : null,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Bitte pruefe die Termindaten.",
      code: "invalid",
    };
  }
  const capacity = parsed.data.capacity ?? null;
  const eventData = { ...parsed.data };
  delete eventData.audience;
  const requestedStartsAt = eventData.startsAt;
  const requestedEndsAt = eventData.endsAt;
  const detailData = {
    title: eventData.title,
    description: eventData.description,
    type: eventData.type,
    meetingUrl: eventData.meetingUrl,
    location: eventData.location,
    color: eventData.color,
    timezone: eventData.timezone,
  };

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${eventId}`}))`,
    );
    const [current] = await tx
      .select({
        id: events.id,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
      })
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          eq(events.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    if (!current) return "missing" as const;

    const datesChanged =
      current.startsAt.getTime() !== requestedStartsAt.getTime() ||
      current.endsAt.getTime() !== requestedEndsAt.getTime();
    if (capacity !== null) {
      const [attendance] = await tx
        .select({ value: count() })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, eventId),
            eq(eventAttendees.status, "going"),
          ),
        );
      if (Number(attendance?.value ?? 0) > capacity) {
        return "capacity" as const;
      }
    }

    await tx
      .update(events)
      .set({ ...detailData, capacity, updatedAt: new Date() })
      .where(
        and(
          eq(events.id, eventId),
          eq(events.organizationId, actor.organizationId),
        ),
      );
    if (datesChanged) {
      const lifecycle = await applyEventLifecycleTransition(tx, {
        eventId,
        organizationId: actor.organizationId,
        actor: {
          reference: privacyActorReference(
            actor.organizationId,
            "user",
            actor.id,
          ),
          userId: actor.id,
        },
        command: {
          action: "reschedule",
          startsAt: requestedStartsAt,
          endsAt: requestedEndsAt,
          reason:
            optionalValue(formData, "scheduleReason") ??
            "Terminzeit wurde in der Event-Verwaltung aktualisiert.",
        },
      });
      if (!lifecycle.ok) return lifecycle.reason;
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "event.updated",
      entityType: "event",
      entityId: eventId,
      metadata: { title: parsed.data.title },
    });
    return "updated" as const;
  });

  if (result === "missing") {
    return { ok: false, message: "Der Termin wurde nicht gefunden.", code: "notFound" };
  }
  if (result === "capacity") {
    return {
      ok: false,
      message: "Die Kapazitaet liegt unter der Zahl bestehender Zusagen.",
      code: "capacityBelowAttendance",
    };
  }
  if (result !== "updated") {
    return lifecycleError(result);
  }
  revalidateEvents();
  return { ok: true, message: "Termin gespeichert.", code: "saved" };
}

export async function rescheduleEventAdminAction(
  eventId: string,
  _state: EventAdminActionState,
  formData: FormData,
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  const parsed = rescheduleEventLifecycleSchema.safeParse({
    action: "reschedule",
    startsAt: value(formData, "startsAt"),
    endsAt: value(formData, "endsAt"),
    reason: value(formData, "reason"),
  });
  if (!identifierSchema.safeParse(eventId).success || !parsed.success) {
    return {
      ok: false,
      message:
        parsed.success
          ? "Der Termin ist ungueltig."
          : (parsed.error.issues[0]?.message ?? "Bitte pruefe die Neuplanung."),
      code: "invalid",
    };
  }

  const result = await db.transaction((tx) =>
    applyEventLifecycleTransition(tx, {
      eventId,
      organizationId: actor.organizationId,
      actor: {
        reference: privacyActorReference(
          actor.organizationId,
          "user",
          actor.id,
        ),
        userId: actor.id,
      },
      command: parsed.data,
    }),
  );
  if (!result.ok) return lifecycleError(result.reason);
  revalidateEvents();
  return {
    ok: true,
    message: `Termin neu geplant. ${result.notifiedMembers} Mitglieder wurden informiert.`,
    code: "rescheduled",
    params: { count: result.notifiedMembers },
  };
}

export async function cancelEventAdminAction(
  eventId: string,
  _state: EventAdminActionState,
  formData: FormData,
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  const parsed = cancelEventLifecycleSchema.safeParse({
    action: "cancel",
    reason: value(formData, "reason"),
  });
  if (!identifierSchema.safeParse(eventId).success || !parsed.success) {
    return {
      ok: false,
      message:
        parsed.success
          ? "Der Termin ist ungueltig."
          : (parsed.error.issues[0]?.message ?? "Bitte pruefe die Absage."),
      code: "invalid",
    };
  }

  const result = await db.transaction((tx) =>
    applyEventLifecycleTransition(tx, {
      eventId,
      organizationId: actor.organizationId,
      actor: {
        reference: privacyActorReference(
          actor.organizationId,
          "user",
          actor.id,
        ),
        userId: actor.id,
      },
      command: parsed.data,
    }),
  );
  if (!result.ok) return lifecycleError(result.reason);
  revalidateEvents();
  return {
    ok: true,
    message: `Termin abgesagt. ${result.notifiedMembers} Mitglieder wurden informiert.`,
    code: "cancelled",
    params: { count: result.notifiedMembers },
  };
}

export async function updateEventAudienceAdminAction(
  eventId: string,
  _state: EventAdminActionState,
  formData: FormData,
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  if (!identifierSchema.safeParse(eventId).success) {
    return { ok: false, message: "Der Termin ist ungueltig.", code: "audienceInvalid" };
  }

  const parsed = eventAudienceSchema.safeParse({
    mode: value(formData, "audienceMode"),
    userIds: formData
      .getAll("audienceUserIds")
      .filter((entry): entry is string => typeof entry === "string"),
    groupIds: formData
      .getAll("audienceGroupIds")
      .filter((entry): entry is string => typeof entry === "string"),
    bundleIds: formData
      .getAll("audienceBundleIds")
      .filter((entry): entry is string => typeof entry === "string"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Bitte pruefe die Zielgruppe.",
      code: "audienceInvalid",
    };
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${eventId}`}))`,
    );
    const changed = await replaceEventAudience(
      tx,
      eventId,
      actor.organizationId,
      parsed.data,
    );
    if (!changed.ok) return changed;

    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "event.audience.updated",
      entityType: "event",
      entityId: eventId,
      metadata: {
        mode: changed.audience.mode,
        users: changed.audience.userIds.length,
        groups: changed.audience.groupIds.length,
        bundles: changed.audience.bundleIds.length,
        prunedAttendees: changed.prunedAttendees,
      },
    });
    return changed;
  });

  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "missing"
          ? "Der Termin wurde nicht gefunden."
          : "Mindestens ein Ziel gehoert nicht zu dieser Organisation.",
      code: result.reason === "missing" ? "notFound" : "audienceTargetInvalid",
    };
  }

  revalidateEvents();
  return {
    ok: true,
    message:
      result.prunedAttendees > 0
        ? `Zielgruppe gespeichert. ${result.prunedAttendees} unberechtigte Antworten wurden entfernt.`
        : "Zielgruppe gespeichert.",
    code: "audienceSaved",
    params: { count: result.prunedAttendees },
  };
}

export async function setEventAttendanceAdminAction(
  eventId: string,
  userId: string,
  status: "going" | "maybe" | "declined",
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  const parsed = z
    .object({
      eventId: identifierSchema,
      userId: identifierSchema,
      status: z.enum(["going", "maybe", "declined"]),
    })
    .safeParse({ eventId, userId, status });
  if (!parsed.success) {
    return { ok: false, message: "Die Teilnahmeangaben sind ungueltig.", code: "attendanceInvalid" };
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${eventId}`}))`,
    );
    const [[event], [member], [existing]] = await Promise.all([
      tx
          .select({ id: events.id, capacity: events.capacity, status: events.status })
        .from(events)
        .where(
          and(
            eq(events.id, eventId),
            eq(events.organizationId, actor.organizationId),
            eventVisibilitySql(userId, actor.organizationId),
          ),
        )
        .limit(1),
      tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.organizationId, actor.organizationId),
            eq(users.role, "member"),
          ),
        )
        .limit(1),
      tx
        .select({ status: eventAttendees.status })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, eventId),
            eq(eventAttendees.userId, userId),
          ),
        )
        .limit(1),
    ]);
    if (!event || !member) return "missing" as const;
    if (event.status === "cancelled") return "cancelled" as const;

    if (status === "going" && existing?.status !== "going" && event.capacity) {
      const [attendance] = await tx
        .select({ value: count() })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, eventId),
            eq(eventAttendees.status, "going"),
          ),
        );
      if (Number(attendance?.value ?? 0) >= event.capacity) {
        return "full" as const;
      }
    }

    await tx
      .insert(eventAttendees)
      .values({ eventId, userId, status })
      .onConflictDoUpdate({
        target: [eventAttendees.eventId, eventAttendees.userId],
        set: { status, respondedAt: new Date() },
      });
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "event.attendance.updated",
      entityType: "event",
      entityId: eventId,
      metadata: { memberId: userId, status },
    });
    return "updated" as const;
  });

  if (result === "missing") {
    return { ok: false, message: "Termin oder Mitglied wurde nicht gefunden.", code: "attendanceNotFound" };
  }
  if (result === "full") {
    return { ok: false, message: "Der Termin ist bereits ausgebucht.", code: "attendanceFull" };
  }
  if (result === "cancelled") {
    return { ok: false, message: "Fuer abgesagte Termine kann keine Teilnahme gesetzt werden.", code: "attendanceCancelled" };
  }
  revalidateEvents();
  return { ok: true, message: "Teilnahmestatus gespeichert.", code: "attendanceSaved" };
}

export async function removeEventAttendanceAdminAction(
  eventId: string,
  userId: string,
): Promise<EventAdminActionState> {
  const actor = await requireTeamPermission("events.manage");
  if (
    !identifierSchema.safeParse(eventId).success ||
    !identifierSchema.safeParse(userId).success
  ) {
    return { ok: false, message: "Die Teilnahmeangaben sind ungueltig.", code: "attendanceInvalid" };
  }

  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!event) return { ok: false, message: "Der Termin wurde nicht gefunden.", code: "notFound" };

  await db
    .delete(eventAttendees)
    .where(
      and(
        eq(eventAttendees.eventId, eventId),
        eq(eventAttendees.userId, userId),
      ),
    );
  revalidateEvents();
  return { ok: true, message: "Teilnahmeantwort entfernt.", code: "attendanceRemoved" };
}
