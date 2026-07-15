import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  communityLevels,
  communityLevelSettings,
  communitySpaceModerationPolicies,
  communitySpaces,
  organizations,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { requireActiveCommunityAdmin } from "@/lib/community-admin";
import {
  validateCommunityLevelConfiguration,
  type CommunityLevelDto,
} from "@/lib/community-level-domain";

export type CommunityModerationPolicyDto = Readonly<{
  spaceId: string;
  spaceTitle: string;
  spaceType: "feed" | "discussion" | "announcement";
  postApproval: "off" | "members" | "non_admins";
  commentApproval: "off" | "members" | "non_admins";
  automationMode: "off" | "observe" | "enforce";
  reportThreshold: number | null;
  duplicateWindowMinutes: number;
  linkLimit: number;
  version: number;
}>;

export type CommunityLevelConfigurationAdminDto = Readonly<{
  enabled: boolean;
  revision: number;
  levels: readonly CommunityLevelDto[];
}>;

type CommunityLevelConfigurationInput = Readonly<
  Omit<CommunityLevelDto, "id"> & { id?: string }
>;

export type CommunityGovernanceAdminDto = Readonly<{
  policies: readonly CommunityModerationPolicyDto[];
  levelConfiguration: CommunityLevelConfigurationAdminDto;
}>;

export async function getCommunitySpaceModerationPolicy(
  organizationId: string,
  spaceId: string,
): Promise<CommunityModerationPolicyDto> {
  const [row] = await db
    .select({
      spaceId: communitySpaces.id,
      spaceTitle: communitySpaces.title,
      spaceType: communitySpaces.type,
      postApproval: communitySpaceModerationPolicies.postApproval,
      commentApproval: communitySpaceModerationPolicies.commentApproval,
      automationMode: communitySpaceModerationPolicies.automationMode,
      reportThreshold: communitySpaceModerationPolicies.reportThreshold,
      duplicateWindowMinutes:
        communitySpaceModerationPolicies.duplicateWindowMinutes,
      linkLimit: communitySpaceModerationPolicies.linkLimit,
      version: communitySpaceModerationPolicies.version,
    })
    .from(communitySpaces)
    .leftJoin(
      communitySpaceModerationPolicies,
      and(
        eq(communitySpaceModerationPolicies.spaceId, communitySpaces.id),
        eq(
          communitySpaceModerationPolicies.organizationId,
          communitySpaces.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(communitySpaces.id, spaceId),
        eq(communitySpaces.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new ApiError(404, "not_found", "Community-Bereich nicht gefunden.");
  }
  return {
    spaceId: row.spaceId,
    spaceTitle: row.spaceTitle,
    spaceType: row.spaceType,
    postApproval: row.postApproval ?? "off",
    commentApproval: row.commentApproval ?? "off",
    automationMode: row.automationMode ?? "off",
    reportThreshold: row.reportThreshold,
    duplicateWindowMinutes: row.duplicateWindowMinutes ?? 0,
    linkLimit: row.linkLimit ?? 0,
    version: row.version ?? 1,
  };
}

export async function getCommunityLevelConfiguration(
  organizationId: string,
): Promise<CommunityLevelConfigurationAdminDto> {
  const [settingsRows, levelRows] = await Promise.all([
    db
      .select({
        enabled: communityLevelSettings.enabled,
        revision: communityLevelSettings.revision,
      })
      .from(communityLevelSettings)
      .where(eq(communityLevelSettings.organizationId, organizationId))
      .limit(1),
    db
      .select({
        id: communityLevels.id,
        position: communityLevels.position,
        name: communityLevels.name,
        description: communityLevels.description,
        minPoints: communityLevels.minPoints,
        icon: communityLevels.icon,
        color: communityLevels.color,
        active: communityLevels.active,
      })
      .from(communityLevels)
      .where(eq(communityLevels.organizationId, organizationId))
      .orderBy(asc(communityLevels.position), asc(communityLevels.id)),
  ]);
  const settings = settingsRows[0];
  return {
    enabled: settings?.enabled ?? false,
    revision: settings?.revision ?? 1,
    levels: levelRows,
  };
}

export async function getCommunityGovernanceAdminData(
  organizationId: string,
): Promise<CommunityGovernanceAdminDto> {
  const [policyRows, settingsRows, levelRows] = await Promise.all([
    db
      .select({
        spaceId: communitySpaces.id,
        spaceTitle: communitySpaces.title,
        spaceType: communitySpaces.type,
        postApproval: communitySpaceModerationPolicies.postApproval,
        commentApproval: communitySpaceModerationPolicies.commentApproval,
        automationMode: communitySpaceModerationPolicies.automationMode,
        reportThreshold: communitySpaceModerationPolicies.reportThreshold,
        duplicateWindowMinutes:
          communitySpaceModerationPolicies.duplicateWindowMinutes,
        linkLimit: communitySpaceModerationPolicies.linkLimit,
        version: communitySpaceModerationPolicies.version,
      })
      .from(communitySpaces)
      .leftJoin(
        communitySpaceModerationPolicies,
        and(
          eq(
            communitySpaceModerationPolicies.spaceId,
            communitySpaces.id,
          ),
          eq(
            communitySpaceModerationPolicies.organizationId,
            communitySpaces.organizationId,
          ),
        ),
      )
      .where(eq(communitySpaces.organizationId, organizationId))
      .orderBy(asc(communitySpaces.title), asc(communitySpaces.id)),
    db
      .select({
        enabled: communityLevelSettings.enabled,
        revision: communityLevelSettings.revision,
      })
      .from(communityLevelSettings)
      .where(eq(communityLevelSettings.organizationId, organizationId))
      .limit(1),
    db
      .select({
        id: communityLevels.id,
        position: communityLevels.position,
        name: communityLevels.name,
        description: communityLevels.description,
        minPoints: communityLevels.minPoints,
        icon: communityLevels.icon,
        color: communityLevels.color,
        active: communityLevels.active,
      })
      .from(communityLevels)
      .where(eq(communityLevels.organizationId, organizationId))
      .orderBy(asc(communityLevels.position), asc(communityLevels.id)),
  ]);

  const settings = settingsRows[0];
  return {
    policies: policyRows.map((row) => ({
      spaceId: row.spaceId,
      spaceTitle: row.spaceTitle,
      spaceType: row.spaceType,
      postApproval: row.postApproval ?? "off",
      commentApproval: row.commentApproval ?? "off",
      automationMode: row.automationMode ?? "off",
      reportThreshold: row.reportThreshold,
      duplicateWindowMinutes: row.duplicateWindowMinutes ?? 0,
      linkLimit: row.linkLimit ?? 0,
      version: row.version ?? 1,
    })),
    levelConfiguration: {
      enabled: settings?.enabled ?? false,
      revision: settings?.revision ?? 1,
      levels: levelRows,
    },
  };
}

export async function updateCommunitySpaceModerationPolicy(input: {
  organizationId: string;
  actorId: string;
  spaceId: string;
  expectedVersion: number;
  postApproval: "off" | "members" | "non_admins";
  commentApproval: "off" | "members" | "non_admins";
  automationMode: "off" | "observe" | "enforce";
  reportThreshold: number | null;
  duplicateWindowMinutes: number;
  linkLimit: number;
  tx?: ApiTransaction;
}) {
  const execute = async (tx: ApiTransaction) => {
    const [space] = await tx
      .select({
        id: communitySpaces.id,
        title: communitySpaces.title,
        type: communitySpaces.type,
      })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.id, input.spaceId),
          eq(communitySpaces.organizationId, input.organizationId),
        ),
      )
      .limit(1)
      .for("update", { of: communitySpaces });
    if (!space) {
      throw new ApiError(
        404,
        "not_found",
        "Community-Bereich nicht gefunden.",
      );
    }
    await requireActiveCommunityAdmin(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
    });

    const [current] = await tx
      .select({
        id: communitySpaceModerationPolicies.id,
        version: communitySpaceModerationPolicies.version,
      })
      .from(communitySpaceModerationPolicies)
      .where(
        and(
          eq(
            communitySpaceModerationPolicies.organizationId,
            input.organizationId,
          ),
          eq(communitySpaceModerationPolicies.spaceId, input.spaceId),
        ),
      )
      .limit(1)
      .for("update", { of: communitySpaceModerationPolicies });
    const currentVersion = current?.version ?? 1;
    if (currentVersion !== input.expectedVersion) {
      throw new ApiError(
        409,
        "conflict",
        "Die Moderationsregeln wurden zwischenzeitlich geaendert.",
      );
    }

    const nextVersion = currentVersion + 1;
    const values = {
      postApproval: input.postApproval,
      commentApproval: input.commentApproval,
      automationMode: input.automationMode,
      reportThreshold: input.reportThreshold,
      duplicateWindowMinutes: input.duplicateWindowMinutes,
      linkLimit: input.linkLimit,
      version: nextVersion,
      updatedById: input.actorId,
      updatedAt: new Date(),
    };
    if (current) {
      const [updated] = await tx
        .update(communitySpaceModerationPolicies)
        .set(values)
        .where(
          and(
            eq(communitySpaceModerationPolicies.id, current.id),
            eq(
              communitySpaceModerationPolicies.organizationId,
              input.organizationId,
            ),
            eq(communitySpaceModerationPolicies.version, currentVersion),
          ),
        )
        .returning();
      if (!updated) {
        throw new ApiError(
          409,
          "conflict",
          "Die Moderationsregeln wurden zwischenzeitlich geaendert.",
        );
      }
    } else {
      await tx.insert(communitySpaceModerationPolicies).values({
        organizationId: input.organizationId,
        spaceId: input.spaceId,
        ...values,
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_moderation.policy_updated",
      entityType: "community_space",
      entityId: input.spaceId,
      metadata: {
        version: nextVersion,
        postApproval: input.postApproval,
        commentApproval: input.commentApproval,
        automationMode: input.automationMode,
      },
    });
    return {
      spaceId: input.spaceId,
      spaceTitle: space.title,
      spaceType: space.type,
      postApproval: input.postApproval,
      commentApproval: input.commentApproval,
      automationMode: input.automationMode,
      reportThreshold: input.reportThreshold,
      duplicateWindowMinutes: input.duplicateWindowMinutes,
      linkLimit: input.linkLimit,
      version: nextVersion,
    } satisfies CommunityModerationPolicyDto;
  };
  return input.tx ? execute(input.tx) : db.transaction(execute);
}

export async function replaceCommunityLevelConfiguration(input: {
  organizationId: string;
  actorId: string;
  expectedRevision: number;
  enabled: boolean;
  levels: readonly CommunityLevelConfigurationInput[];
  tx?: ApiTransaction;
}) {
  const levels = input.levels.map((level) => ({
    ...level,
    id: level.id ?? randomUUID(),
  }));
  const validation = validateCommunityLevelConfiguration({
    enabled: input.enabled,
    levels,
  });
  const relevantIssues = validation.issues.filter(
    (issue) =>
      !(
        !input.enabled &&
        (issue.code === "missing_active_zero_level" ||
          (levels.length === 0 && issue.code === "level_count"))
      ),
  );
  if (relevantIssues.length) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Levelkonfiguration ist ungueltig.",
      { issues: relevantIssues },
    );
  }

  const execute = async (tx: ApiTransaction) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1)
      .for("update", { of: organizations });
    if (!organization) {
      throw new ApiError(404, "not_found", "Organisation nicht gefunden.");
    }
    await requireActiveCommunityAdmin(tx, {
      organizationId: input.organizationId,
      actorId: input.actorId,
    });
    const [settings] = await tx
      .select({ revision: communityLevelSettings.revision })
      .from(communityLevelSettings)
      .where(eq(communityLevelSettings.organizationId, input.organizationId))
      .limit(1)
      .for("update", { of: communityLevelSettings });
    const currentRevision = settings?.revision ?? 1;
    if (currentRevision !== input.expectedRevision) {
      throw new ApiError(
        409,
        "conflict",
        "Die Levelkonfiguration wurde zwischenzeitlich geaendert.",
      );
    }
    const nextRevision = currentRevision + 1;

    await tx
      .delete(communityLevels)
      .where(eq(communityLevels.organizationId, input.organizationId));
    if (levels.length) {
      await tx.insert(communityLevels).values(
        levels.map((level) => ({
          ...level,
          organizationId: input.organizationId,
        })),
      );
    }
    if (settings) {
      const [updated] = await tx
        .update(communityLevelSettings)
        .set({
          enabled: input.enabled,
          revision: nextRevision,
          updatedById: input.actorId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(communityLevelSettings.organizationId, input.organizationId),
            eq(communityLevelSettings.revision, currentRevision),
          ),
        )
        .returning({ revision: communityLevelSettings.revision });
      if (!updated) {
        throw new ApiError(
          409,
          "conflict",
          "Die Levelkonfiguration wurde zwischenzeitlich geaendert.",
        );
      }
    } else {
      await tx.insert(communityLevelSettings).values({
        organizationId: input.organizationId,
        enabled: input.enabled,
        revision: nextRevision,
        updatedById: input.actorId,
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_levels.configuration_updated",
      entityType: "organization",
      entityId: input.organizationId,
      metadata: {
        enabled: input.enabled,
        levelCount: levels.length,
        revision: nextRevision,
      },
    });
    return { enabled: input.enabled, revision: nextRevision, levels };
  };
  return input.tx ? execute(input.tx) : db.transaction(execute);
}
