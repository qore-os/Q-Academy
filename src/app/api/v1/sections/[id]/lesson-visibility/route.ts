import { apiOptions, handleTransactionalApiCommand, parseJson } from "@/lib/api/handler";
import { sectionLessonVisibilityUpdateSchema } from "@/lib/section-lesson-visibility";
import { setSectionLessonsVisibility } from "@/lib/section-lesson-visibility-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function update(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["modules:write"],
      action: "section.lesson_visibility.update",
      resourceType: "section",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, sectionLessonVisibilityUpdateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const changed = await setSectionLessonsVisibility(tx, {
          organizationId: context.organizationId,
          sectionId: id,
          visibility: input.visibility,
        });
        await activity({
          type: "section.lesson_visibility.updated",
          entityType: "section",
          entityId: changed.sectionId,
          metadata: {
            moduleId: changed.moduleId,
            visibility: changed.visibility,
            updatedLessonCount: changed.updatedLessonCount,
          },
        });
        return { data: changed, resourceId: changed.sectionId };
      },
    },
  );
}

export const PATCH = update;
export const PUT = update;
