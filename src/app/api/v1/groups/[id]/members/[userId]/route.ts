import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, users } from "@/db/schema";
import { addMemberToGroup, removeMemberFromGroup } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(groupId: string, userId: string, organizationId: string) {
  const [[group], [member]] = await Promise.all([
    db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId))).limit(1),
    db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, organizationId))).limit(1),
  ]);
  if (!group) throw new ApiError(404, "not_found", "Gruppe nicht gefunden.");
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return handleApi(request, { scopes: ["groups:write"], action: "group.member.add", resourceType: "group", idempotent: true }, async (context) => {
    await assertOwnership(id, userId, context.organizationId);
    const result = await addMemberToGroup(context.organizationId, id, userId);
    return {
      data: { ...result.membership, grantsCreated: result.grantsCreated },
      resourceId: id,
    };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; userId: string }> }) {
  const { id, userId } = await params;
  return handleApi(request, { scopes: ["groups:write"], action: "group.member.remove", resourceType: "group", idempotent: true }, async (context) => {
    await assertOwnership(id, userId, context.organizationId);
    const result = await removeMemberFromGroup(context.organizationId, id, userId);
    return {
      data: {
        groupId: id,
        userId,
        deleted: Boolean(result.membership),
        grantsRevoked: result.grantsRevoked,
      },
      resourceId: id,
    };
  });
}
