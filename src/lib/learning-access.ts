import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  courseModuleAccessOverrides,
  courseModuleAccessRequests,
  courses,
  enrollments,
  lessonProgress,
  users,
  type CourseVersionSnapshot,
} from "@/db/schema";
import {
  combineLearningAccess,
  inferCourseModuleAccessMode,
  learningAccessForState,
  nextPreviousListedModuleCompleted,
  resolveCourseLearningAccessAnchor,
  resolveCourseModuleAccess,
  type CourseModuleAccessOverride,
  type LearningAccessReason,
  type LearningItemAccess,
} from "@/lib/course-module-access-policy";
import {
  getPublishedCourseContent,
  type PublishedCourseContent,
  type PublishedSnapshotLesson,
  type PublishedSnapshotModule,
} from "@/lib/published-course";
import { resolveMemberCourseAccessWithReader } from "@/lib/member-course-access";
import {
  activeExamBlocksContent,
  getActiveExamContentLock,
  type ActiveExamContentLock,
} from "@/lib/exam-content-access";

export type {
  LearningAccessLock,
  LearningAccessReason,
  LearningAccessState,
  LearningItemAccess,
} from "@/lib/course-module-access-policy";

type PublishedSnapshotSection =
  CourseVersionSnapshot["modules"][number]["sections"][number];

export type ResolvedLearningLesson = {
  lesson: PublishedSnapshotLesson;
  access: LearningItemAccess;
  required: boolean;
  sectionId: string | null;
};

export type ResolvedLearningSection = {
  section: PublishedSnapshotSection;
  access: LearningItemAccess;
  completed: boolean;
  lessons: ResolvedLearningLesson[];
};

export type ResolvedLearningModule = {
  module: PublishedSnapshotModule;
  access: LearningItemAccess;
  sections: ResolvedLearningSection[];
  lessons: ResolvedLearningLesson[];
};

export type CourseLearningAccess = {
  published: PublishedCourseContent;
  enrollment: {
    id: string;
    enrolledAt: Date;
  };
  accessStartedAt: string;
  modules: ResolvedLearningModule[];
  lessons: Map<string, ResolvedLearningLesson>;
  publishedLessonIds: string[];
  requiredLessonIds: string[];
};

export type LearningAccessReader = Pick<typeof db, "select">;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

function applyActiveExamContentLock(
  access: CourseLearningAccess,
  lock: ActiveExamContentLock | null,
) {
  if (!lock) return access;
  const blockedAccess = learningAccessForState("locked", {
    reasons: ["active_exam"],
  });
  const lessons = new Map(
    [...access.lessons.entries()].map(([lessonId, resolvedLesson]) => [
      lessonId,
      activeExamBlocksContent(lock, {
        courseId: access.published.courseId,
        lessonId,
      })
        ? {
            ...resolvedLesson,
            access: combineLearningAccess(resolvedLesson.access, blockedAccess),
          }
        : resolvedLesson,
    ]),
  );
  const modules = access.modules.map((resolvedModule) => ({
    ...resolvedModule,
    lessons: resolvedModule.lessons.map(
      (lesson) => lessons.get(lesson.lesson.id) ?? lesson,
    ),
    sections: resolvedModule.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map(
        (lesson) => lessons.get(lesson.lesson.id) ?? lesson,
      ),
    })),
  }));
  return { ...access, modules, lessons };
}

function sortedByOrder<T extends { sortOrder: number; id: string }>(rows: T[]) {
  return [...rows].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + Math.max(0, days) * DAY_IN_MILLISECONDS);
}

function contentIsPublished(input: {
  status: string;
  visibility?: string;
}) {
  return input.status === "published" && input.visibility !== "draft";
}

function visibilityAccess(visibility: string | undefined) {
  return visibility === "coming_soon"
    ? learningAccessForState("coming_soon", { reasons: ["coming_soon"] })
    : learningAccessForState("available");
}

function timeAccess(
  now: Date,
  reason: LearningAccessReason,
  availableAt: Date,
) {
  return availableAt.getTime() > now.getTime()
    ? learningAccessForState("locked", { reasons: [reason], availableAt })
    : learningAccessForState("available");
}

function publishedSections(learningModule: PublishedSnapshotModule) {
  return sortedByOrder(
    learningModule.sections.filter((section) => contentIsPublished(section)),
  );
}

function publishedSectionLessons(section: PublishedSnapshotSection) {
  return sortedByOrder(
    section.lessons.filter((lesson) => contentIsPublished(lesson)),
  );
}

function publishedUnsectionedLessons(learningModule: PublishedSnapshotModule) {
  return sortedByOrder(
    learningModule.lessons.filter((lesson) => contentIsPublished(lesson)),
  );
}

export function publishedLessonsForModule(
  learningModule: PublishedSnapshotModule,
) {
  return sortedByOrder([
    ...publishedUnsectionedLessons(learningModule),
    ...publishedSections(learningModule).flatMap(publishedSectionLessons),
  ]);
}

export function allPublishedLearningLessonIds(snapshot: CourseVersionSnapshot) {
  return [
    ...new Set(
      snapshot.modules.flatMap((learningModule) =>
        publishedLessonsForModule(learningModule).map((lesson) => lesson.id),
      ),
    ),
  ];
}

function moduleIsBaseListed(learningModule: PublishedSnapshotModule) {
  return inferCourseModuleAccessMode(learningModule) !== "hidden";
}

export function publishedLearningLessonIds(snapshot: CourseVersionSnapshot) {
  return [
    ...new Set(
      snapshot.modules
        .filter(moduleIsBaseListed)
        .flatMap((learningModule) =>
          publishedLessonsForModule(learningModule).map((lesson) => lesson.id),
        ),
    ),
  ];
}

export function requiredPublishedLearningLessonIds(
  snapshot: CourseVersionSnapshot,
) {
  return [
    ...new Set(
      snapshot.modules
        .filter(
          (learningModule) =>
            learningModule.isRequired && moduleIsBaseListed(learningModule),
        )
        .flatMap((learningModule) =>
          publishedLessonsForModule(learningModule).map((lesson) => lesson.id),
        ),
    ),
  ];
}

export function calculateRequiredCourseProgress(
  requiredLessonIds: string[],
  completedLessonIds: ReadonlySet<string>,
) {
  if (!requiredLessonIds.length) return 0;
  const completed = requiredLessonIds.filter((lessonId) =>
    completedLessonIds.has(lessonId),
  ).length;
  return Math.round((completed / requiredLessonIds.length) * 100);
}

function resolveLessonOwnAccess(
  lesson: PublishedSnapshotLesson,
  now: Date,
) {
  let access = visibilityAccess(lesson.visibility);
  if (lesson.availableAt) {
    const availableAt = new Date(lesson.availableAt);
    access = combineLearningAccess(
      access,
      Number.isNaN(availableAt.getTime())
        ? learningAccessForState("hidden", {
            reasons: ["invalid_configuration"],
          })
        : timeAccess(now, "lesson_schedule", availableAt),
    );
  }
  return access;
}

export function resolvePublishedCourseLearningAccess(input: {
  published: PublishedCourseContent;
  enrollment: { id: string; enrolledAt: Date };
  completedLessonIds: ReadonlySet<string>;
  courseAccessStartedAt?: Date | null;
  moduleOverrides?: ReadonlyMap<string, CourseModuleAccessOverride>;
  moduleRequestStatuses?: ReadonlyMap<
    string,
    "pending" | "approved" | "rejected"
  >;
  now?: Date;
}): CourseLearningAccess {
  const now = input.now ?? new Date();
  const accessStartedAt = resolveCourseLearningAccessAnchor({
    firstPublishedAt: input.published.firstPublishedAt,
    enrolledAt: input.enrollment.enrolledAt,
    courseAccessStartedAt: input.courseAccessStartedAt,
  });
  const lessonMap = new Map<string, ResolvedLearningLesson>();
  let previousListedModuleCompleted = true;

  const modules = sortedByOrder(input.published.snapshot.modules).map(
    (learningModule): ResolvedLearningModule => {
      const moduleAccess = resolveCourseModuleAccess({
        configuration: learningModule,
        accessAnchor: accessStartedAt,
        previousModuleCompleted: previousListedModuleCompleted,
        override: input.moduleOverrides?.get(learningModule.id),
        requestStatus: input.moduleRequestStatuses?.get(learningModule.id),
        now,
      });

      const resolvedSections: ResolvedLearningSection[] = [];
      for (const section of publishedSections(learningModule)) {
        const sectionLessons = publishedSectionLessons(section);
        let ownSectionAccess = visibilityAccess(section.visibility);
        if (section.dripDays > 0) {
          ownSectionAccess = combineLearningAccess(
            ownSectionAccess,
            timeAccess(
              now,
              "section_drip",
              addDays(accessStartedAt, section.dripDays),
            ),
          );
        }
        const sectionAccess = combineLearningAccess(
          ownSectionAccess,
          moduleAccess,
        );
        let previousLessonCompleted = true;
        const resolvedLessons = sectionLessons.map((lesson) => {
          let ownLessonAccess = resolveLessonOwnAccess(lesson, now);
          if (section.unlockAfterPrevious && !previousLessonCompleted) {
            ownLessonAccess = combineLearningAccess(
              ownLessonAccess,
              learningAccessForState("locked", {
                reasons: ["previous_lesson"],
              }),
            );
          }
          const resolvedLesson: ResolvedLearningLesson = {
            lesson,
            access: combineLearningAccess(ownLessonAccess, sectionAccess),
            required: learningModule.isRequired,
            sectionId: section.id,
          };
          lessonMap.set(lesson.id, resolvedLesson);
          previousLessonCompleted = input.completedLessonIds.has(lesson.id);
          return resolvedLesson;
        });
        resolvedSections.push({
          section,
          access: sectionAccess,
          completed: sectionLessons.every((lesson) =>
            input.completedLessonIds.has(lesson.id),
          ),
          lessons: resolvedLessons,
        });
      }

      const unsectionedLessons = publishedUnsectionedLessons(
        learningModule,
      ).map((lesson) => {
        const resolvedLesson: ResolvedLearningLesson = {
          lesson,
          access: combineLearningAccess(
            resolveLessonOwnAccess(lesson, now),
            moduleAccess,
          ),
          required: learningModule.isRequired,
          sectionId: null,
        };
        lessonMap.set(lesson.id, resolvedLesson);
        return resolvedLesson;
      });
      const resolvedLessons = [
        ...unsectionedLessons,
        ...resolvedSections.flatMap((section) => section.lessons),
      ].sort(
        (left, right) =>
          left.lesson.sortOrder - right.lesson.sortOrder ||
          left.lesson.id.localeCompare(right.lesson.id),
      );

      previousListedModuleCompleted = nextPreviousListedModuleCompleted({
        previousCompleted: previousListedModuleCompleted,
        moduleKind: learningModule.kind ?? "learning",
        moduleListed: moduleAccess.listed,
        moduleLessonsCompleted: resolvedLessons.every(({ lesson }) =>
          input.completedLessonIds.has(lesson.id),
        ),
      });
      return {
        module: learningModule,
        access: moduleAccess,
        sections: resolvedSections,
        lessons: resolvedLessons,
      };
    },
  );

  const publishedLessonIds = modules
    .flatMap(({ lessons: moduleLessons }) => moduleLessons)
    .filter(({ access }) => access.listed)
    .map(({ lesson }) => lesson.id);
  const requiredLessonIds = modules
    .filter(({ module, access }) => module.isRequired && access.listed)
    .flatMap(({ lessons: moduleLessons }) =>
      moduleLessons
        .filter(({ access }) => access.listed)
        .map(({ lesson }) => lesson.id),
    );

  return {
    published: input.published,
    enrollment: input.enrollment,
    accessStartedAt: accessStartedAt.toISOString(),
    modules,
    lessons: lessonMap,
    publishedLessonIds: [...new Set(publishedLessonIds)],
    requiredLessonIds: [...new Set(requiredLessonIds)],
  };
}

export async function getCourseLearningAccess(
  reader: LearningAccessReader,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    now?: Date;
  },
) {
  const [enrollment] = await reader
    .select({
      id: enrollments.id,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(
      users,
      and(
        eq(users.id, enrollments.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
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
  if (!enrollment) return null;

  const courseAccess = await resolveMemberCourseAccessWithReader(reader, {
    organizationId: input.organizationId,
    userId: input.userId,
    courseIds: [input.courseId],
    now: input.now,
  });
  const memberCourseAccess = courseAccess.get(input.courseId);
  if (!memberCourseAccess?.accessible) return null;

  const published = await getPublishedCourseContent(reader, {
    organizationId: input.organizationId,
    courseId: input.courseId,
  });
  if (!published) return null;

  const lessonIds = allPublishedLearningLessonIds(published.snapshot);
  const [completedRows, overrideRows, pendingRequestRows] = await Promise.all([
    lessonIds.length
      ? reader
          .select({ lessonId: lessonProgress.lessonId })
          .from(lessonProgress)
          .where(
            and(
              eq(lessonProgress.userId, input.userId),
              eq(lessonProgress.status, "completed"),
              inArray(lessonProgress.lessonId, lessonIds),
            ),
          )
      : Promise.resolve([]),
    reader
      .select({
        moduleId: courseModuleAccessOverrides.moduleId,
        state: courseModuleAccessOverrides.state,
        expiresAt: courseModuleAccessOverrides.expiresAt,
      })
      .from(courseModuleAccessOverrides)
      .where(
        and(
          eq(
            courseModuleAccessOverrides.organizationId,
            input.organizationId,
          ),
          eq(courseModuleAccessOverrides.userId, input.userId),
          eq(courseModuleAccessOverrides.courseId, input.courseId),
        ),
      ),
    reader
      .select({ moduleId: courseModuleAccessRequests.moduleId })
      .from(courseModuleAccessRequests)
      .where(
        and(
          eq(
            courseModuleAccessRequests.organizationId,
            input.organizationId,
          ),
          eq(courseModuleAccessRequests.userId, input.userId),
          eq(courseModuleAccessRequests.courseId, input.courseId),
          eq(courseModuleAccessRequests.status, "pending"),
        ),
      ),
  ]);

  const resolved = resolvePublishedCourseLearningAccess({
    published,
    enrollment,
    courseAccessStartedAt: memberCourseAccess.accessStartedAt,
    completedLessonIds: new Set(completedRows.map((row) => row.lessonId)),
    moduleOverrides: new Map(
      overrideRows.map((row) => [
        row.moduleId,
        { state: row.state, expiresAt: row.expiresAt },
      ]),
    ),
    moduleRequestStatuses: new Map(
      pendingRequestRows.map((row) => [row.moduleId, "pending" as const]),
    ),
    now: input.now,
  });
  const examLock = await getActiveExamContentLock(reader, {
    organizationId: input.organizationId,
    userId: input.userId,
    now: input.now,
  });
  return applyActiveExamContentLock(resolved, examLock);
}
