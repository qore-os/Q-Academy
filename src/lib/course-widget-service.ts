import "server-only";

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { courses, courseWidgets, mediaAssets, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  courseWidgetValues,
  type CourseWidgetInput,
} from "@/lib/course-widgets";
import { safeAvatarSource } from "@/lib/avatar-policy";
import { bindReadyCourseMediaAssets } from "@/lib/media/course-assets";

export type CourseWidgetTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function listCourseWidgets(
  courseId: string,
  organizationId: string,
) {
  const rows = await db
    .select({
      id: courseWidgets.id,
      organizationId: courseWidgets.organizationId,
      courseId: courseWidgets.courseId,
      type: courseWidgets.type,
      sortOrder: courseWidgets.sortOrder,
      authorUserId: courseWidgets.authorUserId,
      authorRole: courseWidgets.authorRole,
      authorDescription: courseWidgets.authorDescription,
      title: courseWidgets.title,
      text: courseWidgets.text,
      linkUrl: courseWidgets.linkUrl,
      imageUrl: courseWidgets.imageUrl,
      mediaAssetId: courseWidgets.mediaAssetId,
      mediaFileName: mediaAssets.originalFileName,
      altText: courseWidgets.altText,
      createdAt: courseWidgets.createdAt,
      updatedAt: courseWidgets.updatedAt,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseWidgets)
    .leftJoin(
      users,
      and(
        eq(users.id, courseWidgets.authorUserId),
        eq(users.organizationId, courseWidgets.organizationId),
      ),
    )
    .leftJoin(
      mediaAssets,
      and(
        eq(mediaAssets.id, courseWidgets.mediaAssetId),
        eq(mediaAssets.organizationId, courseWidgets.organizationId),
      ),
    )
    .where(
      and(
        eq(courseWidgets.courseId, courseId),
        eq(courseWidgets.organizationId, organizationId),
      ),
    )
    .orderBy(asc(courseWidgets.sortOrder), asc(courseWidgets.id));
  return rows.map((row) => ({
    ...row,
    author: row.author
      ? {
          ...row.author,
          avatarUrl: safeAvatarSource(row.author.avatarUrl),
        }
      : null,
  }));
}

export async function listCourseWidgetTeamMembers(organizationId: string) {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      avatarUrl: users.avatarUrl,
      role: users.role,
      status: users.status,
      jobTitle: users.jobTitle,
      bio: users.bio,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        ne(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.firstName), asc(users.lastName), asc(users.id));
  return rows.map((row) => ({
    ...row,
    avatarUrl: safeAvatarSource(row.avatarUrl),
  }));
}

async function lockCourse(
  tx: CourseWidgetTransaction,
  courseId: string,
  organizationId: string,
) {
  const [course] = await tx
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  return course;
}

async function validateReferences(
  tx: CourseWidgetTransaction,
  input: CourseWidgetInput,
  organizationId: string,
  courseId: string,
  attachedById: string,
) {
  if (input.type === "author") {
    const [author] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.authorUserId),
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
          inArray(users.role, ["owner", "admin", "trainer"]),
        ),
      )
      .limit(1)
      .for("share");
    if (!author) {
      throw new ApiError(
        422,
        "validation_error",
        "Autor muss ein aktives Teammitglied dieser Organisation sein.",
      );
    }
    return;
  }
  if (input.type === "image_link" && input.mediaAssetId) {
    await bindReadyCourseMediaAssets(tx, {
      organizationId,
      courseId,
      attachedById,
      expectedAssets: new Map([[input.mediaAssetId, "image"]]),
      access: "manage",
    });
  }
}

async function touchCourse(
  tx: CourseWidgetTransaction,
  courseId: string,
  organizationId: string,
) {
  await tx
    .update(courses)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
      ),
    );
}

export async function createCourseWidget(
  tx: CourseWidgetTransaction,
  input: {
    organizationId: string;
    courseId: string;
    attachedById: string;
    widget: CourseWidgetInput;
  },
) {
  await lockCourse(tx, input.courseId, input.organizationId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`course-widgets:${input.courseId}`}))`,
  );
  await validateReferences(
    tx,
    input.widget,
    input.organizationId,
    input.courseId,
    input.attachedById,
  );
  const [last] = await tx
    .select({ sortOrder: courseWidgets.sortOrder })
    .from(courseWidgets)
    .where(
      and(
        eq(courseWidgets.courseId, input.courseId),
        eq(courseWidgets.organizationId, input.organizationId),
      ),
    )
    .orderBy(desc(courseWidgets.sortOrder), desc(courseWidgets.id))
    .limit(1);
  const values = courseWidgetValues(input.widget);
  const [created] = await tx
    .insert(courseWidgets)
    .values({
      ...values,
      organizationId: input.organizationId,
      courseId: input.courseId,
      sortOrder: values.sortOrder ?? (last?.sortOrder ?? -1) + 1,
    })
    .returning();
  await touchCourse(tx, input.courseId, input.organizationId);
  return created;
}

export async function updateCourseWidget(
  tx: CourseWidgetTransaction,
  input: {
    organizationId: string;
    courseId: string;
    widgetId: string;
    attachedById: string;
    widget: CourseWidgetInput;
  },
) {
  await lockCourse(tx, input.courseId, input.organizationId);
  const [current] = await tx
    .select()
    .from(courseWidgets)
    .where(
      and(
        eq(courseWidgets.id, input.widgetId),
        eq(courseWidgets.courseId, input.courseId),
        eq(courseWidgets.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!current) {
    throw new ApiError(404, "not_found", "Kurs-Widget nicht gefunden.");
  }
  if (current.type !== input.widget.type) {
    throw new ApiError(
      409,
      "conflict",
      "Der Widget-Typ kann nicht nachtraeglich geaendert werden.",
    );
  }
  await validateReferences(
    tx,
    input.widget,
    input.organizationId,
    input.courseId,
    input.attachedById,
  );
  const values = courseWidgetValues(input.widget);
  const [updated] = await tx
    .update(courseWidgets)
    .set({
      ...values,
      sortOrder: values.sortOrder ?? current.sortOrder,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(courseWidgets.id, current.id),
        eq(courseWidgets.organizationId, input.organizationId),
      ),
    )
    .returning();
  await touchCourse(tx, input.courseId, input.organizationId);
  return updated;
}

export async function deleteCourseWidget(
  tx: CourseWidgetTransaction,
  input: { organizationId: string; courseId: string; widgetId: string },
) {
  await lockCourse(tx, input.courseId, input.organizationId);
  const [deleted] = await tx
    .delete(courseWidgets)
    .where(
      and(
        eq(courseWidgets.id, input.widgetId),
        eq(courseWidgets.courseId, input.courseId),
        eq(courseWidgets.organizationId, input.organizationId),
      ),
    )
    .returning();
  if (!deleted) {
    throw new ApiError(404, "not_found", "Kurs-Widget nicht gefunden.");
  }
  await touchCourse(tx, input.courseId, input.organizationId);
  return deleted;
}

export async function reorderCourseWidgets(
  tx: CourseWidgetTransaction,
  input: {
    organizationId: string;
    courseId: string;
    orderedIds: string[];
  },
) {
  await lockCourse(tx, input.courseId, input.organizationId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`course-widgets:${input.courseId}`}))`,
  );
  const current = await tx
    .select({ id: courseWidgets.id })
    .from(courseWidgets)
    .where(
      and(
        eq(courseWidgets.courseId, input.courseId),
        eq(courseWidgets.organizationId, input.organizationId),
      ),
    );
  const currentIds = current.map((widget) => widget.id).sort();
  const nextIds = [...input.orderedIds].sort();
  if (
    currentIds.length !== nextIds.length ||
    currentIds.some((id, index) => id !== nextIds[index])
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Widget-Liste hat sich zwischenzeitlich geaendert.",
    );
  }
  for (const [sortOrder, id] of input.orderedIds.entries()) {
    await tx
      .update(courseWidgets)
      .set({ sortOrder, updatedAt: new Date() })
      .where(
        and(
          eq(courseWidgets.id, id),
          eq(courseWidgets.courseId, input.courseId),
          eq(courseWidgets.organizationId, input.organizationId),
        ),
      );
  }
  await touchCourse(tx, input.courseId, input.organizationId);
  return input.orderedIds;
}

export async function getCourseWidget(
  widgetId: string,
  courseId: string,
  organizationId: string,
) {
  const widgets = await listCourseWidgets(courseId, organizationId);
  const widget = widgets.find((entry) => entry.id === widgetId);
  if (!widget) {
    throw new ApiError(404, "not_found", "Kurs-Widget nicht gefunden.");
  }
  return widget;
}
