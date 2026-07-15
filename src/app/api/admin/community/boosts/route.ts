import { communityBoostListQuerySchema } from "@/lib/api/schemas";
import { listCommunityAuthorBoosts } from "@/lib/community-boosts";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "community.author_boost.list" },
    async (user) => {
      const query = communityBoostListQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      return sessionData(
        request,
        await listCommunityAuthorBoosts({ actor: user, ...query }),
      );
    },
  );
}
