import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { listWebhookDeliveries } from "@/lib/api/webhook-delivery-operations";
import type { WebhookDeliveryStatus } from "@/lib/api/webhook-delivery-model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["webhooks:read"], action: "webhook.delivery.list", resourceType: "webhook_delivery" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const webhookId = url.searchParams.get("webhookId");
    const requestedStatus = url.searchParams.get("status");
    const status = requestedStatus && ["pending", "processing", "delivered", "failed", "retrying"].includes(requestedStatus)
      ? requestedStatus as WebhookDeliveryStatus
      : undefined;
    const rows = await listWebhookDeliveries({
      organizationId: context.organizationId,
      webhookId: webhookId ?? undefined,
      status,
      limit: pagination.limit + 1,
      offset: pagination.offset,
    });
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}
