import { and, asc, count, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bundleCourses, bundles } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { bundleCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["bundles:read"], action: "bundle.list", resourceType: "bundle" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(bundles.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    if (search) conditions.push(ilike(bundles.name, `%${search}%`));
    const active = url.searchParams.get("active");
    if (active === "true" || active === "false") conditions.push(eq(bundles.active, active === "true"));
    const rows = await db
      .select({
        id: bundles.id,
        name: bundles.name,
        description: bundles.description,
        color: bundles.color,
        active: bundles.active,
        createdAt: bundles.createdAt,
        courseCount: count(bundleCourses.courseId),
      })
      .from(bundles)
      .leftJoin(bundleCourses, eq(bundleCourses.bundleId, bundles.id))
      .where(and(...conditions))
      .groupBy(bundles.id)
      .orderBy(url.searchParams.get("sort") === "name:asc" ? asc(bundles.name) : desc(bundles.createdAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.create", resourceType: "bundle", idempotent: true }, async (context) => {
    const input = await parseJson(request, bundleCreateSchema);
    const [existing] = await db.select({ id: bundles.id }).from(bundles).where(and(eq(bundles.organizationId, context.organizationId), eq(bundles.name, input.name))).limit(1);
    if (existing) throw new ApiError(409, "conflict", "Ein Bundle mit diesem Namen existiert bereits.");
    const [bundle] = await db.insert(bundles).values({ ...input, organizationId: context.organizationId }).returning();
    return { data: bundle, status: 201, resourceId: bundle.id };
  });
}
