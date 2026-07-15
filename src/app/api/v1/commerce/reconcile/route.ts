import { apiOptions, handleApi } from "@/lib/api/handler";
import { reconcileExpiredCommerceEntitlements } from "@/lib/commerce/service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:write"],
    action: "commerce.entitlement.reconcile",
    resourceType: "commerce_entitlement",
    idempotent: true,
  }, async (context) => ({
    data: await reconcileExpiredCommerceEntitlements(context.organizationId),
  }));
}
