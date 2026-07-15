import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commerceEntitlements } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { commerceEntitlementCommandSchema } from "@/lib/commerce/model";
import { applyManualEntitlementCommand } from "@/lib/commerce/service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:read"],
    action: "commerce.entitlement.list",
    resourceType: "commerce_entitlement",
  }, async (context) => ({
    data: await db.select().from(commerceEntitlements)
      .where(eq(commerceEntitlements.organizationId, context.organizationId))
      .orderBy(desc(commerceEntitlements.updatedAt)).limit(100),
  }));
}

export async function POST(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:write"],
    action: "commerce.entitlement.command",
    resourceType: "commerce_entitlement",
    idempotent: true,
  }, async (context) => {
    const input = await parseJson(request, commerceEntitlementCommandSchema);
    const entitlement = await applyManualEntitlementCommand({
      organizationId: context.organizationId,
      actorUserId: null,
      ...input,
    });
    return { data: entitlement, resourceId: entitlement.id };
  });
}
