import { and, asc, count, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { badgeDefinitions, badgeGroups, userBadges } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { badgeCreateSchema } from "@/lib/api/schemas";
import { slugify } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["community:read"], action: "badge.list", resourceType: "badge" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(badgeDefinitions.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const active = url.searchParams.get("active");
    if (search) conditions.push(ilike(badgeDefinitions.name, `%${search}%`));
    if (active === "true" || active === "false") conditions.push(eq(badgeDefinitions.active, active === "true"));
    const rows = await db.select({ id: badgeDefinitions.id, groupId: badgeDefinitions.groupId, name: badgeDefinitions.name, slug: badgeDefinitions.slug, description: badgeDefinitions.description, icon: badgeDefinitions.icon, color: badgeDefinitions.color, pointsThreshold: badgeDefinitions.pointsThreshold, sortOrder: badgeDefinitions.sortOrder, active: badgeDefinitions.active, createdAt: badgeDefinitions.createdAt, updatedAt: badgeDefinitions.updatedAt, awardedCount: count(userBadges.id) }).from(badgeDefinitions).leftJoin(userBadges, and(eq(userBadges.badgeId, badgeDefinitions.id), eq(userBadges.organizationId, badgeDefinitions.organizationId))).where(and(...conditions)).groupBy(badgeDefinitions.id).orderBy(asc(badgeDefinitions.sortOrder), asc(badgeDefinitions.name)).limit(pagination.limit + 1).offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["community:write"], action: "badge.create", resourceType: "badge", idempotent: true }, async (context) => {
    const input = await parseJson(request, badgeCreateSchema);
    if (input.groupId) {
      const [group] = await db.select({ id: badgeGroups.id }).from(badgeGroups).where(and(eq(badgeGroups.id, input.groupId), eq(badgeGroups.organizationId, context.organizationId))).limit(1);
      if (!group) throw new ApiError(404, "not_found", "Badge-Gruppe nicht gefunden.");
    }
    const slug = input.slug ?? slugify(input.name);
    const [duplicate] = await db.select({ id: badgeDefinitions.id }).from(badgeDefinitions).where(and(eq(badgeDefinitions.organizationId, context.organizationId), eq(badgeDefinitions.slug, slug))).limit(1);
    if (duplicate) throw new ApiError(409, "conflict", "Ein Badge mit diesem Slug existiert bereits.");
    const [badge] = await db.insert(badgeDefinitions).values({ ...input, slug, organizationId: context.organizationId }).returning();
    return { data: badge, status: 201, resourceId: badge.id };
  });
}
