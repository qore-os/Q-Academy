"use server";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  customFieldDefinitions,
  customFieldValues,
  dataFormFields,
  dataForms,
  dataFormSubmissions,
  dataProfileFields,
  dataProfileValues,
  enrollments,
  hubs,
  memberDataProfiles,
  courses,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  isValidCustomFieldValue,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { ensureDefaultDataProfile } from "@/lib/data-profiles";
import {
  dataFormMutationLockKey,
  dataProfileMutationLockKey,
} from "@/lib/data-profile-lock";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import {
  assertProfileMediaFieldAssets,
  ProfileMediaFieldBindingError,
} from "@/lib/profile-media-fields";

export type DataFormMessageCode =
  | "invalid_form"
  | "invalid_request"
  | "form_not_found"
  | "source_denied"
  | "profile_not_found"
  | "profile_mismatch"
  | "invalid_field"
  | "media_unavailable"
  | "saved"
  | "failed";

export type DataFormActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: DataFormMessageCode;
  fieldLabel?: string;
  required?: boolean;
};

const identifierSchema = z.string().uuid();
const sourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("profile"), id: z.null() }),
  z.object({ type: z.literal("lesson"), id: identifierSchema }),
  z.object({ type: z.literal("hub"), id: identifierSchema }),
]);

function readValue(
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

type DataFormReader = Pick<typeof db, "select">;

async function activeTenantForm(
  formId: string,
  organizationId: string,
  reader: DataFormReader = db,
) {
  const [form] = await reader
    .select()
    .from(dataForms)
    .where(
      and(
        eq(dataForms.id, formId),
        eq(dataForms.organizationId, organizationId),
        eq(dataForms.active, true),
      ),
    )
    .limit(1);
  return form ?? null;
}

async function memberFormFields(
  formId: string,
  organizationId: string,
  reader: DataFormReader = db,
) {
  return reader
    .select({
      field: customFieldDefinitions,
      requiredOverride: dataFormFields.requiredOverride,
    })
    .from(dataFormFields)
    .innerJoin(
      dataForms,
      and(
        eq(dataForms.id, dataFormFields.formId),
        eq(dataForms.organizationId, organizationId),
        eq(dataForms.active, true),
      ),
    )
    .innerJoin(
      dataProfileFields,
      and(
        eq(dataProfileFields.organizationId, organizationId),
        eq(
          dataProfileFields.profileDefinitionId,
          dataForms.profileDefinitionId,
        ),
        eq(dataProfileFields.fieldId, dataFormFields.fieldId),
      ),
    )
    .innerJoin(
      customFieldDefinitions,
      and(
        eq(customFieldDefinitions.id, dataFormFields.fieldId),
        eq(customFieldDefinitions.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(dataFormFields.organizationId, organizationId),
        eq(dataFormFields.formId, formId),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
      ),
    )
    .orderBy(asc(dataFormFields.sortOrder), asc(customFieldDefinitions.label));
}

export async function loadOwnDataFormAction(
  formId: string,
  sourceType: "profile" | "lesson" | "hub" = "profile",
  sourceId: string | null = null,
) {
  const actor = await requireUser();
  const parsedId = identifierSchema.safeParse(formId);
  const source = sourceSchema.safeParse({ type: sourceType, id: sourceId });
  if (!parsedId.success || !source.success) {
    return {
      ok: false as const,
      message: "Ungueltiges Formular.",
      messageCode: "invalid_form" as const,
    };
  }
  await ensureDefaultDataProfile(actor.id, actor.organizationId);
  const form = await activeTenantForm(parsedId.data, actor.organizationId);
  if (!form) {
    return {
      ok: false as const,
      message: "Formular nicht gefunden.",
      messageCode: "form_not_found" as const,
    };
  }
  if (
    !(await assertEmbeddedSource({
      organizationId: actor.organizationId,
      userId: actor.id,
      formId: form.id,
      source: source.data,
    }))
  ) {
    return {
      ok: false as const,
      message: "Formular ist an dieser Stelle nicht freigegeben.",
      messageCode: "source_denied" as const,
    };
  }
  const [fields, profiles] = await Promise.all([
    memberFormFields(form.id, actor.organizationId),
    db
      .select({
        id: memberDataProfiles.id,
        name: memberDataProfiles.name,
        isDefault: memberDataProfiles.isDefault,
      })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, actor.id),
          eq(memberDataProfiles.definitionId, form.profileDefinitionId),
          eq(memberDataProfiles.active, true),
        ),
      )
      .orderBy(asc(memberDataProfiles.name)),
  ]);
  const profileIds = profiles.map((profile) => profile.id);
  const values = profileIds.length
    ? await db
        .select({
          profileId: dataProfileValues.profileId,
          fieldId: dataProfileValues.fieldId,
          value: dataProfileValues.value,
        })
        .from(dataProfileValues)
        .where(
          and(
            eq(dataProfileValues.organizationId, actor.organizationId),
            eq(dataProfileValues.userId, actor.id),
            inArray(dataProfileValues.profileId, profileIds),
          ),
        )
    : [];
  return {
    ok: true as const,
    data: {
      id: form.id,
      name: form.name,
      description: form.description,
      submitLabel: form.submitLabel,
      profiles,
      fields: fields.map(({ field, requiredOverride }) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        description: field.description,
        type: field.type,
        category: field.category,
        required: requiredOverride ?? field.required,
        options: field.options,
        values: Object.fromEntries(
          values
            .filter((value) => value.fieldId === field.id)
            .map((value) => [value.profileId, value.value]),
        ),
      })),
    },
  };
}

async function assertEmbeddedSource({
  organizationId,
  userId,
  formId,
  source,
  reader = db,
  requireInteraction = false,
  interactionLockExecutor,
  now = new Date(),
}: {
  organizationId: string;
  userId: string;
  formId: string;
  source: z.infer<typeof sourceSchema>;
  reader?: DataFormReader;
  requireInteraction?: boolean;
  interactionLockExecutor?: Parameters<typeof lockMemberCourseProgress>[0];
  now?: Date;
}) {
  if (source.type === "profile") return true;
  if (source.type === "lesson") {
    const candidateQuery = () =>
      reader
        .select({ courseId: courses.id })
        .from(enrollments)
        .innerJoin(
          courses,
          and(
            eq(courses.id, enrollments.courseId),
            eq(courses.organizationId, organizationId),
            eq(courses.status, "published"),
          ),
        )
        .where(
          and(
            eq(enrollments.userId, userId),
            eq(enrollments.accessActive, true),
          ),
        );
    let candidates = await candidateQuery();
    if (interactionLockExecutor) {
      const lockedCourseIds = [
        ...new Set(candidates.map((candidate) => candidate.courseId)),
      ].sort();
      for (const courseId of lockedCourseIds) {
        await lockMemberCourseProgress(interactionLockExecutor, {
          organizationId,
          userId,
          courseId,
        });
      }
      const lockedCourseIdSet = new Set(lockedCourseIds);
      candidates = (await candidateQuery().for("share")).filter((candidate) =>
        lockedCourseIdSet.has(candidate.courseId),
      );
    }
    for (const candidate of candidates) {
      const access = await getCourseLearningAccess(reader, {
        organizationId,
        userId,
        courseId: candidate.courseId,
        now,
      });
      const lesson = access?.lessons.get(source.id);
      if (
        !lesson ||
        (requireInteraction
          ? !lesson.access.canInteract
          : !lesson.access.accessible)
      ) {
        continue;
      }
      const blocks = [
        ...lesson.lesson.blocks,
        ...lesson.lesson.pages
          .filter((page) => page.status === "published")
          .flatMap((page) => page.blocks),
      ];
      if (
        blocks.some(
          (block) =>
            block.type === "data_form" &&
            typeof block.data === "object" &&
            block.data !== null &&
            "formId" in block.data &&
            block.data.formId === formId,
        )
      ) {
        return true;
      }
    }
    return false;
  }
  const [hub] = await reader
    .select({ layout: hubs.layout })
    .from(hubs)
    .where(
      and(
        eq(hubs.id, source.id),
        eq(hubs.organizationId, organizationId),
        eq(hubs.status, "published"),
        sql`(
          not exists (select 1 from hub_access_grants hag where hag.hub_id = ${hubs.id})
          or exists (
            select 1 from hub_access_grants hag
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'user' and hag.subject_id = ${userId}
          )
          or exists (
            select 1 from hub_access_grants hag
            inner join group_members gm on gm.group_id = hag.subject_id
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'group' and gm.user_id = ${userId}
          )
          or exists (
            select 1 from hub_access_grants hag
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'bundle' and (
              exists (select 1 from member_bundles mb where mb.bundle_id = hag.subject_id and mb.user_id = ${userId})
              or exists (
                select 1 from group_bundles gb
                inner join group_members gm on gm.group_id = gb.group_id
                where gb.bundle_id = hag.subject_id and gm.user_id = ${userId}
              )
            )
          )
        )`,
      ),
    )
    .limit(1);
  return Boolean(
    hub?.layout.some((row) =>
      row.columns.some(
        (widget) =>
          (widget as { type?: string; formId?: string }).type === "data_form" &&
          (widget as { formId?: string }).formId === formId,
      ),
    ),
  );
}

export async function submitOwnDataFormAction(
  formId: string,
  profileId: string,
  sourceType: "profile" | "lesson" | "hub",
  sourceId: string | null,
  _state: DataFormActionState,
  formData: FormData,
): Promise<DataFormActionState> {
  const actor = await requireUser();
  const parsed = z
    .object({ formId: identifierSchema, profileId: identifierSchema })
    .safeParse({ formId, profileId });
  const source = sourceSchema.safeParse({ type: sourceType, id: sourceId });
  if (!parsed.success || !source.success) {
    return {
      ok: false,
      message: "Ungueltige Formular-Anfrage.",
      messageCode: "invalid_request",
    };
  }
  const form = await activeTenantForm(parsed.data.formId, actor.organizationId);
  if (!form) {
    return {
      ok: false,
      message: "Formular nicht gefunden.",
      messageCode: "form_not_found",
    };
  }
  const [profile] = await db
    .select({
      id: memberDataProfiles.id,
      definitionId: memberDataProfiles.definitionId,
      isDefault: memberDataProfiles.isDefault,
    })
    .from(memberDataProfiles)
    .where(
      and(
        eq(memberDataProfiles.id, parsed.data.profileId),
        eq(memberDataProfiles.organizationId, actor.organizationId),
        eq(memberDataProfiles.userId, actor.id),
        eq(memberDataProfiles.active, true),
      ),
    )
    .limit(1);
  if (!profile || profile.definitionId !== form.profileDefinitionId) {
    return {
      ok: false,
      message: "Datenprofil passt nicht zum Formular.",
      messageCode: "profile_mismatch",
    };
  }
  if (
    !(await assertEmbeddedSource({
      organizationId: actor.organizationId,
      userId: actor.id,
      formId: form.id,
      source: source.data,
      requireInteraction: true,
    }))
  ) {
    return {
      ok: false,
      message: "Formular ist an dieser Stelle nicht freigegeben.",
      messageCode: "source_denied",
    };
  }

  const fields = await memberFormFields(form.id, actor.organizationId);
  const entries = fields.map(({ field, requiredOverride }) => {
    const effectiveField = {
      ...field,
      required: requiredOverride ?? field.required,
    };
    return { field: effectiveField, value: readValue(formData, effectiveField) };
  });
  const invalid = entries.find(
    ({ field, value }) => !isValidCustomFieldValue(field, value),
  );
  if (invalid) {
    return {
      ok: false,
      message: `Bitte den Wert fuer "${invalid.field.label}" pruefen${invalid.field.required ? " (Pflichtfeld)" : ""}.`,
      messageCode: "invalid_field",
      fieldLabel: invalid.field.label,
      required: invalid.field.required,
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
      return {
        ok: false,
        message: "Ein Profilmedium ist nicht bereit oder gehoert nicht zu deinem Profil.",
        messageCode: "media_unavailable",
      };
    }
    throw error;
  }

  const submitted = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(actor.organizationId, actor.id)}))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataFormMutationLockKey(actor.organizationId, parsed.data.formId)}))`,
    );
    const currentForm = await activeTenantForm(
      parsed.data.formId,
      actor.organizationId,
      tx,
    );
    if (!currentForm) {
      return {
        ok: false as const,
        message: "Formular nicht gefunden.",
        messageCode: "form_not_found" as const,
      };
    }
    const [currentProfile] = await tx
      .select({
        id: memberDataProfiles.id,
        definitionId: memberDataProfiles.definitionId,
        isDefault: memberDataProfiles.isDefault,
        active: memberDataProfiles.active,
      })
      .from(memberDataProfiles)
      .where(
        and(
          eq(memberDataProfiles.id, parsed.data.profileId),
          eq(memberDataProfiles.organizationId, actor.organizationId),
          eq(memberDataProfiles.userId, actor.id),
        ),
      )
      .limit(1);
    if (!currentProfile?.active) {
      return {
        ok: false as const,
        message: "Datenprofil nicht gefunden.",
        messageCode: "profile_not_found" as const,
      };
    }
    if (currentProfile.definitionId !== currentForm.profileDefinitionId) {
      return {
        ok: false as const,
        message: "Datenprofil passt nicht zum Formular.",
        messageCode: "profile_mismatch" as const,
      };
    }
    if (
      !(await assertEmbeddedSource({
        organizationId: actor.organizationId,
        userId: actor.id,
        formId: currentForm.id,
        source: source.data,
        reader: tx,
        requireInteraction: true,
        interactionLockExecutor: tx,
      }))
    ) {
      return {
        ok: false as const,
        message: "Formular ist an dieser Stelle nicht freigegeben.",
        messageCode: "source_denied" as const,
      };
    }
    const currentFields = await memberFormFields(
      currentForm.id,
      actor.organizationId,
      tx,
    );
    const currentEntries = currentFields.map(({ field, requiredOverride }) => {
      const effectiveField = {
        ...field,
        required: requiredOverride ?? field.required,
      };
      return {
        field: effectiveField,
        value: readValue(formData, effectiveField),
      };
    });
    const currentInvalid = currentEntries.find(
      ({ field, value }) => !isValidCustomFieldValue(field, value),
    );
    if (currentInvalid) {
      return {
        ok: false as const,
        message: `Bitte den Wert fuer "${currentInvalid.field.label}" pruefen${currentInvalid.field.required ? " (Pflichtfeld)" : ""}.`,
        messageCode: "invalid_field" as const,
        fieldLabel: currentInvalid.field.label,
        required: currentInvalid.field.required,
      };
    }
    try {
      await assertProfileMediaFieldAssets({
        reader: tx,
        organizationId: actor.organizationId,
        userId: actor.id,
        entries: currentEntries,
      });
    } catch (error) {
      if (error instanceof ProfileMediaFieldBindingError) {
        return {
          ok: false as const,
          message: "Ein Profilmedium ist nicht bereit oder gehoert nicht zu deinem Profil.",
          messageCode: "media_unavailable" as const,
        };
      }
      throw error;
    }
    for (const entry of currentEntries) {
      const empty =
        entry.value === null ||
        (Array.isArray(entry.value) && entry.value.length === 0);
      if (empty) {
        await tx
          .delete(dataProfileValues)
          .where(
            and(
              eq(dataProfileValues.organizationId, actor.organizationId),
              eq(dataProfileValues.profileId, currentProfile.id),
              eq(dataProfileValues.userId, actor.id),
              eq(dataProfileValues.fieldId, entry.field.id),
            ),
          );
        if (currentProfile.isDefault) {
          await tx
            .delete(customFieldValues)
            .where(
              and(
                eq(customFieldValues.organizationId, actor.organizationId),
                eq(customFieldValues.userId, actor.id),
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
          userId: actor.id,
          profileId: currentProfile.id,
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
            userId: actor.id,
            fieldId: entry.field.id,
            value: entry.value,
          })
          .onConflictDoUpdate({
            target: [customFieldValues.userId, customFieldValues.fieldId],
            set: { value: entry.value, updatedAt: new Date() },
          });
      }
    }
    const [submission] = await tx
      .insert(dataFormSubmissions)
      .values({
        organizationId: actor.organizationId,
        formId: currentForm.id,
        profileId: currentProfile.id,
        userId: actor.id,
        submittedById: actor.id,
        sourceType: source.data.type,
        sourceId: source.data.id,
        responseSnapshot: currentEntries.map(({ field, value }) => ({
          fieldId: field.id,
          key: field.key,
          label: field.label,
          value,
        })),
      })
      .returning({ id: dataFormSubmissions.id });
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "data_form.submitted",
      entityType: "data_form_submission",
      entityId: submission.id,
      metadata: {
        formId: currentForm.id,
        profileId: currentProfile.id,
        sourceType: source.data.type,
        sourceId: source.data.id,
        fieldCount: currentEntries.length,
      },
    });
    return { ok: true as const };
  });
  if (!submitted.ok) return submitted;
  revalidatePath("/academy/profile");
  return {
    ok: true,
    message: "Angaben wurden gespeichert.",
    messageCode: "saved",
  };
}
