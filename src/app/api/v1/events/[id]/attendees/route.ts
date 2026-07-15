import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventAttendees, events, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { attendanceSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { eventVisibilitySql } from "@/lib/event-access";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["events:read"], action: "event.attendance.list", resourceType: "event" }, async (context) => {
    const [event] = await db.select({ id: events.id }).from(events).where(and(eq(events.id, id), eq(events.organizationId, context.organizationId))).limit(1);
    if (!event) throw new ApiError(404, "not_found", "Event nicht gefunden.");
    const pagination = parsePagination(new URL(request.url));
    const rows = await db.select({ userId: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, status: eventAttendees.status, respondedAt: eventAttendees.respondedAt }).from(eventAttendees).innerJoin(users, and(eq(users.id, eventAttendees.userId), eq(users.organizationId, context.organizationId))).innerJoin(events, eq(events.id, eventAttendees.eventId)).where(and(eq(eventAttendees.eventId, id), eventVisibilitySql(users.id, context.organizationId))).orderBy(asc(users.lastName), asc(users.firstName)).limit(pagination.limit + 1).offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) }, resourceId: id };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["events:write"], action: "event.attendance.update", resourceType: "event", idempotent: true }, async (context) => {
    const input = await parseJson(request, attendanceSchema);
    const attendance = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`event:${id}`}))`,
      );
      const [[event], [member], [existing]] = await Promise.all([
        tx
          .select({ id: events.id, capacity: events.capacity, status: events.status })
          .from(events)
          .where(and(eq(events.id, id), eq(events.organizationId, context.organizationId), eventVisibilitySql(input.userId, context.organizationId)))
          .limit(1),
        tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), eq(users.organizationId, context.organizationId), eq(users.role, "member")))
          .limit(1),
        tx
          .select({ status: eventAttendees.status })
          .from(eventAttendees)
          .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, input.userId)))
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
        .values({ eventId: id, userId: input.userId, status: input.status })
        .onConflictDoUpdate({ target: [eventAttendees.eventId, eventAttendees.userId], set: { status: input.status, respondedAt: new Date() } })
        .returning();
      await enqueueWebhook(context.organizationId, "event.attendance.updated", row, tx);
      return row;
    });
    return { data: attendance, resourceId: id };
  });
}
