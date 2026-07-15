import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  teamRoleAssignments,
  teamRoles,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  resolveTeamPermissions,
  teamPermissionAllows,
} from "@/lib/team-permission-policy";

type CommunityManagementTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function assertCommunityManager(
  tx: CommunityManagementTransaction,
  input: { organizationId: string; actorId: string },
) {
  const [actor] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, input.actorId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("update", { of: users });
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Community-Verwaltungsberechtigung ist nicht mehr aktiv.",
    );
  }

  const [assignment] = await tx
    .select({ roleId: teamRoleAssignments.roleId })
    .from(teamRoleAssignments)
    .where(
      and(
        eq(teamRoleAssignments.organizationId, input.organizationId),
        eq(teamRoleAssignments.userId, actor.id),
      ),
    )
    .limit(1)
    .for("share", { of: teamRoleAssignments });
  const [customRole] = assignment
    ? await tx
        .select({
          active: teamRoles.active,
          permissions: teamRoles.permissions,
        })
        .from(teamRoles)
        .where(
          and(
            eq(teamRoles.id, assignment.roleId),
            eq(teamRoles.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .for("share", { of: teamRoles })
    : [];
  const permissions = resolveTeamPermissions({
    baseRole: actor.role,
    assignmentExists: Boolean(assignment),
    customRoleActive: customRole?.active,
    customPermissions: customRole?.permissions,
  });
  if (!teamPermissionAllows(permissions, "community.manage")) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Community-Verwaltungsberechtigung ist nicht mehr aktiv.",
    );
  }
  return actor;
}
