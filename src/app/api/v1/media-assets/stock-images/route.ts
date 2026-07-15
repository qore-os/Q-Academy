import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  stockImageSearchInputSchema,
  stockImageSelectionInputSchema,
} from "@/lib/stock-image-model";
import { stockImageProviderStatus } from "@/lib/stock-image-provider";
import {
  searchStockImagesForApi,
  selectStockImageForApi,
} from "@/lib/stock-image-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "stock_images.search",
      resourceType: "media_asset",
    },
    async (context) => {
      const url = new URL(request.url);
      const status = stockImageProviderStatus();
      if (!status.enabled) {
        throw new ApiError(503, "internal_error", "Die Stockbildsuche ist nicht konfiguriert.");
      }
      const courseId = url.searchParams.get("courseId") ?? "";
      const input = stockImageSearchInputSchema.parse({
        query: url.searchParams.get("query") ?? "",
        page: url.searchParams.get("page") ?? undefined,
        perPage: url.searchParams.get("perPage") ?? undefined,
      });
      return {
        data: await searchStockImagesForApi(context.organizationId, courseId, input),
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "stock_images.select",
      resourceType: "media_asset",
      idempotent: false,
    },
    async (context) => {
      const input = await parseJson(request, stockImageSelectionInputSchema);
      const selected = await selectStockImageForApi(context.organizationId, input);
      return { data: selected, resourceId: selected.selectionId, status: 201 };
    },
  );
}
