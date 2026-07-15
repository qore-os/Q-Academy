import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { hubAccessGrants, hubs } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { hubAccessSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; subjectType: string; subjectId: string }> }) {
  const { id, subjectType, subjectId } = await params;
  return handleApi(request, { scopes: ["hubs:write"], action: "hub.access.revoke", resourceType: "hub", idempotent: true }, async (context) => {
    const parsed = hubAccessSchema.safeParse({ subjectType, subjectId });
    if (!parsed.success) throw new ApiError(422, "validation_error", "subjectType oder subjectId ist ungueltig.");
    const [hub] = await db.select({ id: hubs.id }).from(hubs).where(and(eq(hubs.id, id), eq(hubs.organizationId, context.organizationId))).limit(1);
    if (!hub) throw new ApiError(404, "not_found", "Hub nicht gefunden.");
    await db.delete(hubAccessGrants).where(and(eq(hubAccessGrants.hubId, id), eq(hubAccessGrants.subjectType, parsed.data.subjectType), eq(hubAccessGrants.subjectId, parsed.data.subjectId)));
    return { data: { hubId: id, ...parsed.data, deleted: true }, resourceId: id };
  });
}
