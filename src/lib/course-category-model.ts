import { z } from "zod";

export const MAX_COURSE_CATEGORIES_PER_REORDER = 1_000;

export const courseCategoryReorderSchema = z
  .object({
    categoryIds: z
      .array(z.string().uuid())
      .max(MAX_COURSE_CATEGORIES_PER_REORDER),
  })
  .strict()
  .refine(
    ({ categoryIds }) => new Set(categoryIds).size === categoryIds.length,
    {
      message: "Kategorie-IDs duerfen nicht doppelt vorkommen.",
      path: ["categoryIds"],
    },
  );

export function isExactCourseCategoryOrder(
  currentCategoryIds: readonly string[],
  requestedCategoryIds: readonly string[],
) {
  if (currentCategoryIds.length !== requestedCategoryIds.length) return false;
  const current = new Set(currentCategoryIds);
  return (
    current.size === requestedCategoryIds.length &&
    requestedCategoryIds.every((categoryId) => current.has(categoryId))
  );
}
