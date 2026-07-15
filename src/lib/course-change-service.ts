import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { courses, courseVersions, users } from "@/db/schema";
import { buildCourseVersionSnapshot } from "@/lib/api/course-versioning";
import {
  diffCourseSnapshots,
  type CourseChangeDiff,
} from "@/lib/course-change-log";
import { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/model";
import {
  previewCourseModuleReleaseEmails,
  type CourseModuleReleaseEmailPreview,
} from "@/lib/course-module-release-email";

export type CourseVersionHistoryEntry = {
  id: string;
  version: number;
  changelog: string;
  createdAt: string;
  publishedAt: string | null;
  authorName: string;
  isCurrent: boolean;
};

export type AdminCourseChangeOverview = {
  comparison: CourseChangeDiff | null;
  comparisonUnavailable: boolean;
  publishedVersion: number | null;
  versions: CourseVersionHistoryEntry[];
  releaseEmailPreview: CourseModuleReleaseEmailPreview;
};

export async function getAdminCourseChangeOverview(
  courseId: string,
  organizationId: string,
  locale: AppLocale = DEFAULT_LOCALE,
): Promise<AdminCourseChangeOverview | null> {
  return db.transaction(
    async (transaction) => {
      const [course] = await transaction
        .select()
        .from(courses)
        .where(
          and(
            eq(courses.id, courseId),
            eq(courses.organizationId, organizationId),
          ),
        )
        .limit(1);
      if (!course) return null;

      const [publishedVersion] = course.publishedVersionId
        ? await transaction
            .select({
              id: courseVersions.id,
              version: courseVersions.version,
              snapshot: courseVersions.snapshot,
              publishedAt: courseVersions.publishedAt,
            })
            .from(courseVersions)
            .where(
              and(
                eq(courseVersions.id, course.publishedVersionId),
                eq(courseVersions.courseId, course.id),
                eq(courseVersions.organizationId, organizationId),
              ),
            )
            .limit(1)
        : [];

      const draftSnapshot = await buildCourseVersionSnapshot(
        transaction,
        course,
        new Date(),
        "comparison",
      );
      const validPublishedSnapshot =
        publishedVersion &&
        isValidPublishedCourseSnapshot(
          publishedVersion.snapshot,
          course.id,
          organizationId,
        )
          ? publishedVersion.snapshot
          : null;
      const comparisonUnavailable = Boolean(
        course.publishedVersionId && !validPublishedSnapshot,
      );
      const capturedAt = new Date(draftSnapshot.capturedAt);
      const previousPublished =
        validPublishedSnapshot && publishedVersion?.publishedAt
          ? {
              courseId: course.id,
              versionId: publishedVersion.id,
              version: publishedVersion.version,
              publishedAt: publishedVersion.publishedAt,
              firstPublishedAt:
                course.firstPublishedAt ?? publishedVersion.publishedAt,
              snapshot: validPublishedSnapshot,
            }
          : null;
      const releaseEmailPreview = comparisonUnavailable
        ? {
            enabled: course.notifyMembersOnModuleRelease,
            eligibleRecipientCount: 0,
            recipientCount: 0,
            modules: [],
          }
        : await previewCourseModuleReleaseEmails(transaction, {
            organizationId,
            courseId: course.id,
            enabled: course.notifyMembersOnModuleRelease,
            previousPublished,
            nextPublished: {
              courseId: course.id,
              versionId: "00000000-0000-5000-8000-000000000000",
              version: (publishedVersion?.version ?? 0) + 1,
              publishedAt: capturedAt,
              firstPublishedAt: course.firstPublishedAt ?? capturedAt,
              snapshot: draftSnapshot,
            },
            releasedAt: capturedAt,
          });

      const versionRows = await transaction
        .select({
          id: courseVersions.id,
          version: courseVersions.version,
          changelog: courseVersions.changelog,
          createdAt: courseVersions.createdAt,
          publishedAt: courseVersions.publishedAt,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(courseVersions)
        .leftJoin(
          users,
          and(
            eq(users.id, courseVersions.createdById),
            eq(users.organizationId, organizationId),
          ),
        )
        .where(
          and(
            eq(courseVersions.courseId, course.id),
            eq(courseVersions.organizationId, organizationId),
          ),
        )
        .orderBy(desc(courseVersions.version), desc(courseVersions.id));

      return {
        comparison: comparisonUnavailable
          ? null
          : diffCourseSnapshots(validPublishedSnapshot, draftSnapshot, locale),
        comparisonUnavailable,
        publishedVersion: publishedVersion?.version ?? null,
        versions: versionRows.map((version) => ({
          id: version.id,
          version: version.version,
          changelog: version.changelog,
          createdAt: version.createdAt.toISOString(),
          publishedAt: version.publishedAt?.toISOString() ?? null,
          authorName:
            version.firstName && version.lastName
              ? `${version.firstName} ${version.lastName}`
              : "System",
          isCurrent: version.id === course.publishedVersionId,
        })),
        releaseEmailPreview,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
