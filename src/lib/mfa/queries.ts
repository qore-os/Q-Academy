import "server-only";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  organizationMfaPolicies,
  userMfaConfigurations,
  users,
  type User,
} from "@/db/schema";
import {
  isMfaProtectedRole,
  MFA_PROTECTED_ROLES,
} from "@/lib/mfa/roles";

export async function getOwnMfaState(
  user: Pick<User, "id" | "organizationId" | "role">,
) {
  if (!isMfaProtectedRole(user.role)) return null;
  const [configuration, policy] = await Promise.all([
    db
      .select({
        status: userMfaConfigurations.status,
        recoveryCodesRemaining: sql<number>`cardinality(${userMfaConfigurations.recoveryCodeHashes})::int`,
        enabledAt: userMfaConfigurations.enabledAt,
      })
      .from(userMfaConfigurations)
      .where(
        and(
          eq(userMfaConfigurations.userId, user.id),
          eq(userMfaConfigurations.organizationId, user.organizationId),
        ),
      )
      .limit(1),
    db
      .select({ required: organizationMfaPolicies.requireForPrivileged })
      .from(organizationMfaPolicies)
      .where(eq(organizationMfaPolicies.organizationId, user.organizationId))
      .limit(1),
  ]);
  return {
    status:
      configuration[0]?.status === "enabled"
        ? "enabled" as const
        : configuration[0]?.status === "pending"
          ? "pending" as const
          : "disabled" as const,
    enabledAt: configuration[0]?.enabledAt ?? null,
    recoveryCodesRemaining: configuration[0]?.recoveryCodesRemaining ?? 0,
    requiredByPolicy: policy[0]?.required ?? false,
  };
}

export async function getOrganizationMfaPolicyState(organizationId: string) {
  const [policy, totals] = await Promise.all([
    db
      .select({
        required: organizationMfaPolicies.requireForPrivileged,
        revision: organizationMfaPolicies.revision,
      })
      .from(organizationMfaPolicies)
      .where(eq(organizationMfaPolicies.organizationId, organizationId))
      .limit(1),
    db
      .select({
        privileged: count(users.id),
        protected: sql<number>`count(*) filter (where ${userMfaConfigurations.status} = 'enabled')::int`,
      })
      .from(users)
      .leftJoin(
        userMfaConfigurations,
        and(
          eq(userMfaConfigurations.userId, users.id),
          eq(userMfaConfigurations.organizationId, users.organizationId),
        ),
      )
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
          inArray(users.role, MFA_PROTECTED_ROLES),
        ),
      ),
  ]);
  return {
    required: policy[0]?.required ?? false,
    revision: policy[0]?.revision ?? 0,
    privilegedAccounts: totals[0]?.privileged ?? 0,
    protectedAccounts: totals[0]?.protected ?? 0,
  };
}
