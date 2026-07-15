import "server-only";

import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  activityEvents,
  courseCertificates,
  courses,
  enrollments,
  lessonProgress,
  notifications,
  organizations,
  users,
} from "@/db/schema";
import { getCertificateCopy } from "@/lib/i18n/certificates";
import { effectiveLocale } from "@/lib/i18n/model";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";

type CertificateExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CertificateIssuanceResult =
  | {
      status: "issued" | "existing";
      certificate: typeof courseCertificates.$inferSelect;
    }
  | {
      status: "disabled" | "incomplete" | "not_found";
      certificate: null;
    };

function certificateNumber(completedAt: Date) {
  return `QA-${completedAt.getUTCFullYear()}-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function activeCertificate(
  executor: CertificateExecutor,
  organizationId: string,
  userId: string,
  courseId: string,
) {
  const [certificate] = await executor
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.organizationId, organizationId),
        eq(courseCertificates.userId, userId),
        eq(courseCertificates.courseId, courseId),
        isNull(courseCertificates.revokedAt),
      ),
    )
    .limit(1);
  return certificate ?? null;
}

export async function issueCourseCertificate(
  executor: CertificateExecutor,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    issuedById?: string | null;
  },
): Promise<CertificateIssuanceResult> {
  await lockMemberCourseProgress(executor, input);
  const existing = await activeCertificate(
    executor,
    input.organizationId,
    input.userId,
    input.courseId,
  );
  if (existing) return { status: "existing", certificate: existing };

  const [context] = await executor
    .select({
      firstName: users.firstName,
      lastName: users.lastName,
      organizationName: organizations.name,
      enrollmentStatus: enrollments.status,
      enrollmentProgress: enrollments.progress,
      completedAt: enrollments.completedAt,
      preferredLocale: users.preferredLocale,
      defaultLocale: organizations.defaultLocale,
    })
    .from(enrollments)
    .innerJoin(
      users,
      and(
        eq(users.id, enrollments.userId),
        eq(users.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, input.organizationId),
        eq(organizations.id, users.organizationId),
      ),
    )
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.courseId, input.courseId),
      ),
    )
    .limit(1);
  if (!context) return { status: "not_found", certificate: null };
  const learningAccess = await getCourseLearningAccess(executor, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseId: input.courseId,
  });
  if (!learningAccess) return { status: "not_found", certificate: null };
  const published = learningAccess.published;
  if (!published.snapshot.course.certificateEnabled) {
    return { status: "disabled", certificate: null };
  }
  if (
    context.enrollmentStatus !== "completed" ||
    context.enrollmentProgress !== 100 ||
    !context.completedAt
  ) {
    return { status: "incomplete", certificate: null };
  }

  const lessonIds = learningAccess.requiredLessonIds;
  if (!lessonIds.length) return { status: "incomplete", certificate: null };

  const completedLessons = await executor
    .select({ id: lessonProgress.lessonId })
    .from(lessonProgress)
    .where(
      and(
        eq(lessonProgress.userId, input.userId),
        eq(lessonProgress.status, "completed"),
        inArray(lessonProgress.lessonId, lessonIds),
      ),
    );
  if (new Set(completedLessons.map((lesson) => lesson.id)).size !== lessonIds.length) {
    return { status: "incomplete", certificate: null };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const [created] = await executor
      .insert(courseCertificates)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        courseId: input.courseId,
        certificateNumber: certificateNumber(context.completedAt),
        recipientName: `${context.firstName} ${context.lastName}`.trim(),
        courseTitle: published.snapshot.course.title,
        organizationName: context.organizationName,
        completedAt: context.completedAt,
        issuedById: input.issuedById ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (created) {
      const notificationCopy = getCertificateCopy(
        effectiveLocale({
          preferredLocale: context.preferredLocale,
          defaultLocale: context.defaultLocale,
        }),
      ).notification;
      await Promise.all([
        executor.insert(activityEvents).values({
          organizationId: input.organizationId,
          userId: input.userId,
          type: "certificate.issued",
          entityType: "course_certificate",
          entityId: created.id,
          metadata: {
            courseId: input.courseId,
            certificateNumber: created.certificateNumber,
            issuedById: input.issuedById ?? null,
          },
        }),
        executor.insert(notifications).values({
          userId: input.userId,
          title: notificationCopy.issuedTitle,
          body: notificationCopy.issuedBody(published.snapshot.course.title),
          type: "success",
          category: "learning",
          href: `/academy/certificates/${created.id}`,
        }),
      ]);
      return { status: "issued", certificate: created };
    }

    const concurrent = await activeCertificate(
      executor,
      input.organizationId,
      input.userId,
      input.courseId,
    );
    if (concurrent) return { status: "existing", certificate: concurrent };
  }

  throw new Error("A unique certificate number could not be generated.");
}

export async function getMemberCertificates(
  userId: string,
  organizationId: string,
) {
  return db
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.userId, userId),
        eq(courseCertificates.organizationId, organizationId),
      ),
    )
    .orderBy(desc(courseCertificates.issuedAt), desc(courseCertificates.id));
}

export async function getMemberCourseCertificate(
  userId: string,
  organizationId: string,
  courseId: string,
) {
  const [certificate] = await db
    .select({ id: courseCertificates.id })
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.userId, userId),
        eq(courseCertificates.organizationId, organizationId),
        eq(courseCertificates.courseId, courseId),
        isNull(courseCertificates.revokedAt),
      ),
    )
    .limit(1);
  return certificate ?? null;
}

export async function getCertificateForMember(
  certificateId: string,
  userId: string,
  organizationId: string,
) {
  const [certificate] = await db
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.id, certificateId),
        eq(courseCertificates.userId, userId),
        eq(courseCertificates.organizationId, organizationId),
      ),
    )
    .limit(1);
  return certificate ?? null;
}

export async function getCertificateForAdmin(
  certificateId: string,
  organizationId: string,
) {
  const [certificate] = await db
    .select()
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.id, certificateId),
        eq(courseCertificates.organizationId, organizationId),
      ),
    )
    .limit(1);
  return certificate ?? null;
}

export async function getAdminCertificates(organizationId: string) {
  return db
    .select({
      id: courseCertificates.id,
      userId: courseCertificates.userId,
      courseId: courseCertificates.courseId,
      certificateNumber: courseCertificates.certificateNumber,
      recipientName: courseCertificates.recipientName,
      courseTitle: courseCertificates.courseTitle,
      completedAt: courseCertificates.completedAt,
      issuedAt: courseCertificates.issuedAt,
      revokedAt: courseCertificates.revokedAt,
      revocationReason: courseCertificates.revocationReason,
      currentEmail: users.email,
    })
    .from(courseCertificates)
    .innerJoin(
      users,
      and(
        eq(users.id, courseCertificates.userId),
        eq(users.organizationId, organizationId),
      ),
    )
    .where(eq(courseCertificates.organizationId, organizationId))
    .orderBy(desc(courseCertificates.issuedAt), desc(courseCertificates.id));
}
