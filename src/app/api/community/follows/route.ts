import { listCommunityFollows } from "@/lib/community-follows";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "community.follow.list" },
    async (user) => sessionData(request, await listCommunityFollows(user)),
  );
}
