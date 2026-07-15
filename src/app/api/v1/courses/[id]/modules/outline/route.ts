import { apiOptions, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { courseModuleOutlineSchema } from "@/lib/api/schemas";
import { replaceCourseOutline } from "@/lib/course-outline-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module.outline.update",
      resourceType: "course",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleOutlineSchema),
      execute: async ({ context, tx, activity }, input) => {
        const outline = await replaceCourseOutline(tx, {
          organizationId: context.organizationId,
          courseId: id,
          items: input.items,
        });
        await activity({
          type: "course.module.outline.updated",
          entityType: "course",
          entityId: id,
          metadata: { moduleCount: outline.length },
        });
        return { data: { courseId: id, items: outline }, resourceId: id };
      },
    },
  );
}
