import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  communityFollowParamsSchema,
  communityFollowUpdateSchema,
} from "@/lib/api/schemas";
import { communityApiActorForContext } from "@/lib/community-access";
import {
  removeCommunityFollow,
  upsertCommunityFollow,
} from "@/lib/community-follows";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = {
  params: Promise<{ targetType: string; targetId: string }>;
};

export async function PUT(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.follow.upsert",
      resourceType: "community_follow",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityApiActorForContext(context),
        target: communityFollowParamsSchema.parse(await params),
        body: await parseJson(request, communityFollowUpdateSchema),
      }),
      execute: async ({ tx }, prepared) => {
        const follow = await upsertCommunityFollow({
          actor: prepared.actor,
          ...prepared.target,
          ...prepared.body,
          downloadContext: "api",
          tx,
        });
        return { data: follow, resourceId: follow.id };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.follow.remove",
      resourceType: "community_follow",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityApiActorForContext(context),
        target: communityFollowParamsSchema.parse(await params),
      }),
      execute: async ({ tx }, prepared) => ({
        data: await removeCommunityFollow({
          actor: prepared.actor,
          ...prepared.target,
          tx,
        }),
      }),
    },
  );
}
