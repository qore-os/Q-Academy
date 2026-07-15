import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  customFieldDefinitions,
  customFieldValues,
  dataForms,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  memberDataProfiles,
  users,
  type User,
} from "@/db/schema";
import { canViewCustomField } from "@/lib/data-profile-policy";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";

const DEFAULT_PROFILE_KEY = "default";
const DEFAULT_PROFILE_NAME = "Standardprofil";

export class DataProfileNotFoundError extends Error {
  constructor() {
    super("Das Datenprofil wurde nicht gefunden.");
    this.name = "DataProfileNotFoundError";
  }
}

export async function ensureDefaultDataProfileDefinition(
  organizationId: string,
) {
  let [definition] = await db
    .select()
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.organizationId, organizationId),
        eq(dataProfileDefinitions.key, DEFAULT_PROFILE_KEY),
      ),
    )
    .limit(1);
  if (!definition) {
    [definition] = await db
      .insert(dataProfileDefinitions)
      .values({
        organizationId,
        key: DEFAULT_PROFILE_KEY,
        name: DEFAULT_PROFILE_NAME,
        description: "Bestehende und allgemeine Profildaten.",
        allowMemberCreation: false,
        sortOrder: 0,
      })
      .onConflictDoNothing()
      .returning();
    if (!definition) {
      [definition] = await db
        .select()
        .from(dataProfileDefinitions)
        .where(
          and(
            eq(dataProfileDefinitions.organizationId, organizationId),
            eq(dataProfileDefinitions.key, DEFAULT_PROFILE_KEY),
          ),
        )
        .limit(1);
    }
  }
  if (!definition) throw new DataProfileNotFoundError();

  const tenantFields = await db
    .select({
      id: customFieldDefinitions.id,
      sortOrder: customFieldDefinitions.sortOrder,
    })
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.organizationId, organizationId));
  if (tenantFields.length > 0) {
    await db
      .insert(dataProfileFields)
      .values(
        tenantFields.map((field) => ({
          organizationId,
          profileDefinitionId: definition.id,
          fieldId: field.id,
          sortOrder: field.sortOrder,
        })),
      )
      .onConflictDoNothing();
  }
  return definition;
}

export async function ensureDefaultDataProfile(
  userId: string,
  organizationId: string,
) {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!member) throw new DataProfileNotFoundError();

  const definition = await ensureDefaultDataProfileDefinition(organizationId);

  const profile = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(organizationId, userId)}))`,
    );
    let [current] = await tx
      .select()
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.organizationId, organizationId),
          eq(memberDataProfiles.userId, userId),
          eq(memberDataProfiles.isDefault, true),
        ),
      )
      .limit(1);
    if (!current) {
      [current] = await tx
        .insert(memberDataProfiles)
        .values({
          organizationId,
          userId,
          definitionId: definition.id,
          name: DEFAULT_PROFILE_NAME,
          isDefault: true,
        })
        .onConflictDoNothing()
        .returning();
      if (!current) {
        [current] = await tx
          .select()
          .from(memberDataProfiles)
          .where(
            and(
              eq(memberDataProfiles.organizationId, organizationId),
              eq(memberDataProfiles.userId, userId),
              eq(memberDataProfiles.isDefault, true),
            ),
          )
          .limit(1);
      } else {
        await tx.insert(activityEvents).values({
          organizationId,
          userId,
          type: "data_profile.bootstrap.created",
          entityType: "data_profile",
          entityId: current.id,
          metadata: { definitionId: definition.id, migrated: true },
        });
      }
    }
    if (!current) throw new DataProfileNotFoundError();

    const legacyValues = await tx
      .select({
        fieldId: customFieldValues.fieldId,
        value: customFieldValues.value,
        updatedAt: customFieldValues.updatedAt,
      })
      .from(customFieldValues)
      .where(
        and(
          eq(customFieldValues.organizationId, organizationId),
          eq(customFieldValues.userId, userId),
        ),
      );
    if (legacyValues.length > 0) {
      await tx
        .insert(dataProfileValues)
        .values(
          legacyValues.map((entry) => ({
            organizationId,
            userId,
            profileId: current.id,
            fieldId: entry.fieldId,
            value: entry.value,
            updatedAt: entry.updatedAt,
          })),
        )
        .onConflictDoNothing();
    }
    return current;
  });

  return { definition, profile };
}

export async function getMemberDataProfileBundle({
  memberId,
  organizationId,
  viewer,
  selectedProfileId,
}: {
  memberId: string;
  organizationId: string;
  viewer: Pick<User, "id" | "role">;
  selectedProfileId?: string | null;
}) {
  const { profile: defaultProfile } = await ensureDefaultDataProfile(
    memberId,
    organizationId,
  );
  const [profiles, definitions] = await Promise.all([
    db
      .select({
        id: memberDataProfiles.id,
        name: memberDataProfiles.name,
        definitionId: memberDataProfiles.definitionId,
        definitionName: dataProfileDefinitions.name,
        isDefault: memberDataProfiles.isDefault,
        active: memberDataProfiles.active,
        updatedAt: memberDataProfiles.updatedAt,
      })
      .from(memberDataProfiles)
      .innerJoin(
        dataProfileDefinitions,
        and(
          eq(dataProfileDefinitions.id, memberDataProfiles.definitionId),
          eq(dataProfileDefinitions.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(memberDataProfiles.organizationId, organizationId),
          eq(memberDataProfiles.userId, memberId),
          eq(memberDataProfiles.active, true),
        ),
      )
      .orderBy(asc(memberDataProfiles.name)),
    db
      .select({
        id: dataProfileDefinitions.id,
        key: dataProfileDefinitions.key,
        name: dataProfileDefinitions.name,
        description: dataProfileDefinitions.description,
        allowMemberCreation: dataProfileDefinitions.allowMemberCreation,
      })
      .from(dataProfileDefinitions)
      .where(
        and(
          eq(dataProfileDefinitions.organizationId, organizationId),
          eq(dataProfileDefinitions.active, true),
        ),
      )
      .orderBy(
        asc(dataProfileDefinitions.sortOrder),
        asc(dataProfileDefinitions.name),
      ),
  ]);
  const selectedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ??
    profiles.find((profile) => profile.id === defaultProfile.id) ??
    profiles[0];
  if (!selectedProfile) throw new DataProfileNotFoundError();

  const [fieldRows, forms] = await Promise.all([
    db
      .select({
        id: customFieldDefinitions.id,
        key: customFieldDefinitions.key,
        label: customFieldDefinitions.label,
        description: customFieldDefinitions.description,
        type: customFieldDefinitions.type,
        category: customFieldDefinitions.category,
        required: customFieldDefinitions.required,
        requiredOverride: dataProfileFields.requiredOverride,
        visibility: customFieldDefinitions.visibility,
        options: customFieldDefinitions.options,
        sortOrder: dataProfileFields.sortOrder,
        value: dataProfileValues.value,
      })
      .from(dataProfileFields)
      .innerJoin(
        customFieldDefinitions,
        and(
          eq(customFieldDefinitions.id, dataProfileFields.fieldId),
          eq(customFieldDefinitions.organizationId, organizationId),
        ),
      )
      .leftJoin(
        dataProfileValues,
        and(
          eq(dataProfileValues.organizationId, organizationId),
          eq(dataProfileValues.userId, memberId),
          eq(dataProfileValues.profileId, selectedProfile.id),
          eq(dataProfileValues.fieldId, customFieldDefinitions.id),
        ),
      )
      .where(
        and(
          eq(dataProfileFields.organizationId, organizationId),
          eq(
            dataProfileFields.profileDefinitionId,
            selectedProfile.definitionId,
          ),
          eq(customFieldDefinitions.active, true),
        ),
      )
      .orderBy(
        asc(dataProfileFields.sortOrder),
        asc(customFieldDefinitions.label),
      ),
    db
      .select({ id: dataForms.id, name: dataForms.name })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.organizationId, organizationId),
          eq(dataForms.profileDefinitionId, selectedProfile.definitionId),
          eq(dataForms.active, true),
        ),
      )
      .orderBy(asc(dataForms.name)),
  ]);

  return {
    profiles,
    definitions: definitions.filter(
      (definition) =>
        viewer.role !== "member" || definition.allowMemberCreation,
    ),
    selectedProfile,
    forms,
    fields: fieldRows
      .filter((field) =>
        canViewCustomField({
          viewerRole: viewer.role,
          viewerId: viewer.id,
          subjectUserId: memberId,
          visibility: field.visibility,
        }),
      )
      .map((field) => ({
        ...field,
        required: field.requiredOverride ?? field.required,
        value: field.value ?? null,
      })),
  };
}
