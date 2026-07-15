import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  courseVersions,
  publishedCourseLinkEdges,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";

export type CourseLinkTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function lockCourseLinkGraph(
  transaction: CourseLinkTransaction,
  organizationId: string,
) {
  await transaction.execute(
    sql`select q_academy_lock_course_link_graph(${organizationId}::uuid)`,
  );
}

export async function getCourseLinkTarget(
  transaction: CourseLinkTransaction,
  input: {
    organizationId: string;
    sourceCourseId: string;
    targetCourseId: string;
    requirePublished: boolean;
  },
) {
  if (input.sourceCourseId === input.targetCourseId) {
    throw new ApiError(
      422,
      "validation_error",
      "Ein Kurs kann nicht auf sich selbst verlinken.",
    );
  }
  const target = await getTenantLinkTarget(transaction, {
    organizationId: input.organizationId,
    targetCourseId: input.targetCourseId,
  });
  const validPublishedTarget = Boolean(
    target.status === "published" &&
      target.publishedVersionId &&
      target.publishedAt &&
      isValidPublishedCourseSnapshot(
        target.snapshot,
        target.id,
        input.organizationId,
      ),
  );
  if (input.requirePublished && !validPublishedTarget) {
    throw new ApiError(
      422,
      "validation_error",
      `Der verlinkte Kurs "${target.title}" muss zuerst veroeffentlicht werden.`,
    );
  }
  return {
    ...target,
    publishedVersionId: validPublishedTarget
      ? target.publishedVersionId
      : null,
  };
}

export async function getTenantLinkTarget(
  transaction: CourseLinkTransaction,
  input: { organizationId: string; targetCourseId: string },
) {
  const [target] = await transaction
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      publishedVersionId: courses.publishedVersionId,
      publishedAt: courseVersions.publishedAt,
      snapshot: courseVersions.snapshot,
    })
    .from(courses)
    .leftJoin(
      courseVersions,
      and(
        eq(courseVersions.id, courses.publishedVersionId),
        eq(courseVersions.courseId, courses.id),
        eq(courseVersions.organizationId, courses.organizationId),
      ),
    )
    .where(
      and(
        eq(courses.id, input.targetCourseId),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new ApiError(404, "not_found", "Zielkurs nicht gefunden.");
  }
  return target;
}

export async function publishedTargetVersionsForLinks(
  transaction: CourseLinkTransaction,
  input: {
    organizationId: string;
    sourceCourseId: string;
    targetCourseIds: string[];
    requirePublished: boolean;
  },
) {
  const targetIds = [...new Set(input.targetCourseIds)];
  const result = new Map<string, string | null>();
  if (!targetIds.length) return result;
  if (targetIds.includes(input.sourceCourseId)) {
    throw new ApiError(
      422,
      "validation_error",
      "Ein Kurs kann nicht auf sich selbst verlinken.",
    );
  }
  const targets = await transaction
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      publishedVersionId: courses.publishedVersionId,
      publishedAt: courseVersions.publishedAt,
      snapshot: courseVersions.snapshot,
    })
    .from(courses)
    .leftJoin(
      courseVersions,
      and(
        eq(courseVersions.id, courses.publishedVersionId),
        eq(courseVersions.courseId, courses.id),
        eq(courseVersions.organizationId, courses.organizationId),
      ),
    )
    .where(
      and(
        eq(courses.organizationId, input.organizationId),
        inArray(courses.id, targetIds),
      ),
    );
  const targetById = new Map(targets.map((target) => [target.id, target]));
  for (const targetCourseId of targetIds) {
    const target = targetById.get(targetCourseId);
    if (!target) {
      throw new ApiError(404, "not_found", "Zielkurs nicht gefunden.");
    }
    const validPublishedTarget = Boolean(
      target.status === "published" &&
        target.publishedVersionId &&
        target.publishedAt &&
        isValidPublishedCourseSnapshot(
          target.snapshot,
          target.id,
          input.organizationId,
        ),
    );
    if (input.requirePublished && !validPublishedTarget) {
      throw new ApiError(
        422,
        "validation_error",
        `Der verlinkte Kurs "${target.title}" muss zuerst veroeffentlicht werden.`,
      );
    }
    result.set(
      targetCourseId,
      validPublishedTarget ? target.publishedVersionId : null,
    );
  }
  return result;
}

export async function assertCourseCanBecomeUnavailable(
  transaction: CourseLinkTransaction,
  input: { organizationId: string; courseId: string },
) {
  const incoming = await transaction
    .select({ sourceCourseId: publishedCourseLinkEdges.sourceCourseId })
    .from(publishedCourseLinkEdges)
    .where(
      and(
        eq(publishedCourseLinkEdges.organizationId, input.organizationId),
        eq(publishedCourseLinkEdges.targetCourseId, input.courseId),
      ),
    )
    .limit(1);
  if (incoming.length) {
    throw new ApiError(
      409,
      "conflict",
      "Der Kurs ist in einem veroeffentlichten Link-Modul eingebunden. Entferne oder aktualisiere zuerst den Quellkurs.",
    );
  }
}

export function snapshotCourseLinkModules(snapshot: CourseVersionSnapshot) {
  return snapshot.modules.filter(
    (learningModule) =>
      learningModule.kind === "link" &&
      typeof learningModule.linkedCourseId === "string",
  );
}

export async function replacePublishedCourseLinkEdges(
  transaction: CourseLinkTransaction,
  input: {
    organizationId: string;
    sourceCourseId: string;
    sourceVersionId: string;
    snapshot: CourseVersionSnapshot;
  },
) {
  await lockCourseLinkGraph(transaction, input.organizationId);
  const linkModules = snapshotCourseLinkModules(input.snapshot);
  await transaction
    .delete(publishedCourseLinkEdges)
    .where(
      and(
        eq(publishedCourseLinkEdges.organizationId, input.organizationId),
        eq(publishedCourseLinkEdges.sourceCourseId, input.sourceCourseId),
      ),
    );
  if (!linkModules.length) return;
  const targetIds = linkModules.map(
    (learningModule) => learningModule.linkedCourseId!,
  );
  const targets = await transaction
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, input.organizationId),
        inArray(courses.id, [...new Set(targetIds)]),
        eq(courses.status, "published"),
      ),
    );
  if (targets.length !== new Set(targetIds).size) {
    throw new ApiError(
      409,
      "conflict",
      "Mindestens ein Link-Ziel ist nicht mehr veroeffentlicht.",
    );
  }
  await transaction.insert(publishedCourseLinkEdges).values(
    linkModules.map((learningModule) => ({
      organizationId: input.organizationId,
      sourceCourseId: input.sourceCourseId,
      sourceVersionId: input.sourceVersionId,
      linkModuleId: learningModule.id,
      targetCourseId: learningModule.linkedCourseId!,
    })),
  );
}

export async function clearPublishedCourseLinkEdges(
  transaction: CourseLinkTransaction,
  input: { organizationId: string; sourceCourseId: string },
) {
  await lockCourseLinkGraph(transaction, input.organizationId);
  await transaction
    .delete(publishedCourseLinkEdges)
    .where(
      and(
        eq(publishedCourseLinkEdges.organizationId, input.organizationId),
        eq(publishedCourseLinkEdges.sourceCourseId, input.sourceCourseId),
      ),
    );
}
