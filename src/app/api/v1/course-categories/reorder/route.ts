import { apiOptions, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { courseCategoryReorderSchema } from "@/lib/course-category-model";
import { reorderCourseCategories } from "@/lib/course-categories";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function PATCH(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course_category.reorder",
      resourceType: "course_category",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseCategoryReorderSchema),
      execute: async ({ context, tx, activity }, input) => {
        const categories = await reorderCourseCategories(
          tx,
          context.organizationId,
          input.categoryIds,
        );
        await activity({
          type: "course_category.reordered",
          entityType: "course_category",
          metadata: { categoryIds: input.categoryIds },
        });
        return { data: categories };
      },
    },
  );
}
