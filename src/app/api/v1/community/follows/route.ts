import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { communityApiActorForContext } from "@/lib/community-access";
import { listCommunityFollowsPage } from "@/lib/community-follows";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.follow.list",
      resourceType: "community_follow",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      const pagination = parsePagination(new URL(request.url));
      const page = await listCommunityFollowsPage(actor, {
        ...pagination,
        downloadContext: "api",
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
