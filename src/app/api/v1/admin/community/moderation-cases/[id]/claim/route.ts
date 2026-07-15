import { z } from "zod";

import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { communityModerationCaseClaimSchema } from "@/lib/api/schemas";
import { communityAdminApiActorForContext } from "@/lib/community-admin";
import { claimCommunityModerationCase } from "@/lib/community-moderation-admin";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.moderation_case.claim",
      resourceType: "community_moderation_case",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityAdminApiActorForContext(context),
        caseId: z.string().uuid().parse((await params).id),
        body: await parseJson(request, communityModerationCaseClaimSchema),
      }),
      execute: async ({ context, tx }, prepared) => {
        const result = await claimCommunityModerationCase(tx, {
          organizationId: context.organizationId,
          actorId: prepared.actor.id,
          caseId: prepared.caseId,
          ...prepared.body,
        });
        return { data: result, resourceId: result.caseId };
      },
    },
  );
}
