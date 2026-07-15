import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  listWebhookDeliveries,
  webhookExistsForOrganization,
} from "@/lib/api/webhook-delivery-operations";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["webhooks:read"], action: "webhook.delivery.list", resourceType: "webhook_delivery" }, async (context) => {
    if (!await webhookExistsForOrganization(context.organizationId, id)) {
      throw new ApiError(404, "not_found", "Webhook nicht gefunden.");
    }
    const pagination = parsePagination(new URL(request.url));
    const rows = await listWebhookDeliveries({
      organizationId: context.organizationId,
      webhookId: id,
      limit: pagination.limit + 1,
      offset: pagination.offset,
    });
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) }, resourceId: id };
  });
}
