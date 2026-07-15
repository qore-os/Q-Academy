import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  communityProfileSettings,
  communityPublicProfileFields,
  customFieldDefinitions,
  dataProfileDefinitions,
  dataProfileFields,
  dataProfileValues,
  memberDataProfiles,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { safeAvatarSource } from "@/lib/avatar-policy";
import {
  visibleCommunityBadgesForUsers,
  type CommunityBadgeView,
} from "@/lib/community-badges";
import {
  isValidCustomFieldValue,
  type CustomFieldType,
  type CustomFieldValue,
} from "@/lib/custom-fields";
import { dataProfileMutationLockKey } from "@/lib/data-profile-lock";
import { presentMemberPropertyValue } from "@/lib/member-property-model";
import { assertCommunityManager } from "@/lib/community-management-auth";
import {
  communityProfileValueBatches,
  communityPublicAvatarSource,
  sanitizeCommunityPublicProfileValue,
} from "@/lib/community-public-profile-policy";

export {
  COMMUNITY_PROFILE_VALUE_BATCH_SIZE,
  communityProfileValueBatches,
  communityPublicAvatarSource,
  sanitizeCommunityPublicProfileValue,
} from "@/lib/community-public-profile-policy";

export const COMMUNITY_STANDARD_PROFILE_FIELDS = [
  "avatar",
  "job_title",
  "department",
  "bio",
  "community_points",
  "badges",
] as const;

export type CommunityStandardProfileField =
  (typeof COMMUNITY_STANDARD_PROFILE_FIELDS)[number];

export const COMMUNITY_STANDARD_PROFILE_FIELD_LABELS: Record<
  CommunityStandardProfileField,
  string
> = {
  avatar: "Profilbild",
  job_title: "Position",
  department: "Abteilung",
  bio: "Kurzprofil",
  community_points: "Community-Punkte",
  badges: "Badges",
};

const REQUIRED_STANDARD_FIELDS = new Set<CommunityStandardProfileField>([
  "avatar",
  "job_title",
  "department",
  "bio",
]);
const SAFE_CUSTOM_FIELD_TYPES = new Set<CustomFieldType>([
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
]);

export function isCommunityPublicCustomFieldType(type: CustomFieldType) {
  return SAFE_CUSTOM_FIELD_TYPES.has(type);
}

const STANDARD_FIELD_SET = new Set<string>(COMMUNITY_STANDARD_PROFILE_FIELDS);

type CommunityProfileTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
type CommunityProfileReader = Pick<typeof db, "select">;

export type CommunityPublicProfileFieldInput = {
  standardField?: CommunityStandardProfileField | null;
  customFieldId?: string | null;
  requiredForPosting?: boolean;
};

export type CommunityProfileCompletion = {
  complete: boolean;
  gateEnabled: boolean;
  revision: number;
  missingFields: Array<{ key: string; label: string }>;
  profileHref: string;
};

export type CommunityPublicProfileField =
  | {
      kind: "standard";
      key: CommunityStandardProfileField;
      label: string;
      value: string | number | CommunityBadgeView[] | null;
    }
  | {
      kind: "custom";
      id: string;
      key: string;
      label: string;
      type: CustomFieldType;
      value: string;
    };

export type CommunityPublicProfile = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  department: string | null;
  bio: string | null;
  communityPoints: number | null;
  badges: CommunityBadgeView[];
  customFields: Array<Extract<CommunityPublicProfileField, { kind: "custom" }>>;
  fields: CommunityPublicProfileField[];
};

function isSafeStandardField(
  value: string | null,
): value is CommunityStandardProfileField {
  return Boolean(value && STANDARD_FIELD_SET.has(value));
}

function standardComplete(
  field: CommunityStandardProfileField,
  user: {
    avatarUrl: string | null;
    jobTitle: string | null;
    department: string | null;
    bio: string | null;
  },
) {
  if (field === "avatar") return Boolean(safeAvatarSource(user.avatarUrl));
  if (field === "job_title") return Boolean(user.jobTitle?.trim());
  if (field === "department") return Boolean(user.department?.trim());
  if (field === "bio") return Boolean(user.bio?.trim());
  return true;
}

async function customFieldCatalog(
  organizationId: string,
  reader: CommunityProfileReader = db,
) {
  const rows = await reader
    .select({
      id: customFieldDefinitions.id,
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      type: customFieldDefinitions.type,
      options: customFieldDefinitions.options,
    })
    .from(dataProfileFields)
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
    .where(
      and(
        eq(dataProfileFields.organizationId, organizationId),
        eq(dataProfileDefinitions.active, true),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
      ),
    )
    .orderBy(
      asc(dataProfileFields.sortOrder),
      asc(customFieldDefinitions.label),
    );
  return [
    ...new Map(
      rows
        .filter((field) => isCommunityPublicCustomFieldType(field.type))
        .map((field) => [field.id, field]),
    ).values(),
  ];
}

async function defaultProfileValues(input: {
  organizationId: string;
  userId: string;
  fieldIds: readonly string[];
  reader?: CommunityProfileReader;
}) {
  if (!input.fieldIds.length) return new Map<string, CustomFieldValue>();
  const reader = input.reader ?? db;
  const [profile] = await reader
    .select({
      id: memberDataProfiles.id,
      definitionId: memberDataProfiles.definitionId,
    })
    .from(memberDataProfiles)
    .innerJoin(
      dataProfileDefinitions,
      and(
        eq(dataProfileDefinitions.id, memberDataProfiles.definitionId),
        eq(
          dataProfileDefinitions.organizationId,
          memberDataProfiles.organizationId,
        ),
        eq(dataProfileDefinitions.active, true),
      ),
    )
    .where(
      and(
        eq(memberDataProfiles.organizationId, input.organizationId),
        eq(memberDataProfiles.userId, input.userId),
        eq(memberDataProfiles.isDefault, true),
        eq(memberDataProfiles.active, true),
      ),
    )
    .limit(1);
  if (!profile) return new Map<string, CustomFieldValue>();
  const values = await reader
    .select({
      fieldId: dataProfileValues.fieldId,
      value: dataProfileValues.value,
    })
    .from(dataProfileValues)
    .innerJoin(
      dataProfileFields,
      and(
        eq(dataProfileFields.organizationId, dataProfileValues.organizationId),
        eq(dataProfileFields.profileDefinitionId, profile.definitionId),
        eq(dataProfileFields.fieldId, dataProfileValues.fieldId),
      ),
    )
    .where(
      and(
        eq(dataProfileValues.organizationId, input.organizationId),
        eq(dataProfileValues.userId, input.userId),
        eq(dataProfileValues.profileId, profile.id),
        inArray(dataProfileValues.fieldId, [...input.fieldIds]),
      ),
    );
  return new Map(
    values.map((value) => [value.fieldId, value.value as CustomFieldValue]),
  );
}

async function defaultProfileValuesForUsers(input: {
  organizationId: string;
  userIds: readonly string[];
  fieldIds: readonly string[];
  reader?: CommunityProfileReader;
}) {
  const userIds = [...new Set(input.userIds)];
  const fieldIds = [...new Set(input.fieldIds)];
  const result = new Map<string, Map<string, CustomFieldValue>>();
  if (!userIds.length || !fieldIds.length) return result;
  const reader = input.reader ?? db;
  const values = await reader
    .select({
      userId: dataProfileValues.userId,
      fieldId: dataProfileValues.fieldId,
      value: dataProfileValues.value,
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
        eq(memberDataProfiles.isDefault, true),
        eq(memberDataProfiles.active, true),
      ),
    )
    .innerJoin(
      dataProfileDefinitions,
      and(
        eq(dataProfileDefinitions.id, memberDataProfiles.definitionId),
        eq(
          dataProfileDefinitions.organizationId,
          memberDataProfiles.organizationId,
        ),
        eq(dataProfileDefinitions.active, true),
      ),
    )
    .innerJoin(
      dataProfileFields,
      and(
        eq(dataProfileFields.organizationId, dataProfileValues.organizationId),
        eq(
          dataProfileFields.profileDefinitionId,
          memberDataProfiles.definitionId,
        ),
        eq(dataProfileFields.fieldId, dataProfileValues.fieldId),
      ),
    )
    .where(
      and(
        eq(dataProfileValues.organizationId, input.organizationId),
        inArray(dataProfileValues.userId, userIds),
        inArray(dataProfileValues.fieldId, fieldIds),
      ),
    );
  for (const value of values) {
    const memberValues = result.get(value.userId) ?? new Map();
    memberValues.set(value.fieldId, value.value as CustomFieldValue);
    result.set(value.userId, memberValues);
  }
  return result;
}

async function communityProfileImpact(input: {
  organizationId: string;
  fields: Awaited<ReturnType<typeof profileConfiguration>>["fields"];
  reader?: CommunityProfileReader;
}) {
  const reader = input.reader ?? db;
  const members = await reader
    .select({
      id: users.id,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      department: users.department,
      bio: users.bio,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    );
  const requiredFields = input.fields.filter(
    (field) => field.requiredForPosting,
  );
  if (!requiredFields.length) {
    return {
      activeMemberCount: members.length,
      incompleteActiveMemberCount: 0,
    };
  }
  const catalog = await customFieldCatalog(input.organizationId, reader);
  const catalogById = new Map(catalog.map((field) => [field.id, field]));
  const customIds = requiredFields.flatMap((field) =>
    field.customFieldId ? [field.customFieldId] : [],
  );
  const valuesByUser = new Map<string, Map<string, CustomFieldValue>>();
  for (const userIds of communityProfileValueBatches(
    members.map((member) => member.id),
  )) {
    const batchValues = await defaultProfileValuesForUsers({
      organizationId: input.organizationId,
      userIds,
      fieldIds: customIds,
      reader,
    });
    for (const [userId, values] of batchValues) {
      valuesByUser.set(userId, values);
    }
  }
  const incompleteActiveMemberCount = members.filter((member) => {
    const values = valuesByUser.get(member.id) ?? new Map();
    return requiredFields.some((field) => {
      if (field.standardField !== null) {
        return (
          !isSafeStandardField(field.standardField) ||
          !REQUIRED_STANDARD_FIELDS.has(field.standardField) ||
          !standardComplete(field.standardField, member)
        );
      }
      if (!field.customFieldId) return true;
      const definition = catalogById.get(field.customFieldId);
      return (
        !definition ||
        !isValidCustomFieldValue(
          {
            type: definition.type,
            required: true,
            options: definition.options,
          },
          values.get(field.customFieldId) ?? null,
        )
      );
    });
  }).length;
  return { activeMemberCount: members.length, incompleteActiveMemberCount };
}

async function profileConfiguration(
  organizationId: string,
  reader: CommunityProfileReader = db,
) {
  const [settingRows, fieldRows] = await Promise.all([
    reader
      .select()
      .from(communityProfileSettings)
      .where(eq(communityProfileSettings.organizationId, organizationId))
      .limit(1),
    reader
      .select()
      .from(communityPublicProfileFields)
      .where(
        eq(communityPublicProfileFields.organizationId, organizationId),
      )
      .orderBy(
        asc(communityPublicProfileFields.sortOrder),
        asc(communityPublicProfileFields.id),
      ),
  ]);
  return {
    settings: settingRows[0] ?? null,
    fields: fieldRows,
  };
}

async function evaluateCommunityProfileCompletion(input: {
  organizationId: string;
  userId: string;
  reader?: CommunityProfileReader;
  lockUser?: boolean;
}): Promise<CommunityProfileCompletion> {
  const reader = input.reader ?? db;
  const configuration = await profileConfiguration(
    input.organizationId,
    reader,
  );
  if (!configuration.settings?.completionGateEnabled) {
    return {
      complete: true,
      gateEnabled: false,
      revision: configuration.settings?.revision ?? 0,
      missingFields: [],
      profileHref: "/academy/profile?community=required",
    };
  }
  const userQuery = reader
    .select({
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      department: users.department,
      bio: users.bio,
    })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  const [user] = input.lockUser
    ? await userQuery.for("share", { of: users })
    : await userQuery;
  if (!user) {
    throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
  }
  const requiredRows = configuration.fields.filter(
    (field) => field.requiredForPosting,
  );
  if (requiredRows.length === 0) {
    return {
      complete: false,
      gateEnabled: true,
      revision: configuration.settings.revision,
      missingFields: [
        {
          key: "profile_configuration",
          label: "Nicht verfuegbare Profilanforderung",
        },
      ],
      profileHref: "/academy/profile?community=required",
    };
  }
  const catalog = await customFieldCatalog(input.organizationId, reader);
  const catalogById = new Map(catalog.map((field) => [field.id, field]));
  const customIds = requiredRows.flatMap((field) =>
    field.customFieldId ? [field.customFieldId] : [],
  );
  const values = await defaultProfileValues({
    organizationId: input.organizationId,
    userId: input.userId,
    fieldIds: customIds,
    reader,
  });
  const missingFields: CommunityProfileCompletion["missingFields"] = [];
  for (const field of requiredRows) {
    if (field.standardField !== null) {
      if (
        !isSafeStandardField(field.standardField) ||
        !REQUIRED_STANDARD_FIELDS.has(field.standardField) ||
        !standardComplete(field.standardField, user)
      ) {
        missingFields.push({
          key: field.standardField ?? field.id,
          label: isSafeStandardField(field.standardField)
            ? COMMUNITY_STANDARD_PROFILE_FIELD_LABELS[field.standardField]
            : "Nicht verfuegbare Profilanforderung",
        });
      }
      continue;
    }
    if (!field.customFieldId) {
      missingFields.push({
        key: field.id,
        label: "Nicht verfuegbare Profilanforderung",
      });
      continue;
    }
    const definition = catalogById.get(field.customFieldId);
    const value = values.get(field.customFieldId) ?? null;
    if (
      !definition ||
      !isValidCustomFieldValue(
        {
          type: definition.type,
          required: true,
          options: definition.options,
        },
        value,
      )
    ) {
      missingFields.push({
        key: definition?.key ?? field.id,
        label: definition?.label ?? "Nicht verfuegbare Profilanforderung",
      });
    }
  }
  return {
    complete: missingFields.length === 0,
    gateEnabled: true,
    revision: configuration.settings.revision,
    missingFields,
    profileHref: "/academy/profile?community=required",
  };
}

export async function getOwnCommunityProfileCompletion(input: {
  organizationId: string;
  userId: string;
}) {
  return evaluateCommunityProfileCompletion(input);
}

export async function assertCommunityProfileComplete(
  tx: CommunityProfileTransaction,
  input: { organizationId: string; userId: string },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`community-profile-config:${input.organizationId}`}))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${dataProfileMutationLockKey(input.organizationId, input.userId)}))`,
  );
  const result = await evaluateCommunityProfileCompletion({
    ...input,
    reader: tx,
    lockUser: true,
  });
  if (!result.complete) {
    throw new ApiError(
      422,
      "profile_incomplete",
      "Vervollstaendige zuerst dein Community-Profil.",
      {
        missingFields: result.missingFields,
        profileHref: result.profileHref,
        revision: result.revision,
      },
    );
  }
  return result;
}

export async function getCommunityPublicProfiles(input: {
  organizationId: string;
  memberIds: readonly string[];
  locale?: string;
  downloadContext?: "session" | "api";
}) {
  const memberIds = [...new Set(input.memberIds)];
  const result = new Map<string, CommunityPublicProfile>();
  if (!memberIds.length) return result;
  const members = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
      jobTitle: users.jobTitle,
      department: users.department,
      bio: users.bio,
      communityPoints: users.communityPoints,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        inArray(users.id, memberIds),
        eq(users.status, "active"),
      ),
    );
  const [configuration, catalog] = await Promise.all([
    profileConfiguration(input.organizationId),
    customFieldCatalog(input.organizationId),
  ]);
  const safeStandardFields = new Set(
    configuration.fields.flatMap((field) =>
      isSafeStandardField(field.standardField) ? [field.standardField] : [],
    ),
  );
  const catalogById = new Map(catalog.map((field) => [field.id, field]));
  const selectedCustomRows = configuration.fields.filter(
    (field) =>
      field.customFieldId !== null && catalogById.has(field.customFieldId),
  );
  const valuesByUser = await defaultProfileValuesForUsers({
    organizationId: input.organizationId,
    userIds: members.map((member) => member.id),
    fieldIds: selectedCustomRows.flatMap((field) =>
      field.customFieldId ? [field.customFieldId] : [],
    ),
  });
  const badgesByUser = safeStandardFields.has("badges")
    ? await visibleCommunityBadgesForUsers({
        organizationId: input.organizationId,
        userIds: members.map((member) => member.id),
      })
    : new Map<string, CommunityBadgeView[]>();
  for (const member of members) {
    const avatarUrl = safeStandardFields.has("avatar")
      ? communityPublicAvatarSource(member.avatarUrl, input.downloadContext)
      : null;
    const jobTitle = safeStandardFields.has("job_title")
      ? member.jobTitle?.trim() || null
      : null;
    const department = safeStandardFields.has("department")
      ? member.department?.trim() || null
      : null;
    const bio = safeStandardFields.has("bio")
      ? member.bio?.trim() || null
      : null;
    const communityPoints = safeStandardFields.has("community_points")
      ? member.communityPoints
      : null;
    const badges = badgesByUser.get(member.id) ?? [];
    const memberValues = valuesByUser.get(member.id) ?? new Map();
    const fields: CommunityPublicProfileField[] = [];
    for (const setting of configuration.fields) {
      if (isSafeStandardField(setting.standardField)) {
        const key = setting.standardField;
        const value =
          key === "avatar"
            ? avatarUrl
            : key === "job_title"
              ? jobTitle
              : key === "department"
                ? department
                : key === "bio"
                  ? bio
                  : key === "community_points"
                    ? communityPoints
                    : badges;
        fields.push({
          kind: "standard",
          key,
          label: COMMUNITY_STANDARD_PROFILE_FIELD_LABELS[key],
          value,
        });
        continue;
      }
      if (!setting.customFieldId) continue;
      const definition = catalogById.get(setting.customFieldId);
      if (!definition || !isCommunityPublicCustomFieldType(definition.type)) {
        continue;
      }
      const value = memberValues.get(definition.id) ?? null;
      if (
        value !== null &&
        !isValidCustomFieldValue(
          {
            type: definition.type,
            required: false,
            options: definition.options,
          },
          value,
        )
      ) {
        continue;
      }
      fields.push({
        kind: "custom",
        id: definition.id,
        key: definition.key,
        label: definition.label,
        type: definition.type,
        value: sanitizeCommunityPublicProfileValue(
          presentMemberPropertyValue(value, definition.type, input.locale),
        ),
      });
    }
    result.set(member.id, {
      id: member.id,
      firstName: member.firstName,
      lastName: member.lastName,
      avatarUrl,
      jobTitle,
      department,
      bio,
      communityPoints,
      badges,
      customFields: fields.filter(
        (
          field,
        ): field is Extract<
          CommunityPublicProfileField,
          { kind: "custom" }
        > => field.kind === "custom",
      ),
      fields,
    });
  }
  return result;
}

export async function getCommunityPublicProfile(input: {
  organizationId: string;
  memberId: string;
  locale?: string;
  downloadContext?: "session" | "api";
}) {
  const profiles = await getCommunityPublicProfiles({
    organizationId: input.organizationId,
    memberIds: [input.memberId],
    locale: input.locale,
    downloadContext: input.downloadContext,
  });
  const profile = profiles.get(input.memberId);
  if (!profile) {
    throw new ApiError(404, "not_found", "Community-Profil nicht gefunden.");
  }
  return profile;
}

export async function getCommunityProfileSettingsAdminData(
  organizationId: string,
) {
  const [configuration, catalog] = await Promise.all([
    profileConfiguration(organizationId),
    customFieldCatalog(organizationId),
  ]);
  const impact = await communityProfileImpact({
    organizationId,
    fields: configuration.fields,
  });
  return {
    settings: configuration.settings ?? {
      organizationId,
      completionGateEnabled: false,
      revision: 0,
      updatedAt: new Date(0),
    },
    fields: configuration.fields,
    customFieldCatalog: catalog,
    ...impact,
  };
}

export async function replaceCommunityProfileSettings(input: {
  organizationId: string;
  actorId: string;
  expectedRevision: number;
  completionGateEnabled: boolean;
  fields: CommunityPublicProfileFieldInput[];
}) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`community-profile-config:${input.organizationId}`}))`,
    );
    await assertCommunityManager(tx, input);
    const [current] = await tx
      .select()
      .from(communityProfileSettings)
      .where(
        eq(communityProfileSettings.organizationId, input.organizationId),
      )
      .limit(1)
      .for("update", { of: communityProfileSettings });
    const revision = current?.revision ?? 0;
    if (revision !== input.expectedRevision) {
      throw new ApiError(
        409,
        "conflict",
        "Die Community-Profilkonfiguration wurde zwischenzeitlich geaendert.",
      );
    }
    const standards = new Set<string>();
    const customs = new Set<string>();
    for (const field of input.fields) {
      const standard = field.standardField ?? null;
      const custom = field.customFieldId ?? null;
      if (Boolean(standard) === Boolean(custom)) {
        throw new ApiError(
          422,
          "validation_error",
          "Jedes oeffentliche Profilfeld benoetigt genau eine Quelle.",
        );
      }
      if (standard) {
        if (!isSafeStandardField(standard) || standards.has(standard)) {
          throw new ApiError(
            422,
            "validation_error",
            "Ein Standard-Profilfeld ist ungueltig oder doppelt.",
          );
        }
        if (field.requiredForPosting && !REQUIRED_STANDARD_FIELDS.has(standard)) {
          throw new ApiError(
            422,
            "validation_error",
            "Dieses Standardfeld kann nicht als Pflichtfeld verwendet werden.",
          );
        }
        standards.add(standard);
      } else if (custom) {
        if (customs.has(custom)) {
          throw new ApiError(
            422,
            "validation_error",
            "Ein Custom Field wurde mehrfach ausgewaehlt.",
          );
        }
        customs.add(custom);
      }
    }
    const catalog = await customFieldCatalog(input.organizationId, tx);
    const allowedCustomIds = new Set(catalog.map((field) => field.id));
    const disallowedCustom = [...customs].find(
      (fieldId) => !allowedCustomIds.has(fieldId),
    );
    if (disallowedCustom) {
      throw new ApiError(
        422,
        "validation_error",
        "Ein Custom Field ist fuer oeffentliche Community-Profile nicht freigegeben.",
      );
    }
    if (
      input.completionGateEnabled &&
      !input.fields.some((field) => field.requiredForPosting)
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Aktiviere mindestens ein Pflichtfeld, bevor das Completion-Gate eingeschaltet wird.",
      );
    }
    const nextRevision = revision + 1;
    await tx
      .insert(communityProfileSettings)
      .values({
        organizationId: input.organizationId,
        completionGateEnabled: input.completionGateEnabled,
        revision: nextRevision,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: communityProfileSettings.organizationId,
        set: {
          completionGateEnabled: input.completionGateEnabled,
          revision: nextRevision,
          updatedAt: new Date(),
        },
      });
    await tx
      .delete(communityPublicProfileFields)
      .where(
        eq(communityPublicProfileFields.organizationId, input.organizationId),
      );
    if (input.fields.length) {
      await tx.insert(communityPublicProfileFields).values(
        input.fields.map((field, sortOrder) => ({
          organizationId: input.organizationId,
          standardField: field.standardField ?? null,
          customFieldId: field.customFieldId ?? null,
          requiredForPosting: field.requiredForPosting ?? false,
          sortOrder,
        })),
      );
    }
    const savedConfiguration = await profileConfiguration(
      input.organizationId,
      tx,
    );
    const impact = await communityProfileImpact({
      organizationId: input.organizationId,
      fields: savedConfiguration.fields,
      reader: tx,
    });
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorId,
      type: "community_profile_settings.updated",
      entityType: "community_profile_settings",
      entityId: input.organizationId,
      metadata: {
        revision: nextRevision,
        completionGateEnabled: input.completionGateEnabled,
        fieldCount: input.fields.length,
        requiredCount: input.fields.filter((field) => field.requiredForPosting)
          .length,
        activeMemberCount: impact.activeMemberCount,
        incompleteActiveMemberCount: impact.incompleteActiveMemberCount,
      },
    });
  });
  return getCommunityProfileSettingsAdminData(input.organizationId);
}
