export const ORBIT_PERMISSIONS = [
  "instances:read",
  "instances:manage",
  "memberships:manage",
  "delegations:manage",
  "entitlements:manage",
  "transfers:read",
  "transfers:create",
  "billing:read",
  "billing:manage",
  "audit:read",
] as const;

export type OrbitPermission = (typeof ORBIT_PERMISSIONS)[number];

export const ORBIT_ROLES = [
  "owner",
  "administrator",
  "operator",
  "auditor",
  "partner",
] as const;

export type OrbitRole = (typeof ORBIT_ROLES)[number];

const ALL_PERMISSIONS = new Set<OrbitPermission>(ORBIT_PERMISSIONS);

export const ORBIT_ROLE_PERMISSIONS: Record<OrbitRole, ReadonlySet<OrbitPermission>> = {
  owner: ALL_PERMISSIONS,
  administrator: ALL_PERMISSIONS,
  operator: new Set([
    "instances:read",
    "instances:manage",
    "entitlements:manage",
    "transfers:read",
    "transfers:create",
    "billing:read",
    "audit:read",
  ]),
  auditor: new Set([
    "instances:read",
    "transfers:read",
    "billing:read",
    "audit:read",
  ]),
  partner: new Set([
    "instances:read",
    "transfers:read",
    "transfers:create",
    "audit:read",
  ]),
};

export const ORBIT_ENTITLEMENTS = [
  "content_transfer",
  "partner_access",
  "advanced_audit",
  "api_access",
  "custom_branding",
  "ai_features",
] as const;

export type OrbitEntitlement = (typeof ORBIT_ENTITLEMENTS)[number];

export function resolvedOrbitPermissions(input: {
  role: OrbitRole;
  permissionSet: readonly string[] | null;
}) {
  if (input.role === "owner") return new Set(ORBIT_PERMISSIONS);
  const allowed = ORBIT_ROLE_PERMISSIONS[input.role];
  if (!input.permissionSet) return new Set(allowed);
  return new Set(
    input.permissionSet.filter(
      (permission): permission is OrbitPermission =>
        allowed.has(permission as OrbitPermission),
    ),
  );
}

export function canOrbitRoleUsePermission(
  role: OrbitRole,
  permission: OrbitPermission,
) {
  return ORBIT_ROLE_PERMISSIONS[role].has(permission);
}

export function isActiveOrbitDelegation(input: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return !input.revokedAt && (!input.expiresAt || input.expiresAt > now);
}

export function orbitScopeDecision(input: {
  role: OrbitRole;
  permissionSet: readonly string[] | null;
  permission: OrbitPermission;
  workspaceOrganizationIds: readonly string[];
  requestedOrganizationIds: readonly string[];
  delegations: readonly {
    organizationId: string;
    permissions: readonly string[];
    expiresAt: Date | null;
    revokedAt: Date | null;
  }[];
  now?: Date;
}) {
  const permissions = resolvedOrbitPermissions({
    role: input.role,
    permissionSet: input.permissionSet,
  });
  if (!permissions.has(input.permission)) {
    return { allowed: false, permissions, organizationIds: new Set<string>() };
  }
  const workspaceOrganizations = new Set(input.workspaceOrganizationIds);
  const organizationIds =
    input.role === "partner"
      ? new Set(
          input.delegations
            .filter(
              (delegation) =>
                workspaceOrganizations.has(delegation.organizationId) &&
                delegation.permissions.includes(input.permission) &&
                isActiveOrbitDelegation({ ...delegation, now: input.now }),
            )
            .map((delegation) => delegation.organizationId),
        )
      : workspaceOrganizations;
  return {
    allowed: input.requestedOrganizationIds.every((id) => organizationIds.has(id)),
    permissions,
    organizationIds,
  };
}
