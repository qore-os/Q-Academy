import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiAuditLogs, apiKeys } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["audit:read"], action: "audit.read", resourceType: "audit_event" }, async (context) => {
    const [entry] = await db
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
      .where(and(eq(apiAuditLogs.id, id), eq(apiAuditLogs.organizationId, context.organizationId)))
      .limit(1);
    if (!entry) throw new ApiError(404, "not_found", "Audit-Eintrag nicht gefunden.");
    return { data: entry, resourceId: id };
  });
}
