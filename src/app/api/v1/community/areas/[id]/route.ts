import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { communityAreas, communitySpaces } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communityAreaUpdateSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
  communitySpaceVisibilitySql,
} from "@/lib/community-access";
import {
  deleteCommunityArea,
  updateCommunityArea,
} from "@/lib/community-layout";
import { communityAreaApiDto } from "@/lib/community-api-dto";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const paramsSchema = z.object({ id: z.string().uuid() });

async function areaForOrganization(id: string, organizationId: string) {
  const [area] = await db
    .select()
    .from(communityAreas)
    .where(
      and(
        eq(communityAreas.id, id),
        eq(communityAreas.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!area) throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
  return area;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.area.read",
      resourceType: "community_area",
    },
    async (context) => {
      const { id } = paramsSchema.parse(await params);
      const actor = await communityApiActorForContext(context);
      const area = await areaForOrganization(id, context.organizationId);
      const spaces = await db
        .select({ id: communitySpaces.id })
        .from(communitySpaces)
        .where(
          and(
            eq(communitySpaces.organizationId, context.organizationId),
            eq(communitySpaces.areaId, area.id),
            communitySpaceVisibilitySql(actor),
          ),
        )
        .orderBy(asc(communitySpaces.sortOrder), asc(communitySpaces.id));
      if (
        actor.role !== "owner" &&
        actor.role !== "admin" &&
        spaces.length === 0
      ) {
        throw new ApiError(404, "not_found", "Community-Area nicht gefunden.");
      }
      return {
        data: communityAreaApiDto(
          area,
          spaces.map((space) => space.id),
        ),
      };
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.area.update",
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
      const current = await areaForOrganization(id, context.organizationId);
      const input = await parseJson(request, communityAreaUpdateSchema);
      const area = await updateCommunityArea({
        organizationId: context.organizationId,
        actorId: actor.id,
        areaId: id,
        title: input.title ?? current.title,
        slug: input.slug ?? current.slug,
        description:
          input.description === undefined
            ? current.description
            : input.description,
      });
      const spaces = await db
        .select({ id: communitySpaces.id })
        .from(communitySpaces)
        .where(
          and(
            eq(communitySpaces.organizationId, context.organizationId),
            eq(communitySpaces.areaId, area.id),
          ),
        )
        .orderBy(asc(communitySpaces.sortOrder), asc(communitySpaces.id));
      return {
        data: communityAreaApiDto(
          area,
          spaces.map((space) => space.id),
        ),
        resourceId: area.id,
      };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.area.delete",
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
      const result = await deleteCommunityArea({
        organizationId: context.organizationId,
        actorId: actor.id,
        areaId: id,
      });
      return { data: result, resourceId: id };
    },
  );
}
