import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { events } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getTenantBranding } from "@/lib/branding";
import { eventVisibilitySql } from "@/lib/event-access";
import { createEventCalendar } from "@/lib/icalendar";

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

  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) {
    return new Response("Termin nicht gefunden.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const [[event], branding] = await Promise.all([
    db
      .select({
        id: events.id,
        organizationId: events.organizationId,
        title: events.title,
        description: events.description,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
        location: events.location,
        meetingUrl: events.meetingUrl,
        status: events.status,
        lifecycleRevision: events.lifecycleRevision,
      })
      .from(events)
      .where(
        and(
          eq(events.id, parsedId.data),
          eq(events.organizationId, user.organizationId),
          eventVisibilitySql(user.id, user.organizationId),
        ),
      )
      .limit(1),
    getTenantBranding(user.organizationId),
  ]);
  if (!event) {
    return new Response("Termin nicht gefunden.", {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  return new Response(createEventCalendar(event, branding.platformName), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="event-${event.id}.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
