import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  contentBlocks,
  courseAuthors,
  courseLearningGoals,
  courseMediaAssets,
  courseModules,
  courses,
  courseWidgets,
  lessonPages,
  lessons,
  mediaAssets,
  moduleSections,
  modules,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { courseCloneSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  courseModuleValuesForClone,
  courseWidgetValuesForClone,
  moduleValuesForClone,
  shouldCloneModuleContent,
} from "@/lib/course-clone-policy";
import { slugify } from "@/lib/utils";
import { lockCourseLinkGraph } from "@/lib/course-link-service";
import { safeCourseCoverSource } from "@/lib/course-cover";
import { assertOrganizationCourseCapacity } from "@/lib/organization-contracts";
import {
  courseContentDataForCopy,
  CourseContentCopyReferenceError,
  remapCopiedExamQuestionPools,
} from "@/lib/course-content-copy-model";
import { enqueueCopiedVideoDescriptionJobsInTransaction } from "@/lib/ai/video-description-jobs";
import { normalizeLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:write", "modules:write"],
      action: "course.clone",
      resourceType: "course",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, courseCloneSchema);
      const [source] = await db
        .select()
        .from(courses)
        .where(
          and(
            eq(courses.id, id),
            eq(courses.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!source) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      const title = input.title ?? `${source.title} (Kopie)`;
      const baseSlug = slugify(title) || "kurs-kopie";
      let slug = baseSlug;
      for (let suffix = 2; suffix < 1000; suffix += 1) {
        const [duplicate] = await db
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, context.organizationId),
              eq(courses.slug, slug),
            ),
          )
          .limit(1);
        if (!duplicate) break;
        slug = `${baseSlug}-${suffix}`;
      }

      const clonedCourse = await db.transaction(async (tx) => {
        await lockCourseLinkGraph(tx, context.organizationId);
        await assertOrganizationCourseCapacity(tx, context.organizationId);
        const actor = await requireActiveApiKeyCreator(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const locale = normalizeLocale(
          await resolveUserLocale(
            { organizationId: context.organizationId, preferredLocale: null },
            tx,
          ),
        );
        const copiedDescriptionBlocks: Array<
          Pick<typeof contentBlocks.$inferSelect, "id" | "type" | "data">
        > = [];
        const [clone] = await tx
          .insert(courses)
          .values({
            organizationId: context.organizationId,
            categoryId: source.categoryId,
            title,
            slug,
            shortDescription: source.shortDescription,
            description: source.description,
            coverImage: safeCourseCoverSource(source.coverImage),
            status: "draft",
            difficulty: source.difficulty,
            estimatedMinutes: source.estimatedMinutes,
            certificateEnabled: source.certificateEnabled,
            featured: false,
            visibleInCatalog: source.visibleInCatalog,
            showProgressPercentage: source.showProgressPercentage,
            notifyMembersOnModuleRelease: source.notifyMembersOnModuleRelease,
          })
          .returning();
        const learningGoals = await tx
          .select()
          .from(courseLearningGoals)
          .where(
            and(
              eq(courseLearningGoals.courseId, id),
              eq(courseLearningGoals.organizationId, context.organizationId),
            ),
          )
          .orderBy(
            asc(courseLearningGoals.sortOrder),
            asc(courseLearningGoals.id),
          );
        if (learningGoals.length) {
          await tx.insert(courseLearningGoals).values(
            learningGoals.map((goal) => ({
              organizationId: context.organizationId,
              courseId: clone.id,
              text: goal.text,
              sortOrder: goal.sortOrder,
            })),
          );
        }
        const authors = await tx
          .select()
          .from(courseAuthors)
          .where(
            and(
              eq(courseAuthors.courseId, id),
              eq(courseAuthors.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(courseAuthors.sortOrder), asc(courseAuthors.id));
        if (authors.length) {
          await tx.insert(courseAuthors).values(
            authors.map((author) => ({
              organizationId: context.organizationId,
              courseId: clone.id,
              userId: author.userId,
              sortOrder: author.sortOrder,
            })),
          );
        }
        const widgets = await tx
          .select()
          .from(courseWidgets)
          .where(
            and(
              eq(courseWidgets.courseId, id),
              eq(courseWidgets.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(courseWidgets.sortOrder), asc(courseWidgets.id));
        if (widgets.length) {
          await tx
            .insert(courseWidgets)
            .values(
              widgets.map((widget) =>
                courseWidgetValuesForClone(
                  context.organizationId,
                  clone.id,
                  widget,
                ),
              ),
            );
        }
        const associations = await tx
          .select()
          .from(courseModules)
          .where(
            and(
              eq(courseModules.courseId, id),
              eq(courseModules.organizationId, context.organizationId),
            ),
          )
          .orderBy(asc(courseModules.sortOrder));
        for (const association of associations) {
          const [sourceModule] = await tx
            .select()
            .from(modules)
            .where(
              and(
                eq(modules.id, association.moduleId),
                eq(modules.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!sourceModule) continue;
          const [moduleClone] = await tx
            .insert(modules)
            .values(moduleValuesForClone(context.organizationId, sourceModule))
            .returning();
          await tx
            .insert(courseModules)
            .values(
              courseModuleValuesForClone(
                context.organizationId,
                clone.id,
                moduleClone.id,
                association,
                sourceModule.kind,
              ),
            );
          if (!shouldCloneModuleContent(sourceModule.kind)) continue;
          const sourceSections = await tx
            .select()
            .from(moduleSections)
            .where(
              and(
                eq(moduleSections.moduleId, sourceModule.id),
                eq(moduleSections.organizationId, context.organizationId),
              ),
            )
            .orderBy(asc(moduleSections.sortOrder));
          const sectionIds = new Map<string, string>();
          for (const sourceSection of sourceSections) {
            const [sectionClone] = await tx
              .insert(moduleSections)
              .values({
                organizationId: context.organizationId,
                moduleId: moduleClone.id,
                title: sourceSection.title,
                description: sourceSection.description,
                sortOrder: sourceSection.sortOrder,
                status: sourceSection.status,
                visibility: sourceSection.visibility,
                unlockAfterPrevious: sourceSection.unlockAfterPrevious,
                dripDays: sourceSection.dripDays,
              })
              .returning();
            sectionIds.set(sourceSection.id, sectionClone.id);
          }
          const sourceLessons = await tx
            .select()
            .from(lessons)
            .where(
              and(
                eq(lessons.moduleId, sourceModule.id),
                eq(lessons.organizationId, context.organizationId),
              ),
            )
            .orderBy(asc(lessons.sortOrder));
          for (const sourceLesson of sourceLessons) {
            const blocks = await tx
              .select()
              .from(contentBlocks)
              .where(eq(contentBlocks.lessonId, sourceLesson.id))
              .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id));
            const sourcePages = await tx
              .select()
              .from(lessonPages)
              .where(eq(lessonPages.lessonId, sourceLesson.id))
              .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id));
            const blockIds = new Map(
              blocks.map((block) => [block.id, randomUUID()]),
            );
            const pageIds = new Map(
              sourcePages.map((page) => [page.id, randomUUID()]),
            );
            if (
              blocks.some(
                (block) => block.pageId !== null && !pageIds.has(block.pageId),
              )
            ) {
              throw new ApiError(
                409,
                "conflict",
                "Der Quellkurs enthaelt eine ungueltige Seitenreferenz.",
                { reason: "course_clone_reference_invalid" },
              );
            }
            let examQuestionPools;
            let copiedBlockData: Map<
              string,
              ReturnType<typeof courseContentDataForCopy>
            >;
            try {
              examQuestionPools = remapCopiedExamQuestionPools(
                sourceLesson.examQuestionPools,
                blockIds,
              );
              copiedBlockData = new Map(
                blocks.map((block) => [
                  block.id,
                  courseContentDataForCopy(block.type, block.data),
                ]),
              );
            } catch (error) {
              if (error instanceof CourseContentCopyReferenceError) {
                throw new ApiError(
                  409,
                  "conflict",
                  "Der Quellkurs enthaelt eine ungueltige Inhaltsreferenz.",
                  { reason: "course_clone_reference_invalid" },
                );
              }
              throw error;
            }
            const [lessonClone] = await tx
              .insert(lessons)
              .values({
                organizationId: context.organizationId,
                moduleId: moduleClone.id,
                sectionId: sourceLesson.sectionId
                  ? (sectionIds.get(sourceLesson.sectionId) ?? null)
                  : null,
                title: sourceLesson.title,
                slug: sourceLesson.slug,
                summary: sourceLesson.summary,
                type: sourceLesson.type,
                durationMinutes: sourceLesson.durationMinutes,
                passingScore: sourceLesson.passingScore,
                maxAttempts: sourceLesson.maxAttempts,
                shuffleQuestions: sourceLesson.shuffleQuestions,
                examDurationSeconds: sourceLesson.examDurationSeconds,
                examQuestionPools,
                examResultReleaseMode: sourceLesson.examResultReleaseMode,
                examReviewReleaseMode: sourceLesson.examReviewReleaseMode,
                examContentAccessMode: sourceLesson.examContentAccessMode,
                sortOrder: sourceLesson.sortOrder,
                status: sourceLesson.status,
                visibility: sourceLesson.visibility,
                availableAt: sourceLesson.availableAt,
              })
              .returning();
            if (sourcePages.length) {
              await tx.insert(lessonPages).values(
                sourcePages.map((sourcePage) => ({
                  id: pageIds.get(sourcePage.id)!,
                  lessonId: lessonClone.id,
                  title: sourcePage.title,
                  titleSyncedWithLesson: sourcePage.titleSyncedWithLesson,
                  slug: sourcePage.slug,
                  sortOrder: sourcePage.sortOrder,
                  status: sourcePage.status,
                  layoutWidth: sourcePage.layoutWidth,
                  backgroundTone: sourcePage.backgroundTone,
                  contentSpacing: sourcePage.contentSpacing,
                })),
              );
            }
            if (blocks.length) {
              const copiedBlocks = blocks.map((block) => ({
                  id: blockIds.get(block.id)!,
                  lessonId: lessonClone.id,
                  pageId: block.pageId ? pageIds.get(block.pageId)! : null,
                  type: block.type,
                  title: block.title,
                  sortOrder: block.sortOrder,
                  required: block.required,
                  data: copiedBlockData.get(block.id)!,
                  style: block.style,
                }));
              await tx.insert(contentBlocks).values(copiedBlocks);
              copiedDescriptionBlocks.push(
                ...copiedBlocks.map(({ id, type, data }) => ({ id, type, data })),
              );
            }
          }
        }
        const mediaBindings = await tx
          .select({
            mediaAssetId: courseMediaAssets.mediaAssetId,
            kind: mediaAssets.kind,
            status: mediaAssets.status,
            deletedAt: mediaAssets.deletedAt,
          })
          .from(courseMediaAssets)
          .innerJoin(
            mediaAssets,
            and(
              eq(mediaAssets.id, courseMediaAssets.mediaAssetId),
              eq(mediaAssets.organizationId, courseMediaAssets.organizationId),
            ),
          )
          .where(
            and(
              eq(courseMediaAssets.organizationId, context.organizationId),
              eq(courseMediaAssets.courseId, id),
            ),
          )
          .orderBy(asc(courseMediaAssets.mediaAssetId))
          .for("share", { of: mediaAssets });
        const bindingsById = new Map(
          mediaBindings.map((binding) => [binding.mediaAssetId, binding]),
        );
        const invalidWidgetAsset = widgets.find((widget) => {
          if (!widget.mediaAssetId) return false;
          const binding = bindingsById.get(widget.mediaAssetId);
          return (
            !binding ||
            binding.kind !== "image" ||
            binding.status !== "ready" ||
            binding.deletedAt !== null
          );
        });
        if (invalidWidgetAsset) {
          throw new ApiError(
            409,
            "conflict",
            "Der Quellkurs enthaelt ein nicht gebundenes oder nicht bereites Widget-Bild.",
            { reason: "course_widget_media_invalid" },
          );
        }
        if (mediaBindings.length) {
          await tx
            .insert(courseMediaAssets)
            .values(
              mediaBindings.map(({ mediaAssetId }) => ({
                organizationId: context.organizationId,
                courseId: clone.id,
                mediaAssetId,
                attachedById: actor.id,
              })),
            )
            .onConflictDoNothing();
        }
        await enqueueCopiedVideoDescriptionJobsInTransaction(tx, {
          organizationId: context.organizationId,
          originCourseId: clone.id,
          requestedById: actor.id,
          blocks: copiedDescriptionBlocks,
          locale,
        });
        return clone;
      });
      await enqueueWebhook(context.organizationId, "course.created", {
        ...clonedCourse,
        clonedFromId: id,
      });
      return { data: clonedCourse, status: 201, resourceId: clonedCourse.id };
    },
  );
}
