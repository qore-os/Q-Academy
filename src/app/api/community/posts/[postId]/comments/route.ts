import { communityCommentsQuerySchema } from "@/lib/api/schemas";
import { z } from "zod";
import { getCommunityCommentsPage } from "@/lib/community-feed";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ postId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { action: "community.comment.page" },
    async (user) => {
      const postId = z.string().uuid().parse((await params).postId);
      const query = communityCommentsQuerySchema.parse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      return sessionData(
        request,
        await getCommunityCommentsPage({
          actor: user,
          postId,
          ...query,
          downloadContext: "session",
        }),
      );
    },
  );
}
