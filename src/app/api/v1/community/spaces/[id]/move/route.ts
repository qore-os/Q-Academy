import { z } from "zod";

import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communitySpaceMoveSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { moveCommunitySpace } from "@/lib/community-layout";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const paramsSchema = z.object({ id: z.string().uuid() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.space.move",
      resourceType: "community_space",
      idempotent: true,
    },
    async (context) => {
      const { id } = paramsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const access = await resolveCommunitySpacePermissions({
        actor,
        spaceId: id,
      });
      assertCommunityPermission(access.permissions, "canManage");
      const input = await parseJson(request, communitySpaceMoveSchema);
      const result = await moveCommunitySpace({
        organizationId: context.organizationId,
        actorId: actor.id,
        spaceId: id,
        areaId: input.areaId,
        position: input.position,
      });
      return { data: result, resourceId: id };
    },
  );
}
