import "server-only";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  contentBlocks,
  courseAuthors,
  courseLearningGoals,
  courseModules,
  courses,
  courseVersions,
  courseWidgets,
  lessonPages,
  lessons,
  moduleSections,
  modules,
  mediaProcessingJobs,
  users,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { contentBlockForSnapshot } from "@/lib/course-snapshot-block";
import {
  isStructuredContentBlockType,
  structuredContentDocumentForBlock,
} from "@/lib/content-blocks/layout-documents";
import { lockActiveCourseDataForms } from "@/lib/course-data-form-lock";
import { assertCourseAuthorsActiveForPublication } from "@/lib/course-information-service";
import {
  lockCourseLinkGraph,
  publishedTargetVersionsForLinks,
  replacePublishedCourseLinkEdges,
} from "@/lib/course-link-service";
import { diffCourseSnapshots } from "@/lib/course-change-log";
import { queueCourseModuleReleaseEmails } from "@/lib/course-module-release-email";
import { safeCourseCoverSource } from "@/lib/course-cover";
import { examModulePublicationErrors } from "@/lib/exam-module-policy";
import {
  boundVideoCompositionMatchesDocument,
  sanitizeVideoComposition,
} from "@/lib/media/video-composition";
import { fulfillLessonAvailabilitySubscriptions } from "@/lib/lesson-availability-service";
import { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";
import {
  bindPublishedCourseMediaAssets,
  courseSnapshotMediaAssets,
} from "@/lib/media/course-assets";
import {
  safeAvatarSource,
  sanitizeCourseSnapshotAvatarSources,
} from "@/lib/avatar-policy";

export type CourseVersionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type CourseSnapshotBuildMode = "publication" | "comparison";

export async function lockCourseForVersion(
  transaction: CourseVersionTransaction,
  courseId: string,
  organizationId: string,
) {
  await lockCourseLinkGraph(transaction, organizationId);
  const [course] = await transaction
    .select()
    .from(courses)
    .where(
      and(eq(courses.id, courseId), eq(courses.organizationId, organizationId)),
    )
    .limit(1)
    .for("update");
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  return course;
}

async function nextVersionNumber(
  transaction: CourseVersionTransaction,
  courseId: string,
  organizationId: string,
) {
  const [latest] = await transaction
    .select({ version: courseVersions.version })
    .from(courseVersions)
    .where(
      and(
        eq(courseVersions.courseId, courseId),
        eq(courseVersions.organizationId, organizationId),
      ),
    )
    .orderBy(desc(courseVersions.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

export async function buildCourseVersionSnapshot(
  transaction: CourseVersionTransaction,
  course: typeof courses.$inferSelect,
  capturedAt: Date,
  mode: CourseSnapshotBuildMode = "publication",
): Promise<CourseVersionSnapshot> {
  const publicationMode = mode === "publication";
  await lockCourseLinkGraph(transaction, course.organizationId);
  if (publicationMode) {
    await transaction.execute(sql`
      lock table
      "course_modules",
      "modules",
      "module_sections",
      "lessons",
      "lesson_pages",
      "content_blocks",
      "course_learning_goals",
      "course_authors",
      "course_widgets",
      "users"
      in share mode
    `);
  }
  if (publicationMode) {
    await assertCourseAuthorsActiveForPublication(
      transaction,
      course.id,
      course.organizationId,
    );
  }
  const learningGoalRows = await transaction
    .select()
    .from(courseLearningGoals)
    .where(
      and(
        eq(courseLearningGoals.courseId, course.id),
        eq(courseLearningGoals.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseLearningGoals.sortOrder), asc(courseLearningGoals.id));
  const authorRows = await transaction
    .select({
      relation: courseAuthors,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseAuthors)
    .innerJoin(
      users,
      and(
        eq(users.id, courseAuthors.userId),
        eq(users.organizationId, courseAuthors.organizationId),
      ),
    )
    .where(
      and(
        eq(courseAuthors.courseId, course.id),
        eq(courseAuthors.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseAuthors.sortOrder), asc(courseAuthors.id));
  const widgetRows = await transaction
    .select({
      widget: courseWidgets,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseWidgets)
    .leftJoin(
      users,
      and(
        eq(users.id, courseWidgets.authorUserId),
        eq(users.organizationId, courseWidgets.organizationId),
      ),
    )
    .where(
      and(
        eq(courseWidgets.courseId, course.id),
        eq(courseWidgets.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseWidgets.sortOrder), asc(courseWidgets.id));
  const moduleRows = await transaction
    .select({
      id: modules.id,
      organizationId: modules.organizationId,
      title: modules.title,
      kind: modules.kind,
      linkedCourseId: modules.linkedCourseId,
      description: modules.description,
      folder: modules.folder,
      isReusable: modules.isReusable,
      estimatedMinutes: modules.estimatedMinutes,
      createdAt: modules.createdAt,
      updatedAt: modules.updatedAt,
      sortOrder: courseModules.sortOrder,
      indentLevel: courseModules.indentLevel,
      accessMode: courseModules.accessMode,
      dripDays: courseModules.dripDays,
      delayPendingState: courseModules.delayPendingState,
      availableFrom: courseModules.availableFrom,
      availableUntil: courseModules.availableUntil,
      windowDefaultState: courseModules.windowDefaultState,
      windowState: courseModules.windowState,
      requestAccessEnabled: courseModules.requestAccessEnabled,
      isRequired: courseModules.isRequired,
    })
    .from(courseModules)
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModules.moduleId),
        eq(modules.organizationId, course.organizationId),
      ),
    )
    .where(
      and(
        eq(courseModules.courseId, course.id),
        eq(courseModules.organizationId, course.organizationId),
      ),
    )
    .orderBy(asc(courseModules.sortOrder), asc(modules.id));

  const moduleIds = moduleRows
    .filter((learningModule) => learningModule.kind !== "link")
    .map((learningModule) => learningModule.id);
  const targetVersionByCourseId = await publishedTargetVersionsForLinks(
    transaction,
    {
      organizationId: course.organizationId,
      sourceCourseId: course.id,
      targetCourseIds: moduleRows.flatMap((learningModule) =>
        learningModule.kind === "link" && learningModule.linkedCourseId
          ? [learningModule.linkedCourseId]
          : [],
      ),
      requirePublished: publicationMode,
    },
  );
  const sectionRows = moduleIds.length
    ? await transaction
        .select()
        .from(moduleSections)
        .where(
          and(
            eq(moduleSections.organizationId, course.organizationId),
            inArray(moduleSections.moduleId, moduleIds),
          ),
        )
        .orderBy(
          asc(moduleSections.moduleId),
          asc(moduleSections.sortOrder),
          asc(moduleSections.id),
        )
    : [];
  const lessonRows = moduleIds.length
    ? await transaction
        .select()
        .from(lessons)
        .where(
          and(
            eq(lessons.organizationId, course.organizationId),
            inArray(lessons.moduleId, moduleIds),
          ),
        )
        .orderBy(asc(lessons.moduleId), asc(lessons.sortOrder), asc(lessons.id))
    : [];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const pageRows = lessonIds.length
    ? await transaction
        .select()
        .from(lessonPages)
        .where(inArray(lessonPages.lessonId, lessonIds))
        .orderBy(
          asc(lessonPages.lessonId),
          asc(lessonPages.sortOrder),
          asc(lessonPages.id),
        )
    : [];
  const blockRows = lessonIds.length
    ? await transaction
        .select()
        .from(contentBlocks)
        .where(inArray(contentBlocks.lessonId, lessonIds))
        .orderBy(
          asc(contentBlocks.lessonId),
          asc(contentBlocks.sortOrder),
          asc(contentBlocks.id),
        )
    : [];
  if (
    publicationMode &&
    !(await lockActiveCourseDataForms(
      transaction,
      course.organizationId,
      blockRows,
    ))
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Kurs enthaelt ein inaktives oder nicht verfuegbares Datenformular.",
    );
  }
  if (publicationMode) {
    const composedBlocks = blockRows.flatMap((block) => {
      if (block.type !== "video" || !block.data.videoComposition) return [];
      const composition = sanitizeVideoComposition(block.data.videoComposition);
      return composition ? [{ block, composition }] : [];
    });
    if (composedBlocks.length) {
      if (
        composedBlocks.length !==
          blockRows.filter(
            (block) => block.type === "video" && block.data.videoComposition,
          ).length ||
        composedBlocks.some(({ composition }) => !composition.renderJobId)
      ) {
        throw new ApiError(
          422,
          "validation_error",
          "Alle Video-Mehrspur-Kompositionen muessen zuerst gerendert werden.",
        );
      }
      const renderJobIds = composedBlocks.map(
        ({ composition }) => composition.renderJobId!,
      );
      const renderJobs = await transaction
        .select({
          id: mediaProcessingJobs.id,
          sourceAssetId: mediaProcessingJobs.sourceAssetId,
          status: mediaProcessingJobs.status,
          type: mediaProcessingJobs.type,
          options: mediaProcessingJobs.options,
        })
        .from(mediaProcessingJobs)
        .where(
          and(
            eq(mediaProcessingJobs.organizationId, course.organizationId),
            inArray(mediaProcessingJobs.id, renderJobIds),
          ),
        )
        .for("share");
      const jobsById = new Map(renderJobs.map((job) => [job.id, job]));
      for (const { block, composition } of composedBlocks) {
        const renderJob = jobsById.get(composition.renderJobId!);
        if (
          !renderJob ||
          renderJob.status !== "succeeded" ||
          renderJob.type !== "transcode" ||
          renderJob.options.videoCompositionCourseId !== course.id ||
          renderJob.sourceAssetId !== block.data.mediaAssetId ||
          !boundVideoCompositionMatchesDocument(
            renderJob.options.videoComposition,
            composition,
          ) ||
          renderJob.options.videoEdit !== undefined
        ) {
          throw new ApiError(
            422,
            "validation_error",
            "Eine Video-Mehrspur-Komposition ist noch nicht erfolgreich gerendert.",
          );
        }
      }
    }
  }

  const blocksByLesson = new Map<string, typeof blockRows>();
  const blocksByPage = new Map<string, typeof blockRows>();
  for (const block of blockRows) {
    if (
      publicationMode &&
      isStructuredContentBlockType(block.type) &&
      !structuredContentDocumentForBlock(block.type, block.data)
    ) {
      throw new ApiError(
        422,
        "validation_error",
        `Der strukturierte Block ${block.title ?? block.type} ist unvollstaendig.`,
      );
    }
    const snapshotBlock = contentBlockForSnapshot(block, publicationMode);
    if (block.pageId) {
      const pageBlocks = blocksByPage.get(block.pageId) ?? [];
      pageBlocks.push(snapshotBlock);
      blocksByPage.set(block.pageId, pageBlocks);
      continue;
    }
    const blocks = blocksByLesson.get(block.lessonId) ?? [];
    blocks.push(snapshotBlock);
    blocksByLesson.set(block.lessonId, blocks);
  }

  const pagesByLesson = new Map<
    string,
    CourseVersionSnapshot["modules"][number]["lessons"][number]["pages"]
  >();
  for (const page of pageRows) {
    const pages = pagesByLesson.get(page.lessonId) ?? [];
    pages.push({
      ...page,
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
      blocks: blocksByPage.get(page.id) ?? [],
    });
    pagesByLesson.set(page.lessonId, pages);
  }

  const lessonsByModule = new Map<
    string,
    CourseVersionSnapshot["modules"][number]["lessons"]
  >();
  for (const lesson of lessonRows) {
    const moduleLessons = lessonsByModule.get(lesson.moduleId) ?? [];
    moduleLessons.push({
      ...lesson,
      availableAt: lesson.availableAt?.toISOString() ?? null,
      createdAt: lesson.createdAt.toISOString(),
      updatedAt: lesson.updatedAt.toISOString(),
      blocks: blocksByLesson.get(lesson.id) ?? [],
      pages: pagesByLesson.get(lesson.id) ?? [],
    });
    lessonsByModule.set(lesson.moduleId, moduleLessons);
  }

  const sectionsByModule = new Map<
    string,
    CourseVersionSnapshot["modules"][number]["sections"]
  >();
  for (const section of sectionRows) {
    const sections = sectionsByModule.get(section.moduleId) ?? [];
    sections.push({
      ...section,
      createdAt: section.createdAt.toISOString(),
      updatedAt: section.updatedAt.toISOString(),
      lessons: (lessonsByModule.get(section.moduleId) ?? []).filter(
        (lesson) => lesson.sectionId === section.id,
      ),
    });
    sectionsByModule.set(section.moduleId, sections);
  }

  const snapshot: CourseVersionSnapshot = {
    schemaVersion: 5,
    accessPolicyVersion: 1,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt: capturedAt.toISOString(),
    course: {
      ...course,
      coverImage: safeCourseCoverSource(course.coverImage),
      createdAt: course.createdAt.toISOString(),
      updatedAt: course.updatedAt.toISOString(),
      firstPublishedAt: course.firstPublishedAt?.toISOString() ?? null,
    },
    learningGoals: learningGoalRows.map((goal) => ({
      ...goal,
      createdAt: goal.createdAt.toISOString(),
      updatedAt: goal.updatedAt.toISOString(),
    })),
    authors: authorRows.map(({ relation, author }) => ({
      ...relation,
      createdAt: relation.createdAt.toISOString(),
      author: {
        ...author,
        avatarUrl: safeAvatarSource(author.avatarUrl),
      },
    })),
    widgets: widgetRows.map(({ widget, author }) => ({
      ...widget,
      createdAt: widget.createdAt.toISOString(),
      updatedAt: widget.updatedAt.toISOString(),
      author: author
        ? { ...author, avatarUrl: safeAvatarSource(author.avatarUrl) }
        : null,
    })),
    modules: moduleRows.map((learningModule) => ({
      ...learningModule,
      targetVersionIdAtCapture:
        learningModule.kind === "link" && learningModule.linkedCourseId
          ? (targetVersionByCourseId.get(learningModule.linkedCourseId) ?? null)
          : null,
      availableFrom: learningModule.availableFrom?.toISOString() ?? null,
      availableUntil: learningModule.availableUntil?.toISOString() ?? null,
      createdAt: learningModule.createdAt.toISOString(),
      updatedAt: learningModule.updatedAt.toISOString(),
      lessons: (lessonsByModule.get(learningModule.id) ?? []).filter(
        (lesson) => !lesson.sectionId,
      ),
      sections: sectionsByModule.get(learningModule.id) ?? [],
    })),
  };
  if (publicationMode) {
    for (const learningModule of snapshot.modules) {
      const [error] = examModulePublicationErrors(learningModule);
      if (error) {
        throw new ApiError(
          422,
          "validation_error",
          `Pruefungsmodul "${learningModule.title}": ${error}`,
        );
      }
    }
  }
  return sanitizeCourseSnapshotAvatarSources(snapshot);
}

async function insertCourseVersionRecord(
  transaction: CourseVersionTransaction,
  input: {
    organizationId: string;
    course: typeof courses.$inferSelect;
    changelog: string;
    capturedAt: Date;
    publishedAt: Date | null;
    createdById?: string | null;
  },
  snapshot: CourseVersionSnapshot,
) {
  const version = await nextVersionNumber(
    transaction,
    input.course.id,
    input.organizationId,
  );
  const [created] = await transaction
    .insert(courseVersions)
    .values({
      organizationId: input.organizationId,
      courseId: input.course.id,
      version,
      snapshot,
      changelog: input.changelog,
      publishedAt: input.publishedAt,
      createdById: input.createdById ?? null,
    })
    .returning();
  return created;
}

export async function insertCourseVersion(
  transaction: CourseVersionTransaction,
  input: {
    organizationId: string;
    course: typeof courses.$inferSelect;
    changelog: string;
    capturedAt: Date;
    publishedAt: Date | null;
    createdById?: string | null;
  },
) {
  const snapshot = await buildCourseVersionSnapshot(
    transaction,
    input.course,
    input.capturedAt,
  );
  return insertCourseVersionRecord(transaction, input, snapshot);
}

export async function publishCourseVersion(
  transaction: CourseVersionTransaction,
  input: {
    organizationId: string;
    course: typeof courses.$inferSelect;
    changelog: string;
    publishedAt: Date;
    createdById?: string | null;
  },
) {
  await lockCourseLinkGraph(transaction, input.organizationId);
  const publicationCourse = {
    ...input.course,
    status: "published" as const,
    firstPublishedAt: input.course.firstPublishedAt ?? input.publishedAt,
    updatedAt: input.publishedAt,
  };
  const versionInput = {
    organizationId: input.organizationId,
    course: publicationCourse,
    changelog: input.changelog,
    capturedAt: input.publishedAt,
    publishedAt: input.publishedAt,
    createdById: input.createdById,
  };
  const snapshot = await buildCourseVersionSnapshot(
    transaction,
    publicationCourse,
    input.publishedAt,
  );
  let previousPublished: {
    courseId: string;
    versionId: string;
    version: number;
    publishedAt: Date;
    firstPublishedAt: Date;
    snapshot: CourseVersionSnapshot;
  } | null = null;
  if (input.course.publishedVersionId) {
    const [currentVersion] = await transaction
      .select({
        id: courseVersions.id,
        version: courseVersions.version,
        snapshot: courseVersions.snapshot,
        publishedAt: courseVersions.publishedAt,
      })
      .from(courseVersions)
      .where(
        and(
          eq(courseVersions.id, input.course.publishedVersionId),
          eq(courseVersions.courseId, input.course.id),
          eq(courseVersions.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    if (
      !currentVersion?.publishedAt ||
      !isValidPublishedCourseSnapshot(
        currentVersion.snapshot,
        input.course.id,
        input.organizationId,
      )
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die aktuelle Kursversion konnte nicht sicher verglichen werden.",
      );
    }
    previousPublished = {
      courseId: input.course.id,
      versionId: currentVersion.id,
      version: currentVersion.version,
      publishedAt: currentVersion.publishedAt,
      firstPublishedAt:
        input.course.firstPublishedAt ?? currentVersion.publishedAt,
      snapshot: currentVersion.snapshot,
    };
    if (
      input.course.status === "published" &&
      !diffCourseSnapshots(currentVersion.snapshot, snapshot).hasChanges
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Es gibt keine unveroeffentlichten Kursaenderungen.",
      );
    }
  }
  const version = await insertCourseVersionRecord(
    transaction,
    versionInput,
    snapshot,
  );
  await replacePublishedCourseLinkEdges(transaction, {
    organizationId: input.organizationId,
    sourceCourseId: input.course.id,
    sourceVersionId: version.id,
    snapshot: version.snapshot,
  });
  const attachedById = input.createdById ?? input.course.createdById;
  if (courseSnapshotMediaAssets(version.snapshot).size && !attachedById) {
    throw new ApiError(
      409,
      "conflict",
      "Kursmedien koennen ohne verantwortlichen Publisher nicht veroeffentlicht werden.",
    );
  }
  if (attachedById) {
    await bindPublishedCourseMediaAssets(transaction, {
      organizationId: input.organizationId,
      courseId: input.course.id,
      attachedById,
      snapshot: version.snapshot,
    });
  }
  const nextPublished = {
    courseId: input.course.id,
    versionId: version.id,
    version: version.version,
    publishedAt: input.publishedAt,
    firstPublishedAt: publicationCourse.firstPublishedAt,
    snapshot: version.snapshot,
  };
  await fulfillLessonAvailabilitySubscriptions(transaction, {
    organizationId: input.organizationId,
    courseId: input.course.id,
    courseSlug: publicationCourse.slug,
    courseTitle: publicationCourse.title,
    previousPublished,
    nextPublished,
    fulfilledAt: input.publishedAt,
  });
  const moduleReleaseEmails = await queueCourseModuleReleaseEmails(
    transaction,
    {
      organizationId: input.organizationId,
      courseId: input.course.id,
      courseSlug: publicationCourse.slug,
      courseTitle: publicationCourse.title,
      enabled: publicationCourse.notifyMembersOnModuleRelease,
      actorUserId: input.createdById,
      previousPublished,
      nextPublished,
      releasedAt: input.publishedAt,
    },
  );
  const [course] = await transaction
    .update(courses)
    .set({
      status: "published",
      publishedVersionId: version.id,
      firstPublishedAt: publicationCourse.firstPublishedAt,
      updatedAt: input.publishedAt,
    })
    .where(
      and(
        eq(courses.id, input.course.id),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .returning();
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
  return { course, version, moduleReleaseEmails };
}
