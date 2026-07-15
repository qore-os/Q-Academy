import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { teamRoleAssignments, teamRoles } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { teamRoleCreateSchema } from "@/lib/team-permission-policy";
import { createTeamRole, getOwnerActorForApiKey } from "@/lib/team-permissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["team_roles:read"], action: "team_role.list", resourceType: "team_role" },
    async (context) => {
      const roles = await db
        .select({
          id: teamRoles.id,
          name: teamRoles.name,
          description: teamRoles.description,
          color: teamRoles.color,
          permissions: teamRoles.permissions,
          active: teamRoles.active,
          revision: teamRoles.revision,
          assignmentCount: count(teamRoleAssignments.userId),
          createdAt: teamRoles.createdAt,
          updatedAt: teamRoles.updatedAt,
        })
        .from(teamRoles)
        .leftJoin(
          teamRoleAssignments,
          and(
            eq(teamRoleAssignments.organizationId, teamRoles.organizationId),
            eq(teamRoleAssignments.roleId, teamRoles.id),
          ),
        )
        .where(eq(teamRoles.organizationId, context.organizationId))
        .groupBy(teamRoles.id)
        .orderBy(asc(teamRoles.name));
      return { data: roles };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["team_roles:write"],
      action: "team_role.create",
      resourceType: "team_role",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, teamRoleCreateSchema);
      const actor = await getOwnerActorForApiKey(context);
      const role = await createTeamRole(actor, input);
      return { data: role, status: 201, resourceId: role.id };
    },
  );
}

