"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import {
  requireCoursePermission,
  requireCoursePermissionInTransaction,
} from "@/lib/course-permissions";
import {
  createCourseWidget,
  deleteCourseWidget,
  reorderCourseWidgets,
  updateCourseWidget,
} from "@/lib/course-widget-service";
import {
  courseWidgetCreateSchema,
  courseWidgetOrderSchema,
} from "@/lib/course-widgets";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type AppLocale,
} from "@/lib/i18n/model";
import { logServerError } from "@/lib/server-error-logging";

export type CourseWidgetActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

const idSchema = z.string().uuid();

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseWidgetForm(formData: FormData) {
  const type = value(formData, "type");
  const input =
    type === "author"
      ? {
          type,
          authorUserId: value(formData, "authorUserId"),
          roleLabel: value(formData, "roleLabel"),
          description: value(formData, "description"),
        }
      : type === "info"
        ? {
            type,
            title: value(formData, "title"),
            text: value(formData, "text"),
            linkUrl: value(formData, "linkUrl"),
          }
        : {
            type,
            mediaAssetId: value(formData, "mediaAssetId") || undefined,
            imageUrl: value(formData, "imageUrl") || undefined,
            altText: value(formData, "altText"),
            linkUrl: value(formData, "linkUrl"),
          };
  return courseWidgetCreateSchema.safeParse(input);
}

function failure(message: string): CourseWidgetActionResult {
  return { ok: false, message };
}

function revalidateCourseWidgets(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  revalidatePath("/academy/courses");
  revalidatePath("/academy/courses/[slug]", "page");
}

function mutationFailure(error: unknown, locale: AppLocale) {
  logServerError(error, { action: "course.widget.mutation" });
  return failure(getCourseSupportCopy(locale).actions.widget.failed);
}

export async function createCourseWidgetAction(
  courseId: string,
  formData: FormData,
): Promise<CourseWidgetActionResult> {
  const locale = normalizeLocale(formData.get("locale"));
  const copy = getCourseSupportCopy(locale).actions.widget;
  const { user } = await requireCoursePermission(courseId, "edit");
  if (!idSchema.safeParse(courseId).success)
    return failure(copy.invalidCourse);
  const parsed = parseWidgetForm(formData);
  if (!parsed.success) {
    return failure(copy.invalidWidget);
  }
  try {
    const created = await db.transaction(async (tx) => {
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const widget = await createCourseWidget(tx, {
        organizationId: user.organizationId,
        courseId,
        attachedById: user.id,
        widget: parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.widget.created",
        entityType: "course_widget",
        entityId: widget.id,
        metadata: { courseId, widgetType: widget.type },
      });
      return widget;
    });
    revalidateCourseWidgets(courseId);
    return { ok: true, message: copy.createSuccess, id: created.id };
  } catch (error) {
    return mutationFailure(error, locale);
  }
}

export async function updateCourseWidgetAction(
  courseId: string,
  widgetId: string,
  formData: FormData,
): Promise<CourseWidgetActionResult> {
  const locale = normalizeLocale(formData.get("locale"));
  const copy = getCourseSupportCopy(locale).actions.widget;
  const { user } = await requireCoursePermission(courseId, "edit");
  const ids = z
    .object({ courseId: idSchema, widgetId: idSchema })
    .safeParse({ courseId, widgetId });
  if (!ids.success) return failure(copy.invalidWidget);
  const parsed = parseWidgetForm(formData);
  if (!parsed.success) {
    return failure(copy.invalidWidget);
  }
  try {
    const updated = await db.transaction(async (tx) => {
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const widget = await updateCourseWidget(tx, {
        organizationId: user.organizationId,
        courseId: ids.data.courseId,
        widgetId: ids.data.widgetId,
        attachedById: user.id,
        widget: parsed.data,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.widget.updated",
        entityType: "course_widget",
        entityId: widget.id,
        metadata: { courseId, widgetType: widget.type },
      });
      return widget;
    });
    revalidateCourseWidgets(courseId);
    return { ok: true, message: copy.updateSuccess, id: updated.id };
  } catch (error) {
    return mutationFailure(error, locale);
  }
}

export async function deleteCourseWidgetAction(
  courseId: string,
  widgetId: string,
  requestedLocale: AppLocale = DEFAULT_LOCALE,
): Promise<CourseWidgetActionResult> {
  const locale = normalizeLocale(requestedLocale);
  const copy = getCourseSupportCopy(locale).actions.widget;
  const { user } = await requireCoursePermission(courseId, "edit");
  const ids = z
    .object({ courseId: idSchema, widgetId: idSchema })
    .safeParse({ courseId, widgetId });
  if (!ids.success) return failure(copy.invalidWidget);
  try {
    await db.transaction(async (tx) => {
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const widget = await deleteCourseWidget(tx, {
        organizationId: user.organizationId,
        courseId: ids.data.courseId,
        widgetId: ids.data.widgetId,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.widget.deleted",
        entityType: "course_widget",
        entityId: widget.id,
        metadata: { courseId, widgetType: widget.type },
      });
    });
    revalidateCourseWidgets(courseId);
    return { ok: true, message: copy.deleteSuccess };
  } catch (error) {
    return mutationFailure(error, locale);
  }
}

export async function reorderCourseWidgetsAction(
  courseId: string,
  orderedIds: string[],
  requestedLocale: AppLocale = DEFAULT_LOCALE,
): Promise<CourseWidgetActionResult> {
  const locale = normalizeLocale(requestedLocale);
  const copy = getCourseSupportCopy(locale).actions.widget;
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({ courseId: idSchema, order: courseWidgetOrderSchema })
    .safeParse({ courseId, order: { orderedIds } });
  if (!parsed.success) return failure(copy.invalidOrder);
  try {
    await db.transaction(async (tx) => {
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      await reorderCourseWidgets(tx, {
        organizationId: user.organizationId,
        courseId: parsed.data.courseId,
        orderedIds: parsed.data.order.orderedIds,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.widget.reordered",
        entityType: "course",
        entityId: parsed.data.courseId,
        metadata: { widgetIds: parsed.data.order.orderedIds },
      });
    });
    revalidateCourseWidgets(courseId);
    return { ok: true, message: copy.reorderSuccess };
  } catch (error) {
    return mutationFailure(error, locale);
  }
}
