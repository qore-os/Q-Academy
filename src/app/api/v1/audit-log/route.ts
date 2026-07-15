import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditLogs, apiKeys } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["audit:read"], action: "audit.list", resourceType: "audit_event" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(apiAuditLogs.organizationId, context.organizationId)];
    const method = url.searchParams.get("method")?.toUpperCase();
    const action = url.searchParams.get("action");
    const resourceType = url.searchParams.get("resourceType");
    const apiKeyId = url.searchParams.get("apiKeyId");
    const requestId = url.searchParams.get("requestId");
    const status = Number(url.searchParams.get("status"));
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (method) conditions.push(eq(apiAuditLogs.method, method));
    if (action) conditions.push(eq(apiAuditLogs.action, action));
    if (resourceType) conditions.push(eq(apiAuditLogs.resourceType, resourceType));
    if (apiKeyId) conditions.push(eq(apiAuditLogs.apiKeyId, apiKeyId));
    if (requestId) conditions.push(eq(apiAuditLogs.requestId, requestId));
    if (Number.isInteger(status) && status >= 100 && status <= 599) conditions.push(eq(apiAuditLogs.responseStatus, status));
    if (from && !Number.isNaN(Date.parse(from))) conditions.push(gte(apiAuditLogs.createdAt, new Date(from)));
    if (to && !Number.isNaN(Date.parse(to))) conditions.push(lte(apiAuditLogs.createdAt, new Date(to)));
    const rows = await db
      .select({
        id: apiAuditLogs.id,
        requestId: apiAuditLogs.requestId,
        method: apiAuditLogs.method,
        path: apiAuditLogs.path,
        action: apiAuditLogs.action,
        resourceType: apiAuditLogs.resourceType,
        resourceId: apiAuditLogs.resourceId,
        responseStatus: apiAuditLogs.responseStatus,
        durationMs: apiAuditLogs.durationMs,
        ipAddress: apiAuditLogs.ipAddress,
        userAgent: apiAuditLogs.userAgent,
        metadata: apiAuditLogs.metadata,
        createdAt: apiAuditLogs.createdAt,
        apiKeyId: apiKeys.id,
        apiKeyName: apiKeys.name,
        apiKeyPrefix: apiKeys.prefix,
      })
      .from(apiAuditLogs)
      .leftJoin(apiKeys, eq(apiKeys.id, apiAuditLogs.apiKeyId))
      .where(and(...conditions))
      .orderBy(desc(apiAuditLogs.createdAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}
