import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { and, eq, inArray } from "drizzle-orm";

import {
  communityAreas,
  communitySpaces,
  courseAccessGrants,
  courseVersions,
  courses,
  enrollments,
  organizations,
  posts,
  users,
  type CourseVersionSnapshot,
} from "../src/db/schema";
import { ApiError } from "../src/lib/api/errors";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
process.env.DATABASE_URL = databaseUrl;
process.env.SESSION_SECRET ??=
  "community-course-link-session-secret-at-least-32-bytes";
process.env.AUTH_RATE_LIMIT_SECRET ??=
  "community-course-link-rate-limit-secret-at-least-32-bytes";

const { db, postgresClient } = await import("../src/db/index");

after(async () => {
  await postgresClient.end();
});

function validationError(error: unknown) {
  return (
    error instanceof ApiError &&
    error.status === 422 &&
    error.code === "validation_error"
  );
}

function foreignKeyViolation(error: unknown) {
  let current = error;
  while (typeof current === "object" && current !== null) {
    if ("code" in current && current.code === "23503") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

test("community course links enforce tenant, publication, viewer access and deletion integrity", async () => {
  const courseLinks = await import("../src/lib/community-course-links");

  const suffix = randomUUID();
  const organizationIds: string[] = [];

  async function createPublishedCourse(input: {
    organizationId: string;
    createdById: string;
    title: string;
    slug: string;
  }) {
    const publishedAt = new Date();
    const [course] = await db
      .insert(courses)
      .values({
        organizationId: input.organizationId,
        title: input.title,
        slug: input.slug,
        shortDescription: "Community course-link fixture",
        description: "Published course for the typed community-link contract.",
        status: "published",
        firstPublishedAt: publishedAt,
        createdById: input.createdById,
      })
      .returning();
    const snapshot: CourseVersionSnapshot = {
      schemaVersion: 4,
      accessPolicyVersion: 1,
      moduleKindVersion: 1,
      courseOutlineVersion: 1,
      capturedAt: publishedAt.toISOString(),
      course: {
        ...course,
        firstPublishedAt: publishedAt.toISOString(),
        createdAt: course.createdAt.toISOString(),
        updatedAt: course.updatedAt.toISOString(),
      },
      learningGoals: [],
      authors: [],
      widgets: [],
      modules: [],
    };
    const [version] = await db
      .insert(courseVersions)
      .values({
        organizationId: input.organizationId,
        courseId: course.id,
        version: 1,
        snapshot,
        publishedAt,
        createdById: input.createdById,
      })
      .returning({ id: courseVersions.id });
    await db
      .update(courses)
      .set({ publishedVersionId: version.id })
      .where(
        and(
          eq(courses.organizationId, input.organizationId),
          eq(courses.id, course.id),
        ),
      );
    return course;
  }

  try {
    const [organization, foreignOrganization] = await db
      .insert(organizations)
      .values([
        {
          name: `Community course links ${suffix}`,
          slug: `community-course-links-${suffix}`,
        },
        {
          name: `Foreign community course links ${suffix}`,
          slug: `foreign-community-course-links-${suffix}`,
        },
      ])
      .returning({ id: organizations.id });
    organizationIds.push(organization.id, foreignOrganization.id);

    const [owner, authorizedMember, unauthorizedMember, foreignOwner] =
      await db
        .insert(users)
        .values([
          {
            organizationId: organization.id,
            email: `course-link-owner-${suffix}@example.test`,
            passwordHash: "not-a-login-hash",
            firstName: "Course",
            lastName: "Owner",
            role: "owner",
          },
          {
            organizationId: organization.id,
            email: `course-link-member-${suffix}@example.test`,
            passwordHash: "not-a-login-hash",
            firstName: "Course",
            lastName: "Member",
            role: "member",
          },
          {
            organizationId: organization.id,
            email: `course-link-denied-${suffix}@example.test`,
            passwordHash: "not-a-login-hash",
            firstName: "Denied",
            lastName: "Member",
            role: "member",
          },
          {
            organizationId: foreignOrganization.id,
            email: `course-link-foreign-owner-${suffix}@example.test`,
            passwordHash: "not-a-login-hash",
            firstName: "Foreign",
            lastName: "Owner",
            role: "owner",
          },
        ])
        .returning({
          id: users.id,
          organizationId: users.organizationId,
          role: users.role,
        });

    const course = await createPublishedCourse({
      organizationId: organization.id,
      createdById: owner.id,
      title: "Sichtbarer Community-Kurs",
      slug: `visible-community-course-${suffix}`,
    });
    const foreignCourse = await createPublishedCourse({
      organizationId: foreignOrganization.id,
      createdById: foreignOwner.id,
      title: "Mandantenfremder Kurs",
      slug: `foreign-community-course-${suffix}`,
    });
    const [draftCourse] = await db
      .insert(courses)
      .values({
        organizationId: organization.id,
        title: "Unveroeffentlichter Kurs",
        slug: `draft-community-course-${suffix}`,
        shortDescription: "Draft fixture",
        description: "Must never be exposed as a community link.",
        status: "draft",
        createdById: owner.id,
      })
      .returning({ id: courses.id });

    const [enrollment] = await db
      .insert(enrollments)
      .values({ userId: authorizedMember.id, courseId: course.id })
      .returning({ id: enrollments.id });
    await db.insert(courseAccessGrants).values({
      organizationId: organization.id,
      userId: authorizedMember.id,
      courseId: course.id,
      source: `direct:${enrollment.id}`,
    });

    const authorizedActor = {
      id: authorizedMember.id,
      organizationId: organization.id,
      role: authorizedMember.role,
    };
    const unauthorizedActor = {
      id: unauthorizedMember.id,
      organizationId: organization.id,
      role: unauthorizedMember.role,
    };
    const ownerActor = {
      id: owner.id,
      organizationId: organization.id,
      role: owner.role,
    };

    const visibleLink = await courseLinks.requireCommunityCourseLinkForActor(
      db,
      authorizedActor,
      course.id,
    );
    assert.deepEqual(visibleLink, {
      type: "course",
      courseId: course.id,
      title: course.title,
      slug: course.slug,
      href: `/academy/courses/${course.slug}`,
    });
    assert.ok(
      await courseLinks.requireCommunityCourseLinkForActor(
        db,
        ownerActor,
        course.id,
      ),
    );

    await assert.rejects(
      courseLinks.requireCommunityCourseLinkForActor(
        db,
        unauthorizedActor,
        course.id,
      ),
      validationError,
    );
    await assert.rejects(
      courseLinks.requireCommunityCourseLinkForActor(
        db,
        ownerActor,
        draftCourse.id,
      ),
      validationError,
    );
    await assert.rejects(
      courseLinks.requireCommunityCourseLinkForActor(
        db,
        ownerActor,
        foreignCourse.id,
      ),
      validationError,
    );

    const [area] = await db
      .insert(communityAreas)
      .values({
        organizationId: organization.id,
        title: "Allgemein",
        slug: "allgemein",
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space] = await db
      .insert(communitySpaces)
      .values({
        organizationId: organization.id,
        areaId: area.id,
        title: "Course-link feed",
        slug: `course-link-feed-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    const [post] = await db
      .insert(posts)
      .values({
        organizationId: organization.id,
        spaceId: space.id,
        authorId: authorizedMember.id,
        linkedCourseId: course.id,
        content: "Dieser Beitrag verweist auf einen typisierten Kurs.",
      })
      .returning({ id: posts.id, linkedCourseId: posts.linkedCourseId });

    await assert.rejects(
      db.insert(posts).values({
        organizationId: organization.id,
        spaceId: space.id,
        authorId: authorizedMember.id,
        linkedCourseId: foreignCourse.id,
        content: "Mandantenfremde Kursreferenz",
      }),
      foreignKeyViolation,
    );

    const authorizedFeedLinks =
      await courseLinks.communityCourseLinksForPosts(
        authorizedActor,
        [post],
        db,
      );
    const unauthorizedFeedLinks =
      await courseLinks.communityCourseLinksForPosts(
        unauthorizedActor,
        [post],
        db,
      );
    assert.equal(authorizedFeedLinks.get(post.id)?.courseId, course.id);
    assert.equal(unauthorizedFeedLinks.get(post.id), null);

    await db
      .delete(courses)
      .where(
        and(
          eq(courses.organizationId, organization.id),
          eq(courses.id, course.id),
        ),
      );
    const [unlinkedPost] = await db
      .select({ linkedCourseId: posts.linkedCourseId })
      .from(posts)
      .where(eq(posts.id, post.id));
    assert.equal(unlinkedPost.linkedCourseId, null);
  } finally {
    if (organizationIds.length) {
      await db
        .delete(organizations)
        .where(inArray(organizations.id, organizationIds));
    }
  }
});
