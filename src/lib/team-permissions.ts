import "server-only";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  apiKeys,
  teamRoleAssignments,
  teamRoles,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  resolveTeamPermissions,
  teamPermissionAllows,
  teamRoleCreateSchema,
  teamRoleUpdateSchema,
  type TeamPermissionKey,
} from "@/lib/team-permission-policy";

type TeamActor = Pick<User, "id" | "organizationId" | "role" | "status">;
type TeamAccessActor = Pick<User, "id" | "organizationId" | "role">;
type TeamExecutor = Pick<typeof db, "select">;

export type TeamAccess = {
  permissions: TeamPermissionKey[];
  customRole: null | {
    id: string;
    name: string;
    color: string;
    active: boolean;
    revision: number;
  };
};

export async function getTeamAccessForUser(
  actor: TeamAccessActor,
  executor: TeamExecutor = db,
): Promise<TeamAccess> {
  if (actor.role === "owner") {
    return {
      permissions: resolveTeamPermissions({
        baseRole: "owner",
        assignmentExists: false,
      }),
      customRole: null,
    };
  }
  if (actor.role === "member") return { permissions: [], customRole: null };

  const [assignment] = await executor
    .select({
      assignmentUserId: teamRoleAssignments.userId,
      roleId: teamRoles.id,
      roleName: teamRoles.name,
      roleColor: teamRoles.color,
      roleActive: teamRoles.active,
      roleRevision: teamRoles.revision,
      permissions: teamRoles.permissions,
    })
    .from(teamRoleAssignments)
    .leftJoin(
      teamRoles,
      and(
        eq(teamRoles.id, teamRoleAssignments.roleId),
        eq(teamRoles.organizationId, teamRoleAssignments.organizationId),
      ),
    )
    .where(
      and(
        eq(teamRoleAssignments.organizationId, actor.organizationId),
        eq(teamRoleAssignments.userId, actor.id),
      ),
    )
    .limit(1);

  const assignmentExists = Boolean(assignment?.assignmentUserId);
  return {
    permissions: resolveTeamPermissions({
      baseRole: actor.role,
      assignmentExists,
      customRoleActive: assignment?.roleActive,
      customPermissions: assignment?.permissions,
    }),
    customRole:
      assignmentExists &&
      assignment?.roleId &&
      assignment.roleName &&
      assignment.roleColor &&
      assignment.roleActive !== null &&
      assignment.roleRevision !== null
        ? {
            id: assignment.roleId,
            name: assignment.roleName,
            color: assignment.roleColor,
            active: assignment.roleActive,
            revision: assignment.roleRevision,
          }
        : null,
  };
}

export async function userHasTeamPermission(
  actor: TeamAccessActor,
  permission: TeamPermissionKey,
  executor: TeamExecutor = db,
) {
  const access = await getTeamAccessForUser(actor, executor);
  return teamPermissionAllows(access.permissions, permission);
}

async function lockOwner(executor: Parameters<Parameters<typeof db.transaction>[0]>[0], actor: TeamActor) {
  const [current] = await executor
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("update");
  if (!current || actor.role !== "owner" || actor.status !== "active") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur ein aktiver Organisations-Owner darf Team-Rollen verwalten.",
    );
  }
}

export async function getOwnerActorForApiKey(input: {
  organizationId: string;
  apiKeyId: string;
}): Promise<TeamActor> {
  const [actor] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
      status: users.status,
    })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ApiError(403, "forbidden", "Der API-Schluessel ist nicht mehr an einen aktiven Owner gebunden.");
  }
  return actor;
}

export async function getTeamRoleAdminData(organizationId: string) {
  const [roles, assignments, staff] = await Promise.all([
    db
      .select({
        id: teamRoles.id,
        name: teamRoles.name,
        description: teamRoles.description,
        color: teamRoles.color,
        permissions: teamRoles.permissions,
        active: teamRoles.active,
        revision: teamRoles.revision,
        createdAt: teamRoles.createdAt,
        updatedAt: teamRoles.updatedAt,
        assignmentCount: count(teamRoleAssignments.userId),
      })
      .from(teamRoles)
      .leftJoin(
        teamRoleAssignments,
        and(
          eq(teamRoleAssignments.roleId, teamRoles.id),
          eq(teamRoleAssignments.organizationId, teamRoles.organizationId),
        ),
      )
      .where(eq(teamRoles.organizationId, organizationId))
      .groupBy(teamRoles.id)
      .orderBy(asc(teamRoles.name)),
    db
      .select({
        userId: teamRoleAssignments.userId,
        roleId: teamRoleAssignments.roleId,
        assignedAt: teamRoleAssignments.assignedAt,
      })
      .from(teamRoleAssignments)
      .where(eq(teamRoleAssignments.organizationId, organizationId)),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        role: users.role,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName)),
  ]);
  return {
    roles,
    assignments,
    staff: staff.filter((user) => user.role === "admin" || user.role === "trainer"),
  };
}

export async function createTeamRole(actor: TeamActor, unsafeInput: unknown) {
  const input = teamRoleCreateSchema.parse(unsafeInput);
  try {
    return await db.transaction(async (tx) => {
      await lockOwner(tx, actor);
      const [duplicate] = await tx
        .select({ id: teamRoles.id })
        .from(teamRoles)
        .where(
          and(
            eq(teamRoles.organizationId, actor.organizationId),
            sql`lower(${teamRoles.name}) = lower(${input.name})`,
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new ApiError(
          409,
          "conflict",
          "Eine Team-Rolle mit diesem Namen existiert bereits.",
        );
      }
      const [created] = await tx
        .insert(teamRoles)
        .values({ ...input, organizationId: actor.organizationId, createdById: actor.id })
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "team_role.created",
        entityType: "team_role",
        entityId: created.id,
        metadata: { name: created.name, permissions: created.permissions },
      });
      return created;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new ApiError(409, "conflict", "Eine Team-Rolle mit diesem Namen existiert bereits.");
    }
    throw error;
  }
}

export async function updateTeamRole(
  actor: TeamActor,
  roleId: string,
  unsafeInput: unknown,
) {
  const input = teamRoleUpdateSchema.parse(unsafeInput);
  try {
    return await db.transaction(async (tx) => {
      await lockOwner(tx, actor);
      const { revision, ...changes } = input;
      if (changes.name) {
        const [duplicate] = await tx
          .select({ id: teamRoles.id })
          .from(teamRoles)
          .where(
            and(
              eq(teamRoles.organizationId, actor.organizationId),
              ne(teamRoles.id, roleId),
              sql`lower(${teamRoles.name}) = lower(${changes.name})`,
            ),
          )
          .limit(1);
        if (duplicate) {
          throw new ApiError(
            409,
            "conflict",
            "Eine Team-Rolle mit diesem Namen existiert bereits.",
          );
        }
      }
      const [updated] = await tx
        .update(teamRoles)
        .set({ ...changes, revision: revision + 1, updatedAt: new Date() })
        .where(
          and(
            eq(teamRoles.id, roleId),
            eq(teamRoles.organizationId, actor.organizationId),
            eq(teamRoles.revision, revision),
          ),
        )
        .returning();
      if (!updated) {
        const [exists] = await tx
          .select({ id: teamRoles.id })
          .from(teamRoles)
          .where(
            and(
              eq(teamRoles.id, roleId),
              eq(teamRoles.organizationId, actor.organizationId),
            ),
          )
          .limit(1);
        if (!exists) {
          throw new ApiError(404, "not_found", "Team-Rolle nicht gefunden.");
        }
        throw new ApiError(
          409,
          "conflict",
          "Die Team-Rolle wurde zwischenzeitlich geaendert.",
        );
      }
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "team_role.updated",
        entityType: "team_role",
        entityId: updated.id,
        metadata: {
          active: updated.active,
          revision: updated.revision,
          permissions: updated.permissions,
        },
      });
      return updated;
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new ApiError(409, "conflict", "Eine Team-Rolle mit diesem Namen existiert bereits.");
    }
    throw error;
  }
}

export async function deleteTeamRole(actor: TeamActor, roleId: string) {
  return db.transaction(async (tx) => {
    await lockOwner(tx, actor);
    const [assigned] = await tx
      .select({ userId: teamRoleAssignments.userId })
      .from(teamRoleAssignments)
      .where(
        and(
          eq(teamRoleAssignments.organizationId, actor.organizationId),
          eq(teamRoleAssignments.roleId, roleId),
        ),
      )
      .limit(1)
      .for("update");
    if (assigned) throw new ApiError(409, "conflict", "Zugewiesene Team-Rollen koennen nicht geloescht werden.");
    const [deleted] = await tx
      .delete(teamRoles)
      .where(and(eq(teamRoles.id, roleId), eq(teamRoles.organizationId, actor.organizationId)))
      .returning({ id: teamRoles.id, name: teamRoles.name });
    if (!deleted) throw new ApiError(404, "not_found", "Team-Rolle nicht gefunden.");
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "team_role.deleted",
      entityType: "team_role",
      entityId: deleted.id,
      metadata: { name: deleted.name },
    });
    return deleted;
  });
}

export async function assignTeamRole(actor: TeamActor, roleId: string, userId: string) {
  return db.transaction(async (tx) => {
    await lockOwner(tx, actor);
    const [target] = await tx
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)))
      .limit(1)
      .for("update");
    if (!target) throw new ApiError(404, "not_found", "Teammitglied nicht gefunden.");
    if (target.role === "owner") throw new ApiError(403, "forbidden", "Owner-Rechte koennen nicht durch eine Custom-Rolle ersetzt werden.");
    if ((target.role !== "admin" && target.role !== "trainer") || target.status !== "active") {
      throw new ApiError(422, "validation_error", "Custom-Rollen koennen nur aktiven Admin- oder Trainerkonten zugewiesen werden.");
    }
    const [role] = await tx
      .select({ id: teamRoles.id, active: teamRoles.active })
      .from(teamRoles)
      .where(and(eq(teamRoles.id, roleId), eq(teamRoles.organizationId, actor.organizationId)))
      .limit(1)
      .for("share");
    if (!role) throw new ApiError(404, "not_found", "Team-Rolle nicht gefunden.");
    if (!role.active) throw new ApiError(409, "conflict", "Eine inaktive Team-Rolle kann nicht neu zugewiesen werden.");
    const [assignment] = await tx
      .insert(teamRoleAssignments)
      .values({ organizationId: actor.organizationId, userId, roleId, assignedById: actor.id })
      .onConflictDoUpdate({
        target: [teamRoleAssignments.organizationId, teamRoleAssignments.userId],
        set: { roleId, assignedById: actor.id, assignedAt: new Date() },
      })
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "team_role.assigned",
      entityType: "user",
      entityId: userId,
      metadata: { roleId },
    });
    return assignment;
  });
}

export async function unassignTeamRole(
  actor: TeamActor,
  userId: string,
  expectedRoleId?: string,
) {
  return db.transaction(async (tx) => {
    await lockOwner(tx, actor);
    const [target] = await tx
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.organizationId, actor.organizationId)))
      .limit(1)
      .for("update");
    if (!target) throw new ApiError(404, "not_found", "Teammitglied nicht gefunden.");
    if (target.role === "owner") throw new ApiError(403, "forbidden", "Owner-Rechte sind unveraenderlich.");
    const [deleted] = await tx
      .delete(teamRoleAssignments)
      .where(
        and(
          eq(teamRoleAssignments.organizationId, actor.organizationId),
          eq(teamRoleAssignments.userId, userId),
          ...(expectedRoleId
            ? [eq(teamRoleAssignments.roleId, expectedRoleId)]
            : []),
        ),
      )
      .returning({ roleId: teamRoleAssignments.roleId });
    if (!deleted) throw new ApiError(404, "not_found", "Dem Teammitglied ist keine Custom-Rolle zugewiesen.");
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "team_role.unassigned",
      entityType: "user",
      entityId: userId,
      metadata: { roleId: deleted.roleId },
    });
    return { userId, roleId: deleted.roleId };
  });
}
