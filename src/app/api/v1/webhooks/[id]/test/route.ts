import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhookDeliveries, webhooks } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.test", resourceType: "webhook", idempotent: true }, async (context) => {
    const [webhook] = await db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.organizationId, context.organizationId))).limit(1);
    if (!webhook) throw new ApiError(404, "not_found", "Webhook nicht gefunden.");
    const [delivery] = await db.insert(webhookDeliveries).values({
      organizationId: context.organizationId,
      webhookId: id,
      event: "webhook.test",
      payload: {
        id: randomUUID(),
        type: "webhook.test",
        createdAt: new Date().toISOString(),
        organizationId: context.organizationId,
        data: { message: "Q-Academy Webhook-Verbindungstest" },
      },
    }).returning();
    return { data: delivery, status: 202, resourceId: id };
  });
}
