import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { getWebhookDelivery } from "@/lib/api/webhook-delivery-operations";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const { id, deliveryId } = await params;
  return handleApi(request, { scopes: ["webhooks:read"], action: "webhook.delivery.read", resourceType: "webhook_delivery" }, async (context) => {
    const delivery = await getWebhookDelivery({
      organizationId: context.organizationId,
      webhookId: id,
      deliveryId,
    });
    if (!delivery) throw new ApiError(404, "not_found", "Webhook-Auslieferung nicht gefunden.");
    return { data: delivery, resourceId: deliveryId };
  });
}
