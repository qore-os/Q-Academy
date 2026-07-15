import { z } from "zod";

export const announcementRoleRuleSchema = z
  .object({
    type: z.literal("role"),
    role: z.enum(["owner", "admin", "trainer", "member"]),
  })
  .strict();

export const announcementGroupRuleSchema = z
  .object({
    type: z.literal("group"),
    groupId: z.string().uuid(),
    match: z.enum(["member", "not_member"]).default("member"),
  })
  .strict();

export const announcementBundleRuleSchema = z
  .object({
    type: z.literal("bundle"),
    bundleId: z.string().uuid(),
    match: z.enum(["member", "not_member"]).default("member"),
  })
  .strict();

export const announcementCourseAccessRuleSchema = z
  .object({
    type: z.literal("course_access"),
    courseId: z.string().uuid(),
    access: z.enum(["granted", "not_granted"]),
  })
  .strict();

export const announcementCourseProgressRuleSchema = z
  .object({
    type: z.literal("course_progress"),
    courseId: z.string().uuid(),
    comparison: z.enum(["at_least", "at_most", "between"]),
    percent: z.number().int().min(0).max(100),
    maxPercent: z.number().int().min(0).max(100).nullable().default(null),
  })
  .strict()
  .superRefine((rule, context) => {
    if (rule.comparison === "between") {
      if (rule.maxPercent === null || rule.maxPercent < rule.percent) {
        context.addIssue({
          code: "custom",
          path: ["maxPercent"],
          message: "Die obere Fortschrittsgrenze muss mindestens der unteren entsprechen.",
        });
      }
    } else if (rule.maxPercent !== null) {
      context.addIssue({
        code: "custom",
        path: ["maxPercent"],
        message: "Eine obere Grenze ist nur fuer einen Bereich zulaessig.",
      });
    }
  });

export const announcementTargetRuleSchema = z.discriminatedUnion("type", [
  announcementRoleRuleSchema,
  announcementGroupRuleSchema,
  announcementBundleRuleSchema,
  announcementCourseAccessRuleSchema,
  announcementCourseProgressRuleSchema,
]);

export const announcementTargetRuleSetSchema = z
  .object({
    version: z.literal(1),
    conjunction: z.literal("and"),
    conditions: z.array(announcementTargetRuleSchema).max(20),
  })
  .strict();

export type AnnouncementTargetRule = z.infer<
  typeof announcementTargetRuleSchema
>;
export type AnnouncementTargetRuleSet = z.infer<
  typeof announcementTargetRuleSetSchema
>;

export const EMPTY_ANNOUNCEMENT_TARGET_RULE_SET: AnnouncementTargetRuleSet = {
  version: 1,
  conjunction: "and",
  conditions: [],
};

export type AnnouncementAudienceContext = {
  role: "owner" | "admin" | "trainer" | "member";
  knownGroupIds: ReadonlySet<string>;
  knownBundleIds: ReadonlySet<string>;
  knownCourseIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  bundleIds: ReadonlySet<string>;
  courseAccessIds: ReadonlySet<string>;
  courseProgress: ReadonlyMap<string, number>;
};

export function parseAnnouncementTargetRuleSet(value: unknown) {
  return announcementTargetRuleSetSchema.safeParse(value);
}

export function matchesAnnouncementTargetRules(
  ruleSet: AnnouncementTargetRuleSet,
  context: AnnouncementAudienceContext,
) {
  return ruleSet.conditions.every((rule) => {
    switch (rule.type) {
      case "role":
        return context.role === rule.role;
      case "group": {
        if (!context.knownGroupIds.has(rule.groupId)) return false;
        const isMember = context.groupIds.has(rule.groupId);
        return rule.match === "member" ? isMember : !isMember;
      }
      case "bundle": {
        if (!context.knownBundleIds.has(rule.bundleId)) return false;
        const isMember = context.bundleIds.has(rule.bundleId);
        return rule.match === "member" ? isMember : !isMember;
      }
      case "course_access": {
        if (!context.knownCourseIds.has(rule.courseId)) return false;
        const hasAccess = context.courseAccessIds.has(rule.courseId);
        return rule.access === "granted" ? hasAccess : !hasAccess;
      }
      case "course_progress": {
        if (!context.knownCourseIds.has(rule.courseId)) return false;
        const progress = context.courseProgress.get(rule.courseId) ?? 0;
        if (rule.comparison === "at_least") return progress >= rule.percent;
        if (rule.comparison === "at_most") return progress <= rule.percent;
        return progress >= rule.percent && progress <= rule.maxPercent!;
      }
    }
  });
}

export function announcementTargetRuleLabel(rule: AnnouncementTargetRule) {
  switch (rule.type) {
    case "role":
      return `Rolle ist ${rule.role}`;
    case "group":
      return rule.match === "member" ? "In Gruppe" : "Nicht in Gruppe";
    case "bundle":
      return rule.match === "member" ? "Hat Bundle" : "Hat Bundle nicht";
    case "course_access":
      return rule.access === "granted" ? "Hat Kurszugriff" : "Kein Kurszugriff";
    case "course_progress":
      if (rule.comparison === "at_least") return `Fortschritt ab ${rule.percent}%`;
      if (rule.comparison === "at_most") return `Fortschritt bis ${rule.percent}%`;
      return `Fortschritt ${rule.percent}-${rule.maxPercent}%`;
  }
}
