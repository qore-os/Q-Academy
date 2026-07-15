"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  courseCategories,
  courses,
  teamRoleAssignments,
  teamRoles,
  users,
  type User,
} from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { ApiError } from "@/lib/api/errors";
import { courseCategoryCreateSchema } from "@/lib/api/schemas";
import { courseCategoryReorderSchema } from "@/lib/course-category-model";
import { canManageCourseCategories } from "@/lib/course-category-policy";
import {
  createCourseCategory,
  deleteCourseCategory,
  lockCourseCategoryNamespace,
  reorderCourseCategories,
  updateCourseCategory,
  type CourseCategoryTransaction,
} from "@/lib/course-categories";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type AppLocale,
} from "@/lib/i18n/model";
import { logServerError } from "@/lib/server-error-logging";

export type CourseCategoryActionState = {
  ok: boolean | null;
  message: string;
  code?: string;
  courseCount?: number;
};

const categoryIdSchema = z.string().uuid();
const categoryFormSchema = courseCategoryCreateSchema.pick({
  name: true,
  description: true,
  color: true,
});

type BrowserCategoryActor = Pick<User, "id" | "organizationId" | "role">;

async function assertCourseCategoryManager(
  tx: CourseCategoryTransaction,
  actor: BrowserCategoryActor,
) {
  const [currentActor] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.role, actor.role),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!currentActor || currentActor.role === "member") {
    throw new ApiError(
      403,
      "forbidden",
      "Deine Berechtigung zur Kategorienverwaltung ist nicht mehr aktiv.",
    );
  }

  const [assignment] = await tx
    .select({ roleId: teamRoleAssignments.roleId })
    .from(teamRoleAssignments)
    .where(
      and(
        eq(teamRoleAssignments.organizationId, actor.organizationId),
        eq(teamRoleAssignments.userId, currentActor.id),
      ),
    )
    .limit(1)
    .for("share");
  const [customRole] = assignment
    ? await tx
        .select({
          active: teamRoles.active,
          permissions: teamRoles.permissions,
        })
        .from(teamRoles)
        .where(
          and(
            eq(teamRoles.id, assignment.roleId),
            eq(teamRoles.organizationId, actor.organizationId),
          ),
        )
        .limit(1)
        .for("share")
    : [];
  if (
    !canManageCourseCategories({
      role: currentActor.role,
      assignmentExists: Boolean(assignment),
      customRoleActive: customRole?.active,
      customPermissions: customRole?.permissions,
    })
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Deine Berechtigung zur Kategorienverwaltung ist nicht mehr aktiv.",
    );
  }
  return currentActor;
}

function parsedCategoryForm(formData: FormData) {
  return categoryFormSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || null,
    color: formData.get("color"),
  });
}

function actionFailure(
  error: unknown,
  locale: AppLocale,
): CourseCategoryActionState {
  const copy = getCourseSupportCopy(locale).actions.category;
  if (error instanceof ApiError) {
    const courseCount =
      error.details &&
      typeof error.details === "object" &&
      "courseCount" in error.details &&
      typeof error.details.courseCount === "number"
        ? error.details.courseCount
        : undefined;
    return {
      ok: false,
      message: copy.failed,
      code: error.code,
      ...(courseCount === undefined ? {} : { courseCount }),
    };
  }
  logServerError(error, { action: "course.category.mutation" });
  return { ok: false, message: copy.failed };
}

export async function createCourseCategoryAdminAction(
  _state: CourseCategoryActionState,
  formData: FormData,
): Promise<CourseCategoryActionState> {
  const locale = normalizeLocale(formData.get("locale"));
  const copy = getCourseSupportCopy(locale).actions.category;
  const actor = await requireAdmin();
  const parsed = parsedCategoryForm(formData);
  if (!parsed.success) {
    return {
      ok: false,
      message: copy.invalid,
    };
  }
  try {
    await db.transaction(async (tx) => {
      const currentActor = await assertCourseCategoryManager(tx, actor);
      await lockCourseCategoryNamespace(tx, actor.organizationId);
      const [position] = await tx
        .select({
          next: sql<number>`coalesce(max(${courseCategories.sortOrder}), -1) + 1`,
        })
        .from(courseCategories)
        .where(eq(courseCategories.organizationId, actor.organizationId));
      const category = await createCourseCategory(tx, actor.organizationId, {
        name: parsed.data.name,
        description: parsed.data.description || null,
        color: parsed.data.color,
        sortOrder: Number(position?.next ?? 0),
      });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: currentActor.id,
        type: "course_category.created",
        entityType: "course_category",
        entityId: category.id,
        metadata: {
          name: category.name,
          color: category.color,
          sortOrder: category.sortOrder,
        },
      });
    });
  } catch (error) {
    return actionFailure(error, locale);
  }
  revalidatePath("/admin/courses");
  return { ok: true, message: copy.createSuccess };
}

export async function updateCourseCategoryAdminAction(
  categoryId: string,
  _state: CourseCategoryActionState,
  formData: FormData,
): Promise<CourseCategoryActionState> {
  const locale = normalizeLocale(formData.get("locale"));
  const copy = getCourseSupportCopy(locale).actions.category;
  const actor = await requireAdmin();
  const parsedId = categoryIdSchema.safeParse(categoryId);
  const parsed = parsedCategoryForm(formData);
  if (!parsedId.success || !parsed.success) {
    return {
      ok: false,
      message: copy.invalid,
    };
  }
  try {
    await db.transaction(async (tx) => {
      const currentActor = await assertCourseCategoryManager(tx, actor);
      const saved = await updateCourseCategory(
        tx,
        actor.organizationId,
        parsedId.data,
        {
          name: parsed.data.name,
          description: parsed.data.description || null,
          color: parsed.data.color,
        },
      );
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: currentActor.id,
        type: "course_category.updated",
        entityType: "course_category",
        entityId: saved.category.id,
        metadata: {
          previous: {
            name: saved.current.name,
            color: saved.current.color,
          },
          current: {
            name: saved.category.name,
            color: saved.category.color,
          },
        },
      });
    });
  } catch (error) {
    return actionFailure(error, locale);
  }
  revalidatePath("/admin/courses");
  return { ok: true, message: copy.updateSuccess };
}

export async function deleteCourseCategoryAdminAction(
  categoryId: string,
  expectedCourseCount: number,
  requestedLocale: AppLocale = DEFAULT_LOCALE,
): Promise<CourseCategoryActionState> {
  const locale = normalizeLocale(requestedLocale);
  const copy = getCourseSupportCopy(locale).actions.category;
  const actor = await requireAdmin();
  const parsedId = categoryIdSchema.safeParse(categoryId);
  const parsedCourseCount = z.number().int().min(0).safeParse(expectedCourseCount);
  if (!parsedId.success || !parsedCourseCount.success) {
    return { ok: false, message: copy.invalid };
  }
  let courseCount = 0;
  try {
    await db.transaction(async (tx) => {
      const currentActor = await assertCourseCategoryManager(tx, actor);
      const deleted = await deleteCourseCategory(
        tx,
        actor.organizationId,
        parsedId.data,
        {
          confirmAssigned: true,
          expectedCourseCount: parsedCourseCount.data,
        },
      );
      courseCount = deleted.courseCount;
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: currentActor.id,
        type: "course_category.deleted",
        entityType: "course_category",
        entityId: deleted.category.id,
        metadata: {
          name: deleted.category.name,
          unassignedCourseCount: deleted.courseCount,
        },
      });
    });
  } catch (error) {
    return actionFailure(error, locale);
  }
  revalidatePath("/admin/courses");
  return {
    ok: true,
    message: copy.deleteSuccess,
    courseCount,
  };
}

export async function previewCourseCategoryDeletionAdminAction(
  categoryId: string,
  requestedLocale: AppLocale = DEFAULT_LOCALE,
): Promise<CourseCategoryActionState> {
  const locale = normalizeLocale(requestedLocale);
  const copy = getCourseSupportCopy(locale).actions.category;
  const actor = await requireAdmin();
  const parsedId = categoryIdSchema.safeParse(categoryId);
  if (!parsedId.success) {
    return { ok: false, message: copy.invalid };
  }
  try {
    const courseCount = await db.transaction(async (tx) => {
      await assertCourseCategoryManager(tx, actor);
      await lockCourseCategoryNamespace(tx, actor.organizationId);
      const [category] = await tx
        .select({ id: courseCategories.id })
        .from(courseCategories)
        .where(
          and(
            eq(courseCategories.id, parsedId.data),
            eq(courseCategories.organizationId, actor.organizationId),
          ),
        )
        .limit(1)
        .for("share");
      if (!category) {
        throw new ApiError(404, "not_found", "Kategorie nicht gefunden.");
      }
      const [usage] = await tx
        .select({
          value: sql<number>`count(*)::int`.mapWith(Number),
        })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, actor.organizationId),
            eq(courses.categoryId, category.id),
          ),
        );
      return usage?.value ?? 0;
    });
    return {
      ok: true,
      message: copy.usageLoaded,
      courseCount,
    };
  } catch (error) {
    return actionFailure(error, locale);
  }
}

export async function reorderCourseCategoriesAdminAction(
  categoryIds: string[],
  requestedLocale: AppLocale = DEFAULT_LOCALE,
): Promise<CourseCategoryActionState> {
  const locale = normalizeLocale(requestedLocale);
  const copy = getCourseSupportCopy(locale).actions.category;
  const actor = await requireAdmin();
  const parsed = courseCategoryReorderSchema.safeParse({ categoryIds });
  if (!parsed.success) {
    return {
      ok: false,
      message: copy.reorderInvalid,
    };
  }
  try {
    await db.transaction(async (tx) => {
      const currentActor = await assertCourseCategoryManager(tx, actor);
      const ordered = await reorderCourseCategories(
        tx,
        actor.organizationId,
        parsed.data.categoryIds,
      );
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: currentActor.id,
        type: "course_category.reordered",
        entityType: "course_category",
        metadata: { categoryIds: ordered.map((category) => category.id) },
      });
    });
  } catch (error) {
    return actionFailure(error, locale);
  }
  revalidatePath("/admin/courses");
  return { ok: true, message: copy.reorderSuccess };
}
