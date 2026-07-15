import { and, asc, count, desc, eq, gte, ilike, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { eventAttendees, events, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { eventCreateSchema } from "@/lib/api/schemas";
import { insertInitialEventLifecycleHistory } from "@/lib/event-lifecycle";
import { privacyActorReference } from "@/lib/privacy/subject-reference";
import {
  eventVisibilitySql,
  normalizeEventAudience,
  replaceEventAudience,
} from "@/lib/event-access";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["events:read"], action: "event.list", resourceType: "event" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(events.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const type = url.searchParams.get("type");
    const userId = url.searchParams.get("userId");
    if (userId) {
      const [member] = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.organizationId, context.organizationId),
            eq(users.role, "member"),
          ),
        )
        .limit(1);
      if (!member) {
        throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
      }
      conditions.push(eventVisibilitySql(userId, context.organizationId));
    }
    if (search) conditions.push(ilike(events.title, `%${search}%`));
    if (from && !Number.isNaN(Date.parse(from))) conditions.push(gte(events.startsAt, new Date(from)));
    if (to && !Number.isNaN(Date.parse(to))) conditions.push(lte(events.startsAt, new Date(to)));
    if (type && ["live_call", "workshop", "deadline", "webinar"].includes(type)) {
      conditions.push(eq(events.type, type as "live_call" | "workshop" | "deadline" | "webinar"));
    }
    const rows = await db
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
        attendeeCount: count(users.id),
      })
      .from(events)
      .leftJoin(eventAttendees, and(eq(eventAttendees.eventId, events.id), eq(eventAttendees.status, "going")))
      .leftJoin(
        users,
        and(
          eq(users.id, eventAttendees.userId),
          eq(users.organizationId, context.organizationId),
          eventVisibilitySql(users.id, context.organizationId),
        ),
      )
      .where(and(...conditions))
      .groupBy(events.id)
      .orderBy(url.searchParams.get("sort") === "startsAt:desc" ? desc(events.startsAt) : asc(events.startsAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["events:write"],
      action: "event.create",
      resourceType: "event",
      idempotent: true,
    },
    {
      prepare: async () => {
        const input = await parseJson(request, eventCreateSchema);
        const { audience, ...eventInput } = input;
        return { audience, eventInput };
      },
      execute: async (
        { context, tx, activity, webhook },
        { audience, eventInput },
      ) => {
        const [created] = await tx
          .insert(events)
          .values({ ...eventInput, organizationId: context.organizationId })
          .returning();
        await insertInitialEventLifecycleHistory(tx, {
          eventId: created.id,
          organizationId: context.organizationId,
          actorReference: privacyActorReference(
            context.organizationId,
            "api_key",
            context.apiKeyId,
          ),
          startsAt: created.startsAt,
          endsAt: created.endsAt,
          timezone: created.timezone,
        });
        let event = created;
        if (audience) {
          const changed = await replaceEventAudience(
            tx,
            created.id,
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
          event = { ...created, audienceMode: changed.audience.mode };
        }
        const normalizedAudience = normalizeEventAudience(audience);
        await activity({
          type: "event.created",
          entityType: "event",
          entityId: event.id,
          metadata: {
            title: event.title,
            startsAt: event.startsAt.toISOString(),
            audienceMode: normalizedAudience.mode,
          },
        });
        await webhook("event.created", event);
        return {
          data: {
            ...event,
            audience: normalizedAudience,
          },
          status: 201,
          resourceId: event.id,
        };
      },
    },
  );
}
