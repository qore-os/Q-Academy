import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, count, eq } from "drizzle-orm";

import { db, postgresClient } from "../src/db/index";
import {
  courseAccessGrants,
  courseModules,
  courses,
  courseVersions,
  emailDeliveries,
  enrollments,
  events,
  feedbackEntries,
  lessonAvailabilitySubscriptions,
  lessons,
  modules,
  notifications,
  organizations,
  userNotificationPreferences,
  users,
  type CourseVersionSnapshot,
} from "../src/db/schema";
import { applyEventLifecycleTransition } from "../src/lib/event-lifecycle";
import { queueFeedbackReplyInTransaction } from "../src/lib/feedback-service";
import { fulfillLessonAvailabilitySubscriptions } from "../src/lib/lesson-availability-service";

class RollbackFixture extends Error {}

after(async () => {
  await postgresClient.end();
});

test("feedback opt-out rejects before an email outbox record is created", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: "Feedback preference producer",
          slug: `feedback-preference-${suffix}`,
        })
        .returning();
      const [actor, member] = await tx
        .insert(users)
        .values([
          {
            organizationId: organization.id,
            email: `actor-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Feedback",
            lastName: "Owner",
            role: "owner" as const,
          },
          {
            organizationId: organization.id,
            email: `member-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Feedback",
            lastName: "Member",
            role: "member" as const,
          },
        ])
        .returning();
      const [feedback] = await tx
        .insert(feedbackEntries)
        .values({
          organizationId: organization.id,
          userId: member.id,
          type: "platform",
          rating: 4,
          content: "Preference integration fixture",
        })
        .returning();
      await tx.insert(userNotificationPreferences).values({
        organizationId: organization.id,
        userId: member.id,
        category: "feedback",
        emailEnabled: false,
        pushEnabled: true,
      });

      await assert.rejects(
        queueFeedbackReplyInTransaction(tx, {
          organizationId: organization.id,
          feedbackId: feedback.id,
          actorId: actor.id,
          actorRole: actor.role,
          access: "tenant",
          subject: "Antwort",
          message: "Diese Nachricht darf nicht materialisiert werden.",
        }),
        (error: unknown) =>
          typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409,
      );
      const [deliveryCount] = await tx
        .select({ value: count() })
        .from(emailDeliveries)
        .where(
          and(
            eq(emailDeliveries.organizationId, organization.id),
            eq(emailDeliveries.userId, member.id),
            eq(emailDeliveries.event, "feedback.reply"),
          ),
        );
      const [storedFeedback] = await tx
        .select({ status: feedbackEntries.status })
        .from(feedbackEntries)
        .where(eq(feedbackEntries.id, feedback.id));
      assert.equal(deliveryCount.value, 0);
      assert.equal(storedFeedback.status, "new");
      throw new RollbackFixture();
    }),
    RollbackFixture,
  );
});

test("event opt-out keeps the in-app notification without queuing email", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const suffix = randomUUID();
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: "Event preference producer",
          slug: `event-preference-${suffix}`,
        })
        .returning();
      const [actor, member] = await tx
        .insert(users)
        .values([
          {
            organizationId: organization.id,
            email: `actor-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Event",
            lastName: "Owner",
            role: "owner" as const,
          },
          {
            organizationId: organization.id,
            email: `member-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Event",
            lastName: "Member",
            role: "member" as const,
          },
        ])
        .returning();
      const [event] = await tx
        .insert(events)
        .values({
          organizationId: organization.id,
          title: "Preference lifecycle event",
          startsAt: new Date("2030-08-01T09:00:00.000Z"),
          endsAt: new Date("2030-08-01T10:00:00.000Z"),
          createdById: actor.id,
        })
        .returning();
      await tx.insert(userNotificationPreferences).values({
        organizationId: organization.id,
        userId: member.id,
        category: "events",
        emailEnabled: false,
        pushEnabled: true,
      });

      const result = await applyEventLifecycleTransition(tx, {
        eventId: event.id,
        organizationId: organization.id,
        actor: { reference: "a".repeat(64), userId: actor.id },
        command: {
          action: "cancel",
          reason: "Preference integration fixture",
        },
      });
      assert.equal(result.ok, true);
      const [deliveryCount] = await tx
        .select({ value: count() })
        .from(emailDeliveries)
        .where(
          and(
            eq(emailDeliveries.organizationId, organization.id),
            eq(emailDeliveries.userId, member.id),
            eq(emailDeliveries.event, "event.cancelled"),
          ),
        );
      const [notificationCount] = await tx
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, member.id),
            eq(notifications.category, "events"),
          ),
        );
      assert.equal(deliveryCount.value, 0);
      assert.equal(notificationCount.value, 1);
      throw new RollbackFixture();
    }),
    RollbackFixture,
  );
});

test("lesson opt-out fulfills the subscription without materializing email PII", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const suffix = randomUUID();
      const fulfilledAt = new Date("2028-01-15T12:00:00.000Z");
      const firstPublishedAt = new Date("2028-01-01T12:00:00.000Z");
      const previousVersionId = randomUUID();
      const nextVersionId = randomUUID();
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: "Lesson preference producer",
          slug: `lesson-preference-${suffix}`,
        })
        .returning();
      const [member] = await tx
        .insert(users)
        .values({
          organizationId: organization.id,
          email: `member-${suffix}@example.test`,
          passwordHash: "unused",
          firstName: "Lesson",
          lastName: "Member",
          role: "member",
        })
        .returning();
      const [course] = await tx
        .insert(courses)
        .values({
          organizationId: organization.id,
          title: "Preference course",
          slug: `preference-course-${suffix}`,
          shortDescription: "Preference fixture",
          description: "Preference fixture",
        })
        .returning();
      const [learningModule] = await tx
        .insert(modules)
        .values({
          organizationId: organization.id,
          title: "Preference module",
          isReusable: false,
        })
        .returning();
      await tx.insert(courseModules).values({
        organizationId: organization.id,
        courseId: course.id,
        moduleId: learningModule.id,
        accessMode: "visible",
      });
      const [lesson] = await tx
        .insert(lessons)
        .values({
          organizationId: organization.id,
          moduleId: learningModule.id,
          title: "Preference lesson",
          slug: `preference-lesson-${suffix}`,
        })
        .returning();

      const snapshot = (
        visibility: "visible" | "coming_soon",
      ): CourseVersionSnapshot => ({
        schemaVersion: 6,
        accessPolicyVersion: 2,
        moduleKindVersion: 1,
        courseOutlineVersion: 1,
        capturedAt: fulfilledAt.toISOString(),
        course: {
          ...course,
          status: "published",
          publishedVersionId: nextVersionId,
          firstPublishedAt: firstPublishedAt.toISOString(),
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
        },
        learningGoals: [],
        authors: [],
        widgets: [],
        modules: [
          {
            ...learningModule,
            targetVersionIdAtCapture: null,
            createdAt: learningModule.createdAt.toISOString(),
            updatedAt: learningModule.updatedAt.toISOString(),
            sortOrder: 0,
            indentLevel: 0,
            dripDays: 0,
            accessMode: "visible",
            delayPendingState: "locked",
            availableFrom: null,
            availableUntil: null,
            windowDefaultState: "locked",
            windowState: "available",
            requestAccessEnabled: false,
            isRequired: true,
            lessons: [
              {
                ...lesson,
                visibility,
                availableAt: null,
                createdAt: lesson.createdAt.toISOString(),
                updatedAt: lesson.updatedAt.toISOString(),
                blocks: [],
                pages: [],
              },
            ],
          },
        ],
      });
      const previousSnapshot = snapshot("coming_soon");
      const nextSnapshot = snapshot("visible");
      const [previousVersion, nextVersion] = await tx
        .insert(courseVersions)
        .values([
          {
            id: previousVersionId,
            organizationId: organization.id,
            courseId: course.id,
            version: 1,
            snapshot: previousSnapshot,
            publishedAt: firstPublishedAt,
          },
          {
            id: nextVersionId,
            organizationId: organization.id,
            courseId: course.id,
            version: 2,
            snapshot: nextSnapshot,
            publishedAt: fulfilledAt,
          },
        ])
        .returning();
      await tx
        .update(courses)
        .set({
          status: "published",
          publishedVersionId: nextVersion.id,
          firstPublishedAt,
        })
        .where(eq(courses.id, course.id));
      const [enrollment] = await tx
        .insert(enrollments)
        .values({ userId: member.id, courseId: course.id })
        .returning();
      await tx.insert(courseAccessGrants).values({
        organizationId: organization.id,
        userId: member.id,
        courseId: course.id,
        source: `direct:${enrollment.id}`,
        createdAt: firstPublishedAt,
      });
      await tx.insert(userNotificationPreferences).values({
        organizationId: organization.id,
        userId: member.id,
        category: "learning",
        emailEnabled: false,
        pushEnabled: true,
      });
      const [subscription] = await tx
        .insert(lessonAvailabilitySubscriptions)
        .values({
          organizationId: organization.id,
          userId: member.id,
          courseId: course.id,
          lessonId: lesson.id,
          subscribedVersionId: previousVersion.id,
        })
        .returning();

      const fulfilled = await fulfillLessonAvailabilitySubscriptions(tx, {
        organizationId: organization.id,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        previousPublished: {
          courseId: course.id,
          versionId: previousVersion.id,
          version: previousVersion.version,
          publishedAt: previousVersion.publishedAt!,
          firstPublishedAt,
          snapshot: previousSnapshot,
        },
        nextPublished: {
          courseId: course.id,
          versionId: nextVersion.id,
          version: nextVersion.version,
          publishedAt: nextVersion.publishedAt!,
          firstPublishedAt,
          snapshot: nextSnapshot,
        },
        fulfilledAt,
      });
      assert.equal(fulfilled.length, 1);
      assert.equal(fulfilled[0]?.emailDeliveryId, null);
      assert.ok(fulfilled[0]?.notificationId);
      assert.equal(fulfilled[0]?.cancelledAt, null);
      assert.equal(
        fulfilled[0]?.fulfilledAt?.toISOString(),
        fulfilledAt.toISOString(),
      );
      const [deliveryCount] = await tx
        .select({ value: count() })
        .from(emailDeliveries)
        .where(
          and(
            eq(emailDeliveries.organizationId, organization.id),
            eq(emailDeliveries.userId, member.id),
            eq(emailDeliveries.event, "lesson.available"),
          ),
        );
      const [notificationCount] = await tx
        .select({ value: count() })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, member.id),
            eq(notifications.category, "learning"),
          ),
        );
      const [storedSubscription] = await tx
        .select({
          fulfilledAt: lessonAvailabilitySubscriptions.fulfilledAt,
          cancelledAt: lessonAvailabilitySubscriptions.cancelledAt,
          emailDeliveryId: lessonAvailabilitySubscriptions.emailDeliveryId,
        })
        .from(lessonAvailabilitySubscriptions)
        .where(eq(lessonAvailabilitySubscriptions.id, subscription.id));
      assert.equal(deliveryCount.value, 0);
      assert.equal(notificationCount.value, 1);
      assert.equal(storedSubscription.emailDeliveryId, null);
      assert.equal(storedSubscription.cancelledAt, null);
      assert.equal(
        storedSubscription.fulfilledAt?.toISOString(),
        fulfilledAt.toISOString(),
      );
      throw new RollbackFixture();
    }),
    RollbackFixture,
  );
});
