import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { eventAttendees, events, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { eventUpdateSchema } from "@/lib/api/schemas";
import { applyEventLifecycleTransition } from "@/lib/event-lifecycle";
import { privacyActorReference } from "@/lib/privacy/subject-reference";
import {
  audienceFromGrantRows,
  eventVisibilitySql,
  getEventAudienceGrants,
  replaceEventAudience,
} from "@/lib/event-access";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertAudienceMember(userId: string, organizationId: string) {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.role, "member"),
      ),
    )
    .limit(1);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

async function eventForOrganization(
  id: string,
  organizationId: string,
  userId?: string | null,
) {
  const conditions = [
    eq(events.id, id),
    eq(events.organizationId, organizationId),
  ];
  if (userId) conditions.push(eventVisibilitySql(userId, organizationId));
  const [event] = await db
    .select()
    .from(events)
    .where(and(...conditions))
    .limit(1);
  if (!event) throw new ApiError(404, "not_found", "Event nicht gefunden.");
  return event;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["events:read"], action: "event.read", resourceType: "event" }, async (context) => {
    const userId = new URL(request.url).searchParams.get("userId");
    if (userId) await assertAudienceMember(userId, context.organizationId);
    const event = await eventForOrganization(
      id,
      context.organizationId,
      userId,
    );
    const attendees = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        status: eventAttendees.status,
        respondedAt: eventAttendees.respondedAt,
      })
      .from(eventAttendees)
      .innerJoin(users, eq(users.id, eventAttendees.userId))
      .where(
        and(
          eq(eventAttendees.eventId, id),
          eq(users.organizationId, context.organizationId),
          eventVisibilitySql(users.id, context.organizationId),
        ),
      )
      .orderBy(asc(users.lastName));
    const grants = await getEventAudienceGrants([id], context.organizationId);
    return {
      data: {
        ...event,
        audience: audienceFromGrantRows(event.audienceMode, grants),
        attendees,
      },
      resourceId: id,
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["events:write"], action: "event.update", resourceType: "event", idempotent: true }, async (context) => {
    const input = await parseJson(request, eventUpdateSchema);
    const {
      audience,
      lifecycleReason,
      startsAt: requestedStartsAt,
      endsAt: requestedEndsAt,
      ...eventInput
    } = input;
    const event = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`event:${id}`}))`,
      );
      const [current] = await tx
        .select()
        .from(events)
        .where(and(eq(events.id, id), eq(events.organizationId, context.organizationId)))
        .limit(1);
      if (!current) throw new ApiError(404, "not_found", "Event nicht gefunden.");
      const startsAt = requestedStartsAt ?? current.startsAt;
      const endsAt = requestedEndsAt ?? current.endsAt;
      if (endsAt <= startsAt) throw new ApiError(422, "validation_error", "endsAt muss nach startsAt liegen.");
      if (eventInput.capacity !== undefined && eventInput.capacity !== null) {
        const [going] = await tx
          .select({ value: count() })
          .from(eventAttendees)
          .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.status, "going")));
        if (Number(going?.value ?? 0) > eventInput.capacity) {
          throw new ApiError(
            422,
            "validation_error",
            "capacity darf nicht unter der Zahl bestehender Zusagen liegen.",
          );
        }
      }
      if (Object.keys(eventInput).length) {
        await tx
          .update(events)
          .set({ ...eventInput, updatedAt: new Date() })
          .where(
            and(
              eq(events.id, id),
              eq(events.organizationId, context.organizationId),
            ),
          );
      }
      if (audience) {
        const changed = await replaceEventAudience(
          tx,
          id,
          context.organizationId,
          audience,
        );
        if (!changed.ok) {
          throw new ApiError(
            422,
            "validation_error",
            "Mindestens ein Ziel gehoert nicht zu dieser Organisation.",
          );
        }
      }
      if (
        startsAt.getTime() !== current.startsAt.getTime() ||
        endsAt.getTime() !== current.endsAt.getTime()
      ) {
        const lifecycle = await applyEventLifecycleTransition(tx, {
          eventId: id,
          organizationId: context.organizationId,
          actor: {
            reference: privacyActorReference(
              context.organizationId,
              "api_key",
              context.apiKeyId,
            ),
            userId: null,
          },
          command: {
            action: "reschedule",
            startsAt,
            endsAt,
            reason:
              lifecycleReason ?? "Terminzeit wurde ueber die REST-API aktualisiert.",
          },
        });
        if (!lifecycle.ok) {
          const validationReasons = ["invalid_window", "start_not_future"];
          throw new ApiError(
            validationReasons.includes(lifecycle.reason) ? 422 : 409,
            validationReasons.includes(lifecycle.reason)
              ? "validation_error"
              : "conflict",
            lifecycle.reason === "start_not_future"
              ? "startsAt muss in der Zukunft liegen."
              : "Der Event-Lifecycle konnte nicht aktualisiert werden.",
          );
        }
      }
      const [updated] = await tx
        .select()
        .from(events)
        .where(
          and(
            eq(events.id, id),
            eq(events.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      return updated;
    });
    const grants = await getEventAudienceGrants([id], context.organizationId);
    return {
      data: {
        ...event,
        audience: audienceFromGrantRows(event.audienceMode, grants),
      },
      resourceId: id,
    };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["events:write"], action: "event.delete", resourceType: "event", idempotent: true }, async (context) => {
    await eventForOrganization(id, context.organizationId);
    throw new ApiError(
      409,
      "conflict",
      "Events werden als unveraenderliche Lifecycle-Evidenz nicht geloescht. Verwenden Sie stattdessen den Lifecycle-Befehl cancel.",
    );
  });
}
