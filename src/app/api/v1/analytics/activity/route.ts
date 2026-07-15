import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, users } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["analytics:read"], action: "analytics.activity", resourceType: "activity" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(activityEvents.organizationId, context.organizationId)];
    const type = url.searchParams.get("type");
    const memberId = url.searchParams.get("memberId");
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId") ?? url.searchParams.get("courseId");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (type) conditions.push(eq(activityEvents.type, type));
    if (memberId) conditions.push(eq(activityEvents.userId, memberId));
    if (entityType) conditions.push(eq(activityEvents.entityType, entityType));
    if (entityId) conditions.push(eq(activityEvents.entityId, entityId));
    if (from && !Number.isNaN(Date.parse(from))) conditions.push(gte(activityEvents.createdAt, new Date(from)));
    if (to && !Number.isNaN(Date.parse(to))) conditions.push(lte(activityEvents.createdAt, new Date(to)));
    const rows = await db
      .select({
        id: activityEvents.id,
        type: activityEvents.type,
        entityType: activityEvents.entityType,
        entityId: activityEvents.entityId,
        metadata: activityEvents.metadata,
        createdAt: activityEvents.createdAt,
        memberId: users.id,
        memberFirstName: users.firstName,
        memberLastName: users.lastName,
        memberEmail: users.email,
      })
      .from(activityEvents)
      .leftJoin(users, and(eq(users.id, activityEvents.userId), eq(users.organizationId, context.organizationId)))
      .where(and(...conditions))
      .orderBy(desc(activityEvents.createdAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}
