import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  lessonBookmarks,
  organizations,
  users,
} from "@/db/schema";
import { getCourseLearningAccess } from "@/lib/learning-access";

type BookmarkTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAndAuthorizeUser(
  tx: BookmarkTransaction,
  input: { userId: string; organizationId: string },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`lesson-bookmarks:${input.organizationId}:${input.userId}`}, 0))`,
  );
  const [authorized] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share", { of: users });
  return Boolean(authorized);
}

export async function isLessonBookmarked(input: {
  organizationId: string;
  userId: string;
  courseId: string;
  lessonId: string;
}) {
  const [row] = await db
    .select({ lessonId: lessonBookmarks.lessonId })
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.organizationId, input.organizationId),
        eq(lessonBookmarks.userId, input.userId),
        eq(lessonBookmarks.courseId, input.courseId),
        eq(lessonBookmarks.lessonId, input.lessonId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function setLessonBookmark(input: {
  organizationId: string;
  userId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  bookmarked: boolean;
}) {
  return db.transaction(async (tx) => {
    if (!(await lockAndAuthorizeUser(tx, input))) return null;
    const access = await getCourseLearningAccess(tx, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
    });
    const lesson = access?.lessons.get(input.lessonId);
    const learningModule = access?.modules.find((entry) =>
      entry.lessons.some((entryLesson) => entryLesson.lesson.id === input.lessonId),
    );
    if (
      !lesson?.access.accessible ||
      !learningModule ||
      learningModule.module.id !== input.moduleId
    ) {
      return false;
    }
    if (input.bookmarked) {
      const created = await tx
        .insert(lessonBookmarks)
        .values({
          organizationId: input.organizationId,
          userId: input.userId,
          courseId: input.courseId,
          moduleId: input.moduleId,
          lessonId: input.lessonId,
        })
        .onConflictDoNothing()
        .returning({ lessonId: lessonBookmarks.lessonId });
      if (created.length) {
        await tx.insert(activityEvents).values({
          organizationId: input.organizationId,
          userId: input.userId,
          type: "learning.lesson_bookmark.created",
          entityType: "lesson",
          entityId: input.lessonId,
          metadata: { courseId: input.courseId, moduleId: input.moduleId },
        });
      }
    } else {
      const removed = await tx
        .delete(lessonBookmarks)
        .where(
          and(
            eq(lessonBookmarks.organizationId, input.organizationId),
            eq(lessonBookmarks.userId, input.userId),
            eq(lessonBookmarks.courseId, input.courseId),
            eq(lessonBookmarks.lessonId, input.lessonId),
          ),
        )
        .returning({ lessonId: lessonBookmarks.lessonId });
      if (removed.length) {
        await tx.insert(activityEvents).values({
          organizationId: input.organizationId,
          userId: input.userId,
          type: "learning.lesson_bookmark.deleted",
          entityType: "lesson",
          entityId: input.lessonId,
          metadata: { courseId: input.courseId, moduleId: input.moduleId },
        });
      }
    }
    return true;
  });
}

export type LessonBookmarkGroup = {
  course: { id: string; title: string; slug: string };
  modules: Array<{
    id: string;
    title: string;
    lessons: Array<{
      id: string;
      title: string;
      type: string;
      durationMinutes: number;
      href: string;
      createdAt: Date;
    }>;
  }>;
};

export async function listAccessibleLessonBookmarks(input: {
  organizationId: string;
  userId: string;
}): Promise<LessonBookmarkGroup[]> {
  const rows = await db
    .select({
      courseId: lessonBookmarks.courseId,
      moduleId: lessonBookmarks.moduleId,
      lessonId: lessonBookmarks.lessonId,
      createdAt: lessonBookmarks.createdAt,
    })
    .from(lessonBookmarks)
    .where(
      and(
        eq(lessonBookmarks.organizationId, input.organizationId),
        eq(lessonBookmarks.userId, input.userId),
      ),
    )
    .orderBy(desc(lessonBookmarks.createdAt));
  const courseIds = [...new Set(rows.map((row) => row.courseId))];
  const accessRows = await Promise.all(
    courseIds.map((courseId) =>
      getCourseLearningAccess(db, {
        organizationId: input.organizationId,
        userId: input.userId,
        courseId,
      }),
    ),
  );
  const rowsByCourse = new Map(
    courseIds.map((courseId) => [
      courseId,
      rows.filter((row) => row.courseId === courseId),
    ]),
  );
  return accessRows.flatMap((access) => {
    if (!access) return [];
    const bookmarkedRows = rowsByCourse.get(access.published.courseId) ?? [];
    const bookmarkedByLesson = new Map(
      bookmarkedRows.map((row) => [row.lessonId, row]),
    );
    const modules = access.modules.flatMap((module) => {
      const moduleLessons = module.lessons.flatMap(({ lesson, access: lessonAccess }) => {
        const bookmark = bookmarkedByLesson.get(lesson.id);
        if (!bookmark || bookmark.moduleId !== module.module.id || !lessonAccess.accessible) {
          return [];
        }
        return [{
          id: lesson.id,
          title: lesson.title,
          type: lesson.type,
          durationMinutes: lesson.durationMinutes,
          href: `/academy/courses/${encodeURIComponent(access.published.snapshot.course.slug)}/learn/${encodeURIComponent(lesson.id)}`,
          createdAt: bookmark.createdAt,
        }];
      });
      if (!moduleLessons.length) return [];
      return [{
        id: module.module.id,
        title: module.module.title,
        lessons: moduleLessons.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        ),
      }];
    });
    if (!modules.length) return [];
    return [{
      course: {
        id: access.published.courseId,
        title: access.published.snapshot.course.title,
        slug: access.published.snapshot.course.slug,
      },
      modules,
    }];
  }).sort((left, right) => left.course.title.localeCompare(right.course.title, "de"));
}
