import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventAttendees, events, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { attendanceUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { eventVisibilitySql } from "@/lib/event-access";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(
  eventId: string,
  userId: string,
  organizationId: string,
  requireVisibility = false,
) {
  const eventConditions = [
    eq(events.id, eventId),
    eq(events.organizationId, organizationId),
  ];
  if (requireVisibility) {
    eventConditions.push(eventVisibilitySql(userId, organizationId));
  }
  const [[event], [member]] = await Promise.all([
    db.select({ id: events.id }).from(events).where(and(...eventConditions)).limit(1),
    db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.role, "member"))).limit(1),
  ]);
  if (!event) throw new ApiError(404, "not_found", "Event nicht gefunden.");
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return handleApi(request, { scopes: ["events:read"], action: "event.attendance.read", resourceType: "event" }, async (context) => {
    await assertOwnership(id, userId, context.organizationId, true);
    const [attendance] = await db.select().from(eventAttendees).where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, userId))).limit(1);
    if (!attendance) throw new ApiError(404, "not_found", "Teilnahme nicht gefunden.");
    return { data: attendance, resourceId: id };
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return handleApi(request, { scopes: ["events:write"], action: "event.attendance.update", resourceType: "event", idempotent: true }, async (context) => {
    const input = await parseJson(request, attendanceUpdateSchema);
    const attendance = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`event:${id}`}))`,
      );
      const [[event], [member], [existing]] = await Promise.all([
        tx
          .select({ id: events.id, capacity: events.capacity, status: events.status })
          .from(events)
          .where(and(eq(events.id, id), eq(events.organizationId, context.organizationId), eventVisibilitySql(userId, context.organizationId)))
          .limit(1),
        tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, userId), eq(users.organizationId, context.organizationId), eq(users.role, "member")))
          .limit(1),
        tx
          .select({ status: eventAttendees.status })
          .from(eventAttendees)
          .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, userId)))
          .limit(1),
      ]);
      if (!event) throw new ApiError(404, "not_found", "Event nicht gefunden.");
      if (event.status === "cancelled") {
        throw new ApiError(409, "conflict", "Fuer abgesagte Events kann keine Teilnahme gesetzt werden.");
      }
      if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
      if (input.status === "going" && existing?.status !== "going" && event.capacity) {
        const [going] = await tx
          .select({ value: count() })
          .from(eventAttendees)
          .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.status, "going")));
        if (Number(going?.value ?? 0) >= event.capacity) {
          throw new ApiError(409, "conflict", "Das Event ist bereits ausgebucht.");
        }
      }
      const [row] = await tx
        .insert(eventAttendees)
        .values({ eventId: id, userId, status: input.status })
        .onConflictDoUpdate({ target: [eventAttendees.eventId, eventAttendees.userId], set: { status: input.status, respondedAt: new Date() } })
        .returning();
      await enqueueWebhook(context.organizationId, "event.attendance.updated", row, tx);
      return row;
    });
    return { data: attendance, resourceId: id };
  });
}

export const PATCH = PUT;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return handleApi(request, { scopes: ["events:write"], action: "event.attendance.delete", resourceType: "event", idempotent: true }, async (context) => {
    await assertOwnership(id, userId, context.organizationId);
    await db.delete(eventAttendees).where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, userId)));
    return { data: { eventId: id, userId, deleted: true }, resourceId: id };
  });
}
