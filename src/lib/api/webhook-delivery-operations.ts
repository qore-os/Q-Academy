import "server-only";

import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhooks,
} from "@/db/schema";
import {
  presentWebhookDelivery,
  toWebhookDeliverySummary,
  type WebhookDeliveryDetail,
  type WebhookDeliveryStatus,
  type WebhookDeliverySummary,
} from "@/lib/api/webhook-delivery-model";

type DeliveryExecutor = Pick<typeof db, "select" | "update">;

const deliverySelection = {
  id: webhookDeliveries.id,
  webhookId: webhookDeliveries.webhookId,
  webhookName: webhooks.name,
  event: webhookDeliveries.event,
  payload: webhookDeliveries.payload,
  status: webhookDeliveries.status,
  attempt: webhookDeliveries.attempt,
  responseStatus: webhookDeliveries.responseStatus,
  responseBody: webhookDeliveries.responseBody,
  durationMs: webhookDeliveries.durationMs,
  nextRetryAt: webhookDeliveries.nextRetryAt,
  deliveredAt: webhookDeliveries.deliveredAt,
  createdAt: webhookDeliveries.createdAt,
  updatedAt: webhookDeliveries.updatedAt,
};

function tenantJoin(organizationId: string) {
  return and(
    eq(webhooks.id, webhookDeliveries.webhookId),
    eq(webhooks.organizationId, organizationId),
    eq(webhookDeliveries.organizationId, organizationId),
  );
}

export async function webhookExistsForOrganization(
  organizationId: string,
  webhookId: string,
  executor: Pick<typeof db, "select"> = db,
) {
  const [record] = await executor
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.id, webhookId),
        eq(webhooks.organizationId, organizationId),
      ),
    )
    .limit(1);
  return Boolean(record);
}

export async function listWebhookDeliveries(input: {
  organizationId: string;
  webhookId?: string;
  status?: WebhookDeliveryStatus;
  limit: number;
  offset?: number;
  executor?: Pick<typeof db, "select">;
}): Promise<WebhookDeliverySummary[]> {
  const executor = input.executor ?? db;
  const conditions: SQL[] = [
    eq(webhookDeliveries.organizationId, input.organizationId),
  ];
  if (input.webhookId) {
    conditions.push(eq(webhookDeliveries.webhookId, input.webhookId));
  }
  if (input.status) {
    conditions.push(eq(webhookDeliveries.status, input.status));
  }

  const rows = await executor
    .select(deliverySelection)
    .from(webhookDeliveries)
    .innerJoin(webhooks, tenantJoin(input.organizationId))
    .where(and(...conditions))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(input.limit)
    .offset(input.offset ?? 0);
  return rows.map((row) => toWebhookDeliverySummary(presentWebhookDelivery(row)));
}

export async function getWebhookDelivery(input: {
  organizationId: string;
  deliveryId: string;
  webhookId?: string;
  executor?: Pick<typeof db, "select">;
}): Promise<WebhookDeliveryDetail | null> {
  const executor = input.executor ?? db;
  const conditions: SQL[] = [
    eq(webhookDeliveries.id, input.deliveryId),
    eq(webhookDeliveries.organizationId, input.organizationId),
  ];
  if (input.webhookId) {
    conditions.push(eq(webhookDeliveries.webhookId, input.webhookId));
  }
  const [row] = await executor
    .select(deliverySelection)
    .from(webhookDeliveries)
    .innerJoin(webhooks, tenantJoin(input.organizationId))
    .where(and(...conditions))
    .limit(1);
  if (!row) return null;
  const attemptRows = await executor
    .select({
      id: webhookDeliveryAttempts.id,
      replayGeneration: webhookDeliveryAttempts.replayGeneration,
      attempt: webhookDeliveryAttempts.attempt,
      outcome: webhookDeliveryAttempts.outcome,
      responseStatus: webhookDeliveryAttempts.responseStatus,
      responseBodyRedacted: webhookDeliveryAttempts.responseBodyRedacted,
      failureKind: webhookDeliveryAttempts.failureKind,
      durationMs: webhookDeliveryAttempts.durationMs,
      startedAt: webhookDeliveryAttempts.startedAt,
      completedAt: webhookDeliveryAttempts.completedAt,
    })
    .from(webhookDeliveryAttempts)
    .where(
      and(
        eq(webhookDeliveryAttempts.organizationId, input.organizationId),
        eq(webhookDeliveryAttempts.deliveryId, input.deliveryId),
        eq(webhookDeliveryAttempts.webhookId, row.webhookId),
      ),
    )
    .orderBy(
      desc(webhookDeliveryAttempts.completedAt),
      desc(webhookDeliveryAttempts.id),
    )
    .limit(50);
  return presentWebhookDelivery(
    row,
    attemptRows.map((attempt) => ({
      ...attempt,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt.toISOString(),
    })),
  );
}

export type ReplayWebhookDeliveryResult =
  | { kind: "requeued"; delivery: WebhookDeliveryDetail }
  | { kind: "not_found" }
  | { kind: "not_replayable"; status: WebhookDeliveryStatus };

export async function replayFailedWebhookDelivery(input: {
  organizationId: string;
  deliveryId: string;
  webhookId?: string;
  executor?: DeliveryExecutor;
}): Promise<ReplayWebhookDeliveryResult> {
  const executor = input.executor ?? db;
  const conditions: SQL[] = [
    eq(webhookDeliveries.id, input.deliveryId),
    eq(webhookDeliveries.organizationId, input.organizationId),
    eq(webhookDeliveries.status, "failed"),
  ];
  if (input.webhookId) {
    conditions.push(eq(webhookDeliveries.webhookId, input.webhookId));
  }
  const [updated] = await executor
    .update(webhookDeliveries)
    .set({
      status: "pending",
      attempt: 0,
      responseStatus: null,
      responseBody: null,
      durationMs: null,
      nextRetryAt: null,
      claimedAt: null,
      claimToken: null,
      replayGeneration: sql`${webhookDeliveries.replayGeneration} + 1`,
      deliveredAt: null,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({ id: webhookDeliveries.id });

  if (updated) {
    const delivery = await getWebhookDelivery({
      organizationId: input.organizationId,
      deliveryId: updated.id,
      webhookId: input.webhookId,
      executor,
    });
    if (delivery) return { kind: "requeued", delivery };
  }

  const current = await getWebhookDelivery({
    organizationId: input.organizationId,
    deliveryId: input.deliveryId,
    webhookId: input.webhookId,
    executor,
  });
  if (!current) return { kind: "not_found" };
  return { kind: "not_replayable", status: current.status };
}
