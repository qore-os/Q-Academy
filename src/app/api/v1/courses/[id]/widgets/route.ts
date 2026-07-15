import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { courses } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  courseWidgetCreateSchema,
  courseWidgetOrderSchema,
} from "@/lib/api/schemas";
import {
  createCourseWidget,
  listCourseWidgets,
  reorderCourseWidgets,
} from "@/lib/course-widget-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.widget.list",
      resourceType: "course_widget",
    },
    async (context) => {
      const data = await listCourseWidgets(id, context.organizationId);
      if (!data.length) {
        const [course] = await db
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.id, id),
              eq(courses.organizationId, context.organizationId),
            ),
          )
          .limit(1);
        if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      }
      return { data, resourceId: id };
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.widget.create",
      resourceType: "course_widget",
      idempotent: true,
    },
    {
      prepare: async () => parseJson(request, courseWidgetCreateSchema),
      execute: async ({ context, tx, activity }, widget) => {
        const actor = await requireActiveApiKeyCreator(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const created = await createCourseWidget(tx, {
          organizationId: context.organizationId,
          courseId: id,
          attachedById: actor.id,
          widget,
        });
        await activity({
          type: "course.widget.created",
          entityType: "course_widget",
          entityId: created.id,
          metadata: { courseId: id, widgetType: created.type },
        });
        return { data: created, status: 201, resourceId: created.id };
      },
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.widget.reorder",
      resourceType: "course_widget",
      idempotent: true,
    },
    {
      prepare: async () => parseJson(request, courseWidgetOrderSchema),
      execute: async ({ context, tx, activity }, input) => {
        const orderedIds = await reorderCourseWidgets(tx, {
          organizationId: context.organizationId,
          courseId: id,
          orderedIds: input.orderedIds,
        });
        await activity({
          type: "course.widget.reordered",
          entityType: "course",
          entityId: id,
          metadata: { widgetIds: orderedIds },
        });
        return { data: { courseId: id, orderedIds }, resourceId: id };
      },
    },
  );
}
