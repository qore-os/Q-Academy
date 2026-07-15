import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { courseCategories, courses } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { isExactCourseCategoryOrder } from "@/lib/course-category-model";
import { slugify } from "@/lib/utils";

export type CourseCategoryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type CourseCategoryCreateInput = {
  name: string;
  slug?: string;
  description?: string | null;
  color: string;
  sortOrder: number;
};

type CourseCategoryUpdateInput = Partial<CourseCategoryCreateInput>;

export async function lockCourseCategoryNamespace(
  tx: CourseCategoryTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`course-categories:${organizationId}`}, 0))`,
  );
}

async function lockedCategory(
  tx: CourseCategoryTransaction,
  organizationId: string,
  categoryId: string,
) {
  const [category] = await tx
    .select()
    .from(courseCategories)
    .where(
      and(
        eq(courseCategories.id, categoryId),
        eq(courseCategories.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!category) {
    throw new ApiError(404, "not_found", "Kategorie nicht gefunden.");
  }
  return category;
}

async function assertUniqueSlug(
  tx: CourseCategoryTransaction,
  organizationId: string,
  slug: string,
  excludedCategoryId?: string,
) {
  const [duplicate] = await tx
    .select({ id: courseCategories.id })
    .from(courseCategories)
    .where(
      and(
        eq(courseCategories.organizationId, organizationId),
        eq(courseCategories.slug, slug),
      ),
    )
    .limit(1);
  if (duplicate && duplicate.id !== excludedCategoryId) {
    throw new ApiError(
      409,
      "conflict",
      "Eine Kategorie mit diesem Slug existiert bereits.",
    );
  }
}

export async function createCourseCategory(
  tx: CourseCategoryTransaction,
  organizationId: string,
  input: CourseCategoryCreateInput,
) {
  await lockCourseCategoryNamespace(tx, organizationId);
  const slug = input.slug ?? slugify(input.name);
  await assertUniqueSlug(tx, organizationId, slug);
  const [category] = await tx
    .insert(courseCategories)
    .values({ ...input, slug, organizationId })
    .returning();
  return category;
}

export async function updateCourseCategory(
  tx: CourseCategoryTransaction,
  organizationId: string,
  categoryId: string,
  input: CourseCategoryUpdateInput,
) {
  await lockCourseCategoryNamespace(tx, organizationId);
  const current = await lockedCategory(tx, organizationId, categoryId);
  if (input.slug && input.slug !== current.slug) {
    await assertUniqueSlug(tx, organizationId, input.slug, current.id);
  }
  const [category] = await tx
    .update(courseCategories)
    .set(input)
    .where(
      and(
        eq(courseCategories.id, current.id),
        eq(courseCategories.organizationId, organizationId),
      ),
    )
    .returning();
  return { current, category };
}

export async function deleteCourseCategory(
  tx: CourseCategoryTransaction,
  organizationId: string,
  categoryId: string,
  options: Readonly<{
    confirmAssigned: boolean;
    expectedCourseCount?: number;
  }>,
) {
  await lockCourseCategoryNamespace(tx, organizationId);
  const category = await lockedCategory(tx, organizationId, categoryId);
  const assignedCourses = await tx
    .select({ id: courses.id, organizationId: courses.organizationId })
    .from(courses)
    .where(eq(courses.categoryId, category.id))
    .orderBy(asc(courses.id))
    .for("update");
  if (
    assignedCourses.some(
      (course) => course.organizationId !== organizationId,
    )
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Kategorie kann wegen einer inkonsistenten Mandantenzuordnung nicht geloescht werden.",
    );
  }
  if (
    options.confirmAssigned &&
    "expectedCourseCount" in options &&
    typeof options.expectedCourseCount === "number" &&
    assignedCourses.length !== options.expectedCourseCount
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Kursbelegung hat sich geaendert. Bitte bestaetige die aktuelle Belegung erneut.",
      { courseCount: assignedCourses.length },
    );
  }
  if (assignedCourses.length > 0 && !options.confirmAssigned) {
    throw new ApiError(
      409,
      "conflict",
      "Die Kategorie wird noch von Kursen verwendet.",
      { courseCount: assignedCourses.length },
    );
  }
  if (assignedCourses.length > 0) {
    await tx
      .update(courses)
      .set({ categoryId: null })
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(courses.categoryId, category.id),
        ),
      );
  }
  const [deleted] = await tx
    .delete(courseCategories)
    .where(
      and(
        eq(courseCategories.id, category.id),
        eq(courseCategories.organizationId, organizationId),
      ),
    )
    .returning({ id: courseCategories.id });
  if (!deleted) {
    throw new ApiError(409, "conflict", "Die Kategorie wurde nicht geloescht.");
  }
  return { category, courseCount: assignedCourses.length };
}

export async function reorderCourseCategories(
  tx: CourseCategoryTransaction,
  organizationId: string,
  requestedCategoryIds: readonly string[],
) {
  await lockCourseCategoryNamespace(tx, organizationId);
  const current = await tx
    .select({ id: courseCategories.id })
    .from(courseCategories)
    .where(eq(courseCategories.organizationId, organizationId))
    .orderBy(asc(courseCategories.id))
    .for("update");
  const currentCategoryIds = current.map((category) => category.id);
  if (!isExactCourseCategoryOrder(currentCategoryIds, requestedCategoryIds)) {
    throw new ApiError(
      409,
      "conflict",
      "Die Kategorien haben sich geaendert. Lade die aktuelle Reihenfolge neu.",
      { currentCategoryIds },
    );
  }
  for (const [sortOrder, categoryId] of requestedCategoryIds.entries()) {
    await tx
      .update(courseCategories)
      .set({ sortOrder })
      .where(
        and(
          eq(courseCategories.id, categoryId),
          eq(courseCategories.organizationId, organizationId),
        ),
      );
  }
  return requestedCategoryIds.map((id, sortOrder) => ({ id, sortOrder }));
}
