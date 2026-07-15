import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  customFieldDefinitions,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  memberDataProfiles,
  users,
  type User,
} from "@/db/schema";
import type { CustomFieldValue } from "@/lib/custom-fields";
import { canViewCustomField } from "@/lib/data-profile-policy";
import type { AppLocale } from "@/lib/i18n/model";
import { getOperationsAdminCopy } from "@/lib/i18n/operations-admin";
import {
  PERSONALIZABLE_CUSTOM_FIELD_TYPES,
  csvCell,
  memberPropertyAnalyticsQuerySchema,
  memberPropertyEmailToken,
  memberPropertyTemplateToken,
  memberPropertyValueMatches,
  presentMemberPropertyValue,
  validatePersonalizedTemplateText,
  type MemberPropertyAnalyticsQuery,
  type MemberPropertyVariableDescriptor,
} from "@/lib/member-property-model";

type MemberPropertyReader = Pick<typeof db, "select">;

const PERSONALIZABLE_TYPE_SET = new Set<string>(
  PERSONALIZABLE_CUSTOM_FIELD_TYPES,
);

export async function listMemberPropertyVariableCatalog(
  organizationId: string,
  reader: MemberPropertyReader = db,
): Promise<MemberPropertyVariableDescriptor[]> {
  const rows = await reader
    .select({
      fieldId: customFieldDefinitions.id,
      fieldKey: customFieldDefinitions.key,
      fieldLabel: customFieldDefinitions.label,
      fieldType: customFieldDefinitions.type,
      definitionId: dataProfileDefinitions.id,
      definitionKey: dataProfileDefinitions.key,
      definitionName: dataProfileDefinitions.name,
    })
    .from(dataProfileFields)
    .innerJoin(
      customFieldDefinitions,
      and(
        eq(customFieldDefinitions.id, dataProfileFields.fieldId),
        eq(
          customFieldDefinitions.organizationId,
          dataProfileFields.organizationId,
        ),
      ),
    )
    .innerJoin(
      dataProfileDefinitions,
      and(
        eq(dataProfileDefinitions.id, dataProfileFields.profileDefinitionId),
        eq(
          dataProfileDefinitions.organizationId,
          dataProfileFields.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(dataProfileFields.organizationId, organizationId),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
        eq(customFieldDefinitions.personalizationEnabled, true),
        eq(dataProfileDefinitions.active, true),
      ),
    )
    .orderBy(
      asc(dataProfileDefinitions.sortOrder),
      asc(dataProfileDefinitions.name),
      asc(dataProfileFields.sortOrder),
      asc(customFieldDefinitions.label),
    );
  return rows.flatMap((row) => {
    if (!PERSONALIZABLE_TYPE_SET.has(row.fieldType)) return [];
    return [
      {
        token: memberPropertyTemplateToken(row.definitionKey, row.fieldKey),
        emailToken: memberPropertyEmailToken(
          row.definitionKey,
          row.fieldKey,
        ),
        label: `${row.definitionName}: ${row.fieldLabel}`,
        fieldId: row.fieldId,
        fieldKey: row.fieldKey,
        fieldType: row.fieldType,
        profileDefinitionId: row.definitionId,
        profileDefinitionKey: row.definitionKey,
        profileDefinitionName: row.definitionName,
      },
    ];
  });
}

export async function validateTenantPersonalizedTexts(input: {
  organizationId: string;
  values: readonly string[];
  staticTokens?: readonly string[];
  emailTokens?: boolean;
  reader?: MemberPropertyReader;
}) {
  const catalog = await listMemberPropertyVariableCatalog(
    input.organizationId,
    input.reader ?? db,
  );
  const allowedTokens = catalog.map((entry) =>
    input.emailTokens ? entry.emailToken : entry.token,
  );
  for (const value of input.values) {
    const error = validatePersonalizedTemplateText({
      value,
      allowedTokens,
      staticTokens: input.staticTokens,
    });
    if (error) return error;
  }
  return null;
}

export async function resolveMemberPropertyVariables(input: {
  organizationId: string;
  userId: string;
  locale?: string;
  reader?: MemberPropertyReader;
}) {
  const reader = input.reader ?? db;
  const catalog = await listMemberPropertyVariableCatalog(
    input.organizationId,
    reader,
  );
  if (!catalog.length) return { catalog, text: {}, email: {} };
  const profiles = await reader
    .select({
      id: memberDataProfiles.id,
      definitionId: memberDataProfiles.definitionId,
      isDefault: memberDataProfiles.isDefault,
      updatedAt: memberDataProfiles.updatedAt,
    })
    .from(memberDataProfiles)
    .innerJoin(
      users,
      and(
        eq(users.id, memberDataProfiles.userId),
        eq(users.organizationId, memberDataProfiles.organizationId),
      ),
    )
    .where(
      and(
        eq(memberDataProfiles.organizationId, input.organizationId),
        eq(memberDataProfiles.userId, input.userId),
        eq(memberDataProfiles.active, true),
        eq(users.status, "active"),
      ),
    )
    .orderBy(desc(memberDataProfiles.isDefault), desc(memberDataProfiles.updatedAt));
  const selectedProfiles = new Map<string, string>();
  for (const profile of profiles) {
    if (!selectedProfiles.has(profile.definitionId)) {
      selectedProfiles.set(profile.definitionId, profile.id);
    }
  }
  const profileIds = [...selectedProfiles.values()];
  const values = profileIds.length
    ? await reader
        .select({
          profileId: dataProfileValues.profileId,
          fieldId: dataProfileValues.fieldId,
          value: dataProfileValues.value,
        })
        .from(dataProfileValues)
        .where(
          and(
            eq(dataProfileValues.organizationId, input.organizationId),
            eq(dataProfileValues.userId, input.userId),
            inArray(dataProfileValues.profileId, profileIds),
            inArray(
              dataProfileValues.fieldId,
              [...new Set(catalog.map((entry) => entry.fieldId))],
            ),
          ),
        )
    : [];
  const valueByProfileAndField = new Map(
    values.map((value) => [
      `${value.profileId}:${value.fieldId}`,
      value.value as CustomFieldValue,
    ]),
  );
  const text: Record<string, string> = {};
  const email: Record<string, string> = {};
  for (const variable of catalog) {
    const profileId = selectedProfiles.get(variable.profileDefinitionId);
    const value = profileId
      ? (valueByProfileAndField.get(`${profileId}:${variable.fieldId}`) ?? null)
      : null;
    const rendered = presentMemberPropertyValue(
      value,
      variable.fieldType,
      input.locale,
    );
    text[variable.token] = rendered;
    email[variable.emailToken] = rendered;
  }
  return { catalog, text, email };
}

type AnalyticsField = {
  id: string;
  key: string;
  label: string;
  type: typeof customFieldDefinitions.$inferSelect.type;
  visibility: typeof customFieldDefinitions.$inferSelect.visibility;
  options: string[];
  profileDefinitionId: string;
  profileDefinitionKey: string;
  profileDefinitionName: string;
};

export async function listMemberPropertyAnalyticsFields(input: {
  organizationId: string;
  viewer: Pick<User, "id" | "role">;
  reader?: MemberPropertyReader;
}): Promise<AnalyticsField[]> {
  const reader = input.reader ?? db;
  const rows = await reader
    .select({
      id: customFieldDefinitions.id,
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      type: customFieldDefinitions.type,
      visibility: customFieldDefinitions.visibility,
      options: customFieldDefinitions.options,
      profileDefinitionId: dataProfileDefinitions.id,
      profileDefinitionKey: dataProfileDefinitions.key,
      profileDefinitionName: dataProfileDefinitions.name,
    })
    .from(dataProfileFields)
    .innerJoin(
      customFieldDefinitions,
      and(
        eq(customFieldDefinitions.id, dataProfileFields.fieldId),
        eq(
          customFieldDefinitions.organizationId,
          dataProfileFields.organizationId,
        ),
      ),
    )
    .innerJoin(
      dataProfileDefinitions,
      and(
        eq(dataProfileDefinitions.id, dataProfileFields.profileDefinitionId),
        eq(
          dataProfileDefinitions.organizationId,
          dataProfileFields.organizationId,
        ),
      ),
    )
    .where(
      and(
        eq(dataProfileFields.organizationId, input.organizationId),
        eq(customFieldDefinitions.active, true),
        eq(dataProfileDefinitions.active, true),
      ),
    )
    .orderBy(
      asc(dataProfileDefinitions.sortOrder),
      asc(dataProfileDefinitions.name),
      asc(dataProfileFields.sortOrder),
      asc(customFieldDefinitions.label),
    );
  return rows.filter((field) =>
    canViewCustomField({
      viewerRole: input.viewer.role,
      viewerId: input.viewer.id,
      subjectUserId: "aggregate-subject",
      visibility: field.visibility,
    }),
  );
}

export async function getMemberPropertyAnalytics(input: {
  organizationId: string;
  viewer: Pick<User, "id" | "role">;
  query: Partial<MemberPropertyAnalyticsQuery>;
  revealMatchedMembers: boolean;
  matchedMemberLimit?: number;
  reader?: MemberPropertyReader;
}) {
  const reader = input.reader ?? db;
  const fields = await listMemberPropertyAnalyticsFields({
    organizationId: input.organizationId,
    viewer: input.viewer,
    reader,
  });
  const parsedQuery = memberPropertyAnalyticsQuerySchema.parse(input.query);
  const selectedField =
    fields.find(
      (field) =>
        field.id === parsedQuery.fieldId &&
        (!parsedQuery.profileDefinitionId ||
          field.profileDefinitionId === parsedQuery.profileDefinitionId),
    ) ?? fields[0] ?? null;
  if (!selectedField) {
    return {
      fields,
      query: parsedQuery,
      selectedField: null,
      totals: { members: 0, profiles: 0, values: 0, matchedMembers: 0 },
      distribution: [],
      matchedMembers: [],
      suppressed: false,
    };
  }
  const [memberRows, valueRows] = await Promise.all([
    reader
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, input.organizationId),
          eq(users.role, "member"),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName), asc(users.id)),
    reader
      .select({
        userId: dataProfileValues.userId,
        profileId: dataProfileValues.profileId,
        profileName: memberDataProfiles.name,
        value: dataProfileValues.value,
        updatedAt: dataProfileValues.updatedAt,
      })
      .from(dataProfileValues)
      .innerJoin(
        memberDataProfiles,
        and(
          eq(memberDataProfiles.id, dataProfileValues.profileId),
          eq(memberDataProfiles.userId, dataProfileValues.userId),
          eq(
            memberDataProfiles.organizationId,
            dataProfileValues.organizationId,
          ),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, dataProfileValues.userId),
          eq(users.organizationId, dataProfileValues.organizationId),
        ),
      )
      .where(
        and(
          eq(dataProfileValues.organizationId, input.organizationId),
          eq(dataProfileValues.fieldId, selectedField.id),
          eq(
            memberDataProfiles.definitionId,
            selectedField.profileDefinitionId,
          ),
          eq(memberDataProfiles.active, true),
          eq(users.role, "member"),
          eq(users.status, "active"),
        ),
      ),
  ]);
  const valuesByUser = new Map<string, typeof valueRows>();
  for (const row of valueRows) {
    const current = valuesByUser.get(row.userId) ?? [];
    current.push(row);
    valuesByUser.set(row.userId, current);
  }
  const matched = memberRows.filter((member) => {
    const entries = valuesByUser.get(member.id) ?? [];
    if (parsedQuery.operator === "is_not_set") {
      return (
        entries.length === 0 ||
        entries.every((entry) =>
          memberPropertyValueMatches({
            value: entry.value as CustomFieldValue,
            operator: "is_not_set",
          }),
        )
      );
    }
    if (parsedQuery.operator === "not_equals") {
      return (
        entries.length > 0 &&
        entries.every((entry) =>
          memberPropertyValueMatches({
            value: entry.value as CustomFieldValue,
            operator: parsedQuery.operator,
            expected: parsedQuery.value,
          }),
        )
      );
    }
    return entries.some((entry) =>
      memberPropertyValueMatches({
        value: entry.value as CustomFieldValue,
        operator: parsedQuery.operator,
        expected: parsedQuery.value,
      }),
    );
  });
  const buckets = new Map<
    string,
    { value: string; profiles: number; memberIds: Set<string> }
  >();
  for (const row of valueRows) {
    const rawValues = Array.isArray(row.value)
      ? row.value
      : [row.value as CustomFieldValue];
    for (const raw of rawValues) {
      const value = presentMemberPropertyValue(
        raw as CustomFieldValue,
        selectedField.type,
      );
      if (!value) continue;
      const bucket = buckets.get(value) ?? {
        value,
        profiles: 0,
        memberIds: new Set<string>(),
      };
      bucket.profiles += 1;
      bucket.memberIds.add(row.userId);
      buckets.set(value, bucket);
    }
  }
  const missingMemberIds = memberRows
    .filter((member) => !(valuesByUser.get(member.id) ?? []).length)
    .map((member) => member.id);
  if (missingMemberIds.length) {
    buckets.set("Nicht gepflegt", {
      value: "Nicht gepflegt",
      profiles: 0,
      memberIds: new Set(missingMemberIds),
    });
  }
  const suppressMatchedCohort =
    !input.revealMatchedMembers &&
    selectedField.visibility !== "member" &&
    matched.length > 0 &&
    matched.length < 3;
  const suppressPrivateBuckets =
    !input.revealMatchedMembers && selectedField.visibility !== "member";
  const privateBucketSuppressed =
    suppressPrivateBuckets &&
    [...buckets.values()].some(
      (bucket) => bucket.memberIds.size > 0 && bucket.memberIds.size < 3,
    );
  return {
    fields,
    query: {
      ...parsedQuery,
      fieldId: selectedField.id,
      profileDefinitionId: selectedField.profileDefinitionId,
    },
    selectedField,
    totals: {
      members: memberRows.length,
      profiles: new Set(valueRows.map((row) => row.profileId)).size,
      values: valueRows.length,
      matchedMembers: suppressMatchedCohort ? null : matched.length,
    },
    distribution: [...buckets.values()]
      .filter(
        (bucket) =>
          !suppressPrivateBuckets ||
          bucket.memberIds.size === 0 ||
          bucket.memberIds.size >= 3,
      )
      .map((bucket) => ({
        value: bucket.value,
        profiles: bucket.profiles,
        members: bucket.memberIds.size,
      }))
      .sort((left, right) =>
        (right.members ?? 0) - (left.members ?? 0) ||
        left.value.localeCompare(right.value, "de"),
      )
      .slice(0, 25),
    matchedMembers:
      input.revealMatchedMembers && !suppressMatchedCohort
        ? matched.slice(0, input.matchedMemberLimit ?? 200)
        : [],
    suppressed: suppressMatchedCohort || privateBucketSuppressed,
  };
}

export async function exportMemberPropertyCsv(input: {
  organizationId: string;
  viewer: Pick<User, "id" | "role">;
  query: Partial<MemberPropertyAnalyticsQuery>;
  locale?: AppLocale;
  reader?: MemberPropertyReader;
}) {
  const reader = input.reader ?? db;
  const analytics = await getMemberPropertyAnalytics({
    ...input,
    revealMatchedMembers: true,
    matchedMemberLimit: Number.MAX_SAFE_INTEGER,
    reader,
  });
  const technicalHeader = [
    "member_id",
    "email",
    "first_name",
    "last_name",
    "profile_definition",
    "profile",
    "field_key",
    "field_label",
    "value",
    "updated_at",
  ];
  const copy = input.locale ? getOperationsAdminCopy(input.locale) : null;
  const header = copy
    ? [
        copy("member.csv.memberId"),
        copy("member.csv.email"),
        copy("member.csv.firstName"),
        copy("member.csv.lastName"),
        copy("member.csv.profileDefinition"),
        copy("member.csv.profile"),
        copy("member.csv.fieldKey"),
        copy("member.csv.field"),
        copy("member.csv.value"),
        copy("member.csv.updatedAt"),
      ]
    : technicalHeader;
  if (!analytics.selectedField) {
    return input.locale
      ? `${header.map(csvCell).join(",")}\r\n`
      : "member_id,email,profile,value\r\n";
  }
  const memberIds = analytics.matchedMembers.map((member) => member.id);
  if (!memberIds.length) {
    return `${header.map(csvCell).join(",")}\r\n`;
  }
  const rows = await reader
    .select({
      userId: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      profileName: memberDataProfiles.name,
      value: dataProfileValues.value,
      updatedAt: dataProfileValues.updatedAt,
    })
    .from(dataProfileValues)
    .innerJoin(
      memberDataProfiles,
      and(
        eq(memberDataProfiles.id, dataProfileValues.profileId),
        eq(memberDataProfiles.userId, dataProfileValues.userId),
        eq(
          memberDataProfiles.organizationId,
          dataProfileValues.organizationId,
        ),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, dataProfileValues.userId),
        eq(users.organizationId, dataProfileValues.organizationId),
      ),
    )
    .where(
      and(
        eq(dataProfileValues.organizationId, input.organizationId),
        eq(dataProfileValues.fieldId, analytics.selectedField.id),
        eq(
          memberDataProfiles.definitionId,
          analytics.selectedField.profileDefinitionId,
        ),
        eq(memberDataProfiles.active, true),
        inArray(dataProfileValues.userId, memberIds),
      ),
    )
    .orderBy(asc(users.email), asc(memberDataProfiles.name));
  const rowsByMember = new Map<string, typeof rows>();
  for (const row of rows) {
    const current = rowsByMember.get(row.userId) ?? [];
    current.push(row);
    rowsByMember.set(row.userId, current);
  }
  type ExportRow = (typeof rows)[number] | {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    profileName: string;
    value: null;
    updatedAt: null;
  };
  const exportRows: ExportRow[] = [];
  for (const member of analytics.matchedMembers) {
    const valueRows = rowsByMember.get(member.id) ?? [];
    if (valueRows.length) {
      exportRows.push(...valueRows);
    } else {
      exportRows.push({
        userId: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        profileName: "",
        value: null,
        updatedAt: null,
      });
    }
  }
  return [
    header.map(csvCell).join(","),
    ...exportRows.map((row) =>
      [
        row.userId,
        row.email,
        row.firstName,
        row.lastName,
        analytics.selectedField!.profileDefinitionName,
        row.profileName,
        analytics.selectedField!.key,
        analytics.selectedField!.label,
        presentMemberPropertyValue(
          row.value as CustomFieldValue,
          analytics.selectedField!.type,
        ),
        row.updatedAt?.toISOString() ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n") + "\r\n";
}
