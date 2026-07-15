import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commerceSubscriptions } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, {
    scopes: ["commerce:read"],
    action: "commerce.subscription.list",
    resourceType: "commerce_subscription",
  }, async (context) => ({
    data: await db.select().from(commerceSubscriptions)
      .where(eq(commerceSubscriptions.organizationId, context.organizationId))
      .orderBy(desc(commerceSubscriptions.updatedAt)).limit(100),
  }));
}
