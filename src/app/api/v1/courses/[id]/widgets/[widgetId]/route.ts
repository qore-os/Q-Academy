import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { courseWidgetUpdateSchema } from "@/lib/api/schemas";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import {
  deleteCourseWidget,
  getCourseWidget,
  updateCourseWidget,
} from "@/lib/course-widget-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type WidgetParams = { params: Promise<{ id: string; widgetId: string }> };

export async function GET(request: Request, { params }: WidgetParams) {
  const { id, widgetId } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.widget.read",
      resourceType: "course_widget",
    },
    async (context) => ({
      data: await getCourseWidget(widgetId, id, context.organizationId),
      resourceId: widgetId,
    }),
  );
}

export async function PATCH(request: Request, { params }: WidgetParams) {
  const { id, widgetId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.widget.update",
      resourceType: "course_widget",
      idempotent: true,
    },
    {
      prepare: async () => parseJson(request, courseWidgetUpdateSchema),
      execute: async ({ context, tx, activity }, widget) => {
        const actor = await requireActiveApiKeyCreator(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const updated = await updateCourseWidget(tx, {
          organizationId: context.organizationId,
          courseId: id,
          widgetId,
          attachedById: actor.id,
          widget,
        });
        await activity({
          type: "course.widget.updated",
          entityType: "course_widget",
          entityId: widgetId,
          metadata: { courseId: id, widgetType: updated.type },
        });
        return { data: updated, resourceId: widgetId };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: WidgetParams) {
  const { id, widgetId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.widget.delete",
      resourceType: "course_widget",
      idempotent: true,
    },
    {
      prepare: async () => null,
      execute: async ({ context, tx, activity }) => {
        const deleted = await deleteCourseWidget(tx, {
          organizationId: context.organizationId,
          courseId: id,
          widgetId,
        });
        await activity({
          type: "course.widget.deleted",
          entityType: "course_widget",
          entityId: widgetId,
          metadata: { courseId: id, widgetType: deleted.type },
        });
        return {
          data: { courseId: id, widgetId, deleted: true },
          resourceId: widgetId,
        };
      },
    },
  );
}
