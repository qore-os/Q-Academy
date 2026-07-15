import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, users } from "@/db/schema";
import { grantDirectCourseAccess } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { enrollmentCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertMember(id: string, organizationId: string) {
  const [member] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.organizationId, organizationId))).limit(1);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["members:read"], action: "enrollment.list", resourceType: "enrollment" }, async (context) => {
    await assertMember(id, context.organizationId);
    const data = await db
      .select({
        id: enrollments.id,
        courseId: courses.id,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        status: enrollments.status,
        progress: enrollments.progress,
        accessActive: enrollments.accessActive,
        enrolledAt: enrollments.enrolledAt,
        lastAccessedAt: enrollments.lastAccessedAt,
        completedAt: enrollments.completedAt,
      })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(and(eq(enrollments.userId, id), eq(courses.organizationId, context.organizationId)))
      .orderBy(desc(enrollments.enrolledAt));
    return { data };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["members:write"], action: "enrollment.create", resourceType: "enrollment", idempotent: true },
    async (context) => {
      await assertMember(id, context.organizationId);
      const input = await parseJson(request, enrollmentCreateSchema);
      const [course] = await db.select({ id: courses.id, title: courses.title }).from(courses).where(and(eq(courses.id, input.courseId), eq(courses.organizationId, context.organizationId))).limit(1);
      if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      const result = await grantDirectCourseAccess(context.organizationId, id, course.id);
      if (!result.grantCreated) {
        throw new ApiError(409, "conflict", "Direkter Kurszugriff besteht bereits.");
      }
      await enqueueWebhook(context.organizationId, "enrollment.created", {
        ...result.enrollment,
        courseTitle: course.title,
      });
      return { data: result.enrollment, status: 201, resourceId: result.enrollment.id };
    },
  );
}
