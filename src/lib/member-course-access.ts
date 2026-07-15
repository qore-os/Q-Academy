import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  bundleCourses,
  bundles,
  courseAccessGrants,
} from "@/db/schema";
import {
  resolveMemberCourseAccess,
  type MemberCourseAccess,
} from "@/lib/member-course-access-policy";
export type {
  BundleCourseAccessPolicy,
  MemberCourseAccess,
  MemberCourseAccessState,
  MemberCourseGrant,
} from "@/lib/member-course-access-policy";

export type MemberCourseAccessReader = Pick<typeof db, "select">;

export async function resolveMemberCourseAccessWithReader(
  reader: MemberCourseAccessReader,
  input: {
    userId: string;
    organizationId: string;
    courseIds: string[];
    now?: Date;
  },
) {
  const courseIds = [...new Set(input.courseIds)];
  const result = new Map<string, MemberCourseAccess>();
  if (!courseIds.length) return result;

  const [grantRows, policyRows] = await Promise.all([
    reader
      .select({
        courseId: courseAccessGrants.courseId,
        source: courseAccessGrants.source,
        grantedAt: courseAccessGrants.createdAt,
      })
      .from(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, input.organizationId),
          eq(courseAccessGrants.userId, input.userId),
          inArray(courseAccessGrants.courseId, courseIds),
        ),
      ),
    reader
      .select({
        bundleId: bundleCourses.bundleId,
        courseId: bundleCourses.courseId,
        bundleActive: bundles.active,
        availableFrom: bundleCourses.availableFrom,
        availableUntil: bundleCourses.availableUntil,
        delayDays: bundleCourses.delayDays,
        visible: bundleCourses.visible,
      })
      .from(bundleCourses)
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, bundleCourses.bundleId),
          eq(bundles.organizationId, input.organizationId),
        ),
      )
      .where(inArray(bundleCourses.courseId, courseIds)),
  ]);

  for (const courseId of courseIds) {
    result.set(
      courseId,
      resolveMemberCourseAccess({
        grants: grantRows.filter((grant) => grant.courseId === courseId),
        policies: policyRows.filter((policy) => policy.courseId === courseId),
        now: input.now,
      }),
    );
  }
  return result;
}

export function resolveMemberCourseAccessById(input: {
  userId: string;
  organizationId: string;
  courseIds: string[];
  now?: Date;
}) {
  return resolveMemberCourseAccessWithReader(db, input);
}
