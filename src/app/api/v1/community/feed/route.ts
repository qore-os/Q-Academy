import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityFeedQuerySchema } from "@/lib/api/schemas";
import { communityApiActorForContext } from "@/lib/community-access";
import { getExplainableCommunityFeed } from "@/lib/community-feed";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.feed.read",
      resourceType: "community_feed",
    },
    async (context) => {
      const query = communityFeedQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      const actor = await communityApiActorForContext(context);
      return {
        data: await getExplainableCommunityFeed({
          actor,
          ...query,
          downloadContext: "api",
        }),
      };
    },
  );
}
