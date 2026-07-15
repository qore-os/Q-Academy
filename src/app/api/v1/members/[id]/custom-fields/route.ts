import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  customFieldDefinitions,
  customFieldValues,
  dataProfileValues,
  memberDataProfiles,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { customFieldValuesSchema } from "@/lib/api/schemas";
import {
  isValidCustomFieldValue,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { ensureDefaultDataProfile } from "@/lib/data-profiles";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";
import {
  assertProfileMediaFieldAssets,
  ProfileMediaFieldBindingError,
} from "@/lib/profile-media-fields";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertMember(id: string, organizationId: string) {
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.organizationId, organizationId)))
    .limit(1);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["custom_fields:read", "members:read"],
      action: "member.custom_field.list",
      resourceType: "member",
    },
    async (context) => {
      await assertMember(id, context.organizationId);
      await ensureDefaultDataProfile(id, context.organizationId);
      const data = await db
        .select({
          fieldId: customFieldDefinitions.id,
          key: customFieldDefinitions.key,
          label: customFieldDefinitions.label,
          description: customFieldDefinitions.description,
          type: customFieldDefinitions.type,
          category: customFieldDefinitions.category,
          required: customFieldDefinitions.required,
          visibility: customFieldDefinitions.visibility,
          options: customFieldDefinitions.options,
          sortOrder: customFieldDefinitions.sortOrder,
          value: customFieldValues.value,
          updatedAt: customFieldValues.updatedAt,
        })
        .from(customFieldDefinitions)
        .leftJoin(
          customFieldValues,
          and(
            eq(customFieldValues.fieldId, customFieldDefinitions.id),
            eq(customFieldValues.userId, id),
          ),
        )
        .where(
          and(
            eq(customFieldDefinitions.organizationId, context.organizationId),
            eq(customFieldDefinitions.active, true),
          ),
        )
        .orderBy(
          asc(customFieldDefinitions.category),
          asc(customFieldDefinitions.sortOrder),
        );
      return { data, resourceId: id };
    },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["custom_fields:write", "members:write"],
      action: "member.custom_field.update",
      resourceType: "member",
      idempotent: true,
    },
    async (context) => {
      await assertMember(id, context.organizationId);
      await ensureDefaultDataProfile(id, context.organizationId);
      const input = await parseJson(request, customFieldValuesSchema);
      const fieldIds = input.values.map((item) => item.fieldId);
      const fields = fieldIds.length
        ? await db
            .select()
            .from(customFieldDefinitions)
            .where(
              and(
                eq(
                  customFieldDefinitions.organizationId,
                  context.organizationId,
                ),
                eq(customFieldDefinitions.active, true),
                inArray(customFieldDefinitions.id, fieldIds),
              ),
            )
        : [];
      const byId = new Map(fields.map((field) => [field.id, field]));
      for (const item of input.values) {
        const field = byId.get(item.fieldId);
        if (!field)
          throw new ApiError(
            404,
            "not_found",
            `Profilfeld ${item.fieldId} nicht gefunden.`,
          );
        if (!isValidCustomFieldValue(field, item.value as CustomFieldValue))
          throw new ApiError(
            422,
            "validation_error",
            `Wert fuer ${field.key} passt nicht zum Feldtyp.`,
          );
      }
      const mediaEntries = input.values.map((item) => ({
        field: byId.get(item.fieldId)!,
        value: item.value as CustomFieldValue,
      }));
      try {
        await assertProfileMediaFieldAssets({
          reader: db,
          organizationId: context.organizationId,
          userId: id,
          entries: mediaEntries,
        });
      } catch (error) {
        if (error instanceof ProfileMediaFieldBindingError) {
          throw new ApiError(
            422,
            "validation_error",
            "Profilmedium ist nicht bereit oder gehoert zu einem anderen Mitglied.",
          );
        }
        throw error;
      }
      const data = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(context.organizationId, id)}))`,
        );
        const [profile] = await tx
          .select({ id: memberDataProfiles.id })
          .from(memberDataProfiles)
          .where(
            and(
              eq(memberDataProfiles.organizationId, context.organizationId),
              eq(memberDataProfiles.userId, id),
              eq(memberDataProfiles.isDefault, true),
              eq(memberDataProfiles.active, true),
            ),
          )
          .limit(1);
        if (!profile) {
          throw new ApiError(409, "conflict", "Aktives Datenprofil nicht verfuegbar.");
        }
        await assertProfileMediaFieldAssets({
          reader: tx,
          organizationId: context.organizationId,
          userId: id,
          entries: mediaEntries,
        });
        const updated = [];
        for (const item of input.values) {
          const [value] = await tx
            .insert(customFieldValues)
            .values({
              organizationId: context.organizationId,
              userId: id,
              fieldId: item.fieldId,
              value: item.value,
            })
            .onConflictDoUpdate({
              target: [customFieldValues.userId, customFieldValues.fieldId],
              set: { value: item.value, updatedAt: new Date() },
            })
            .returning();
          updated.push(value);
          await tx
            .insert(dataProfileValues)
            .values({
              organizationId: context.organizationId,
              userId: id,
              profileId: profile.id,
              fieldId: item.fieldId,
              value: item.value,
            })
            .onConflictDoUpdate({
              target: [dataProfileValues.profileId, dataProfileValues.fieldId],
              set: { value: item.value, updatedAt: new Date() },
            });
        }
        return updated;
      });
      return { data, resourceId: id };
    },
  );
}
