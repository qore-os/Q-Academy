import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { badgeDefinitions, badgeGroups } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { badgeUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function badgeForOrganization(id: string, organizationId: string) {
  const [badge] = await db.select().from(badgeDefinitions).where(and(eq(badgeDefinitions.id, id), eq(badgeDefinitions.organizationId, organizationId))).limit(1);
  if (!badge) throw new ApiError(404, "not_found", "Badge nicht gefunden.");
  return badge;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:read"], action: "badge.read", resourceType: "badge" }, async (context) => ({ data: await badgeForOrganization(id, context.organizationId), resourceId: id }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "badge.update", resourceType: "badge", idempotent: true }, async (context) => {
    const current = await badgeForOrganization(id, context.organizationId);
    const input = await parseJson(request, badgeUpdateSchema);
    if (input.groupId) {
      const [group] = await db.select({ id: badgeGroups.id }).from(badgeGroups).where(and(eq(badgeGroups.id, input.groupId), eq(badgeGroups.organizationId, context.organizationId))).limit(1);
      if (!group) throw new ApiError(404, "not_found", "Badge-Gruppe nicht gefunden.");
    }
    if (input.slug && input.slug !== current.slug) {
      const [duplicate] = await db.select({ id: badgeDefinitions.id }).from(badgeDefinitions).where(and(eq(badgeDefinitions.organizationId, context.organizationId), eq(badgeDefinitions.slug, input.slug))).limit(1);
      if (duplicate) throw new ApiError(409, "conflict", "Ein Badge mit diesem Slug existiert bereits.");
    }
    const [badge] = await db.update(badgeDefinitions).set({ ...input, updatedAt: new Date() }).where(and(eq(badgeDefinitions.id, id), eq(badgeDefinitions.organizationId, context.organizationId))).returning();
    return { data: badge, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:write"], action: "badge.disable", resourceType: "badge", idempotent: true }, async (context) => {
    await badgeForOrganization(id, context.organizationId);
    const [badge] = await db.update(badgeDefinitions).set({ active: false, updatedAt: new Date() }).where(and(eq(badgeDefinitions.id, id), eq(badgeDefinitions.organizationId, context.organizationId))).returning();
    return { data: badge, resourceId: id };
  });
}
