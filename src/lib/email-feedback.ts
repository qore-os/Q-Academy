import "server-only";

import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  emailDeliveries,
  emailDeliveryFeedbackEvents,
  emailSuppressions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  emailSuppressionListQuerySchema,
  mailGatewayFeedbackEventSchema,
  suppressionReasonForEvent,
  type EMAIL_SUPPRESSION_RELEASE_REASONS,
} from "@/lib/email-feedback-model";
import {
  maskEmailAddress,
  maskRecipientName,
} from "@/lib/email-center-model";
import { privacyEmailRecipientReference } from "@/lib/privacy/subject-reference";

const SOFT_BOUNCE_SUPPRESSION_MS = 24 * 60 * 60_000;

type MailGatewayFeedbackEvent = z.output<
  typeof mailGatewayFeedbackEventSchema
>;
type SuppressionListQuery = z.output<
  typeof emailSuppressionListQuerySchema
>;
type SuppressionReleaseReason =
  (typeof EMAIL_SUPPRESSION_RELEASE_REASONS)[number];

export class EmailFeedbackConflictError extends Error {
  constructor() {
    super("The feedback event identifier was already used for another payload.");
    this.name = "EmailFeedbackConflictError";
  }
}

export class EmailFeedbackDeliveryError extends Error {
  constructor() {
    super("The feedback event cannot be assigned to a delivery.");
    this.name = "EmailFeedbackDeliveryError";
  }
}

function suppressionExpiry(
  reason: "hard_bounce" | "soft_bounce" | "complaint",
  occurredAt: Date,
) {
  return reason === "soft_bounce"
    ? new Date(occurredAt.getTime() + SOFT_BOUNCE_SUPPRESSION_MS)
    : null;
}

function strongerSuppressionReason(
  current: "hard_bounce" | "soft_bounce" | "complaint",
  incoming: "hard_bounce" | "soft_bounce" | "complaint",
) {
  const severity = { soft_bounce: 0, hard_bounce: 1, complaint: 2 } as const;
  return severity[incoming] > severity[current] ? incoming : current;
}

export async function processMailGatewayFeedback(input: {
  event: MailGatewayFeedbackEvent;
  payloadHash: string;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`email-feedback:${input.event.organizationId}:${input.event.eventId}`}, 0))`,
    );
    const [existingEvent] = await tx
      .select({
        id: emailDeliveryFeedbackEvents.id,
        payloadHash: emailDeliveryFeedbackEvents.payloadHash,
      })
      .from(emailDeliveryFeedbackEvents)
      .where(
        and(
          eq(
            emailDeliveryFeedbackEvents.organizationId,
            input.event.organizationId,
          ),
          eq(
            emailDeliveryFeedbackEvents.externalEventId,
            input.event.eventId,
          ),
        ),
      )
      .limit(1);
    if (existingEvent) {
      if (existingEvent.payloadHash !== input.payloadHash) {
        throw new EmailFeedbackConflictError();
      }
      return { eventId: existingEvent.id, replayed: true };
    }

    const [delivery] = await tx
      .select({
        id: emailDeliveries.id,
        organizationId: emailDeliveries.organizationId,
        userId: emailDeliveries.userId,
        recipientEmail: emailDeliveries.recipientEmail,
      })
      .from(emailDeliveries)
      .where(
        and(
          eq(emailDeliveries.id, input.event.deliveryId),
          eq(emailDeliveries.organizationId, input.event.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: emailDeliveries });
    if (!delivery) throw new EmailFeedbackDeliveryError();

    const recipientHash = privacyEmailRecipientReference(
      delivery.organizationId,
      delivery.recipientEmail,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`email-suppression:${delivery.organizationId}:${recipientHash}`}, 0))`,
    );

    const [createdEvent] = await tx
      .insert(emailDeliveryFeedbackEvents)
      .values({
        organizationId: delivery.organizationId,
        deliveryId: delivery.id,
        externalEventId: input.event.eventId,
        eventType: input.event.type,
        bounceKind:
          input.event.type === "bounce" ? input.event.bounceKind : null,
        reasonCode: input.event.reasonCode,
        payloadHash: input.payloadHash,
        occurredAt: input.event.occurredAt,
      })
      .returning({ id: emailDeliveryFeedbackEvents.id });
    if (!createdEvent) throw new Error("Feedback event insert failed.");

    const incomingReason = suppressionReasonForEvent(input.event);
    const [activeRow] = await tx
      .select({
        id: emailSuppressions.id,
        reason: emailSuppressions.reason,
        firstOccurredAt: emailSuppressions.firstOccurredAt,
        lastOccurredAt: emailSuppressions.lastOccurredAt,
        expiresAt: emailSuppressions.expiresAt,
      })
      .from(emailSuppressions)
      .where(
        and(
          eq(emailSuppressions.organizationId, delivery.organizationId),
          eq(emailSuppressions.recipientHash, recipientHash),
          isNull(emailSuppressions.releasedAt),
        ),
      )
      .limit(1)
      .for("update", { of: emailSuppressions });

    let suppressionId: string;
    if (activeRow) {
      const reason = strongerSuppressionReason(activeRow.reason, incomingReason);
      const incomingExpiry = suppressionExpiry(reason, input.event.occurredAt);
      const expiresAt =
        reason !== "soft_bounce"
          ? null
          : !activeRow.expiresAt ||
              (incomingExpiry && incomingExpiry > activeRow.expiresAt)
            ? incomingExpiry
            : activeRow.expiresAt;
      const [updated] = await tx
        .update(emailSuppressions)
        .set({
          reason,
          occurrenceCount: sql`${emailSuppressions.occurrenceCount} + 1`,
          firstOccurredAt:
            input.event.occurredAt < activeRow.firstOccurredAt
              ? input.event.occurredAt
              : activeRow.firstOccurredAt,
          lastOccurredAt:
            input.event.occurredAt > activeRow.lastOccurredAt
              ? input.event.occurredAt
              : activeRow.lastOccurredAt,
          sourceDeliveryId: delivery.id,
          expiresAt,
          updatedAt: new Date(),
        })
        .where(eq(emailSuppressions.id, activeRow.id))
        .returning({ id: emailSuppressions.id });
      if (!updated) throw new Error("Suppression update failed.");
      suppressionId = updated.id;
    } else {
      const [created] = await tx
        .insert(emailSuppressions)
        .values({
          organizationId: delivery.organizationId,
          userId: delivery.userId,
          recipientHash,
          reason: incomingReason,
          firstOccurredAt: input.event.occurredAt,
          lastOccurredAt: input.event.occurredAt,
          sourceDeliveryId: delivery.id,
          expiresAt: suppressionExpiry(incomingReason, input.event.occurredAt),
        })
        .returning({ id: emailSuppressions.id });
      if (!created) throw new Error("Suppression insert failed.");
      suppressionId = created.id;
    }

    return {
      eventId: createdEvent.id,
      suppressionId,
      replayed: false,
    };
  });
}

export async function activeEmailSuppression(input: {
  organizationId: string;
  recipientEmail: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const recipientHash = privacyEmailRecipientReference(
    input.organizationId,
    input.recipientEmail,
  );
  const [row] = await db
    .select({ id: emailSuppressions.id, reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.organizationId, input.organizationId),
        eq(emailSuppressions.recipientHash, recipientHash),
        isNull(emailSuppressions.releasedAt),
        or(isNull(emailSuppressions.expiresAt), gt(emailSuppressions.expiresAt, now)),
      ),
    )
    .limit(1);
  return row ?? null;
}

function escapedLikePattern(value: string) {
  return `%${value.replace(/[\\%_]/g, "\\$&")}%`;
}

export async function listEmailSuppressions(
  organizationId: string,
  input: SuppressionListQuery & { limit: number; offset: number },
) {
  const now = new Date();
  const conditions: SQL[] = [eq(emailSuppressions.organizationId, organizationId)];
  if (input.reason) conditions.push(eq(emailSuppressions.reason, input.reason));
  if (input.status === "active") {
    conditions.push(
      isNull(emailSuppressions.releasedAt),
      or(isNull(emailSuppressions.expiresAt), gt(emailSuppressions.expiresAt, now))!,
    );
  } else if (input.status === "released") {
    conditions.push(isNotNull(emailSuppressions.releasedAt));
  } else if (input.status === "expired") {
    conditions.push(
      isNull(emailSuppressions.releasedAt),
      isNotNull(emailSuppressions.expiresAt),
      lte(emailSuppressions.expiresAt, now),
    );
  }
  if (input.search) {
    const pattern = escapedLikePattern(input.search);
    conditions.push(
      or(
        ilike(users.email, pattern),
        ilike(users.firstName, pattern),
        ilike(users.lastName, pattern),
      )!,
    );
  }
  const where = and(...conditions);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: emailSuppressions.id,
        reason: emailSuppressions.reason,
        occurrenceCount: emailSuppressions.occurrenceCount,
        firstOccurredAt: emailSuppressions.firstOccurredAt,
        lastOccurredAt: emailSuppressions.lastOccurredAt,
        expiresAt: emailSuppressions.expiresAt,
        releasedAt: emailSuppressions.releasedAt,
        releaseReason: emailSuppressions.releaseReason,
        createdAt: emailSuppressions.createdAt,
        updatedAt: emailSuppressions.updatedAt,
        recipientEmail: users.email,
        recipientFirstName: users.firstName,
        recipientLastName: users.lastName,
      })
      .from(emailSuppressions)
      .innerJoin(
        users,
        and(
          eq(users.id, emailSuppressions.userId),
          eq(users.organizationId, emailSuppressions.organizationId),
        ),
      )
      .where(where)
      .orderBy(desc(emailSuppressions.updatedAt), desc(emailSuppressions.id))
      .limit(input.limit)
      .offset(input.offset),
    db
      .select({ value: count() })
      .from(emailSuppressions)
      .innerJoin(
        users,
        and(
          eq(users.id, emailSuppressions.userId),
          eq(users.organizationId, emailSuppressions.organizationId),
        ),
      )
      .where(where),
  ]);
  return {
    data: rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      status: row.releasedAt
        ? ("released" as const)
        : row.expiresAt && row.expiresAt <= now
          ? ("expired" as const)
          : ("active" as const),
      occurrenceCount: row.occurrenceCount,
      recipient: {
        email: maskEmailAddress(row.recipientEmail),
        name: maskRecipientName(row.recipientFirstName, row.recipientLastName),
      },
      firstOccurredAt: row.firstOccurredAt,
      lastOccurredAt: row.lastOccurredAt,
      expiresAt: row.expiresAt,
      releasedAt: row.releasedAt,
      releaseReason: row.releaseReason,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total: totalRow?.value ?? 0,
    offset: input.offset,
  };
}

export async function releaseEmailSuppression(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    suppressionId: string;
    actorId: string;
    reason: SuppressionReleaseReason;
    source: "admin" | "api";
  },
) {
  const [row] = await tx
    .select({
      id: emailSuppressions.id,
      releasedAt: emailSuppressions.releasedAt,
      releaseReason: emailSuppressions.releaseReason,
    })
    .from(emailSuppressions)
    .where(
      and(
        eq(emailSuppressions.id, input.suppressionId),
        eq(emailSuppressions.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: emailSuppressions });
  if (!row) {
    throw new ApiError(404, "not_found", "Die Empfaengersperre wurde nicht gefunden.");
  }
  if (row.releasedAt) {
    return {
      id: row.id,
      status: "released" as const,
      releasedAt: row.releasedAt,
      releaseReason: row.releaseReason,
      changed: false,
    };
  }
  const now = new Date();
  const [updated] = await tx
    .update(emailSuppressions)
    .set({
      releasedAt: now,
      releasedById: input.actorId,
      releaseReason: input.reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(emailSuppressions.id, row.id),
        eq(emailSuppressions.organizationId, input.organizationId),
        isNull(emailSuppressions.releasedAt),
      ),
    )
    .returning({ id: emailSuppressions.id });
  if (!updated) throw new ApiError(409, "conflict", "Die Sperre wurde bereits geaendert.");
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorId,
    type: "email.suppression.released",
    entityType: "email_suppression",
    entityId: updated.id,
    metadata: { reason: input.reason, source: input.source },
  });
  return {
    id: updated.id,
    status: "released" as const,
    releasedAt: now,
    releaseReason: input.reason,
    changed: true,
  };
}

export async function releaseEmailSuppressionAsAdmin(input: {
  organizationId: string;
  suppressionId: string;
  actorId: string;
  reason: SuppressionReleaseReason;
}) {
  return db.transaction((tx) =>
    releaseEmailSuppression(tx, { ...input, source: "admin" }),
  );
}
