import { z } from "zod";

import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communityAreaMoveSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
} from "@/lib/community-access";
import { moveCommunityArea } from "@/lib/community-layout";

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
      action: "community.area.move",
      resourceType: "community_area",
      idempotent: true,
    },
    async (context) => {
      const { id } = paramsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      assertCommunityPermission(
        {
          canView: true,
          canPost: true,
          canComment: true,
          canManage: actor.role === "owner" || actor.role === "admin",
        },
        "canManage",
      );
      const input = await parseJson(request, communityAreaMoveSchema);
      const result = await moveCommunityArea({
        organizationId: context.organizationId,
        actorId: actor.id,
        areaId: id,
        position: input.position,
      });
      return { data: result, resourceId: id };
    },
  );
}
