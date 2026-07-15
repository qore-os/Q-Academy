import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import type { WebhookEvent } from "@/lib/api/scopes";

type WebhookExecutor = Pick<typeof db, "insert" | "select">;

export async function enqueueWebhook(
  organizationId: string,
  event: WebhookEvent,
  resource: Record<string, unknown>,
  executor: WebhookExecutor = db,
) {
  const subscriptions = await executor
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.organizationId, organizationId), eq(webhooks.active, true)));
  const matching = subscriptions.filter((subscription) => subscription.events.includes(event) || subscription.events.includes("*"));
  if (!matching.length) return [];
  return executor
    .insert(webhookDeliveries)
    .values(
      matching.map((subscription) => ({
        organizationId,
        webhookId: subscription.id,
        event,
        payload: {
          id: crypto.randomUUID(),
          type: event,
          createdAt: new Date().toISOString(),
          organizationId,
          data: resource,
        },
      })),
    )
    .returning({ id: webhookDeliveries.id });
}
