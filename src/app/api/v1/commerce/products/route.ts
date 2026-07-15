import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles, commerceProducts } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { commerceProductInputSchema } from "@/lib/commerce/model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:read"],
      action: "commerce.product.list",
      resourceType: "commerce_product",
    },
    async (context) => ({
      data: await db
        .select({
          id: commerceProducts.id,
          name: commerceProducts.name,
          sku: commerceProducts.sku,
          bundleId: commerceProducts.bundleId,
          bundleName: bundles.name,
          active: commerceProducts.active,
          metadata: commerceProducts.metadata,
          createdAt: commerceProducts.createdAt,
          updatedAt: commerceProducts.updatedAt,
        })
        .from(commerceProducts)
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, commerceProducts.bundleId),
            eq(bundles.organizationId, context.organizationId),
          ),
        )
        .where(eq(commerceProducts.organizationId, context.organizationId))
        .orderBy(desc(commerceProducts.createdAt)),
    }),
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:write"],
      action: "commerce.product.create",
      resourceType: "commerce_product",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, commerceProductInputSchema);
      const [bundle] = await db
        .select({ id: bundles.id })
        .from(bundles)
        .where(
          and(
            eq(bundles.id, input.bundleId),
            eq(bundles.organizationId, context.organizationId),
            input.active ? eq(bundles.active, true) : undefined,
          ),
        )
        .limit(1);
      if (!bundle) {
        throw new ApiError(
          404,
          "not_found",
          "Bundle wurde nicht gefunden oder ist inaktiv.",
        );
      }
      const [created] = await db
        .insert(commerceProducts)
        .values({ ...input, organizationId: context.organizationId })
        .returning();
      return { data: created, status: 201, resourceId: created.id };
    },
  );
}
