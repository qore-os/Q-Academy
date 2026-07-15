import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  emailDeliveries,
  eventLifecycleHistory,
  events,
  notifications,
  users,
} from "@/db/schema";
import { encryptPayload } from "@/lib/api/crypto";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { plainTextToSafeEmailHtml } from "@/lib/email-center-model";
import { eventVisibilitySql } from "@/lib/event-access";
import {
  resolveEventLifecycleTransition,
  type EventLifecycleCommand,
} from "@/lib/event-lifecycle-model";
import { getPublicAppUrl } from "@/lib/server-environment";
import { effectiveLocale, intlLocale, type AppLocale } from "@/lib/i18n/model";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { usersWithEmailNotificationsDisabled } from "@/lib/notification-preferences";

type EventTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type EventLifecycleActor = {
  reference: string;
  userId: string | null;
};

export type EventLifecycleMutationResult =
  | {
      ok: true;
      event: typeof events.$inferSelect;
      history: typeof eventLifecycleHistory.$inferSelect;
      notifiedMembers: number;
    }
  | {
      ok: false;
      reason:
        | "missing"
        | "already_cancelled"
        | "unchanged"
        | "invalid_window"
        | "start_not_future"
        | "conflict";
    };

function lifecycleMessage(input: {
  locale: AppLocale;
  action: "cancelled" | "rescheduled";
  title: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  reason: string;
}) {
  const formatter = new Intl.DateTimeFormat(intlLocale(input.locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: input.timezone,
  });
  const window = `${formatter.format(input.startsAt)} - ${formatter.format(input.endsAt)}`;
  const copy: Record<AppLocale, {
    cancelledTitle: string;
    cancelledSubject: string;
    cancelledBody: string;
    rescheduledTitle: string;
    rescheduledSubject: string;
    rescheduledBody: string;
  }> = {
    de: { cancelledTitle: "Event abgesagt", cancelledSubject: `${input.title} wurde abgesagt`, cancelledBody: `Der Termin „${input.title}“ wurde abgesagt. Grund: ${input.reason}`, rescheduledTitle: "Event neu geplant", rescheduledSubject: `${input.title} wurde neu geplant`, rescheduledBody: `Der Termin „${input.title}“ findet jetzt am ${window} statt. Grund: ${input.reason}` },
    en: { cancelledTitle: "Event cancelled", cancelledSubject: `${input.title} was cancelled`, cancelledBody: `The event “${input.title}” was cancelled. Reason: ${input.reason}`, rescheduledTitle: "Event rescheduled", rescheduledSubject: `${input.title} was rescheduled`, rescheduledBody: `The event “${input.title}” will now take place on ${window}. Reason: ${input.reason}` },
    it: { cancelledTitle: "Evento annullato", cancelledSubject: `${input.title} è stato annullato`, cancelledBody: `L'evento “${input.title}” è stato annullato. Motivo: ${input.reason}`, rescheduledTitle: "Evento riprogrammato", rescheduledSubject: `${input.title} è stato riprogrammato`, rescheduledBody: `L'evento “${input.title}” si terrà ora il ${window}. Motivo: ${input.reason}` },
    es: { cancelledTitle: "Evento cancelado", cancelledSubject: `${input.title} ha sido cancelado`, cancelledBody: `El evento “${input.title}” ha sido cancelado. Motivo: ${input.reason}`, rescheduledTitle: "Evento reprogramado", rescheduledSubject: `${input.title} ha sido reprogramado`, rescheduledBody: `El evento “${input.title}” tendrá lugar ahora el ${window}. Motivo: ${input.reason}` },
    fr: { cancelledTitle: "Événement annulé", cancelledSubject: `${input.title} a été annulé`, cancelledBody: `L'événement « ${input.title} » a été annulé. Motif : ${input.reason}`, rescheduledTitle: "Événement reprogrammé", rescheduledSubject: `${input.title} a été reprogrammé`, rescheduledBody: `L'événement « ${input.title} » aura désormais lieu le ${window}. Motif : ${input.reason}` },
  };
  const localized = copy[input.locale];
  if (input.action === "cancelled") {
    return {
      title: localized.cancelledTitle,
      subject: localized.cancelledSubject,
      body: localized.cancelledBody,
      type: "event_cancelled",
    } as const;
  }
  return {
    title: localized.rescheduledTitle,
    subject: localized.rescheduledSubject,
    body: localized.rescheduledBody,
    type: "event_rescheduled",
  } as const;
}

async function lifecycleRecipients(
  tx: EventTransaction,
  eventId: string,
  organizationId: string,
) {
  return tx
    .select({
      id: users.id,
      email: users.email,
      preferredLocale: users.preferredLocale,
    })
    .from(users)
    .innerJoin(
      events,
      and(
        eq(events.id, eventId),
        eq(events.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
        eventVisibilitySql(users.id, organizationId),
      ),
    );
}

export async function insertInitialEventLifecycleHistory(
  tx: EventTransaction,
  input: {
    eventId: string;
    organizationId: string;
    actorReference: string;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
  },
) {
  const [created] = await tx
    .insert(eventLifecycleHistory)
    .values({
      organizationId: input.organizationId,
      eventId: input.eventId,
      actorReference: input.actorReference,
      action: "created",
      fromStatus: null,
      toStatus: "scheduled",
      previousStartsAt: null,
      previousEndsAt: null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      reason: null,
      revision: 0,
    })
    .returning();
  return created;
}

export async function applyEventLifecycleTransition(
  tx: EventTransaction,
  input: {
    eventId: string;
    organizationId: string;
    actor: EventLifecycleActor;
    command: EventLifecycleCommand;
    now?: Date;
  },
): Promise<EventLifecycleMutationResult> {
  const now = input.now ?? new Date();
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`event:${input.eventId}`}))`,
  );
  const [current] = await tx
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, input.eventId),
        eq(events.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!current) return { ok: false, reason: "missing" };

  const transition = resolveEventLifecycleTransition(
    {
      status: current.status,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
    },
    input.command,
    now,
  );
  if (!transition.ok) return transition;

  const revision = current.lifecycleRevision + 1;
  const [updated] = await tx
    .update(events)
    .set({
      status: transition.toStatus,
      startsAt: transition.startsAt,
      endsAt: transition.endsAt,
      timezone: current.timezone,
      lifecycleRevision: revision,
      updatedAt: now,
    })
    .where(
      and(
        eq(events.id, current.id),
        eq(events.organizationId, input.organizationId),
        eq(events.lifecycleRevision, current.lifecycleRevision),
      ),
    )
    .returning();
  if (!updated) return { ok: false, reason: "conflict" };

  const [history] = await tx
    .insert(eventLifecycleHistory)
    .values({
      organizationId: input.organizationId,
      eventId: current.id,
      actorReference: input.actor.reference,
      action: transition.action,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      previousStartsAt: current.startsAt,
      previousEndsAt: current.endsAt,
      startsAt: transition.startsAt,
      endsAt: transition.endsAt,
      timezone: current.timezone,
      reason: transition.reason,
      revision,
      createdAt: now,
    })
    .returning();

  const href = `/academy/events#event-${current.id}`;
  const absoluteHref = new URL(href, getPublicAppUrl()).toString();
  const [recipients, defaultLocale] = await Promise.all([
    lifecycleRecipients(tx, current.id, input.organizationId),
    getOrganizationDefaultLocale(input.organizationId, tx),
  ]);
  const emailDisabledUserIds = await usersWithEmailNotificationsDisabled(tx, {
    organizationId: input.organizationId,
    userIds: recipients.map(({ id }) => id),
    category: "events",
  });
  const localizedRecipients = recipients.map((recipient) => {
    const locale = effectiveLocale({
      preferredLocale: recipient.preferredLocale,
      defaultLocale,
    });
    return {
      ...recipient,
      locale,
      message: lifecycleMessage({
        locale,
        action: transition.action,
        title: current.title,
        startsAt: transition.startsAt,
        endsAt: transition.endsAt,
        timezone: current.timezone,
        reason: transition.reason,
      }),
    };
  });
  if (recipients.length) {
    await tx.insert(notifications).values(
      localizedRecipients.map((recipient) => ({
        userId: recipient.id,
        title: recipient.message.title,
        body: recipient.message.body,
        type: recipient.message.type,
        category: "events" as const,
        href,
      })),
    );
    const emailRecipients = localizedRecipients.filter(
      ({ id }) => !emailDisabledUserIds.has(id),
    );
    if (emailRecipients.length) {
      await tx.insert(emailDeliveries).values(
        emailRecipients.map((recipient) => {
          const id = randomUUID();
          return {
            id,
            organizationId: input.organizationId,
            userId: recipient.id,
            event:
              transition.action === "cancelled"
                ? "event.cancelled"
                : "event.rescheduled",
            category: "events" as const,
            recipientEmail: recipient.email,
            payload: encryptPayload(
              JSON.stringify({
                subject: recipient.message.subject,
                message: recipient.message.body,
                html: plainTextToSafeEmailHtml(recipient.message.body),
                link: absoluteHref,
                locale: recipient.locale,
              }),
              `email-delivery:${id}`,
            ),
          };
        }),
      );
    }
  }

  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actor.userId,
    type: `event.${transition.action}`,
    entityType: "event",
    entityId: current.id,
    metadata: {
      revision,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      previousStartsAt: current.startsAt.toISOString(),
      previousEndsAt: current.endsAt.toISOString(),
      startsAt: transition.startsAt.toISOString(),
      endsAt: transition.endsAt.toISOString(),
      timezone: current.timezone,
      reason: transition.reason,
      notifiedMembers: recipients.length,
    },
  });
  await enqueueWebhook(
    input.organizationId,
    transition.action === "cancelled"
      ? "event.cancelled"
      : "event.rescheduled",
    {
      id: current.id,
      revision,
      status: transition.toStatus,
      startsAt: transition.startsAt.toISOString(),
      endsAt: transition.endsAt.toISOString(),
      timezone: current.timezone,
      reason: transition.reason,
    },
    tx,
  );

  return {
    ok: true,
    event: updated,
    history,
    notifiedMembers: recipients.length,
  };
}
