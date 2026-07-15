import { and, asc, count, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { courseCategories, courses } from "@/db/schema";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { courseCategoryCreateSchema } from "@/lib/api/schemas";
import { createCourseCategory } from "@/lib/course-categories";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["courses:read"], action: "course_category.list", resourceType: "course_category" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(courseCategories.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    if (search) conditions.push(ilike(courseCategories.name, `%${search}%`));
    const rows = await db
      .select({
        id: courseCategories.id,
        name: courseCategories.name,
        slug: courseCategories.slug,
        description: courseCategories.description,
        color: courseCategories.color,
        sortOrder: courseCategories.sortOrder,
        courseCount: count(courses.id),
      })
      .from(courseCategories)
      .leftJoin(
        courses,
        and(
          eq(courses.categoryId, courseCategories.id),
          eq(courses.organizationId, context.organizationId),
        ),
      )
      .where(and(...conditions))
      .groupBy(courseCategories.id)
      .orderBy(asc(courseCategories.sortOrder), asc(courseCategories.name))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course_category.create",
      resourceType: "course_category",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseCategoryCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const category = await createCourseCategory(
          tx,
          context.organizationId,
          input,
        );
        await activity({
          type: "course_category.created",
          entityType: "course_category",
          entityId: category.id,
          metadata: {
            name: category.name,
            color: category.color,
            sortOrder: category.sortOrder,
          },
        });
        return {
          data: category,
          status: 201,
          resourceId: category.id,
        };
      },
    },
  );
}
