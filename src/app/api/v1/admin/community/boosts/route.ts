import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityBoostListQuerySchema } from "@/lib/api/schemas";
import { communityApiActorForContext } from "@/lib/community-access";
import { listCommunityAuthorBoostsPage } from "@/lib/community-boosts";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.author_boost.list",
      resourceType: "community_author_boost",
    },
    async (context) => {
      const query = communityBoostListQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      const actor = await communityApiActorForContext(context);
      const pagination = parsePagination(new URL(request.url));
      const page = await listCommunityAuthorBoostsPage({
        actor,
        ...query,
        ...pagination,
      });
      return {
        data: page.items,
        meta: {
          pagination: paginationMeta(
            pagination,
            page.items.length,
            page.hasMore,
          ),
        },
      };
    },
  );
}
