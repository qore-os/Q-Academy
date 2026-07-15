import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commerceOrders } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:read"],
    action: "commerce.order.list",
    resourceType: "commerce_order",
  }, async (context) => ({
    data: await db.select().from(commerceOrders)
      .where(eq(commerceOrders.organizationId, context.organizationId))
      .orderBy(desc(commerceOrders.orderedAt)).limit(100),
  }));
}
