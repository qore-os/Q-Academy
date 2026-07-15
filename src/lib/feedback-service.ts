import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  apiKeys,
  bundleCourses,
  bundles,
  courseAccessGrants,
  courses,
  emailDeliveries,
  enrollments,
  feedbackEntries,
  users,
} from "@/db/schema";
import { encryptPayload } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { requireCoursePermissionInTransaction } from "@/lib/course-permissions";
import { renderTenantEmailContent } from "@/lib/email-center";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { canSubmitLessonFeedback } from "@/lib/feedback-policy";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { usersWithEmailNotificationsDisabled } from "@/lib/notification-preferences";
import { lockMemberCourseProgress } from "@/lib/progress-lock";

export type FeedbackTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

const teamRoles = ["owner", "admin", "trainer"] as const;
type FeedbackActorRole = (typeof users.$inferSelect)["role"];

async function lockFeedback(
  tx: FeedbackTransaction,
  organizationId: string,
  feedbackId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`feedback:${organizationId}:${feedbackId}`}, 0))`,
  );
}

async function lockMemberLearningContext(
  tx: FeedbackTransaction,
  input: { organizationId: string; userId: string; courseId: string },
) {
  await lockMemberCourseProgress(tx, input);

  const [context] = await tx
    .select({
      userId: users.id,
      enrollmentId: enrollments.id,
      courseId: courses.id,
    })
    .from(enrollments)
    .innerJoin(
      users,
      and(
        eq(users.id, enrollments.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        eq(users.role, "member"),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.courseId, input.courseId),
        eq(enrollments.accessActive, true),
      ),
    )
    .limit(1);
  if (!context) {
    throw new ApiError(403, "forbidden", "Dieser Kurs ist nicht verfuegbar.");
  }

  await tx
    .select({ id: courseAccessGrants.id })
    .from(courseAccessGrants)
    .where(
      and(
        eq(courseAccessGrants.organizationId, input.organizationId),
        eq(courseAccessGrants.userId, input.userId),
        eq(courseAccessGrants.courseId, input.courseId),
      ),
    )
    .for("share");

  await tx
    .select({ id: bundleCourses.bundleId })
    .from(bundleCourses)
    .innerJoin(
      bundles,
      and(
        eq(bundles.id, bundleCourses.bundleId),
        eq(bundles.organizationId, input.organizationId),
      ),
    )
    .where(eq(bundleCourses.courseId, input.courseId))
    .for("share");
}

export async function createMemberLessonFeedbackInTransaction(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    rating: number;
    content?: string | null;
    now?: Date;
  },
) {
  await lockMemberLearningContext(tx, input);
  const access = await getCourseLearningAccess(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseId: input.courseId,
    now: input.now,
  });
  const lessonAccess = access?.lessons.get(input.lessonId)?.access;
  if (!canSubmitLessonFeedback(lessonAccess)) {
    throw new ApiError(
      403,
      "forbidden",
      "Feedback ist nur fuer sichtbare, lesbare Lektionen moeglich.",
    );
  }

  const [feedback] = await tx
    .insert(feedbackEntries)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      type: "lesson",
      rating: input.rating,
      content: input.content?.trim() ?? "",
      testimonialConsent: false,
    })
    .returning();
  return feedback;
}

export async function createMemberCourseFeedbackInTransaction(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    rating: number;
    content: string;
    testimonialConsent: boolean;
    now?: Date;
  },
) {
  await lockMemberLearningContext(tx, input);
  const access = await getCourseLearningAccess(tx, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseId: input.courseId,
    now: input.now,
  });
  if (!access) {
    throw new ApiError(403, "forbidden", "Dieser Kurs ist nicht verfuegbar.");
  }
  const [feedback] = await tx
    .insert(feedbackEntries)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
      type: "course",
      rating: input.rating,
      content: input.content.trim(),
      testimonialConsent: input.testimonialConsent,
    })
    .returning();
  return feedback;
}

export async function requireFeedbackApiActor(
  tx: FeedbackTransaction,
  input: { organizationId: string; apiKeyId: string },
) {
  const [actor] = await tx
    .select({ id: users.id, role: users.role })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
        inArray(users.role, teamRoles),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Teammitglied zugeordnet.",
    );
  }
  return actor;
}

export async function requireFeedbackTeamActor(
  tx: FeedbackTransaction,
  input: { organizationId: string; actorId: string },
) {
  const [actor] = await tx
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, input.actorId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        inArray(users.role, teamRoles),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur aktive Teammitglieder duerfen Feedback bearbeiten.",
    );
  }
  return actor;
}

async function feedbackTargetForUpdate(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    feedbackId: string;
    expectedCourseId: string | null;
  },
) {
  await lockFeedback(tx, input.organizationId, input.feedbackId);
  const [target] = await tx
    .select({
      feedback: feedbackEntries,
      recipientId: users.id,
      recipientEmail: users.email,
      recipientFirstName: users.firstName,
      recipientStatus: users.status,
      recipientRole: users.role,
      courseTitle: courses.title,
    })
    .from(feedbackEntries)
    .innerJoin(
      users,
      and(
        eq(users.id, feedbackEntries.userId),
        eq(users.organizationId, feedbackEntries.organizationId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.id, feedbackEntries.courseId),
        eq(courses.organizationId, feedbackEntries.organizationId),
      ),
    )
    .where(
      and(
        eq(feedbackEntries.id, input.feedbackId),
        eq(feedbackEntries.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: feedbackEntries });
  if (!target) {
    throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
  }
  if (target.feedback.courseId !== input.expectedCourseId) {
    throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
  }
  return target;
}

async function requireFeedbackModerationPermission(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    feedbackId: string;
    actorId: string;
    actorRole: FeedbackActorRole;
    access: "course" | "tenant";
  },
) {
  const [target] = await tx
    .select({ courseId: feedbackEntries.courseId })
    .from(feedbackEntries)
    .where(
      and(
        eq(feedbackEntries.id, input.feedbackId),
        eq(feedbackEntries.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!target) {
    throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
  }

  if (input.access === "tenant") {
    const [actor] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.actorId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
          inArray(users.role, teamRoles),
        ),
      )
      .limit(1)
      .for("share");
    if (!actor) {
      throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
    }
    return target.courseId;
  }

  if (target.courseId) {
    try {
      await requireCoursePermissionInTransaction(
        tx,
        {
          id: input.actorId,
          organizationId: input.organizationId,
        },
        target.courseId,
        "edit",
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
      }
      throw error;
    }
    return target.courseId;
  }

  const [actor] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, input.actorId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    )
    .limit(1)
    .for("share");
  if (!actor) {
    throw new ApiError(404, "not_found", "Feedback nicht gefunden.");
  }
  return null;
}

export async function updateFeedbackStatusInTransaction(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    feedbackId: string;
    actorId: string;
    actorRole: FeedbackActorRole;
    access: "course" | "tenant";
    status: "new" | "reviewed" | "archived";
    now?: Date;
  },
) {
  const expectedCourseId = await requireFeedbackModerationPermission(tx, input);
  const target = await feedbackTargetForUpdate(tx, {
    ...input,
    expectedCourseId,
  });
  const now = input.now ?? new Date();
  const [feedback] = await tx
    .update(feedbackEntries)
    .set({
      status: input.status,
      reviewedById: input.status === "new" ? null : input.actorId,
      reviewedAt: input.status === "new" ? null : now,
    })
    .where(
      and(
        eq(feedbackEntries.id, input.feedbackId),
        eq(feedbackEntries.organizationId, input.organizationId),
      ),
    )
    .returning();
  return { feedback, target };
}

export async function queueFeedbackReplyInTransaction(
  tx: FeedbackTransaction,
  input: {
    organizationId: string;
    feedbackId: string;
    actorId: string;
    actorRole: FeedbackActorRole;
    access: "course" | "tenant";
    subject: string;
    message: string;
  },
) {
  const expectedCourseId = await requireFeedbackModerationPermission(tx, input);
  const target = await feedbackTargetForUpdate(tx, {
    ...input,
    expectedCourseId,
  });
  const [recipient] = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      status: users.status,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.id, target.recipientId),
        eq(users.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (
    !recipient ||
    recipient.status !== "active" ||
    recipient.role !== "member"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Das Zielmitglied ist nicht aktiv. Es wurde keine E-Mail vorgemerkt.",
    );
  }
  const emailDisabledUserIds = await usersWithEmailNotificationsDisabled(tx, {
    organizationId: input.organizationId,
    userIds: [recipient.id],
    category: "feedback",
  });
  if (emailDisabledUserIds.has(recipient.id)) {
    throw new ApiError(
      409,
      "conflict",
      "Das Zielmitglied hat Feedback-E-Mails deaktiviert. Es wurde keine E-Mail vorgemerkt.",
    );
  }

  const deliveryId = randomUUID();
  const recipientLocale = await resolveRecipientLocale(tx, {
    organizationId: input.organizationId,
    userId: recipient.id,
  });
  const rendered = await renderTenantEmailContent(tx, {
    organizationId: input.organizationId,
    event: "feedback.reply",
    variables: {
      defaultSubject: input.subject.trim(),
      defaultMessage: input.message.trim(),
      firstName: recipient.firstName,
    },
    locale: recipientLocale,
    recipientUserId: recipient.id,
  });
  const [delivery] = await tx
    .insert(emailDeliveries)
    .values({
      id: deliveryId,
      organizationId: input.organizationId,
      userId: recipient.id,
      event: "feedback.reply",
      category: "feedback",
      recipientEmail: recipient.email,
      payload: encryptPayload(
        JSON.stringify({ ...rendered, locale: recipientLocale }),
        `email-delivery:${deliveryId}`,
      ),
    })
    .returning({ id: emailDeliveries.id, status: emailDeliveries.status });

  const [feedback] = await tx
    .update(feedbackEntries)
    .set({
      status: "reviewed",
      reviewedById: input.actorId,
      reviewedAt: new Date(),
    })
    .where(
      and(
        eq(feedbackEntries.id, input.feedbackId),
        eq(feedbackEntries.organizationId, input.organizationId),
      ),
    )
    .returning();

  return {
    delivery,
    feedback,
    target: { ...target, recipient },
  };
}
