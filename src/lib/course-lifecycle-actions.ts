"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { activityEvents, courses } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireAdmin } from "@/lib/auth";
import {
  coursePermissionAllows,
  coursePermissionForUser,
  requireCoursePermissionInTransaction,
} from "@/lib/course-permissions";
import {
  assertCourseCanBecomeUnavailable,
  clearPublishedCourseLinkEdges,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";
import {
  COURSE_LIFECYCLE_PRESERVED_DATA,
  courseLifecycleTransition,
} from "@/lib/course-lifecycle";
import {
  getCourseParityCopy,
  type CourseLifecycleActionCode,
} from "@/lib/i18n/course-parity";
import { normalizeLocale, type AppLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { logServerError } from "@/lib/server-error-logging";

export type CourseLifecycleActionResult = {
  ok: boolean;
  code: CourseLifecycleActionCode;
  message: string;
  status?: "draft" | "archived";
};

const inputSchema = z
  .object({
    courseId: z.string().uuid(),
    operation: z.enum(["archive", "restore"]),
  })
  .strict();

function refreshCourseLifecycle(courseId: string) {
  revalidatePath("/admin/courses");
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/academy/courses");
  revalidatePath("/academy", "layout");
}

export async function changeCourseLifecycleAction(
  courseId: string,
  operation: "archive" | "restore",
  requestedLocale?: AppLocale,
): Promise<CourseLifecycleActionResult> {
  const actor = await requireAdmin();
  const locale = normalizeLocale(
    requestedLocale,
    await resolveUserLocale(actor),
  );
  const copy = getCourseParityCopy(locale).lifecycle;
  const failure = (
    code: Exclude<
      CourseLifecycleActionCode,
      "course_lifecycle.archived" | "course_lifecycle.restored"
    >,
  ): CourseLifecycleActionResult => ({
    ok: false,
    code,
    message: copy.action[code],
  });
  const parsed = inputSchema.safeParse({ courseId, operation });
  if (!parsed.success) return failure("course_lifecycle.invalid_input");

  const permission = await coursePermissionForUser(actor, parsed.data.courseId);
  if (!coursePermissionAllows(permission, "manage")) {
    return failure("course_lifecycle.permission_denied");
  }

  try {
    const status = await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, actor.organizationId);
      await requireCoursePermissionInTransaction(
        tx,
        actor,
        parsed.data.courseId,
        "manage",
      );
      const [current] = await tx
        .select({ id: courses.id, status: courses.status })
        .from(courses)
        .where(
          and(
            eq(courses.id, parsed.data.courseId),
            eq(courses.organizationId, actor.organizationId),
          ),
        )
        .limit(1)
        .for("update", { of: courses });
      if (!current) {
        throw new ApiError(404, "not_found", "Course not found.");
      }

      const nextStatus = courseLifecycleTransition(
        current.status,
        parsed.data.operation,
      );
      if (!nextStatus) {
        throw new ApiError(422, "validation_error", "Invalid course lifecycle state.");
      }
      if (parsed.data.operation === "archive") {
        await assertCourseCanBecomeUnavailable(tx, {
          organizationId: actor.organizationId,
          courseId: current.id,
        });
        await clearPublishedCourseLinkEdges(tx, {
          organizationId: actor.organizationId,
          sourceCourseId: current.id,
        });
      }

      await tx
        .update(courses)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(
          and(
            eq(courses.id, current.id),
            eq(courses.organizationId, actor.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type:
          parsed.data.operation === "archive"
            ? "course.archived"
            : "course.restored",
        entityType: "course",
        entityId: current.id,
        metadata: {
          previousStatus: current.status,
          nextStatus,
          preservedData: COURSE_LIFECYCLE_PRESERVED_DATA,
        },
      });
      return nextStatus;
    });

    refreshCourseLifecycle(parsed.data.courseId);
    const code =
      status === "archived"
        ? "course_lifecycle.archived"
        : "course_lifecycle.restored";
    return { ok: true, code, message: copy.action[code], status };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 404) return failure("course_lifecycle.not_found");
      if (error.status === 403) {
        return failure("course_lifecycle.permission_denied");
      }
      if (error.status === 409) {
        return failure("course_lifecycle.link_conflict");
      }
      if (error.status === 422) {
        return failure("course_lifecycle.invalid_state");
      }
    }
    logServerError(error, { action: "course.lifecycle.change" });
    return failure("course_lifecycle.failed");
  }
}
