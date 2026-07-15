import { z } from "zod";

import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { communityBoostUpdateSchema } from "@/lib/api/schemas";
import { communityApiActorForContext } from "@/lib/community-access";
import {
  removeCommunityAuthorBoost,
  replaceCommunityAuthorBoost,
} from "@/lib/community-boosts";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteContext = { params: Promise<{ authorId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.author_boost.replace",
      resourceType: "community_author_boost",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityApiActorForContext(context),
        authorId: z
          .string()
          .uuid()
          .parse((await params).authorId),
        body: await parseJson(request, communityBoostUpdateSchema),
      }),
      execute: async ({ tx }, prepared) => {
        const boost = await replaceCommunityAuthorBoost({
          actor: prepared.actor,
          authorId: prepared.authorId,
          ...prepared.body,
          tx,
        });
        return { data: boost, resourceId: boost.id };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.author_boost.remove",
      resourceType: "community_author_boost",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityApiActorForContext(context),
        authorId: z
          .string()
          .uuid()
          .parse((await params).authorId),
      }),
      execute: async ({ tx }, prepared) => ({
        data: await removeCommunityAuthorBoost({
          actor: prepared.actor,
          authorId: prepared.authorId,
          tx,
        }),
      }),
    },
  );
}
