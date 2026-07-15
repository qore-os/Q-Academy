import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { courseModules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  lockCourseLinkGraph,
  type CourseLinkTransaction,
} from "@/lib/course-link-service";

export type CourseOutlineItem = {
  moduleId: string;
  sortOrder: number;
  indentLevel: number;
};

function assertOutlineShape(items: CourseOutlineItem[]) {
  const ids = new Set<string>();
  const ordered = [...items].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      left.moduleId.localeCompare(right.moduleId),
  );
  for (const [index, item] of ordered.entries()) {
    if (
      ids.has(item.moduleId) ||
      item.sortOrder !== index ||
      item.indentLevel < 0 ||
      item.indentLevel > 3 ||
      (index === 0 && item.indentLevel !== 0) ||
      (index > 0 && item.indentLevel > ordered[index - 1].indentLevel + 1)
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Die Modulreihenfolge oder Einrueckung ist ungueltig.",
      );
    }
    ids.add(item.moduleId);
  }
  return ordered;
}

async function lockedCourseOutline(
  transaction: CourseLinkTransaction,
  input: { organizationId: string; courseId: string },
) {
  await lockCourseLinkGraph(transaction, input.organizationId);
  return transaction
    .select({
      moduleId: courseModules.moduleId,
      sortOrder: courseModules.sortOrder,
      indentLevel: courseModules.indentLevel,
    })
    .from(courseModules)
    .where(
      and(
        eq(courseModules.organizationId, input.organizationId),
        eq(courseModules.courseId, input.courseId),
      ),
    )
    .orderBy(asc(courseModules.sortOrder), asc(courseModules.moduleId))
    .for("update");
}

export async function replaceCourseOutline(
  transaction: CourseLinkTransaction,
  input: {
    organizationId: string;
    courseId: string;
    items: CourseOutlineItem[];
  },
) {
  const ordered = assertOutlineShape(input.items);
  const current = await lockedCourseOutline(transaction, input);
  const currentIds = [...current.map((item) => item.moduleId)].sort();
  const requestedIds = [...ordered.map((item) => item.moduleId)].sort();
  if (JSON.stringify(currentIds) !== JSON.stringify(requestedIds)) {
    throw new ApiError(
      409,
      "conflict",
      "Die Modulmenge wurde parallel geaendert. Lade den Kurs neu.",
    );
  }
  for (const [index, item] of ordered.entries()) {
    await transaction
      .update(courseModules)
      .set({ sortOrder: 100_000 + index, indentLevel: 0 })
      .where(
        and(
          eq(courseModules.organizationId, input.organizationId),
          eq(courseModules.courseId, input.courseId),
          eq(courseModules.moduleId, item.moduleId),
        ),
      );
  }
  for (const item of ordered) {
    await transaction
      .update(courseModules)
      .set({ sortOrder: item.sortOrder, indentLevel: item.indentLevel })
      .where(
        and(
          eq(courseModules.organizationId, input.organizationId),
          eq(courseModules.courseId, input.courseId),
          eq(courseModules.moduleId, item.moduleId),
        ),
      );
  }
  return ordered;
}

export async function normalizeCourseOutline(
  transaction: CourseLinkTransaction,
  input: { organizationId: string; courseId: string },
) {
  const current = await lockedCourseOutline(transaction, input);
  let previousIndentLevel = 0;
  const normalized = current.map((item, index) => {
    const indentLevel =
      index === 0
        ? 0
        : Math.min(item.indentLevel, previousIndentLevel + 1, 3);
    previousIndentLevel = indentLevel;
    return { moduleId: item.moduleId, sortOrder: index, indentLevel };
  });
  for (const item of normalized) {
    await transaction
      .update(courseModules)
      .set({ sortOrder: item.sortOrder, indentLevel: item.indentLevel })
      .where(
        and(
          eq(courseModules.organizationId, input.organizationId),
          eq(courseModules.courseId, input.courseId),
          eq(courseModules.moduleId, item.moduleId),
        ),
      );
  }
  return normalized;
}
