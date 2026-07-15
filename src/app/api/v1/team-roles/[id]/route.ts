import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { teamRoleAssignments, teamRoles, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { teamRoleUpdateSchema } from "@/lib/team-permission-policy";
import {
  deleteTeamRole,
  getOwnerActorForApiKey,
  updateTeamRole,
} from "@/lib/team-permissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

const idSchema = z.string().uuid();

async function readRole(id: string, organizationId: string) {
  const [role] = await db
    .select()
    .from(teamRoles)
    .where(and(eq(teamRoles.id, id), eq(teamRoles.organizationId, organizationId)))
    .limit(1);
  if (!role) throw new ApiError(404, "not_found", "Team-Rolle nicht gefunden.");
  const assignments = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      baseRole: users.role,
      assignedAt: teamRoleAssignments.assignedAt,
    })
    .from(teamRoleAssignments)
    .innerJoin(
      users,
      and(
        eq(users.id, teamRoleAssignments.userId),
        eq(users.organizationId, teamRoleAssignments.organizationId),
      ),
    )
    .where(
      and(
        eq(teamRoleAssignments.roleId, id),
        eq(teamRoleAssignments.organizationId, organizationId),
      ),
    );
  return { ...role, assignments };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawId = (await params).id;
  return handleApi(
    request,
    { scopes: ["team_roles:read"], action: "team_role.read", resourceType: "team_role" },
    async (context) => {
      const id = idSchema.parse(rawId);
      return { data: await readRole(id, context.organizationId), resourceId: id };
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawId = (await params).id;
  return handleApi(
    request,
    {
      scopes: ["team_roles:write"],
      action: "team_role.update",
      resourceType: "team_role",
      idempotent: true,
    },
    async (context) => {
      const id = idSchema.parse(rawId);
      const input = await parseJson(request, teamRoleUpdateSchema);
      const actor = await getOwnerActorForApiKey(context);
      return { data: await updateTeamRole(actor, id, input), resourceId: id };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawId = (await params).id;
  return handleApi(
    request,
    {
      scopes: ["team_roles:write"],
      action: "team_role.delete",
      resourceType: "team_role",
      idempotent: true,
    },
    async (context) => {
      const id = idSchema.parse(rawId);
      const actor = await getOwnerActorForApiKey(context);
      return { data: await deleteTeamRole(actor, id), resourceId: id };
    },
  );
}
