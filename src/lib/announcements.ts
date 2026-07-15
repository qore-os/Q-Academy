import "server-only";

import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
} from "drizzle-orm";
import { db } from "@/db";
import {
  announcementDismissals,
  announcementInteractions,
  announcements,
  bundles,
  courseAccessGrants,
  courses,
  enrollments,
  groupBundles,
  groupMembers,
  groups,
  memberBundles,
  users,
} from "@/db/schema";
import {
  announcementTargetRuleSetSchema,
  matchesAnnouncementTargetRules,
  type AnnouncementAudienceContext,
  type AnnouncementTargetRuleSet,
} from "@/lib/announcement-rules";
import { ApiError } from "@/lib/api/errors";
import { resolveMemberPropertyVariables } from "@/lib/member-properties";
import { renderPersonalizedTemplateText } from "@/lib/member-property-model";
import {
  normalizeAnnouncementContent,
  personalizeAnnouncementContent,
} from "@/lib/announcement-content";

export type AnnouncementAudience = "all" | "user" | "group";
export type AnnouncementInteractionKind = "impression" | "click" | "dismiss";

type AudienceMember = {
  id: string;
  firstName: string;
  lastName: string;
  role: AnnouncementAudienceContext["role"];
};

type LoadedAudience = {
  members: AudienceMember[];
  contexts: Map<string, AnnouncementAudienceContext>;
};

type AudienceReferences = {
  groupIds: string[];
  bundleIds: string[];
  courseIds: string[];
};

function collectAudienceReferences(
  values: unknown[],
  baseGroupIds: Array<string | null | undefined> = [],
): AudienceReferences {
  const groupIds = new Set(baseGroupIds.filter((id): id is string => Boolean(id)));
  const bundleIds = new Set<string>();
  const courseIds = new Set<string>();
  for (const value of values) {
    const parsed = announcementTargetRuleSetSchema.safeParse(value);
    if (!parsed.success) continue;
    for (const rule of parsed.data.conditions) {
      if (rule.type === "group") groupIds.add(rule.groupId);
      if (rule.type === "bundle") bundleIds.add(rule.bundleId);
      if (rule.type === "course_access" || rule.type === "course_progress") {
        courseIds.add(rule.courseId);
      }
    }
  }
  return {
    groupIds: [...groupIds],
    bundleIds: [...bundleIds],
    courseIds: [...courseIds],
  };
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const values = map.get(key) ?? new Set<string>();
  values.add(value);
  map.set(key, values);
}

async function loadAnnouncementAudience(
  organizationId: string,
  requestedUserIds?: string[],
  references: AudienceReferences = {
    groupIds: [],
    bundleIds: [],
    courseIds: [],
  },
): Promise<LoadedAudience> {
  const userIds = requestedUserIds ? [...new Set(requestedUserIds)] : null;
  if (userIds?.length === 0) return { members: [], contexts: new Map() };
  const memberConditions = [
    eq(users.organizationId, organizationId),
    eq(users.status, "active"),
  ];
  if (userIds) memberConditions.push(inArray(users.id, userIds));
  const members = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(and(...memberConditions));
  if (!members.length) return { members: [], contexts: new Map() };

  const activeUserIds = members.map((member) => member.id);
  const [
    knownGroupRows,
    knownBundleRows,
    knownCourseRows,
    groupRows,
    directBundleRows,
    groupBundleRows,
    accessRows,
    progressRows,
  ] =
    await Promise.all([
      references.groupIds.length
        ? db
            .select({ id: groups.id })
            .from(groups)
            .where(
              and(
                eq(groups.organizationId, organizationId),
                inArray(groups.id, references.groupIds),
              ),
            )
        : [],
      references.bundleIds.length
        ? db
            .select({ id: bundles.id })
            .from(bundles)
            .where(
              and(
                eq(bundles.organizationId, organizationId),
                inArray(bundles.id, references.bundleIds),
              ),
            )
        : [],
      references.courseIds.length
        ? db
            .select({ id: courses.id })
            .from(courses)
            .where(
              and(
                eq(courses.organizationId, organizationId),
                inArray(courses.id, references.courseIds),
              ),
            )
        : [],
      references.groupIds.length
        ? db
        .select({ userId: groupMembers.userId, groupId: groupMembers.groupId })
        .from(groupMembers)
        .innerJoin(
          groups,
          and(
            eq(groups.id, groupMembers.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, groupMembers.userId),
            eq(users.organizationId, organizationId),
          ),
        )
        .where(
          and(
            inArray(groupMembers.userId, activeUserIds),
            inArray(groupMembers.groupId, references.groupIds),
          ),
        )
        : [],
      references.bundleIds.length
        ? db
        .select({ userId: memberBundles.userId, bundleId: memberBundles.bundleId })
        .from(memberBundles)
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, memberBundles.bundleId),
            eq(bundles.organizationId, organizationId),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, memberBundles.userId),
            eq(users.organizationId, organizationId),
          ),
        )
        .where(
          and(
            inArray(memberBundles.userId, activeUserIds),
            inArray(memberBundles.bundleId, references.bundleIds),
          ),
        )
        : [],
      references.bundleIds.length
        ? db
        .select({ userId: groupMembers.userId, bundleId: groupBundles.bundleId })
        .from(groupMembers)
        .innerJoin(
          groups,
          and(
            eq(groups.id, groupMembers.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .innerJoin(groupBundles, eq(groupBundles.groupId, groups.id))
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, groupBundles.bundleId),
            eq(bundles.organizationId, organizationId),
          ),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, groupMembers.userId),
            eq(users.organizationId, organizationId),
          ),
        )
        .where(
          and(
            inArray(groupMembers.userId, activeUserIds),
            inArray(groupBundles.bundleId, references.bundleIds),
          ),
        )
        : [],
      references.courseIds.length
        ? db
        .select({
          userId: courseAccessGrants.userId,
          courseId: courseAccessGrants.courseId,
        })
        .from(courseAccessGrants)
        .where(
          and(
            eq(courseAccessGrants.organizationId, organizationId),
            inArray(courseAccessGrants.userId, activeUserIds),
            inArray(courseAccessGrants.courseId, references.courseIds),
          ),
        )
        : [],
      references.courseIds.length
        ? db
        .select({
          userId: enrollments.userId,
          courseId: enrollments.courseId,
          progress: enrollments.progress,
        })
        .from(enrollments)
        .innerJoin(
          users,
          and(
            eq(users.id, enrollments.userId),
            eq(users.organizationId, organizationId),
          ),
        )
        .innerJoin(
          courses,
          and(
            eq(courses.id, enrollments.courseId),
            eq(courses.organizationId, organizationId),
          ),
        )
        .where(
          and(
            inArray(enrollments.userId, activeUserIds),
            inArray(enrollments.courseId, references.courseIds),
          ),
        )
        : [],
    ]);

  const groupsByUser = new Map<string, Set<string>>();
  const bundlesByUser = new Map<string, Set<string>>();
  const accessByUser = new Map<string, Set<string>>();
  const progressByUser = new Map<string, Map<string, number>>();
  const knownGroupIds = new Set(knownGroupRows.map((row) => row.id));
  const knownBundleIds = new Set(knownBundleRows.map((row) => row.id));
  const knownCourseIds = new Set(knownCourseRows.map((row) => row.id));
  for (const row of groupRows) addToSetMap(groupsByUser, row.userId, row.groupId);
  for (const row of [...directBundleRows, ...groupBundleRows]) {
    addToSetMap(bundlesByUser, row.userId, row.bundleId);
  }
  for (const row of accessRows) addToSetMap(accessByUser, row.userId, row.courseId);
  for (const row of progressRows) {
    const progress = progressByUser.get(row.userId) ?? new Map<string, number>();
    progress.set(row.courseId, row.progress);
    progressByUser.set(row.userId, progress);
  }

  return {
    members,
    contexts: new Map(
      members.map((member) => [
        member.id,
        {
          role: member.role,
          knownGroupIds,
          knownBundleIds,
          knownCourseIds,
          groupIds: groupsByUser.get(member.id) ?? new Set<string>(),
          bundleIds: bundlesByUser.get(member.id) ?? new Set<string>(),
          courseAccessIds: accessByUser.get(member.id) ?? new Set<string>(),
          courseProgress:
            progressByUser.get(member.id) ?? new Map<string, number>(),
        },
      ]),
    ),
  };
}

function matchesBaseAudience(
  audience: string,
  audienceId: string | null,
  userId: string,
  context: AnnouncementAudienceContext,
) {
  if (audience === "all") return true;
  if (audience === "user") return audienceId === userId;
  return audience === "group" && Boolean(audienceId && context.groupIds.has(audienceId));
}

function matchesRuleSet(
  value: unknown,
  context: AnnouncementAudienceContext,
) {
  const parsed = announcementTargetRuleSetSchema.safeParse(value);
  return parsed.success && matchesAnnouncementTargetRules(parsed.data, context);
}

export async function assertAnnouncementAudience(
  organizationId: string,
  audience: AnnouncementAudience,
  audienceId: string | null | undefined,
) {
  if (audience === "all") {
    if (audienceId) {
      throw new ApiError(
        422,
        "validation_error",
        "Die Zielgruppe Alle verwendet keine audienceId.",
      );
    }
    return;
  }
  if (!audienceId) {
    throw new ApiError(
      422,
      "validation_error",
      "Die gewaehlte Zielgruppe benoetigt eine audienceId.",
    );
  }
  const table = audience === "user" ? users : groups;
  const [target] = await db
    .select({ id: table.id })
    .from(table)
    .where(
      and(eq(table.id, audienceId), eq(table.organizationId, organizationId)),
    )
    .limit(1);
  if (!target) {
    throw new ApiError(
      404,
      "not_found",
      "Die Zielgruppe wurde nicht gefunden.",
    );
  }
}

export async function assertAnnouncementTargetRuleSetTargets(
  organizationId: string,
  ruleSet: AnnouncementTargetRuleSet,
) {
  const groupIds = [
    ...new Set(
      ruleSet.conditions.flatMap((rule) =>
        rule.type === "group" ? [rule.groupId] : [],
      ),
    ),
  ];
  const bundleIds = [
    ...new Set(
      ruleSet.conditions.flatMap((rule) =>
        rule.type === "bundle" ? [rule.bundleId] : [],
      ),
    ),
  ];
  const courseIds = [
    ...new Set(
      ruleSet.conditions.flatMap((rule) =>
        rule.type === "course_access" || rule.type === "course_progress"
          ? [rule.courseId]
          : [],
      ),
    ),
  ];
  const [groupRows, bundleRows, courseRows] = await Promise.all([
    groupIds.length
      ? db
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, organizationId),
              inArray(groups.id, groupIds),
            ),
          )
      : [],
    bundleIds.length
      ? db
          .select({ id: bundles.id })
          .from(bundles)
          .where(
            and(
              eq(bundles.organizationId, organizationId),
              inArray(bundles.id, bundleIds),
            ),
          )
      : [],
    courseIds.length
      ? db
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, organizationId),
              inArray(courses.id, courseIds),
            ),
          )
      : [],
  ]);
  if (
    groupRows.length !== groupIds.length ||
    bundleRows.length !== bundleIds.length ||
    courseRows.length !== courseIds.length
  ) {
    throw new ApiError(
      404,
      "not_found",
      "Mindestens ein Zielgruppenbezug wurde nicht gefunden.",
    );
  }
}

export async function previewAnnouncementAudience(input: {
  organizationId: string;
  audience: AnnouncementAudience;
  audienceId: string | null;
  targetRuleSet: AnnouncementTargetRuleSet;
  sampleLimit?: number;
}) {
  await Promise.all([
    assertAnnouncementAudience(
      input.organizationId,
      input.audience,
      input.audienceId,
    ),
    assertAnnouncementTargetRuleSetTargets(
      input.organizationId,
      input.targetRuleSet,
    ),
  ]);
  const audience = await loadAnnouncementAudience(
    input.organizationId,
    undefined,
    collectAudienceReferences(
      [input.targetRuleSet],
      input.audience === "group" ? [input.audienceId] : [],
    ),
  );
  const matching = audience.members.filter((member) => {
    const context = audience.contexts.get(member.id)!;
    return (
      matchesBaseAudience(input.audience, input.audienceId, member.id, context) &&
      matchesAnnouncementTargetRules(input.targetRuleSet, context)
    );
  });
  return {
    count: matching.length,
    sample: matching.slice(0, input.sampleLimit ?? 5).map((member) => ({
      id: member.id,
      label: `${member.firstName} ${member.lastName}`,
      role: member.role,
    })),
  };
}

export function validateAnnouncementConfiguration(input: {
  startsAt: Date;
  endsAt: Date | null;
  href: string | null;
  actionLabel: string | null;
  placement: string;
  dismissible: boolean;
}) {
  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Enddatum muss nach dem Startdatum liegen.",
    );
  }
  if (input.actionLabel && !input.href) {
    throw new ApiError(
      422,
      "validation_error",
      "Eine Aktionsbeschriftung benoetigt einen Link.",
    );
  }
  if (input.placement === "modal" && !input.dismissible && !input.href) {
    throw new ApiError(
      422,
      "validation_error",
      "Ein nicht schliessbares Modal benoetigt eine Aktion.",
    );
  }
}

export async function getAnnouncementForOrganization(
  id: string,
  organizationId: string,
) {
  const [announcement] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.id, id),
        eq(announcements.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!announcement) {
    throw new ApiError(404, "not_found", "Ankuendigung nicht gefunden.");
  }
  return announcement;
}

export async function getActiveAnnouncementsForUser(
  userId: string,
  organizationId: string,
) {
  const now = new Date();
  const rows = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.organizationId, organizationId),
        eq(announcements.active, true),
        lte(announcements.startsAt, now),
        or(isNull(announcements.endsAt), gt(announcements.endsAt, now)),
        notExists(
          db
            .select({ announcementId: announcementDismissals.announcementId })
            .from(announcementDismissals)
            .where(
              and(
                eq(announcementDismissals.announcementId, announcements.id),
                eq(announcementDismissals.userId, userId),
              ),
            ),
        ),
        or(
          eq(announcements.audience, "all"),
          and(
            eq(announcements.audience, "user"),
            eq(announcements.audienceId, userId),
          ),
          and(
            eq(announcements.audience, "group"),
            exists(
              db
                .select({ userId: groupMembers.userId })
                .from(groupMembers)
                .where(
                  and(
                    eq(groupMembers.groupId, announcements.audienceId),
                    eq(groupMembers.userId, userId),
                  ),
                ),
            ),
          ),
        ),
      ),
    )
    .orderBy(asc(announcements.startsAt), asc(announcements.createdAt));
  if (!rows.length) return rows;
  const audience = await loadAnnouncementAudience(
    organizationId,
    [userId],
    collectAudienceReferences(
      rows.map((announcement) => announcement.targetRuleSet),
      rows
        .filter((announcement) => announcement.audience === "group")
        .map((announcement) => announcement.audienceId),
    ),
  );
  const context = audience.contexts.get(userId);
  if (!context) return [];
  const visibleRows = rows.filter(
    (announcement) =>
      matchesBaseAudience(
        announcement.audience,
        announcement.audienceId,
        userId,
        context,
      ) && matchesRuleSet(announcement.targetRuleSet, context),
  );
  const member = audience.members.find((entry) => entry.id === userId);
  if (!member) return [];
  const properties = await resolveMemberPropertyVariables({
    organizationId,
    userId,
  });
  const variables = {
    "member.firstName": member.firstName,
    "member.lastName": member.lastName,
    "member.fullName": `${member.firstName} ${member.lastName}`.trim(),
    ...properties.text,
  };
  return visibleRows.map((announcement) => ({
    ...announcement,
    title: renderPersonalizedTemplateText(announcement.title, variables),
    body: renderPersonalizedTemplateText(announcement.body, variables),
    actionLabel: announcement.actionLabel
      ? renderPersonalizedTemplateText(announcement.actionLabel, variables)
      : null,
    contentDocument: personalizeAnnouncementContent(
      normalizeAnnouncementContent(announcement),
      variables,
    ),
  }));
}

export async function recordAnnouncementInteractions(input: {
  userId: string;
  organizationId: string;
  announcementIds: string[];
  kind: Exclude<AnnouncementInteractionKind, "dismiss">;
}) {
  const ids = [...new Set(input.announcementIds)].slice(0, 50);
  if (!ids.length) return { recorded: 0 };
  const available = await getActiveAnnouncementsForUser(
    input.userId,
    input.organizationId,
  );
  const availableById = new Map(available.map((entry) => [entry.id, entry]));
  const eligible = ids.filter((id) => {
    const announcement = availableById.get(id);
    return (
      announcement &&
      (input.kind !== "click" || Boolean(announcement.href))
    );
  });
  if (!eligible.length) return { recorded: 0 };
  const inserted = await db
    .insert(announcementInteractions)
    .values(
      eligible.flatMap((announcementId) =>
        (input.kind === "click" ? ["impression", "click"] : [input.kind]).map(
          (kind) => ({
            organizationId: input.organizationId,
            announcementId,
            userId: input.userId,
            kind,
          }),
        ),
      ),
    )
    .onConflictDoNothing()
    .returning({ kind: announcementInteractions.kind });
  return {
    recorded: inserted.filter((interaction) => interaction.kind === input.kind)
      .length,
  };
}

export async function dismissAnnouncementForUser(input: {
  userId: string;
  organizationId: string;
  announcementId: string;
}) {
  const available = await getActiveAnnouncementsForUser(
    input.userId,
    input.organizationId,
  );
  const announcement = available.find(
    (entry) => entry.id === input.announcementId,
  );
  if (!announcement?.dismissible) return { dismissed: false };
  return db.transaction(async (tx) => {
    const dismissal = await tx
      .insert(announcementDismissals)
      .values({
        announcementId: input.announcementId,
        userId: input.userId,
      })
      .onConflictDoNothing()
      .returning({ announcementId: announcementDismissals.announcementId });
    await tx
      .insert(announcementInteractions)
      .values(
        ["impression", "dismiss"].map((kind) => ({
          organizationId: input.organizationId,
          announcementId: input.announcementId,
          userId: input.userId,
          kind,
        })),
      )
      .onConflictDoNothing();
    return { dismissed: dismissal.length > 0 };
  });
}
