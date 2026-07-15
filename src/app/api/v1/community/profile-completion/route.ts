import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityApiActorForContext } from "@/lib/community-access";
import { getOwnCommunityProfileCompletion } from "@/lib/community-public-profile";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.profile_completion.read",
      resourceType: "community_profile",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      return {
        data: await getOwnCommunityProfileCompletion({
          organizationId: actor.organizationId,
          userId: actor.id,
        }),
        resourceId: actor.id,
      };
    },
  );
}
