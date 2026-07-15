import "server-only";

import { and, count, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import {
  bundleCourses,
  bundles,
  aiAgentMembershipProvenance,
  courseAccessGrants,
  courses,
  enrollments,
  groupBundles,
  groupCourses,
  groupMembers,
  groups,
  memberBundles,
  users,
} from "@/db/schema";

type AccessTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type MembershipMutationOrigin = "manual" | "ai_action";

export type BundleCoursePolicyInput = {
  availableFrom?: Date | null;
  availableUntil?: Date | null;
  delayDays?: number;
  visible?: boolean;
};

async function ensureGrant(
  tx: AccessTransaction,
  organizationId: string,
  userId: string,
  courseId: string,
  source: string,
) {
  const [enrollment] = await tx
    .insert(enrollments)
    .values({ userId, courseId, accessActive: true })
    .onConflictDoUpdate({
      target: [enrollments.userId, enrollments.courseId],
      set: { accessActive: true },
    })
    .returning();
  const [grant] = await tx
    .insert(courseAccessGrants)
    .values({ organizationId, userId, courseId, source })
    .onConflictDoNothing()
    .returning({ id: courseAccessGrants.id });
  return { enrollment, grantCreated: Boolean(grant) };
}

async function refreshEnrollmentAccess(
  tx: AccessTransaction,
  organizationId: string,
  userId: string,
  courseId: string,
) {
  const [remaining] = await tx
    .select({ value: count() })
    .from(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, organizationId),
        eq(courseAccessGrants.userId, userId),
        eq(courseAccessGrants.courseId, courseId),
      ),
    );
  const [enrollment] = await tx
    .update(enrollments)
    .set({ accessActive: Number(remaining.value) > 0 })
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
    .returning();
  return enrollment ?? null;
}

async function refreshRevoked(
  tx: AccessTransaction,
  organizationId: string,
  revoked: Array<{ userId: string; courseId: string }>,
) {
  const unique = new Map(revoked.map((row) => [`${row.userId}:${row.courseId}`, row]));
  for (const row of unique.values()) {
    await refreshEnrollmentAccess(tx, organizationId, row.userId, row.courseId);
  }
}

async function organizationGroupMembers(tx: AccessTransaction, organizationId: string, groupId: string) {
  return tx
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(users, and(eq(users.id, groupMembers.userId), eq(users.organizationId, organizationId)))
    .where(eq(groupMembers.groupId, groupId));
}

async function organizationBundleCourses(tx: AccessTransaction, organizationId: string, bundleId: string) {
  return tx
    .select({ courseId: bundleCourses.courseId })
    .from(bundleCourses)
    .innerJoin(courses, and(eq(courses.id, bundleCourses.courseId), eq(courses.organizationId, organizationId)))
    .where(eq(bundleCourses.bundleId, bundleId));
}

async function closeAiMembershipProvenance(
  tx: AccessTransaction,
  input:
    | {
        organizationId: string;
        memberId: string;
        targetType: "group";
        targetId: string;
        reason: "manual_takeover" | "manual_removal";
      }
    | {
        organizationId: string;
        memberId: string;
        targetType: "bundle";
        targetId: string;
        reason: "manual_takeover" | "manual_removal";
      },
) {
  const now = new Date();
  await tx
    .update(aiAgentMembershipProvenance)
    .set({
      revokedAt: now,
      revocationReason: input.reason,
      revokedByRequestId: null,
    })
    .where(
      and(
        eq(aiAgentMembershipProvenance.organizationId, input.organizationId),
        eq(aiAgentMembershipProvenance.memberId, input.memberId),
        eq(aiAgentMembershipProvenance.targetType, input.targetType),
        input.targetType === "group"
          ? eq(aiAgentMembershipProvenance.targetGroupId, input.targetId)
          : eq(aiAgentMembershipProvenance.targetBundleId, input.targetId),
        isNull(aiAgentMembershipProvenance.revokedAt),
      ),
    );
}

export async function grantDirectCourseAccess(organizationId: string, userId: string, courseId: string) {
  return db.transaction(async (tx) => {
    const [enrollment] = await tx
      .insert(enrollments)
      .values({ userId, courseId, accessActive: true })
      .onConflictDoUpdate({
        target: [enrollments.userId, enrollments.courseId],
        set: { accessActive: true },
      })
      .returning();
    const [grant] = await tx
      .insert(courseAccessGrants)
      .values({ organizationId, userId, courseId, source: `direct:${enrollment.id}` })
      .onConflictDoNothing()
      .returning({ id: courseAccessGrants.id });
    return { enrollment, grantCreated: Boolean(grant) };
  });
}

export async function revokeDirectCourseAccess(organizationId: string, userId: string, courseId: string) {
  return db.transaction(async (tx) => {
    const [enrollment] = await tx
      .select()
      .from(enrollments)
      .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
      .limit(1);
    if (!enrollment) return null;

    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.userId, userId),
          eq(courseAccessGrants.courseId, courseId),
          eq(courseAccessGrants.source, `direct:${enrollment.id}`),
        ),
      )
      .returning({ id: courseAccessGrants.id });
    const refreshed = await refreshEnrollmentAccess(tx, organizationId, userId, courseId);
    return { enrollment: refreshed ?? enrollment, grantRevoked: revoked.length > 0 };
  });
}

export async function assignCourseToGroup(organizationId: string, groupId: string, courseId: string) {
  return db.transaction(async (tx) => {
    await tx.insert(groupCourses).values({ groupId, courseId }).onConflictDoNothing();
    const members = await organizationGroupMembers(tx, organizationId, groupId);
    for (const member of members) {
      await ensureGrant(tx, organizationId, member.userId, courseId, `group:${groupId}:course:${courseId}`);
    }
    const [assignment] = await tx
      .select()
      .from(groupCourses)
      .where(and(eq(groupCourses.groupId, groupId), eq(groupCourses.courseId, courseId)))
      .limit(1);
    return { assignment, affectedMembers: members.length };
  });
}

export async function unassignCourseFromGroup(organizationId: string, groupId: string, courseId: string) {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .delete(groupCourses)
      .where(and(eq(groupCourses.groupId, groupId), eq(groupCourses.courseId, courseId)))
      .returning();
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.courseId, courseId),
          eq(courseAccessGrants.source, `group:${groupId}:course:${courseId}`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    await refreshRevoked(tx, organizationId, revoked);
    return { assignment: assignment ?? null, affectedEnrollments: revoked.length };
  });
}

export async function assignBundleToGroup(organizationId: string, groupId: string, bundleId: string) {
  return db.transaction(async (tx) => {
    await tx.insert(groupBundles).values({ groupId, bundleId }).onConflictDoNothing();
    const [members, bundleCourseRows] = await Promise.all([
      organizationGroupMembers(tx, organizationId, groupId),
      organizationBundleCourses(tx, organizationId, bundleId),
    ]);
    for (const member of members) {
      for (const course of bundleCourseRows) {
        await ensureGrant(
          tx,
          organizationId,
          member.userId,
          course.courseId,
          `group:${groupId}:bundle:${bundleId}`,
        );
      }
    }
    const [assignment] = await tx
      .select()
      .from(groupBundles)
      .where(and(eq(groupBundles.groupId, groupId), eq(groupBundles.bundleId, bundleId)))
      .limit(1);
    return { assignment, affectedMembers: members.length, courses: bundleCourseRows.length };
  });
}

export async function unassignBundleFromGroup(organizationId: string, groupId: string, bundleId: string) {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .delete(groupBundles)
      .where(and(eq(groupBundles.groupId, groupId), eq(groupBundles.bundleId, bundleId)))
      .returning();
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.source, `group:${groupId}:bundle:${bundleId}`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    await refreshRevoked(tx, organizationId, revoked);
    return { assignment: assignment ?? null, affectedEnrollments: revoked.length };
  });
}

export async function assignBundleToMemberInTransaction(
  tx: AccessTransaction,
  organizationId: string,
  userId: string,
  bundleId: string,
  origin: MembershipMutationOrigin = "manual",
) {
  if (origin === "manual") {
    await closeAiMembershipProvenance(tx, {
      organizationId,
      memberId: userId,
      targetType: "bundle",
      targetId: bundleId,
      reason: "manual_takeover",
    });
  }
  const [created] = await tx
    .insert(memberBundles)
    .values({ userId, bundleId })
    .onConflictDoNothing()
    .returning();
  const bundleCourseRows = await organizationBundleCourses(
    tx,
    organizationId,
    bundleId,
  );
  for (const course of bundleCourseRows) {
    await ensureGrant(
      tx,
      organizationId,
      userId,
      course.courseId,
      `member:${userId}:bundle:${bundleId}`,
    );
  }
  const [assignment] = await tx
    .select()
    .from(memberBundles)
    .where(
      and(
        eq(memberBundles.userId, userId),
        eq(memberBundles.bundleId, bundleId),
      ),
    )
    .limit(1);
  return {
    assignment,
    assignmentCreated: Boolean(created),
    courses: bundleCourseRows.length,
  };
}

export async function assignBundleToMember(
  organizationId: string,
  userId: string,
  bundleId: string,
) {
  return db.transaction((tx) =>
    assignBundleToMemberInTransaction(
      tx,
      organizationId,
      userId,
      bundleId,
      "manual",
    ),
  );
}

export async function unassignBundleFromMemberInTransaction(
  tx: AccessTransaction,
  organizationId: string,
  userId: string,
  bundleId: string,
  origin: MembershipMutationOrigin = "manual",
) {
  if (origin === "manual") {
    await closeAiMembershipProvenance(tx, {
      organizationId,
      memberId: userId,
      targetType: "bundle",
      targetId: bundleId,
      reason: "manual_removal",
    });
  }
  const [assignment] = await tx
    .delete(memberBundles)
    .where(
      and(
        eq(memberBundles.userId, userId),
        eq(memberBundles.bundleId, bundleId),
      ),
    )
    .returning();
  const revoked = await tx
    .delete(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, organizationId),
        eq(courseAccessGrants.userId, userId),
        eq(courseAccessGrants.source, `member:${userId}:bundle:${bundleId}`),
      ),
    )
    .returning({
      userId: courseAccessGrants.userId,
      courseId: courseAccessGrants.courseId,
    });
  await refreshRevoked(tx, organizationId, revoked);
  return { assignment: assignment ?? null, affectedEnrollments: revoked.length };
}

export async function unassignBundleFromMember(
  organizationId: string,
  userId: string,
  bundleId: string,
) {
  return db.transaction((tx) =>
    unassignBundleFromMemberInTransaction(
      tx,
      organizationId,
      userId,
      bundleId,
      "manual",
    ),
  );
}

export async function addMemberToGroupInTransaction(
  tx: AccessTransaction,
  organizationId: string,
  groupId: string,
  userId: string,
  origin: MembershipMutationOrigin = "manual",
) {
    if (origin === "manual") {
      await closeAiMembershipProvenance(tx, {
        organizationId,
        memberId: userId,
        targetType: "group",
        targetId: groupId,
        reason: "manual_takeover",
      });
    }
    const [created] = await tx
      .insert(groupMembers)
      .values({ groupId, userId })
      .onConflictDoNothing()
      .returning();
    const [directCourses, assignedBundles] = await Promise.all([
      tx
        .select({ courseId: groupCourses.courseId })
        .from(groupCourses)
        .innerJoin(courses, and(eq(courses.id, groupCourses.courseId), eq(courses.organizationId, organizationId)))
        .where(eq(groupCourses.groupId, groupId)),
      tx
        .select({ bundleId: groupBundles.bundleId })
        .from(groupBundles)
        .innerJoin(bundles, and(eq(bundles.id, groupBundles.bundleId), eq(bundles.organizationId, organizationId)))
        .where(eq(groupBundles.groupId, groupId)),
    ]);

    let grants = 0;
    for (const course of directCourses) {
      const result = await ensureGrant(
        tx,
        organizationId,
        userId,
        course.courseId,
        `group:${groupId}:course:${course.courseId}`,
      );
      if (result.grantCreated) grants += 1;
    }
    for (const bundle of assignedBundles) {
      const bundleCourseRows = await organizationBundleCourses(tx, organizationId, bundle.bundleId);
      for (const course of bundleCourseRows) {
        const result = await ensureGrant(
          tx,
          organizationId,
          userId,
          course.courseId,
          `group:${groupId}:bundle:${bundle.bundleId}`,
        );
        if (result.grantCreated) grants += 1;
      }
    }

    const [membership] = await tx
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .limit(1);
    return {
      membership,
      membershipCreated: Boolean(created),
      grantsCreated: grants,
    };
}

export async function addMemberToGroup(
  organizationId: string,
  groupId: string,
  userId: string,
) {
  return db.transaction((tx) =>
    addMemberToGroupInTransaction(
      tx,
      organizationId,
      groupId,
      userId,
      "manual",
    ),
  );
}

export async function removeMemberFromGroupInTransaction(
  tx: AccessTransaction,
  organizationId: string,
  groupId: string,
  userId: string,
  origin: MembershipMutationOrigin = "manual",
) {
    if (origin === "manual") {
      await closeAiMembershipProvenance(tx, {
        organizationId,
        memberId: userId,
        targetType: "group",
        targetId: groupId,
        reason: "manual_removal",
      });
    }
    const [membership] = await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning();
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.userId, userId),
          like(courseAccessGrants.source, `group:${groupId}:%`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    await refreshRevoked(tx, organizationId, revoked);
    return { membership: membership ?? null, grantsRevoked: revoked.length };
}

export async function removeMemberFromGroup(
  organizationId: string,
  groupId: string,
  userId: string,
) {
  return db.transaction((tx) =>
    removeMemberFromGroupInTransaction(
      tx,
      organizationId,
      groupId,
      userId,
      "manual",
    ),
  );
}

export async function addCourseToBundle(
  organizationId: string,
  bundleId: string,
  courseId: string,
  policy: BundleCoursePolicyInput = {},
) {
  return db.transaction(async (tx) => {
    await tx
      .insert(bundleCourses)
      .values({ bundleId, courseId, ...policy })
      .onConflictDoNothing();
    const [directMembers, assignedGroups] = await Promise.all([
      tx
        .select({ userId: memberBundles.userId })
        .from(memberBundles)
        .innerJoin(users, and(eq(users.id, memberBundles.userId), eq(users.organizationId, organizationId)))
        .where(eq(memberBundles.bundleId, bundleId)),
      tx
        .select({ groupId: groupBundles.groupId })
        .from(groupBundles)
        .innerJoin(groups, and(eq(groups.id, groupBundles.groupId), eq(groups.organizationId, organizationId)))
        .where(eq(groupBundles.bundleId, bundleId)),
    ]);

    let affectedGroupMembers = 0;
    for (const member of directMembers) {
      await ensureGrant(tx, organizationId, member.userId, courseId, `member:${member.userId}:bundle:${bundleId}`);
    }
    for (const group of assignedGroups) {
      const members = await organizationGroupMembers(tx, organizationId, group.groupId);
      affectedGroupMembers += members.length;
      for (const member of members) {
        await ensureGrant(
          tx,
          organizationId,
          member.userId,
          courseId,
          `group:${group.groupId}:bundle:${bundleId}`,
        );
      }
    }

    const [assignment] = await tx
      .select()
      .from(bundleCourses)
      .where(and(eq(bundleCourses.bundleId, bundleId), eq(bundleCourses.courseId, courseId)))
      .limit(1);
    return {
      assignment,
      affectedDirectMembers: directMembers.length,
      affectedGroupMembers,
    };
  });
}

export async function updateBundleCoursePolicy(
  organizationId: string,
  bundleId: string,
  courseId: string,
  policy: BundleCoursePolicyInput,
) {
  return db.transaction(async (tx) => {
    const [ownedAssignment] = await tx
      .select({ bundleId: bundleCourses.bundleId })
      .from(bundleCourses)
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, bundleCourses.bundleId),
          eq(bundles.organizationId, organizationId),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courses.id, bundleCourses.courseId),
          eq(courses.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(bundleCourses.bundleId, bundleId),
          eq(bundleCourses.courseId, courseId),
        ),
      )
      .limit(1);
    if (!ownedAssignment) return null;

    const [assignment] = await tx
      .update(bundleCourses)
      .set(policy)
      .where(
        and(
          eq(bundleCourses.bundleId, bundleId),
          eq(bundleCourses.courseId, courseId),
        ),
      )
      .returning();
    return assignment ?? null;
  });
}

export async function removeCourseFromBundle(organizationId: string, bundleId: string, courseId: string) {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .delete(bundleCourses)
      .where(and(eq(bundleCourses.bundleId, bundleId), eq(bundleCourses.courseId, courseId)))
      .returning();
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.courseId, courseId),
          like(courseAccessGrants.source, `%:bundle:${bundleId}`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    await refreshRevoked(tx, organizationId, revoked);
    return { assignment: assignment ?? null, affectedEnrollments: revoked.length };
  });
}

export async function deleteGroupWithAccess(organizationId: string, groupId: string) {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          like(courseAccessGrants.source, `group:${groupId}:%`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    const [deleted] = await tx
      .delete(groups)
      .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
      .returning({ id: groups.id });
    await refreshRevoked(tx, organizationId, revoked);
    return { deleted: deleted ?? null, affectedEnrollments: revoked.length };
  });
}

export async function deleteBundleWithAccess(organizationId: string, bundleId: string) {
  return db.transaction(async (tx) => {
    const revoked = await tx
      .delete(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          like(courseAccessGrants.source, `%:bundle:${bundleId}`),
        ),
      )
      .returning({ userId: courseAccessGrants.userId, courseId: courseAccessGrants.courseId });
    const [deleted] = await tx
      .delete(bundles)
      .where(and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId)))
      .returning({ id: bundles.id });
    await refreshRevoked(tx, organizationId, revoked);
    return { deleted: deleted ?? null, affectedEnrollments: revoked.length };
  });
}

export const syncGroupMemberAccess = addMemberToGroup;
export const revokeGroupMemberAccess = removeMemberFromGroup;
export const syncBundleCourseAccess = addCourseToBundle;
export const revokeBundleCourseAccess = removeCourseFromBundle;
