import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { badgeDefinitions, userBadges, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { badgeAssignSchema } from "@/lib/api/schemas";
import { isAutomaticPointBadgeSource } from "@/lib/community-badge-policy";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertResources(userId: string, badgeId: string, organizationId: string) {
  const [[member], [badge]] = await Promise.all([
    db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId), eq(users.status, "active"))).limit(1),
    db.select({ id: badgeDefinitions.id }).from(badgeDefinitions).where(and(eq(badgeDefinitions.id, badgeId), eq(badgeDefinitions.organizationId, organizationId), eq(badgeDefinitions.active, true))).limit(1),
  ]);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  if (!badge) throw new ApiError(404, "not_found", "Badge nicht gefunden.");
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; badgeId: string }> }) {
  const { id, badgeId } = await params;
  return handleApi(request, { scopes: ["community:write", "members:write"], action: "member.badge.award", resourceType: "member", idempotent: true }, async (context) => {
    await assertResources(id, badgeId, context.organizationId);
    const input = await parseJson(request, badgeAssignSchema);
    const [award] = await db.insert(userBadges).values({ organizationId: context.organizationId, userId: id, badgeId, source: input.source }).onConflictDoUpdate({ target: [userBadges.userId, userBadges.badgeId], set: { source: input.source, awardedAt: new Date() }, setWhere: sql`coalesce(${userBadges.source}, '') !~ '^points:[0-9]+$'` }).returning();
    if (!award) throw new ApiError(409, "conflict", "Ein automatisch vergebener Punkte-Badge kann nicht manuell ueberschrieben werden.");
    return { data: award, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; badgeId: string }> }) {
  const { id, badgeId } = await params;
  return handleApi(request, { scopes: ["community:write", "members:write"], action: "member.badge.revoke", resourceType: "member", idempotent: true }, async (context) => {
    await assertResources(id, badgeId, context.organizationId);
    const [removed] = await db.delete(userBadges).where(and(eq(userBadges.organizationId, context.organizationId), eq(userBadges.userId, id), eq(userBadges.badgeId, badgeId), sql`coalesce(${userBadges.source}, '') !~ '^points:[0-9]+$'`)).returning({ id: userBadges.id });
    if (!removed) {
      const [current] = await db.select({ source: userBadges.source }).from(userBadges).where(and(eq(userBadges.organizationId, context.organizationId), eq(userBadges.userId, id), eq(userBadges.badgeId, badgeId))).limit(1);
      if (current && isAutomaticPointBadgeSource(current.source)) throw new ApiError(409, "conflict", "Ein automatisch vergebener Punkte-Badge wird nur durch die Punkteberechnung entfernt.");
    }
    return { data: { userId: id, badgeId, deleted: Boolean(removed) }, resourceId: id };
  });
}
