"use server";

import { compare, hash } from "bcryptjs";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  customFieldDefinitions,
  customFieldValues,
  dataProfileValues,
  memberDataProfiles,
  mediaAssets,
  userNotificationPreferences,
  userSessions,
  users,
} from "@/db/schema";
import {
  deleteSession,
  getSession,
  requireUser,
} from "@/lib/auth";
import {
  isValidCustomFieldValue,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { ensureDefaultDataProfile } from "@/lib/data-profiles";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import {
  assertProfileMediaFieldAssets,
  ProfileMediaFieldBindingError,
} from "@/lib/profile-media-fields";
import { optionalPhoneSchema } from "@/lib/phone-number";
import {
  CONFIGURABLE_NOTIFICATION_CATEGORIES,
  type ConfigurableNotificationCategory,
} from "@/lib/notification-preference-model";
import { getNotificationPreferences } from "@/lib/notification-preferences";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { resolveUserLocale } from "@/lib/i18n/server";

export type ProfileActionState = {
  ok: boolean | null;
  message: string;
};

const identifierSchema = z.string().uuid();
class ProfileMediaBindingError extends Error {}
const profileSchema = z.object({
  firstName: z.string().trim().min(2).max(100),
  lastName: z.string().trim().min(2).max(100),
  jobTitle: z.string().trim().max(180).transform((value) => value || null),
  department: z.string().trim().max(120).transform((value) => value || null),
  phone: optionalPhoneSchema,
  bio: z.string().trim().max(5000).transform((value) => value || null),
  avatarAssetId: z.string().uuid().nullable(),
  avatarAssetClear: z.boolean(),
});

function stringValue(formData: FormData, name: string) {
  const input = formData.get(name);
  return typeof input === "string" ? input : "";
}

function revalidateProfile() {
  revalidatePath("/academy/profile");
  revalidatePath("/academy", "layout");
  revalidatePath("/admin", "layout");
}

export async function updateOwnProfileAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await requireUser();
  const copy = getMemberExperienceCopy(await resolveUserLocale(actor)).actions;
  const parsed = profileSchema.safeParse({
    firstName: stringValue(formData, "firstName"),
    lastName: stringValue(formData, "lastName"),
    jobTitle: stringValue(formData, "jobTitle"),
    department: stringValue(formData, "department"),
    phone: stringValue(formData, "phone"),
    bio: stringValue(formData, "bio"),
    avatarAssetId: stringValue(formData, "avatarAssetId") || null,
    avatarAssetClear: stringValue(formData, "avatarAssetIdClear") === "true",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      message:
        issue?.path[0] === "avatarAssetId"
          ? copy.invalidAvatar
          : copy.invalidProfile,
    };
  }

  try {
    await db.transaction(async (tx) => {
      let avatarUrl = actor.avatarUrl;
      if (parsed.data.avatarAssetId) {
        const [asset] = await tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, parsed.data.avatarAssetId),
            eq(mediaAssets.organizationId, actor.organizationId),
            eq(mediaAssets.ownerUserId, actor.id),
            eq(mediaAssets.purpose, "avatar"),
            eq(mediaAssets.kind, "image"),
            eq(mediaAssets.status, "ready"),
            isNull(mediaAssets.deletedAt),
          ),
        )
        .limit(1)
        .for("share");
        if (!asset) {
          throw new ProfileMediaBindingError();
        }
        avatarUrl = `/api/media-assets/${asset.id}/download`;
      } else if (parsed.data.avatarAssetClear) {
        avatarUrl = null;
      }
      await tx
        .update(users)
        .set({
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          jobTitle: parsed.data.jobTitle,
          department: parsed.data.department,
          phone: parsed.data.phone,
          bio: parsed.data.bio,
          avatarUrl,
        })
        .where(
          and(
            eq(users.id, actor.id),
            eq(users.organizationId, actor.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "profile.updated",
        entityType: "user",
        entityId: actor.id,
        metadata: { avatarChanged: avatarUrl !== actor.avatarUrl },
      });
    });
  } catch (error) {
    if (error instanceof ProfileMediaBindingError) {
      return {
        ok: false,
        message:
          copy.avatarOwnership,
      };
    }
    throw error;
  }
  revalidateProfile();
  return { ok: true, message: copy.profileSaved };
}

function preferenceField(
  formData: FormData,
  channel: "email" | "push",
  category: ConfigurableNotificationCategory,
) {
  return formData.get(`${channel}:${category}`) === "on";
}

export async function updateOwnNotificationPreferencesAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await requireUser();
  const copy = getMemberExperienceCopy(await resolveUserLocale(actor)).actions;
  const requested = CONFIGURABLE_NOTIFICATION_CATEGORIES.map((category) => ({
    category,
    emailEnabled: preferenceField(formData, "email", category),
    pushEnabled: preferenceField(formData, "push", category),
  }));
  const current = await getNotificationPreferences({
    userId: actor.id,
    organizationId: actor.organizationId,
  });
  const currentByCategory = new Map(
    current.map((preference) => [preference.category, preference]),
  );
  const changed = requested.filter((preference) => {
    const previous = currentByCategory.get(preference.category);
    return (
      previous?.emailEnabled !== preference.emailEnabled ||
      previous?.pushEnabled !== preference.pushEnabled
    );
  });
  if (!changed.length) {
    return { ok: true, message: copy.notificationsUnchanged };
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const preference of changed) {
      await tx
        .insert(userNotificationPreferences)
        .values({
          organizationId: actor.organizationId,
          userId: actor.id,
          ...preference,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            userNotificationPreferences.organizationId,
            userNotificationPreferences.userId,
            userNotificationPreferences.category,
          ],
          set: {
            emailEnabled: preference.emailEnabled,
            pushEnabled: preference.pushEnabled,
            updatedAt: now,
          },
        });
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "profile.notification_preferences.updated",
      entityType: "user",
      entityId: actor.id,
      metadata: {
        categories: changed.map((preference) => preference.category),
        changedCount: changed.length,
      },
    });
  });
  revalidateProfile();
  return { ok: true, message: copy.notificationsSaved };
}

export async function changeOwnPasswordAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await requireUser();
  const copy = getMemberExperienceCopy(await resolveUserLocale(actor)).actions;
  const loginConfiguration = await getPublicOidcLoginConfiguration(
    actor.organizationId,
  );
  if (!loginConfiguration.passwordLoginEnabled) {
    return {
      ok: false,
      message: copy.passwordManagedByProvider,
    };
  }
  const parsed = z
    .object({
      currentPassword: z.string().min(8),
      newPassword: z
        .string()
        .min(10, copy.passwordMinLength)
        .max(200)
        .regex(
          /[a-z]/,
          copy.passwordLowercase,
        )
        .regex(
          /[A-Z]/,
          copy.passwordUppercase,
        )
        .regex(/[0-9]/, copy.passwordNumber),
      confirmation: z.string(),
    })
    .refine((value) => value.newPassword === value.confirmation, {
      message: copy.passwordMismatch,
      path: ["confirmation"],
    })
    .refine((value) => value.currentPassword !== value.newPassword, {
      message: copy.passwordMustDiffer,
      path: ["newPassword"],
    })
    .safeParse({
      currentPassword: stringValue(formData, "currentPassword"),
      newPassword: stringValue(formData, "newPassword"),
      confirmation: stringValue(formData, "confirmation"),
    });
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? copy.invalidPassword,
    };
  }
  if (!(await compare(parsed.data.currentPassword, actor.passwordHash))) {
    return { ok: false, message: copy.currentPasswordIncorrect };
  }

  const session = await getSession();
  if (!session) return { ok: false, message: copy.sessionExpired };
  const passwordHash = await hash(parsed.data.newPassword, 12);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash })
      .where(
        and(
          eq(users.id, actor.id),
          eq(users.organizationId, actor.organizationId),
        ),
      );
    await tx
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSessions.userId, actor.id),
          eq(userSessions.organizationId, actor.organizationId),
          ne(userSessions.id, session.sessionId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "profile.password_changed",
      entityType: "user",
      entityId: actor.id,
      metadata: { otherSessionsRevoked: true },
    });
  });
  revalidateProfile();
  return {
    ok: true,
    message: copy.passwordChanged,
  };
}

function readCustomValue(
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

export async function updateOwnCustomFieldsAction(
  _state: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const actor = await requireUser();
  const copy = getMemberExperienceCopy(await resolveUserLocale(actor)).actions;
  await ensureDefaultDataProfile(actor.id, actor.organizationId);
  const fields = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, actor.organizationId),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
      ),
    );
  const entries = fields.map((field) => ({
    field,
    value: readCustomValue(formData, field),
  }));
  const invalid = entries.find(
    (entry) => !isValidCustomFieldValue(entry.field, entry.value),
  );
  if (invalid) {
    return {
      ok: false,
      message: copy.invalidCustomValue(invalid.field.label, invalid.field.required),
    };
  }
  try {
    await assertProfileMediaFieldAssets({
      reader: db,
      organizationId: actor.organizationId,
      userId: actor.id,
      entries,
    });
  } catch (error) {
    if (error instanceof ProfileMediaFieldBindingError) {
      return { ok: false, message: copy.invalidProfileMedia };
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, actor.id)}))`,
    );
    const [profile] = await tx
      .select({ id: memberDataProfiles.id })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, actor.id),
          eq(memberDataProfiles.isDefault, true),
          eq(memberDataProfiles.active, true),
        ),
      )
      .limit(1);
    if (!profile) throw new Error("Aktives Datenprofil nicht verfuegbar.");
    await assertProfileMediaFieldAssets({
      reader: tx,
      organizationId: actor.organizationId,
      userId: actor.id,
      entries,
    });
    for (const entry of entries) {
      if (
        entry.value === null ||
        (Array.isArray(entry.value) && entry.value.length === 0)
      ) {
        await tx
          .delete(customFieldValues)
          .where(
            and(
              eq(customFieldValues.organizationId, actor.organizationId),
              eq(customFieldValues.userId, actor.id),
              eq(customFieldValues.fieldId, entry.field.id),
            ),
          );
        await tx
          .delete(dataProfileValues)
          .where(
            and(
              eq(dataProfileValues.organizationId, actor.organizationId),
              eq(dataProfileValues.userId, actor.id),
              eq(dataProfileValues.profileId, profile.id),
              eq(dataProfileValues.fieldId, entry.field.id),
            ),
          );
        continue;
      }
      await tx
        .insert(customFieldValues)
        .values({
          organizationId: actor.organizationId,
          userId: actor.id,
          fieldId: entry.field.id,
          value: entry.value,
        })
        .onConflictDoUpdate({
          target: [customFieldValues.userId, customFieldValues.fieldId],
          set: {
            organizationId: actor.organizationId,
            value: entry.value,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(dataProfileValues)
        .values({
          organizationId: actor.organizationId,
          userId: actor.id,
          profileId: profile.id,
          fieldId: entry.field.id,
          value: entry.value,
        })
        .onConflictDoUpdate({
          target: [dataProfileValues.profileId, dataProfileValues.fieldId],
          set: { value: entry.value, updatedAt: new Date() },
        });
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "profile.custom_fields.updated",
      entityType: "user",
      entityId: actor.id,
      metadata: { fieldCount: entries.length },
    });
  });
  revalidateProfile();
  return { ok: true, message: copy.customFieldsSaved };
}

export async function revokeOwnSessionAction(
  sessionId: string,
): Promise<ProfileActionState> {
  const actor = await requireUser();
  const copy = getMemberExperienceCopy(await resolveUserLocale(actor)).actions;
  const parsed = identifierSchema.safeParse(sessionId);
  if (!parsed.success) return { ok: false, message: copy.invalidSession };
  const current = await getSession();
  if (!current) return { ok: false, message: copy.sessionExpired };

  const [revoked] = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(userSessions.id, parsed.data),
        eq(userSessions.userId, actor.id),
        eq(userSessions.organizationId, actor.organizationId),
      ),
    )
    .returning({ id: userSessions.id });
  if (!revoked) return { ok: false, message: copy.sessionNotFound };
  if (revoked.id === current.sessionId) {
    await deleteSession();
    redirect("/login");
  }
  revalidatePath("/academy/profile");
  return { ok: true, message: copy.sessionEnded };
}
