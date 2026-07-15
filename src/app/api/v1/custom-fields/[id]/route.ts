import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  customFieldDefinitions,
  customFieldValues,
  dataFormFields,
  dataForms,
  dataProfileValues,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { customFieldUpdateSchema } from "@/lib/api/schemas";
import { PERSONALIZABLE_CUSTOM_FIELD_TYPES } from "@/lib/member-property-model";
import {
  isValidCustomFieldValue,
  type CustomFieldValue,
} from "@/lib/custom-fields";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function fieldForOrganization(id: string, organizationId: string) {
  const [field] = await db.select().from(customFieldDefinitions).where(and(eq(customFieldDefinitions.id, id), eq(customFieldDefinitions.organizationId, organizationId))).limit(1);
  if (!field) throw new ApiError(404, "not_found", "Profilfeld nicht gefunden.");
  return field;
}

async function activeFormForField(
  id: string,
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
        eq(dataFormFields.fieldId, id),
      ),
    )
    .limit(1);
  return form ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["custom_fields:read"], action: "custom_field.read", resourceType: "custom_field" }, async (context) => ({ data: await fieldForOrganization(id, context.organizationId), resourceId: id }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["custom_fields:write"], action: "custom_field.update", resourceType: "custom_field", idempotent: true }, async (context) => {
    const current = await fieldForOrganization(id, context.organizationId);
    const input = await parseJson(request, customFieldUpdateSchema);
    const type = input.type ?? current.type;
    const options = input.options ?? current.options;
    if (["select", "multiselect"].includes(type) && !options.length) throw new ApiError(422, "validation_error", "Auswahlfelder benoetigen mindestens eine Option.");
    if (
      (input.personalizationEnabled ?? current.personalizationEnabled) &&
      ((input.visibility ?? current.visibility) !== "member" ||
        !PERSONALIZABLE_CUSTOM_FIELD_TYPES.includes(
          type as (typeof PERSONALIZABLE_CUSTOM_FIELD_TYPES)[number],
        ))
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Personalisierung ist fuer dieses Profilfeld nicht erlaubt.",
      );
    }
    if (input.key && input.key !== current.key) {
      const [duplicate] = await db.select({ id: customFieldDefinitions.id }).from(customFieldDefinitions).where(and(eq(customFieldDefinitions.organizationId, context.organizationId), eq(customFieldDefinitions.key, input.key))).limit(1);
      if (duplicate) throw new ApiError(409, "conflict", "Ein Profilfeld mit diesem Key existiert bereits.");
    }
    const field = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.id, id),
            eq(customFieldDefinitions.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!locked) {
        throw new ApiError(404, "not_found", "Profilfeld nicht gefunden.");
      }
      const nextType = input.type ?? locked.type;
      if (
        (input.personalizationEnabled ?? locked.personalizationEnabled) &&
        ((input.visibility ?? locked.visibility) !== "member" ||
          !PERSONALIZABLE_CUSTOM_FIELD_TYPES.includes(
            nextType as (typeof PERSONALIZABLE_CUSTOM_FIELD_TYPES)[number],
          ))
      ) {
        throw new ApiError(
          422,
          "validation_error",
          "Personalisierung ist fuer dieses Profilfeld nicht erlaubt.",
        );
      }
      if (
        (input.visibility ?? locked.visibility) !== "member" ||
        input.active === false
      ) {
        const activeForm = await activeFormForField(
          locked.id,
          context.organizationId,
          tx,
        );
        if (activeForm) {
          throw new ApiError(
            409,
            "conflict",
            "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
          );
        }
      }
      const [updated] = await tx
        .update(customFieldDefinitions)
        .set({ ...input, updatedAt: new Date() })
        .where(
          and(
            eq(customFieldDefinitions.id, id),
            eq(customFieldDefinitions.organizationId, context.organizationId),
          ),
        )
        .returning();
      const legacyValues = await tx
        .select({ id: customFieldValues.id, value: customFieldValues.value })
        .from(customFieldValues)
        .where(
          and(
            eq(customFieldValues.organizationId, context.organizationId),
            eq(customFieldValues.fieldId, id),
          ),
        );
      const profileValues = await tx
        .select({ id: dataProfileValues.id, value: dataProfileValues.value })
        .from(dataProfileValues)
        .where(
          and(
            eq(dataProfileValues.organizationId, context.organizationId),
            eq(dataProfileValues.fieldId, id),
          ),
        );
      const invalidLegacyIds = legacyValues
        .filter(
          (entry) =>
            !isValidCustomFieldValue(updated, entry.value as CustomFieldValue),
        )
        .map((entry) => entry.id);
      const invalidProfileIds = profileValues
        .filter(
          (entry) =>
            !isValidCustomFieldValue(updated, entry.value as CustomFieldValue),
        )
        .map((entry) => entry.id);
      if (invalidLegacyIds.length > 0) {
        await tx
          .delete(customFieldValues)
          .where(inArray(customFieldValues.id, invalidLegacyIds));
      }
      if (invalidProfileIds.length > 0) {
        await tx
          .delete(dataProfileValues)
          .where(inArray(dataProfileValues.id, invalidProfileIds));
      }
      return updated;
    });
    return { data: field, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["custom_fields:write"], action: "custom_field.disable", resourceType: "custom_field", idempotent: true }, async (context) => {
    const field = await db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.id, id),
            eq(customFieldDefinitions.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!locked) {
        throw new ApiError(404, "not_found", "Profilfeld nicht gefunden.");
      }
      if (await activeFormForField(id, context.organizationId, tx)) {
        throw new ApiError(
          409,
          "conflict",
          "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
        );
      }
      const [updated] = await tx
        .update(customFieldDefinitions)
        .set({ active: false, updatedAt: new Date() })
        .where(
          and(
            eq(customFieldDefinitions.id, id),
            eq(customFieldDefinitions.organizationId, context.organizationId),
          ),
        )
        .returning();
      return updated;
    });
    return { data: field, resourceId: id };
  });
}
