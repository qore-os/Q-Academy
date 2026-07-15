import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bundles, courses } from "@/db/schema";
import {
  addCourseToBundle,
  removeCourseFromBundle,
  updateBundleCoursePolicy,
} from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { bundleCoursePolicySchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(bundleId: string, courseId: string, organizationId: string) {
  const [[bundle], [course]] = await Promise.all([
    db.select({ id: bundles.id }).from(bundles).where(and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId))).limit(1),
    db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, courseId), eq(courses.organizationId, organizationId))).limit(1),
  ]);
  if (!bundle) throw new ApiError(404, "not_found", "Bundle nicht gefunden.");
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const { id, courseId } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.course.add", resourceType: "bundle", idempotent: true }, async (context) => {
    await assertOwnership(id, courseId, context.organizationId);
    const result = await addCourseToBundle(context.organizationId, id, courseId);
    return {
      data: {
        ...result.assignment,
        affectedDirectMembers: result.affectedDirectMembers,
        affectedGroupMembers: result.affectedGroupMembers,
      },
      resourceId: id,
    };
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const { id, courseId } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.course.update", resourceType: "bundle", idempotent: true }, async (context) => {
    await assertOwnership(id, courseId, context.organizationId);
    const input = await parseJson(request, bundleCoursePolicySchema);
    const assignment = await updateBundleCoursePolicy(
      context.organizationId,
      id,
      courseId,
      input,
    );
    if (!assignment) {
      throw new ApiError(404, "not_found", "Kurszuordnung nicht gefunden.");
    }
    return { data: assignment, resourceId: id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const { id, courseId } = await params;
  return handleApi(request, { scopes: ["bundles:write"], action: "bundle.course.remove", resourceType: "bundle", idempotent: true }, async (context) => {
    await assertOwnership(id, courseId, context.organizationId);
    const result = await removeCourseFromBundle(context.organizationId, id, courseId);
    return {
      data: {
        bundleId: id,
        courseId,
        deleted: Boolean(result.assignment),
        affectedEnrollments: result.affectedEnrollments,
      },
      resourceId: id,
    };
  });
}
