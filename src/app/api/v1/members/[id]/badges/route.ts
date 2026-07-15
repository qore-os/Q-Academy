import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { badgeDefinitions, userBadges, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["community:read", "members:read"], action: "member.badge.list", resourceType: "member" }, async (context) => {
    const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.organizationId, context.organizationId))).limit(1);
    if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const data = await db.select({ id: userBadges.id, source: userBadges.source, awardedAt: userBadges.awardedAt, badgeId: badgeDefinitions.id, name: badgeDefinitions.name, slug: badgeDefinitions.slug, description: badgeDefinitions.description, icon: badgeDefinitions.icon, color: badgeDefinitions.color }).from(userBadges).innerJoin(badgeDefinitions, and(eq(badgeDefinitions.id, userBadges.badgeId), eq(badgeDefinitions.organizationId, context.organizationId))).where(and(eq(userBadges.userId, id), eq(userBadges.organizationId, context.organizationId))).orderBy(desc(userBadges.awardedAt));
    return { data, resourceId: id };
  });
}
