import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  commerceProductMappings,
  commerceProducts,
  commerceProviderConnections,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { commerceMappingInputSchema } from "@/lib/commerce/model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:read"],
      action: "commerce.mapping.list",
      resourceType: "commerce_product_mapping",
    },
    async (context) => ({
      data: await db
        .select({
          id: commerceProductMappings.id,
          connectionId: commerceProductMappings.connectionId,
          provider: commerceProviderConnections.provider,
          productId: commerceProductMappings.productId,
          productName: commerceProducts.name,
          providerProductId: commerceProductMappings.providerProductId,
          providerVariantId: commerceProductMappings.providerVariantId,
          active: commerceProductMappings.active,
          createdAt: commerceProductMappings.createdAt,
        })
        .from(commerceProductMappings)
        .innerJoin(
          commerceProviderConnections,
          and(
            eq(
              commerceProviderConnections.id,
              commerceProductMappings.connectionId,
            ),
            eq(
              commerceProviderConnections.organizationId,
              context.organizationId,
            ),
          ),
        )
        .innerJoin(
          commerceProducts,
          and(
            eq(commerceProducts.id, commerceProductMappings.productId),
            eq(commerceProducts.organizationId, context.organizationId),
          ),
        )
        .where(
          eq(commerceProductMappings.organizationId, context.organizationId),
        )
        .orderBy(desc(commerceProductMappings.createdAt)),
    }),
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:write"],
      action: "commerce.mapping.create",
      resourceType: "commerce_product_mapping",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, commerceMappingInputSchema);
      const [target] = await db
        .select({
          connectionId: commerceProviderConnections.id,
          productId: commerceProducts.id,
        })
        .from(commerceProviderConnections)
        .innerJoin(
          commerceProducts,
          eq(commerceProducts.organizationId, commerceProviderConnections.organizationId),
        )
        .where(
          and(
            eq(commerceProviderConnections.id, input.connectionId),
            eq(commerceProducts.id, input.productId),
            eq(
              commerceProviderConnections.organizationId,
              context.organizationId,
            ),
          ),
        )
        .limit(1);
      if (!target) {
        throw new ApiError(404, "not_found", "Provider oder Produkt wurde nicht gefunden.");
      }
      const [created] = await db
        .insert(commerceProductMappings)
        .values({
          ...input,
          providerVariantId: input.providerVariantId ?? "",
          organizationId: context.organizationId,
        })
        .returning();
      return { data: created, status: 201, resourceId: created.id };
    },
  );
}
