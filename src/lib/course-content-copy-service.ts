import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  contentBlocks,
  courseMediaAssets,
  courseModules,
  courses,
  dataForms,
  lessonPages,
  lessons,
  mediaAssets,
  type Lesson,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { assertPublishedAiAgentReferences } from "@/lib/api/content-block-ai-agent";
import {
  collectCourseContentMediaReferences,
  courseContentDataForCopy,
  copiedLessonSlug,
  CourseContentCopyReferenceError,
  remapCopiedExamQuestionPools,
} from "@/lib/course-content-copy-model";
import type { CoursePermissionTransaction } from "@/lib/course-permissions";
import { assertLearningModuleStructureMutation } from "@/lib/module-structure-service";
import { enqueueCopiedVideoDescriptionJobsInTransaction } from "@/lib/ai/video-description-jobs";
import type { AppLocale } from "@/lib/i18n/model";

type CopyReason =
  "source_unavailable" | "target_unavailable" | "reference_invalid";

type CopyContext = {
  organizationId: string;
  sourceCourseId: string;
  targetCourseId: string;
  targetCourseIds: readonly string[];
  targetModuleId: string;
  attachedById: string;
  locale: AppLocale;
};

export type CopiedLessonResult = {
  lessonId: string;
  pageId?: string;
  blockCount: number;
  pageCount: number;
};

function copyError(status: 404 | 409 | 422, reason: CopyReason) {
  return new ApiError(
    status,
    status === 404
      ? "not_found"
      : status === 422
        ? "validation_error"
        : "conflict",
    "Course content copy validation failed.",
    { reason },
  );
}

function errorReason(error: unknown): CopyReason | null {
  if (
    error instanceof ApiError &&
    error.details &&
    typeof error.details === "object" &&
    "reason" in error.details
  ) {
    const reason = (error.details as { reason?: unknown }).reason;
    return reason === "source_unavailable" ||
      reason === "target_unavailable" ||
      reason === "reference_invalid"
      ? reason
      : null;
  }
  return null;
}

export function courseContentCopyErrorReason(error: unknown) {
  return errorReason(error);
}

async function lockAndValidateTarget(
  transaction: CoursePermissionTransaction,
  context: CopyContext,
) {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`course-content-copy:${context.targetModuleId}`}, 0)
    )
  `);
  await assertLearningModuleStructureMutation(transaction, {
    organizationId: context.organizationId,
    moduleId: context.targetModuleId,
  });
  const [target] = await transaction
    .select({ moduleId: courseModules.moduleId, courseStatus: courses.status })
    .from(courseModules)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, courseModules.organizationId),
      ),
    )
    .where(
      and(
        eq(courseModules.organizationId, context.organizationId),
        eq(courseModules.courseId, context.targetCourseId),
        eq(courseModules.moduleId, context.targetModuleId),
      ),
    )
    .limit(1);
  if (!target || target.courseStatus === "archived") {
    throw copyError(404, "target_unavailable");
  }
}

async function sourceLesson(
  transaction: CoursePermissionTransaction,
  context: CopyContext,
  sourceLessonId: string,
) {
  const [source] = await transaction
    .select()
    .from(lessons)
    .where(
      and(
        eq(lessons.id, sourceLessonId),
        eq(lessons.organizationId, context.organizationId),
      ),
    )
    .limit(1)
    .for("share");
  if (!source) throw copyError(404, "source_unavailable");
  const [assignment] = await transaction
    .select({ moduleId: courseModules.moduleId })
    .from(courseModules)
    .where(
      and(
        eq(courseModules.organizationId, context.organizationId),
        eq(courseModules.courseId, context.sourceCourseId),
        eq(courseModules.moduleId, source.moduleId),
      ),
    )
    .limit(1);
  if (!assignment) throw copyError(404, "source_unavailable");
  return source;
}

async function validateLogicalReferences(
  transaction: CoursePermissionTransaction,
  organizationId: string,
  blocks: Array<typeof contentBlocks.$inferSelect>,
) {
  const agentIds = new Set<string>();
  const formIds = new Set<string>();
  for (const block of blocks) {
    if (block.type === "ai_agent") {
      if (typeof block.data.agentId !== "string") {
        throw copyError(409, "reference_invalid");
      }
      agentIds.add(block.data.agentId);
    }
    if (block.type === "data_form") {
      if (typeof block.data.formId !== "string") {
        throw copyError(409, "reference_invalid");
      }
      formIds.add(block.data.formId);
    }
  }

  try {
    await assertPublishedAiAgentReferences({
      transaction,
      organizationId,
      agentIds: [...agentIds],
    });
  } catch {
    throw copyError(409, "reference_invalid");
  }
  if (formIds.size) {
    const forms = await transaction
      .select({ id: dataForms.id })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.organizationId, organizationId),
          inArray(dataForms.id, [...formIds]),
        ),
      )
      .for("share");
    if (forms.length !== formIds.size) {
      throw copyError(409, "reference_invalid");
    }
  }
}

async function bindCopiedMedia(
  transaction: CoursePermissionTransaction,
  context: CopyContext,
  blocks: Array<typeof contentBlocks.$inferSelect>,
) {
  let references: ReturnType<typeof collectCourseContentMediaReferences>;
  try {
    references = collectCourseContentMediaReferences(blocks);
  } catch (error) {
    if (error instanceof CourseContentCopyReferenceError) {
      throw copyError(409, "reference_invalid");
    }
    throw error;
  }
  const ids = [...references.keys()];
  if (!ids.length) return;
  const targetCourseIds = [
    ...new Set(
      context.targetCourseIds.map((courseId) => courseId.toLowerCase()),
    ),
  ].sort();
  if (
    !targetCourseIds.length ||
    !targetCourseIds.includes(context.targetCourseId.toLowerCase())
  ) {
    throw copyError(404, "target_unavailable");
  }

  const boundAssets = await transaction
    .select({ id: mediaAssets.id, kind: mediaAssets.kind })
    .from(mediaAssets)
    .innerJoin(
      courseMediaAssets,
      and(
        eq(courseMediaAssets.organizationId, mediaAssets.organizationId),
        eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
        eq(courseMediaAssets.courseId, context.sourceCourseId),
      ),
    )
    .where(
      and(
        eq(mediaAssets.organizationId, context.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
        isNull(mediaAssets.deletedAt),
        inArray(mediaAssets.id, ids),
      ),
    )
    .orderBy(mediaAssets.id)
    .for("share", { of: mediaAssets });
  const assetsById = new Map(boundAssets.map((asset) => [asset.id, asset]));
  if (
    ids.some((id) => {
      const asset = assetsById.get(id);
      return !asset || asset.kind !== references.get(id);
    })
  ) {
    throw copyError(409, "reference_invalid");
  }

  await transaction
    .insert(courseMediaAssets)
    .values(
      targetCourseIds.flatMap((courseId) =>
        ids.map((mediaAssetId) => ({
          organizationId: context.organizationId,
          courseId,
          mediaAssetId,
          attachedById: context.attachedById,
        })),
      ),
    )
    .onConflictDoNothing();
}

async function cloneLessonGraph(
  transaction: CoursePermissionTransaction,
  context: CopyContext,
  source: Lesson,
  targetSortOrder: number,
): Promise<CopiedLessonResult> {
  const sourcePages = await transaction
    .select()
    .from(lessonPages)
    .where(eq(lessonPages.lessonId, source.id))
    .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id))
    .for("share");
  const sourceBlocks = await transaction
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.lessonId, source.id))
    .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id))
    .for("share");
  await validateLogicalReferences(
    transaction,
    context.organizationId,
    sourceBlocks,
  );
  await bindCopiedMedia(transaction, context, sourceBlocks);

  const copiedLessonId = randomUUID();
  const pageIds = new Map(sourcePages.map((page) => [page.id, randomUUID()]));
  const blockIds = new Map(
    sourceBlocks.map((block) => [block.id, randomUUID()]),
  );
  if (
    sourceBlocks.some(
      (block) => block.pageId !== null && !pageIds.has(block.pageId),
    )
  ) {
    throw copyError(409, "reference_invalid");
  }
  let examQuestionPools;
  try {
    examQuestionPools = remapCopiedExamQuestionPools(
      source.examQuestionPools,
      blockIds,
    );
  } catch (error) {
    if (error instanceof CourseContentCopyReferenceError) {
      throw copyError(409, "reference_invalid");
    }
    throw error;
  }

  await transaction.insert(lessons).values({
    id: copiedLessonId,
    organizationId: context.organizationId,
    moduleId: context.targetModuleId,
    title: source.title,
    slug: copiedLessonSlug(source.slug, copiedLessonId),
    summary: source.summary,
    type: source.type,
    durationMinutes: source.durationMinutes,
    passingScore: source.passingScore,
    maxAttempts: source.maxAttempts,
    shuffleQuestions: source.shuffleQuestions,
    examDurationSeconds: source.examDurationSeconds,
    examQuestionPools,
    examResultReleaseMode: source.examResultReleaseMode,
    examReviewReleaseMode: source.examReviewReleaseMode,
    examContentAccessMode: source.examContentAccessMode,
    sortOrder: targetSortOrder,
    status: source.status,
    visibility: source.visibility,
    availableAt: source.availableAt,
    dripDays: source.dripDays,
    unlockAfterPrevious: source.unlockAfterPrevious,
  });
  if (sourcePages.length) {
    await transaction.insert(lessonPages).values(
      sourcePages.map((page) => ({
        id: pageIds.get(page.id)!,
        lessonId: copiedLessonId,
        title: page.title,
        titleSyncedWithLesson: page.titleSyncedWithLesson,
        slug: page.slug,
        sortOrder: page.sortOrder,
        status: page.status,
        layoutWidth: page.layoutWidth,
        backgroundTone: page.backgroundTone,
        contentSpacing: page.contentSpacing,
      })),
    );
  }
  if (sourceBlocks.length) {
    const copiedBlocks = sourceBlocks.map((block) => ({
      id: blockIds.get(block.id)!,
      lessonId: copiedLessonId,
      pageId: block.pageId ? pageIds.get(block.pageId) : null,
      type: block.type,
      title: block.title,
      sortOrder: block.sortOrder,
      required: block.required,
      data: courseContentDataForCopy(block.type, block.data),
      style: block.style,
    }));
    await transaction.insert(contentBlocks).values(copiedBlocks);
    await enqueueCopiedVideoDescriptionJobsInTransaction(transaction, {
      organizationId: context.organizationId,
      originCourseId: context.targetCourseId,
      requestedById: context.attachedById,
      blocks: copiedBlocks,
      locale: context.locale,
    });
  }
  return {
    lessonId: copiedLessonId,
    ...(sourcePages[0] ? { pageId: pageIds.get(sourcePages[0].id) } : {}),
    pageCount: sourcePages.length,
    blockCount: sourceBlocks.length,
  };
}

export async function copyLessonToCourseTarget(
  transaction: CoursePermissionTransaction,
  input: CopyContext & { sourceLessonId: string },
) {
  await lockAndValidateTarget(transaction, input);
  const source = await sourceLesson(transaction, input, input.sourceLessonId);
  const [last] = await transaction
    .select({ sortOrder: lessons.sortOrder })
    .from(lessons)
    .where(eq(lessons.moduleId, input.targetModuleId))
    .orderBy(desc(lessons.sortOrder), desc(lessons.id))
    .limit(1);
  return cloneLessonGraph(
    transaction,
    input,
    source,
    (last?.sortOrder ?? -1) + 1,
  );
}
