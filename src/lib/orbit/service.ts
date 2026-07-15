import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  orbitAccountIdentities,
  orbitAccounts,
  orbitAuditEvents,
  orbitBillingAccounts,
  orbitBillingPriceVersions,
  orbitBillingStatements,
  orbitInstanceClaims,
  orbitInstances,
  orbitPartnerDelegations,
  orbitPermissionSets,
  orbitTransferJobs,
  orbitWorkspaceMemberships,
  orbitWorkspaces,
  organizations,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { getCanonicalTenantAuthOrigin } from "@/lib/branding";
import {
  calculateOrbitBillingProjection,
  currentOrbitBillingPeriod,
  dueOrbitBillingPeriods,
} from "@/lib/orbit/billing-policy";
import { resolvedOrbitPermissions, type OrbitRole } from "@/lib/orbit/policy";
import {
  auditOrbitEvent,
  requireOrbitAccess,
  requireOrbitActor,
} from "@/lib/orbit/access";
import type {
  OrbitBootstrapInput,
  OrbitBillingUpdateInput,
  OrbitDelegationInput,
  OrbitInstanceUpdateInput,
  OrbitMembershipInput,
  OrbitPermissionSetInput,
} from "@/lib/orbit/schemas";
import { publicOrbitTransferJob } from "@/lib/orbit/transfer-policy";

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireLockedOrbitBillingManager(
  tx: ApiTransaction,
  workspaceId: string,
  accountId: string,
) {
  const [membership] = await tx
    .select({
      role: orbitWorkspaceMemberships.role,
      permissionSetId: orbitWorkspaceMemberships.permissionSetId,
    })
    .from(orbitWorkspaceMemberships)
    .where(
      and(
        eq(orbitWorkspaceMemberships.workspaceId, workspaceId),
        eq(orbitWorkspaceMemberships.accountId, accountId),
      ),
    )
    .limit(1)
    .for("update");
  if (!membership) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Abrechnungsberechtigung wurde zwischenzeitlich entzogen.",
    );
  }
  const [permissionSet] = membership.permissionSetId
    ? await tx
        .select({ permissions: orbitPermissionSets.permissions })
        .from(orbitPermissionSets)
        .where(
          and(
            eq(orbitPermissionSets.id, membership.permissionSetId),
            eq(orbitPermissionSets.workspaceId, workspaceId),
          ),
        )
        .limit(1)
        .for("update")
    : [];
  if (membership.permissionSetId && !permissionSet) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Abrechnungsberechtigung wurde zwischenzeitlich entzogen.",
    );
  }
  const permissions = resolvedOrbitPermissions({
    role: membership.role as OrbitRole,
    permissionSet: permissionSet?.permissions ?? null,
  });
  if (!permissions.has("billing:manage")) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Abrechnungsberechtigung wurde zwischenzeitlich entzogen.",
    );
  }
}

export async function bootstrapOrbitWorkspace(
  user: User,
  input: OrbitBootstrapInput,
) {
  if (user.role !== "owner") {
    throw new ApiError(
      403,
      "forbidden",
      "Nur der Tenant-Eigentuemer kann eine Orbit-Organisation anlegen.",
    );
  }
  const email = normalizedEmail(user.email);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-identity:${email}`}, 0))`,
    );
    const [existingIdentity] = await tx
      .select({ id: orbitAccountIdentities.id })
      .from(orbitAccountIdentities)
      .where(
        and(
          eq(orbitAccountIdentities.userId, user.id),
          eq(orbitAccountIdentities.organizationId, user.organizationId),
          isNull(orbitAccountIdentities.revokedAt),
        ),
      )
      .limit(1);
    if (existingIdentity) {
      throw new ApiError(
        409,
        "conflict",
        "Dieser Tenant-Benutzer ist bereits mit Orbit verknuepft.",
      );
    }
    const [emailOwner] = await tx
      .select({ id: orbitAccounts.id })
      .from(orbitAccounts)
      .where(sql`lower(${orbitAccounts.email}) = ${email}`)
      .limit(1);
    if (emailOwner) {
      throw new ApiError(
        409,
        "conflict",
        "Fuer diese E-Mail existiert bereits ein Orbit-Account. Verwenden Sie einen bereits sicher verknuepften Tenant.",
      );
    }
    const [account] = await tx
      .insert(orbitAccounts)
      .values({
        email,
        displayName: `${user.firstName} ${user.lastName}`.trim() || email,
      })
      .returning();
    const [workspace] = await tx
      .insert(orbitWorkspaces)
      .values({
        name: input.workspaceName,
        slug: input.workspaceSlug,
        instanceSlotLimit: input.instanceSlotLimit,
        createdByAccountId: account.id,
      })
      .returning();
    await tx.insert(orbitAccountIdentities).values({
      accountId: account.id,
      organizationId: user.organizationId,
      userId: user.id,
    });
    await tx.insert(orbitWorkspaceMemberships).values({
      workspaceId: workspace.id,
      accountId: account.id,
      role: "owner",
      createdByAccountId: account.id,
    });
    await tx.insert(orbitInstances).values({
      workspaceId: workspace.id,
      organizationId: user.organizationId,
      customerReference: null,
      entitlements: ["content_transfer", "partner_access", "advanced_audit"],
    });
    const billingInterval = input.billingInterval;
    await tx.insert(orbitBillingAccounts).values({
      workspaceId: workspace.id,
      billingInterval,
      includedInstanceSlots: Math.min(1, input.instanceSlotLimit),
    });
    await tx.insert(orbitBillingPriceVersions).values({
      workspaceId: workspace.id,
      revision: 1,
      effectiveFrom: currentOrbitBillingPeriod(billingInterval).start,
      currency: "EUR",
      baseFeeCents: 0,
      includedInstanceSlots: Math.min(1, input.instanceSlotLimit),
      additionalInstanceFeeCents: 0,
      createdByAccountId: account.id,
    });
    await tx.insert(orbitAuditEvents).values({
      workspaceId: workspace.id,
      actorAccountId: account.id,
      action: "workspace.created",
      resourceType: "workspace",
      resourceId: workspace.id,
      targetOrganizationId: user.organizationId,
      outcome: "succeeded",
      metadata: { initialInstance: true },
    });
    return { account, workspace };
  });
}

export async function listOrbitWorkspaces(user: User) {
  const actor = await requireOrbitActor(user);
  const rows = await db
    .select({
      id: orbitWorkspaces.id,
      name: orbitWorkspaces.name,
      slug: orbitWorkspaces.slug,
      instanceSlotLimit: orbitWorkspaces.instanceSlotLimit,
      role: orbitWorkspaceMemberships.role,
      permissionSet: orbitPermissionSets.permissions,
      updatedAt: orbitWorkspaces.updatedAt,
    })
    .from(orbitWorkspaceMemberships)
    .innerJoin(
      orbitWorkspaces,
      eq(orbitWorkspaces.id, orbitWorkspaceMemberships.workspaceId),
    )
    .leftJoin(
      orbitPermissionSets,
      and(
        eq(orbitPermissionSets.id, orbitWorkspaceMemberships.permissionSetId),
        eq(orbitPermissionSets.workspaceId, orbitWorkspaceMemberships.workspaceId),
      ),
    )
    .where(eq(orbitWorkspaceMemberships.accountId, actor.accountId))
    .orderBy(orbitWorkspaces.name, orbitWorkspaces.id);
  const workspaceIds = rows.map((row) => row.id);
  const counts = workspaceIds.length
    ? await db
        .select({
          workspaceId: orbitInstances.workspaceId,
          count: sql<number>`count(*)::int`,
        })
        .from(orbitInstances)
        .where(inArray(orbitInstances.workspaceId, workspaceIds))
        .groupBy(orbitInstances.workspaceId)
    : [];
  const countByWorkspace = new Map(
    counts.map((row) => [row.workspaceId, Number(row.count)]),
  );
  const partnerWorkspaceIds = rows
    .filter((row) => row.role === "partner")
    .map((row) => row.id);
  const partnerDelegations = partnerWorkspaceIds.length
    ? await db
        .select({ workspaceId: orbitPartnerDelegations.workspaceId })
        .from(orbitPartnerDelegations)
        .innerJoin(
          orbitInstances,
          and(
            eq(orbitInstances.workspaceId, orbitPartnerDelegations.workspaceId),
            eq(
              orbitInstances.organizationId,
              orbitPartnerDelegations.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(orbitPartnerDelegations.partnerAccountId, actor.accountId),
            inArray(orbitPartnerDelegations.workspaceId, partnerWorkspaceIds),
            sql`${orbitPartnerDelegations.permissions} @> array['instances:read']::text[]`,
            eq(orbitInstances.status, "active"),
            sql`${orbitInstances.entitlements} @> array['partner_access']::text[]`,
            isNull(orbitPartnerDelegations.revokedAt),
            or(
              isNull(orbitPartnerDelegations.expiresAt),
              gt(orbitPartnerDelegations.expiresAt, new Date()),
            ),
          ),
        )
    : [];
  const delegatedCountByWorkspace = new Map<string, number>();
  for (const delegation of partnerDelegations) {
    delegatedCountByWorkspace.set(
      delegation.workspaceId,
      (delegatedCountByWorkspace.get(delegation.workspaceId) ?? 0) + 1,
    );
  }
  return {
    actor,
    workspaces: rows.map((row) => ({
      ...row,
      instanceCount:
        row.role === "partner"
          ? delegatedCountByWorkspace.get(row.id) ?? 0
          : countByWorkspace.get(row.id) ?? 0,
    })),
  };
}

export async function getOrbitWorkspaceOverview(user: User, workspaceId: string) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "instances:read",
  });
  const [workspace] = await db
    .select()
    .from(orbitWorkspaces)
    .where(eq(orbitWorkspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new ApiError(404, "not_found", "Orbit-Organisation nicht gefunden.");

  const allowedOrganizationIds = [...access.organizationIds];
  const instanceWhere = and(
    eq(orbitInstances.workspaceId, workspaceId),
    access.role === "partner"
      ? allowedOrganizationIds.length
        ? inArray(orbitInstances.organizationId, allowedOrganizationIds)
        : sql`false`
      : undefined,
  );
  const canManageMembers = access.permissions.has("memberships:manage");
  const canManageDelegations = access.permissions.has("delegations:manage");
  const canReadAudit = access.permissions.has("audit:read");
  const canReadTransfers = access.permissions.has("transfers:read");
  const canCreateTransfers = access.permissions.has("transfers:create");
  const canReadBilling = access.permissions.has("billing:read");
  const transferAccess = canReadTransfers
    ? await requireOrbitAccess({
        user,
        workspaceId,
        permission: "transfers:read",
      })
    : null;
  const auditAccess = canReadAudit
    ? await requireOrbitAccess({
        user,
        workspaceId,
        permission: "audit:read",
      })
    : null;
  const transferCreateAccess = canCreateTransfers
    ? await requireOrbitAccess({
        user,
        workspaceId,
        permission: "transfers:create",
      })
    : null;
  const transferOrganizationIds = [...(transferAccess?.organizationIds ?? [])];
  const auditOrganizationIds = [...(auditAccess?.organizationIds ?? [])];
  const transferCreateOrganizationIds = [
    ...(transferCreateAccess?.organizationIds ?? []),
  ];

  const [instanceRows, membershipRows, permissionSetRows, delegationRows, transferRows, auditRows] =
    await Promise.all([
      db
        .select({
          id: orbitInstances.id,
          organizationId: orbitInstances.organizationId,
          organizationName: organizations.name,
          organizationSlug: organizations.slug,
          organizationStatus: organizations.status,
          customerReference: orbitInstances.customerReference,
          status: orbitInstances.status,
          seatLimit: orbitInstances.seatLimit,
          courseLimit: orbitInstances.courseLimit,
          entitlements: orbitInstances.entitlements,
          userCount: sql<number>`(select count(*)::int from ${users} where ${users.organizationId} = ${orbitInstances.organizationId} and ${users.status} = 'active')`,
          courseCount: sql<number>`(select count(*)::int from ${courses} where ${courses.organizationId} = ${orbitInstances.organizationId})`,
          updatedAt: orbitInstances.updatedAt,
        })
        .from(orbitInstances)
        .innerJoin(organizations, eq(organizations.id, orbitInstances.organizationId))
        .where(instanceWhere)
        .orderBy(organizations.name, organizations.id),
      canManageMembers
        ? db
            .select({
              id: orbitWorkspaceMemberships.id,
              accountId: orbitWorkspaceMemberships.accountId,
              displayName: orbitAccounts.displayName,
              email: orbitAccounts.email,
              accountStatus: orbitAccounts.status,
              role: orbitWorkspaceMemberships.role,
              permissionSetId: orbitWorkspaceMemberships.permissionSetId,
              permissionSetName: orbitPermissionSets.name,
              updatedAt: orbitWorkspaceMemberships.updatedAt,
            })
            .from(orbitWorkspaceMemberships)
            .innerJoin(orbitAccounts, eq(orbitAccounts.id, orbitWorkspaceMemberships.accountId))
            .leftJoin(
              orbitPermissionSets,
              and(
                eq(orbitPermissionSets.id, orbitWorkspaceMemberships.permissionSetId),
                eq(orbitPermissionSets.workspaceId, orbitWorkspaceMemberships.workspaceId),
              ),
            )
            .where(eq(orbitWorkspaceMemberships.workspaceId, workspaceId))
            .orderBy(orbitAccounts.displayName, orbitAccounts.id)
        : Promise.resolve([]),
      canManageMembers
        ? db
            .select()
            .from(orbitPermissionSets)
            .where(eq(orbitPermissionSets.workspaceId, workspaceId))
            .orderBy(orbitPermissionSets.name, orbitPermissionSets.id)
        : Promise.resolve([]),
      canManageDelegations
        ? db
            .select({
              id: orbitPartnerDelegations.id,
              partnerAccountId: orbitPartnerDelegations.partnerAccountId,
              partnerName: orbitAccounts.displayName,
              partnerEmail: orbitAccounts.email,
              organizationId: orbitPartnerDelegations.organizationId,
              organizationName: organizations.name,
              permissions: orbitPartnerDelegations.permissions,
              expiresAt: orbitPartnerDelegations.expiresAt,
              revokedAt: orbitPartnerDelegations.revokedAt,
              updatedAt: orbitPartnerDelegations.updatedAt,
            })
            .from(orbitPartnerDelegations)
            .innerJoin(orbitAccounts, eq(orbitAccounts.id, orbitPartnerDelegations.partnerAccountId))
            .innerJoin(organizations, eq(organizations.id, orbitPartnerDelegations.organizationId))
            .where(eq(orbitPartnerDelegations.workspaceId, workspaceId))
            .orderBy(desc(orbitPartnerDelegations.createdAt))
        : Promise.resolve([]),
      canReadTransfers
        ? db
            .select()
            .from(orbitTransferJobs)
            .where(
              and(
                eq(orbitTransferJobs.workspaceId, workspaceId),
                access.role === "partner"
                  ? transferOrganizationIds.length
                    ? and(
                        inArray(
                          orbitTransferJobs.sourceOrganizationId,
                          transferOrganizationIds,
                        ),
                        inArray(
                          orbitTransferJobs.targetOrganizationId,
                          transferOrganizationIds,
                        ),
                      )
                    : sql`false`
                  : undefined,
              ),
            )
            .orderBy(desc(orbitTransferJobs.createdAt))
            .limit(50)
        : Promise.resolve([]),
      canReadAudit
        ? db
            .select({
              id: orbitAuditEvents.id,
              actorAccountId: orbitAuditEvents.actorAccountId,
              actorName: orbitAccounts.displayName,
              action: orbitAuditEvents.action,
              resourceType: orbitAuditEvents.resourceType,
              resourceId: orbitAuditEvents.resourceId,
              sourceOrganizationId: orbitAuditEvents.sourceOrganizationId,
              targetOrganizationId: orbitAuditEvents.targetOrganizationId,
              outcome: orbitAuditEvents.outcome,
              metadata: orbitAuditEvents.metadata,
              createdAt: orbitAuditEvents.createdAt,
            })
            .from(orbitAuditEvents)
            .leftJoin(orbitAccounts, eq(orbitAccounts.id, orbitAuditEvents.actorAccountId))
            .where(
              and(
                eq(orbitAuditEvents.workspaceId, workspaceId),
                access.role === "partner"
                  ? auditOrganizationIds.length
                    ? and(
                        or(
                          isNull(orbitAuditEvents.sourceOrganizationId),
                          inArray(
                            orbitAuditEvents.sourceOrganizationId,
                            auditOrganizationIds,
                          ),
                        ),
                        or(
                          isNull(orbitAuditEvents.targetOrganizationId),
                          inArray(
                            orbitAuditEvents.targetOrganizationId,
                            auditOrganizationIds,
                          ),
                        ),
                        or(
                          isNotNull(orbitAuditEvents.sourceOrganizationId),
                          isNotNull(orbitAuditEvents.targetOrganizationId),
                        ),
                      )
                    : sql`false`
                  : undefined,
              ),
            )
            .orderBy(desc(orbitAuditEvents.createdAt))
            .limit(100)
        : Promise.resolve([]),
    ]);

  const publishedCourses = transferCreateOrganizationIds.length
    ? await db
        .select({
          id: courses.id,
          organizationId: courses.organizationId,
          title: courses.title,
          slug: courses.slug,
        })
        .from(courses)
        .where(
          and(
            inArray(courses.organizationId, transferCreateOrganizationIds),
            eq(courses.status, "published"),
            sql`${courses.publishedVersionId} is not null`,
          ),
        )
        .orderBy(courses.title, courses.id)
    : [];

  const instancesWithOrigins = await Promise.all(
    instanceRows.map(async (instance) => ({
      ...instance,
      loginOrigin: await getCanonicalTenantAuthOrigin(instance.organizationId),
    })),
  );
  const visibleAuditRows =
    access.role === "partner"
      ? auditRows.map((event) => ({
          ...event,
          actorAccountId: null,
          actorName: null,
          resourceId: null,
          metadata: {},
        }))
      : auditRows;
  const billing = canReadBilling
    ? await loadOrbitBillingView(workspaceId, instanceRows.length)
    : null;

  return {
    actor: access.actor,
    access: {
      role: access.role,
      permissions: [...access.permissions].sort(),
      organizationIds: allowedOrganizationIds.sort(),
    },
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      instanceSlotLimit: workspace.instanceSlotLimit,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    instances: instancesWithOrigins,
    memberships: membershipRows,
    permissionSets: permissionSetRows,
    delegations: delegationRows,
    transfers: transferRows.map(publicOrbitTransferJob),
    auditEvents: visibleAuditRows,
    publishedCourses,
    billing,
  };
}

async function loadOrbitBillingView(
  workspaceId: string,
  instanceCount: number,
) {
  const [[account], statements] = await Promise.all([
    db
      .select()
      .from(orbitBillingAccounts)
      .where(eq(orbitBillingAccounts.workspaceId, workspaceId))
      .limit(1),
    db
      .select()
      .from(orbitBillingStatements)
      .where(eq(orbitBillingStatements.workspaceId, workspaceId))
      .orderBy(desc(orbitBillingStatements.periodEnd))
      .limit(24),
  ]);
  if (!account) {
    throw new ApiError(
      409,
      "conflict",
      "Fuer diese Orbit-Organisation fehlt die Abrechnungskonfiguration.",
    );
  }
  const period = currentOrbitBillingPeriod(account.billingInterval);
  const [[effectivePricing], scheduledVersions] = await Promise.all([
    db
      .select()
      .from(orbitBillingPriceVersions)
      .where(
        and(
          eq(orbitBillingPriceVersions.workspaceId, workspaceId),
          lte(orbitBillingPriceVersions.effectiveFrom, period.start),
        ),
      )
      .orderBy(
        desc(orbitBillingPriceVersions.effectiveFrom),
        desc(orbitBillingPriceVersions.revision),
      )
      .limit(1),
    db
      .select()
      .from(orbitBillingPriceVersions)
      .where(
        and(
          eq(orbitBillingPriceVersions.workspaceId, workspaceId),
          gt(orbitBillingPriceVersions.effectiveFrom, period.start),
        ),
      )
      .orderBy(
        asc(orbitBillingPriceVersions.effectiveFrom),
        desc(orbitBillingPriceVersions.revision),
      )
      .limit(1),
  ]);
  if (!effectivePricing) {
    throw new ApiError(
      409,
      "conflict",
      "Fuer die aktuelle Abrechnungsperiode fehlt eine wirksame Preisversion.",
    );
  }
  const projection = calculateOrbitBillingProjection({
    pricing: { ...effectivePricing, billingInterval: account.billingInterval },
    instanceCount,
    period,
  });
  return {
    account,
    effectivePricing,
    scheduledPricing: scheduledVersions[0] ?? null,
    projection,
    statements,
  };
}

export async function getOrbitBillingOverview(user: User, workspaceId: string) {
  await requireOrbitAccess({ user, workspaceId, permission: "billing:read" });
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orbitInstances)
    .where(eq(orbitInstances.workspaceId, workspaceId));
  return loadOrbitBillingView(workspaceId, Number(row?.count ?? 0));
}

export async function updateOrbitBilling(
  user: User,
  workspaceId: string,
  input: OrbitBillingUpdateInput,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "billing:manage",
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-billing:${workspaceId}`}, 0))`,
    );
    await requireLockedOrbitBillingManager(
      tx,
      workspaceId,
      access.actor.accountId,
    );
    const [[workspace], [currentAccount]] = await Promise.all([
      tx
      .select({ instanceSlotLimit: orbitWorkspaces.instanceSlotLimit })
      .from(orbitWorkspaces)
      .where(eq(orbitWorkspaces.id, workspaceId))
      .limit(1),
      tx
        .select()
        .from(orbitBillingAccounts)
        .where(eq(orbitBillingAccounts.workspaceId, workspaceId))
        .limit(1),
    ]);
    if (!workspace) {
      throw new ApiError(404, "not_found", "Orbit-Organisation nicht gefunden.");
    }
    if (!currentAccount) {
      throw new ApiError(
        409,
        "conflict",
        "Fuer diese Orbit-Organisation fehlt die Abrechnungskonfiguration.",
      );
    }
    if (input.billingInterval !== currentAccount.billingInterval) {
      throw new ApiError(
        409,
        "conflict",
        "Das Abrechnungsintervall ist nach Aktivierung des Workspaces unveraenderlich.",
      );
    }
    if (input.includedInstanceSlots > workspace.instanceSlotLimit) {
      throw new ApiError(
        409,
        "conflict",
        "Enthaltene Instanzslots duerfen das Workspace-Slotlimit nicht ueberschreiten.",
      );
    }
    const now = new Date();
    const [account] = await tx
      .update(orbitBillingAccounts)
      .set({
        status: input.status,
        currency: input.currency,
        billingInterval: input.billingInterval,
        baseFeeCents: input.baseFeeCents,
        includedInstanceSlots: input.includedInstanceSlots,
        additionalInstanceFeeCents: input.additionalInstanceFeeCents,
        settlementMode: input.settlementMode,
        externalCustomerReference: input.externalCustomerReference,
        revision: sql`${orbitBillingAccounts.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(orbitBillingAccounts.workspaceId, workspaceId),
          eq(orbitBillingAccounts.revision, input.expectedRevision),
        ),
      )
      .returning();
    if (!account) {
      throw new ApiError(
        409,
        "conflict",
        "Die Abrechnung wurde zwischenzeitlich geaendert. Laden Sie den aktuellen Stand neu.",
      );
    }
    const pricingEffectiveFrom = currentOrbitBillingPeriod(
      account.billingInterval,
      now,
    ).end;
    await tx.insert(orbitBillingPriceVersions).values({
      workspaceId,
      revision: account.revision,
      effectiveFrom: pricingEffectiveFrom,
      currency: account.currency,
      baseFeeCents: account.baseFeeCents,
      includedInstanceSlots: account.includedInstanceSlots,
      additionalInstanceFeeCents: account.additionalInstanceFeeCents,
      createdByAccountId: access.actor.accountId,
      createdAt: now,
    });
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "billing.configuration.updated",
      resourceType: "billing_account",
      resourceId: workspaceId,
      outcome: "succeeded",
      metadata: {
        revision: account.revision,
        status: account.status,
        currency: account.currency,
        billingInterval: account.billingInterval,
        settlementMode: account.settlementMode,
        pricingEffectiveFrom: pricingEffectiveFrom.toISOString(),
      },
    }, tx);
    return account;
  });
}

export async function finalizePreviousOrbitBillingPeriod(
  user: User,
  workspaceId: string,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "billing:manage",
  });
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-billing:${workspaceId}`}, 0))`,
    );
    await requireLockedOrbitBillingManager(
      tx,
      workspaceId,
      access.actor.accountId,
    );
    const [[account], [workspace], finalizedPeriods] = await Promise.all([
      tx
        .select()
        .from(orbitBillingAccounts)
        .where(eq(orbitBillingAccounts.workspaceId, workspaceId))
        .limit(1),
      tx
        .select({ createdAt: orbitWorkspaces.createdAt })
        .from(orbitWorkspaces)
        .where(eq(orbitWorkspaces.id, workspaceId))
        .limit(1),
      tx
        .select({ periodStart: orbitBillingStatements.periodStart })
        .from(orbitBillingStatements)
        .where(eq(orbitBillingStatements.workspaceId, workspaceId)),
    ]);
    if (!account) {
      throw new ApiError(
        409,
        "conflict",
        "Fuer diese Orbit-Organisation fehlt die Abrechnungskonfiguration.",
      );
    }
    if (!workspace) {
      throw new ApiError(404, "not_found", "Orbit-Organisation nicht gefunden.");
    }
    const now = new Date();
    const duePeriods = dueOrbitBillingPeriods(
      account.billingInterval,
      workspace.createdAt,
      finalizedPeriods.map((period) => period.periodStart),
      now,
    );
    if (!duePeriods.length) {
      const [existing] = await tx
        .select()
        .from(orbitBillingStatements)
        .where(eq(orbitBillingStatements.workspaceId, workspaceId))
        .orderBy(desc(orbitBillingStatements.periodEnd))
        .limit(1);
      if (existing) {
        return { statement: existing, created: false, finalizedCount: 0 };
      }
      throw new ApiError(
        409,
        "conflict",
        "Fuer diesen Workspace ist noch keine Abrechnungsperiode faellig.",
      );
    }
    const reconciledStatements = [];
    let finalizedCount = 0;
    for (const period of duePeriods) {
      const [[countRow], [pricing]] = await Promise.all([
        tx
          .select({ count: sql<number>`count(*)::int` })
          .from(orbitInstances)
          .where(
            and(
              eq(orbitInstances.workspaceId, workspaceId),
              lt(orbitInstances.createdAt, period.end),
            ),
          ),
        tx
          .select()
          .from(orbitBillingPriceVersions)
          .where(
            and(
              eq(orbitBillingPriceVersions.workspaceId, workspaceId),
              lte(orbitBillingPriceVersions.effectiveFrom, period.start),
            ),
          )
          .orderBy(
            desc(orbitBillingPriceVersions.effectiveFrom),
            desc(orbitBillingPriceVersions.revision),
          )
          .limit(1),
      ]);
      if (!pricing) {
        throw new ApiError(
          409,
          "conflict",
          "Fuer eine faellige Periode fehlt eine wirksame Preisversion.",
        );
      }
      const projection = calculateOrbitBillingProjection({
        pricing: { ...pricing, billingInterval: account.billingInterval },
        instanceCount: Number(countRow?.count ?? 0),
        period,
      });
      const [inserted] = await tx
        .insert(orbitBillingStatements)
        .values({
          workspaceId,
          periodStart: period.start,
          periodEnd: period.end,
          instanceCount: projection.instanceCount,
          includedInstanceSlots: projection.includedInstanceSlots,
          additionalInstanceCount: projection.additionalInstanceCount,
          baseFeeCents: projection.baseFeeCents,
          additionalInstanceFeeCents: projection.additionalInstanceFeeCents,
          subtotalCents: projection.subtotalCents,
          currency: projection.currency,
          pricingRevision: projection.pricingRevision,
          finalizedByAccountId: access.actor.accountId,
          finalizedAt: now,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      const statement = inserted ??
        (await tx
          .select()
          .from(orbitBillingStatements)
          .where(
            and(
              eq(orbitBillingStatements.workspaceId, workspaceId),
              eq(orbitBillingStatements.periodStart, period.start),
              eq(orbitBillingStatements.periodEnd, period.end),
            ),
          )
          .limit(1))[0];
      if (!statement) {
        throw new ApiError(
          409,
          "conflict",
          "Abrechnungsperiode konnte nicht abgeschlossen werden.",
        );
      }
      reconciledStatements.push(statement);
      if (!inserted) continue;
      finalizedCount += 1;
      await auditOrbitEvent({
        workspaceId,
        actorAccountId: access.actor.accountId,
        action: "billing.period.finalized",
        resourceType: "billing_statement",
        resourceId: inserted.id,
        outcome: "succeeded",
        metadata: {
          periodStart: period.start.toISOString(),
          periodEnd: period.end.toISOString(),
          instanceCount: projection.instanceCount,
          subtotalCents: projection.subtotalCents,
          currency: projection.currency,
          pricingRevision: projection.pricingRevision,
        },
      }, tx);
    }
    return {
      statement: reconciledStatements.at(-1)!,
      created: finalizedCount > 0,
      finalizedCount,
    };
  });
}

export async function createOrbitPermissionSet(
  user: User,
  workspaceId: string,
  input: OrbitPermissionSetInput,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "memberships:manage",
  });
  return db.transaction(async (tx) => {
    const [permissionSet] = await tx
      .insert(orbitPermissionSets)
      .values({
        workspaceId,
        name: input.name,
        description: input.description,
        permissions: [...new Set(input.permissions)].sort(),
        createdByAccountId: access.actor.accountId,
      })
      .returning();
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "permission_set.created",
      resourceType: "permission_set",
      resourceId: permissionSet.id,
      outcome: "succeeded",
      metadata: { permissions: permissionSet.permissions },
    }, tx);
    return permissionSet;
  });
}

export async function upsertOrbitMembership(
  user: User,
  workspaceId: string,
  input: OrbitMembershipInput,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "memberships:manage",
  });
  if (input.role === "owner" && access.role !== "owner") {
    throw new ApiError(403, "forbidden", "Nur ein Orbit-Eigentuemer darf Eigentuemer zuweisen.");
  }
  if (input.permissionSetId) {
    const [permissionSet] = await db
      .select({ id: orbitPermissionSets.id })
      .from(orbitPermissionSets)
      .where(
        and(
          eq(orbitPermissionSets.id, input.permissionSetId),
          eq(orbitPermissionSets.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!permissionSet) throw new ApiError(422, "validation_error", "Permission-Set gehoert nicht zur Orbit-Organisation.");
  }
  const [account] = await db
    .select({ id: orbitAccounts.id, status: orbitAccounts.status })
    .from(orbitAccounts)
    .where(eq(orbitAccounts.id, input.accountId))
    .limit(1);
  if (!account || account.status !== "active") {
    throw new ApiError(404, "not_found", "Orbit-Account nicht gefunden.");
  }
  const membership = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-memberships:${workspaceId}`}, 0))`,
    );
    const [current] = await tx
      .select({ role: orbitWorkspaceMemberships.role })
      .from(orbitWorkspaceMemberships)
      .where(
        and(
          eq(orbitWorkspaceMemberships.workspaceId, workspaceId),
          eq(orbitWorkspaceMemberships.accountId, input.accountId),
        ),
      )
      .limit(1)
      .for("update");
    if (current?.role === "owner" && input.role !== "owner") {
      if (access.role !== "owner") {
        throw new ApiError(
          403,
          "forbidden",
          "Nur ein Orbit-Eigentuemer darf einen Eigentuemer herabstufen.",
        );
      }
      const [ownerCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orbitWorkspaceMemberships)
        .where(
          and(
            eq(orbitWorkspaceMemberships.workspaceId, workspaceId),
            eq(orbitWorkspaceMemberships.role, "owner"),
          ),
        );
      if (Number(ownerCount?.count ?? 0) <= 1) {
        throw new ApiError(409, "conflict", "Der letzte Orbit-Eigentuemer kann nicht herabgestuft werden.");
      }
    }
    const [saved] = await tx
      .insert(orbitWorkspaceMemberships)
      .values({
        workspaceId,
        accountId: input.accountId,
        role: input.role,
        permissionSetId: input.permissionSetId,
        createdByAccountId: access.actor.accountId,
      })
      .onConflictDoUpdate({
        target: [
          orbitWorkspaceMemberships.workspaceId,
          orbitWorkspaceMemberships.accountId,
        ],
        set: {
          role: input.role,
          permissionSetId: input.permissionSetId,
          updatedAt: new Date(),
        },
      })
      .returning();
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "membership.upserted",
      resourceType: "membership",
      resourceId: saved.id,
      outcome: "succeeded",
      metadata: { accountId: input.accountId, role: input.role },
    }, tx);
    return saved;
  });
  return membership;
}

export async function updateOrbitInstance(
  user: User,
  workspaceId: string,
  organizationId: string,
  input: OrbitInstanceUpdateInput,
) {
  const permission = input.entitlements ? "entitlements:manage" : "instances:manage";
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission,
    organizationIds: [organizationId],
  });
  return db.transaction(async (tx) => {
    const [instance] = await tx
      .update(orbitInstances)
      .set({ ...input, updatedAt: new Date() })
      .where(
        and(
          eq(orbitInstances.workspaceId, workspaceId),
          eq(orbitInstances.organizationId, organizationId),
        ),
      )
      .returning();
    if (!instance) throw new ApiError(404, "not_found", "Orbit-Instanz nicht gefunden.");
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "instance.updated",
      resourceType: "instance",
      resourceId: instance.id,
      targetOrganizationId: organizationId,
      outcome: "succeeded",
      metadata: { changedFields: Object.keys(input).sort() },
    }, tx);
    return instance;
  });
}

export async function upsertOrbitDelegation(
  user: User,
  workspaceId: string,
  input: OrbitDelegationInput,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "delegations:manage",
    organizationIds: [input.organizationId],
  });
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (expiresAt && expiresAt <= new Date()) {
    throw new ApiError(422, "validation_error", "Das Ablaufdatum muss in der Zukunft liegen.");
  }
  return db.transaction(async (tx) => {
    const [partner] = await tx
      .select({ role: orbitWorkspaceMemberships.role })
      .from(orbitWorkspaceMemberships)
      .where(
        and(
          eq(orbitWorkspaceMemberships.workspaceId, workspaceId),
          eq(orbitWorkspaceMemberships.accountId, input.partnerAccountId),
        ),
      )
      .limit(1)
      .for("update");
    const [instance] = await tx
      .select({
        status: orbitInstances.status,
        entitlements: orbitInstances.entitlements,
      })
      .from(orbitInstances)
      .where(
        and(
          eq(orbitInstances.workspaceId, workspaceId),
          eq(orbitInstances.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!partner || partner.role !== "partner") {
      throw new ApiError(
        422,
        "validation_error",
        "Delegationen koennen nur Partner-Mitgliedern zugewiesen werden.",
      );
    }
    if (
      !instance ||
      instance.status !== "active" ||
      !instance.entitlements.includes("partner_access")
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Partnerzugriff ist fuer diese Instanz nicht freigeschaltet.",
      );
    }
    const [delegation] = await tx
      .insert(orbitPartnerDelegations)
      .values({
        workspaceId,
        partnerAccountId: input.partnerAccountId,
        organizationId: input.organizationId,
        permissions: [...new Set(input.permissions)].sort(),
        expiresAt,
        createdByAccountId: access.actor.accountId,
      })
      .onConflictDoUpdate({
        target: [
          orbitPartnerDelegations.workspaceId,
          orbitPartnerDelegations.partnerAccountId,
          orbitPartnerDelegations.organizationId,
        ],
        set: {
          permissions: [...new Set(input.permissions)].sort(),
          expiresAt,
          revokedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "delegation.upserted",
      resourceType: "delegation",
      resourceId: delegation.id,
      targetOrganizationId: input.organizationId,
      outcome: "succeeded",
      metadata: {
        partnerAccountId: input.partnerAccountId,
        permissions: delegation.permissions,
        expiresAt: delegation.expiresAt?.toISOString() ?? null,
      },
    }, tx);
    return delegation;
  });
}

export async function revokeOrbitDelegation(
  user: User,
  workspaceId: string,
  delegationId: string,
) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "delegations:manage",
  });
  return db.transaction(async (tx) => {
    const [delegation] = await tx
      .update(orbitPartnerDelegations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(orbitPartnerDelegations.id, delegationId),
          eq(orbitPartnerDelegations.workspaceId, workspaceId),
        ),
      )
      .returning();
    if (!delegation) throw new ApiError(404, "not_found", "Delegation nicht gefunden.");
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "delegation.revoked",
      resourceType: "delegation",
      resourceId: delegation.id,
      targetOrganizationId: delegation.organizationId,
      outcome: "succeeded",
    }, tx);
    return delegation;
  });
}

export async function createOrbitInstanceClaim(user: User, workspaceId: string) {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "instances:manage",
  });
  const token = `orbit_claim_${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60_000);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-slots:${workspaceId}`}, 0))`,
    );
    const [[workspace], [count]] = await Promise.all([
      tx
        .select({ limit: orbitWorkspaces.instanceSlotLimit })
        .from(orbitWorkspaces)
        .where(eq(orbitWorkspaces.id, workspaceId))
        .limit(1)
        .for("update"),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orbitInstances)
        .where(eq(orbitInstances.workspaceId, workspaceId)),
    ]);
    if (!workspace) throw new ApiError(404, "not_found", "Orbit-Organisation nicht gefunden.");
    if (Number(count?.count ?? 0) >= workspace.limit) {
      throw new ApiError(409, "conflict", "Alle Kundenslots dieser Orbit-Organisation sind belegt.");
    }
    const [created] = await tx
      .insert(orbitInstanceClaims)
      .values({
        workspaceId,
        tokenHash: sha256(token),
        tokenPrefix: token.slice(0, 12),
        createdByAccountId: access.actor.accountId,
        expiresAt,
      })
      .returning({ id: orbitInstanceClaims.id });
    await auditOrbitEvent({
      workspaceId,
      actorAccountId: access.actor.accountId,
      action: "instance_claim.created",
      resourceType: "instance_claim",
      resourceId: created.id,
      outcome: "succeeded",
      metadata: { expiresAt: expiresAt.toISOString() },
    }, tx);
    return created;
  });
  return { token, expiresAt };
}

export async function redeemOrbitInstanceClaim(
  user: User,
  input: { token: string; customerReference: string | null },
) {
  if (user.role !== "owner") {
    throw new ApiError(403, "forbidden", "Nur der Tenant-Eigentuemer darf den Tenant mit Orbit verknuepfen.");
  }
  const tokenHash = sha256(input.token);
  const email = normalizedEmail(user.email);
  return db.transaction(async (tx) => {
    const [claim] = await tx
      .select()
      .from(orbitInstanceClaims)
      .where(eq(orbitInstanceClaims.tokenHash, tokenHash))
      .limit(1)
      .for("update");
    if (!claim || claim.consumedAt || claim.expiresAt <= new Date()) {
      throw new ApiError(404, "not_found", "Der Instanzcode ist ungueltig oder abgelaufen.");
    }
    if (!claim.createdByAccountId) {
      throw new ApiError(409, "conflict", "Der ausstellende Orbit-Account ist nicht mehr aktiv.");
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-slots:${claim.workspaceId}`}, 0))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-identity:${email}`}, 0))`,
    );
    const [
      [workspace],
      [count],
      [existingInstance],
      [existingIdentity],
      [issuingAccount],
      [emailAccount],
    ] = await Promise.all([
      tx
        .select({ limit: orbitWorkspaces.instanceSlotLimit })
        .from(orbitWorkspaces)
        .where(eq(orbitWorkspaces.id, claim.workspaceId))
        .limit(1)
        .for("update"),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orbitInstances)
        .where(eq(orbitInstances.workspaceId, claim.workspaceId)),
      tx
        .select({ id: orbitInstances.id })
        .from(orbitInstances)
        .where(eq(orbitInstances.organizationId, user.organizationId))
        .limit(1),
      tx
        .select({
          accountId: orbitAccountIdentities.accountId,
          accountStatus: orbitAccounts.status,
        })
        .from(orbitAccountIdentities)
        .innerJoin(
          orbitAccounts,
          eq(orbitAccounts.id, orbitAccountIdentities.accountId),
        )
        .where(
          and(
            eq(orbitAccountIdentities.userId, user.id),
            eq(orbitAccountIdentities.organizationId, user.organizationId),
            isNull(orbitAccountIdentities.revokedAt),
          ),
        )
        .limit(1),
      tx
        .select({ id: orbitAccounts.id })
        .from(orbitAccounts)
        .where(
          and(
            eq(orbitAccounts.id, claim.createdByAccountId),
            eq(orbitAccounts.status, "active"),
          ),
        )
        .limit(1),
      tx
        .select({ id: orbitAccounts.id, status: orbitAccounts.status })
        .from(orbitAccounts)
        .where(sql`lower(${orbitAccounts.email}) = ${email}`)
        .limit(1),
    ]);
    if (!workspace) throw new ApiError(404, "not_found", "Orbit-Organisation nicht gefunden.");
    if (!issuingAccount) throw new ApiError(409, "conflict", "Der ausstellende Orbit-Account ist nicht mehr aktiv.");
    if (existingInstance) throw new ApiError(409, "conflict", "Der Tenant ist bereits einer Orbit-Organisation zugeordnet.");
    if (existingIdentity?.accountStatus !== undefined && existingIdentity.accountStatus !== "active") {
      throw new ApiError(409, "conflict", "Der verknuepfte Orbit-Account ist nicht aktiv.");
    }
    if (!existingIdentity && emailAccount) {
      throw new ApiError(
        409,
        "conflict",
        "Ein bestehender Orbit-Account darf nicht allein ueber eine Tenant-E-Mail verknuepft werden.",
      );
    }
    if (Number(count?.count ?? 0) >= workspace.limit) {
      throw new ApiError(409, "conflict", "Alle Kundenslots dieser Orbit-Organisation sind belegt.");
    }
    let redeemerAccountId = existingIdentity?.accountId;
    if (!redeemerAccountId) {
      const [createdAccount] = await tx
        .insert(orbitAccounts)
        .values({
          email,
          displayName: `${user.firstName} ${user.lastName}`.trim() || email,
        })
        .returning({ id: orbitAccounts.id });
      redeemerAccountId = createdAccount.id;
    }
    if (!existingIdentity) {
      await tx.insert(orbitAccountIdentities).values({
        accountId: redeemerAccountId,
        organizationId: user.organizationId,
        userId: user.id,
      });
    }
    const [instance] = await tx
      .insert(orbitInstances)
      .values({
        workspaceId: claim.workspaceId,
        organizationId: user.organizationId,
        customerReference: input.customerReference,
      })
      .returning();
    const now = new Date();
    await tx
      .update(orbitInstanceClaims)
      .set({ consumedAt: now, consumedOrganizationId: user.organizationId })
      .where(eq(orbitInstanceClaims.id, claim.id));
    await tx.insert(orbitAuditEvents).values({
      workspaceId: claim.workspaceId,
      actorAccountId: redeemerAccountId,
      action: "instance_claim.redeemed",
      resourceType: "instance",
      resourceId: instance.id,
      targetOrganizationId: user.organizationId,
      outcome: "succeeded",
      metadata: {
        claimId: claim.id,
        issuedByAccountId: claim.createdByAccountId,
      },
    });
    return { workspaceId: claim.workspaceId, instance };
  });
}
