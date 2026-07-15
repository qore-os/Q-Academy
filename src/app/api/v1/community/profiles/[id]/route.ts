import { z } from "zod";

import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityApiActorForContext } from "@/lib/community-access";
import { getCommunityPublicProfile } from "@/lib/community-public-profile";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const paramsSchema = z.object({ id: z.string().uuid() });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.profile.read",
      resourceType: "community_profile",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      const { id } = paramsSchema.parse(await params);
      const profile = await getCommunityPublicProfile({
        organizationId: actor.organizationId,
        memberId: id,
        downloadContext: "api",
      });
      return { data: profile, resourceId: id };
    },
  );
}
