import {
  communityFollowParamsSchema,
  communityFollowUpdateSchema,
} from "@/lib/api/schemas";
import {
  removeCommunityFollow,
  upsertCommunityFollow,
} from "@/lib/community-follows";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ targetType: string; targetId: string }>;
};

export async function PUT(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "community.follow.upsert" },
    async (user) => {
      const target = communityFollowParamsSchema.parse(await params);
      const body = communityFollowUpdateSchema.parse(
        await parseSessionJson(request, { maxBytes: 1024 }),
      );
      return sessionData(
        request,
        await upsertCommunityFollow({ actor: user, ...target, ...body }),
      );
    },
  );
}

export async function DELETE(request: Request, { params }: RouteContext) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "community.follow.remove" },
    async (user) => {
      const target = communityFollowParamsSchema.parse(await params);
      return sessionData(
        request,
        await removeCommunityFollow({ actor: user, ...target }),
      );
    },
  );
}
