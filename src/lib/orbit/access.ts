import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  orbitAccountIdentities,
  orbitAccounts,
  orbitAuditEvents,
  orbitInstances,
  orbitPartnerDelegations,
  orbitPermissionSets,
  orbitWorkspaceMemberships,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  orbitScopeDecision,
  type OrbitPermission,
  type OrbitRole,
} from "@/lib/orbit/policy";

export type OrbitActor = {
  accountId: string;
  userId: string;
  organizationId: string;
  email: string;
  displayName: string;
};

export type OrbitAccess = {
  actor: OrbitActor;
  workspaceId: string;
  membershipId: string;
  role: OrbitRole;
  permissions: Set<OrbitPermission>;
  organizationIds: Set<string>;
};

export async function getOrbitActor(user: User): Promise<OrbitActor | null> {
  const [row] = await db
    .select({
      accountId: orbitAccounts.id,
      displayName: orbitAccounts.displayName,
    })
    .from(orbitAccountIdentities)
    .innerJoin(
      orbitAccounts,
      and(
        eq(orbitAccounts.id, orbitAccountIdentities.accountId),
        eq(orbitAccounts.status, "active"),
      ),
    )
    .where(
      and(
        eq(orbitAccountIdentities.userId, user.id),
        eq(orbitAccountIdentities.organizationId, user.organizationId),
        isNull(orbitAccountIdentities.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    accountId: row.accountId,
    userId: user.id,
    organizationId: user.organizationId,
    email: user.email,
    displayName: row.displayName,
  };
}

export async function requireOrbitActor(user: User) {
  const actor = await getOrbitActor(user);
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der angemeldete Benutzer ist mit keinem Orbit-Account verknuepft.",
    );
  }
  return actor;
}

export async function auditOrbitEvent(input: {
  workspaceId: string;
  actorAccountId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  sourceOrganizationId?: string | null;
  targetOrganizationId?: string | null;
  outcome: "succeeded" | "denied" | "failed";
  metadata?: Record<string, unknown>;
}, executor: Pick<ApiTransaction, "insert"> | typeof db = db) {
  await executor.insert(orbitAuditEvents).values({
    workspaceId: input.workspaceId,
    actorAccountId: input.actorAccountId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    sourceOrganizationId: input.sourceOrganizationId ?? null,
    targetOrganizationId: input.targetOrganizationId ?? null,
    outcome: input.outcome,
    metadata: input.metadata ?? {},
  });
}

async function denied(input: {
  actor: OrbitActor;
  workspaceId: string;
  permission: OrbitPermission;
  organizationIds: readonly string[];
}): Promise<never> {
  await auditOrbitEvent({
    workspaceId: input.workspaceId,
    actorAccountId: input.actor.accountId,
    action: "authorization.denied",
    resourceType: "workspace",
    resourceId: input.workspaceId,
    outcome: "denied",
    metadata: {
      permission: input.permission,
      organizationIds: [...input.organizationIds].sort(),
    },
  }).catch(() => undefined);
  throw new ApiError(
    403,
    "forbidden",
    "Fuer diese Orbit-Aktion fehlt die erforderliche Berechtigung.",
  );
}

export async function requireOrbitAccess(input: {
  user: User;
  workspaceId: string;
  permission: OrbitPermission;
  organizationIds?: readonly string[];
}): Promise<OrbitAccess> {
  const actor = await requireOrbitActor(input.user);
  const [membership] = await db
    .select({
      id: orbitWorkspaceMemberships.id,
      role: orbitWorkspaceMemberships.role,
      permissionSet: orbitPermissionSets.permissions,
    })
    .from(orbitWorkspaceMemberships)
    .leftJoin(
      orbitPermissionSets,
      and(
        eq(orbitPermissionSets.id, orbitWorkspaceMemberships.permissionSetId),
        eq(orbitPermissionSets.workspaceId, orbitWorkspaceMemberships.workspaceId),
      ),
    )
    .where(
      and(
        eq(orbitWorkspaceMemberships.workspaceId, input.workspaceId),
        eq(orbitWorkspaceMemberships.accountId, actor.accountId),
      ),
    )
    .limit(1);
  const organizationIds = [...new Set(input.organizationIds ?? [])].sort();
  if (!membership) {
    return denied({
      actor,
      workspaceId: input.workspaceId,
      permission: input.permission,
      organizationIds,
    });
  }
  const role = membership.role as OrbitRole;
  const instances = await db
    .select({
      organizationId: orbitInstances.organizationId,
      status: orbitInstances.status,
      entitlements: orbitInstances.entitlements,
    })
    .from(orbitInstances)
    .where(eq(orbitInstances.workspaceId, input.workspaceId));
  const delegations =
    role === "partner"
      ? await db
          .select({
            organizationId: orbitPartnerDelegations.organizationId,
            permissions: orbitPartnerDelegations.permissions,
            expiresAt: orbitPartnerDelegations.expiresAt,
            revokedAt: orbitPartnerDelegations.revokedAt,
          })
          .from(orbitPartnerDelegations)
          .where(
            and(
              eq(orbitPartnerDelegations.workspaceId, input.workspaceId),
              eq(orbitPartnerDelegations.partnerAccountId, actor.accountId),
              isNull(orbitPartnerDelegations.revokedAt),
              or(
                isNull(orbitPartnerDelegations.expiresAt),
                gt(orbitPartnerDelegations.expiresAt, new Date()),
              ),
            ),
          )
      : [];
  const decision = orbitScopeDecision({
    role,
    permissionSet: membership.permissionSet,
    permission: input.permission,
    workspaceOrganizationIds: instances
      .filter(
        (instance) =>
          role !== "partner" ||
          (instance.status === "active" &&
            instance.entitlements.includes("partner_access")),
      )
      .map((instance) => instance.organizationId),
    requestedOrganizationIds: organizationIds,
    delegations,
  });
  if (!decision.allowed) {
    return denied({
      actor,
      workspaceId: input.workspaceId,
      permission: input.permission,
      organizationIds,
    });
  }

  return {
    actor,
    workspaceId: input.workspaceId,
    membershipId: membership.id,
    role,
    permissions: decision.permissions,
    organizationIds: decision.organizationIds,
  };
}
