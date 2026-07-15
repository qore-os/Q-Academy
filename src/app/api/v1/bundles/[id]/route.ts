import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundleCourses, bundles, courses } from "@/db/schema";
import { deleteBundleWithAccess } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { bundleUpdateSchema } from "@/lib/api/schemas";
import { safeCourseCoverSource } from "@/lib/course-cover";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function bundleForOrganization(id: string, organizationId: string) {
  const [bundle] = await db.select().from(bundles).where(and(eq(bundles.id, id), eq(bundles.organizationId, organizationId))).limit(1);
  if (!bundle) throw new ApiError(404, "not_found", "Bundle nicht gefunden.");
  return bundle;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["bundles:read"], action: "bundle.read", resourceType: "bundle" }, async (context) => {
    const bundle = await bundleForOrganization(id, context.organizationId);
    const bundleCourseRows = await db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        status: courses.status,
        coverImage: courses.coverImage,
        availableFrom: bundleCourses.availableFrom,
        availableUntil: bundleCourses.availableUntil,
        delayDays: bundleCourses.delayDays,
        visible: bundleCourses.visible,
      })
      .from(bundleCourses)
      .innerJoin(courses, eq(courses.id, bundleCourses.courseId))
      .where(and(eq(bundleCourses.bundleId, id), eq(courses.organizationId, context.organizationId)))
      .orderBy(asc(courses.title));
    return {
      data: {
        ...bundle,
        courses: bundleCourseRows.map((course) => ({
          ...course,
          coverImage: safeCourseCoverSource(course.coverImage),
        })),
      },
      resourceId: id,
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.update", resourceType: "bundle", idempotent: true }, async (context) => {
    await bundleForOrganization(id, context.organizationId);
    const input = await parseJson(request, bundleUpdateSchema);
    const [bundle] = await db.update(bundles).set(input).where(eq(bundles.id, id)).returning();
    return { data: bundle, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.delete", resourceType: "bundle", idempotent: true }, async (context) => {
    await bundleForOrganization(id, context.organizationId);
    const result = await deleteBundleWithAccess(context.organizationId, id);
    return {
      data: {
        id,
        deleted: Boolean(result.deleted),
        affectedEnrollments: result.affectedEnrollments,
      },
      resourceId: id,
    };
  });
}
