import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  memberWelcomeAcknowledgements,
  memberWelcomeSettings,
  organizations,
  users,
  type MemberWelcomeSetting,
} from "@/db/schema";
import type { ApiTransaction } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import {
  changedMemberWelcomeFields,
  DEFAULT_MEMBER_WELCOME_SETTINGS,
  memberWelcomeSettingsInputSchema,
  isMemberWelcomePending,
  type MemberWelcomeSettingsInput,
  type MemberWelcomeSettingsMutationResult,
  type MemberWelcomeSettingsUpdate,
  type MemberWelcomeSettingsView,
  type PendingMemberWelcome,
} from "@/lib/member-welcome-model";

export type {
  MemberWelcomeSettingsMutationResult,
  MemberWelcomeSettingsView,
  PendingMemberWelcome,
} from "@/lib/member-welcome-model";

function inputFromRow(row: MemberWelcomeSetting): MemberWelcomeSettingsInput {
  return {
    enabled: row.enabled,
    title: row.title,
    welcomeText: row.welcomeText,
    videoUrl: row.videoUrl,
    promptProfileImage: row.promptProfileImage,
    promptProfileCompletion: row.promptProfileCompletion,
  };
}

export async function getMemberWelcomeSettings(
  organizationId: string,
): Promise<MemberWelcomeSettingsView> {
  const [row] = await db
    .select()
    .from(memberWelcomeSettings)
    .where(eq(memberWelcomeSettings.organizationId, organizationId))
    .limit(1);
  if (!row) {
    return {
      ...DEFAULT_MEMBER_WELCOME_SETTINGS,
      version: 0,
      createdAt: null,
      updatedAt: null,
    };
  }
  return {
    ...inputFromRow(row),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getPendingMemberWelcome(
  organizationId: string,
  userId: string,
): Promise<PendingMemberWelcome | null> {
  const [row] = await db
    .select({
      settings: memberWelcomeSettings,
      acknowledgedVersion:
        memberWelcomeAcknowledgements.configurationVersion,
    })
    .from(memberWelcomeSettings)
    .innerJoin(
      users,
      and(
        eq(users.id, userId),
        eq(users.organizationId, memberWelcomeSettings.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .leftJoin(
      memberWelcomeAcknowledgements,
      and(
        eq(
          memberWelcomeAcknowledgements.organizationId,
          memberWelcomeSettings.organizationId,
        ),
        eq(memberWelcomeAcknowledgements.userId, users.id),
      ),
    )
    .where(
      and(
        eq(memberWelcomeSettings.organizationId, organizationId),
        eq(memberWelcomeSettings.enabled, true),
      ),
    )
    .limit(1);

  if (
    !row ||
    !isMemberWelcomePending({
      enabled: row.settings.enabled,
      memberRole: "member",
      memberStatus: "active",
      configurationVersion: row.settings.version,
      acknowledgedVersion: row.acknowledgedVersion,
    })
  ) {
    return null;
  }
  return {
    ...inputFromRow(row.settings),
    version: row.settings.version,
  };
}

async function lockWelcomeConfiguration(
  tx: ApiTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`member-welcome:${organizationId}`}, 0))`,
  );
}

export async function updateMemberWelcomeSettings(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    actorUserId?: string | null;
    source: "admin_ui" | "api" | "seed";
    patch: MemberWelcomeSettingsUpdate;
  },
): Promise<MemberWelcomeSettingsMutationResult> {
  await lockWelcomeConfiguration(tx, input.organizationId);
  const [organization] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, input.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!organization) {
    throw new ApiError(404, "not_found", "Academy nicht gefunden.");
  }

  if (input.actorUserId) {
    const [actor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorUserId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
          sql`${users.role} in ('owner', 'admin')`,
        ),
      )
      .limit(1)
      .for("share");
    if (!actor) {
      throw new ApiError(
        403,
        "forbidden",
        "Die Willkommens-Einstellungen duerfen nicht geaendert werden.",
      );
    }
  }

  const [currentRow] = await tx
    .select()
    .from(memberWelcomeSettings)
    .where(eq(memberWelcomeSettings.organizationId, input.organizationId))
    .limit(1)
    .for("update");
  const currentInput = currentRow
    ? inputFromRow(currentRow)
    : DEFAULT_MEMBER_WELCOME_SETTINGS;
  const nextInput = memberWelcomeSettingsInputSchema.parse({
    ...currentInput,
    ...input.patch,
  });
  const changedFields = changedMemberWelcomeFields(currentInput, nextInput);

  if (currentRow && changedFields.length === 0) {
    return {
      ...currentInput,
      version: currentRow.version,
      createdAt: currentRow.createdAt,
      updatedAt: currentRow.updatedAt,
      changed: false,
    };
  }
  if (!currentRow && changedFields.length === 0) {
    return {
      ...DEFAULT_MEMBER_WELCOME_SETTINGS,
      version: 0,
      createdAt: null,
      updatedAt: null,
      changed: false,
    };
  }

  const now = new Date();
  const nextVersion = currentRow ? currentRow.version + 1 : 1;
  const [saved] = currentRow
    ? await tx
        .update(memberWelcomeSettings)
        .set({ ...nextInput, version: nextVersion, updatedAt: now })
        .where(eq(memberWelcomeSettings.organizationId, input.organizationId))
        .returning()
    : await tx
        .insert(memberWelcomeSettings)
        .values({
          organizationId: input.organizationId,
          ...nextInput,
          version: nextVersion,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
  if (!saved) {
    throw new ApiError(
      409,
      "conflict",
      "Die Willkommens-Einstellungen wurden parallel geaendert.",
    );
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.actorUserId ?? null,
    type: "platform.welcome.updated",
    entityType: "organization",
    entityId: input.organizationId,
    metadata: {
      source: input.source,
      version: saved.version,
      enabled: saved.enabled,
      hasVideo: Boolean(saved.videoUrl),
      changedFields,
    },
  });
  return {
    ...inputFromRow(saved),
    version: saved.version,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
    changed: true,
  };
}

export type MemberWelcomeAcknowledgementResult =
  | { status: "acknowledged" | "already_acknowledged"; version: number }
  | { status: "stale"; currentVersion: number }
  | { status: "not_available" };

export async function acknowledgeMemberWelcome(
  tx: ApiTransaction,
  input: {
    organizationId: string;
    userId: string;
    configurationVersion: number;
  },
): Promise<MemberWelcomeAcknowledgementResult> {
  await lockWelcomeConfiguration(tx, input.organizationId);

  const [member] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!member) return { status: "not_available" };

  const [settings] = await tx
    .select({
      enabled: memberWelcomeSettings.enabled,
      version: memberWelcomeSettings.version,
    })
    .from(memberWelcomeSettings)
    .where(eq(memberWelcomeSettings.organizationId, input.organizationId))
    .limit(1)
    .for("update");
  if (!settings?.enabled) return { status: "not_available" };
  if (settings.version !== input.configurationVersion) {
    return { status: "stale", currentVersion: settings.version };
  }

  const acknowledgedAt = new Date();
  const [acknowledgement] = await tx
    .insert(memberWelcomeAcknowledgements)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      configurationVersion: input.configurationVersion,
      acknowledgedAt,
    })
    .onConflictDoUpdate({
      target: [
        memberWelcomeAcknowledgements.organizationId,
        memberWelcomeAcknowledgements.userId,
      ],
      set: {
        configurationVersion: input.configurationVersion,
        acknowledgedAt,
      },
      setWhere: sql`${memberWelcomeAcknowledgements.configurationVersion} < ${input.configurationVersion}`,
    })
    .returning({
      configurationVersion:
        memberWelcomeAcknowledgements.configurationVersion,
    });

  if (!acknowledgement) {
    return {
      status: "already_acknowledged",
      version: input.configurationVersion,
    };
  }
  await tx.insert(activityEvents).values({
    organizationId: input.organizationId,
    userId: input.userId,
    type: "platform.welcome.acknowledged",
    entityType: "user",
    entityId: input.userId,
    metadata: { configurationVersion: input.configurationVersion },
  });
  return { status: "acknowledged", version: input.configurationVersion };
}

export async function acknowledgeCurrentMemberWelcome(input: {
  organizationId: string;
  userId: string;
  configurationVersion: number;
}) {
  return db.transaction((tx) => acknowledgeMemberWelcome(tx, input));
}
