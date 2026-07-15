import { z } from "zod";

import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { communityModerationAppealDecisionSchema } from "@/lib/api/schemas";
import { communityAdminApiActorForContext } from "@/lib/community-admin";
import { resolveCommunityModerationAppealAsAdmin } from "@/lib/community-moderation-admin";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.moderation_appeal.resolve",
      resourceType: "community_moderation_appeal",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityAdminApiActorForContext(context),
        appealId: z.string().uuid().parse((await params).id),
        body: await parseJson(request, communityModerationAppealDecisionSchema),
      }),
      execute: async ({ context, tx }, prepared) => {
        const result = await resolveCommunityModerationAppealAsAdmin(tx, {
          organizationId: context.organizationId,
          actorId: prepared.actor.id,
          appealId: prepared.appealId,
          ...prepared.body,
        });
        return { data: result, resourceId: result.appealId };
      },
    },
  );
}
