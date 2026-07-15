import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { communitySpaces } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communitySpaceUpdateSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import { deleteCommunitySpaceWithPointReversal } from "@/lib/community-mutations";
import { updateCommunitySpaceWithLayout } from "@/lib/community-layout";
import { communitySpaceApiDto } from "@/lib/community-api-dto";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function spaceForOrganization(id: string, organizationId: string) {
  const [space] = await db.select().from(communitySpaces).where(and(eq(communitySpaces.id, id), eq(communitySpaces.organizationId, organizationId))).limit(1);
  if (!space) throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  return space;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:read"], action: "community.space.read", resourceType: "community_space" }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const access = await resolveCommunitySpacePermissions({ actor, spaceId: id });
    assertCommunityPermission(access.permissions, "canView");
    const space = await spaceForOrganization(id, context.organizationId);
    return {
      data: { ...communitySpaceApiDto(space), permissions: access.permissions },
      resourceId: id,
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "community.space.update", resourceType: "community_space", idempotent: true }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const access = await resolveCommunitySpacePermissions({ actor, spaceId: id });
    assertCommunityPermission(access.permissions, "canManage");
    await spaceForOrganization(id, context.organizationId);
    const input = await parseJson(request, communitySpaceUpdateSchema);
    const space = await updateCommunitySpaceWithLayout({
      organizationId: context.organizationId,
      actorId: actor.id,
      spaceId: id,
      ...input,
    });
    return { data: communitySpaceApiDto(space), resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "community.space.delete", resourceType: "community_space", idempotent: true }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const access = await resolveCommunitySpacePermissions({ actor, spaceId: id });
    assertCommunityPermission(access.permissions, "canManage");
    await spaceForOrganization(id, context.organizationId);
    const deleted = await db.transaction((tx) =>
      deleteCommunitySpaceWithPointReversal(tx, {
        organizationId: context.organizationId,
        spaceId: id,
        actorId: actor.id,
        authorization: "manage",
      }),
    );
    if (deleted.status !== "deleted") {
      throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
    }
    return { data: { id, deleted: true }, resourceId: id };
  });
}
