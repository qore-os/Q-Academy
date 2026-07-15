import "server-only";

import { createHash } from "node:crypto";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import {
  bundles,
  apiKeys,
  activityEvents,
  communitySpaceAccessRules,
  communitySpaces,
  groupBundles,
  groupMembers,
  groups,
  memberBundles,
  users,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import type { ApiContext } from "@/lib/api/auth";
import { assertCommunityManager } from "@/lib/community-management-auth";

export type CommunitySpacePermissions = Readonly<{
  canView: boolean;
  canPost: boolean;
  canComment: boolean;
  canManage: boolean;
}>;

export type CommunityPolicyActor = Readonly<{
  id: string;
  organizationId: string;
  role: User["role"];
}>;

export type CommunityAccessRuleInput = Readonly<{
  subjectType: "role" | "user" | "group" | "bundle";
  subjectRole?: User["role"] | null;
  subjectUserId?: string | null;
  subjectGroupId?: string | null;
  subjectBundleId?: string | null;
  canView: boolean;
  canPost: boolean;
  canComment: boolean;
}>;

type CommunityExecutor = Pick<ApiTransaction, "select" | "insert" | "delete" | "update">;

function isAdmin(role: User["role"]) {
  return role === "owner" || role === "admin";
}

export async function communityApiActorForContext(context: ApiContext) {
  const [actor] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, context.apiKeyId),
        eq(apiKeys.organizationId, context.organizationId),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Community-Akteur zugeordnet.",
    );
  }
  return actor;
}

export function assertCommunityApiActorCanActAs(
  actor: CommunityPolicyActor,
  userId: string,
) {
  if (actor.id !== userId && !isAdmin(actor.role)) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel darf nicht fuer dieses Mitglied handeln.",
    );
  }
}

function directBundleMembership(userId: string, organizationId: string) {
  return exists(
    db
      .select({ id: memberBundles.bundleId })
      .from(memberBundles)
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, memberBundles.bundleId),
          eq(bundles.organizationId, organizationId),
          eq(bundles.active, true),
        ),
      )
      .where(
        and(
          eq(memberBundles.userId, userId),
          eq(memberBundles.bundleId, communitySpaceAccessRules.subjectBundleId),
        ),
      ),
  );
}

function groupBundleMembership(userId: string, organizationId: string) {
  return exists(
    db
      .select({ id: groupBundles.bundleId })
      .from(groupMembers)
      .innerJoin(
        groups,
        and(
          eq(groups.id, groupMembers.groupId),
          eq(groups.organizationId, organizationId),
        ),
      )
      .innerJoin(groupBundles, eq(groupBundles.groupId, groups.id))
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, groupBundles.bundleId),
          eq(bundles.organizationId, organizationId),
          eq(bundles.active, true),
        ),
      )
      .where(
        and(
          eq(groupMembers.userId, userId),
          eq(groupBundles.bundleId, communitySpaceAccessRules.subjectBundleId),
        ),
      ),
  );
}

function matchingCommunityRule(actor: CommunityPolicyActor): SQL {
  return or(
    and(
      eq(communitySpaceAccessRules.subjectType, "role"),
      eq(communitySpaceAccessRules.subjectRole, actor.role),
    ),
    and(
      eq(communitySpaceAccessRules.subjectType, "user"),
      eq(communitySpaceAccessRules.subjectUserId, actor.id),
    ),
    and(
      eq(communitySpaceAccessRules.subjectType, "group"),
      exists(
        db
          .select({ id: groupMembers.groupId })
          .from(groupMembers)
          .innerJoin(
            groups,
            and(
              eq(groups.id, groupMembers.groupId),
              eq(groups.organizationId, actor.organizationId),
            ),
          )
          .where(
            and(
              eq(groupMembers.userId, actor.id),
              eq(groupMembers.groupId, communitySpaceAccessRules.subjectGroupId),
            ),
          ),
      ),
    ),
    and(
      eq(communitySpaceAccessRules.subjectType, "bundle"),
      or(
        directBundleMembership(actor.id, actor.organizationId),
        groupBundleMembership(actor.id, actor.organizationId),
      ),
    ),
  )!;
}

function restrictedPermissionGrant(
  actor: CommunityPolicyActor,
  permission: "canView" | "canPost" | "canComment",
) {
  return exists(
    db
      .select({ id: communitySpaceAccessRules.id })
      .from(communitySpaceAccessRules)
      .where(
        and(
          eq(
            communitySpaceAccessRules.organizationId,
            communitySpaces.organizationId,
          ),
          eq(communitySpaceAccessRules.spaceId, communitySpaces.id),
          eq(communitySpaceAccessRules[permission], true),
          matchingCommunityRule(actor),
        ),
      ),
  );
}

export function communitySpaceVisibilitySql(actor: CommunityPolicyActor) {
  if (isAdmin(actor.role)) return sql<boolean>`true`;
  return or(
    eq(communitySpaces.accessMode, "open"),
    and(
      eq(communitySpaces.accessMode, "restricted"),
      restrictedPermissionGrant(actor, "canView"),
    ),
  )!;
}

export function communitySpacePermissionSql(actor: CommunityPolicyActor) {
  const admin = isAdmin(actor.role);
  const viewGrant = restrictedPermissionGrant(actor, "canView");
  const postGrant = restrictedPermissionGrant(actor, "canPost");
  const commentGrant = restrictedPermissionGrant(actor, "canComment");
  return {
    canView: sql<boolean>`case
      when ${admin} then true
      when ${communitySpaces.accessMode} = 'open' then true
      else ${viewGrant}
    end`.mapWith(Boolean),
    canPost: sql<boolean>`case
      when ${communitySpaces.type} = 'announcement' then ${admin}
      when ${admin} then true
      when ${communitySpaces.accessMode} = 'open' then true
      else (${viewGrant} and ${postGrant})
    end`.mapWith(Boolean),
    canComment: sql<boolean>`case
      when ${communitySpaces.type} = 'announcement' then false
      when ${admin} then true
      when ${communitySpaces.accessMode} = 'open' then true
      else (${viewGrant} and ${commentGrant})
    end`.mapWith(Boolean),
    canManage: admin,
  };
}

export async function resolveCommunitySpacePermissions(input: {
  executor?: CommunityExecutor;
  actor: CommunityPolicyActor;
  spaceId: string;
  lock?: boolean;
}) {
  const executor = input.executor ?? db;
  const admin = isAdmin(input.actor.role);
  const permissionSql = communitySpacePermissionSql(input.actor);
  const query = executor
    .select({
      id: communitySpaces.id,
      type: communitySpaces.type,
      accessMode: communitySpaces.accessMode,
      actorId: users.id,
      canView: permissionSql.canView,
      canPost: permissionSql.canPost,
      canComment: permissionSql.canComment,
    })
    .from(communitySpaces)
    .innerJoin(
      users,
      and(
        eq(users.id, input.actor.id),
        eq(users.organizationId, input.actor.organizationId),
        eq(users.status, "active"),
        eq(users.role, input.actor.role),
      ),
    )
    .where(
      and(
        eq(communitySpaces.id, input.spaceId),
        eq(communitySpaces.organizationId, input.actor.organizationId),
      ),
    )
    .limit(1);
  const [row] = input.lock
    ? await query.for("share", { of: communitySpaces })
    : await query;
  if (!row) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }
  return {
    space: {
      id: row.id,
      type: row.type,
      accessMode: row.accessMode,
    },
    permissions: {
      canView: Boolean(row.canView),
      canPost: Boolean(row.canPost),
      canComment: Boolean(row.canComment),
      canManage: admin,
    } satisfies CommunitySpacePermissions,
  };
}

export async function resolveCommunitySpacePermissionsBatch(input: {
  actor: CommunityPolicyActor;
  spaceIds: readonly string[];
}) {
  const spaceIds = [...new Set(input.spaceIds)];
  if (spaceIds.length === 0) {
    return new Map<string, CommunitySpacePermissions>();
  }
  const admin = isAdmin(input.actor.role);
  const permissionSql = communitySpacePermissionSql(input.actor);
  const rows = await db
    .select({
      id: communitySpaces.id,
      canView: permissionSql.canView,
      canPost: permissionSql.canPost,
      canComment: permissionSql.canComment,
    })
    .from(communitySpaces)
    .innerJoin(
      users,
      and(
        eq(users.id, input.actor.id),
        eq(users.organizationId, input.actor.organizationId),
        eq(users.status, "active"),
        eq(users.role, input.actor.role),
      ),
    )
    .where(
      and(
        eq(communitySpaces.organizationId, input.actor.organizationId),
        inArray(communitySpaces.id, spaceIds),
      ),
    );
  return new Map(
    rows.map((row) => [
      row.id,
      {
        canView: row.canView,
        canPost: row.canPost,
        canComment: row.canComment,
        canManage: admin,
      } satisfies CommunitySpacePermissions,
    ]),
  );
}

export function assertCommunityPermission(
  permissions: CommunitySpacePermissions,
  permission: "canView" | "canPost" | "canComment" | "canManage",
) {
  if (permissions[permission]) return;

  if (!permissions.canView) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }

  throw new ApiError(
    403,
    "forbidden",
    "Keine Berechtigung fuer diese Community-Aktion.",
  );
}

function ruleIdentity(rule: CommunityAccessRuleInput) {
  switch (rule.subjectType) {
    case "role":
      return `role:${rule.subjectRole ?? ""}`;
    case "user":
      return `user:${rule.subjectUserId ?? ""}`;
    case "group":
      return `group:${rule.subjectGroupId ?? ""}`;
    case "bundle":
      return `bundle:${rule.subjectBundleId ?? ""}`;
  }
}

function accessPolicyDigest(rules: readonly CommunityAccessRuleInput[]) {
  const normalized = [...rules]
    .map((rule) => ({
      identity: ruleIdentity(rule),
      canView: rule.canView,
      canPost: rule.canPost,
      canComment: rule.canComment,
    }))
    .sort((left, right) => left.identity.localeCompare(right.identity));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function accessPolicySummary(rules: readonly CommunityAccessRuleInput[]) {
  return {
    roles: rules.filter((rule) => rule.subjectType === "role").length,
    users: rules.filter((rule) => rule.subjectType === "user").length,
    groups: rules.filter((rule) => rule.subjectType === "group").length,
    bundles: rules.filter((rule) => rule.subjectType === "bundle").length,
    viewRules: rules.filter((rule) => rule.canView).length,
    postRules: rules.filter((rule) => rule.canPost).length,
    commentRules: rules.filter((rule) => rule.canComment).length,
  };
}

export async function replaceCommunitySpaceAccessPolicy(input: {
  organizationId: string;
  actorId: string;
  spaceId: string;
  accessMode: "open" | "restricted";
  rules: readonly CommunityAccessRuleInput[];
}) {
  return db.transaction(async (tx) => {
    const actor = await assertCommunityManager(tx, input);
    const [space] = await tx
      .select({ id: communitySpaces.id, accessMode: communitySpaces.accessMode })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.id, input.spaceId),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!space) {
      throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
    }
    const previousRuleRows = await tx
      .select({
        subjectType: communitySpaceAccessRules.subjectType,
        subjectRole: communitySpaceAccessRules.subjectRole,
        subjectUserId: communitySpaceAccessRules.subjectUserId,
        subjectGroupId: communitySpaceAccessRules.subjectGroupId,
        subjectBundleId: communitySpaceAccessRules.subjectBundleId,
        canView: communitySpaceAccessRules.canView,
        canPost: communitySpaceAccessRules.canPost,
        canComment: communitySpaceAccessRules.canComment,
      })
      .from(communitySpaceAccessRules)
      .where(
        and(
          eq(communitySpaceAccessRules.organizationId, input.organizationId),
          eq(communitySpaceAccessRules.spaceId, space.id),
        ),
      );
    const previousRules = previousRuleRows as CommunityAccessRuleInput[];
    const identities = input.rules.map(ruleIdentity);
    if (new Set(identities).size !== identities.length) {
      throw new ApiError(422, "validation_error", "Eine Community-Zugriffsregel ist mehrfach vorhanden.");
    }
    if (
      input.rules.some(
        (rule) =>
          (!rule.canView && (rule.canPost || rule.canComment)) ||
          (!rule.canView && !rule.canPost && !rule.canComment),
      )
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Community-Schreibrechte setzen Leserechte voraus.",
      );
    }
    const subjectUserIds = input.rules.flatMap((rule) =>
      rule.subjectType === "user" && rule.subjectUserId
        ? [rule.subjectUserId]
        : [],
    );
    const subjectGroupIds = input.rules.flatMap((rule) =>
      rule.subjectType === "group" && rule.subjectGroupId
        ? [rule.subjectGroupId]
        : [],
    );
    const subjectBundleIds = input.rules.flatMap((rule) =>
      rule.subjectType === "bundle" && rule.subjectBundleId
        ? [rule.subjectBundleId]
        : [],
    );
    const [validUsers, validGroups, validBundles] = await Promise.all([
      subjectUserIds.length
        ? tx
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.organizationId, input.organizationId),
                eq(users.status, "active"),
                inArray(users.id, subjectUserIds),
              ),
            )
        : Promise.resolve([]),
      subjectGroupIds.length
        ? tx
            .select({ id: groups.id })
            .from(groups)
            .where(
              and(
                eq(groups.organizationId, input.organizationId),
                inArray(groups.id, subjectGroupIds),
              ),
            )
        : Promise.resolve([]),
      subjectBundleIds.length
        ? tx
            .select({ id: bundles.id })
            .from(bundles)
            .where(
              and(
                eq(bundles.organizationId, input.organizationId),
                eq(bundles.active, true),
                inArray(bundles.id, subjectBundleIds),
              ),
            )
        : Promise.resolve([]),
    ]);
    if (
      validUsers.length !== subjectUserIds.length ||
      validGroups.length !== subjectGroupIds.length ||
      validBundles.length !== subjectBundleIds.length
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Mindestens ein Community-Regelziel ist ungueltig oder nicht aktiv.",
      );
    }

    await tx
      .delete(communitySpaceAccessRules)
      .where(
        and(
          eq(communitySpaceAccessRules.organizationId, input.organizationId),
          eq(communitySpaceAccessRules.spaceId, space.id),
        ),
      );
    if (input.rules.length) {
      await tx.insert(communitySpaceAccessRules).values(
        input.rules.map((rule) => ({
          organizationId: input.organizationId,
          spaceId: space.id,
          subjectType: rule.subjectType,
          subjectRole: rule.subjectType === "role" ? rule.subjectRole : null,
          subjectUserId: rule.subjectType === "user" ? rule.subjectUserId : null,
          subjectGroupId: rule.subjectType === "group" ? rule.subjectGroupId : null,
          subjectBundleId: rule.subjectType === "bundle" ? rule.subjectBundleId : null,
          canView: rule.canView,
          canPost: rule.canPost,
          canComment: rule.canComment,
        })),
      );
    }
    const [updated] = await tx
      .update(communitySpaces)
      .set({ accessMode: input.accessMode })
      .where(
        and(
          eq(communitySpaces.id, space.id),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: actor.id,
      type: "community_space.access_policy_replaced",
      entityType: "community_space",
      entityId: space.id,
      metadata: {
        previousAccessMode: space.accessMode,
        accessMode: input.accessMode,
        previousRuleCount: previousRules.length,
        ruleCount: input.rules.length,
        previousSummary: accessPolicySummary(previousRules),
        summary: accessPolicySummary(input.rules),
        previousDigest: accessPolicyDigest(previousRules),
        digest: accessPolicyDigest(input.rules),
      },
    });
    return { ...updated, rules: [...input.rules] };
  });
}

export async function communitySpaceAccessPolicyForAdmin(input: {
  organizationId: string;
  actorId: string;
  spaceId: string;
}) {
  const actor: CommunityPolicyActor = {
    id: input.actorId,
    organizationId: input.organizationId,
    role: "member",
  };
  const [actorRow] = await db
    .select({ role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!actorRow || !isAdmin(actorRow.role)) {
    throw new ApiError(403, "forbidden", "Nur Administratoren duerfen Community-Rechte verwalten.");
  }
  const [space] = await db
    .select()
    .from(communitySpaces)
    .where(
      and(
        eq(communitySpaces.id, input.spaceId),
        eq(communitySpaces.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!space) throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  const rules = await db
    .select()
    .from(communitySpaceAccessRules)
    .where(
      and(
        eq(communitySpaceAccessRules.organizationId, input.organizationId),
        eq(communitySpaceAccessRules.spaceId, input.spaceId),
      ),
    );
  return { ...space, rules };
}

export async function getCommunityAccessPolicyAdminData(
  organizationId: string,
) {
  const [spaceRows, ruleRows, userRows, groupRows, bundleRows] =
    await Promise.all([
      db
        .select({
          id: communitySpaces.id,
          accessMode: communitySpaces.accessMode,
        })
        .from(communitySpaces)
        .where(eq(communitySpaces.organizationId, organizationId))
        .orderBy(asc(communitySpaces.title)),
      db
        .select({
          spaceId: communitySpaceAccessRules.spaceId,
          subjectType: communitySpaceAccessRules.subjectType,
          subjectRole: communitySpaceAccessRules.subjectRole,
          subjectUserId: communitySpaceAccessRules.subjectUserId,
          subjectGroupId: communitySpaceAccessRules.subjectGroupId,
          subjectBundleId: communitySpaceAccessRules.subjectBundleId,
          canView: communitySpaceAccessRules.canView,
          canPost: communitySpaceAccessRules.canPost,
          canComment: communitySpaceAccessRules.canComment,
        })
        .from(communitySpaceAccessRules)
        .where(
          eq(communitySpaceAccessRules.organizationId, organizationId),
        )
        .orderBy(
          asc(communitySpaceAccessRules.spaceId),
          asc(communitySpaceAccessRules.createdAt),
        ),
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, organizationId),
            eq(users.status, "active"),
          ),
        )
        .orderBy(asc(users.lastName), asc(users.firstName), asc(users.email)),
      db
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(eq(groups.organizationId, organizationId))
        .orderBy(asc(groups.name)),
      db
        .select({ id: bundles.id, name: bundles.name })
        .from(bundles)
        .where(
          and(
            eq(bundles.organizationId, organizationId),
            eq(bundles.active, true),
          ),
        )
        .orderBy(asc(bundles.name)),
    ]);
  const rulesBySpace = new Map<string, CommunityAccessRuleInput[]>();
  for (const row of ruleRows) {
    const common = {
      canView: row.canView,
      canPost: row.canPost,
      canComment: row.canComment,
    };
    let rule: CommunityAccessRuleInput;
    switch (row.subjectType) {
      case "role":
        rule = {
          subjectType: "role",
          subjectRole: row.subjectRole!,
          ...common,
        };
        break;
      case "user":
        rule = {
          subjectType: "user",
          subjectUserId: row.subjectUserId!,
          ...common,
        };
        break;
      case "group":
        rule = {
          subjectType: "group",
          subjectGroupId: row.subjectGroupId!,
          ...common,
        };
        break;
      case "bundle":
        rule = {
          subjectType: "bundle",
          subjectBundleId: row.subjectBundleId!,
          ...common,
        };
        break;
    }
    const rules = rulesBySpace.get(row.spaceId) ?? [];
    rules.push(rule);
    rulesBySpace.set(row.spaceId, rules);
  }
  return {
    spaces: spaceRows.map((space) => ({
      ...space,
      accessRules: rulesBySpace.get(space.id) ?? [],
    })),
    users: userRows.map((user) => ({
      id: user.id,
      label: `${user.firstName} ${user.lastName} (${user.email})`,
    })),
    groups: groupRows,
    bundles: bundleRows,
  };
}
