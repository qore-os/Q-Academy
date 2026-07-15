import { listEmailDeliveries } from "@/lib/email-center";
import { emailDeliveryListQuerySchema } from "@/lib/email-center-model";
import { validationError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["email:read"],
      action: "email.delivery.list",
      resourceType: "email_delivery",
    },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const query = emailDeliveryListQuerySchema.safeParse({
        search: url.searchParams.get("search") || undefined,
        event: url.searchParams.get("event") || undefined,
        status: url.searchParams.get("status") || undefined,
        from: url.searchParams.get("from") || undefined,
        to: url.searchParams.get("to") || undefined,
      });
      if (!query.success) throw validationError(query.error);
      const result = await listEmailDeliveries(context.organizationId, {
        ...query.data,
        limit: pagination.limit,
        offset: pagination.offset,
      });
      const hasMore = result.offset + result.data.length < result.total;
      return {
        data: result.data,
        meta: {
          pagination: paginationMeta(
            pagination,
            result.data.length,
            hasMore,
          ),
          total: result.total,
        },
      };
    },
  );
}
