import { and, asc, count, eq, ilike, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { badgeDefinitions, badgeGroups } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { badgeGroupCreateSchema } from "@/lib/api/schemas";

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["community:read"], action: "badge_group.list", resourceType: "badge_group" },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const search = url.searchParams.get("search")?.trim();
      const conditions: SQL[] = [eq(badgeGroups.organizationId, context.organizationId)];
      if (search) conditions.push(ilike(badgeGroups.name, `%${search}%`));
      const rows = await db
        .select({
          id: badgeGroups.id,
          name: badgeGroups.name,
          description: badgeGroups.description,
          displayMode: badgeGroups.displayMode,
          sortOrder: badgeGroups.sortOrder,
          active: badgeGroups.active,
          createdAt: badgeGroups.createdAt,
          updatedAt: badgeGroups.updatedAt,
          badgeCount: count(badgeDefinitions.id),
        })
        .from(badgeGroups)
        .leftJoin(
          badgeDefinitions,
          and(
            eq(badgeDefinitions.groupId, badgeGroups.id),
            eq(badgeDefinitions.organizationId, badgeGroups.organizationId),
          ),
        )
        .where(and(...conditions))
        .groupBy(badgeGroups.id)
        .orderBy(asc(badgeGroups.sortOrder), asc(badgeGroups.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;
      return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
    },
  );
}

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "badge_group.create",
      resourceType: "badge_group",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, badgeGroupCreateSchema);
      const [created] = await db
        .insert(badgeGroups)
        .values({ ...input, organizationId: context.organizationId })
        .returning();
      return { data: created, status: 201, resourceId: created!.id };
    },
  );
}
