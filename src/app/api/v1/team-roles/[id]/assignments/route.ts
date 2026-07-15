import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { teamRoleAssignments, teamRoles, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { teamRoleAssignmentSchema } from "@/lib/team-permission-policy";
import { assignTeamRole, getOwnerActorForApiKey } from "@/lib/team-permissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;
const idSchema = z.string().uuid();

async function assertRole(id: string, organizationId: string) {
  const [role] = await db
    .select({ id: teamRoles.id })
    .from(teamRoles)
    .where(and(eq(teamRoles.id, id), eq(teamRoles.organizationId, organizationId)))
    .limit(1);
  if (!role) throw new ApiError(404, "not_found", "Team-Rolle nicht gefunden.");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawRoleId = (await params).id;
  return handleApi(
    request,
    { scopes: ["team_roles:read"], action: "team_role_assignment.list", resourceType: "team_role_assignment" },
    async (context) => {
      const roleId = idSchema.parse(rawRoleId);
      await assertRole(roleId, context.organizationId);
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
            eq(teamRoleAssignments.organizationId, context.organizationId),
            eq(teamRoleAssignments.roleId, roleId),
          ),
        )
        .orderBy(asc(users.lastName), asc(users.firstName));
      return { data: assignments, resourceId: roleId };
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const rawRoleId = (await params).id;
  return handleApi(
    request,
    {
      scopes: ["team_roles:write"],
      action: "team_role_assignment.create",
      resourceType: "team_role_assignment",
      idempotent: true,
    },
    async (context) => {
      const roleId = idSchema.parse(rawRoleId);
      const input = await parseJson(request, teamRoleAssignmentSchema);
      const actor = await getOwnerActorForApiKey(context);
      const assignment = await assignTeamRole(actor, roleId, input.userId);
      return { data: assignment, status: 201, resourceId: input.userId };
    },
  );
}
