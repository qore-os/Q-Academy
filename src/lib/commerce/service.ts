import "server-only";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, count, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  bundleCourses,
  bundles,
  commerceEntitlements,
  commerceInboundEvents,
  commerceOrders,
  commerceOutboxEvents,
  commerceProductMappings,
  commerceProducts,
  commerceProviderConnections,
  commerceSubscriptions,
  courseAccessGrants,
  courses,
  enrollments,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import type { WebhookEvent } from "@/lib/api/scopes";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { createInvitationToken } from "@/lib/auth-tokens";
import { getCanonicalTenantAuthOrigin } from "@/lib/branding";
import {
  assertOrganizationFeatureAvailable,
  assertOrganizationSeatCapacity,
} from "@/lib/organization-contracts";
import {
  commerceAccessSource,
  commerceEntitlementSourceKey,
  resolveCommerceLifecycleDecision,
  type NormalizedCommerceEvent,
} from "@/lib/commerce/model";

type CommerceConnection = typeof commerceProviderConnections.$inferSelect;
type CommerceEntitlement = typeof commerceEntitlements.$inferSelect;

export class CommerceEventConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceEventConflictError";
  }
}

export class CommerceConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceConfigurationError";
  }
}

async function refreshEnrollment(
  tx: ApiTransaction,
  organizationId: string,
  userId: string,
  courseId: string,
) {
  const [remaining] = await tx
    .select({ value: count() })
    .from(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, organizationId),
        eq(courseAccessGrants.userId, userId),
        eq(courseAccessGrants.courseId, courseId),
      ),
    );
  await tx
    .update(enrollments)
    .set({ accessActive: Number(remaining?.value ?? 0) > 0 })
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)),
    );
}

async function grantEntitlementAccess(
  tx: ApiTransaction,
  entitlement: Pick<
    CommerceEntitlement,
    "id" | "organizationId" | "userId" | "bundleId"
  >,
) {
  const courseRows = await tx
    .select({ courseId: bundleCourses.courseId })
    .from(bundleCourses)
    .innerJoin(
      courses,
      and(
        eq(courses.id, bundleCourses.courseId),
        eq(courses.organizationId, entitlement.organizationId),
      ),
    )
    .where(eq(bundleCourses.bundleId, entitlement.bundleId));
  for (const { courseId } of courseRows) {
    await tx
      .insert(enrollments)
      .values({ userId: entitlement.userId, courseId, accessActive: true })
      .onConflictDoUpdate({
        target: [enrollments.userId, enrollments.courseId],
        set: { accessActive: true },
      });
    await tx
      .insert(courseAccessGrants)
      .values({
        organizationId: entitlement.organizationId,
        userId: entitlement.userId,
        courseId,
        source: commerceAccessSource(entitlement.id),
      })
      .onConflictDoNothing();
  }
  return courseRows.length;
}

async function revokeEntitlementAccess(
  tx: ApiTransaction,
  entitlement: Pick<
    CommerceEntitlement,
    "id" | "organizationId" | "userId"
  >,
) {
  const revoked = await tx
    .delete(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, entitlement.organizationId),
        eq(courseAccessGrants.userId, entitlement.userId),
        eq(courseAccessGrants.source, commerceAccessSource(entitlement.id)),
      ),
    )
    .returning({ courseId: courseAccessGrants.courseId });
  for (const { courseId } of revoked) {
    await refreshEnrollment(
      tx,
      entitlement.organizationId,
      entitlement.userId,
      courseId,
    );
  }
  return revoked.length;
}

async function publishCommerceEvent(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    aggregateType: string;
    aggregateId: string;
    event: WebhookEvent;
    userId?: string | null;
    payload: Record<string, unknown>;
  },
) {
  const [outbox] = await tx
    .insert(commerceOutboxEvents)
    .values({
      organizationId: input.organizationId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.event,
      payload: input.payload,
    })
    .returning({ id: commerceOutboxEvents.id });
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    type: input.event,
    entityType: input.aggregateType,
    entityId: input.aggregateId,
    metadata: input.payload,
  });
  await enqueueWebhook(input.organizationId, input.event, input.payload, tx);
  await tx
    .update(commerceOutboxEvents)
    .set({ publishedAt: new Date() })
    .where(eq(commerceOutboxEvents.id, outbox.id));
}

async function upsertEntitlement(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    connectionId?: string | null;
    userId: string;
    productId: string;
    bundleId: string;
    orderId?: string | null;
    subscriptionId?: string | null;
    sourceKey: string;
    startsAt: Date;
    endsAt?: Date | null;
  },
) {
  const [existing] = await tx
    .select()
    .from(commerceEntitlements)
    .where(
      and(
        eq(commerceEntitlements.organizationId, input.organizationId),
        eq(commerceEntitlements.sourceKey, input.sourceKey),
      ),
    )
    .limit(1)
    .for("update");
  let entitlement: CommerceEntitlement;
  if (existing) {
    [entitlement] = await tx
      .update(commerceEntitlements)
      .set({
        status: "active",
        endsAt: input.endsAt ?? null,
        revokedAt: null,
        revocationReason: null,
        orderId: input.orderId ?? existing.orderId,
        connectionId: input.connectionId ?? existing.connectionId,
        subscriptionId: input.subscriptionId ?? existing.subscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(commerceEntitlements.id, existing.id))
      .returning();
  } else {
    [entitlement] = await tx
      .insert(commerceEntitlements)
      .values({
        ...input,
        orderId: input.orderId ?? null,
        subscriptionId: input.subscriptionId ?? null,
        endsAt: input.endsAt ?? null,
        status: "active",
      })
      .returning();
  }
  const courseCount = await grantEntitlementAccess(tx, entitlement);
  await publishCommerceEvent(tx, {
    organizationId: input.organizationId,
    aggregateType: "commerce_entitlement",
    aggregateId: entitlement.id,
    event: "commerce.entitlement.granted",
    userId: input.userId,
    payload: {
      entitlementId: entitlement.id,
      userId: input.userId,
      productId: input.productId,
      bundleId: input.bundleId,
      endsAt: entitlement.endsAt?.toISOString() ?? null,
      courseCount,
    },
  });
  return entitlement;
}

async function revokeEntitlement(
  tx: ApiTransaction,
  entitlement: CommerceEntitlement,
  reason: string,
  status: "revoked" | "expired" = "revoked",
) {
  if (entitlement.status !== "active") return entitlement;
  const now = new Date();
  const [updated] = await tx
    .update(commerceEntitlements)
    .set({
      status,
      revokedAt: now,
      revocationReason: reason,
      updatedAt: now,
    })
    .where(
      and(
        eq(commerceEntitlements.id, entitlement.id),
        eq(commerceEntitlements.organizationId, entitlement.organizationId),
        eq(commerceEntitlements.status, "active"),
      ),
    )
    .returning();
  if (!updated) return entitlement;
  const courseCount = await revokeEntitlementAccess(tx, updated);
  await publishCommerceEvent(tx, {
    organizationId: entitlement.organizationId,
    aggregateType: "commerce_entitlement",
    aggregateId: entitlement.id,
    event: "commerce.entitlement.revoked",
    userId: entitlement.userId,
    payload: {
      entitlementId: entitlement.id,
      userId: entitlement.userId,
      productId: entitlement.productId,
      bundleId: entitlement.bundleId,
      reason,
      courseCount,
    },
  });
  return updated;
}

function lifecycleWebhookEvent(
  type: NormalizedCommerceEvent["type"],
): WebhookEvent | null {
  if (type === "order_created") return "commerce.order.created";
  if (type === "subscription_activated") {
    return "commerce.subscription.activated";
  }
  if (type === "payment_failed") {
    return "commerce.subscription.payment_failed";
  }
  if (type === "subscription_cancelled") {
    return "commerce.subscription.cancelled";
  }
  if (type === "subscription_expired" || type === "refunded") {
    return "commerce.subscription.expired";
  }
  return null;
}

async function existingOrInvitedMember(
  tx: ApiTransaction,
  input: {
    connection: CommerceConnection;
    event: NormalizedCommerceEvent;
    passwordHash: string;
    invitationOrigin: string;
    allowCreate: boolean;
  },
) {
  const [existing] = await tx
    .select()
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.connection.organizationId),
        eq(users.email, input.event.customerEmail),
      ),
    )
    .limit(1)
    .for("update");
  if (existing) {
    if (existing.role !== "member") {
      throw new CommerceConfigurationError(
        "Die Kaeuferadresse gehoert zu einem privilegierten Konto.",
      );
    }
    if (existing.status === "disabled") {
      throw new CommerceConfigurationError(
        "Das zugeordnete Mitgliedskonto ist deaktiviert.",
      );
    }
    return { user: existing, created: false };
  }
  if (!input.allowCreate || !input.connection.autoCreateMembers) {
    throw new CommerceConfigurationError(
      "Fuer diese Kaeuferadresse existiert kein Mitglied.",
    );
  }
  await assertOrganizationSeatCapacity(tx, {
    organizationId: input.connection.organizationId,
  });
  const [created] = await tx
    .insert(users)
    .values({
      organizationId: input.connection.organizationId,
      email: input.event.customerEmail,
      passwordHash: input.passwordHash,
      firstName: input.event.customerFirstName,
      lastName: input.event.customerLastName,
      role: "member",
      status: "invited",
    })
    .returning();
  await createInvitationToken(
    {
      organizationId: input.connection.organizationId,
      userId: created.id,
      email: created.email,
      deliveryOrigin: input.invitationOrigin,
    },
    tx,
  );
  await publishCommerceEvent(tx, {
    organizationId: input.connection.organizationId,
    aggregateType: "user",
    aggregateId: created.id,
    event: "automation.member.upserted",
    userId: created.id,
    payload: { userId: created.id, created: true, source: "commerce" },
  });
  return { user: created, created: true };
}

export async function processInboundCommerceEvent(input: {
  connection: CommerceConnection;
  event: NormalizedCommerceEvent;
  payloadHash: string;
}) {
  await assertOrganizationFeatureAvailable(
    db,
    input.connection.organizationId,
    "commerce",
  );
  const passwordHash = await hash(randomBytes(48).toString("base64url"), 12);
  const invitationOrigin = await getCanonicalTenantAuthOrigin(
    input.connection.organizationId,
  );
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`commerce-inbound:${input.connection.id}:${input.event.externalEventId}`}, 0))`,
      );
      const [currentConnection] = await tx
        .select({
          id: commerceProviderConnections.id,
          active: commerceProviderConnections.active,
          provider: commerceProviderConnections.provider,
          endpointKey: commerceProviderConnections.endpointKey,
          signatureMode: commerceProviderConnections.signatureMode,
          signingSecretEncrypted:
            commerceProviderConnections.signingSecretEncrypted,
          autoCreateMembers: commerceProviderConnections.autoCreateMembers,
          updatedAt: commerceProviderConnections.updatedAt,
        })
        .from(commerceProviderConnections)
        .where(
          and(
            eq(commerceProviderConnections.id, input.connection.id),
            eq(
              commerceProviderConnections.organizationId,
              input.connection.organizationId,
            ),
          ),
        )
        .limit(1)
        .for("share");
      if (
        !currentConnection?.active ||
        currentConnection.provider !== input.connection.provider ||
        currentConnection.endpointKey !== input.connection.endpointKey ||
        currentConnection.signatureMode !== input.connection.signatureMode ||
        currentConnection.signingSecretEncrypted !==
          input.connection.signingSecretEncrypted ||
        currentConnection.autoCreateMembers !==
          input.connection.autoCreateMembers ||
        currentConnection.updatedAt.getTime() !==
          input.connection.updatedAt.getTime()
      ) {
        throw new CommerceConfigurationError(
          "Die Providerverbindung wurde waehrend der Verarbeitung geaendert oder deaktiviert.",
        );
      }
      const [existingEvent] = await tx
        .select()
        .from(commerceInboundEvents)
        .where(
          and(
            eq(commerceInboundEvents.connectionId, input.connection.id),
            eq(
              commerceInboundEvents.externalEventId,
              input.event.externalEventId,
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (existingEvent?.payloadHash !== undefined &&
          existingEvent.payloadHash !== input.payloadHash) {
        throw new CommerceEventConflictError(
          "Die Ereignis-ID wurde bereits mit einem anderen Payload verwendet.",
        );
      }
      if (existingEvent?.status === "processed" || existingEvent?.status === "ignored") {
        return { replayed: true, eventId: existingEvent.id };
      }
      const normalizedPayload = {
        externalOrderId: input.event.externalOrderId,
        externalSubscriptionId: input.event.externalSubscriptionId,
        providerProductId: input.event.providerProductId,
        providerVariantId: input.event.providerVariantId,
        customerEmail: input.event.customerEmail,
        occurredAt: input.event.occurredAt.toISOString(),
        accessUntil: input.event.accessUntil?.toISOString() ?? null,
      };
      const lifecycle = resolveCommerceLifecycleDecision(
        input.event.type,
        input.event.accessUntil,
      );
      const acquisitionEvent =
        input.event.type === "order_created" ||
        input.event.type === "subscription_activated";
      const [inbound] = existingEvent
        ? await tx
            .update(commerceInboundEvents)
            .set({
              eventType: input.event.type,
              normalizedPayload,
              status: "processing",
              errorCode: null,
              processedAt: null,
            })
            .where(eq(commerceInboundEvents.id, existingEvent.id))
            .returning()
        : await tx
            .insert(commerceInboundEvents)
            .values({
              organizationId: input.connection.organizationId,
              connectionId: input.connection.id,
              externalEventId: input.event.externalEventId,
              eventType: input.event.type,
              payloadHash: input.payloadHash,
              normalizedPayload,
            })
            .returning();
      const [mapping] = await tx
        .select({
          mapping: commerceProductMappings,
          product: commerceProducts,
        })
        .from(commerceProductMappings)
        .innerJoin(
          commerceProducts,
          and(
            eq(commerceProducts.id, commerceProductMappings.productId),
            eq(
              commerceProducts.organizationId,
              commerceProductMappings.organizationId,
            ),
            acquisitionEvent ? eq(commerceProducts.active, true) : undefined,
          ),
        )
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, commerceProducts.bundleId),
            eq(bundles.organizationId, commerceProducts.organizationId),
            acquisitionEvent ? eq(bundles.active, true) : undefined,
          ),
        )
        .where(
          and(
            eq(
              commerceProductMappings.organizationId,
              input.connection.organizationId,
            ),
            eq(commerceProductMappings.connectionId, input.connection.id),
            eq(
              commerceProductMappings.providerProductId,
              input.event.providerProductId,
            ),
            or(
              eq(
                commerceProductMappings.providerVariantId,
                input.event.providerVariantId ?? "",
              ),
              eq(commerceProductMappings.providerVariantId, ""),
            ),
            acquisitionEvent
              ? eq(commerceProductMappings.active, true)
              : undefined,
          ),
        )
        .orderBy(
          sql`case when ${commerceProductMappings.providerVariantId} = ${input.event.providerVariantId ?? ""} then 0 else 1 end`,
        )
        .limit(1);
      if (!mapping) {
        throw new CommerceConfigurationError(
          "Fuer das Providerprodukt existiert keine aktive Zuordnung.",
        );
      }
      const { user, created: memberCreated } = await existingOrInvitedMember(tx, {
        connection: input.connection,
        event: input.event,
        passwordHash,
        invitationOrigin,
        allowCreate: acquisitionEvent,
      });
      const orderStatus = input.event.type === "payment_failed"
        ? "payment_failed"
        : input.event.type === "refunded"
          ? "refunded"
          : input.event.type === "subscription_cancelled" ||
              input.event.type === "subscription_expired"
            ? "cancelled"
            : "paid";
      const [order] = await tx
        .insert(commerceOrders)
        .values({
          organizationId: input.connection.organizationId,
          connectionId: input.connection.id,
          productId: mapping.product.id,
          mappingId: mapping.mapping.id,
          userId: user.id,
          externalOrderId: input.event.externalOrderId,
          customerEmail: input.event.customerEmail,
          currency: input.event.currency,
          totalMinor: input.event.totalMinor,
          status: orderStatus,
          orderedAt: input.event.occurredAt,
        })
        .onConflictDoUpdate({
          target: [commerceOrders.connectionId, commerceOrders.externalOrderId],
          set: {
            userId: user.id,
            status: orderStatus,
            currency: input.event.currency,
            totalMinor: input.event.totalMinor,
            updatedAt: new Date(),
          },
        })
        .returning();
      let subscription: typeof commerceSubscriptions.$inferSelect | null = null;
      if (input.event.externalSubscriptionId) {
        const cancelAtPeriodEnd =
          input.event.type === "subscription_cancelled" &&
          Boolean(input.event.accessUntil && input.event.accessUntil > new Date());
        const subscriptionStatus = input.event.type === "payment_failed"
          ? "past_due"
          : input.event.type === "subscription_expired" || input.event.type === "refunded"
            ? "expired"
            : input.event.type === "subscription_cancelled"
              ? "cancelled"
              : "active";
        [subscription] = await tx
          .insert(commerceSubscriptions)
          .values({
            organizationId: input.connection.organizationId,
            connectionId: input.connection.id,
            productId: mapping.product.id,
            orderId: order.id,
            userId: user.id,
            externalSubscriptionId: input.event.externalSubscriptionId,
            status: subscriptionStatus,
            currentPeriodEnd: input.event.accessUntil,
            cancelAtPeriodEnd,
            cancelledAt:
              input.event.type === "subscription_cancelled"
                ? input.event.occurredAt
                : null,
            endedAt:
              subscriptionStatus === "expired" ? input.event.occurredAt : null,
          })
          .onConflictDoUpdate({
            target: [
              commerceSubscriptions.connectionId,
              commerceSubscriptions.externalSubscriptionId,
            ],
            set: {
              orderId: order.id,
              userId: user.id,
              status: subscriptionStatus,
              currentPeriodEnd: input.event.accessUntil,
              cancelAtPeriodEnd,
              cancelledAt:
                input.event.type === "subscription_cancelled"
                  ? input.event.occurredAt
                  : null,
              endedAt:
                subscriptionStatus === "expired"
                  ? input.event.occurredAt
                  : null,
              updatedAt: new Date(),
            },
          })
          .returning();
      }
      const sourceReference = subscription
        ? `subscription:${subscription.externalSubscriptionId}`
        : `order:${order.externalOrderId}`;
      const sourceKey = commerceEntitlementSourceKey({
        connectionId: input.connection.id,
        sourceReference,
        productId: mapping.product.id,
        userId: user.id,
      });
      if (subscription) {
        await tx
          .update(commerceEntitlements)
          .set({
            sourceKey,
            subscriptionId: subscription.id,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(
                commerceEntitlements.organizationId,
                input.connection.organizationId,
              ),
              eq(commerceEntitlements.connectionId, input.connection.id),
              eq(commerceEntitlements.userId, user.id),
              eq(commerceEntitlements.productId, mapping.product.id),
              eq(commerceEntitlements.orderId, order.id),
              isNull(commerceEntitlements.subscriptionId),
            ),
          );
      }
      const [currentEntitlement] = await tx
        .select()
        .from(commerceEntitlements)
        .where(
          and(
            eq(
              commerceEntitlements.organizationId,
              input.connection.organizationId,
            ),
            or(
              eq(commerceEntitlements.sourceKey, sourceKey),
              and(
                eq(commerceEntitlements.connectionId, input.connection.id),
                eq(commerceEntitlements.userId, user.id),
                eq(commerceEntitlements.productId, mapping.product.id),
                or(
                  eq(commerceEntitlements.orderId, order.id),
                  subscription
                    ? eq(commerceEntitlements.subscriptionId, subscription.id)
                    : sql`false`,
                ),
              ),
            ),
          ),
        )
        .limit(1)
        .for("update");
      if (lifecycle.action === "grant") {
        await upsertEntitlement(tx, {
          organizationId: input.connection.organizationId,
          connectionId: input.connection.id,
          userId: user.id,
          productId: mapping.product.id,
          bundleId: mapping.product.bundleId,
          orderId: order.id,
          subscriptionId: subscription?.id ?? null,
          sourceKey,
          startsAt: input.event.occurredAt,
          endsAt: lifecycle.endsAt,
        });
      } else if (currentEntitlement) {
        await revokeEntitlement(
          tx,
          currentEntitlement,
          input.event.type,
          lifecycle.terminalStatus,
        );
      }
      const event = lifecycleWebhookEvent(input.event.type);
      if (event) {
        await publishCommerceEvent(tx, {
          organizationId: input.connection.organizationId,
          aggregateType: subscription ? "commerce_subscription" : "commerce_order",
          aggregateId: subscription?.id ?? order.id,
          event,
          userId: user.id,
          payload: {
            orderId: order.id,
            subscriptionId: subscription?.id ?? null,
            userId: user.id,
            productId: mapping.product.id,
            provider: input.connection.provider,
            externalEventId: input.event.externalEventId,
          },
        });
      }
      await tx
        .update(commerceInboundEvents)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(commerceInboundEvents.id, inbound.id));
      return {
        replayed: false,
        eventId: inbound.id,
        orderId: order.id,
        subscriptionId: subscription?.id ?? null,
        userId: user.id,
        memberCreated,
      };
    });
  } catch (error) {
    if (!(error instanceof CommerceEventConflictError)) {
      const errorCode = error instanceof CommerceConfigurationError
        ? "configuration_error"
        : "processing_error";
      await db
        .insert(commerceInboundEvents)
        .values({
          organizationId: input.connection.organizationId,
          connectionId: input.connection.id,
          externalEventId: input.event.externalEventId,
          eventType: input.event.type,
          payloadHash: input.payloadHash,
          normalizedPayload: {
            externalOrderId: input.event.externalOrderId,
            providerProductId: input.event.providerProductId,
          },
          status: "failed",
          errorCode,
          processedAt: new Date(),
        })
        .onConflictDoNothing()
        .catch(() => undefined);
    }
    throw error;
  }
}

export async function applyManualEntitlementCommand(input: {
  organizationId: string;
  actorUserId?: string | null;
  action: "grant" | "revoke";
  userId: string;
  productId: string;
  sourceReference: string;
  endsAt?: Date | null;
  reason?: string | null;
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`commerce-entitlement:${input.organizationId}:${input.userId}:${input.productId}:${input.sourceReference}`}, 0))`,
    );
    const [target] = await tx
      .select({
        product: commerceProducts,
        userId: users.id,
        userStatus: users.status,
        bundleActive: bundles.active,
      })
      .from(commerceProducts)
      .innerJoin(
        users,
        and(
          eq(users.id, input.userId),
          eq(users.organizationId, commerceProducts.organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, commerceProducts.bundleId),
          eq(bundles.organizationId, commerceProducts.organizationId),
        ),
      )
      .where(
        and(
          eq(commerceProducts.id, input.productId),
          eq(commerceProducts.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new ApiError(404, "not_found", "Produkt oder Mitglied wurde nicht gefunden.");
    }
    const sourceKey = commerceEntitlementSourceKey({
      sourceReference: input.sourceReference,
      productId: input.productId,
      userId: input.userId,
    });
    const [existing] = await tx
      .select()
      .from(commerceEntitlements)
      .where(
        and(
          eq(commerceEntitlements.organizationId, input.organizationId),
          eq(commerceEntitlements.sourceKey, sourceKey),
        ),
      )
      .limit(1)
      .for("update");
    if (input.action === "revoke") {
      if (!existing) {
        throw new ApiError(404, "not_found", "Zugriffsrecht wurde nicht gefunden.");
      }
      return revokeEntitlement(tx, existing, input.reason ?? "manual");
    }
    if (
      !target.product.active ||
      !target.bundleActive ||
      target.userStatus === "disabled"
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Nur aktive Produkte, Bundles und Mitgliedskonten koennen berechtigt werden.",
      );
    }
    return upsertEntitlement(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      productId: input.productId,
      bundleId: target.product.bundleId,
      sourceKey,
      startsAt: new Date(),
      endsAt: input.endsAt ?? null,
    });
  });
}

export async function reconcileExpiredCommerceEntitlements(
  organizationId: string,
  now = new Date(),
) {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(commerceEntitlements)
      .where(
        and(
          eq(commerceEntitlements.organizationId, organizationId),
          eq(commerceEntitlements.status, "active"),
          lte(commerceEntitlements.endsAt, now),
        ),
      )
      .orderBy(commerceEntitlements.endsAt, commerceEntitlements.id)
      .limit(500)
      .for("update", { skipLocked: true });
    for (const entitlement of candidates) {
      await revokeEntitlement(tx, entitlement, "remaining_term_ended", "expired");
      if (entitlement.subscriptionId) {
        await tx
          .update(commerceSubscriptions)
          .set({ status: "expired", endedAt: now, updatedAt: now })
          .where(
            and(
              eq(commerceSubscriptions.id, entitlement.subscriptionId),
              eq(commerceSubscriptions.organizationId, organizationId),
            ),
          );
      }
    }
    return { reconciled: candidates.length, hasMore: candidates.length === 500 };
  });
}

export async function reconcileAllExpiredCommerceEntitlements(
  now = new Date(),
) {
  const tenants = await db
    .selectDistinct({ organizationId: commerceEntitlements.organizationId })
    .from(commerceEntitlements)
    .where(
      and(
        eq(commerceEntitlements.status, "active"),
        lte(commerceEntitlements.endsAt, now),
      ),
    )
    .limit(100);
  let reconciled = 0;
  for (const tenant of tenants) {
    const result = await reconcileExpiredCommerceEntitlements(
      tenant.organizationId,
      now,
    );
    reconciled += result.reconciled;
  }
  return { reconciled, tenantCount: tenants.length };
}

export async function upsertAutomationMember(input: {
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  bundleId?: string | null;
  bundleAction: "grant" | "revoke";
  sendInvitation: boolean;
}) {
  await assertOrganizationFeatureAvailable(
    db,
    input.organizationId,
    "automations",
  );
  const passwordHash = await hash(randomBytes(48).toString("base64url"), 12);
  const invitationOrigin = input.sendInvitation
    ? await getCanonicalTenantAuthOrigin(input.organizationId)
    : null;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`automation-member:${input.organizationId}:${input.email}`}, 0))`,
    );
    if (input.bundleId) {
      const [bundle] = await tx
        .select({ id: bundles.id })
        .from(bundles)
        .where(
          and(
            eq(bundles.id, input.bundleId),
            eq(bundles.organizationId, input.organizationId),
            input.bundleAction === "grant"
              ? eq(bundles.active, true)
              : undefined,
          ),
        )
        .limit(1)
        .for("share");
      if (!bundle) {
        throw new ApiError(
          404,
          "not_found",
          input.bundleAction === "grant"
            ? "Bundle wurde nicht gefunden oder ist inaktiv."
            : "Bundle wurde nicht gefunden.",
        );
      }
    }
    const [existing] = await tx
      .select()
      .from(users)
      .where(
        and(
          eq(users.organizationId, input.organizationId),
          eq(users.email, input.email),
        ),
      )
      .limit(1)
      .for("update");
    if (existing && existing.role !== "member") {
      throw new ApiError(409, "conflict", "Die E-Mail-Adresse ist privilegiert gebunden.");
    }
    if (existing?.status === "disabled") {
      throw new ApiError(
        409,
        "conflict",
        "Das Mitgliedskonto ist deaktiviert.",
      );
    }
    if (!existing && input.bundleAction === "revoke") {
      throw new ApiError(
        404,
        "not_found",
        "Das Mitglied wurde fuer den Zugriffsentzug nicht gefunden.",
      );
    }
    if (!existing) {
      await assertOrganizationSeatCapacity(tx, {
        organizationId: input.organizationId,
      });
    }
    const user = existing ?? (
      await tx
        .insert(users)
        .values({
          organizationId: input.organizationId,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          passwordHash,
          role: "member",
          status: "invited",
        })
        .returning()
    )[0];
    if (!existing && input.sendInvitation && invitationOrigin) {
      await createInvitationToken(
        {
          organizationId: input.organizationId,
          userId: user.id,
          email: user.email,
          deliveryOrigin: invitationOrigin,
        },
        tx,
      );
    }
    let bundleAccessChanged = false;
    if (input.bundleId && input.bundleAction === "grant") {
      const productSku = `automation-bundle-${input.bundleId}`;
      const [product] = await tx
        .insert(commerceProducts)
        .values({
          organizationId: input.organizationId,
          name: `Automation: ${input.bundleId}`,
          sku: productSku,
          bundleId: input.bundleId,
          metadata: { managedBy: "automation" },
        })
        .onConflictDoUpdate({
          target: [commerceProducts.organizationId, commerceProducts.sku],
          set: { bundleId: input.bundleId, active: true, updatedAt: new Date() },
        })
        .returning();
      await upsertEntitlement(tx, {
        organizationId: input.organizationId,
        userId: user.id,
        productId: product.id,
        bundleId: input.bundleId,
        sourceKey: commerceEntitlementSourceKey({
          sourceReference: `automation:${input.email}:${input.bundleId}`,
          productId: product.id,
          userId: user.id,
        }),
        startsAt: new Date(),
      });
      bundleAccessChanged = true;
    } else if (input.bundleId && input.bundleAction === "revoke") {
      const productSku = `automation-bundle-${input.bundleId}`;
      const [product] = await tx
        .select({ id: commerceProducts.id })
        .from(commerceProducts)
        .where(
          and(
            eq(commerceProducts.organizationId, input.organizationId),
            eq(commerceProducts.sku, productSku),
          ),
        )
        .limit(1)
        .for("share");
      if (product) {
        const sourceKey = commerceEntitlementSourceKey({
          sourceReference: `automation:${input.email}:${input.bundleId}`,
          productId: product.id,
          userId: user.id,
        });
        const [entitlement] = await tx
          .select()
          .from(commerceEntitlements)
          .where(
            and(
              eq(commerceEntitlements.organizationId, input.organizationId),
              eq(commerceEntitlements.userId, user.id),
              eq(commerceEntitlements.productId, product.id),
              eq(commerceEntitlements.sourceKey, sourceKey),
            ),
          )
          .limit(1)
          .for("update");
        if (entitlement?.status === "active") {
          await revokeEntitlement(
            tx,
            entitlement,
            "automation_bundle_access_revoked",
          );
          bundleAccessChanged = true;
        }
      }
    }
    await publishCommerceEvent(tx, {
      organizationId: input.organizationId,
      aggregateType: "user",
      aggregateId: user.id,
      event: "automation.member.upserted",
      userId: user.id,
      payload: {
        userId: user.id,
        created: !existing,
        bundleId: input.bundleId ?? null,
        bundleAction: input.bundleAction,
        bundleAccessChanged,
      },
    });
    return { user, created: !existing, bundleAccessChanged };
  });
}

export async function commerceConnectionByEndpoint(
  provider: string,
  endpointKey: string,
) {
  const [connection] = await db
    .select()
    .from(commerceProviderConnections)
    .where(
      and(
        eq(commerceProviderConnections.provider, provider),
        eq(commerceProviderConnections.endpointKey, endpointKey),
        eq(commerceProviderConnections.active, true),
      ),
    )
    .limit(1);
  return connection ?? null;
}
