import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { courseCollaborators, courses, users, type User } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import {
  consolidateCoursePermissionRequirements,
  coursePermissionAllows,
  resolveCoursePermission,
  type CoursePermission,
  type CoursePermissionRequirement,
} from "@/lib/course-permission-policy";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import { teamPermissionAllows } from "@/lib/team-permission-policy";

export {
  coursePermissionAllows,
  consolidateCoursePermissionRequirements,
  resolveCoursePermission,
  type CoursePermission,
  type CoursePermissionRequirement,
} from "@/lib/course-permission-policy";
const idSchema = z.string().uuid();

type CourseActor = Pick<User, "id" | "organizationId" | "role">;
type TransactionCourseActor = Pick<CourseActor, "id" | "organizationId">;
export type CoursePermissionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export async function coursePermissionForUser(
  actor: CourseActor,
  courseId: string,
): Promise<CoursePermission | null> {
  if (!idSchema.safeParse(courseId).success) return null;
  const [row] = await db
    .select({
      id: courses.id,
      permission: courseCollaborators.permission,
    })
    .from(courses)
    .leftJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.organizationId, courses.organizationId),
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, actor.id),
      ),
    )
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const resolved = resolveCoursePermission(actor.role, row.permission);
  if (actor.role === "owner" || actor.role === "member") return resolved;
  const access = await getTeamAccessForUser(actor);
  if (teamPermissionAllows(access.permissions, "courses.manage")) return resolved;
  return teamPermissionAllows(access.permissions, "courses.view") ? "view" : null;
}

export async function coursePermissionMapForUser(
  actor: CourseActor,
  courseIds: string[],
) {
  const uniqueIds = [...new Set(courseIds)].filter(
    (id) => idSchema.safeParse(id).success,
  );
  const result = new Map<string, CoursePermission>();
  if (!uniqueIds.length) return result;
  if (actor.role === "owner" || actor.role === "admin") {
    if (actor.role === "admin") {
      const access = await getTeamAccessForUser(actor);
      if (!teamPermissionAllows(access.permissions, "courses.view")) return result;
      const granted = teamPermissionAllows(access.permissions, "courses.manage")
        ? "manage"
        : "view";
      const rows = await db
        .select({ courseId: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, actor.organizationId),
            inArray(courses.id, uniqueIds),
          ),
        );
      for (const row of rows) result.set(row.courseId, granted);
      return result;
    }
    const rows = await db
      .select({ courseId: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.organizationId, actor.organizationId),
          inArray(courses.id, uniqueIds),
        ),
      );
    for (const row of rows) result.set(row.courseId, "manage");
    return result;
  }
  if (actor.role !== "trainer") return result;
  const rows = await db
    .select({
      courseId: courseCollaborators.courseId,
      permission: courseCollaborators.permission,
    })
    .from(courseCollaborators)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseCollaborators.courseId),
        eq(courses.organizationId, courseCollaborators.organizationId),
      ),
    )
    .where(
      and(
        eq(courseCollaborators.organizationId, actor.organizationId),
        eq(courseCollaborators.userId, actor.id),
        inArray(courseCollaborators.courseId, uniqueIds),
      ),
    );
  for (const row of rows) result.set(row.courseId, row.permission);
  return result;
}

export async function requireCoursePermission(
  courseId: string,
  required: CoursePermission,
) {
  const user = await requireAdmin();
  const permission = await coursePermissionForUser(user, courseId);
  if (!coursePermissionAllows(permission, required)) redirect("/admin/courses");
  return { user, permission } as const;
}

export async function requireCoursePermissionInTransaction(
  tx: CoursePermissionTransaction,
  actor: TransactionCourseActor,
  courseId: string,
  required: CoursePermission,
) {
  const checked = await requireCoursePermissionsInTransaction(tx, actor, [
    { courseId, required },
  ]);
  return {
    course: checked.courses.get(courseId.toLowerCase())!,
    permission: checked.permissions.get(courseId.toLowerCase())!,
    actor: checked.actor,
  } as const;
}

export async function requireCoursePermissionsInTransaction(
  tx: CoursePermissionTransaction,
  actor: TransactionCourseActor,
  requirements: readonly CoursePermissionRequirement[],
) {
  for (const requirement of requirements) {
    if (!idSchema.safeParse(requirement.courseId).success) {
      throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
    }
  }
  const consolidated = consolidateCoursePermissionRequirements(requirements);
  if (!consolidated.length) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }

  const sortedCourseIds = consolidated.map(
    (requirement) => requirement.courseId,
  );
  const requiredByCourseId = new Map(
    consolidated.map(
      (requirement) => [requirement.courseId, requirement.required] as const,
    ),
  );
  const lockedCourses = new Map<string, { id: string }>();
  for (const lockedCourseId of sortedCourseIds) {
    const [course] = await tx
      .select({ id: courses.id })
      .from(courses)
      .where(
        and(
          eq(courses.id, lockedCourseId),
          eq(courses.organizationId, actor.organizationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!course) {
      throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
    }
    lockedCourses.set(course.id, course);
  }

  const [currentActor] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!currentActor) {
    throw new ApiError(
      403,
      "forbidden",
      "Deine Kursberechtigung reicht fuer diese Aenderung nicht mehr aus.",
    );
  }

  const grants =
    currentActor.role === "trainer"
      ? await tx
          .select({
            courseId: courseCollaborators.courseId,
            permission: courseCollaborators.permission,
          })
          .from(courseCollaborators)
          .where(
            and(
              eq(courseCollaborators.organizationId, actor.organizationId),
              eq(courseCollaborators.userId, currentActor.id),
              inArray(courseCollaborators.courseId, sortedCourseIds),
            ),
          )
      : [];
  const grantsByCourseId = new Map(
    grants.map((grant) => [grant.courseId, grant.permission] as const),
  );
  const teamAccess = await getTeamAccessForUser(
    {
      id: currentActor.id,
      organizationId: actor.organizationId,
      role: currentActor.role,
    },
    tx,
  );
  const permissions = new Map<string, CoursePermission>();
  for (const courseId of sortedCourseIds) {
    let permission = resolveCoursePermission(
      currentActor.role,
      grantsByCourseId.get(courseId) ?? null,
    );
    if (currentActor.role !== "owner" && currentActor.role !== "member") {
      if (!teamPermissionAllows(teamAccess.permissions, "courses.view")) {
        permission = null;
      } else if (
        !teamPermissionAllows(teamAccess.permissions, "courses.manage")
      ) {
        permission = "view";
      }
    }
    if (
      !coursePermissionAllows(permission, requiredByCourseId.get(courseId)!)
    ) {
      throw new ApiError(
        403,
        "forbidden",
        "Deine Kursberechtigung reicht fuer diese Aenderung nicht mehr aus.",
      );
    }
    permissions.set(courseId, permission!);
  }

  return {
    actor: currentActor,
    courses: lockedCourses,
    permissions,
  } as const;
}
