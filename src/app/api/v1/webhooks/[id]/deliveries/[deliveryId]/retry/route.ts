import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { replayFailedWebhookDelivery } from "@/lib/api/webhook-delivery-operations";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string; deliveryId: string }> }) {
  const { id, deliveryId } = await params;
  return handleApi(request, { scopes: ["webhooks:write"], action: "webhook.delivery.replay", resourceType: "webhook_delivery", idempotent: true }, async (context) => {
    const result = await replayFailedWebhookDelivery({
      organizationId: context.organizationId,
      webhookId: id,
      deliveryId,
    });
    if (result.kind === "not_found") {
      throw new ApiError(404, "not_found", "Webhook-Auslieferung nicht gefunden.");
    }
    if (result.kind === "not_replayable") {
      throw new ApiError(409, "conflict", "Nur endgueltig fehlgeschlagene Webhook-Zustellungen koennen erneut eingeplant werden.");
    }
    return { data: result.delivery, status: 202, resourceId: deliveryId };
  });
}
