import { and, asc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { communityAreas, communitySpaces } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { communitySpaceCreateSchema } from "@/lib/api/schemas";
import { slugify } from "@/lib/utils";
import {
  assertCommunityPermission,
  communityApiActorForContext,
  communitySpacePermissionSql,
  communitySpaceVisibilitySql,
} from "@/lib/community-access";
import { createCommunitySpaceWithLayout } from "@/lib/community-layout";
import { communitySpaceApiDto } from "@/lib/community-api-dto";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["community:read"], action: "community.space.list", resourceType: "community_space" }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const permissionSql = communitySpacePermissionSql(actor);
    const conditions: SQL[] = [
      eq(communitySpaces.organizationId, context.organizationId),
      communitySpaceVisibilitySql(actor),
    ];
    const search = url.searchParams.get("search")?.trim();
    if (search) conditions.push(ilike(communitySpaces.title, `%${search}%`));
    const rows = await db
      .select({
        id: communitySpaces.id,
        areaId: communityAreas.id,
        areaTitle: communityAreas.title,
        areaSlug: communityAreas.slug,
        areaDescription: communityAreas.description,
        areaSortOrder: communityAreas.sortOrder,
        title: communitySpaces.title,
        slug: communitySpaces.slug,
        description: communitySpaces.description,
        color: communitySpaces.color,
        type: communitySpaces.type,
        accessMode: communitySpaces.accessMode,
        sortOrder: communitySpaces.sortOrder,
        createdAt: communitySpaces.createdAt,
        updatedAt: communitySpaces.updatedAt,
        canView: permissionSql.canView,
        canPost: permissionSql.canPost,
        canComment: permissionSql.canComment,
        postCount:
          sql<number>`(select count(*) from posts space_posts where space_posts.organization_id = ${context.organizationId} and space_posts.space_id = ${communitySpaces.id} and space_posts.moderation_state = 'published')`.mapWith(
            Number,
          ),
      })
      .from(communitySpaces)
      .innerJoin(
        communityAreas,
        and(
          eq(communityAreas.id, communitySpaces.areaId),
          eq(communityAreas.organizationId, communitySpaces.organizationId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        asc(communityAreas.sortOrder),
        asc(communitySpaces.sortOrder),
        asc(communitySpaces.id),
      )
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const data = pageRows.map((space) => {
      const { canView, canPost, canComment, ...publicSpace } = space;
      return {
        ...publicSpace,
        permissions: {
          canView,
          canPost,
          canComment,
          canManage: actor.role === "owner" || actor.role === "admin",
        },
      };
    });
    const areas = [
      ...new Map(
        data.map((space) => [
          space.areaId,
          {
            id: space.areaId,
            title: space.areaTitle,
            slug: space.areaSlug,
            description: space.areaDescription,
            sortOrder: space.areaSortOrder,
            spaceIds: data
              .filter((entry) => entry.areaId === space.areaId)
              .map((entry) => entry.id),
          },
        ]),
      ).values(),
    ];
    return {
      data,
      meta: {
        pagination: paginationMeta(pagination, data.length, hasMore),
        areas,
      },
    };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["community:write"], action: "community.space.create", resourceType: "community_space", idempotent: true }, async (context) => {
    const actor = await communityApiActorForContext(context);
    assertCommunityPermission(
      { canView: true, canPost: true, canComment: true, canManage: actor.role === "owner" || actor.role === "admin" },
      "canManage",
    );
    const input = await parseJson(request, communitySpaceCreateSchema);
    const slug = input.slug ?? slugify(input.title);
    const space = await createCommunitySpaceWithLayout({
      organizationId: context.organizationId,
      actorId: actor.id,
      areaId: input.areaId,
      position: input.position,
      title: input.title,
      slug,
      description: input.description,
      color: input.color,
      type: input.type,
      accessMode: input.accessMode,
    });
    return {
      data: communitySpaceApiDto(space),
      status: 201,
      resourceId: space.id,
    };
  });
}
