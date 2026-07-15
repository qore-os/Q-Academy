import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventLifecycleHistory, events } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { applyEventLifecycleTransition } from "@/lib/event-lifecycle";
import { eventLifecycleCommandSchema } from "@/lib/event-lifecycle-model";
import { privacyActorReference } from "@/lib/privacy/subject-reference";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["events:read"],
      action: "event.lifecycle.list",
      resourceType: "event",
    },
    async (context) => {
      const [event] = await db
        .select({ id: events.id })
        .from(events)
        .where(
          and(
            eq(events.id, id),
            eq(events.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!event) throw new ApiError(404, "not_found", "Event nicht gefunden.");
      const history = await db
        .select({
          id: eventLifecycleHistory.id,
          action: eventLifecycleHistory.action,
          fromStatus: eventLifecycleHistory.fromStatus,
          toStatus: eventLifecycleHistory.toStatus,
          previousStartsAt: eventLifecycleHistory.previousStartsAt,
          previousEndsAt: eventLifecycleHistory.previousEndsAt,
          startsAt: eventLifecycleHistory.startsAt,
          endsAt: eventLifecycleHistory.endsAt,
          reason: eventLifecycleHistory.reason,
          revision: eventLifecycleHistory.revision,
          createdAt: eventLifecycleHistory.createdAt,
        })
        .from(eventLifecycleHistory)
        .where(
          and(
            eq(eventLifecycleHistory.eventId, id),
            eq(eventLifecycleHistory.organizationId, context.organizationId),
          ),
        )
        .orderBy(asc(eventLifecycleHistory.revision));
      return { data: history, resourceId: id };
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["events:write"],
      action: "event.lifecycle.update",
      resourceType: "event",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, eventLifecycleCommandSchema),
      execute: async ({ context, tx }, command) => {
        const result = await applyEventLifecycleTransition(tx, {
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
          command,
        });
        if (!result.ok) {
          if (result.reason === "missing") {
            throw new ApiError(404, "not_found", "Event nicht gefunden.");
          }
          if (["invalid_window", "start_not_future"].includes(result.reason)) {
            throw new ApiError(
              422,
              "validation_error",
              result.reason === "start_not_future"
                ? "startsAt muss in der Zukunft liegen."
                : "endsAt muss nach startsAt liegen.",
            );
          }
          throw new ApiError(
            409,
            "conflict",
            result.reason === "already_cancelled"
              ? "Das Event ist bereits abgesagt."
              : "Der Event-Lifecycle wurde nicht geaendert.",
          );
        }
        return {
          data: {
            event: result.event,
            history: {
              id: result.history.id,
              action: result.history.action,
              fromStatus: result.history.fromStatus,
              toStatus: result.history.toStatus,
              previousStartsAt: result.history.previousStartsAt,
              previousEndsAt: result.history.previousEndsAt,
              startsAt: result.history.startsAt,
              endsAt: result.history.endsAt,
              reason: result.history.reason,
              revision: result.history.revision,
              createdAt: result.history.createdAt,
            },
            notifiedMembers: result.notifiedMembers,
          },
          resourceId: id,
        };
      },
    },
  );
}
