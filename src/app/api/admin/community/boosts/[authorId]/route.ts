import { z } from "zod";

import { communityBoostUpdateSchema } from "@/lib/api/schemas";
import {
  removeCommunityAuthorBoost,
  replaceCommunityAuthorBoost,
} from "@/lib/community-boosts";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ authorId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "community.author_boost.replace" },
    async (user) => {
      const { authorId } = z.object({ authorId: z.string().uuid() }).parse(await params);
      const body = communityBoostUpdateSchema.parse(
        await parseSessionJson(request, { maxBytes: 2048 }),
      );
      return sessionData(
        request,
        await replaceCommunityAuthorBoost({ actor: user, authorId, ...body }),
      );
    },
  );
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "community.author_boost.remove" },
    async (user) => {
      const { authorId } = z.object({ authorId: z.string().uuid() }).parse(await params);
      return sessionData(
        request,
        await removeCommunityAuthorBoost({ actor: user, authorId }),
      );
    },
  );
}
