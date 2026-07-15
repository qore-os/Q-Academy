import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundleCourses, bundles, courses } from "@/db/schema";
import { addCourseToBundle } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { bundleCourseSchema } from "@/lib/api/schemas";
import { safeCourseCoverSource } from "@/lib/course-cover";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertBundle(id: string, organizationId: string) {
  const [bundle] = await db.select({ id: bundles.id }).from(bundles).where(and(eq(bundles.id, id), eq(bundles.organizationId, organizationId))).limit(1);
  if (!bundle) throw new ApiError(404, "not_found", "Bundle nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["bundles:read", "courses:read"], action: "bundle.course.list", resourceType: "bundle" }, async (context) => {
    await assertBundle(id, context.organizationId);
    const pagination = parsePagination(new URL(request.url));
    const rows = await db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        status: courses.status,
        coverImage: courses.coverImage,
        estimatedMinutes: courses.estimatedMinutes,
        availableFrom: bundleCourses.availableFrom,
        availableUntil: bundleCourses.availableUntil,
        delayDays: bundleCourses.delayDays,
        visible: bundleCourses.visible,
      })
      .from(bundleCourses)
      .innerJoin(courses, and(eq(courses.id, bundleCourses.courseId), eq(courses.organizationId, context.organizationId)))
      .where(eq(bundleCourses.bundleId, id))
      .orderBy(asc(courses.title))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(
      (course) => ({
        ...course,
        coverImage: safeCourseCoverSource(course.coverImage),
      }),
    );
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) }, resourceId: id };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.course.add", resourceType: "bundle", idempotent: true }, async (context) => {
    await assertBundle(id, context.organizationId);
    const input = await parseJson(request, bundleCourseSchema);
    const [course] = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.organizationId, context.organizationId))).limit(1);
    if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
    const { courseId, ...policy } = input;
    const result = await addCourseToBundle(
      context.organizationId,
      id,
      courseId,
      policy,
    );
    return {
      data: {
        ...result.assignment,
        affectedDirectMembers: result.affectedDirectMembers,
        affectedGroupMembers: result.affectedGroupMembers,
      },
      status: 201,
      resourceId: id,
    };
  });
}
