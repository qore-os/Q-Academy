import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import {
  activityEvents,
  bundleCourses,
  bundles,
  courseAccessGrants,
  courseModuleAccessOverrides,
  emailDeliveries,
  enrollments,
  lessonProgress,
  users,
} from "@/db/schema";
import { encryptPayload } from "@/lib/api/crypto";
import type { CourseVersionTransaction } from "@/lib/api/course-versioning";
import { ApiError } from "@/lib/api/errors";
import {
  courseModuleReleaseDeliveryId,
  newlyAccessibleModules,
  releasedModuleList,
} from "@/lib/course-module-release-policy";
import { renderTenantEmailContentBatch } from "@/lib/email-center";
import { effectiveLocale, type AppLocale } from "@/lib/i18n/model";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { resolvePublishedCourseLearningAccess } from "@/lib/learning-access";
import { resolveMemberCourseAccess } from "@/lib/member-course-access-policy";
import { usersWithEmailNotificationsDisabled } from "@/lib/notification-preferences";
import type { PublishedCourseContent } from "@/lib/published-course";
import { getPublicAppUrl } from "@/lib/server-environment";

type ReleaseRecipient = Readonly<{
  id: string;
  email: string;
  firstName: string;
  locale: AppLocale;
  modules: readonly Readonly<{ id: string; title: string }>[];
  emailEnabled: boolean;
}>;

export type CourseModuleReleaseEmailPreview = Readonly<{
  enabled: boolean;
  eligibleRecipientCount: number;
  recipientCount: number;
  modules: readonly Readonly<{ id: string; title: string }>[];
}>;

const DELIVERY_BATCH_SIZE = 250;

function chunks<T>(values: readonly T[], size = DELIVERY_BATCH_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function snapshotLessonIds(published: PublishedCourseContent | null) {
  return (
    published?.snapshot.modules.flatMap((module) => [
      ...module.lessons.map((lesson) => lesson.id),
      ...module.sections.flatMap((section) =>
        section.lessons.map((lesson) => lesson.id),
      ),
    ]) ?? []
  );
}

async function releaseRecipients(
  tx: CourseVersionTransaction,
  input: {
    organizationId: string;
    courseId: string;
    previousPublished: PublishedCourseContent | null;
    nextPublished: PublishedCourseContent;
    releasedAt: Date;
  },
): Promise<ReleaseRecipient[]> {
  const recipientRows = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      preferredLocale: users.preferredLocale,
      enrollmentId: enrollments.id,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(users)
    .innerJoin(
      enrollments,
      and(
        eq(enrollments.userId, users.id),
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.accessActive, true),
      ),
    )
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .orderBy(asc(users.id));
  if (!recipientRows.length) return [];

  const userIds = recipientRows.map((recipient) => recipient.id);
  const lessonIds = [
    ...new Set([
      ...snapshotLessonIds(input.previousPublished),
      ...snapshotLessonIds(input.nextPublished),
    ]),
  ];
  const [
    grantRows,
    policyRows,
    progressRows,
    overrideRows,
    defaultLocale,
    emailDisabledUserIds,
  ] = await Promise.all([
    tx
      .select({
        userId: courseAccessGrants.userId,
        courseId: courseAccessGrants.courseId,
        source: courseAccessGrants.source,
        grantedAt: courseAccessGrants.createdAt,
      })
      .from(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, input.organizationId),
          eq(courseAccessGrants.courseId, input.courseId),
          inArray(courseAccessGrants.userId, userIds),
        ),
      ),
    tx
      .select({
        bundleId: bundleCourses.bundleId,
        courseId: bundleCourses.courseId,
        bundleActive: bundles.active,
        availableFrom: bundleCourses.availableFrom,
        availableUntil: bundleCourses.availableUntil,
        delayDays: bundleCourses.delayDays,
        visible: bundleCourses.visible,
      })
      .from(bundleCourses)
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, bundleCourses.bundleId),
          eq(bundles.organizationId, input.organizationId),
        ),
      )
      .where(eq(bundleCourses.courseId, input.courseId)),
    lessonIds.length
      ? tx
          .select({
            userId: lessonProgress.userId,
            lessonId: lessonProgress.lessonId,
          })
          .from(lessonProgress)
          .where(
            and(
              inArray(lessonProgress.userId, userIds),
              inArray(lessonProgress.lessonId, lessonIds),
              eq(lessonProgress.status, "completed"),
            ),
          )
      : Promise.resolve([]),
    tx
      .select({
        userId: courseModuleAccessOverrides.userId,
        moduleId: courseModuleAccessOverrides.moduleId,
        state: courseModuleAccessOverrides.state,
        expiresAt: courseModuleAccessOverrides.expiresAt,
      })
      .from(courseModuleAccessOverrides)
      .where(
        and(
          eq(courseModuleAccessOverrides.organizationId, input.organizationId),
          eq(courseModuleAccessOverrides.courseId, input.courseId),
          inArray(courseModuleAccessOverrides.userId, userIds),
        ),
      ),
    getOrganizationDefaultLocale(input.organizationId, tx),
    usersWithEmailNotificationsDisabled(tx, {
      organizationId: input.organizationId,
      userIds,
      category: "learning",
    }),
  ]);

  return recipientRows.flatMap((recipient) => {
    const courseAccess = resolveMemberCourseAccess({
      grants: grantRows.filter((grant) => grant.userId === recipient.id),
      policies: policyRows,
      now: input.releasedAt,
    });
    if (!courseAccess.accessible) return [];
    const completedLessonIds = new Set(
      progressRows
        .filter((row) => row.userId === recipient.id)
        .map((row) => row.lessonId),
    );
    const moduleOverrides = new Map(
      overrideRows
        .filter((row) => row.userId === recipient.id)
        .map((row) => [
          row.moduleId,
          { state: row.state, expiresAt: row.expiresAt },
        ]),
    );
    const resolverInput = {
      enrollment: {
        id: recipient.enrollmentId,
        enrolledAt: recipient.enrolledAt,
      },
      courseAccessStartedAt: courseAccess.accessStartedAt,
      completedLessonIds,
      moduleOverrides,
      now: input.releasedAt,
    };
    const previousAccess = input.previousPublished
      ? resolvePublishedCourseLearningAccess({
          ...resolverInput,
          published: input.previousPublished,
        }).modules
      : null;
    const nextAccess = resolvePublishedCourseLearningAccess({
      ...resolverInput,
      published: input.nextPublished,
    }).modules;
    const modules = newlyAccessibleModules(previousAccess, nextAccess);
    if (!modules.length) return [];
    return [
      {
        id: recipient.id,
        email: recipient.email,
        firstName: recipient.firstName,
        locale: effectiveLocale({
          preferredLocale: recipient.preferredLocale,
          defaultLocale,
        }),
        modules,
        emailEnabled: !emailDisabledUserIds.has(recipient.id),
      },
    ];
  });
}

function releasePreview(
  enabled: boolean,
  recipients: readonly ReleaseRecipient[],
): CourseModuleReleaseEmailPreview {
  const modules = new Map<string, { id: string; title: string }>();
  for (const recipient of recipients) {
    for (const releasedModule of recipient.modules) {
      modules.set(releasedModule.id, releasedModule);
    }
  }
  return {
    enabled,
    eligibleRecipientCount: recipients.length,
    recipientCount: recipients.filter((recipient) => recipient.emailEnabled)
      .length,
    modules: [...modules.values()],
  };
}

export async function previewCourseModuleReleaseEmails(
  tx: CourseVersionTransaction,
  input: {
    organizationId: string;
    courseId: string;
    enabled: boolean;
    previousPublished: PublishedCourseContent | null;
    nextPublished: PublishedCourseContent;
    releasedAt: Date;
  },
) {
  const recipients = await releaseRecipients(tx, input);
  return releasePreview(input.enabled, recipients);
}

export async function queueCourseModuleReleaseEmails(
  tx: CourseVersionTransaction,
  input: {
    organizationId: string;
    courseId: string;
    courseSlug: string;
    courseTitle: string;
    enabled: boolean;
    actorUserId?: string | null;
    previousPublished: PublishedCourseContent | null;
    nextPublished: PublishedCourseContent;
    releasedAt: Date;
  },
) {
  if (!input.enabled) {
    return {
      preview: releasePreview(false, []),
      queuedCount: 0,
      deduplicatedCount: 0,
    };
  }
  const recipients = await releaseRecipients(tx, input);
  const optedIn = recipients.filter((recipient) => recipient.emailEnabled);
  const courseUrl = new URL(
    `/academy/courses/${input.courseSlug}`,
    getPublicAppUrl(),
  ).toString();
  const renderedByUser = new Map<
    string,
    Awaited<ReturnType<typeof renderTenantEmailContentBatch>>[number]
  >();
  for (const locale of new Set(optedIn.map((recipient) => recipient.locale))) {
    const localizedRecipients = optedIn.filter(
      (recipient) => recipient.locale === locale,
    );
    const rendered = await renderTenantEmailContentBatch(tx, {
      organizationId: input.organizationId,
      event: "course.modules.released",
      locale,
      variables: localizedRecipients.map((recipient) => ({
        firstName: recipient.firstName,
        courseTitle: input.courseTitle,
        moduleList: releasedModuleList(recipient.modules),
        courseUrl,
      })),
    });
    localizedRecipients.forEach((recipient, index) => {
      renderedByUser.set(recipient.id, rendered[index]!);
    });
  }

  const deliveries = optedIn.map((recipient) => {
    const id = courseModuleReleaseDeliveryId({
      organizationId: input.organizationId,
      courseVersionId: input.nextPublished.versionId,
      userId: recipient.id,
    });
    const rendered = renderedByUser.get(recipient.id);
    if (!rendered) throw new Error("Release-E-Mail konnte nicht gerendert werden.");
    return {
      id,
      organizationId: input.organizationId,
      userId: recipient.id,
      event: "course.modules.released",
      category: "learning" as const,
      recipientEmail: recipient.email,
      payload: encryptPayload(
        JSON.stringify({
          ...rendered,
          link: courseUrl,
          locale: recipient.locale,
          courseId: input.courseId,
          courseVersionId: input.nextPublished.versionId,
          moduleIds: recipient.modules.map((module) => module.id),
        }),
        `email-delivery:${id}`,
      ),
    };
  });
  const insertedIds = new Set<string>();
  for (const batch of chunks(deliveries)) {
    const inserted = await tx
      .insert(emailDeliveries)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: emailDeliveries.id });
    for (const delivery of inserted) insertedIds.add(delivery.id);
  }
  for (const batch of chunks(deliveries)) {
    if (!batch.length) continue;
    const expected = new Map(batch.map((delivery) => [delivery.id, delivery]));
    const persisted = await tx
      .select({
        id: emailDeliveries.id,
        organizationId: emailDeliveries.organizationId,
        userId: emailDeliveries.userId,
        event: emailDeliveries.event,
        category: emailDeliveries.category,
      })
      .from(emailDeliveries)
      .where(inArray(emailDeliveries.id, [...expected.keys()]));
    if (
      persisted.length !== expected.size ||
      persisted.some((delivery) => {
        const planned = expected.get(delivery.id);
        return (
          !planned ||
          delivery.organizationId !== planned.organizationId ||
          delivery.userId !== planned.userId ||
          delivery.event !== planned.event ||
          delivery.category !== "learning"
        );
      })
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Release-E-Mails konnten nicht eindeutig dedupliziert werden.",
      );
    }
  }
  if (insertedIds.size) {
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId ?? null,
      type: "course.module_release_emails.queued",
      entityType: "course_version",
      entityId: input.nextPublished.versionId,
      metadata: {
        courseId: input.courseId,
        recipientCount: insertedIds.size,
        moduleCount: releasePreview(true, recipients).modules.length,
      },
    });
  }
  return {
    preview: releasePreview(true, recipients),
    queuedCount: insertedIds.size,
    deduplicatedCount: deliveries.length - insertedIds.size,
  };
}
