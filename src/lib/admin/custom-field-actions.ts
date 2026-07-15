"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  communityPublicProfileFields,
  customFieldDefinitions,
  customFieldValues,
  dataProfileFields,
  dataProfileValues,
  dataFormFields,
  dataForms,
  memberDataProfiles,
  users,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import {
  customFieldVisibilities,
} from "@/lib/data-profile-policy";
import {
  ensureDefaultDataProfile,
  ensureDefaultDataProfileDefinition,
} from "@/lib/data-profiles";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";
import {
  customFieldTypes,
  isValidCustomFieldValue,
  normalizeCustomFieldOptions,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { PERSONALIZABLE_CUSTOM_FIELD_TYPES } from "@/lib/member-property-model";
import {
  assertProfileMediaFieldAssets,
  ProfileMediaFieldBindingError,
} from "@/lib/profile-media-fields";
import { isCommunityPublicCustomFieldType } from "@/lib/community-public-profile";

export type CustomFieldActionState = {
  ok: boolean | null;
  message: string;
  code?: CustomFieldActionCode;
  params?: Record<string, string | number>;
};

export type CustomFieldActionCode =
  | "fieldInvalid"
  | "fieldDuplicate"
  | "fieldNotFound"
  | "fieldFormConflict"
  | "fieldCommunityConflict"
  | "fieldMediaConflict"
  | "fieldCreated"
  | "fieldSaved"
  | "fieldSavedRemoved"
  | "fieldActivated"
  | "fieldDeactivated"
  | "fieldDeleted";

export type CustomFieldMutationResult = {
  ok: boolean;
  message: string;
  code?: CustomFieldActionCode;
  params?: Record<string, string | number>;
};

const identifierSchema = z.string().uuid();
const definitionSchema = z
  .object({
    key: z
      .string()
      .trim()
      .toLowerCase()
      .min(2, "Der technische Key muss mindestens 2 Zeichen haben.")
      .max(120)
      .regex(
        /^[a-z][a-z0-9_]*$/,
        "Der Key darf nur Kleinbuchstaben, Zahlen und Unterstriche enthalten.",
      ),
    label: z
      .string()
      .trim()
      .min(2, "Die Bezeichnung muss mindestens 2 Zeichen haben.")
      .max(180),
    description: z
      .string()
      .trim()
      .max(1_000)
      .transform((value) => value || null),
    type: z.enum(customFieldTypes),
    category: z
      .string()
      .trim()
      .min(2, "Bitte eine Kategorie angeben.")
      .max(120),
    required: z.boolean(),
    visibility: z.enum(customFieldVisibilities),
    personalizationEnabled: z.boolean(),
    options: z.array(z.string().min(1).max(180)).max(50),
    active: z.boolean(),
    sortOrder: z.number().int().min(0).max(9_999),
  })
  .superRefine((value, context) => {
    if (
      ["select", "multiselect"].includes(value.type) &&
      value.options.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Auswahlfelder benoetigen mindestens eine Option.",
        path: ["options"],
      });
    }
    if (
      value.personalizationEnabled &&
      (value.visibility !== "member" ||
        !PERSONALIZABLE_CUSTOM_FIELD_TYPES.includes(
          value.type as (typeof PERSONALIZABLE_CUSTOM_FIELD_TYPES)[number],
        ))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Personalisierung ist nur fuer mitgliedsichtbare Text-, Auswahl-, Zahlen-, Datums- und Ja/Nein-Felder erlaubt.",
        path: ["personalizationEnabled"],
      });
    }
  });

function readDefinition(formData: FormData) {
  const rawSortOrder = Number(formData.get("sortOrder") ?? 0);
  return definitionSchema.safeParse({
    key: formData.get("key"),
    label: formData.get("label"),
    description: formData.get("description") ?? "",
    type: formData.get("type"),
    category: formData.get("category") ?? "Profil",
    required: formData.get("required") === "on",
    visibility: formData.get("visibility") ?? "member",
    personalizationEnabled:
      formData.get("personalizationEnabled") === "on",
    options: normalizeCustomFieldOptions(String(formData.get("options") ?? "")),
    active: formData.get("active") === "on",
    sortOrder: rawSortOrder,
  });
}

function validationMessage(error: z.ZodError) {
  return error.issues[0]?.message ?? "Bitte die Felddefinition pruefen.";
}

async function getTenantField(fieldId: string, organizationId: string) {
  const [field] = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.id, fieldId),
        eq(customFieldDefinitions.organizationId, organizationId),
      ),
    )
    .limit(1);
  return field ?? null;
}

async function activeFormForField(
  fieldId: string,
  organizationId: string,
  reader: Pick<typeof db, "select"> = db,
) {
  const [form] = await reader
    .select({ id: dataForms.id })
    .from(dataFormFields)
    .innerJoin(
      dataForms,
      and(
        eq(dataForms.id, dataFormFields.formId),
        eq(dataForms.organizationId, organizationId),
        eq(dataForms.active, true),
      ),
    )
    .where(
      and(
        eq(dataFormFields.organizationId, organizationId),
        eq(dataFormFields.fieldId, fieldId),
      ),
    )
    .limit(1);
  return form ?? null;
}

export async function createCustomFieldDefinitionAction(
  _state: CustomFieldActionState,
  formData: FormData,
): Promise<CustomFieldActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = readDefinition(formData);
  if (!parsed.success)
    return {
      ok: false,
      message: validationMessage(parsed.error),
      code: "fieldInvalid",
    };

  const [duplicate] = await db
    .select({ id: customFieldDefinitions.id })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, actor.organizationId),
        eq(customFieldDefinitions.key, parsed.data.key),
      ),
    )
    .limit(1);
  if (duplicate)
    return {
      ok: false,
      message: "Dieser technische Key wird bereits verwendet.",
      code: "fieldDuplicate",
    };
  const defaultDefinition = await ensureDefaultDataProfileDefinition(
    actor.organizationId,
  );
  await db.transaction(async (tx) => {
    const [field] = await tx
      .insert(customFieldDefinitions)
      .values({ organizationId: actor.organizationId, ...parsed.data })
      .returning({ id: customFieldDefinitions.id });

    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "custom_field.created",
      entityType: "custom_field",
      entityId: field.id,
      metadata: { key: parsed.data.key, type: parsed.data.type },
    });
    await tx.insert(dataProfileFields).values({
      organizationId: actor.organizationId,
      profileDefinitionId: defaultDefinition.id,
      fieldId: field.id,
      sortOrder: parsed.data.sortOrder,
    });
  });

  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: "Profilfeld wurde angelegt.",
    code: "fieldCreated",
  };
}

export async function updateCustomFieldDefinitionAction(
  fieldId: string,
  _state: CustomFieldActionState,
  formData: FormData,
): Promise<CustomFieldActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedId = identifierSchema.safeParse(fieldId);
  if (!parsedId.success)
    return {
      ok: false,
      message: "Ungueltiges Profilfeld.",
      code: "fieldInvalid",
    };
  const parsed = readDefinition(formData);
  if (!parsed.success)
    return {
      ok: false,
      message: validationMessage(parsed.error),
      code: "fieldInvalid",
    };

  const current = await getTenantField(parsedId.data, actor.organizationId);
  if (!current)
    return {
      ok: false,
      message: "Profilfeld wurde nicht gefunden.",
      code: "fieldNotFound",
    };
  if (parsed.data.visibility !== "member") {
    const activeForm = await activeFormForField(
      current.id,
      actor.organizationId,
    );
    if (activeForm) {
      return {
        ok: false,
        message: "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
        code: "fieldFormConflict",
      };
    }
  }

  const [duplicate] = await db
    .select({ id: customFieldDefinitions.id })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, actor.organizationId),
        eq(customFieldDefinitions.key, parsed.data.key),
        ne(customFieldDefinitions.id, current.id),
      ),
    )
    .limit(1);
  if (duplicate)
    return {
      ok: false,
      message: "Dieser technische Key wird bereits verwendet.",
      code: "fieldDuplicate",
    };
  if (parsed.data.type === "media" && current.type !== "media") {
    const [existingValue] = await db
      .select({ id: customFieldValues.id })
      .from(customFieldValues)
      .where(
        and(
          eq(customFieldValues.organizationId, actor.organizationId),
          eq(customFieldValues.fieldId, current.id),
        ),
      )
      .limit(1);
    if (existingValue) {
      return {
        ok: false,
        message:
          "Ein bestehendes Feld mit Werten kann nicht direkt in ein Medienfeld umgewandelt werden.",
        code: "fieldMediaConflict",
      };
    }
  }

  const updateResult = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`community-profile-config:${actor.organizationId}`}))`,
    );
    const [locked] = await tx
      .select({ id: customFieldDefinitions.id })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, current.id),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!locked) return { status: "missing" as const };
    const [communityProfileField] = await tx
      .select({ id: communityPublicProfileFields.id })
      .from(communityPublicProfileFields)
      .where(
        and(
          eq(
            communityPublicProfileFields.organizationId,
            actor.organizationId,
          ),
          eq(communityPublicProfileFields.customFieldId, current.id),
        ),
      )
      .limit(1);
    if (
      communityProfileField &&
      (parsed.data.visibility !== "member" ||
        !isCommunityPublicCustomFieldType(parsed.data.type))
    ) {
      return { status: "community_conflict" as const };
    }
    if (
      parsed.data.visibility !== "member" &&
      (await activeFormForField(current.id, actor.organizationId, tx))
    ) {
      return { status: "form_conflict" as const };
    }
    const [updated] = await tx
      .update(customFieldDefinitions)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(customFieldDefinitions.id, current.id),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      )
      .returning();

    const values = await tx
      .select({ id: customFieldValues.id, value: customFieldValues.value })
      .from(customFieldValues)
      .where(
        and(
          eq(customFieldValues.organizationId, actor.organizationId),
          eq(customFieldValues.fieldId, current.id),
        ),
      );
    const invalidIds = values
      .filter(
        (entry) =>
          !isValidCustomFieldValue(updated, entry.value as CustomFieldValue),
      )
      .map((entry) => entry.id);
    const profileValues = await tx
      .select({ id: dataProfileValues.id, value: dataProfileValues.value })
      .from(dataProfileValues)
      .where(
        and(
          eq(dataProfileValues.organizationId, actor.organizationId),
          eq(dataProfileValues.fieldId, current.id),
        ),
      );
    const invalidProfileIds = profileValues
      .filter(
        (entry) =>
          !isValidCustomFieldValue(updated, entry.value as CustomFieldValue),
      )
      .map((entry) => entry.id);

    if (invalidIds.length > 0) {
      await tx
        .delete(customFieldValues)
        .where(
          and(
            eq(customFieldValues.organizationId, actor.organizationId),
            inArray(customFieldValues.id, invalidIds),
          ),
        );
    }
    if (invalidProfileIds.length > 0) {
      await tx
        .delete(dataProfileValues)
        .where(
          and(
            eq(dataProfileValues.organizationId, actor.organizationId),
            inArray(dataProfileValues.id, invalidProfileIds),
          ),
        );
    }

    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "custom_field.updated",
      entityType: "custom_field",
      entityId: current.id,
      metadata: {
        key: parsed.data.key,
        type: parsed.data.type,
        removedValues: invalidIds.length + invalidProfileIds.length,
      },
    });
    return {
      status: "updated" as const,
      removedValues: invalidIds.length + invalidProfileIds.length,
    };
  });
  if (updateResult.status === "missing") {
    return {
      ok: false,
      message: "Profilfeld wurde nicht gefunden.",
      code: "fieldNotFound",
    };
  }
  if (updateResult.status === "form_conflict") {
    return {
      ok: false,
      message: "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
      code: "fieldFormConflict",
    };
  }
  if (updateResult.status === "community_conflict") {
    return {
      ok: false,
      message:
        "Das Feld ist im oeffentlichen Community-Profil konfiguriert. Entferne es dort vor dieser Aenderung.",
      code: "fieldCommunityConflict",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/members");
  return {
    ok: true,
    code:
      updateResult.removedValues > 0
        ? "fieldSavedRemoved"
        : "fieldSaved",
    params: { count: updateResult.removedValues },
    message:
      updateResult.removedValues > 0
        ? `Profilfeld gespeichert. ${updateResult.removedValues} nicht mehr passende Werte wurden entfernt.`
        : "Profilfeld wurde gespeichert.",
  };
}

export async function setCustomFieldActiveAction(
  fieldId: string,
  active: boolean,
): Promise<CustomFieldMutationResult> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = z
    .object({ fieldId: identifierSchema, active: z.boolean() })
    .safeParse({ fieldId, active });
  if (!parsed.success)
    return {
      ok: false,
      message: "Ungueltige Profilfeld-Aktion.",
      code: "fieldInvalid",
    };
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`community-profile-config:${actor.organizationId}`}))`,
    );
    const [current] = await tx
      .select({
        id: customFieldDefinitions.id,
        label: customFieldDefinitions.label,
      })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, parsed.data.fieldId),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return { status: "missing" as const };
    if (!parsed.data.active) {
      const [communityProfileField] = await tx
        .select({ id: communityPublicProfileFields.id })
        .from(communityPublicProfileFields)
        .where(
          and(
            eq(
              communityPublicProfileFields.organizationId,
              actor.organizationId,
            ),
            eq(communityPublicProfileFields.customFieldId, current.id),
          ),
        )
        .limit(1);
      if (communityProfileField) {
        return { status: "community_conflict" as const };
      }
    }
    if (
      !parsed.data.active &&
      (await activeFormForField(current.id, actor.organizationId, tx))
    ) {
      return { status: "conflict" as const };
    }
    const [field] = await tx
      .update(customFieldDefinitions)
      .set({ active: parsed.data.active, updatedAt: new Date() })
      .where(
        and(
          eq(customFieldDefinitions.id, current.id),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      )
      .returning({
        id: customFieldDefinitions.id,
        label: customFieldDefinitions.label,
      });
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "custom_field.updated",
      entityType: "custom_field",
      entityId: field.id,
      metadata: { active: parsed.data.active },
    });
    return { status: "updated" as const, field };
  });
  if (result.status === "missing") {
    return {
      ok: false,
      message: "Profilfeld wurde nicht gefunden.",
      code: "fieldNotFound",
    };
  }
  if (result.status === "conflict") {
    return {
      ok: false,
      message: "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
      code: "fieldFormConflict",
    };
  }
  if (result.status === "community_conflict") {
    return {
      ok: false,
      message:
        "Das Feld ist im oeffentlichen Community-Profil konfiguriert. Entferne es dort vor der Deaktivierung.",
      code: "fieldCommunityConflict",
    };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/admin/members");
  return {
    ok: true,
    message: `${result.field.label} wurde ${parsed.data.active ? "aktiviert" : "deaktiviert"}.`,
    code: parsed.data.active ? "fieldActivated" : "fieldDeactivated",
    params: { name: result.field.label },
  };
}

export async function deleteCustomFieldDefinitionAction(
  fieldId: string,
): Promise<CustomFieldMutationResult> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedId = identifierSchema.safeParse(fieldId);
  if (!parsedId.success)
    return {
      ok: false,
      message: "Ungueltiges Profilfeld.",
      code: "fieldInvalid",
    };
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`community-profile-config:${actor.organizationId}`}))`,
    );
    const [current] = await tx
      .select({
        id: customFieldDefinitions.id,
        label: customFieldDefinitions.label,
      })
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, parsedId.data),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return { status: "missing" as const };
    const [communityProfileField] = await tx
      .select({ id: communityPublicProfileFields.id })
      .from(communityPublicProfileFields)
      .where(
        and(
          eq(
            communityPublicProfileFields.organizationId,
            actor.organizationId,
          ),
          eq(communityPublicProfileFields.customFieldId, current.id),
        ),
      )
      .limit(1);
    if (communityProfileField) {
      return { status: "community_conflict" as const };
    }
    if (await activeFormForField(current.id, actor.organizationId, tx)) {
      return { status: "conflict" as const };
    }
    await tx
      .delete(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.id, current.id),
          eq(customFieldDefinitions.organizationId, actor.organizationId),
        ),
      );

    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "custom_field.deleted",
      entityType: "custom_field",
      entityId: current.id,
      metadata: { label: current.label },
    });
    return { status: "deleted" as const, field: current };
  });
  if (result.status === "missing") {
    return {
      ok: false,
      message: "Profilfeld wurde nicht gefunden.",
      code: "fieldNotFound",
    };
  }
  if (result.status === "conflict") {
    return {
      ok: false,
      message: "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
      code: "fieldFormConflict",
    };
  }
  if (result.status === "community_conflict") {
    return {
      ok: false,
      message:
        "Das Feld ist im oeffentlichen Community-Profil konfiguriert. Entferne es dort zuerst.",
      code: "fieldCommunityConflict",
    };
  }

  revalidatePath("/admin/settings");
  revalidatePath("/admin/members");
  return {
    ok: true,
    message: `${result.field.label} wurde dauerhaft geloescht.`,
    code: "fieldDeleted",
    params: { name: result.field.label },
  };
}

function readMemberValue(
  formData: FormData,
  field: typeof customFieldDefinitions.$inferSelect,
): CustomFieldValue {
  const name = `field:${field.id}`;
  if (field.type === "boolean") return formData.get(name) === "on";
  if (field.type === "multiselect")
    return [...new Set(formData.getAll(name).map(String))];

  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  if (field.type === "number") return Number(raw);
  return raw;
}

export async function updateMemberCustomFieldsAction(
  memberId: string,
  _state: CustomFieldActionState,
  formData: FormData,
): Promise<CustomFieldActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedId = identifierSchema.safeParse(memberId);
  if (!parsedId.success) return { ok: false, message: "Ungueltiges Mitglied." };

  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, parsedId.data),
        eq(users.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!member) return { ok: false, message: "Mitglied wurde nicht gefunden." };
  await ensureDefaultDataProfile(member.id, actor.organizationId);

  const fields = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, actor.organizationId),
        eq(customFieldDefinitions.active, true),
      ),
    );
  const values = fields.map((field) => ({
    field,
    value: readMemberValue(formData, field),
  }));
  const invalid = values.find(
    (entry) => !isValidCustomFieldValue(entry.field, entry.value),
  );
  if (invalid) {
    return {
      ok: false,
      message: `Bitte den Wert fuer "${invalid.field.label}" pruefen${invalid.field.required ? " (Pflichtfeld)" : ""}.`,
    };
  }
  try {
    await assertProfileMediaFieldAssets({
      reader: db,
      organizationId: actor.organizationId,
      userId: member.id,
      entries: values,
    });
  } catch (error) {
    if (error instanceof ProfileMediaFieldBindingError) {
      return {
        ok: false,
        message: "Ein Profilmedium ist nicht bereit oder gehoert zu einem anderen Mitglied.",
      };
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, member.id)}))`,
    );
    const [profile] = await tx
      .select({ id: memberDataProfiles.id })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, member.id),
          eq(memberDataProfiles.isDefault, true),
          eq(memberDataProfiles.active, true),
        ),
      )
      .limit(1);
    if (!profile) throw new Error("Aktives Datenprofil nicht verfuegbar.");
    await assertProfileMediaFieldAssets({
      reader: tx,
      organizationId: actor.organizationId,
      userId: member.id,
      entries: values,
    });
    for (const entry of values) {
      if (
        entry.value === null ||
        (Array.isArray(entry.value) && entry.value.length === 0)
      ) {
        await tx
          .delete(customFieldValues)
          .where(
            and(
              eq(customFieldValues.organizationId, actor.organizationId),
              eq(customFieldValues.userId, member.id),
              eq(customFieldValues.fieldId, entry.field.id),
            ),
          );
        await tx
          .delete(dataProfileValues)
          .where(
            and(
              eq(dataProfileValues.organizationId, actor.organizationId),
              eq(dataProfileValues.userId, member.id),
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
          userId: member.id,
          fieldId: entry.field.id,
          value: entry.value,
        })
        .onConflictDoUpdate({
          target: [customFieldValues.userId, customFieldValues.fieldId],
          set: {
            value: entry.value,
            updatedAt: new Date(),
            organizationId: actor.organizationId,
          },
        });
      await tx
        .insert(dataProfileValues)
        .values({
          organizationId: actor.organizationId,
          userId: member.id,
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
      type: "member.custom_fields.updated",
      entityType: "user",
      entityId: member.id,
      metadata: { fieldCount: values.length },
    });
  });

  revalidatePath(`/admin/members/${member.id}`);
  return { ok: true, message: "Profilfelder wurden gespeichert." };
}
