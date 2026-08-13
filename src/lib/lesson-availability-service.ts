import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  courseModuleAccessOverrides,
  courses,
  emailDeliveries,
  enrollments,
  lessonAvailabilitySubscriptions,
  lessonProgress,
  notifications,
  users,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { encryptPayload } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { renderTenantEmailContent } from "@/lib/email-center";
import { effectiveLocale, type AppLocale } from "@/lib/i18n/model";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  canSubscribeToLessonAvailability,
  shouldFulfillLessonAvailabilitySubscription,
} from "@/lib/lesson-availability-policy";
import {
  getCourseLearningAccess,
  resolvePublishedCourseLearningAccess,
} from "@/lib/learning-access";
import { resolveMemberCourseAccessWithReader } from "@/lib/member-course-access";
import { usersWithEmailNotificationsDisabled } from "@/lib/notification-preferences";
import type { PublishedCourseContent } from "@/lib/published-course";
import { findSnapshotLesson } from "@/lib/published-course";
import { getPublicAppUrl } from "@/lib/server-environment";

export type LessonAvailabilityTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type LessonAvailabilitySubscriptionStatus =
  "active" | "cancelled" | "fulfilled";

export function lessonAvailabilitySubscriptionStatus(
  subscription: Pick<
    typeof lessonAvailabilitySubscriptions.$inferSelect,
    "cancelledAt" | "fulfilledAt"
  >,
): LessonAvailabilitySubscriptionStatus {
  if (subscription.fulfilledAt) return "fulfilled";
  if (subscription.cancelledAt) return "cancelled";
  return "active";
}

export function lessonAvailabilitySubscriptionDto(
  subscription: typeof lessonAvailabilitySubscriptions.$inferSelect,
) {
  return {
    id: subscription.id,
    userId: subscription.userId,
    courseId: subscription.courseId,
    lessonId: subscription.lessonId,
    subscribedVersionId: subscription.subscribedVersionId,
    fulfilledVersionId: subscription.fulfilledVersionId,
    status: lessonAvailabilitySubscriptionStatus(subscription),
    subscribedAt: subscription.subscribedAt,
    cancelledAt: subscription.cancelledAt,
    fulfilledAt: subscription.fulfilledAt,
  };
}

async function lockCourseForSubscription(
  tx: LessonAvailabilityTransaction,
  input: { organizationId: string; courseId: string },
) {
  const [course] = await tx
    .select({
      id: courses.id,
      publishedVersionId: courses.publishedVersionId,
    })
    .from(courses)
    .where(
      and(
        eq(courses.id, input.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .limit(1)
    .for("share");
  if (!course?.publishedVersionId) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }
  return course;
}

async function lockExistingCourseForSubscription(
  tx: LessonAvailabilityTransaction,
  input: { organizationId: string; courseId: string },
) {
  const [course] = await tx
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, input.courseId),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!course) {
    throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  }
  return course;
}

async function requireComingSoonLesson(
  tx: LessonAvailabilityTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    now: Date;
  },
) {
  const [member] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!member) {
    throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  }

  const access = await getCourseLearningAccess(tx, input);
  if (!access) {
    throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  }
  const lesson = access.lessons.get(input.lessonId);
  if (!lesson?.access.listed) {
    throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  }
  if (!canSubscribeToLessonAvailability(lesson.access)) {
    throw new ApiError(
      409,
      "conflict",
      "Diese Lektion ist nicht als 'Erscheint bald' vorgemerkt.",
    );
  }
  return { access, lesson };
}

export async function subscribeToLessonAvailability(
  tx: LessonAvailabilityTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const course = await lockCourseForSubscription(tx, input);
  const target = await requireComingSoonLesson(tx, { ...input, now });
  if (target.access.published.versionId !== course.publishedVersionId) {
    throw new ApiError(
      409,
      "conflict",
      "Der Kurs wurde parallel aktualisiert. Bitte erneut versuchen.",
    );
  }

  const [created] = await tx
    .insert(lessonAvailabilitySubscriptions)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      subscribedVersionId: course.publishedVersionId,
      subscribedAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return { subscription: created, created: true };

  const [existing] = await tx
    .select()
    .from(lessonAvailabilitySubscriptions)
    .where(
      and(
        eq(
          lessonAvailabilitySubscriptions.organizationId,
          input.organizationId,
        ),
        eq(lessonAvailabilitySubscriptions.userId, input.userId),
        eq(lessonAvailabilitySubscriptions.courseId, input.courseId),
        eq(lessonAvailabilitySubscriptions.lessonId, input.lessonId),
        isNull(lessonAvailabilitySubscriptions.cancelledAt),
        isNull(lessonAvailabilitySubscriptions.fulfilledAt),
      ),
    )
    .limit(1)
    .for("update");
  if (!existing) {
    throw new ApiError(
      409,
      "conflict",
      "Das Abonnement konnte nicht eindeutig angelegt werden.",
    );
  }
  return { subscription: existing, created: false };
}

export async function unsubscribeFromLessonAvailability(
  tx: LessonAvailabilityTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  await lockExistingCourseForSubscription(tx, input);
  const [member] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.role, "member"),
        eq(users.status, "active"),
      ),
    )
    .limit(1)
    .for("share");
  if (!member) {
    throw new ApiError(404, "not_found", "Aktives Abonnement nicht gefunden.");
  }
  const [cancelled] = await tx
    .update(lessonAvailabilitySubscriptions)
    .set({ cancelledAt: now, updatedAt: now })
    .where(
      and(
        eq(
          lessonAvailabilitySubscriptions.organizationId,
          input.organizationId,
        ),
        eq(lessonAvailabilitySubscriptions.userId, input.userId),
        eq(lessonAvailabilitySubscriptions.courseId, input.courseId),
        eq(lessonAvailabilitySubscriptions.lessonId, input.lessonId),
        isNull(lessonAvailabilitySubscriptions.cancelledAt),
        isNull(lessonAvailabilitySubscriptions.fulfilledAt),
      ),
    )
    .returning();
  return { subscription: cancelled ?? null, cancelled: Boolean(cancelled) };
}

export async function listLessonAvailabilitySubscriptions(input: {
  organizationId: string;
  userId?: string;
  courseId?: string;
  lessonId?: string;
  status?: LessonAvailabilitySubscriptionStatus;
  limit?: number;
  offset?: number;
}) {
  const conditions = [
    eq(lessonAvailabilitySubscriptions.organizationId, input.organizationId),
  ];
  if (input.userId) {
    conditions.push(eq(lessonAvailabilitySubscriptions.userId, input.userId));
  }
  if (input.courseId) {
    conditions.push(
      eq(lessonAvailabilitySubscriptions.courseId, input.courseId),
    );
  }
  if (input.lessonId) {
    conditions.push(
      eq(lessonAvailabilitySubscriptions.lessonId, input.lessonId),
    );
  }
  if (input.status === "active") {
    conditions.push(isNull(lessonAvailabilitySubscriptions.cancelledAt));
    conditions.push(isNull(lessonAvailabilitySubscriptions.fulfilledAt));
  } else if (input.status === "cancelled") {
    conditions.push(isNotNull(lessonAvailabilitySubscriptions.cancelledAt));
  } else if (input.status === "fulfilled") {
    conditions.push(isNotNull(lessonAvailabilitySubscriptions.fulfilledAt));
  }
  const query = db
    .select()
    .from(lessonAvailabilitySubscriptions)
    .where(and(...conditions))
    .orderBy(
      asc(lessonAvailabilitySubscriptions.subscribedAt),
      asc(lessonAvailabilitySubscriptions.id),
    );
  if (input.limit !== undefined) {
    return query.limit(input.limit).offset(input.offset ?? 0);
  }
  return query;
}

function completedLessonsByUser(
  rows: Array<{ userId: string; lessonId: string }>,
) {
  const result = new Map<string, Set<string>>();
  for (const row of rows) {
    const lessonIds = result.get(row.userId) ?? new Set<string>();
    lessonIds.add(row.lessonId);
    result.set(row.userId, lessonIds);
  }
  return result;
}

function lessonAvailabilityCopy(
  locale: AppLocale,
  input: { lessonTitle: string; courseTitle: string },
) {
  const copy = {
    de: {
      title: "Neue Lektion verfuegbar",
      subject: `${input.lessonTitle} ist jetzt verfuegbar`,
      message: `Deine vorgemerkte Lektion im Kurs ${input.courseTitle} kann jetzt geoeffnet werden.`,
    },
    en: {
      title: "New lesson available",
      subject: `${input.lessonTitle} is now available`,
      message: `Your saved lesson in ${input.courseTitle} can now be opened.`,
    },
    it: {
      title: "Nuova lezione disponibile",
      subject: `${input.lessonTitle} è ora disponibile`,
      message: `La lezione salvata nel corso ${input.courseTitle} può ora essere aperta.`,
    },
    es: {
      title: "Nueva lección disponible",
      subject: `${input.lessonTitle} ya está disponible`,
      message: `Ya puedes abrir la lección guardada del curso ${input.courseTitle}.`,
    },
    fr: {
      title: "Nouvelle leçon disponible",
      subject: `${input.lessonTitle} est maintenant disponible`,
      message: `Votre leçon enregistrée dans le cours ${input.courseTitle} peut maintenant être ouverte.`,
    },
  } satisfies Record<
    AppLocale,
    { title: string; subject: string; message: string }
  >;
  return copy[locale];
}

export async function fulfillLessonAvailabilitySubscriptions(
  tx: LessonAvailabilityTransaction,
  input: {
    organizationId: string;
    courseId: string;
    courseSlug: string;
    courseTitle: string;
    previousPublished: PublishedCourseContent | null;
    nextPublished: PublishedCourseContent;
    fulfilledAt: Date;
  },
) {
  if (!input.previousPublished) return [];
  const subscriptions = await tx
    .select()
    .from(lessonAvailabilitySubscriptions)
    .where(
      and(
        eq(
          lessonAvailabilitySubscriptions.organizationId,
          input.organizationId,
        ),
        eq(lessonAvailabilitySubscriptions.courseId, input.courseId),
        isNull(lessonAvailabilitySubscriptions.cancelledAt),
        isNull(lessonAvailabilitySubscriptions.fulfilledAt),
      ),
    )
    .orderBy(asc(lessonAvailabilitySubscriptions.id))
    .for("update");
  if (!subscriptions.length) return [];

  const userIds = [...new Set(subscriptions.map(({ userId }) => userId))];
  const lessonIds = [
    ...new Set([
      ...input.previousPublished.snapshot.modules.flatMap((learningModule) => [
        ...learningModule.lessons.map(({ id }) => id),
      ]),
      ...input.nextPublished.snapshot.modules.flatMap((learningModule) => [
        ...learningModule.lessons.map(({ id }) => id),
      ]),
    ]),
  ];
  const [
    recipientRows,
    progressRows,
    overrideRows,
    defaultLocale,
    emailDisabledUserIds,
  ] = await Promise.all([
    tx
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
          inArray(users.id, userIds),
        ),
      ),
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
  const recipients = new Map(recipientRows.map((row) => [row.id, row]));
  const completedByUser = completedLessonsByUser(progressRows);
  const accessStartedAtByUser = new Map<string, Date>();
  for (const userId of userIds) {
    const access = await resolveMemberCourseAccessWithReader(tx, {
      organizationId: input.organizationId,
      userId,
      courseIds: [input.courseId],
      now: input.fulfilledAt,
    });
    const courseAccess = access.get(input.courseId);
    if (courseAccess?.accessible && courseAccess.accessStartedAt) {
      accessStartedAtByUser.set(userId, courseAccess.accessStartedAt);
    }
  }

  const fulfilled = [];
  for (const subscription of subscriptions) {
    const recipient = recipients.get(subscription.userId);
    const accessStartedAt = accessStartedAtByUser.get(subscription.userId);
    if (!recipient || !accessStartedAt) continue;
    const moduleOverrides = new Map(
      overrideRows
        .filter(({ userId }) => userId === subscription.userId)
        .map((override) => [
          override.moduleId,
          { state: override.state, expiresAt: override.expiresAt },
        ]),
    );
    const resolverInput = {
      enrollment: {
        id: recipient.enrollmentId,
        enrolledAt: recipient.enrolledAt,
      },
      courseAccessStartedAt: accessStartedAt,
      completedLessonIds:
        completedByUser.get(subscription.userId) ?? new Set<string>(),
      moduleOverrides,
      now: input.fulfilledAt,
    };
    const previousAccess = resolvePublishedCourseLearningAccess({
      ...resolverInput,
      published: input.previousPublished,
    }).lessons.get(subscription.lessonId)?.access;
    const nextAccess = resolvePublishedCourseLearningAccess({
      ...resolverInput,
      published: input.nextPublished,
    }).lessons.get(subscription.lessonId)?.access;
    if (
      !shouldFulfillLessonAvailabilitySubscription({
        previousAccess,
        nextAccess,
      })
    ) {
      continue;
    }
    const publishedLesson = findSnapshotLesson(
      input.nextPublished.snapshot,
      subscription.lessonId,
    );
    if (!publishedLesson) continue;

    const href = `/academy/courses/${input.courseSlug}/learn/${subscription.lessonId}`;
    const absoluteHref = new URL(href, getPublicAppUrl()).toString();
    const notificationId = randomUUID();
    const deliveryId = emailDisabledUserIds.has(subscription.userId)
      ? null
      : randomUUID();
    const locale = effectiveLocale({
      preferredLocale: recipient.preferredLocale,
      defaultLocale,
    });
    const copy = lessonAvailabilityCopy(locale, {
      lessonTitle: publishedLesson.lesson.title,
      courseTitle: input.courseTitle,
    });
    await tx.insert(notifications).values({
      id: notificationId,
      userId: subscription.userId,
      title: copy.title,
      body: copy.subject,
      type: "lesson_available",
      category: "learning",
      href,
    });
    if (deliveryId) {
      const rendered = await renderTenantEmailContent(tx, {
        organizationId: input.organizationId,
        event: "lesson.available",
        variables: {
          defaultSubject: copy.subject,
          defaultMessage: copy.message,
          firstName: recipient.firstName,
          lessonTitle: publishedLesson.lesson.title,
          courseTitle: input.courseTitle,
          lessonUrl: absoluteHref,
        },
        locale,
        recipientUserId: recipient.id,
      });
      await tx.insert(emailDeliveries).values({
        id: deliveryId,
        organizationId: input.organizationId,
        userId: subscription.userId,
        event: "lesson.available",
        category: "learning",
        recipientEmail: recipient.email,
        payload: encryptPayload(
          JSON.stringify({ ...rendered, link: absoluteHref, locale }),
          `email-delivery:${deliveryId}`,
        ),
      });
    }
    const [updated] = await tx
      .update(lessonAvailabilitySubscriptions)
      .set({
        fulfilledVersionId: input.nextPublished.versionId,
        notificationId,
        emailDeliveryId: deliveryId,
        fulfilledAt: input.fulfilledAt,
        updatedAt: input.fulfilledAt,
      })
      .where(
        and(
          eq(lessonAvailabilitySubscriptions.id, subscription.id),
          eq(
            lessonAvailabilitySubscriptions.organizationId,
            input.organizationId,
          ),
          isNull(lessonAvailabilitySubscriptions.cancelledAt),
          isNull(lessonAvailabilitySubscriptions.fulfilledAt),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiError(
        409,
        "conflict",
        "Das Lektionsabonnement wurde parallel veraendert.",
      );
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: subscription.userId,
      type: "lesson.availability.notified",
      entityType: "lesson_availability_subscription",
      entityId: subscription.id,
      metadata: {
        courseId: input.courseId,
        lessonId: subscription.lessonId,
        versionId: input.nextPublished.versionId,
        notificationId,
        emailDeliveryId: deliveryId,
      },
    });
    await enqueueWebhook(
      input.organizationId,
      "lesson.available",
      {
        subscriptionId: subscription.id,
        userId: subscription.userId,
        courseId: input.courseId,
        lessonId: subscription.lessonId,
        versionId: input.nextPublished.versionId,
      },
      tx,
    );
    fulfilled.push(updated);
  }
  return fulfilled;
}

export type LessonAvailabilityPublication = {
  id: string;
  version: number;
  publishedAt: Date;
  firstPublishedAt: Date;
  snapshot: CourseVersionSnapshot;
};
