import { communityFeedQuerySchema } from "@/lib/api/schemas";
import { getExplainableCommunityFeed } from "@/lib/community-feed";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "community.feed.read" },
    async (user) => {
      const query = communityFeedQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      return sessionData(
        request,
        await getExplainableCommunityFeed({
          actor: user,
          ...query,
          downloadContext: "session",
        }),
      );
    },
  );
}
