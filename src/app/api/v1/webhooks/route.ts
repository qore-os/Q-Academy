import { randomBytes } from "node:crypto";
import { and, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { webhookCreateSchema } from "@/lib/api/schemas";
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

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["webhooks:read"], action: "webhook.list", resourceType: "webhook" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(webhooks.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const active = url.searchParams.get("active");
    if (search) conditions.push(ilike(webhooks.name, `%${search}%`));
    if (active === "true" || active === "false") conditions.push(eq(webhooks.active, active === "true"));
    const rows = await db.select(publicWebhookFields).from(webhooks).where(and(...conditions)).orderBy(desc(webhooks.createdAt)).limit(pagination.limit + 1).offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.create", resourceType: "webhook", idempotent: true }, async (context) => {
    const input = await parseJson(request, webhookCreateSchema);
    await assertSafeWebhookUrl(input.url);
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const [webhook] = await db.insert(webhooks).values({
      organizationId: context.organizationId,
      ...input,
      signingSecretEncrypted: encryptWebhookSecret(secret),
    }).returning(publicWebhookFields);
    return { data: { ...webhook, secret }, status: 201, resourceId: webhook.id, meta: { secretShownOnce: true } };
  });
}
