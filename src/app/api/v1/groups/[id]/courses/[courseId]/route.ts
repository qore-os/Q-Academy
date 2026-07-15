import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, groupCourses, groups } from "@/db/schema";
import { assignCourseToGroup, unassignCourseFromGroup } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertOwnership(groupId: string, courseId: string, organizationId: string) {
  const [[group], [course]] = await Promise.all([
    db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.organizationId, organizationId)))
      .limit(1),
  ]);
  if (!group) throw new ApiError(404, "not_found", "Gruppe nicht gefunden.");
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; courseId: string }> },
) {
  const { id, courseId } = await params;
  return handleApi(
    request,
    { scopes: ["groups:read"], action: "group.course.read", resourceType: "group" },
    async (context) => {
      await assertOwnership(id, courseId, context.organizationId);
      const [assignment] = await db
        .select()
        .from(groupCourses)
        .where(and(eq(groupCourses.groupId, id), eq(groupCourses.courseId, courseId)))
        .limit(1);
      if (!assignment) {
        throw new ApiError(404, "not_found", "Kurszuweisung nicht gefunden.");
      }
      return { data: assignment, resourceId: id };
    },
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; courseId: string }> },
) {
  const { id, courseId } = await params;
  return handleApi(
    request,
    {
      scopes: ["groups:write"],
      action: "group.course.assign",
      resourceType: "group",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, courseId, context.organizationId);
      const result = await assignCourseToGroup(context.organizationId, id, courseId);
      return {
        data: { ...result.assignment, affectedMembers: result.affectedMembers },
        resourceId: id,
      };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; courseId: string }> },
) {
  const { id, courseId } = await params;
  return handleApi(
    request,
    {
      scopes: ["groups:write"],
      action: "group.course.unassign",
      resourceType: "group",
      idempotent: true,
    },
    async (context) => {
      await assertOwnership(id, courseId, context.organizationId);
      const result = await unassignCourseFromGroup(context.organizationId, id, courseId);
      return {
        data: {
          groupId: id,
          courseId,
          deleted: Boolean(result.assignment),
          affectedEnrollments: result.affectedEnrollments,
        },
        resourceId: id,
      };
    },
  );
}
