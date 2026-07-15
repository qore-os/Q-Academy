import { z } from "zod";

import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { communityModerationPolicyUpdateSchema } from "@/lib/api/schemas";
import { communityAdminApiActorForContext } from "@/lib/community-admin";
import {
  getCommunitySpaceModerationPolicy,
  updateCommunitySpaceModerationPolicy,
} from "@/lib/community-governance";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.moderation_policy.read",
      resourceType: "community_space_moderation_policy",
    },
    async (context) => {
      await communityAdminApiActorForContext(context);
      const spaceId = z.string().uuid().parse((await params).id);
      return {
        data: await getCommunitySpaceModerationPolicy(
          context.organizationId,
          spaceId,
        ),
        resourceId: spaceId,
      };
    },
  );
}

export async function PUT(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.moderation_policy.replace",
      resourceType: "community_space_moderation_policy",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityAdminApiActorForContext(context),
        spaceId: z.string().uuid().parse((await params).id),
        body: await parseJson(request, communityModerationPolicyUpdateSchema),
      }),
      execute: async ({ context, tx }, prepared) => {
        const policy = await updateCommunitySpaceModerationPolicy({
          organizationId: context.organizationId,
          actorId: prepared.actor.id,
          spaceId: prepared.spaceId,
          ...prepared.body,
          tx,
        });
        return { data: policy, resourceId: policy.spaceId };
      },
    },
  );
}
