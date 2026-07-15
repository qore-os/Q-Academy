"use server";

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  customFieldDefinitions,
  dataFormFields,
  dataForms,
  dataProfileDefinitions,
  dataProfileFields,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { courseReferencesDataForm } from "@/lib/course-data-form-lock";
import { hubReferencesDataForm } from "@/lib/data-form-embedding";
import { dataFormMutationLockKey } from "@/lib/data-profile-lock";

export type DataStructureActionState = {
  ok: boolean | null;
  message: string;
  code?: DataStructureActionCode;
  params?: Record<string, string | number>;
};

export type DataStructureActionCode =
  | "definitionInvalid"
  | "definitionFieldInvalid"
  | "definitionDuplicate"
  | "definitionNotFound"
  | "definitionConflict"
  | "definitionCreated"
  | "definitionSaved"
  | "formInvalid"
  | "formDefinitionMissing"
  | "formFieldsInvalid"
  | "formFieldsChanged"
  | "formDuplicate"
  | "formNotFound"
  | "formReferenced"
  | "formCreated"
  | "formSaved"
  | "formActivated"
  | "formDeactivated";

export type DataStructureMutationResult = {
  ok: boolean;
  message: string;
  code?: DataStructureActionCode;
  params?: Record<string, string | number>;
};

const identifierSchema = z.string().uuid();
const baseSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/, "Ungueltiger technischer Key."),
  name: z.string().trim().min(2).max(180),
  description: z
    .string()
    .trim()
    .max(2_000)
    .transform((value) => value || null),
  fieldIds: z.array(identifierSchema).max(200),
});
const definitionSchema = baseSchema.extend({
  allowMemberCreation: z.boolean(),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(100_000),
});
const formSchema = baseSchema.extend({
  profileDefinitionId: identifierSchema,
  submitLabel: z.string().trim().min(2).max(80),
  active: z.boolean(),
});

function uniqueFieldIds(formData: FormData) {
  return [...new Set(formData.getAll("fieldIds").map(String))];
}

function parseDefinition(formData: FormData) {
  return definitionSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    fieldIds: uniqueFieldIds(formData),
    allowMemberCreation: formData.get("allowMemberCreation") === "on",
    active: formData.get("active") === "on",
    sortOrder: Number(formData.get("sortOrder") ?? 0),
  });
}

function parseForm(formData: FormData) {
  return formSchema.safeParse({
    key: formData.get("key"),
    name: formData.get("name"),
    description: formData.get("description") ?? "",
    fieldIds: uniqueFieldIds(formData),
    profileDefinitionId: formData.get("profileDefinitionId"),
    submitLabel: formData.get("submitLabel") ?? "Angaben speichern",
    active: formData.get("active") === "on",
  });
}

async function tenantFields(organizationId: string, fieldIds: string[]) {
  if (fieldIds.length === 0) return [];
  return db
    .select({
      id: customFieldDefinitions.id,
      visibility: customFieldDefinitions.visibility,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, organizationId),
        inArray(customFieldDefinitions.id, fieldIds),
      ),
    );
}

export async function createDataProfileDefinitionAction(
  _state: DataStructureActionState,
  formData: FormData,
): Promise<DataStructureActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = parseDefinition(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Profilvorlage pruefen.",
      code: "definitionInvalid",
    };
  }
  const fields = await tenantFields(actor.organizationId, parsed.data.fieldIds);
  if (fields.length !== parsed.data.fieldIds.length) {
    return {
      ok: false,
      message: "Mindestens ein Profilfeld ist ungueltig.",
      code: "definitionFieldInvalid",
    };
  }
  const [duplicate] = await db
    .select({ id: dataProfileDefinitions.id })
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.organizationId, actor.organizationId),
        eq(dataProfileDefinitions.key, parsed.data.key),
      ),
    )
    .limit(1);
  if (duplicate) {
    return {
      ok: false,
      message: "Dieser Vorlagen-Key wird bereits verwendet.",
      code: "definitionDuplicate",
    };
  }

  await db.transaction(async (tx) => {
    const [definition] = await tx
      .insert(dataProfileDefinitions)
      .values({
        organizationId: actor.organizationId,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description,
        allowMemberCreation: parsed.data.allowMemberCreation,
        active: parsed.data.active,
        sortOrder: parsed.data.sortOrder,
      })
      .returning({ id: dataProfileDefinitions.id });
    if (parsed.data.fieldIds.length > 0) {
      await tx.insert(dataProfileFields).values(
        parsed.data.fieldIds.map((fieldId, sortOrder) => ({
          organizationId: actor.organizationId,
          profileDefinitionId: definition.id,
          fieldId,
          sortOrder,
        })),
      );
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile_definition.created",
      entityType: "data_profile_definition",
      entityId: definition.id,
      metadata: { key: parsed.data.key, fieldCount: parsed.data.fieldIds.length },
    });
  });
  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: "Profilvorlage wurde angelegt.",
    code: "definitionCreated",
  };
}

export async function updateDataProfileDefinitionAction(
  definitionId: string,
  _state: DataStructureActionState,
  formData: FormData,
): Promise<DataStructureActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedId = identifierSchema.safeParse(definitionId);
  const parsed = parseDefinition(formData);
  if (!parsedId.success || !parsed.success) {
    return {
      ok: false,
      message:
        (parsed.success ? null : parsed.error.issues[0]?.message) ??
        "Profilvorlage pruefen.",
      code: "definitionInvalid",
    };
  }
  const [current] = await db
    .select()
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.id, parsedId.data),
        eq(dataProfileDefinitions.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!current) {
    return {
      ok: false,
      message: "Profilvorlage nicht gefunden.",
      code: "definitionNotFound",
    };
  }
  const [duplicate] = await db
    .select({ id: dataProfileDefinitions.id })
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.organizationId, actor.organizationId),
        eq(dataProfileDefinitions.key, parsed.data.key),
        ne(dataProfileDefinitions.id, current.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    return {
      ok: false,
      message: "Dieser Vorlagen-Key wird bereits verwendet.",
      code: "definitionDuplicate",
    };
  }
  let fieldIds = parsed.data.fieldIds;
  if (current.key === "default") {
    fieldIds = (
      await db
        .select({ id: customFieldDefinitions.id })
        .from(customFieldDefinitions)
        .where(eq(customFieldDefinitions.organizationId, actor.organizationId))
    ).map((field) => field.id);
  }
  const fields = await tenantFields(actor.organizationId, fieldIds);
  if (fields.length !== fieldIds.length) {
    return {
      ok: false,
      message: "Mindestens ein Profilfeld ist ungueltig.",
      code: "definitionFieldInvalid",
    };
  }
  const activeFormFields = await db
    .select({ fieldId: dataFormFields.fieldId })
    .from(dataFormFields)
    .innerJoin(
      dataForms,
      and(
        eq(dataForms.id, dataFormFields.formId),
        eq(dataForms.organizationId, actor.organizationId),
        eq(dataForms.profileDefinitionId, current.id),
        eq(dataForms.active, true),
      ),
    )
    .where(eq(dataFormFields.organizationId, actor.organizationId));
  if (activeFormFields.some((entry) => !fieldIds.includes(entry.fieldId))) {
    return {
      ok: false,
      message: "Aktive Formulare verwenden mindestens ein entferntes Profilfeld.",
      code: "definitionConflict",
    };
  }
  const updated = await db.transaction(async (tx) => {
    await tx
      .select({ id: dataProfileFields.id })
      .from(dataProfileFields)
      .where(
        and(
          eq(dataProfileFields.organizationId, actor.organizationId),
          eq(dataProfileFields.profileDefinitionId, current.id),
        ),
      )
      .for("update");
    const currentActiveFormFields = await tx
      .select({ fieldId: dataFormFields.fieldId })
      .from(dataFormFields)
      .innerJoin(
        dataForms,
        and(
          eq(dataForms.id, dataFormFields.formId),
          eq(dataForms.organizationId, actor.organizationId),
          eq(dataForms.profileDefinitionId, current.id),
          eq(dataForms.active, true),
        ),
      )
      .where(eq(dataFormFields.organizationId, actor.organizationId));
    if (
      currentActiveFormFields.some(
        (entry) => !fieldIds.includes(entry.fieldId),
      )
    ) {
      return false;
    }
    await tx
      .update(dataProfileDefinitions)
      .set({
        key: current.key === "default" ? current.key : parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description,
        allowMemberCreation:
          current.key === "default"
            ? false
            : parsed.data.allowMemberCreation,
        active: current.key === "default" ? true : parsed.data.active,
        sortOrder: parsed.data.sortOrder,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataProfileDefinitions.id, current.id),
          eq(dataProfileDefinitions.organizationId, actor.organizationId),
        ),
      );
    await tx
      .delete(dataProfileFields)
      .where(
        and(
          eq(dataProfileFields.organizationId, actor.organizationId),
          eq(dataProfileFields.profileDefinitionId, current.id),
        ),
      );
    if (fieldIds.length > 0) {
      await tx.insert(dataProfileFields).values(
        fieldIds.map((fieldId, sortOrder) => ({
          organizationId: actor.organizationId,
          profileDefinitionId: current.id,
          fieldId,
          sortOrder,
        })),
      );
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_profile_definition.updated",
      entityType: "data_profile_definition",
      entityId: current.id,
      metadata: { fieldCount: fieldIds.length },
    });
    return true;
  });
  if (!updated) {
    return {
      ok: false,
      message: "Aktive Formulare verwenden mindestens ein entferntes Profilfeld.",
      code: "definitionConflict",
    };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/academy/profile");
  return {
    ok: true,
    message: "Profilvorlage wurde gespeichert.",
    code: "definitionSaved",
  };
}

async function validateFormFields(
  organizationId: string,
  definitionId: string,
  fieldIds: string[],
  reader: Pick<typeof db, "select"> = db,
  lockRows = false,
) {
  if (fieldIds.length === 0) return false;
  const query = reader
    .select({ id: dataProfileFields.fieldId })
    .from(dataProfileFields)
    .innerJoin(
      customFieldDefinitions,
      and(
        eq(customFieldDefinitions.id, dataProfileFields.fieldId),
        eq(customFieldDefinitions.organizationId, organizationId),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
      ),
    )
    .where(
      and(
        eq(dataProfileFields.organizationId, organizationId),
        eq(dataProfileFields.profileDefinitionId, definitionId),
        inArray(dataProfileFields.fieldId, fieldIds),
      ),
    );
  const rows = lockRows ? await query.for("share") : await query;
  return rows.length === fieldIds.length;
}

async function dataFormHasEmbeddingReference(
  reader: Pick<typeof db, "select">,
  organizationId: string,
  formId: string,
) {
  if (await courseReferencesDataForm(reader, organizationId, formId)) {
    return true;
  }
  return hubReferencesDataForm(reader, organizationId, formId);
}

export async function createDataFormAction(
  _state: DataStructureActionState,
  formData: FormData,
): Promise<DataStructureActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Formular pruefen.",
      code: "formInvalid",
    };
  }
  const [definition] = await db
    .select({ id: dataProfileDefinitions.id })
    .from(dataProfileDefinitions)
    .where(
      and(
        eq(dataProfileDefinitions.id, parsed.data.profileDefinitionId),
        eq(dataProfileDefinitions.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!definition) {
    return {
      ok: false,
      message: "Profilvorlage nicht gefunden.",
      code: "formDefinitionMissing",
    };
  }
  if (
    !(await validateFormFields(
      actor.organizationId,
      definition.id,
      parsed.data.fieldIds,
    ))
  ) {
    return {
      ok: false,
      message: "Formulare benoetigen sichtbare Felder der Profilvorlage.",
      code: "formFieldsInvalid",
    };
  }
  const [duplicate] = await db
    .select({ id: dataForms.id })
    .from(dataForms)
    .where(
      and(
        eq(dataForms.organizationId, actor.organizationId),
        eq(dataForms.key, parsed.data.key),
      ),
    )
    .limit(1);
  if (duplicate) {
    return {
      ok: false,
      message: "Formular-Key wird bereits verwendet.",
      code: "formDuplicate",
    };
  }

  const created = await db.transaction(async (tx) => {
    if (
      !(await validateFormFields(
        actor.organizationId,
        definition.id,
        parsed.data.fieldIds,
        tx,
        true,
      ))
    ) {
      return false;
    }
    const [form] = await tx
      .insert(dataForms)
      .values({
        organizationId: actor.organizationId,
        profileDefinitionId: definition.id,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description,
        submitLabel: parsed.data.submitLabel,
        active: parsed.data.active,
      })
      .returning({ id: dataForms.id });
    await tx.insert(dataFormFields).values(
      parsed.data.fieldIds.map((fieldId, sortOrder) => ({
        organizationId: actor.organizationId,
        formId: form.id,
        fieldId,
        sortOrder,
      })),
    );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_form.created",
      entityType: "data_form",
      entityId: form.id,
      metadata: {
        profileDefinitionId: definition.id,
        fieldCount: parsed.data.fieldIds.length,
      },
    });
    return true;
  });
  if (!created) {
    return {
      ok: false,
      message: "Formularfelder oder Sichtbarkeit sind nicht mehr gueltig.",
      code: "formFieldsChanged",
    };
  }
  revalidatePath("/admin/settings");
  return {
    ok: true,
    message: "Formular wurde angelegt.",
    code: "formCreated",
  };
}

export async function updateDataFormAction(
  formId: string,
  _state: DataStructureActionState,
  formData: FormData,
): Promise<DataStructureActionState> {
  const actor = await requireTeamPermission("settings.manage");
  const parsedId = identifierSchema.safeParse(formId);
  const parsed = parseForm(formData);
  if (!parsedId.success || !parsed.success) {
    return {
      ok: false,
      message:
        (parsed.success ? null : parsed.error.issues[0]?.message) ??
        "Formular pruefen.",
      code: "formInvalid",
    };
  }
  const [current] = await db
    .select()
    .from(dataForms)
    .where(
      and(
        eq(dataForms.id, parsedId.data),
        eq(dataForms.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!current) {
    return {
      ok: false,
      message: "Formular nicht gefunden.",
      code: "formNotFound",
    };
  }
  if (
    !(await validateFormFields(
      actor.organizationId,
      parsed.data.profileDefinitionId,
      parsed.data.fieldIds,
    ))
  ) {
    return {
      ok: false,
      message: "Formulare benoetigen sichtbare Felder der Profilvorlage.",
      code: "formFieldsInvalid",
    };
  }
  const [duplicate] = await db
    .select({ id: dataForms.id })
    .from(dataForms)
    .where(
      and(
        eq(dataForms.organizationId, actor.organizationId),
        eq(dataForms.key, parsed.data.key),
        ne(dataForms.id, current.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    return {
      ok: false,
      message: "Formular-Key wird bereits verwendet.",
      code: "formDuplicate",
    };
  }

  const saved = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataFormMutationLockKey(actor.organizationId, current.id)}))`,
    );
    if (
      !parsed.data.active &&
      (await dataFormHasEmbeddingReference(
        tx,
        actor.organizationId,
        current.id,
      ))
    ) {
      return "referenced" as const;
    }
    if (
      !(await validateFormFields(
        actor.organizationId,
        parsed.data.profileDefinitionId,
        parsed.data.fieldIds,
        tx,
        true,
      ))
    ) {
      return "invalid" as const;
    }
    await tx
      .update(dataForms)
      .set({
        profileDefinitionId: parsed.data.profileDefinitionId,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description,
        submitLabel: parsed.data.submitLabel,
        active: parsed.data.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dataForms.id, current.id),
          eq(dataForms.organizationId, actor.organizationId),
        ),
      );
    await tx
      .delete(dataFormFields)
      .where(
        and(
          eq(dataFormFields.organizationId, actor.organizationId),
          eq(dataFormFields.formId, current.id),
        ),
      );
    await tx.insert(dataFormFields).values(
      parsed.data.fieldIds.map((fieldId, sortOrder) => ({
        organizationId: actor.organizationId,
        formId: current.id,
        fieldId,
        sortOrder,
      })),
    );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_form.updated",
      entityType: "data_form",
      entityId: current.id,
      metadata: { fieldCount: parsed.data.fieldIds.length },
    });
    return "saved" as const;
  });
  if (saved === "referenced") {
    return {
      ok: false,
      message: "Das Formular wird in einem Kurs oder Hub verwendet.",
      code: "formReferenced",
    };
  }
  if (saved === "invalid") {
    return {
      ok: false,
      message: "Formularfelder oder Sichtbarkeit sind nicht mehr gueltig.",
      code: "formFieldsChanged",
    };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/academy", "layout");
  return {
    ok: true,
    message: "Formular wurde gespeichert.",
    code: "formSaved",
  };
}

export async function setDataFormActiveAction(
  formId: string,
  active: boolean,
): Promise<DataStructureMutationResult> {
  const actor = await requireTeamPermission("settings.manage");
  const parsed = z
    .object({ formId: identifierSchema, active: z.boolean() })
    .safeParse({ formId, active });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Ungueltige Formular-Aktion.",
      code: "formInvalid",
    };
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataFormMutationLockKey(actor.organizationId, parsed.data.formId)}))`,
    );
    const [current] = await tx
      .select({
        id: dataForms.id,
        name: dataForms.name,
        profileDefinitionId: dataForms.profileDefinitionId,
      })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.id, parsed.data.formId),
          eq(dataForms.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!current) return { status: "missing" as const };
    if (
      !parsed.data.active &&
      (await dataFormHasEmbeddingReference(
        tx,
        actor.organizationId,
        current.id,
      ))
    ) {
      return { status: "referenced" as const };
    }
    if (parsed.data.active) {
      const fieldIds = (
        await tx
          .select({ fieldId: dataFormFields.fieldId })
          .from(dataFormFields)
          .where(
            and(
              eq(dataFormFields.organizationId, actor.organizationId),
              eq(dataFormFields.formId, current.id),
            ),
          )
      ).map((field) => field.fieldId);
      if (
        !(await validateFormFields(
          actor.organizationId,
          current.profileDefinitionId,
          fieldIds,
          tx,
          true,
        ))
      ) {
        return { status: "invalid" as const };
      }
    }
    await tx
      .update(dataForms)
      .set({ active: parsed.data.active, updatedAt: new Date() })
      .where(
        and(
          eq(dataForms.id, current.id),
          eq(dataForms.organizationId, actor.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_form.updated",
      entityType: "data_form",
      entityId: current.id,
      metadata: { active: parsed.data.active },
    });
    return { status: "updated" as const, form: current };
  });
  if (result.status === "missing") {
    return {
      ok: false,
      message: "Formular nicht gefunden.",
      code: "formNotFound",
    };
  }
  if (result.status === "invalid") {
    return {
      ok: false,
      message: "Formularfelder oder Sichtbarkeit sind nicht mehr gueltig.",
      code: "formFieldsChanged",
    };
  }
  if (result.status === "referenced") {
    return {
      ok: false,
      message: "Das Formular wird in einem Kurs oder Hub verwendet.",
      code: "formReferenced",
    };
  }
  revalidatePath("/admin/settings");
  revalidatePath("/academy", "layout");
  return {
    ok: true,
    message: `${result.form.name} wurde ${active ? "aktiviert" : "deaktiviert"}.`,
    code: active ? "formActivated" : "formDeactivated",
    params: { name: result.form.name },
  };
}
