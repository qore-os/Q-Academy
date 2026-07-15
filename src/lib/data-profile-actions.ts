"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  customFieldDefinitions,
  customFieldValues,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  memberDataProfiles,
  users,
  type User,
} from "@/db/schema";
import {
  requireTeamPermission,
  requireUser,
} from "@/lib/auth";
import {
  isValidCustomFieldValue,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { canEditCustomField } from "@/lib/data-profile-policy";
import {
  assertProfileMediaFieldAssets,
  ProfileMediaFieldBindingError,
} from "@/lib/profile-media-fields";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";
import { ensureDefaultDataProfile } from "@/lib/data-profiles";
import type {
  DataProfileMessageCode,
  DataProfileMessageParams,
} from "@/lib/i18n/data-profile-actions";

export type DataProfileActionState = {
  ok: boolean | null;
  message: string;
  code?: DataProfileMessageCode;
  params?: DataProfileMessageParams;
};

export type DataProfileMutationResult =
  | {
      ok: true;
      message: string;
      code: DataProfileMessageCode;
      params?: DataProfileMessageParams;
    }
  | {
      ok: false;
      message: string;
      code: DataProfileMessageCode;
      params?: DataProfileMessageParams;
    };

const identifierSchema = z.string().uuid();
const profileSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string().trim().min(2).max(180),
});

function revalidateMemberProfiles(memberId: string) {
  revalidatePath("/academy/profile");
  revalidatePath(`/admin/members/${memberId}`);
}

async function assertTenantMember(memberId: string, organizationId: string) {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, memberId),
        eq(users.organizationId, organizationId),
      ),
    )
    .limit(1);
  return member ?? null;
}

async function createProfile(
  actor: User,
  memberId: string,
  formData: FormData,
): Promise<DataProfileActionState> {
  const parsed = profileSchema.safeParse({
    definitionId: formData.get("definitionId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Bitte das Datenprofil pruefen.",
      code: "invalidProfile",
    };
  }
  if (!(await assertTenantMember(memberId, actor.organizationId))) {
    return {
      ok: false,
      message: "Mitglied wurde nicht gefunden.",
      code: "memberNotFound",
    };
  }
  const [definition] = await db
    .select()
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.id, parsed.data.definitionId),
        eq(dataProfileDefinitions.organizationId, actor.organizationId),
        eq(dataProfileDefinitions.active, true),
      ),
    )
    .limit(1);
  if (!definition) {
    return {
      ok: false,
      message: "Profilvorlage wurde nicht gefunden.",
      code: "definitionNotFound",
    };
  }
  if (actor.role === "member" && !definition.allowMemberCreation) {
    return {
      ok: false,
      message: "Diese Profilvorlage ist nur fuer Admins.",
      code: "definitionRestricted",
    };
  }

  const profile = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, memberId)}))`,
    );
    const [duplicate] = await tx
      .select({ id: memberDataProfiles.id })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
          eq(memberDataProfiles.name, parsed.data.name),
        ),
      )
      .limit(1);
    if (duplicate) return null;
    const [created] = await tx
      .insert(memberDataProfiles)
      .values({
        organizationId: actor.organizationId,
        userId: memberId,
        definitionId: definition.id,
        name: parsed.data.name,
      })
      .returning();
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile.created",
      entityType: "data_profile",
      entityId: created.id,
      metadata: { memberId, definitionId: definition.id },
    });
    return created;
  });
  if (!profile) {
    return {
      ok: false,
      message: "Ein Profil mit diesem Namen existiert bereits.",
      code: "duplicateName",
    };
  }
  revalidateMemberProfiles(memberId);
  return {
    ok: true,
    message: `${profile.name} wurde angelegt.`,
    code: "profileCreated",
    params: { name: profile.name },
  };
}

export async function createOwnDataProfileAction(
  _state: DataProfileActionState,
  formData: FormData,
): Promise<DataProfileActionState> {
  const actor = await requireUser();
  return createProfile(actor, actor.id, formData);
}

export async function createMemberDataProfileAction(
  memberId: string,
  _state: DataProfileActionState,
  formData: FormData,
): Promise<DataProfileActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedMemberId = identifierSchema.safeParse(memberId);
  if (!parsedMemberId.success) {
    return {
      ok: false,
      message: "Ungueltiges Mitglied.",
      code: "invalidMember",
    };
  }
  return createProfile(actor, parsedMemberId.data, formData);
}

async function setDefaultProfile(
  actor: User,
  memberId: string,
  profileId: string,
): Promise<DataProfileMutationResult> {
  const parsed = z
    .object({ memberId: identifierSchema, profileId: identifierSchema })
    .safeParse({ memberId, profileId });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Ungueltiges Datenprofil.",
      code: "invalidProfile",
    };
  }
  await ensureDefaultDataProfile(memberId, actor.organizationId);
  const profile = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, memberId)}))`,
    );
    const [target] = await tx
      .select({ id: memberDataProfiles.id, name: memberDataProfiles.name })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.id, profileId),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
          eq(memberDataProfiles.active, true),
        ),
      )
      .limit(1);
    if (!target) return null;
    await tx
      .update(memberDataProfiles)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
        ),
      );
    await tx
      .update(memberDataProfiles)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(memberDataProfiles.id, target.id),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
        ),
      );

    await tx
      .delete(customFieldValues)
      .where(
        and(
          eq(customFieldValues.organizationId, actor.organizationId),
          eq(customFieldValues.userId, memberId),
        ),
      );
    const profileValues = await tx
      .select({
        fieldId: dataProfileValues.fieldId,
        value: dataProfileValues.value,
        updatedAt: dataProfileValues.updatedAt,
      })
      .from(dataProfileValues)
      .where(
        and(
          eq(dataProfileValues.organizationId, actor.organizationId),
          eq(dataProfileValues.userId, memberId),
          eq(dataProfileValues.profileId, target.id),
        ),
      );
    if (profileValues.length > 0) {
      await tx.insert(customFieldValues).values(
        profileValues.map((entry) => ({
          organizationId: actor.organizationId,
          userId: memberId,
          fieldId: entry.fieldId,
          value: entry.value,
          updatedAt: entry.updatedAt,
        })),
      );
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile.default_changed",
      entityType: "data_profile",
      entityId: target.id,
      metadata: { memberId },
    });
    return target;
  });
  if (!profile) {
    return {
      ok: false,
      message: "Datenprofil nicht gefunden.",
      code: "profileNotFound",
    };
  }
  revalidateMemberProfiles(memberId);
  return {
    ok: true,
    message: `${profile.name} ist jetzt das aktive Profil.`,
    code: "profileActivated",
    params: { name: profile.name },
  };
}

export async function setOwnDefaultDataProfileAction(profileId: string) {
  const actor = await requireUser();
  return setDefaultProfile(actor, actor.id, profileId);
}

export async function setMemberDefaultDataProfileAction(
  memberId: string,
  profileId: string,
) {
  const actor = await requireTeamPermission("settings.manage");
  return setDefaultProfile(actor, memberId, profileId);
}

async function archiveProfile(
  actor: User,
  memberId: string,
  profileId: string,
): Promise<DataProfileMutationResult> {
  const parsed = z
    .object({ memberId: identifierSchema, profileId: identifierSchema })
    .safeParse({ memberId, profileId });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Ungueltiges Datenprofil.",
      code: "invalidProfile",
    };
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, memberId)}))`,
    );
    const [profile] = await tx
      .select({
        id: memberDataProfiles.id,
        name: memberDataProfiles.name,
        isDefault: memberDataProfiles.isDefault,
      })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.id, profileId),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
          eq(memberDataProfiles.active, true),
        ),
      )
      .limit(1);
    if (!profile) return { status: "missing" as const };
    if (profile.isDefault) return { status: "default" as const };
    await tx
      .update(memberDataProfiles)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(memberDataProfiles.id, profile.id),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile.archived",
      entityType: "data_profile",
      entityId: profile.id,
      metadata: { memberId },
    });
    return { status: "archived" as const, profile };
  });
  if (result.status === "missing") {
    return {
      ok: false,
      message: "Datenprofil nicht gefunden.",
      code: "profileNotFound",
    };
  }
  if (result.status === "default") {
    return {
      ok: false,
      message: "Das aktive Profil kann nicht archiviert werden.",
      code: "activeProfileArchiveDenied",
    };
  }
  revalidateMemberProfiles(memberId);
  return {
    ok: true,
    message: `${result.profile.name} wurde archiviert.`,
    code: "profileArchived",
    params: { name: result.profile.name },
  };
}

export async function archiveOwnDataProfileAction(profileId: string) {
  const actor = await requireUser();
  return archiveProfile(actor, actor.id, profileId);
}

export async function archiveMemberDataProfileAction(
  memberId: string,
  profileId: string,
) {
  const actor = await requireTeamPermission("settings.manage");
  return archiveProfile(actor, memberId, profileId);
}

function readFieldValue(
  formData: FormData,
  field: typeof customFieldDefinitions.$inferSelect,
): CustomFieldValue {
  const name = `field:${field.id}`;
  if (field.type === "boolean") return formData.get(name) === "on";
  if (field.type === "multiselect") {
    return [...new Set(formData.getAll(name).map(String))];
  }
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  return field.type === "number" ? Number(raw) : raw;
}

async function updateProfileValues(
  actor: User,
  memberId: string,
  profileId: string,
  formData: FormData,
): Promise<DataProfileActionState> {
  const parsed = z
    .object({ memberId: identifierSchema, profileId: identifierSchema })
    .safeParse({ memberId, profileId });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Ungueltiges Datenprofil.",
      code: "invalidProfile",
    };
  }
  await ensureDefaultDataProfile(memberId, actor.organizationId);
  const [profile] = await db
    .select({
      id: memberDataProfiles.id,
      definitionId: memberDataProfiles.definitionId,
      isDefault: memberDataProfiles.isDefault,
    })
    .from(memberDataProfiles)
    .where(
      and(
        eq(memberDataProfiles.id, profileId),
        eq(memberDataProfiles.organizationId, actor.organizationId),
        eq(memberDataProfiles.userId, memberId),
        eq(memberDataProfiles.active, true),
      ),
    )
    .limit(1);
  if (!profile) {
    return {
      ok: false,
      message: "Datenprofil nicht gefunden.",
      code: "profileNotFound",
    };
  }

  const fields = await db
    .select({
      field: customFieldDefinitions,
      requiredOverride: dataProfileFields.requiredOverride,
    })
    .from(dataProfileFields)
    .innerJoin(
      customFieldDefinitions,
      and(
        eq(customFieldDefinitions.id, dataProfileFields.fieldId),
        eq(customFieldDefinitions.organizationId, actor.organizationId),
      ),
    )
    .where(
      and(
        eq(dataProfileFields.organizationId, actor.organizationId),
        eq(dataProfileFields.profileDefinitionId, profile.definitionId),
        eq(customFieldDefinitions.active, true),
      ),
    );
  const editableFields = fields
    .filter(({ field }) =>
      canEditCustomField({
        viewerRole: actor.role,
        viewerId: actor.id,
        subjectUserId: memberId,
        visibility: field.visibility,
      }),
    )
    .map(({ field, requiredOverride }) => ({
      ...field,
      required: requiredOverride ?? field.required,
    }));
  const values = editableFields.map((field) => ({
    field,
    value: readFieldValue(formData, field),
  }));
  const invalid = values.find(
    ({ field, value }) => !isValidCustomFieldValue(field, value),
  );
  if (invalid) {
    return {
      ok: false,
      message: `Bitte den Wert fuer "${invalid.field.label}" pruefen${invalid.field.required ? " (Pflichtfeld)" : ""}.`,
      code: "invalidFieldValue",
      params: {
        label: invalid.field.label,
        required: invalid.field.required,
      },
    };
  }
  try {
    await assertProfileMediaFieldAssets({
      reader: db,
      organizationId: actor.organizationId,
      userId: memberId,
      entries: values,
    });
  } catch (error) {
    if (error instanceof ProfileMediaFieldBindingError) {
      return {
        ok: false,
        message:
          "Ein Profilmedium ist nicht bereit oder gehoert zu einem anderen Mitglied.",
        code: "mediaUnavailable",
      };
    }
    throw error;
  }

  let updated: boolean;
  try {
    updated = await db.transaction(async (tx) => {
      await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, memberId)}))`,
    );
      const [currentProfile] = await tx
      .select({
        id: memberDataProfiles.id,
        isDefault: memberDataProfiles.isDefault,
        active: memberDataProfiles.active,
      })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.id, profile.id),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, memberId),
        ),
      )
      .limit(1);
      if (!currentProfile?.active) return false;
      await assertProfileMediaFieldAssets({
      reader: tx,
      organizationId: actor.organizationId,
      userId: memberId,
      entries: values,
    });
      for (const entry of values) {
      const empty =
        entry.value === null ||
        (Array.isArray(entry.value) && entry.value.length === 0);
      if (empty) {
        await tx
          .delete(dataProfileValues)
          .where(
            and(
              eq(dataProfileValues.organizationId, actor.organizationId),
              eq(dataProfileValues.userId, memberId),
              eq(dataProfileValues.profileId, profile.id),
              eq(dataProfileValues.fieldId, entry.field.id),
            ),
          );
        if (currentProfile.isDefault) {
          await tx
            .delete(customFieldValues)
            .where(
              and(
                eq(customFieldValues.organizationId, actor.organizationId),
                eq(customFieldValues.userId, memberId),
                eq(customFieldValues.fieldId, entry.field.id),
              ),
            );
        }
        continue;
      }

      await tx
        .insert(dataProfileValues)
        .values({
          organizationId: actor.organizationId,
          userId: memberId,
          profileId: profile.id,
          fieldId: entry.field.id,
          value: entry.value,
        })
        .onConflictDoUpdate({
          target: [dataProfileValues.profileId, dataProfileValues.fieldId],
          set: { value: entry.value, updatedAt: new Date() },
        });
      if (currentProfile.isDefault) {
        await tx
          .insert(customFieldValues)
          .values({
            organizationId: actor.organizationId,
            userId: memberId,
            fieldId: entry.field.id,
            value: entry.value,
          })
          .onConflictDoUpdate({
            target: [customFieldValues.userId, customFieldValues.fieldId],
            set: { value: entry.value, updatedAt: new Date() },
          });
      }
    }
      await tx
      .update(memberDataProfiles)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(memberDataProfiles.id, profile.id),
          eq(memberDataProfiles.organizationId, actor.organizationId),
        ),
      );
      await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile.values.updated",
      entityType: "data_profile",
      entityId: profile.id,
      metadata: { memberId, fieldCount: values.length },
    });
      return true;
    });
  } catch (error) {
    if (error instanceof ProfileMediaFieldBindingError) {
      return {
        ok: false,
        message:
          "Ein Profilmedium ist nicht bereit oder gehoert zu einem anderen Mitglied.",
        code: "mediaUnavailable",
      };
    }
    throw error;
  }
  if (!updated) {
    return {
      ok: false,
      message: "Datenprofil nicht gefunden.",
      code: "profileNotFound",
    };
  }
  revalidateMemberProfiles(memberId);
  return {
    ok: true,
    code: "fieldsSaved",
    message:
      actor.id === memberId
        ? "Profilfelder gespeichert."
        : "Profilfelder wurden gespeichert.",
  };
}

export async function updateOwnDataProfileAction(
  profileId: string,
  _state: DataProfileActionState,
  formData: FormData,
) {
  const actor = await requireUser();
  return updateProfileValues(actor, actor.id, profileId, formData);
}

export async function updateMemberDataProfileAction(
  memberId: string,
  profileId: string,
  _state: DataProfileActionState,
  formData: FormData,
) {
  const actor = await requireTeamPermission("settings.manage");
  return updateProfileValues(actor, memberId, profileId, formData);
}
