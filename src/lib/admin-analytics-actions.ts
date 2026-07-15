"use server";

import {
  and,
  count,
  eq,
  inArray,
  isNull,
  ne,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  assessmentAnswers,
  assessmentAttempts,
  courseCertificates,
  courseModules,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  notifications,
  submissions,
  users,
} from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import {
  getAdminAnalyticsActionCopy,
  type ProgressResetMessageCode,
  type ProgressResetMessageParams,
} from "@/lib/i18n/admin-analytics-actions";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import { logServerError } from "@/lib/server-error-logging";

export type ProgressResetActionState = {
  ok: boolean;
  message: string;
  code: ProgressResetMessageCode;
  params?: ProgressResetMessageParams;
};

export type ProgressResetInput = {
  memberId: string;
  courseId: string;
  memberConfirmation: string;
  courseConfirmation: string;
  resetSubmissions: boolean;
  revokeCertificate: boolean;
};

const progressResetSchema = z.object({
  memberId: z.string().uuid(),
  courseId: z.string().uuid(),
  memberConfirmation: z.string().trim().min(1).max(220),
  courseConfirmation: z.string().trim().min(1).max(220),
  resetSubmissions: z.boolean(),
  revokeCertificate: z.boolean(),
});

function errorState(
  code: ProgressResetMessageCode,
  message: string,
  params?: ProgressResetMessageParams,
): ProgressResetActionState {
  return { ok: false, message, code, params };
}

export async function resetMemberCourseProgressAction(
  input: ProgressResetInput,
): Promise<ProgressResetActionState> {
  const actor = await requireTeamPermission("analytics.view");
  await requireTeamPermission("members.manage");
  const parsed = progressResetSchema.safeParse(input);
  if (!parsed.success) {
    return errorState(
      "invalidRequest",
      "Die Angaben fuer den Fortschrittsreset sind ungueltig.",
    );
  }

  try {
    const result = await db.transaction(async (tx) => {
      await lockMemberCourseProgress(tx, {
        organizationId: actor.organizationId,
        userId: parsed.data.memberId,
        courseId: parsed.data.courseId,
      });

      const [context] = await tx
        .select({
          enrollmentId: enrollments.id,
          memberId: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          courseId: courses.id,
          courseTitle: courses.title,
          courseSlug: courses.slug,
        })
        .from(enrollments)
        .innerJoin(
          users,
          and(
            eq(users.id, enrollments.userId),
            eq(users.organizationId, actor.organizationId),
            eq(users.role, "member"),
          ),
        )
        .innerJoin(
          courses,
          and(
            eq(courses.id, enrollments.courseId),
            eq(courses.organizationId, actor.organizationId),
          ),
        )
        .where(
          and(
            eq(enrollments.userId, parsed.data.memberId),
            eq(enrollments.courseId, parsed.data.courseId),
          ),
        )
        .limit(1);
      if (!context) return { kind: "missing" as const };

      const memberName = `${context.firstName} ${context.lastName}`.trim();
      if (
        parsed.data.memberConfirmation !== memberName ||
        parsed.data.courseConfirmation !== context.courseTitle.trim()
      ) {
        return { kind: "confirmation" as const };
      }

      const recipientLocale = await resolveRecipientLocale(tx, {
        organizationId: actor.organizationId,
        userId: context.memberId,
      });
      const recipientCopy =
        getAdminAnalyticsActionCopy(recipientLocale).notification;

      const [activeCertificate] = await tx
        .select({
          id: courseCertificates.id,
          certificateNumber: courseCertificates.certificateNumber,
        })
        .from(courseCertificates)
        .where(
          and(
            eq(courseCertificates.organizationId, actor.organizationId),
            eq(courseCertificates.userId, context.memberId),
            eq(courseCertificates.courseId, context.courseId),
            isNull(courseCertificates.revokedAt),
          ),
        )
        .limit(1);
      if (activeCertificate && !parsed.data.revokeCertificate) {
        return {
          kind: "certificate-required" as const,
          certificateNumber: activeCertificate.certificateNumber,
        };
      }

      const lessonRows = await tx
        .select({ id: lessons.id, moduleId: lessons.moduleId })
        .from(lessons)
        .innerJoin(
          courseModules,
          and(
            eq(courseModules.moduleId, lessons.moduleId),
            eq(courseModules.courseId, context.courseId),
          ),
        )
        .innerJoin(
          modules,
          and(
            eq(modules.id, lessons.moduleId),
            eq(modules.organizationId, actor.organizationId),
          ),
        );
      const lessonIds = lessonRows.map((lesson) => lesson.id);

      if (lessonIds.length) {
        const progressedLessons = await tx
          .select({ lessonId: lessonProgress.lessonId })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, context.memberId),
              inArray(lessonProgress.lessonId, lessonIds),
            ),
          );
        const progressedLessonIds = new Set(
          progressedLessons.map((progress) => progress.lessonId),
        );
        const progressedModuleIds = [
          ...new Set(
            lessonRows
              .filter((lesson) => progressedLessonIds.has(lesson.id))
              .map((lesson) => lesson.moduleId),
          ),
        ];
        if (progressedModuleIds.length) {
          const [sharedCourse] = await tx
            .select({ id: courses.id, title: courses.title })
            .from(courseModules)
            .innerJoin(
              courses,
              and(
                eq(courses.id, courseModules.courseId),
                eq(courses.organizationId, actor.organizationId),
                ne(courses.id, context.courseId),
              ),
            )
            .innerJoin(
              enrollments,
              and(
                eq(enrollments.courseId, courses.id),
                eq(enrollments.userId, context.memberId),
              ),
            )
            .where(inArray(courseModules.moduleId, progressedModuleIds))
            .limit(1);
          if (sharedCourse) {
            return {
              kind: "shared-progress" as const,
              courseTitle: sharedCourse.title,
            };
          }
        }
      }

      const [answerStats] = await tx
        .select({ value: count(assessmentAnswers.id) })
        .from(assessmentAnswers)
        .innerJoin(
          assessmentAttempts,
          and(
            eq(assessmentAttempts.id, assessmentAnswers.attemptId),
            eq(
              assessmentAttempts.organizationId,
              actor.organizationId,
            ),
            eq(assessmentAttempts.userId, context.memberId),
            eq(assessmentAttempts.courseId, context.courseId),
          ),
        )
        .where(eq(assessmentAnswers.organizationId, actor.organizationId));

      const removedProgress = lessonIds.length
        ? await tx
            .delete(lessonProgress)
            .where(
              and(
                eq(lessonProgress.userId, context.memberId),
                inArray(lessonProgress.lessonId, lessonIds),
              ),
            )
            .returning({ id: lessonProgress.id })
        : [];
      const removedAttempts = await tx
        .delete(assessmentAttempts)
        .where(
          and(
            eq(assessmentAttempts.organizationId, actor.organizationId),
            eq(assessmentAttempts.userId, context.memberId),
            eq(assessmentAttempts.courseId, context.courseId),
          ),
        )
        .returning({ id: assessmentAttempts.id });
      const removedSubmissions = parsed.data.resetSubmissions
        ? await tx
            .delete(submissions)
            .where(
              and(
                eq(submissions.organizationId, actor.organizationId),
                eq(submissions.userId, context.memberId),
                eq(submissions.courseId, context.courseId),
              ),
            )
            .returning({ id: submissions.id })
        : [];

      const [resetEnrollment] = await tx
        .update(enrollments)
        .set({
          status: "not_started",
          progress: 0,
          lastAccessedAt: null,
          completedAt: null,
        })
        .where(
          and(
            eq(enrollments.id, context.enrollmentId),
            eq(enrollments.userId, context.memberId),
            eq(enrollments.courseId, context.courseId),
          ),
        )
        .returning({ id: enrollments.id });
      if (!resetEnrollment) return { kind: "missing" as const };

      const revokedAt = new Date();
      if (activeCertificate) {
        await tx
          .update(courseCertificates)
          .set({
            revokedAt,
            revokedById: actor.id,
            revocationReason: recipientCopy.revocationReason,
          })
          .where(
            and(
              eq(courseCertificates.id, activeCertificate.id),
              eq(courseCertificates.organizationId, actor.organizationId),
              isNull(courseCertificates.revokedAt),
            ),
          );
        await tx.insert(activityEvents).values({
          organizationId: actor.organizationId,
          userId: actor.id,
          type: "certificate.revoked",
          entityType: "course_certificate",
          entityId: activeCertificate.id,
          metadata: {
            recipientUserId: context.memberId,
            courseId: context.courseId,
            reason: "progress_reset",
          },
        });
      }

      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "learning.progress_reset",
        entityType: "enrollment",
        entityId: context.enrollmentId,
        metadata: {
          memberId: context.memberId,
          memberName,
          courseId: context.courseId,
          courseTitle: context.courseTitle,
          removedLessonProgress: removedProgress.length,
          removedAssessmentAttempts: removedAttempts.length,
          removedAssessmentAnswers: Number(answerStats?.value ?? 0),
          removedSubmissions: removedSubmissions.length,
          submissionsIncluded: parsed.data.resetSubmissions,
          revokedCertificateId: activeCertificate?.id ?? null,
        },
      });
      await tx.insert(notifications).values({
        userId: context.memberId,
        title: recipientCopy.title,
        body: recipientCopy.body(context.courseTitle, Boolean(activeCertificate)),
        type: "warning",
        category: "learning",
        href: `/academy/courses/${context.courseSlug}`,
      });

      return {
        kind: "reset" as const,
        context,
        removedProgress: removedProgress.length,
        removedAttempts: removedAttempts.length,
        removedSubmissions: removedSubmissions.length,
        certificateRevoked: Boolean(activeCertificate),
      };
    });

    if (result.kind === "missing") {
      return errorState(
        "assignmentNotFound",
        "Mitglied, Kurs oder Einschreibung wurde nicht gefunden.",
      );
    }
    if (result.kind === "confirmation") {
      return errorState(
        "confirmationMismatch",
        "Mitgliedsname oder Kurstitel stimmt nicht mit den aktuellen Daten ueberein.",
      );
    }
    if (result.kind === "certificate-required") {
      return errorState(
        "certificateRevocationRequired",
        `Das aktive Zertifikat ${result.certificateNumber} muss fuer diesen Reset ausdruecklich widerrufen werden.`,
        { certificateNumber: result.certificateNumber },
      );
    }
    if (result.kind === "shared-progress") {
      return errorState(
        "sharedProgressBlocked",
        `Der Reset ist blockiert, weil derselbe Lektionsfortschritt auch im Kurs "${result.courseTitle}" verwendet wird. Trenne zuerst das wiederverwendete Modul oder setze die betroffenen Kurse gemeinsam ueber einen Datenworkflow zurueck.`,
        { courseTitle: result.courseTitle },
      );
    }

    revalidatePath("/admin/analytics");
    revalidatePath(`/admin/members/${result.context.memberId}`);
    revalidatePath("/admin/certificates");
    revalidatePath("/academy", "layout");
    revalidatePath(`/academy/courses/${result.context.courseSlug}`);
    revalidatePath("/academy/certificates");

    const params: ProgressResetMessageParams = {
      lessonStates: result.removedProgress,
      quizAttempts: result.removedAttempts,
      submissions: result.removedSubmissions,
      submissionsIncluded: parsed.data.resetSubmissions,
      certificateRevoked: result.certificateRevoked,
    };
    return {
      ok: true,
      message: "Fortschritt wurde zurueckgesetzt.",
      code: "progressReset",
      params,
    };
  } catch (error) {
    logServerError(error, { action: "analytics.progress.reset" });
    return errorState(
      "resetFailed",
      "Der Lernfortschritt konnte nicht zurueckgesetzt werden.",
    );
  }
}
