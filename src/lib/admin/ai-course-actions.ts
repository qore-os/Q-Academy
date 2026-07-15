"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { reserveAiAgentCredit } from "@/lib/ai/agent-policy";
import {
  activityEvents,
  contentBlocks,
  courseCategories,
  courseCollaborators,
  courseModules,
  courses,
  lessonPages,
  lessons,
  modules,
  moduleSections,
  notifications,
  users,
  type ContentBlockData,
} from "@/db/schema";
import {
  aiCourseBriefSchema,
  generateCourseDraft,
  type GeneratedCourseBlock,
} from "@/lib/ai/course-draft";
import { requireTeamPermission } from "@/lib/auth";
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { logServerError } from "@/lib/server-error-logging";
import { DEFAULT_COURSE_COVER } from "@/lib/course-cover";
import {
  assertOrganizationCourseCapacity,
  assertOrganizationFeatureAvailable,
} from "@/lib/organization-contracts";
import { slugify } from "@/lib/utils";
import {
  getAiCourseDraftFolderCopy,
  getAiBriefUnsafeInputCopy,
  getCourseSupportCopy,
} from "@/lib/i18n/course-support";
import { intlLocale, normalizeLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";

export type AiCourseActionState = { error?: string };
const courseAuthorRoles = ["owner", "admin", "trainer"] as const;

class CourseAuthorAuthorizationChangedError extends Error {
  constructor() {
    super("Course author authorization changed during generation.");
    this.name = "CourseAuthorAuthorizationChangedError";
  }
}

function blockValues(
  block: GeneratedCourseBlock,
  booleanLabels: { trueLabel: string; falseLabel: string },
) {
  if (block.type === "heading" || block.type === "text") {
    return {
      type: block.type,
      title: null,
      required: false,
      data: { text: block.text } satisfies ContentBlockData,
    };
  }
  if (block.type === "info") {
    return {
      type: block.type,
      title: block.title,
      required: false,
      data: {
        text: block.text,
        accent: block.accent,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "checklist") {
    return {
      type: block.type,
      title: block.title,
      required: false,
      data: { items: block.items } satisfies ContentBlockData,
    };
  }
  if (block.type === "multiple_choice") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: block.options,
        correctOption: block.correctOption,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "true_false") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: [booleanLabels.trueLabel, booleanLabels.falseLabel],
        correctOption: block.correctOption,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "multi_select") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        options: block.options,
        correctOptions: block.correctOptions,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  if (block.type === "fill_blank") {
    return {
      type: block.type,
      title: block.title,
      required: true,
      data: {
        prompt: block.prompt,
        acceptedAnswers: block.acceptedAnswers,
        caseSensitive: block.caseSensitive,
        feedback: block.feedback,
      } satisfies ContentBlockData,
    };
  }
  return {
    type: block.type,
    title: block.title,
    required: true,
    data: {
      prompt: block.prompt,
      options: block.options,
      feedback: block.feedback,
    } satisfies ContentBlockData,
  };
}

export async function createAiCourseAction(
  _state: AiCourseActionState,
  formData: FormData,
): Promise<AiCourseActionState> {
  const user = await requireTeamPermission("courses.manage");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.ai;
  const parsed = aiCourseBriefSchema.safeParse({
    topic: formData.get("topic"),
    targetAudience: formData.get("targetAudience"),
    learningGoal: formData.get("learningGoal"),
    level: formData.get("level"),
    tone: formData.get("tone"),
    scope: formData.get("scope"),
    categoryId: formData.get("categoryId") ?? "",
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some(
        (issue) =>
          issue.code === "custom" && issue.message.includes("Steueranweisungen"),
      )
        ? getAiBriefUnsafeInputCopy(locale)
        : copy.invalidBrief,
    };
  }
  try {
    await assertOrganizationFeatureAvailable(db, user.organizationId, "ai");
  } catch (error) {
    logServerError(error, { action: "ai.course_generation.feature" });
    return { error: copy.unavailable };
  }

  if (parsed.data.categoryId) {
    const [category] = await db
      .select({ id: courseCategories.id })
      .from(courseCategories)
      .where(
        and(
          eq(courseCategories.id, parsed.data.categoryId),
          eq(courseCategories.organizationId, user.organizationId),
        ),
      )
      .limit(1);
    if (!category) {
      return { error: copy.categoryUnavailable };
    }
  }

  const rateLimitIdentifier = `${user.organizationId}\0${user.id}`;
  let concurrency;
  try {
    concurrency = await consumePersistentRateLimit({
      action: "ai_course_generation_concurrent",
      identifier: rateLimitIdentifier,
    });
  } catch (error) {
    logServerError(error, { action: "ai.course_generation.concurrency" });
    return {
      error: copy.unavailable,
    };
  }
  if (concurrency.limited) {
    return {
      error: copy.inProgress,
    };
  }

  let courseId: string | null = null;
  try {
    let quota;
    try {
      quota = await consumePersistentRateLimit({
        action: "ai_course_generation",
        identifier: rateLimitIdentifier,
      });
    } catch (error) {
      logServerError(error, { action: "ai.course_generation.quota" });
      return {
        error: copy.unavailable,
      };
    }
    if (quota.limited) {
      const retryMinutes = Math.max(
        1,
        Math.ceil(retryAfterSeconds(quota.resetAt) / 60),
      );
      return {
        error: copy.quota(
          new Intl.NumberFormat(intlLocale(locale)).format(retryMinutes),
        ),
      };
    }

    try {
      await reserveAiAgentCredit({
        organizationId: user.organizationId,
        userId: user.id,
        units: 25,
        applyMemberHourlyLimit: false,
      });
    } catch (error) {
      logServerError(error, { action: "ai.course_generation.credit" });
      return { error: copy.unavailable };
    }

    const generation = await generateCourseDraft(parsed.data, locale);
    courseId = await db.transaction(async (transaction) => {
      const [currentAuthor] = await transaction
        .select({
          id: users.id,
          organizationId: users.organizationId,
          role: users.role,
        })
        .from(users)
        .where(
          and(
            eq(users.id, user.id),
            eq(users.organizationId, user.organizationId),
            eq(users.status, "active"),
            inArray(users.role, courseAuthorRoles),
          ),
        )
        .limit(1)
        .for("update");
      if (!currentAuthor) {
        throw new CourseAuthorAuthorizationChangedError();
      }

      if (parsed.data.categoryId) {
        const [category] = await transaction
          .select({ id: courseCategories.id })
          .from(courseCategories)
          .where(
            and(
              eq(courseCategories.id, parsed.data.categoryId),
              eq(
                courseCategories.organizationId,
                currentAuthor.organizationId,
              ),
            ),
          )
          .limit(1);
        if (!category) return null;
      }

      const estimatedMinutes = generation.draft.modules.reduce(
        (courseTotal, courseModule) =>
          courseTotal +
          courseModule.sections.reduce(
            (moduleTotal, section) =>
              moduleTotal +
              section.lessons.reduce(
                (lessonTotal, lesson) =>
                  lessonTotal + lesson.durationMinutes,
                0,
              ),
            0,
          ),
        0,
      );
      const slugBase = slugify(generation.draft.title).slice(0, 165) || "kurs";
      await assertOrganizationCourseCapacity(
        transaction,
        currentAuthor.organizationId,
      );
      const [course] = await transaction
        .insert(courses)
        .values({
          organizationId: currentAuthor.organizationId,
          categoryId: parsed.data.categoryId || null,
          title: generation.draft.title,
          slug: `${slugBase}-${randomUUID().slice(0, 8)}`,
          shortDescription: generation.draft.shortDescription,
          description: generation.draft.description,
          status: "draft",
          difficulty: generation.draft.difficulty,
          estimatedMinutes,
          createdById: currentAuthor.id,
          coverImage: DEFAULT_COURSE_COVER,
        })
        .returning({ id: courses.id });

      if (currentAuthor.role === "trainer") {
        await transaction.insert(courseCollaborators).values({
          organizationId: currentAuthor.organizationId,
          courseId: course.id,
          userId: currentAuthor.id,
          permission: "manage",
          grantedById: currentAuthor.id,
        });
      }

      for (const [moduleIndex, draftModule] of generation.draft.modules.entries()) {
        const moduleMinutes = draftModule.sections.reduce(
          (total, section) =>
            total +
            section.lessons.reduce(
              (lessonTotal, lesson) =>
                lessonTotal + lesson.durationMinutes,
              0,
            ),
          0,
        );
        const [courseModule] = await transaction
          .insert(modules)
          .values({
            organizationId: currentAuthor.organizationId,
            title: draftModule.title,
            kind: "learning",
            description: draftModule.description,
            folder: getAiCourseDraftFolderCopy(locale),
            isReusable: false,
            estimatedMinutes: moduleMinutes,
          })
          .returning({ id: modules.id });
        await transaction.insert(courseModules).values({
          organizationId: currentAuthor.organizationId,
          courseId: course.id,
          moduleId: courseModule.id,
          sortOrder: moduleIndex,
          dripDays: 0,
          isRequired: true,
        });

        let lessonSortOrder = 0;
        for (const [sectionIndex, draftSection] of draftModule.sections.entries()) {
          const [section] = await transaction
            .insert(moduleSections)
            .values({
              organizationId: currentAuthor.organizationId,
              moduleId: courseModule.id,
              title: draftSection.title,
              description: draftSection.description,
              sortOrder: sectionIndex,
              status: "published",
              unlockAfterPrevious: sectionIndex > 0,
              dripDays: 0,
            })
            .returning({ id: moduleSections.id });

          for (const draftLesson of draftSection.lessons) {
            const currentLessonOrder = lessonSortOrder;
            lessonSortOrder += 1;
            const lessonSlug =
              slugify(draftLesson.title).slice(0, 165) || "lektion";
            const [lesson] = await transaction
              .insert(lessons)
              .values({
                organizationId: currentAuthor.organizationId,
                moduleId: courseModule.id,
                sectionId: section.id,
                title: draftLesson.title,
                slug: `${lessonSlug}-${currentLessonOrder + 1}`,
                summary: draftLesson.summary,
                type: draftLesson.type,
                durationMinutes: draftLesson.durationMinutes,
                sortOrder: currentLessonOrder,
                status: "published",
                passingScore: 100,
                maxAttempts: null,
                shuffleQuestions: false,
              })
              .returning({ id: lessons.id });

            for (const [pageIndex, draftPage] of draftLesson.pages.entries()) {
              const pageSlug =
                slugify(draftPage.title).slice(0, 165) || "seite";
              const [page] = await transaction
                .insert(lessonPages)
                .values({
                  lessonId: lesson.id,
                  title:
                    pageIndex === 0 ? draftLesson.title : draftPage.title,
                  titleSyncedWithLesson: pageIndex === 0,
                  slug: `${pageSlug}-${pageIndex + 1}`,
                  sortOrder: pageIndex,
                  status: "published",
                })
                .returning({ id: lessonPages.id });
              await transaction.insert(contentBlocks).values(
                draftPage.blocks.map((block, blockIndex) => ({
                  lessonId: lesson.id,
                  pageId: page.id,
                  sortOrder: blockIndex,
                  ...blockValues(block, copy),
                })),
              );
            }
          }
        }
      }

      await transaction.insert(activityEvents).values({
        organizationId: currentAuthor.organizationId,
        userId: currentAuthor.id,
        type: "course.created",
        entityType: "course",
        entityId: course.id,
        metadata: {
          source: "ai_course_assistant",
          provider: generation.provider,
          model: generation.model,
          fallbackReason: generation.fallbackReason,
          scope: parsed.data.scope,
          moduleCount: generation.draft.modules.length,
        },
      });
      await transaction.insert(notifications).values({
        userId: currentAuthor.id,
        title: copy.notificationTitle,
        body: copy.notificationBody(generation.draft.title),
        type: "success",
        category: "learning",
        href: `/admin/courses/${course.id}`,
      });
      return course.id;
    });
  } catch (error) {
    if (error instanceof CourseAuthorAuthorizationChangedError) {
      return {
        error: copy.authorizationChanged,
      };
    }
    logServerError(error, { action: "ai.course_generation.persist" });
    return {
      error: copy.saveFailed,
    };
  } finally {
    try {
      await clearPersistentRateLimit({
        action: "ai_course_generation_concurrent",
        identifier: rateLimitIdentifier,
        expectedResetAt: concurrency.resetAt,
      });
    } catch (error) {
      logServerError(error, {
        action: "ai.course_generation.concurrency_release",
      });
    }
  }

  if (!courseId) {
    return { error: copy.categoryUnavailable };
  }
  revalidatePath("/admin/courses");
  revalidatePath("/admin/modules");
  redirect(`/admin/courses/${courseId}`);
}
