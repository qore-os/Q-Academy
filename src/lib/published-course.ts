import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  courseVersions,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";
import { sanitizeCourseSnapshotAvatarSources } from "@/lib/avatar-policy";

export { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";

export type PublishedCourseReader = Pick<typeof db, "select">;

export type PublishedCourseContent = {
  courseId: string;
  versionId: string;
  version: number;
  publishedAt: Date;
  firstPublishedAt: Date;
  snapshot: CourseVersionSnapshot;
};

function validPublishedContent(
  row: Pick<PublishedCourseContent, "courseId" | "snapshot"> & {
    organizationId: string;
  },
  organizationId: string,
) {
  return (
    isValidPublishedCourseSnapshot(
      row.snapshot,
      row.courseId,
      organizationId,
    ) && row.organizationId === organizationId
  );
}

export async function getPublishedCourseContents(
  reader: PublishedCourseReader,
  input: { organizationId: string; courseIds: string[] },
) {
  const courseIds = [...new Set(input.courseIds)];
  if (!courseIds.length) return new Map<string, PublishedCourseContent>();

  const rows = await reader
    .select({
      courseId: courses.id,
      organizationId: courses.organizationId,
      versionId: courseVersions.id,
      version: courseVersions.version,
      publishedAt: courseVersions.publishedAt,
      firstPublishedAt: courses.firstPublishedAt,
      snapshot: courseVersions.snapshot,
    })
    .from(courses)
    .innerJoin(
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
        eq(courses.status, "published"),
        inArray(courses.id, courseIds),
      ),
    );

  const result = new Map<string, PublishedCourseContent>();
  for (const row of rows) {
    if (!row.publishedAt || !validPublishedContent(row, input.organizationId)) {
      continue;
    }
    result.set(row.courseId, {
      courseId: row.courseId,
      versionId: row.versionId,
      version: row.version,
      publishedAt: row.publishedAt,
      firstPublishedAt:
        row.firstPublishedAt ??
        (row.snapshot.course.firstPublishedAt
          ? new Date(row.snapshot.course.firstPublishedAt)
          : row.publishedAt),
      snapshot: sanitizeCourseSnapshotAvatarSources(row.snapshot),
    });
  }
  return result;
}

export async function getPublishedCourseContent(
  reader: PublishedCourseReader,
  input: { organizationId: string; courseId: string },
) {
  const contents = await getPublishedCourseContents(reader, {
    organizationId: input.organizationId,
    courseIds: [input.courseId],
  });
  return contents.get(input.courseId) ?? null;
}

export type PublishedSnapshotModule = CourseVersionSnapshot["modules"][number];
export type PublishedSnapshotLesson =
  PublishedSnapshotModule["lessons"][number];

export function moduleLessons(learningModule: PublishedSnapshotModule) {
  return [...learningModule.lessons].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

export function snapshotLessons(snapshot: CourseVersionSnapshot) {
  return snapshot.modules.flatMap((learningModule) =>
    moduleLessons(learningModule),
  );
}

export function findSnapshotLesson(
  snapshot: CourseVersionSnapshot,
  lessonId: string,
) {
  for (const learningModule of snapshot.modules) {
    const lesson = moduleLessons(learningModule).find(
      (entry) => entry.id === lessonId,
    );
    if (lesson) return { module: learningModule, lesson };
  }
  return null;
}

export function snapshotLessonBlocks(lesson: PublishedSnapshotLesson) {
  return [
    ...lesson.blocks,
    ...lesson.pages.flatMap((page) => page.blocks),
  ].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}
