import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, count, eq } from "drizzle-orm";

import { db, postgresClient } from "../src/db/index";
import {
  courseAccessGrants,
  courses,
  emailDeliveries,
  enrollments,
  organizations,
  userNotificationPreferences,
  users,
  type CourseVersionSnapshot,
} from "../src/db/schema";
import { queueCourseModuleReleaseEmails, previewCourseModuleReleaseEmails } from "../src/lib/course-module-release-email";
import type { PublishedCourseContent } from "../src/lib/published-course";

class RollbackFixture extends Error {}

after(async () => {
  await postgresClient.end();
});

test("course module release email is eligible, opt-out aware, tenant-bound and deduplicated", async () => {
  await assert.rejects(
    db.transaction(async (tx) => {
      const suffix = randomUUID();
      const releasedAt = new Date();
      const [organization, foreignOrganization] = await tx
        .insert(organizations)
        .values([
          {
            name: `Course release mail ${suffix}`,
            slug: `course-release-mail-${suffix}`,
          },
          {
            name: `Foreign course release mail ${suffix}`,
            slug: `foreign-course-release-mail-${suffix}`,
          },
        ])
        .returning({ id: organizations.id });
      const [owner, optedIn, optedOut, inactive, foreignMember] = await tx
        .insert(users)
        .values([
          {
            organizationId: organization.id,
            email: `release-owner-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Release",
            lastName: "Owner",
            role: "owner" as const,
          },
          {
            organizationId: organization.id,
            email: `release-opted-in-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Opted-in",
            lastName: "Member",
            role: "member" as const,
          },
          {
            organizationId: organization.id,
            email: `release-opted-out-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Opted-out",
            lastName: "Member",
            role: "member" as const,
          },
          {
            organizationId: organization.id,
            email: `release-inactive-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Inactive",
            lastName: "Enrollment",
            role: "member" as const,
          },
          {
            organizationId: foreignOrganization.id,
            email: `release-foreign-${suffix}@example.test`,
            passwordHash: "unused",
            firstName: "Foreign",
            lastName: "Member",
            role: "member" as const,
          },
        ])
        .returning();
      const [course] = await tx
        .insert(courses)
        .values({
          organizationId: organization.id,
          title: "Sichere Modulfreigabe",
          slug: `secure-module-release-${suffix}`,
          shortDescription: "Release email fixture",
          description: "Release email integration fixture.",
          status: "published",
          notifyMembersOnModuleRelease: true,
          firstPublishedAt: releasedAt,
          createdById: owner.id,
        })
        .returning();

      const enrollmentsByUser = await tx
        .insert(enrollments)
        .values([
          { userId: optedIn.id, courseId: course.id },
          { userId: optedOut.id, courseId: course.id },
          { userId: inactive.id, courseId: course.id, accessActive: false },
          { userId: foreignMember.id, courseId: course.id },
        ])
        .returning({
          id: enrollments.id,
          userId: enrollments.userId,
        });
      await tx.insert(courseAccessGrants).values(
        enrollmentsByUser
          .filter((enrollment) => enrollment.userId !== foreignMember.id)
          .map((enrollment) => ({
            organizationId: organization.id,
            userId: enrollment.userId,
            courseId: course.id,
            source: `direct:${enrollment.id}`,
          })),
      );
      await tx.insert(userNotificationPreferences).values({
        organizationId: organization.id,
        userId: optedOut.id,
        category: "learning",
        emailEnabled: false,
      });

      const moduleId = randomUUID();
      const snapshot = (
        accessMode: "coming_soon" | "visible",
      ): CourseVersionSnapshot => ({
        schemaVersion: 6,
        accessPolicyVersion: 2,
        moduleKindVersion: 1,
        courseOutlineVersion: 1,
        capturedAt: releasedAt.toISOString(),
        course: {
          ...course,
          createdAt: course.createdAt.toISOString(),
          updatedAt: course.updatedAt.toISOString(),
          firstPublishedAt: releasedAt.toISOString(),
        },
        learningGoals: [],
        authors: [],
        widgets: [],
        modules: [
          {
            id: moduleId,
            organizationId: organization.id,
            title: "Neu verfuegbares Modul",
            kind: "learning",
            linkedCourseId: null,
            targetVersionIdAtCapture: null,
            description: "Release fixture",
            folder: "Allgemein",
            isReusable: false,
            estimatedMinutes: 30,
            createdAt: releasedAt.toISOString(),
            updatedAt: releasedAt.toISOString(),
            sortOrder: 0,
            indentLevel: 0,
            accessMode,
            dripDays: 0,
            delayPendingState: "locked",
            availableFrom: null,
            availableUntil: null,
            windowDefaultState: "locked",
            windowState: "available",
            requestAccessEnabled: false,
            isRequired: true,
            lessons: [],
          },
        ],
      });
      const published = (
        version: number,
        versionId: string,
        courseSnapshot: CourseVersionSnapshot,
      ): PublishedCourseContent => ({
        courseId: course.id,
        versionId,
        version,
        publishedAt: releasedAt,
        firstPublishedAt: releasedAt,
        snapshot: courseSnapshot,
      });
      const previousPublished = published(
        1,
        randomUUID(),
        snapshot("coming_soon"),
      );
      const nextPublished = published(2, randomUUID(), snapshot("visible"));

      const preview = await previewCourseModuleReleaseEmails(tx, {
        organizationId: organization.id,
        courseId: course.id,
        enabled: true,
        previousPublished,
        nextPublished,
        releasedAt,
      });
      assert.deepEqual(preview, {
        enabled: true,
        eligibleRecipientCount: 2,
        recipientCount: 1,
        modules: [{ id: moduleId, title: "Neu verfuegbares Modul" }],
      });

      const firstQueue = await queueCourseModuleReleaseEmails(tx, {
        organizationId: organization.id,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        enabled: true,
        actorUserId: owner.id,
        previousPublished,
        nextPublished,
        releasedAt,
      });
      assert.equal(firstQueue.queuedCount, 1);
      assert.equal(firstQueue.deduplicatedCount, 0);
      assert.equal(firstQueue.preview.eligibleRecipientCount, 2);
      assert.equal(firstQueue.preview.recipientCount, 1);

      const secondQueue = await queueCourseModuleReleaseEmails(tx, {
        organizationId: organization.id,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        enabled: true,
        actorUserId: owner.id,
        previousPublished,
        nextPublished,
        releasedAt,
      });
      assert.equal(secondQueue.queuedCount, 0);
      assert.equal(secondQueue.deduplicatedCount, 1);

      const unchangedPublication = await queueCourseModuleReleaseEmails(tx, {
        organizationId: organization.id,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        enabled: true,
        actorUserId: owner.id,
        previousPublished: nextPublished,
        nextPublished: published(3, randomUUID(), snapshot("visible")),
        releasedAt,
      });
      assert.equal(unchangedPublication.queuedCount, 0);
      assert.equal(unchangedPublication.preview.eligibleRecipientCount, 0);

      const disabled = await queueCourseModuleReleaseEmails(tx, {
        organizationId: organization.id,
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        enabled: false,
        actorUserId: owner.id,
        previousPublished,
        nextPublished: published(4, randomUUID(), snapshot("visible")),
        releasedAt,
      });
      assert.deepEqual(disabled, {
        preview: {
          enabled: false,
          eligibleRecipientCount: 0,
          recipientCount: 0,
          modules: [],
        },
        queuedCount: 0,
        deduplicatedCount: 0,
      });

      const [deliveryCount] = await tx
        .select({ value: count() })
        .from(emailDeliveries)
        .where(
          and(
            eq(emailDeliveries.organizationId, organization.id),
            eq(emailDeliveries.event, "course.modules.released"),
          ),
        );
      const [delivery] = await tx
        .select({
          userId: emailDeliveries.userId,
          category: emailDeliveries.category,
          status: emailDeliveries.status,
        })
        .from(emailDeliveries)
        .where(
          and(
            eq(emailDeliveries.organizationId, organization.id),
            eq(emailDeliveries.event, "course.modules.released"),
          ),
        );
      assert.equal(deliveryCount.value, 1);
      assert.deepEqual(delivery, {
        userId: optedIn.id,
        category: "learning",
        status: "pending",
      });

      throw new RollbackFixture();
    }),
    RollbackFixture,
  );
});
