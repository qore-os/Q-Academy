import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  courseModules,
  lessons,
  moduleSections,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { SectionLessonVisibility } from "@/lib/section-lesson-visibility";

export type SectionLessonVisibilityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type SetSectionLessonsVisibilityInput = {
  organizationId: string;
  sectionId: string;
  visibility: SectionLessonVisibility;
  courseId?: string;
};

export type SetSectionLessonsVisibilityResult = {
  sectionId: string;
  moduleId: string;
  visibility: SectionLessonVisibility;
  updatedLessonIds: string[];
  updatedLessonCount: number;
  updatedAt: Date;
};

export async function setSectionLessonsVisibility(
  tx: SectionLessonVisibilityTransaction,
  input: SetSectionLessonsVisibilityInput,
): Promise<SetSectionLessonsVisibilityResult> {
  const [section] = await tx
    .select({ id: moduleSections.id, moduleId: moduleSections.moduleId })
    .from(moduleSections)
    .where(
      and(
        eq(moduleSections.id, input.sectionId),
        eq(moduleSections.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");

  if (!section) {
    throw new ApiError(404, "not_found", "Sektion nicht gefunden.");
  }

  if (input.courseId) {
    const [assignment] = await tx
      .select({ moduleId: courseModules.moduleId })
      .from(courseModules)
      .where(
        and(
          eq(courseModules.organizationId, input.organizationId),
          eq(courseModules.courseId, input.courseId),
          eq(courseModules.moduleId, section.moduleId),
        ),
      )
      .limit(1)
      .for("update");
    if (!assignment) {
      throw new ApiError(404, "not_found", "Sektion nicht gefunden.");
    }
  }

  const targetLessons = await tx
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      and(
        eq(lessons.organizationId, input.organizationId),
        eq(lessons.moduleId, section.moduleId),
        eq(lessons.sectionId, section.id),
      ),
    )
    .orderBy(asc(lessons.sortOrder), asc(lessons.id))
    .for("update");

  const updatedAt = new Date();
  const lessonIds = targetLessons.map((lesson) => lesson.id);
  const updatedLessons = lessonIds.length
    ? await tx
        .update(lessons)
        .set({ visibility: input.visibility, updatedAt })
        .where(
          and(
            eq(lessons.organizationId, input.organizationId),
            eq(lessons.moduleId, section.moduleId),
            eq(lessons.sectionId, section.id),
            inArray(lessons.id, lessonIds),
          ),
        )
        .returning({ id: lessons.id })
    : [];

  if (updatedLessons.length !== lessonIds.length) {
    throw new ApiError(
      409,
      "conflict",
      "Die Sektionslektionen wurden gleichzeitig geaendert.",
    );
  }

  return {
    sectionId: section.id,
    moduleId: section.moduleId,
    visibility: input.visibility,
    updatedLessonIds: updatedLessons.map((lesson) => lesson.id),
    updatedLessonCount: updatedLessons.length,
    updatedAt,
  };
}
