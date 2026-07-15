import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { deleteGroupWithAccess } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { groupUpdateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function groupForOrganization(id: string, organizationId: string) {
  const [group] = await db.select().from(groups).where(and(eq(groups.id, id), eq(groups.organizationId, organizationId))).limit(1);
  if (!group) throw new ApiError(404, "not_found", "Gruppe nicht gefunden.");
  return group;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["groups:read"], action: "group.read", resourceType: "group" }, async (context) => {
    const group = await groupForOrganization(id, context.organizationId);
    const members = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        status: users.status,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, id), eq(users.organizationId, context.organizationId)))
      .orderBy(asc(users.lastName), asc(users.firstName));
    return { data: { ...group, members }, resourceId: id };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["groups:write"], action: "group.update", resourceType: "group", idempotent: true }, async (context) => {
    await groupForOrganization(id, context.organizationId);
    const input = await parseJson(request, groupUpdateSchema);
    if (input.name) {
      const [duplicate] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.organizationId, context.organizationId), eq(groups.name, input.name))).limit(1);
      if (duplicate && duplicate.id !== id) throw new ApiError(409, "conflict", "Eine Gruppe mit diesem Namen existiert bereits.");
    }
    const [group] = await db.update(groups).set(input).where(eq(groups.id, id)).returning();
    return { data: group, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["groups:write"], action: "group.delete", resourceType: "group", idempotent: true }, async (context) => {
    await groupForOrganization(id, context.organizationId);
    const result = await deleteGroupWithAccess(context.organizationId, id);
    return {
      data: {
        id,
        deleted: Boolean(result.deleted),
        affectedEnrollments: result.affectedEnrollments,
      },
      resourceId: id,
    };
  });
}
