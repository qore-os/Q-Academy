import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { groupCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["groups:read"], action: "group.list", resourceType: "group" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(groups.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    if (search) conditions.push(ilike(groups.name, `%${search}%`));
    const rows = await db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        color: groups.color,
        createdAt: groups.createdAt,
        memberCount: count(groupMembers.userId),
      })
      .from(groups)
      .leftJoin(groupMembers, eq(groupMembers.groupId, groups.id))
      .where(and(...conditions))
      .groupBy(groups.id)
      .orderBy(url.searchParams.get("sort") === "name:asc" ? asc(groups.name) : desc(groups.createdAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["groups:write"], action: "group.create", resourceType: "group", idempotent: true }, async (context) => {
    const input = await parseJson(request, groupCreateSchema);
    const [existing] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.organizationId, context.organizationId), eq(groups.name, input.name))).limit(1);
    if (existing) throw new ApiError(409, "conflict", "Eine Gruppe mit diesem Namen existiert bereits.");
    const [group] = await db.insert(groups).values({ ...input, organizationId: context.organizationId }).returning();
    return { data: group, status: 201, resourceId: group.id };
  });
}
