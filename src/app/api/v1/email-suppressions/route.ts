import { listEmailSuppressions } from "@/lib/email-feedback";
import { emailSuppressionListQuerySchema } from "@/lib/email-feedback-model";
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
      action: "email.suppression.list",
      resourceType: "email_suppression",
    },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const query = emailSuppressionListQuerySchema.safeParse({
        status: url.searchParams.get("status") || undefined,
        reason: url.searchParams.get("reason") || undefined,
        search: url.searchParams.get("search") || undefined,
      });
      if (!query.success) throw validationError(query.error);
      const result = await listEmailSuppressions(context.organizationId, {
        ...query.data,
        limit: pagination.limit,
        offset: pagination.offset,
      });
      const hasMore = result.offset + result.data.length < result.total;
      return {
        data: result.data,
        meta: {
          pagination: paginationMeta(pagination, result.data.length, hasMore),
          total: result.total,
        },
      };
    },
  );
}
