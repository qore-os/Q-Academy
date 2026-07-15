import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { communityAreas, communitySpaces } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communityAreaCreateSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
  communitySpaceVisibilitySql,
} from "@/lib/community-access";
import { createCommunityArea } from "@/lib/community-layout";
import { communityAreaApiDto } from "@/lib/community-api-dto";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.area.list",
      resourceType: "community_area",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      const [areas, visibleSpaces] = await Promise.all([
        db
          .select()
          .from(communityAreas)
          .where(eq(communityAreas.organizationId, context.organizationId))
          .orderBy(asc(communityAreas.sortOrder), asc(communityAreas.id)),
        db
          .select({ id: communitySpaces.id, areaId: communitySpaces.areaId })
          .from(communitySpaces)
          .where(
            and(
              eq(communitySpaces.organizationId, context.organizationId),
              communitySpaceVisibilitySql(actor),
            ),
          )
          .orderBy(
            asc(communitySpaces.areaId),
            asc(communitySpaces.sortOrder),
            asc(communitySpaces.id),
          ),
      ]);
      const visibleSpaceIdsByArea = new Map<string, string[]>();
      for (const space of visibleSpaces) {
        const values = visibleSpaceIdsByArea.get(space.areaId) ?? [];
        values.push(space.id);
        visibleSpaceIdsByArea.set(space.areaId, values);
      }
      const canManage = actor.role === "owner" || actor.role === "admin";
      return {
        data: areas.flatMap((area) => {
          const spaceIds = visibleSpaceIdsByArea.get(area.id) ?? [];
          return canManage || spaceIds.length
            ? [communityAreaApiDto(area, spaceIds)]
            : [];
        }),
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.area.create",
      resourceType: "community_area",
      idempotent: true,
    },
    async (context) => {
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
      const input = await parseJson(request, communityAreaCreateSchema);
      const area = await createCommunityArea({
        organizationId: context.organizationId,
        actorId: actor.id,
        title: input.title,
        slug: input.slug ?? slugify(input.title),
        description: input.description,
        position: input.position,
      });
      return {
        data: communityAreaApiDto(area),
        status: 201,
        resourceId: area.id,
      };
    },
  );
}
