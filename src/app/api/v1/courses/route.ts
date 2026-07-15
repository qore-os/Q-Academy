import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { courseCategories, courses } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import { publishCourseVersion } from "@/lib/api/course-versioning";
import { replaceCourseInformationCollections } from "@/lib/course-information-service";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { courseCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { safeCourseCoverSource } from "@/lib/course-cover";
import { slugify } from "@/lib/utils";
import { assertOrganizationCourseCapacity } from "@/lib/organization-contracts";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["courses:read"], action: "course.list", resourceType: "course" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(courses.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const status = url.searchParams.get("status");
    const categoryId = url.searchParams.get("categoryId");
    if (search) conditions.push(or(ilike(courses.title, `%${search}%`), ilike(courses.shortDescription, `%${search}%`))!);
    if (status && ["draft", "published", "archived"].includes(status)) conditions.push(eq(courses.status, status as "draft" | "published" | "archived"));
    if (categoryId) conditions.push(eq(courses.categoryId, categoryId));
    const sort = url.searchParams.get("sort") ?? "updatedAt:desc";
    const order = sort === "title:asc" ? asc(courses.title) : sort === "createdAt:asc" ? asc(courses.createdAt) : desc(courses.updatedAt);
    const rows = await db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        shortDescription: courses.shortDescription,
        description: courses.description,
        coverImage: courses.coverImage,
        status: courses.status,
        difficulty: courses.difficulty,
        estimatedMinutes: courses.estimatedMinutes,
        certificateEnabled: courses.certificateEnabled,
        featured: courses.featured,
        visibleInCatalog: courses.visibleInCatalog,
        showProgressPercentage: courses.showProgressPercentage,
        notifyMembersOnModuleRelease: courses.notifyMembersOnModuleRelease,
        categoryId: courses.categoryId,
        categoryName: courseCategories.name,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .leftJoin(courseCategories, eq(courseCategories.id, courses.categoryId))
      .where(and(...conditions))
      .orderBy(order)
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(
      (course) => ({
        ...course,
        coverImage: safeCourseCoverSource(course.coverImage),
      }),
    );
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(
    request,
    { scopes: ["courses:write"], action: "course.create", resourceType: "course", idempotent: true },
    async (context) => {
      const input = await parseJson(request, courseCreateSchema);
      const { learningGoals, authorIds, ...courseInput } = input;
      const slug = input.slug ?? slugify(input.title);
      const [existing] = await db
        .select({ id: courses.id })
        .from(courses)
        .where(and(eq(courses.organizationId, context.organizationId), eq(courses.slug, slug)))
        .limit(1);
      if (existing) throw new ApiError(409, "conflict", "Ein Kurs mit diesem Slug existiert bereits.", { field: "slug" });
      if (input.categoryId) {
        const [category] = await db
          .select({ id: courseCategories.id })
          .from(courseCategories)
          .where(and(eq(courseCategories.id, input.categoryId), eq(courseCategories.organizationId, context.organizationId)))
          .limit(1);
        if (!category) throw new ApiError(422, "validation_error", "categoryId gehoert nicht zu dieser Organisation.");
      }
      const course = await db.transaction(async (transaction) => {
        const actor = await requireActiveApiKeyCreator(transaction, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        await assertOrganizationCourseCapacity(
          transaction,
          context.organizationId,
        );
        const [created] = await transaction
          .insert(courses)
          .values({
            ...courseInput,
            status: input.status === "published" ? "draft" : input.status,
            slug,
            organizationId: context.organizationId,
            createdById: actor.id,
          })
          .returning();
        await replaceCourseInformationCollections(transaction, {
          organizationId: context.organizationId,
          courseId: created.id,
          learningGoals,
          authorIds,
        });
        const result =
          input.status === "published"
            ? await publishCourseVersion(transaction, {
                organizationId: context.organizationId,
                course: created,
                createdById: actor.id,
                changelog: "Bei der Erstellung ueber die Kurs-API veroeffentlicht.",
                publishedAt: new Date(),
              })
            : null;
        const finalCourse = result?.course ?? created;
        const publicCourse = {
          ...finalCourse,
          coverImage: safeCourseCoverSource(finalCourse.coverImage),
        };
        await enqueueWebhook(
          context.organizationId,
          "course.created",
          {
            ...publicCourse,
            ...(result
              ? {
                  versionId: result.version.id,
                  version: result.version.version,
                }
              : {}),
          },
          transaction,
        );
        return publicCourse;
      });
      return { data: course, status: 201, resourceId: course.id };
    },
  );
}
