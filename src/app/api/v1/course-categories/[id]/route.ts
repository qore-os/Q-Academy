import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courseCategories } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { courseCategoryUpdateSchema } from "@/lib/api/schemas";
import {
  deleteCourseCategory,
  updateCourseCategory,
} from "@/lib/course-categories";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function categoryForOrganization(id: string, organizationId: string) {
  const [category] = await db.select().from(courseCategories).where(and(eq(courseCategories.id, id), eq(courseCategories.organizationId, organizationId))).limit(1);
  if (!category) throw new ApiError(404, "not_found", "Kategorie nicht gefunden.");
  return category;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["courses:read"], action: "course_category.read", resourceType: "course_category" }, async (context) => ({ data: await categoryForOrganization(id, context.organizationId), resourceId: id }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course_category.update",
      resourceType: "course_category",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseCategoryUpdateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const saved = await updateCourseCategory(
          tx,
          context.organizationId,
          id,
          input,
        );
        await activity({
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
        return { data: saved.category, resourceId: saved.category.id };
      },
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course_category.delete",
      resourceType: "course_category",
      idempotent: true,
    },
    {
      prepare: async () => null,
      execute: async ({ context, tx, activity }) => {
        const deleted = await deleteCourseCategory(
          tx,
          context.organizationId,
          id,
          { confirmAssigned: true },
        );
        await activity({
          type: "course_category.deleted",
          entityType: "course_category",
          entityId: deleted.category.id,
          metadata: {
            name: deleted.category.name,
            unassignedCourseCount: deleted.courseCount,
          },
        });
        return {
          data: {
            id: deleted.category.id,
            deleted: true,
            unassignedCourseCount: deleted.courseCount,
          },
          resourceId: deleted.category.id,
        };
      },
    },
  );
}
