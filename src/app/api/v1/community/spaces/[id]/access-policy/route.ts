import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communitySpaceAccessPolicySchema } from "@/lib/api/schemas";
import {
  communityApiActorForContext,
  communitySpaceAccessPolicyForAdmin,
  replaceCommunitySpaceAccessPolicy,
} from "@/lib/community-access";
import { communitySpaceAccessPolicyApiDto } from "@/lib/community-api-dto";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.space_access_policy.read",
      resourceType: "community_space",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      const policy = await communitySpaceAccessPolicyForAdmin({
        organizationId: context.organizationId,
        actorId: actor.id,
        spaceId: id,
      });
      return {
        data: communitySpaceAccessPolicyApiDto(policy),
        resourceId: id,
      };
    },
  );
}

export async function PUT(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.space_access_policy.replace",
      resourceType: "community_space",
      idempotent: true,
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      const input = await parseJson(request, communitySpaceAccessPolicySchema);
      const policy = await replaceCommunitySpaceAccessPolicy({
        organizationId: context.organizationId,
        actorId: actor.id,
        spaceId: id,
        ...input,
      });
      return {
        data: communitySpaceAccessPolicyApiDto(policy),
        resourceId: id,
      };
    },
  );
}
