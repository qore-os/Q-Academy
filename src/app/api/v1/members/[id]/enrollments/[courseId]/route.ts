import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, users } from "@/db/schema";
import { revokeDirectCourseAccess } from "@/lib/access";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { enrollmentUpdateSchema } from "@/lib/api/schemas";
import {
  deriveCourseEnrollmentProgress,
  recalculateCourseEnrollmentProgress,
} from "@/lib/course-progress";
import { assertProgressReductionHasNoActiveCertificate } from "@/lib/progress-integrity";
import { lockMemberCourseProgress } from "@/lib/progress-lock";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function enrollmentForOrganization(
  reader: Pick<typeof db, "select">,
  userId: string,
  courseId: string,
  organizationId: string,
) {
  const [record] = await reader
    .select({ enrollment: enrollments })
    .from(enrollments)
    .innerJoin(users, and(eq(users.id, enrollments.userId), eq(users.organizationId, organizationId)))
    .innerJoin(courses, and(eq(courses.id, enrollments.courseId), eq(courses.organizationId, organizationId)))
    .where(and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId)))
    .limit(1);
  if (!record) throw new ApiError(404, "not_found", "Einschreibung nicht gefunden.");
  return record.enrollment;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const { id, courseId } = await params;
  return handleApi(request, { scopes: ["members:write"], action: "enrollment.update", resourceType: "enrollment", idempotent: true }, async (context) => {
    const input = await parseJson(request, enrollmentUpdateSchema);
    const updated = await db.transaction(async (tx) => {
      await lockMemberCourseProgress(tx, {
        organizationId: context.organizationId,
        userId: id,
        courseId,
      });
      const enrollment = await enrollmentForOrganization(
        tx,
        id,
        courseId,
        context.organizationId,
      );
      const derived = await deriveCourseEnrollmentProgress(tx, {
        organizationId: context.organizationId,
        userId: id,
        courseId,
      });
      if (!derived) {
        throw new ApiError(
          409,
          "conflict",
          "Der Fortschritt kann nur fuer eine aktive Einschreibung in einen publizierten Kurs abgeglichen werden.",
          { reason: "progress_not_derivable" },
        );
      }
      const requestedStatusMismatch =
        input.status !== undefined && input.status !== derived.status;
      const requestedProgressMismatch =
        input.progress !== undefined && input.progress !== derived.progress;
      if (requestedStatusMismatch || requestedProgressMismatch) {
        throw new ApiError(
          409,
          "conflict",
          "Einschreibungsstatus und Kursfortschritt werden aus den publizierten Pflichtlektionen abgeleitet und koennen nicht manuell ueberschrieben werden.",
          {
            reason: "derived_progress_mismatch",
            requested: input,
            actual: {
              status: derived.status,
              progress: derived.progress,
            },
          },
        );
      }
      if (derived.status !== "completed" || derived.progress !== 100) {
        await assertProgressReductionHasNoActiveCertificate(tx, {
          organizationId: context.organizationId,
          userId: id,
          courseIds: [courseId],
        });
      }
      const record = await recalculateCourseEnrollmentProgress(tx, {
        organizationId: context.organizationId,
        userId: id,
        courseId,
        now: derived.lastAccessedAt,
      });
      if (!record) {
        throw new ApiError(404, "not_found", "Einschreibung nicht gefunden.");
      }
      return { enrollment, record };
    });
    return { data: updated.record, resourceId: updated.enrollment.id };
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; courseId: string }> }) {
  const { id, courseId } = await params;
  return handleApi(request, { scopes: ["members:write"], action: "enrollment.delete", resourceType: "enrollment", idempotent: true }, async (context) => {
    const enrollment = await enrollmentForOrganization(
      db,
      id,
      courseId,
      context.organizationId,
    );
    const result = await revokeDirectCourseAccess(context.organizationId, id, courseId);
    return {
      data: {
        id: enrollment.id,
        directAccessRevoked: result?.grantRevoked ?? false,
        accessActive: result?.enrollment.accessActive ?? enrollment.accessActive,
      },
      resourceId: enrollment.id,
    };
  });
}
