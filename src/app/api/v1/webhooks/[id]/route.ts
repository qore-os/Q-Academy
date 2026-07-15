import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { webhookUpdateSchema } from "@/lib/api/schemas";
import { assertSafeWebhookUrl } from "@/lib/api/webhook-security";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const publicWebhookFields = {
  id: webhooks.id,
  name: webhooks.name,
  url: webhooks.url,
  events: webhooks.events,
  active: webhooks.active,
  lastDeliveryAt: webhooks.lastDeliveryAt,
  createdAt: webhooks.createdAt,
  updatedAt: webhooks.updatedAt,
};

async function webhookForOrganization(id: string, organizationId: string) {
  const [webhook] = await db.select(publicWebhookFields).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.organizationId, organizationId))).limit(1);
  if (!webhook) throw new ApiError(404, "not_found", "Webhook nicht gefunden.");
  return webhook;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:read"], action: "webhook.read", resourceType: "webhook" }, async (context) => ({ data: await webhookForOrganization(id, context.organizationId), resourceId: id }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.update", resourceType: "webhook", idempotent: true }, async (context) => {
    await webhookForOrganization(id, context.organizationId);
    const input = await parseJson(request, webhookUpdateSchema);
    if (input.url) await assertSafeWebhookUrl(input.url);
    const [webhook] = await db.update(webhooks).set({ ...input, updatedAt: new Date() }).where(eq(webhooks.id, id)).returning(publicWebhookFields);
    return { data: webhook, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.delete", resourceType: "webhook", idempotent: true }, async (context) => {
    await webhookForOrganization(id, context.organizationId);
    await db.delete(webhooks).where(eq(webhooks.id, id));
    return { data: { id, deleted: true }, resourceId: id };
  });
}
