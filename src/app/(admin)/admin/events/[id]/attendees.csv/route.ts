import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventAttendees, events, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { createEventAttendeeCsv } from "@/lib/event-csv";
import { getEventAdminCopy } from "@/lib/i18n/event-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Anmeldung erforderlich.", {
      status: 401,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (!["owner", "admin", "trainer"].some((role) => role === user.role)) {
    return new Response("Keine Berechtigung.", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) {
    return new Response("Termin nicht gefunden.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, parsedId.data),
        eq(events.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  if (!event) {
    return new Response("Termin nicht gefunden.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const locale = await resolveUserLocale(user);
  const copy = getEventAdminCopy(locale);

  const attendees = await db
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      status: eventAttendees.status,
      respondedAt: eventAttendees.respondedAt,
    })
    .from(eventAttendees)
    .innerJoin(
      users,
      and(
        eq(users.id, eventAttendees.userId),
        eq(users.organizationId, user.organizationId),
      ),
    )
    .where(eq(eventAttendees.eventId, event.id))
    .orderBy(asc(users.lastName), asc(users.firstName));

  return new Response(createEventAttendeeCsv(attendees, locale), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${copy.csv.fileName(event.id)}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
