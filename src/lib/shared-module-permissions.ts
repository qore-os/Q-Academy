import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contentBlocks,
  courseCollaborators,
  courseModules,
  courses,
  lessonPages,
  lessons,
  modules,
  type User,
} from "@/db/schema";
import { canMutateSharedModuleContent } from "@/lib/shared-module-permission-policy";
import { ApiError } from "@/lib/api/errors";
import { lockCourseLinkGraph } from "@/lib/course-link-service";
import {
  requireCoursePermissionsInTransaction,
  type CoursePermissionRequirement,
  type CoursePermissionTransaction,
} from "@/lib/course-permissions";

type SharedModuleActor = Pick<User, "id" | "organizationId" | "role">;
type SharedModuleReader = Pick<typeof db, "select">;

export type SharedModuleContentTarget =
  | { type: "module"; id: string }
  | { type: "lesson"; id: string }
  | { type: "page"; id: string }
  | { type: "block"; id: string };

async function resolveTargetModuleId(
  reader: SharedModuleReader,
  actor: SharedModuleActor,
  target: SharedModuleContentTarget,
) {
  if (target.type === "module") {
    const [record] = await reader
      .select({ moduleId: modules.id })
      .from(modules)
      .where(
        and(
          eq(modules.id, target.id),
          eq(modules.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    return record?.moduleId ?? null;
  }

  if (target.type === "lesson") {
    const [record] = await reader
      .select({ moduleId: lessons.moduleId })
      .from(lessons)
      .innerJoin(
        modules,
        and(
          eq(modules.id, lessons.moduleId),
          eq(modules.organizationId, lessons.organizationId),
        ),
      )
      .where(
        and(
          eq(lessons.id, target.id),
          eq(lessons.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    return record?.moduleId ?? null;
  }

  if (target.type === "page") {
    const [record] = await reader
      .select({ moduleId: lessons.moduleId })
      .from(lessonPages)
      .innerJoin(lessons, eq(lessons.id, lessonPages.lessonId))
      .innerJoin(
        modules,
        and(
          eq(modules.id, lessons.moduleId),
          eq(modules.organizationId, lessons.organizationId),
        ),
      )
      .where(
        and(
          eq(lessonPages.id, target.id),
          eq(lessons.organizationId, actor.organizationId),
        ),
      )
      .limit(1);
    return record?.moduleId ?? null;
  }

  const [record] = await reader
    .select({ moduleId: lessons.moduleId })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, lessons.organizationId),
      ),
    )
    .where(
      and(
        eq(contentBlocks.id, target.id),
        eq(lessons.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  return record?.moduleId ?? null;
}

export async function sharedModuleContentPermissionDecision(
  reader: SharedModuleReader,
  actor: SharedModuleActor,
  target: SharedModuleContentTarget,
) {
  const moduleId = await resolveTargetModuleId(reader, actor, target);
  if (!moduleId) {
    return {
      allowed: false,
      moduleId: null,
      referencedCourseIds: [] as string[],
      deniedCourseIds: [] as string[],
    };
  }

  const references = await reader
    .select({
      courseId: courseModules.courseId,
      permission: courseCollaborators.permission,
    })
    .from(courseModules)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, courseModules.organizationId),
      ),
    )
    .leftJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.organizationId, courseModules.organizationId),
        eq(courseCollaborators.courseId, courseModules.courseId),
        eq(courseCollaborators.userId, actor.id),
      ),
    )
    .where(
      and(
        eq(courseModules.organizationId, actor.organizationId),
        eq(courseModules.moduleId, moduleId),
      ),
    );
  const deniedCourseIds = references
    .filter(
      (reference) =>
        reference.permission !== "edit" && reference.permission !== "manage",
    )
    .map((reference) => reference.courseId);

  return {
    allowed: canMutateSharedModuleContent({
      actorRole: actor.role,
      referencedCoursePermissions: references.map(
        (reference) => reference.permission,
      ),
    }),
    moduleId,
    referencedCourseIds: references.map((reference) => reference.courseId),
    deniedCourseIds,
  };
}

export async function requireSharedModuleContentPermission(
  tx: CoursePermissionTransaction,
  actor: SharedModuleActor,
  sourceCourseId: string,
  target: SharedModuleContentTarget,
  additionalCourseRequirements: readonly CoursePermissionRequirement[] = [],
) {
  await lockCourseLinkGraph(tx, actor.organizationId);
  const moduleId = await resolveTargetModuleId(tx, actor, target);
  if (!moduleId) {
    throw new ApiError(404, "not_found", "Kursinhalt nicht gefunden.");
  }
  const references = await tx
    .select({ courseId: courseModules.courseId })
    .from(courseModules)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, courseModules.organizationId),
      ),
    )
    .where(
      and(
        eq(courseModules.organizationId, actor.organizationId),
        eq(courseModules.moduleId, moduleId),
      ),
    );
  const referencedCourseIds = references.map((reference) => reference.courseId);
  const normalizedSourceCourseId = sourceCourseId.toLowerCase();
  if (!referencedCourseIds.includes(normalizedSourceCourseId)) {
    throw new ApiError(404, "not_found", "Kursinhalt nicht gefunden.");
  }

  const checked = await requireCoursePermissionsInTransaction(tx, actor, [
    { courseId: normalizedSourceCourseId, required: "edit" },
    ...referencedCourseIds.map((courseId) => ({
      courseId,
      required: "edit" as const,
    })),
    ...additionalCourseRequirements,
  ]);
  return {
    allowed: true,
    moduleId,
    referencedCourseIds,
    deniedCourseIds: [] as string[],
    actor: checked.actor,
  } as const;
}

export async function requireLinkModuleTargetViewPermission(
  tx: CoursePermissionTransaction,
  actor: SharedModuleActor,
  sourceCourseId: string,
  targetCourseId: string,
) {
  await lockCourseLinkGraph(tx, actor.organizationId);
  const checked = await requireCoursePermissionsInTransaction(tx, actor, [
    { courseId: sourceCourseId, required: "edit" },
    { courseId: targetCourseId, required: "view" },
  ]);
  return {
    courseId: targetCourseId,
    permission: checked.permissions.get(targetCourseId.toLowerCase())!,
  } as const;
}
