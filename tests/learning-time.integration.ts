import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { and, eq } from "drizzle-orm";
import { db, postgresClient } from "../src/db/index";
import {
  courseAccessGrants,
  courseModules,
  courseVersions,
  courses,
  enrollments,
  lessonLearningTimeSessions,
  lessons,
  modules,
  organizations,
  users,
  type CourseVersionSnapshot,
} from "../src/db/schema";
import { getAdminAnalyticsData } from "../src/lib/admin-analytics";
import { getCourseLearningAccess } from "../src/lib/learning-access";
import {
  LearningTimeHeartbeatError,
  recordLearningTimeHeartbeat,
} from "../src/lib/learning-time";

after(async () => {
  await postgresClient.end();
});

function heartbeatFailure(code: LearningTimeHeartbeatError["code"]) {
  return (error: unknown) =>
    error instanceof LearningTimeHeartbeatError && error.code === code;
}

async function accessibleFixture() {
  const suffix = randomUUID();
  const now = new Date();
  const [organization] = await db
    .insert(organizations)
    .values({ name: "Learning-time integration", slug: `learning-time-${suffix}` })
    .returning();
  const [member] = await db
    .insert(users)
    .values({
      organizationId: organization.id,
      email: `learning-time-${suffix}@example.test`,
      passwordHash: "not-a-login-hash",
      firstName: "Learning",
      lastName: "Time",
      role: "member",
      status: "active",
    })
    .returning();
  const [course] = await db
    .insert(courses)
    .values({
      organizationId: organization.id,
      title: "Measured learning",
      slug: `measured-learning-${suffix}`,
      shortDescription: "Integration fixture",
      description: "Integration fixture for active learning time.",
      status: "published",
      createdById: member.id,
    })
    .returning();
  const [learningModule] = await db
    .insert(modules)
    .values({
      organizationId: organization.id,
      title: "Visible module",
      isReusable: false,
    })
    .returning();
  const [courseModule] = await db
    .insert(courseModules)
    .values({
      organizationId: organization.id,
      courseId: course.id,
      moduleId: learningModule.id,
      sortOrder: 0,
      accessMode: "visible",
      isRequired: true,
    })
    .returning();
  const [lesson] = await db
    .insert(lessons)
    .values({
      organizationId: organization.id,
      moduleId: learningModule.id,
      title: "Visible lesson",
      slug: `visible-lesson-${suffix}`,
      status: "published",
      visibility: "visible",
    })
    .returning();
  const snapshot: CourseVersionSnapshot = {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt: now.toISOString(),
    course: {
      ...course,
      firstPublishedAt: now.toISOString(),
      createdAt: course.createdAt.toISOString(),
      updatedAt: now.toISOString(),
    },
    learningGoals: [],
    authors: [],
    widgets: [],
    modules: [
      {
        ...learningModule,
        ...courseModule,
        linkedCourseId: null,
        targetVersionIdAtCapture: null,
        availableFrom: null,
        availableUntil: null,
        createdAt: learningModule.createdAt.toISOString(),
        updatedAt: learningModule.updatedAt.toISOString(),
        lessons: [
          {
            ...lesson,
            availableAt: null,
            createdAt: lesson.createdAt.toISOString(),
            updatedAt: lesson.updatedAt.toISOString(),
            blocks: [],
            pages: [],
          },
        ],
      },
    ],
  };
  const [version] = await db
    .insert(courseVersions)
    .values({
      organizationId: organization.id,
      courseId: course.id,
      version: 1,
      snapshot,
      publishedAt: now,
      createdById: member.id,
    })
    .returning({ id: courseVersions.id });
  await db
    .update(courses)
    .set({ publishedVersionId: version.id, firstPublishedAt: now })
    .where(eq(courses.id, course.id));
  await db.insert(enrollments).values({
    userId: member.id,
    courseId: course.id,
  });
  await db.insert(courseAccessGrants).values({
    organizationId: organization.id,
    userId: member.id,
    courseId: course.id,
    source: "learning-time-integration",
  });
  const access = await getCourseLearningAccess(db, {
    organizationId: organization.id,
    userId: member.id,
    courseId: course.id,
  });
  if (!access?.lessons.get(lesson.id)?.access.accessible) {
    throw new Error("Integration lesson is not accessible.");
  }
  return {
    organizationId: organization.id,
    userId: member.id,
    courseId: course.id,
    courseVersionId: version.id,
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    snapshot,
  };
}

test("learning-time heartbeat is idempotent, serialized and access-bound", async () => {
  const fixture = await accessibleFixture();
  const firstSessionId = randomUUID();
  const secondSessionId = randomUUID();
  const thirdSessionId = randomUUID();
  const base = new Date();
  const heartbeat = (
    trackingSessionId: string,
    sequence: number,
    now: Date,
  ) =>
    recordLearningTimeHeartbeat({
      organizationId: fixture.organizationId,
      userId: fixture.userId,
      heartbeat: {
        courseId: fixture.courseId,
        lessonId: fixture.lessonId,
        trackingSessionId,
        sequence,
      },
      now,
    });

  try {
    const started = await heartbeat(firstSessionId, 0, base);
    assert.equal(started.creditedSeconds, 0);
    const credited = await heartbeat(
      firstSessionId,
      1,
      new Date(base.getTime() + 15_000),
    );
    assert.equal(credited.creditedSeconds, 15);
    assert.equal(credited.sessionActiveSeconds, 15);

    const duplicate = await heartbeat(
      firstSessionId,
      1,
      new Date(base.getTime() + 16_000),
    );
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.sessionActiveSeconds, 15);
    await assert.rejects(
      heartbeat(firstSessionId, 3, new Date(base.getTime() + 30_000)),
      heartbeatFailure("heartbeat_sequence_gap"),
    );

    await heartbeat(secondSessionId, 0, new Date(base.getTime() + 16_000));
    await assert.rejects(
      heartbeat(firstSessionId, 2, new Date(base.getTime() + 31_000)),
      heartbeatFailure("parallel_tracking_session"),
    );
    await heartbeat(secondSessionId, 1, new Date(base.getTime() + 31_000));

    const parallel = await Promise.all([
      heartbeat(secondSessionId, 2, new Date(base.getTime() + 46_000)),
      heartbeat(secondSessionId, 2, new Date(base.getTime() + 46_000)),
    ]);
    assert.equal(parallel.filter((result) => result.duplicate).length, 1);
    assert.equal(parallel.filter((result) => !result.duplicate).length, 1);

    const [stored] = await db
      .select({
        activeSeconds: lessonLearningTimeSessions.activeSeconds,
        courseVersionId: lessonLearningTimeSessions.courseVersionId,
        lessonTitle: lessonLearningTimeSessions.lessonTitle,
        lastSequence: lessonLearningTimeSessions.lastSequence,
      })
      .from(lessonLearningTimeSessions)
      .where(eq(lessonLearningTimeSessions.id, secondSessionId));
    assert.deepEqual(stored, {
      activeSeconds: 30,
      courseVersionId: fixture.courseVersionId,
      lessonTitle: fixture.lessonTitle,
      lastSequence: 2,
    });

    await db
      .delete(lessons)
      .where(
        and(
          eq(lessons.id, fixture.lessonId),
          eq(lessons.organizationId, fixture.organizationId),
        ),
      );
    const afterDraftLessonDeletion = await heartbeat(
      secondSessionId,
      3,
      new Date(base.getTime() + 61_000),
    );
    assert.equal(afterDraftLessonDeletion.creditedSeconds, 15);
    const [durableSession] = await db
      .select({
        activeSeconds: lessonLearningTimeSessions.activeSeconds,
        lessonTitle: lessonLearningTimeSessions.lessonTitle,
      })
      .from(lessonLearningTimeSessions)
      .where(eq(lessonLearningTimeSessions.id, secondSessionId));
    assert.deepEqual(durableSession, {
      activeSeconds: 45,
      lessonTitle: fixture.lessonTitle,
    });

    const analytics = await getAdminAnalyticsData(fixture.organizationId);
    const member = analytics.members.find(
      (entry) => entry.id === fixture.userId,
    );
    const course = analytics.courses.find(
      (entry) => entry.id === fixture.courseId,
    );
    assert.ok((member?.activeLearningSeconds ?? 0) >= 60);
    assert.ok((course?.activeLearningSeconds ?? 0) >= 60);

    await assert.rejects(
      recordLearningTimeHeartbeat({
        organizationId: randomUUID(),
        userId: fixture.userId,
        heartbeat: {
          courseId: fixture.courseId,
          lessonId: fixture.lessonId,
          trackingSessionId: randomUUID(),
          sequence: 0,
        },
        now: new Date(base.getTime() + 60_000),
      }),
      heartbeatFailure("learning_access_denied"),
    );

    const nextLessonTitle = "Visible lesson from version two";
    const nextSnapshot = structuredClone(fixture.snapshot);
    nextSnapshot.capturedAt = new Date(base.getTime() + 62_000).toISOString();
    const snapshotLesson = nextSnapshot.modules
      .flatMap((learningModule) => learningModule.lessons)
      .find((lesson) => lesson.id === fixture.lessonId);
    assert.ok(snapshotLesson);
    snapshotLesson.title = nextLessonTitle;
    snapshotLesson.updatedAt = nextSnapshot.capturedAt;
    const [nextVersion] = await db
      .insert(courseVersions)
      .values({
        organizationId: fixture.organizationId,
        courseId: fixture.courseId,
        version: 2,
        snapshot: nextSnapshot,
        publishedAt: new Date(base.getTime() + 62_000),
        createdById: fixture.userId,
      })
      .returning({ id: courseVersions.id });
    await db
      .update(courses)
      .set({ publishedVersionId: nextVersion.id })
      .where(
        and(
          eq(courses.id, fixture.courseId),
          eq(courses.organizationId, fixture.organizationId),
        ),
      );
    await assert.rejects(
      heartbeat(secondSessionId, 4, new Date(base.getTime() + 76_000)),
      heartbeatFailure("course_version_changed"),
    );
    await heartbeat(thirdSessionId, 0, new Date(base.getTime() + 76_000));
    const [versionBoundSession] = await db
      .select({
        courseVersionId: lessonLearningTimeSessions.courseVersionId,
        lessonTitle: lessonLearningTimeSessions.lessonTitle,
      })
      .from(lessonLearningTimeSessions)
      .where(eq(lessonLearningTimeSessions.id, thirdSessionId));
    assert.deepEqual(versionBoundSession, {
      courseVersionId: nextVersion.id,
      lessonTitle: nextLessonTitle,
    });

    await db
      .update(enrollments)
      .set({ accessActive: false })
      .where(
        and(
          eq(enrollments.userId, fixture.userId),
          eq(enrollments.courseId, fixture.courseId),
        ),
      );
    await assert.rejects(
      heartbeat(thirdSessionId, 1, new Date(base.getTime() + 91_000)),
      heartbeatFailure("learning_access_denied"),
    );
  } finally {
    await db.delete(organizations).where(eq(organizations.id, fixture.organizationId));
  }
});
