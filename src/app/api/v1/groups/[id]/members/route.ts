import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { groupMembers, groups, users } from "@/db/schema";
import { addMemberToGroup } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { groupMemberSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertGroup(id: string, organizationId: string) {
  const [group] = await db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, id), eq(groups.organizationId, organizationId))).limit(1);
  if (!group) throw new ApiError(404, "not_found", "Gruppe nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["groups:read", "members:read"], action: "group.member.list", resourceType: "group" }, async (context) => {
    await assertGroup(id, context.organizationId);
    const pagination = parsePagination(new URL(request.url));
    const rows = await db
      .select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role, status: users.status, joinedAt: groupMembers.joinedAt })
      .from(groupMembers)
      .innerJoin(users, and(eq(users.id, groupMembers.userId), eq(users.organizationId, context.organizationId)))
      .where(eq(groupMembers.groupId, id))
      .orderBy(asc(users.lastName), asc(users.firstName))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) }, resourceId: id };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["groups:write"], action: "group.member.add", resourceType: "group", idempotent: true }, async (context) => {
    await assertGroup(id, context.organizationId);
    const input = await parseJson(request, groupMemberSchema);
    const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, input.userId), eq(users.organizationId, context.organizationId))).limit(1);
    if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const result = await addMemberToGroup(context.organizationId, id, input.userId);
    return {
      data: { ...result.membership, grantsCreated: result.grantsCreated },
      status: 201,
      resourceId: id,
    };
  });
}
