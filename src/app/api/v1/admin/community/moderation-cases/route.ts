import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityModerationQueueQuerySchema } from "@/lib/api/schemas";
import { communityAdminApiActorForContext } from "@/lib/community-admin";
import { getCommunityModerationQueuePage } from "@/lib/community-moderation-queue";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.moderation_case.list",
      resourceType: "community_moderation_case",
    },
    async (context) => {
      await communityAdminApiActorForContext(context);
      const url = new URL(request.url);
      const query = communityModerationQueueQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const page = await getCommunityModerationQueuePage({
        organizationId: context.organizationId,
        status: query.status,
        targetType: query.targetType,
        limit: query.limit,
        cursor: query.cursor,
      });
      return {
        data: page.items,
        meta: {
          pagination: {
            limit: query.limit,
            returned: page.items.length,
            nextCursor: page.nextCursor,
          },
        },
      };
    },
  );
}
