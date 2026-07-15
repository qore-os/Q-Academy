import "server-only";

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";

import {
  courseCertificates,
  courses,
  courseVersions,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { CourseProgressTransaction } from "@/lib/course-progress";
import { publishedLearningLessonIds } from "@/lib/learning-access";
import { isValidPublishedCourseSnapshot } from "@/lib/published-course";

export async function certificateProgressCourseIdsForLesson(
  executor: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    lessonId: string;
  },
) {
  const certificateRows = await executor
    .select({
      courseId: courseCertificates.courseId,
      issuedAt: courseCertificates.issuedAt,
      revokedAt: courseCertificates.revokedAt,
    })
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.organizationId, input.organizationId),
        eq(courseCertificates.userId, input.userId),
      ),
    );
  const courseIds = [
    ...new Set(certificateRows.map((certificate) => certificate.courseId)),
  ];
  if (!courseIds.length) return [];

  const versionRows = await executor
    .select({
      courseId: courseVersions.courseId,
      version: courseVersions.version,
      publishedAt: courseVersions.publishedAt,
      snapshot: courseVersions.snapshot,
    })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.organizationId, input.organizationId),
        inArray(courseVersions.courseId, courseIds),
        isNotNull(courseVersions.publishedAt),
      ),
    );
  const currentVersionRows = await executor
    .select({
      courseId: courses.id,
      snapshot: courseVersions.snapshot,
    })
    .from(courses)
    .innerJoin(
      courseVersions,
      and(
        eq(courseVersions.id, courses.publishedVersionId),
        eq(courseVersions.courseId, courses.id),
        eq(courseVersions.organizationId, courses.organizationId),
      ),
    )
    .where(
      and(
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
        inArray(courses.id, courseIds),
      ),
    );

  const containsLesson = (courseId: string, snapshot: CourseVersionSnapshot) =>
    isValidPublishedCourseSnapshot(
      snapshot,
      courseId,
      input.organizationId,
    ) &&
    publishedLearningLessonIds(snapshot).includes(input.lessonId);
  const protectedCourseIds = new Set(
    currentVersionRows
      .filter((row) => containsLesson(row.courseId, row.snapshot))
      .map((row) => row.courseId),
  );
  const versionsByCourse = new Map<
    string,
    Array<(typeof versionRows)[number]>
  >();
  for (const version of versionRows) {
    const entries = versionsByCourse.get(version.courseId) ?? [];
    entries.push(version);
    versionsByCourse.set(version.courseId, entries);
  }
  for (const entries of versionsByCourse.values()) {
    entries.sort(
      (left, right) =>
        (right.publishedAt?.getTime() ?? 0) -
          (left.publishedAt?.getTime() ?? 0) ||
        right.version - left.version,
    );
  }
  for (const certificate of certificateRows) {
    if (certificate.revokedAt) continue;
    const issuedVersion = versionsByCourse
      .get(certificate.courseId)
      ?.find(
        (version) =>
          version.publishedAt && version.publishedAt <= certificate.issuedAt,
      );
    if (
      issuedVersion &&
      containsLesson(issuedVersion.courseId, issuedVersion.snapshot)
    ) {
      protectedCourseIds.add(issuedVersion.courseId);
    }
  }
  return [...protectedCourseIds].sort();
}

export async function assertProgressReductionHasNoActiveCertificate(
  executor: CourseProgressTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseIds: string[];
  },
) {
  const courseIds = [...new Set(input.courseIds)].sort();
  if (!courseIds.length) return;

  const [certificate] = await executor
    .select({
      id: courseCertificates.id,
      certificateNumber: courseCertificates.certificateNumber,
      courseId: courseCertificates.courseId,
    })
    .from(courseCertificates)
    .where(
      and(
        eq(courseCertificates.organizationId, input.organizationId),
        eq(courseCertificates.userId, input.userId),
        inArray(courseCertificates.courseId, courseIds),
        isNull(courseCertificates.revokedAt),
      ),
    )
    .orderBy(asc(courseCertificates.courseId), asc(courseCertificates.id))
    .limit(1);

  if (!certificate) return;
  throw new ApiError(
    409,
    "conflict",
    "Der Lernfortschritt kann nicht abgesenkt werden, solange ein aktives Zertifikat besteht.",
    {
      reason: "active_certificate",
      requiredAction: "revoke_certificate",
      certificateId: certificate.id,
      certificateNumber: certificate.certificateNumber,
      courseId: certificate.courseId,
    },
  );
}
