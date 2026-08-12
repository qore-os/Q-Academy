"use server";

import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  aiAgents,
  aiAgentVersions,
  contentBlocks,
  courseCategories,
  courseMediaAssets,
  courseModules,
  courses,
  lessonPages,
  lessons,
  modules,
  moduleSections,
  mediaAssets,
  mediaProcessingJobs,
  type ContentBlockData,
  type ExamQuestionPoolConfiguration,
} from "@/db/schema";
import {
  requireCoursePermission,
  requireCoursePermissionInTransaction,
} from "@/lib/course-permissions";
import { ApiError } from "@/lib/api/errors";
import { assertPublishedAiAgentContentBlock } from "@/lib/api/content-block-ai-agent";
import { assessmentQuestionTypes } from "@/lib/assessment-engine";
import {
  createEmptyGalleryDocument,
  createLinkButtonDocument,
  galleryDocumentHasContent,
  safeCourseImageSource,
  sanitizeGalleryDocument,
} from "@/lib/content-blocks/interactive-documents";
import {
  defaultStructuredDocument,
  sanitizeAccordionDocument,
  sanitizeCalloutDocument,
  sanitizeCodeDocument,
  sanitizeColumnsDocument,
  sanitizeDividerDocument,
  sanitizeDownloadDocument,
  sanitizeQuoteDocument,
  sanitizeTableDocument,
  sanitizeTabsDocument,
} from "@/lib/content-blocks/layout-documents";
import {
  createRichTextDocument,
  parseRichTextDocumentJson,
} from "@/lib/rich-text/document";
import { parseWebVttTranscript } from "@/lib/content-blocks/video-transcript";
import {
  playbackWindowMilliseconds,
  videoPlaybackPolicyFromForm,
} from "@/lib/media/video-playback-policy";
import {
  boundVideoCompositionMatchesDocument,
  sanitizeVideoComposition,
} from "@/lib/media/video-composition";
import { videoEndCardFromForm } from "@/lib/media/video-end-card";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import { getCourseContentDefaults } from "@/lib/i18n/course-content-defaults";
import { normalizeLocale, type AppLocale } from "@/lib/i18n/model";
import {
  enqueueCopiedVideoDescriptionJobsInTransaction,
  enqueueVideoDescriptionJobInTransaction,
} from "@/lib/ai/video-description-jobs";
import { resolveUserLocale } from "@/lib/i18n/server";
import {
  lockActiveCourseDataForms,
  lockCourseContentBlocksForMutation,
} from "@/lib/course-data-form-lock";
import {
  courseAuthorIdsSchema,
  courseLearningGoalsSchema,
} from "@/lib/course-information";
import {
  MAX_COURSE_COVER_LENGTH,
  courseCoverMediaAssetId,
  safeCourseCoverSource,
} from "@/lib/course-cover";
import { replaceCourseInformationCollections } from "@/lib/course-information-service";
import {
  getCourseLinkTarget,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";
import {
  normalizeCourseOutline,
  replaceCourseOutline,
  type CourseOutlineItem,
} from "@/lib/course-outline-service";
import {
  createLessonPageWithTitleSync,
  updateLessonPageWithTitleSync,
  updateLessonWithTitleSync,
} from "@/lib/lesson-page-title-sync-service";
import { createModuleWithStructure } from "@/lib/module-creation-service";
import { assertLearningModuleStructureMutation } from "@/lib/module-structure-service";
import { canReadCourseMedia } from "@/lib/media/access-policy";
import {
  assertManageableSharedCourseMedia,
  bindSharedCourseMedia,
  type SharedCourseMediaKind,
} from "@/lib/media/shared-course-media";
import { enqueueReadyTranscriptInTransaction } from "@/lib/media/processing-worker";
import {
  parseVideoPosterJson,
  type VideoPoster,
} from "@/lib/media/video-poster";
import {
  collectCourseContentMediaReferences,
  courseContentDataForCopy,
  CourseContentCopyReferenceError,
} from "@/lib/course-content-copy-model";
import { consumeStockImageSelection } from "@/lib/stock-image-service";
import { deriveAdminExamQuestionPools } from "@/lib/exam-admin-policy";
import { examLifecycleConfigurationErrors } from "@/lib/exam-lifecycle-policy";
import {
  requireLinkModuleTargetViewPermission,
  requireSharedModuleContentPermission,
} from "@/lib/shared-module-permissions";
import {
  contentBlockStyleSchema,
  lessonPageCommandSchema,
  pageStyleSchema,
} from "@/lib/content-style-model";
import {
  COURSE_INTEGRATION_LAYOUTS,
  COURSE_INTEGRATION_PROVIDERS,
  resolveCourseIntegration,
} from "@/lib/content-blocks/integration-catalog";
import { slugify } from "@/lib/utils";
import {
  copyLessonToCourseTarget,
  copySectionToCourseTarget,
  courseContentCopyErrorReason,
} from "@/lib/course-content-copy-service";
import { type CourseContentCopyActionCode } from "@/lib/i18n/course-content-copy";
import type {
  CourseBuilderActionCode,
  CourseBuilderServerActionCode,
} from "@/lib/i18n/course-builder-actions";

export type CourseBuilderActionResult = {
  ok: boolean;
  code: CourseBuilderServerActionCode;
  id?: string;
  secondaryId?: string;
  lessonId?: string;
  pageId?: string;
  reason?: "revision_conflict" | "collection_conflict";
  resourceId?: string;
  expectedRevision?: number;
  currentRevision?: number;
};

export type CourseBuilderAiAgentOption = {
  id: string;
  name: string;
  description: string;
  type: "learning_coach" | "knowledge_assistant" | "form_assistant";
  version: number;
  color: string;
  icon: string;
};

export type CourseBuilderAiAgentOptionsResult = {
  ok: boolean;
  code: CourseBuilderActionCode;
  agents: CourseBuilderAiAgentOption[];
};

type CourseBuilderMutationResult<T> =
  Readonly<{ value: T }> | Readonly<{ error: CourseBuilderActionCode }>;

const idSchema = z.string().uuid();
const contentTypeSchema = z.enum([
  "ai_agent",
  "heading",
  "text",
  "rich_text",
  "button",
  "gallery",
  "callout",
  "quote",
  "divider",
  "accordion",
  "tabs",
  "columns",
  "code",
  "table",
  "download",
  "data_form",
  "info",
  "checklist",
  "image",
  "video",
  "audio",
  "file",
  "embed",
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
  "submission",
]);
const editableContentTypeSchema = z.enum([
  "eyebrow",
  ...contentTypeSchema.options,
]);
const lessonTypeSchema = z.enum(["lesson", "quiz", "assignment", "exam"]);
const contentStatusSchema = z.enum(["draft", "published", "archived"]);
const accentSchema = z.enum(["navy", "teal", "coral", "amber"]);
const examAdminSettingsSchema = z.object({
  durationMinutes: z.number().min(1).max(1_440).nullable(),
  randomQuestionCount: z.number().int().min(1).max(100).nullable(),
  resultReleaseMode: z.enum(["immediate", "after_deadline", "manual"]),
  reviewReleaseMode: z.enum(["never", "after_result", "manual"]),
  contentAccessMode: z.enum(["allow", "block_course", "block_academy"]),
});
const mediaUrlSchema = z
  .string()
  .url("Bitte eine gueltige URL eingeben.")
  .max(2_000)
  .refine(
    (input) => ["http:", "https:"].includes(new URL(input).protocol),
    "Es sind nur HTTP(S)-URLs erlaubt.",
  );

const failure = (
  code: CourseBuilderServerActionCode,
  details: Omit<CourseBuilderActionResult, "ok" | "code"> = {},
): CourseBuilderActionResult => ({
  ok: false,
  code,
  ...details,
});
const revisionFailure = (
  resourceId: string,
  expectedRevision: number,
  currentRevision?: number,
) =>
  failure("course_builder.revision_conflict", {
    reason: "revision_conflict",
    resourceId,
    expectedRevision,
    currentRevision,
  });
const success = (
  code: CourseBuilderServerActionCode,
  id?: string,
  secondaryId?: string,
  lessonId?: string,
  pageId?: string,
): CourseBuilderActionResult => ({
  ok: true,
  code,
  id,
  secondaryId,
  lessonId,
  pageId,
});

async function runCourseBuilderMutation<T>(
  mutation: () => Promise<T>,
): Promise<CourseBuilderMutationResult<Awaited<T>>> {
  try {
    return { value: await mutation() } as const;
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: courseBuilderErrorCode(error) } as const;
    }
    throw error;
  }
}

function courseBuilderErrorCode(error: ApiError): CourseBuilderActionCode {
  if (error.status === 403) return "course_builder.permission_denied";
  if (error.status === 404) return "course_builder.unavailable";
  if (error.status === 409) return "course_builder.conflict";
  if (error.status === 400 || error.status === 422) {
    return "course_builder.invalid_input";
  }
  return "course_builder.failed";
}

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function comparableAssessmentText(input: string) {
  return input
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de-DE");
}

function uniqueSlug(title: string) {
  return `${slugify(title) || "inhalt"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function revalidateCourse(courseId: string) {
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
}

function courseContentCopyFailure(
  code: Exclude<
    CourseContentCopyActionCode,
    "course_content_copy.lesson_copied" | "course_content_copy.section_copied"
  >,
): CourseBuilderActionResult {
  return {
    ok: false,
    code,
  };
}

function courseContentCopyFailureFromError(
  error: unknown,
): CourseBuilderActionResult {
  if (error instanceof ApiError && error.status === 403) {
    return courseContentCopyFailure("course_content_copy.permission_denied");
  }
  const reason = courseContentCopyErrorReason(error);
  if (reason === "source_unavailable") {
    return courseContentCopyFailure("course_content_copy.source_unavailable");
  }
  if (reason === "target_unavailable") {
    return courseContentCopyFailure("course_content_copy.target_unavailable");
  }
  if (reason === "reference_invalid") {
    return courseContentCopyFailure("course_content_copy.reference_invalid");
  }
  if (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 409)
  ) {
    return courseContentCopyFailure("course_content_copy.target_unavailable");
  }
  return courseContentCopyFailure("course_content_copy.failed");
}

export async function listCourseBuilderPublishedAiAgentsAction(
  courseId: string,
): Promise<CourseBuilderAiAgentOptionsResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  if (!idSchema.safeParse(courseId).success) {
    return {
      ok: false,
      code: "course_builder.ai_agents.invalid_course",
      agents: [],
    };
  }
  const agents = await db
    .select({
      id: aiAgents.id,
      name: aiAgentVersions.name,
      description: aiAgentVersions.description,
      type: aiAgentVersions.type,
      version: aiAgentVersions.version,
      color: aiAgentVersions.color,
      icon: aiAgentVersions.icon,
    })
    .from(aiAgents)
    .innerJoin(
      aiAgentVersions,
      and(
        eq(aiAgentVersions.id, aiAgents.publishedVersionId),
        eq(aiAgentVersions.agentId, aiAgents.id),
        eq(aiAgentVersions.organizationId, aiAgents.organizationId),
        eq(aiAgentVersions.state, "published"),
      ),
    )
    .where(
      and(
        eq(aiAgents.organizationId, user.organizationId),
        eq(aiAgents.active, true),
      ),
    )
    .orderBy(asc(aiAgentVersions.name), asc(aiAgents.id));
  return { ok: true, code: "course_builder.ai_agents.loaded", agents };
}

async function moduleInCourse(
  courseId: string,
  moduleId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: modules.id })
    .from(courseModules)
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .innerJoin(
      modules,
      and(
        eq(modules.id, courseModules.moduleId),
        eq(modules.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(courseModules.courseId, courseId),
        eq(courseModules.moduleId, moduleId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function lessonInCourse(
  courseId: string,
  lessonId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: lessons.id, moduleId: lessons.moduleId })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, organizationId),
      ),
    )
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.courseId, courseId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .where(eq(lessons.id, lessonId))
    .limit(1);
  return row ?? null;
}

async function sectionInCourse(
  courseId: string,
  sectionId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({ id: moduleSections.id })
    .from(moduleSections)
    .innerJoin(
      modules,
      and(
        eq(modules.id, moduleSections.moduleId),
        eq(modules.organizationId, organizationId),
      ),
    )
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.courseId, courseId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .where(eq(moduleSections.id, sectionId))
    .limit(1);
  return row ?? null;
}

async function pageInLesson(
  courseId: string,
  lessonId: string,
  pageId: string,
  organizationId: string,
) {
  const lesson = await lessonInCourse(courseId, lessonId, organizationId);
  if (!lesson) return null;
  const [page] = await db
    .select({ id: lessonPages.id })
    .from(lessonPages)
    .where(and(eq(lessonPages.id, pageId), eq(lessonPages.lessonId, lessonId)))
    .limit(1);
  return page ?? null;
}

async function blockInCourse(
  courseId: string,
  blockId: string,
  organizationId: string,
) {
  const [row] = await db
    .select({
      id: contentBlocks.id,
      lessonId: contentBlocks.lessonId,
      pageId: contentBlocks.pageId,
      type: contentBlocks.type,
      revision: contentBlocks.revision,
      data: contentBlocks.data,
    })
    .from(contentBlocks)
    .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, organizationId),
      ),
    )
    .innerJoin(
      courseModules,
      and(
        eq(courseModules.moduleId, modules.id),
        eq(courseModules.courseId, courseId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, courseModules.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .where(eq(contentBlocks.id, blockId))
    .limit(1);
  return row ?? null;
}

function parseBlockForm(
  type: z.infer<typeof editableContentTypeSchema>,
  formData: FormData,
  locale: AppLocale,
) {
  const required = formData.get("required") === "on";
  const title = value(formData, "title");

  if (type === "ai_agent") {
    const parsed = idSchema.safeParse(value(formData, "agentId"));
    if (!parsed.success) {
      return { error: "Bitte einen veroeffentlichten KI-Agenten auswaehlen." };
    }
    return {
      title: "KI-Agent",
      required: false,
      data: { agentId: parsed.data } satisfies ContentBlockData,
    };
  }

  if (type === "rich_text") {
    const richText = parseRichTextDocumentJson(
      String(formData.get("richText") ?? ""),
    );
    if (!richText) {
      return { error: "Bitte einen gueltigen Rich-Text-Inhalt eingeben." };
    }
    return {
      title: "Rich-Text",
      required: false,
      data: { richText } satisfies ContentBlockData,
    };
  }

  if (type === "button") {
    const parsed = z
      .object({
        label: z.string().trim().min(1).max(160),
        href: z.string().trim().min(1).max(2_000),
        variant: z.enum(["primary", "secondary", "link"]),
      })
      .safeParse({
        label: value(formData, "label"),
        href: value(formData, "href"),
        variant: value(formData, "variant"),
      });
    const button = parsed.success
      ? createLinkButtonDocument(
          parsed.data.label,
          parsed.data.href,
          parsed.data.variant,
        )
      : null;
    if (!button) {
      return { error: "Bitte Beschriftung, Ziel und Variante pruefen." };
    }
    return {
      title: button.label,
      required: false,
      data: { button } satisfies ContentBlockData,
    };
  }

  if (type === "data_form") {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(220),
        formId: idSchema,
      })
      .safeParse({
        title: title || "Formular",
        formId: value(formData, "formId"),
      });
    if (!parsed.success) {
      return { error: "Bitte ein aktives Datenformular auswaehlen." };
    }
    return {
      title: parsed.data.title,
      required,
      data: { formId: parsed.data.formId } satisfies ContentBlockData,
    };
  }

  if (type === "gallery") {
    const settings = z
      .object({
        count: z.coerce.number().int().min(1).max(8),
        layout: z.enum(["grid", "featured"]),
      })
      .safeParse({
        count: formData.get("galleryItemCount"),
        layout: value(formData, "galleryLayout"),
      });
    if (!settings.success) {
      return { error: "Bitte die Galerieeinstellungen pruefen." };
    }
    const galleryItems = [] as Array<{
      source?: string;
      mediaAssetId?: string;
      alt: string;
      caption?: string;
    }>;
    for (let index = 0; index < settings.data.count; index += 1) {
      const rawUrl = value(formData, `gallery.${index}.url`);
      const rawMediaAssetId = value(formData, `gallery.${index}.mediaAssetId`);
      const mediaAssetId = rawMediaAssetId
        ? idSchema.safeParse(rawMediaAssetId)
        : null;
      const mediaUrl = rawUrl ? safeCourseImageSource(rawUrl) : null;
      const text = z
        .object({
          alt: z.string().trim().min(1).max(300),
          caption: z.string().trim().max(1_000),
        })
        .safeParse({
          alt: value(formData, `gallery.${index}.alt`),
          caption: value(formData, `gallery.${index}.caption`),
        });
      if (
        !text.success ||
        Boolean(rawMediaAssetId) === Boolean(rawUrl) ||
        (mediaAssetId && !mediaAssetId.success) ||
        (rawUrl && !mediaUrl)
      ) {
        return {
          error:
            "Jedes Galeriebild benoetigt genau eine gueltige Quelle und einen Alternativtext.",
        };
      }
      galleryItems.push({
        alt: text.data.alt,
        ...(text.data.caption ? { caption: text.data.caption } : {}),
        ...(mediaAssetId?.success
          ? { mediaAssetId: mediaAssetId.data }
          : { source: mediaUrl! }),
      });
    }
    return {
      title: "Galerie",
      required: false,
      data: {
        gallery: createEmptyGalleryDocument(),
      } satisfies ContentBlockData,
      galleryDraft: { layout: settings.data.layout, items: galleryItems },
    };
  }

  if (
    type === "callout" ||
    type === "quote" ||
    type === "divider" ||
    type === "accordion" ||
    type === "tabs" ||
    type === "columns" ||
    type === "code" ||
    type === "table"
  ) {
    let rawDocument: unknown;
    try {
      rawDocument = JSON.parse(value(formData, "structuredDocument"));
    } catch {
      return { error: "Der strukturierte Inhalt ist ungueltig." };
    }
    const document =
      type === "callout"
        ? sanitizeCalloutDocument(rawDocument)
        : type === "quote"
          ? sanitizeQuoteDocument(rawDocument)
          : type === "divider"
            ? sanitizeDividerDocument(rawDocument)
            : type === "accordion"
              ? sanitizeAccordionDocument(rawDocument)
              : type === "tabs"
                ? sanitizeTabsDocument(rawDocument)
                : type === "columns"
                  ? sanitizeColumnsDocument(rawDocument)
                  : type === "code"
                    ? sanitizeCodeDocument(rawDocument)
                    : sanitizeTableDocument(rawDocument);
    if (!document)
      return { error: "Bitte alle erforderlichen Inhalte pruefen." };
    return {
      title:
        type === "callout" && "heading" in document
          ? (document.heading ?? "Callout")
          : type === "quote"
            ? "Zitat"
            : type === "divider"
              ? null
              : type === "accordion"
                ? "Accordion"
                : type === "tabs"
                  ? "Tabs"
                  : type === "columns"
                    ? "Spalten"
                    : type === "code"
                      ? "Code"
                      : "Tabelle",
      required: false,
      data: { [type]: document } as ContentBlockData,
    };
  }

  if (type === "download") {
    const document = sanitizeDownloadDocument({
      version: 1,
      mediaAssetId: value(formData, "mediaAssetId"),
      fileName: value(formData, "fileName"),
      label: value(formData, "label"),
      description: value(formData, "description"),
    });
    if (!document) {
      return {
        error:
          "Bitte einen geprueften Download und eine Beschriftung auswaehlen.",
      };
    }
    return {
      title: document.label,
      required: false,
      data: { download: document } satisfies ContentBlockData,
    };
  }

  if (type === "eyebrow" || type === "heading" || type === "text") {
    const parsed = z
      .string()
      .min(1, "Bitte Text eingeben.")
      .max(12_000)
      .safeParse(value(formData, "text"));
    if (!parsed.success)
      return {
        error: parsed.error.issues[0]?.message ?? "Text ist ungueltig.",
      };
    return {
      title: null,
      required,
      data: { text: parsed.data } satisfies ContentBlockData,
    };
  }
  if (type === "info") {
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        text: z.string().min(1).max(12_000),
        accent: accentSchema,
      })
      .safeParse({
        title,
        text: value(formData, "text"),
        accent: value(formData, "accent"),
      });
    if (!parsed.success)
      return { error: "Bitte Titel, Text und Akzent pruefen." };
    return {
      title: parsed.data.title,
      required,
      data: {
        text: parsed.data.text,
        accent: parsed.data.accent,
      } satisfies ContentBlockData,
    };
  }
  if (type === "checklist") {
    const items = value(formData, "items")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        items: z.array(z.string().max(500)).min(1).max(40),
      })
      .safeParse({ title, items });
    if (!parsed.success)
      return {
        error: "Bitte Titel und mindestens einen Checklistenpunkt eingeben.",
      };
    return {
      title: parsed.data.title,
      required,
      data: { items: parsed.data.items } satisfies ContentBlockData,
    };
  }
  if (type === "fill_blank") {
    const acceptedAnswers = value(formData, "acceptedAnswers")
      .split(/\r?\n/)
      .map((answer) => answer.trim())
      .filter(Boolean);
    const caseSensitive = formData.get("caseSensitive") === "on";
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        prompt: z.string().min(3).max(2_000),
        acceptedAnswers: z.array(z.string().max(500)).min(1).max(20),
        feedback: z.string().max(2_000),
      })
      .strict()
      .safeParse({
        title,
        prompt: value(formData, "prompt"),
        acceptedAnswers,
        feedback: value(formData, "feedback"),
      });
    const normalizedAnswers = acceptedAnswers.map((answer) => {
      const normalized = answer.normalize("NFKC").replace(/\s+/g, " ");
      return caseSensitive ? normalized : normalized.toLocaleLowerCase("de-DE");
    });
    if (
      !parsed.success ||
      new Set(normalizedAnswers).size !== normalizedAnswers.length
    ) {
      return {
        error:
          "Bitte Frage und mindestens eine eindeutige akzeptierte Antwort pruefen.",
      };
    }
    return {
      title: parsed.data.title,
      required,
      data: {
        prompt: parsed.data.prompt,
        acceptedAnswers: parsed.data.acceptedAnswers,
        caseSensitive,
        feedback: parsed.data.feedback || undefined,
      } satisfies ContentBlockData,
    };
  }
  if (type === "ordering") {
    const options = value(formData, "options")
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter(Boolean);
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        prompt: z.string().min(3).max(2_000),
        options: z.array(z.string().max(500)).min(2).max(20),
        feedback: z.string().max(2_000),
      })
      .strict()
      .safeParse({
        title,
        prompt: value(formData, "prompt"),
        options,
        feedback: value(formData, "feedback"),
      });
    if (
      !parsed.success ||
      new Set(options.map(comparableAssessmentText)).size !== options.length
    ) {
      return {
        error:
          "Bitte Frage und mindestens zwei eindeutige Sortierelemente pruefen.",
      };
    }
    return {
      title: parsed.data.title,
      required,
      data: {
        prompt: parsed.data.prompt,
        options: parsed.data.options,
        feedback: parsed.data.feedback || undefined,
      } satisfies ContentBlockData,
    };
  }
  if (type === "multi_select") {
    const options = value(formData, "options")
      .split(/\r?\n/)
      .map((option) => option.trim())
      .filter(Boolean);
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        prompt: z.string().min(3).max(2_000),
        options: z.array(z.string().max(500)).min(2).max(20),
        correctOptions: z
          .array(z.coerce.number().int().min(0).max(19))
          .min(1)
          .max(20),
        feedback: z.string().max(2_000),
      })
      .strict()
      .safeParse({
        title,
        prompt: value(formData, "prompt"),
        options,
        correctOptions: formData.getAll("correctOptions"),
        feedback: value(formData, "feedback"),
      });
    if (
      !parsed.success ||
      new Set(parsed.data.correctOptions).size !==
        parsed.data.correctOptions.length ||
      parsed.data.correctOptions.some(
        (option) => option >= parsed.data.options.length,
      ) ||
      new Set(options.map(comparableAssessmentText)).size !== options.length
    ) {
      return {
        error:
          "Bitte Frage, eindeutige Optionen und alle korrekten Antworten pruefen.",
      };
    }
    return {
      title: parsed.data.title,
      required,
      data: {
        prompt: parsed.data.prompt,
        options: parsed.data.options,
        correctOptions: [...parsed.data.correctOptions].sort(
          (left, right) => left - right,
        ),
        feedback: parsed.data.feedback || undefined,
      } satisfies ContentBlockData,
    };
  }
  if (type === "multiple_choice" || type === "true_false") {
    const options =
      type === "true_false"
        ? ["Richtig", "Falsch"]
        : value(formData, "options")
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    const parsed = z
      .object({
        title: z.string().min(1).max(220),
        prompt: z.string().min(3).max(2_000),
        options: z.array(z.string().max(500)).min(2).max(12),
        correctOption: z.coerce.number().int().min(0),
        feedback: z.string().max(2_000),
      })
      .safeParse({
        title,
        prompt: value(formData, "prompt"),
        options,
        correctOption: formData.get("correctOption"),
        feedback: value(formData, "feedback"),
      });
    if (
      !parsed.success ||
      parsed.data.correctOption >= parsed.data.options.length ||
      new Set(parsed.data.options.map(comparableAssessmentText)).size !==
        parsed.data.options.length
    ) {
      return {
        error:
          "Bitte Frage, mindestens zwei Optionen und die korrekte Antwort pruefen.",
      };
    }
    return {
      title: parsed.data.title,
      required,
      data: {
        prompt: parsed.data.prompt,
        options: parsed.data.options,
        correctOption: parsed.data.correctOption,
        feedback: parsed.data.feedback || undefined,
      } satisfies ContentBlockData,
    };
  }

  if (type === "embed") {
    const providerIds = COURSE_INTEGRATION_PROVIDERS.map(
      (provider) => provider.id,
    ) as [
      (typeof COURSE_INTEGRATION_PROVIDERS)[number]["id"],
      ...(typeof COURSE_INTEGRATION_PROVIDERS)[number]["id"][],
    ];
    const parsed = z
      .object({
        title: z.string().max(220),
        url: mediaUrlSchema,
        provider: z.enum(providerIds),
        layout: z.enum(COURSE_INTEGRATION_LAYOUTS),
        caption: z.string().max(5_000),
        fileName: z.string().max(500),
      })
      .safeParse({
        title,
        url: value(formData, "url"),
        provider: value(formData, "embedProvider"),
        layout: value(formData, "embedLayout"),
        caption: value(formData, "caption"),
        fileName: value(formData, "fileName"),
      });
    if (!parsed.success) {
      return {
        error:
          parsed.error.issues[0]?.message ?? "Bitte die Medienangaben pruefen.",
      };
    }
    const integration = resolveCourseIntegration(
      parsed.data.url,
      parsed.data.provider,
    );
    if (!integration) {
      return {
        error:
          "Die Embed-URL muss zum ausgewaehlten, freigegebenen Provider passen.",
      };
    }
    const data: ContentBlockData = {
      caption: parsed.data.caption,
      embedUrl: integration.url,
      embedProvider: integration.provider.id,
      embedLayout: parsed.data.layout,
    };
    return {
      title: parsed.data.title || null,
      required: false,
      data,
    };
  }

  if (["image", "video", "audio", "file"].includes(type)) {
    const rawUrl = value(formData, "url");
    const rawMediaAssetId = value(formData, "mediaAssetId");
    const rawStockImageSelectionId = value(formData, "stockImageSelectionId");
    const stockImageSelectionId = rawStockImageSelectionId
      ? idSchema.safeParse(rawStockImageSelectionId)
      : null;
    const mediaAssetId = rawMediaAssetId
      ? idSchema.safeParse(rawMediaAssetId)
      : null;
    const mediaUrl = rawUrl ? mediaUrlSchema.safeParse(rawUrl) : null;
    const rawTranscript =
      type === "video" ? value(formData, "transcriptVtt") : "";
    const rawVideoComposition =
      type === "video" ? value(formData, "videoComposition") : "";
    const rawVideoPoster =
      type === "video" ? value(formData, "videoPoster") : "";
    const videoPoster = rawVideoPoster
      ? parseVideoPosterJson(rawVideoPoster)
      : null;
    let videoComposition: ReturnType<typeof sanitizeVideoComposition>;
    try {
      videoComposition = rawVideoComposition
        ? sanitizeVideoComposition(JSON.parse(rawVideoComposition))
        : null;
    } catch {
      videoComposition = null;
    }
    const transcriptLanguage = z
      .string()
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
      .max(35)
      .safeParse(value(formData, "transcriptLanguage") || "de");
    const transcript = rawTranscript
      ? transcriptLanguage.success
        ? parseWebVttTranscript(rawTranscript, transcriptLanguage.data)
        : null
      : undefined;
    const videoPlayback =
      type === "video"
        ? videoPlaybackPolicyFromForm({
            trimStartSeconds: value(formData, "videoTrimStartSeconds"),
            trimEndSeconds: value(formData, "videoTrimEndSeconds"),
            requiredPlayback: formData.get("videoRequiredPlayback") === "on",
            minimumWatchPercent: value(formData, "videoMinimumWatchPercent"),
            seeking: value(formData, "videoSeeking") || "allowed",
            removedSegments: value(formData, "videoRemovedSegments"),
          })
        : null;
    const videoEndCard =
      type === "video"
        ? videoEndCardFromForm({
            enabled: formData.get("videoEndCardEnabled") === "on",
            heading: value(formData, "videoEndCardHeading"),
            text: value(formData, "videoEndCardText"),
            ctaLabel: value(formData, "videoEndCardCtaLabel"),
            ctaHref: value(formData, "videoEndCardCtaHref"),
          })
        : null;
    const parsed = z
      .object({
        title: z.string().max(220),
        caption: z.string().max(5_000),
        fileName: z.string().max(500),
      })
      .safeParse({
        title,
        caption: value(formData, "caption"),
        fileName: value(formData, "fileName"),
      });
    if (
      !parsed.success ||
      Boolean(rawMediaAssetId) === Boolean(rawUrl) ||
      (mediaAssetId && !mediaAssetId.success) ||
      (rawStockImageSelectionId &&
        (type !== "image" || !stockImageSelectionId?.success)) ||
      (mediaUrl && !mediaUrl.success) ||
      (type === "video" &&
        (!videoPlayback ||
          !videoEndCard?.success ||
          !transcriptLanguage.success ||
          (Boolean(rawTranscript) && !transcript) ||
          (Boolean(rawVideoComposition) && !videoComposition) ||
          (Boolean(rawVideoPoster) && !videoPoster)))
    ) {
      return {
        error:
          type === "video" &&
          (!videoPlayback ||
            !videoEndCard?.success ||
            !transcriptLanguage.success ||
            (Boolean(rawTranscript) && !transcript) ||
            (Boolean(rawVideoComposition) && !videoComposition) ||
            (Boolean(rawVideoPoster) && !videoPoster))
            ? !videoEndCard?.success
              ? getCourseParityCopy(locale).video.endCard.unsafeUrl
              : "Bitte Wiedergaberegeln, WebVTT-Transkript und Sprache pruefen."
            : mediaUrl && !mediaUrl.success
              ? mediaUrl.error.issues[0]?.message
              : "Bitte genau einen geprueften Upload oder eine gueltige Medien-URL auswaehlen.",
      };
    }
    const data: ContentBlockData = {
      caption: parsed.data.caption,
      ...(mediaAssetId?.success ? { mediaAssetId: mediaAssetId.data } : {}),
      ...(transcript ? { transcript } : {}),
      ...(videoEndCard?.success && videoEndCard.value
        ? { videoEndCard: videoEndCard.value }
        : {}),
      ...(videoPlayback ? { videoPlayback } : {}),
      ...(videoComposition ? { videoComposition } : {}),
      ...(videoPoster ? { videoPoster } : {}),
      ...(type === "video"
        ? {
            transcriptLanguage: transcriptLanguage.success
              ? transcriptLanguage.data.toLowerCase()
              : locale,
            videoDescriptionIntent:
              value(formData, "videoDescriptionIntent") === "automatic"
                ? ("automatic" as const)
                : ("touched" as const),
          }
        : {}),
    };
    if (mediaUrl?.success) {
      if (type === "image") data.imageUrl = mediaUrl.data;
      if (type === "video") data.videoUrl = mediaUrl.data;
      if (type === "audio") data.audioUrl = mediaUrl.data;
      if (type === "file") data.fileUrl = mediaUrl.data;
    }
    if (type === "file") {
      data.fileName = parsed.data.fileName || parsed.data.title || "Download";
    }
    return {
      title: parsed.data.title || null,
      required: videoPlayback?.completionMode === "required",
      data,
      ...(stockImageSelectionId?.success
        ? { stockImageSelectionId: stockImageSelectionId.data }
        : {}),
      ...(type === "video"
        ? {
            videoDescriptionIntent:
              value(formData, "videoDescriptionIntent") === "automatic"
                ? ("automatic" as const)
                : ("touched" as const),
            transcriptLanguage: transcriptLanguage.success
              ? transcriptLanguage.data.toLowerCase()
              : locale,
          }
        : {}),
    };
  }

  const parsed = z
    .object({
      title: z.string().min(1).max(220),
      prompt: z.string().min(3).max(5_000),
    })
    .safeParse({ title, prompt: value(formData, "prompt") });
  if (!parsed.success)
    return { error: "Bitte Titel und Arbeitsauftrag eingeben." };
  return {
    title: parsed.data.title,
    required,
    data: { prompt: parsed.data.prompt } satisfies ContentBlockData,
  };
}

export async function updateCourseInformationAction(
  courseId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      categoryId: idSchema.nullable(),
      title: z.string().min(3).max(220),
      shortDescription: z.string().min(3).max(700),
      description: z.string().min(10).max(20_000),
      difficulty: z.string().min(2).max(40),
      estimatedMinutes: z.coerce.number().int().min(1).max(100_000),
      coverImage: z
        .string()
        .trim()
        .max(MAX_COURSE_COVER_LENGTH)
        .refine(
          (coverImage) =>
            coverImage === "" || safeCourseCoverSource(coverImage),
          "Titelbilder muessen ein lokaler Bildpfad oder ein sicherer Kursmedien-Pfad sein.",
        ),
      coverMediaAssetId: idSchema.nullable(),
      coverStockImageSelectionId: idSchema.nullable(),
      certificateEnabled: z.boolean(),
      featured: z.boolean(),
      visibleInCatalog: z.boolean(),
      showProgressPercentage: z.boolean(),
      notifyMembersOnModuleRelease: z.boolean(),
      learningGoals: courseLearningGoalsSchema,
      authorIds: courseAuthorIdsSchema,
    })
    .safeParse({
      courseId,
      categoryId: value(formData, "categoryId") || null,
      title: value(formData, "title"),
      shortDescription: value(formData, "shortDescription"),
      description: value(formData, "description"),
      difficulty: value(formData, "difficulty"),
      estimatedMinutes: formData.get("estimatedMinutes"),
      coverImage: value(formData, "coverImage"),
      coverMediaAssetId: value(formData, "coverMediaAssetId") || null,
      coverStockImageSelectionId:
        value(formData, "coverStockImageSelectionId") || null,
      certificateEnabled: formData.get("certificateEnabled") === "on",
      featured: formData.get("featured") === "on",
      visibleInCatalog: formData.get("visibleInCatalog") === "on",
      showProgressPercentage: formData.get("showProgressPercentage") === "on",
      notifyMembersOnModuleRelease:
        formData.get("notifyMembersOnModuleRelease") === "on",
      learningGoals: formData
        .getAll("learningGoals")
        .map((goal) => String(goal).trim()),
      authorIds: formData
        .getAll("authorIds")
        .map((authorId) => String(authorId).trim()),
    });
  if (!parsed.success) return failure("course_builder.cover.invalid");

  const requestedCoverAssetId = courseCoverMediaAssetId(parsed.data.coverImage);
  if (
    requestedCoverAssetId &&
    requestedCoverAssetId !== parsed.data.coverMediaAssetId
  ) {
    return failure("course_builder.cover.invalid_asset");
  }

  let updated: { id: string } | null;
  try {
    updated = await db.transaction(async (tx) => {
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      if (parsed.data.categoryId) {
        const [category] = await tx
          .select({ id: courseCategories.id })
          .from(courseCategories)
          .where(
            and(
              eq(courseCategories.id, parsed.data.categoryId),
              eq(courseCategories.organizationId, user.organizationId),
            ),
          )
          .limit(1);
        if (!category) return null;
      }
      if (requestedCoverAssetId) {
        const [asset] = await tx
          .select({
            id: mediaAssets.id,
            kind: mediaAssets.kind,
            purpose: mediaAssets.purpose,
            status: mediaAssets.status,
            uploadedById: mediaAssets.uploadedById,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.id, requestedCoverAssetId),
              eq(mediaAssets.organizationId, user.organizationId),
            ),
          )
          .limit(1)
          .for("update", { of: mediaAssets });
        const [binding] = await tx
          .select({ mediaAssetId: courseMediaAssets.mediaAssetId })
          .from(courseMediaAssets)
          .where(
            and(
              eq(courseMediaAssets.organizationId, user.organizationId),
              eq(courseMediaAssets.courseId, parsed.data.courseId),
              eq(courseMediaAssets.mediaAssetId, requestedCoverAssetId),
            ),
          )
          .limit(1);
        if (
          !asset ||
          asset.kind !== "image" ||
          asset.purpose !== "course_content" ||
          asset.status !== "ready" ||
          !canReadCourseMedia({
            role: user.role,
            uploadedByActor: asset.uploadedById === user.id,
            isBound: Boolean(binding),
            hasViewGrant: Boolean(binding),
          })
        ) {
          throw new ApiError(
            422,
            "validation_error",
            "invalid_course_cover_asset",
          );
        }
        await tx
          .insert(courseMediaAssets)
          .values({
            organizationId: user.organizationId,
            courseId: parsed.data.courseId,
            mediaAssetId: requestedCoverAssetId,
            attachedById: user.id,
          })
          .onConflictDoNothing();
        if (parsed.data.coverStockImageSelectionId) {
          await consumeStockImageSelection(tx, {
            organizationId: user.organizationId,
            courseId: parsed.data.courseId,
            selectionId: parsed.data.coverStockImageSelectionId,
          });
        }
      }
      const [course] = await tx
        .update(courses)
        .set({
          categoryId: parsed.data.categoryId,
          title: parsed.data.title,
          shortDescription: parsed.data.shortDescription,
          description: parsed.data.description,
          difficulty: parsed.data.difficulty,
          estimatedMinutes: parsed.data.estimatedMinutes,
          coverImage: safeCourseCoverSource(parsed.data.coverImage),
          certificateEnabled: parsed.data.certificateEnabled,
          featured: parsed.data.featured,
          visibleInCatalog: parsed.data.visibleInCatalog,
          showProgressPercentage: parsed.data.showProgressPercentage,
          notifyMembersOnModuleRelease:
            parsed.data.notifyMembersOnModuleRelease,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(courses.id, parsed.data.courseId),
            eq(courses.organizationId, user.organizationId),
          ),
        )
        .returning({ id: courses.id });
      if (!course) return null;
      await replaceCourseInformationCollections(tx, {
        organizationId: user.organizationId,
        courseId: course.id,
        learningGoals: parsed.data.learningGoals,
        authorIds: parsed.data.authorIds,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.information.updated",
        entityType: "course",
        entityId: course.id,
        metadata: {
          learningGoalCount: parsed.data.learningGoals.length,
          authorCount: parsed.data.authorIds.length,
          visibleInCatalog: parsed.data.visibleInCatalog,
          showProgressPercentage: parsed.data.showProgressPercentage,
          notifyMembersOnModuleRelease:
            parsed.data.notifyMembersOnModuleRelease,
          coverMediaAssetId: requestedCoverAssetId,
          stockImageSelectionId:
            requestedCoverAssetId && parsed.data.coverStockImageSelectionId
              ? parsed.data.coverStockImageSelectionId
              : null,
        },
      });
      return course;
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  if (!updated) return failure("course_builder.unavailable");
  revalidateCourse(courseId);
  revalidatePath("/academy/courses");
  revalidatePath("/academy/courses/[slug]", "page");
  return success("course_builder.information.saved", updated.id);
}

export async function createCourseModuleAction(
  courseId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      title: z.string().min(2).max(220),
      kind: z.enum(["learning", "exam", "link"]),
      linkedCourseId: idSchema.nullable(),
      description: z.string().max(5_000),
      folder: z.string().min(1).max(120),
      estimatedMinutes: z.coerce.number().int().min(1).max(100_000),
      isReusable: z.boolean(),
    })
    .safeParse({
      courseId,
      title: value(formData, "title"),
      kind: value(formData, "kind") || "learning",
      linkedCourseId: value(formData, "linkedCourseId") || null,
      description: value(formData, "description"),
      folder: value(formData, "folder") || "Allgemein",
      estimatedMinutes: formData.get("estimatedMinutes"),
      isReusable: formData.get("isReusable") === "on",
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (parsed.data.kind === "link" && !parsed.data.linkedCourseId) {
    return failure("course_builder.invalid_input");
  }
  if (parsed.data.kind !== "link" && parsed.data.linkedCourseId) {
    return failure("course_builder.invalid_input");
  }

  let created: {
    moduleId: string;
    sectionId?: string;
    lessonId?: string;
    pageId?: string;
  };
  try {
    created = await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      if (parsed.data.kind === "link" && parsed.data.linkedCourseId) {
        await requireLinkModuleTargetViewPermission(
          tx,
          user,
          courseId,
          parsed.data.linkedCourseId,
        );
      } else {
        await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      }
      const [course] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.id, parsed.data.courseId),
            eq(courses.organizationId, user.organizationId),
          ),
        )
        .limit(1);
      if (!course) {
        throw new ApiError(
          404,
          "not_found",
          "Dieser Kurs ist nicht verfuegbar.",
        );
      }
      if (parsed.data.kind === "link" && parsed.data.linkedCourseId) {
        await getCourseLinkTarget(tx, {
          organizationId: user.organizationId,
          sourceCourseId: course.id,
          targetCourseId: parsed.data.linkedCourseId,
          requirePublished: false,
        });
      }
      const [last] = await tx
        .select({ sortOrder: courseModules.sortOrder })
        .from(courseModules)
        .where(eq(courseModules.courseId, parsed.data.courseId))
        .orderBy(desc(courseModules.sortOrder))
        .limit(1);
      const createdStructure = await createModuleWithStructure(tx, {
        organizationId: user.organizationId,
        title: parsed.data.title,
        kind: parsed.data.kind,
        linkedCourseId: parsed.data.linkedCourseId,
        description: parsed.data.description || null,
        folder: parsed.data.folder,
        estimatedMinutes: parsed.data.estimatedMinutes,
        isReusable: parsed.data.isReusable,
        createLearningSection: true,
      });
      const createdModule = createdStructure.learningModule;
      await tx.insert(courseModules).values({
        organizationId: user.organizationId,
        courseId: parsed.data.courseId,
        moduleId: createdModule.id,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        indentLevel: 0,
        dripDays: 0,
        isRequired: parsed.data.kind !== "link",
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "module.created",
        entityType: "module",
        entityId: createdModule.id,
        metadata: {
          courseId: parsed.data.courseId,
          kind: parsed.data.kind,
          linkedCourseId: parsed.data.linkedCourseId,
        },
      });
      return {
        moduleId: createdModule.id,
        sectionId: createdStructure.section?.id,
        lessonId: createdStructure.lesson?.id,
        pageId: createdStructure.page?.id,
      };
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  revalidateCourse(courseId);
  return success(
    "course_builder.module.created",
    created.moduleId,
    created.sectionId,
    created.lessonId,
    created.pageId,
  );
}

export async function attachReusableModuleAction(
  courseId: string,
  moduleId: string,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({ courseId: idSchema, moduleId: idSchema })
    .safeParse({ courseId, moduleId });
  if (!parsed.success) return failure("course_builder.invalid_input");

  const attachedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`course-modules:${parsed.data.courseId}`}))`,
      );
      const [[course], [module], [existing], [last]] = await Promise.all([
        tx
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.id, parsed.data.courseId),
              eq(courses.organizationId, user.organizationId),
            ),
          )
          .limit(1),
        tx
          .select({
            id: modules.id,
            title: modules.title,
            kind: modules.kind,
            linkedCourseId: modules.linkedCourseId,
          })
          .from(modules)
          .where(
            and(
              eq(modules.id, parsed.data.moduleId),
              eq(modules.organizationId, user.organizationId),
              eq(modules.isReusable, true),
            ),
          )
          .limit(1),
        tx
          .select({ moduleId: courseModules.moduleId })
          .from(courseModules)
          .where(
            and(
              eq(courseModules.courseId, parsed.data.courseId),
              eq(courseModules.moduleId, parsed.data.moduleId),
            ),
          )
          .limit(1),
        tx
          .select({ sortOrder: courseModules.sortOrder })
          .from(courseModules)
          .where(eq(courseModules.courseId, parsed.data.courseId))
          .orderBy(desc(courseModules.sortOrder))
          .limit(1),
      ]);
      if (!course || !module) return "missing" as const;
      if (existing) return "duplicate" as const;
      if (module.kind === "link") {
        if (!module.linkedCourseId) return "missing" as const;
        await requireLinkModuleTargetViewPermission(
          tx,
          user,
          courseId,
          module.linkedCourseId,
        );
        await getCourseLinkTarget(tx, {
          organizationId: user.organizationId,
          sourceCourseId: course.id,
          targetCourseId: module.linkedCourseId,
          requirePublished: false,
        });
      } else {
        await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      }

      await tx.insert(courseModules).values({
        organizationId: user.organizationId,
        courseId: course.id,
        moduleId: module.id,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        indentLevel: 0,
        dripDays: 0,
        isRequired: module.kind !== "link",
      });
      if (module.kind !== "link") {
        const shared = await requireSharedModuleContentPermission(
          tx,
          user,
          course.id,
          { type: "module", id: module.id },
        );
        const moduleBlocks = await tx
          .select({
            id: contentBlocks.id,
            type: contentBlocks.type,
            data: contentBlocks.data,
          })
          .from(contentBlocks)
          .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
          .where(
            and(
              eq(lessons.organizationId, user.organizationId),
              eq(lessons.moduleId, module.id),
            ),
          )
          .orderBy(contentBlocks.id)
          .for("share", { of: contentBlocks });
        let references;
        try {
          references = collectCourseContentMediaReferences(moduleBlocks);
        } catch (error) {
          if (error instanceof CourseContentCopyReferenceError) {
            throw new ApiError(
              422,
              "validation_error",
              "Das wiederverwendbare Modul enthaelt ungueltige Medienverweise.",
            );
          }
          throw error;
        }
        await assertManageableSharedCourseMedia(tx, user, {
          referencedCourseIds: shared.referencedCourseIds,
          references,
        });
        await bindSharedCourseMedia(tx, user, {
          referencedCourseIds: shared.referencedCourseIds,
          mediaAssetIds: [...references.keys()],
        });
      }
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "module.attached",
        entityType: "module",
        entityId: module.id,
        metadata: { courseId: course.id, title: module.title },
      });
      const [examLesson] =
        module.kind === "exam"
          ? await tx
              .select({ id: lessons.id })
              .from(lessons)
              .where(eq(lessons.moduleId, module.id))
              .limit(1)
          : [];
      const [firstPage] = examLesson
        ? await tx
            .select({ id: lessonPages.id })
            .from(lessonPages)
            .where(eq(lessonPages.lessonId, examLesson.id))
            .orderBy(lessonPages.sortOrder, lessonPages.id)
            .limit(1)
        : [];
      return {
        status: "attached" as const,
        lessonId: examLesson?.id,
        pageId: firstPage?.id,
      };
    }),
  );
  if ("error" in attachedMutation) return failure(attachedMutation.error);
  const attached = attachedMutation.value;

  if (attached === "missing") {
    return failure("course_builder.unavailable");
  }
  if (attached === "duplicate") {
    return failure("course_builder.module.already_attached");
  }
  revalidateCourse(courseId);
  revalidatePath("/admin/modules");
  return success(
    "course_builder.module.attached",
    moduleId,
    undefined,
    typeof attached === "object" ? attached.lessonId : undefined,
    typeof attached === "object" ? attached.pageId : undefined,
  );
}

export async function updateCourseModuleOutlineAction(
  courseId: string,
  items: CourseOutlineItem[],
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      items: z.array(
        z.object({
          moduleId: idSchema,
          sortOrder: z.number().int().min(0).max(100_000),
          indentLevel: z.number().int().min(0).max(3),
        }),
      ),
    })
    .safeParse({ courseId, items });
  if (!parsed.success) return failure("course_builder.invalid_input");
  try {
    await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const outline = await replaceCourseOutline(tx, {
        organizationId: user.organizationId,
        courseId: parsed.data.courseId,
        items: parsed.data.items,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.module.outline.updated",
        entityType: "course",
        entityId: parsed.data.courseId,
        metadata: { moduleCount: outline.length },
      });
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  revalidateCourse(courseId);
  return success("course_builder.outline.saved");
}

export async function updateCourseLinkModuleAction(
  courseId: string,
  moduleId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      moduleId: idSchema,
      title: z.string().trim().min(2).max(220),
      description: z.string().trim().max(5_000),
      linkedCourseId: idSchema,
    })
    .safeParse({
      courseId,
      moduleId,
      title: value(formData, "title"),
      description: value(formData, "description"),
      linkedCourseId: value(formData, "linkedCourseId"),
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  try {
    await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireSharedModuleContentPermission(
        tx,
        user,
        courseId,
        { type: "module", id: parsed.data.moduleId },
        [{ courseId: parsed.data.linkedCourseId, required: "view" }],
      );
      const [current] = await tx
        .select({ id: modules.id, kind: modules.kind })
        .from(modules)
        .innerJoin(
          courseModules,
          and(
            eq(courseModules.moduleId, modules.id),
            eq(courseModules.organizationId, modules.organizationId),
            eq(courseModules.courseId, parsed.data.courseId),
          ),
        )
        .where(
          and(
            eq(modules.id, parsed.data.moduleId),
            eq(modules.organizationId, user.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current || current.kind !== "link") {
        throw new ApiError(404, "not_found", "Link-Modul nicht gefunden.");
      }
      await getCourseLinkTarget(tx, {
        organizationId: user.organizationId,
        sourceCourseId: parsed.data.courseId,
        targetCourseId: parsed.data.linkedCourseId,
        requirePublished: false,
      });
      await tx
        .update(modules)
        .set({
          title: parsed.data.title,
          description: parsed.data.description || null,
          linkedCourseId: parsed.data.linkedCourseId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(modules.id, parsed.data.moduleId),
            eq(modules.organizationId, user.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.link_module.updated",
        entityType: "module",
        entityId: parsed.data.moduleId,
        metadata: {
          courseId: parsed.data.courseId,
          linkedCourseId: parsed.data.linkedCourseId,
        },
      });
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : null;
    if (code === "23514") {
      return failure("course_builder.conflict");
    }
    throw error;
  }
  revalidateCourse(courseId);
  return success("course_builder.link.saved", moduleId);
}

export async function detachCourseModuleAction(
  courseId: string,
  moduleId: string,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({ courseId: idSchema, moduleId: idSchema })
    .safeParse({ courseId, moduleId });
  if (!parsed.success) return failure("course_builder.invalid_input");
  try {
    await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const [assignment] = await tx
        .select({ moduleId: courseModules.moduleId })
        .from(courseModules)
        .where(
          and(
            eq(courseModules.organizationId, user.organizationId),
            eq(courseModules.courseId, parsed.data.courseId),
            eq(courseModules.moduleId, parsed.data.moduleId),
          ),
        )
        .limit(1)
        .for("update");
      if (!assignment) {
        throw new ApiError(404, "not_found", "Modul nicht gefunden.");
      }
      await tx
        .delete(courseModules)
        .where(
          and(
            eq(courseModules.organizationId, user.organizationId),
            eq(courseModules.courseId, parsed.data.courseId),
            eq(courseModules.moduleId, parsed.data.moduleId),
          ),
        );
      await normalizeCourseOutline(tx, {
        organizationId: user.organizationId,
        courseId: parsed.data.courseId,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.module.detached",
        entityType: "module",
        entityId: parsed.data.moduleId,
        metadata: { courseId: parsed.data.courseId },
      });
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  revalidateCourse(courseId);
  return success("course_builder.module.detached", moduleId);
}

export async function createModuleSectionAction(
  courseId: string,
  moduleId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      moduleId: idSchema,
      title: z.string().min(2).max(220),
      description: z.string().max(3_000),
    })
    .safeParse({
      courseId,
      moduleId,
      title: value(formData, "title"),
      description: value(formData, "description"),
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await moduleInCourse(
      parsed.data.courseId,
      parsed.data.moduleId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  const sectionMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "module",
        id: parsed.data.moduleId,
      });
      await assertLearningModuleStructureMutation(tx, {
        organizationId: user.organizationId,
        moduleId: parsed.data.moduleId,
      });
      const [last] = await tx
        .select({ sortOrder: moduleSections.sortOrder })
        .from(moduleSections)
        .where(eq(moduleSections.moduleId, parsed.data.moduleId))
        .orderBy(desc(moduleSections.sortOrder))
        .limit(1);
      const [createdSection] = await tx
        .insert(moduleSections)
        .values({
          organizationId: user.organizationId,
          moduleId: parsed.data.moduleId,
          title: parsed.data.title,
          description: parsed.data.description || null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        })
        .returning({ id: moduleSections.id });
      return createdSection;
    }),
  );
  if ("error" in sectionMutation) return failure(sectionMutation.error);
  const section = sectionMutation.value;
  revalidateCourse(courseId);
  return success("course_builder.section.created", section.id);
}

export async function createModuleLessonAction(
  courseId: string,
  moduleId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      moduleId: idSchema,
      sectionId: idSchema.nullable(),
      title: z.string().min(2).max(220),
      summary: z.string().max(3_000),
      type: lessonTypeSchema,
      durationMinutes: z.coerce.number().int().min(1).max(100_000),
    })
    .safeParse({
      courseId,
      moduleId,
      sectionId: value(formData, "sectionId") || null,
      title: value(formData, "title"),
      summary: value(formData, "summary"),
      type: value(formData, "type"),
      durationMinutes: formData.get("durationMinutes"),
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await moduleInCourse(
      parsed.data.courseId,
      parsed.data.moduleId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  let lesson: { id: string };
  try {
    lesson = await db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "module",
        id: parsed.data.moduleId,
      });
      await assertLearningModuleStructureMutation(tx, {
        organizationId: user.organizationId,
        moduleId: parsed.data.moduleId,
      });
      if (parsed.data.sectionId) {
        const [section] = await tx
          .select({ id: moduleSections.id })
          .from(moduleSections)
          .where(
            and(
              eq(moduleSections.id, parsed.data.sectionId),
              eq(moduleSections.moduleId, parsed.data.moduleId),
            ),
          )
          .limit(1);
        if (!section) {
          throw new ApiError(
            422,
            "validation_error",
            "Diese Sektion gehoert nicht zum Modul.",
          );
        }
      }
      const [last] = await tx
        .select({ sortOrder: lessons.sortOrder })
        .from(lessons)
        .where(eq(lessons.moduleId, parsed.data.moduleId))
        .orderBy(desc(lessons.sortOrder))
        .limit(1);
      const [createdLesson] = await tx
        .insert(lessons)
        .values({
          organizationId: user.organizationId,
          moduleId: parsed.data.moduleId,
          sectionId: parsed.data.sectionId,
          title: parsed.data.title,
          slug: uniqueSlug(parsed.data.title),
          summary: parsed.data.summary || null,
          type: parsed.data.type,
          durationMinutes: parsed.data.durationMinutes,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          status: "published",
        })
        .returning({ id: lessons.id });
      return createdLesson;
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  revalidateCourse(courseId);
  return success("course_builder.lesson.created", lesson.id);
}

export async function copyCourseLessonAction(
  sourceCourseId: string,
  sourceLessonId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(sourceCourseId, "edit");
  const locale = normalizeLocale(await resolveUserLocale(user));
  const parsed = z
    .object({
      sourceCourseId: idSchema,
      sourceLessonId: idSchema,
      targetCourseId: idSchema,
      targetModuleId: idSchema,
      targetSectionId: idSchema.nullable(),
    })
    .safeParse({
      sourceCourseId,
      sourceLessonId,
      targetCourseId: value(formData, "targetCourseId"),
      targetModuleId: value(formData, "targetModuleId"),
      targetSectionId: value(formData, "targetSectionId") || null,
    });
  if (!parsed.success) {
    return courseContentCopyFailure("course_content_copy.invalid_input");
  }

  try {
    const copied = await db.transaction(async (tx) => {
      const shared = await requireSharedModuleContentPermission(
        tx,
        user,
        parsed.data.targetCourseId,
        { type: "module", id: parsed.data.targetModuleId },
        [{ courseId: parsed.data.sourceCourseId, required: "edit" }],
      );
      const result = await copyLessonToCourseTarget(tx, {
        organizationId: user.organizationId,
        attachedById: user.id,
        locale,
        sourceCourseId: parsed.data.sourceCourseId,
        sourceLessonId: parsed.data.sourceLessonId,
        targetCourseId: parsed.data.targetCourseId,
        targetCourseIds: shared.referencedCourseIds,
        targetModuleId: parsed.data.targetModuleId,
        targetSectionId: parsed.data.targetSectionId,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.lesson.copied",
        entityType: "lesson",
        entityId: result.lessonId,
        metadata: {
          sourceCourseId: parsed.data.sourceCourseId,
          sourceLessonId: parsed.data.sourceLessonId,
          targetCourseId: parsed.data.targetCourseId,
          targetCourseIds: shared.referencedCourseIds,
          targetModuleId: parsed.data.targetModuleId,
          targetSectionId: parsed.data.targetSectionId,
          pageCount: result.pageCount,
          blockCount: result.blockCount,
        },
      });
      return { ...result, targetCourseIds: shared.referencedCourseIds };
    });
    revalidateCourse(parsed.data.sourceCourseId);
    for (const targetCourseId of copied.targetCourseIds) {
      revalidateCourse(targetCourseId);
    }
    const code = "course_content_copy.lesson_copied" as const;
    return {
      ok: true,
      code,
      id: copied.lessonId,
      secondaryId: parsed.data.targetModuleId,
      pageId: copied.pageId,
    };
  } catch (error) {
    return courseContentCopyFailureFromError(error);
  }
}

export async function copyCourseSectionAction(
  sourceCourseId: string,
  sourceSectionId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(sourceCourseId, "edit");
  const locale = normalizeLocale(await resolveUserLocale(user));
  const parsed = z
    .object({
      sourceCourseId: idSchema,
      sourceSectionId: idSchema,
      targetCourseId: idSchema,
      targetModuleId: idSchema,
    })
    .safeParse({
      sourceCourseId,
      sourceSectionId,
      targetCourseId: value(formData, "targetCourseId"),
      targetModuleId: value(formData, "targetModuleId"),
    });
  if (!parsed.success) {
    return courseContentCopyFailure("course_content_copy.invalid_input");
  }

  try {
    const copied = await db.transaction(async (tx) => {
      const shared = await requireSharedModuleContentPermission(
        tx,
        user,
        parsed.data.targetCourseId,
        { type: "module", id: parsed.data.targetModuleId },
        [{ courseId: parsed.data.sourceCourseId, required: "edit" }],
      );
      const result = await copySectionToCourseTarget(tx, {
        organizationId: user.organizationId,
        attachedById: user.id,
        locale,
        sourceCourseId: parsed.data.sourceCourseId,
        sourceSectionId: parsed.data.sourceSectionId,
        targetCourseId: parsed.data.targetCourseId,
        targetCourseIds: shared.referencedCourseIds,
        targetModuleId: parsed.data.targetModuleId,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.section.copied",
        entityType: "section",
        entityId: result.sectionId,
        metadata: {
          sourceCourseId: parsed.data.sourceCourseId,
          sourceSectionId: parsed.data.sourceSectionId,
          targetCourseId: parsed.data.targetCourseId,
          targetCourseIds: shared.referencedCourseIds,
          targetModuleId: parsed.data.targetModuleId,
          lessonCount: result.lessonCount,
          pageCount: result.pageCount,
          blockCount: result.blockCount,
        },
      });
      return { ...result, targetCourseIds: shared.referencedCourseIds };
    });
    revalidateCourse(parsed.data.sourceCourseId);
    for (const targetCourseId of copied.targetCourseIds) {
      revalidateCourse(targetCourseId);
    }
    const code = "course_content_copy.section_copied" as const;
    return {
      ok: true,
      code,
      id: copied.sectionId,
      secondaryId: parsed.data.targetModuleId,
      lessonId: copied.firstLessonId,
    };
  } catch (error) {
    return courseContentCopyFailureFromError(error);
  }
}

export async function createLessonPageAction(
  courseId: string,
  lessonId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      title: z.string().min(2).max(220),
      titleSyncedWithLesson: z.boolean().optional(),
    })
    .safeParse({
      courseId,
      lessonId,
      title: value(formData, "title"),
      titleSyncedWithLesson: formData.has("titleSyncedWithLesson")
        ? formData.getAll("titleSyncedWithLesson").at(-1) === "true"
        : undefined,
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  const pageMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      const created = await createLessonPageWithTitleSync(tx, {
        organizationId: user.organizationId,
        lessonId: parsed.data.lessonId,
        page: {
          title: parsed.data.title,
          titleSyncedWithLesson: parsed.data.titleSyncedWithLesson,
          slug: uniqueSlug(parsed.data.title),
          status: "published",
        },
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "lesson.page.created",
        entityType: "page",
        entityId: created.id,
        metadata: {
          courseId: parsed.data.courseId,
          lessonId: parsed.data.lessonId,
          titleSyncedWithLesson: created.titleSyncedWithLesson,
        },
      });
      return created;
    }),
  );
  if ("error" in pageMutation) return failure(pageMutation.error);
  const page = pageMutation.value;
  revalidateCourse(courseId);
  return success("course_builder.page.created", page.id);
}

export async function updateCourseLessonTitleAction(
  courseId: string,
  lessonId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      title: z.string().min(2).max(220),
    })
    .safeParse({ courseId, lessonId, title: value(formData, "title") });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  const lessonMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      const updated = await updateLessonWithTitleSync(tx, {
        organizationId: user.organizationId,
        lessonId: parsed.data.lessonId,
        lesson: { title: parsed.data.title },
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "lesson.title.updated",
        entityType: "lesson",
        entityId: updated.id,
        metadata: { courseId: parsed.data.courseId },
      });
      return updated;
    }),
  );
  if ("error" in lessonMutation) return failure(lessonMutation.error);
  const lesson = lessonMutation.value;
  revalidateCourse(courseId);
  return success("course_builder.lesson.title_saved", lesson.id);
}

export async function updateLessonPageTitleAction(
  courseId: string,
  lessonId: string,
  pageId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      pageId: idSchema,
      title: z.string().min(2).max(220),
      titleSyncedWithLesson: z.boolean(),
      revision: z.coerce.number().int().min(1),
      layoutWidth: pageStyleSchema.shape.layoutWidth,
      backgroundTone: pageStyleSchema.shape.backgroundTone,
      contentSpacing: pageStyleSchema.shape.contentSpacing,
    })
    .safeParse({
      courseId,
      lessonId,
      pageId,
      title: value(formData, "title"),
      titleSyncedWithLesson:
        formData.get("titleSyncedWithLesson") === "true" ||
        formData.get("titleSyncedWithLesson") === "on",
      revision: formData.get("revision"),
      layoutWidth: value(formData, "layoutWidth"),
      backgroundTone: value(formData, "backgroundTone"),
      contentSpacing: value(formData, "contentSpacing"),
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await pageInLesson(
      parsed.data.courseId,
      parsed.data.lessonId,
      parsed.data.pageId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  try {
    const page = await db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "page",
        id: parsed.data.pageId,
      });
      const updated = await updateLessonPageWithTitleSync(tx, {
        organizationId: user.organizationId,
        pageId: parsed.data.pageId,
        page: {
          title: parsed.data.title,
          titleSyncedWithLesson: parsed.data.titleSyncedWithLesson,
          layoutWidth: parsed.data.layoutWidth,
          backgroundTone: parsed.data.backgroundTone,
          contentSpacing: parsed.data.contentSpacing,
        },
        expectedRevision: parsed.data.revision,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "lesson.page_title.updated",
        entityType: "page",
        entityId: updated.id,
        metadata: {
          courseId: parsed.data.courseId,
          lessonId: parsed.data.lessonId,
          titleSyncedWithLesson: updated.titleSyncedWithLesson,
        },
      });
      return updated;
    });
    revalidateCourse(courseId);
    return success("course_builder.page.title_saved", page.id);
  } catch (error) {
    if (error instanceof ApiError) {
      const details =
        error.details && typeof error.details === "object"
          ? (error.details as {
              resourceId?: string;
              expectedRevision?: number;
              currentRevision?: number;
            })
          : null;
      if (error.status === 409 && details?.resourceId) {
        return revisionFailure(
          details.resourceId,
          details.expectedRevision ?? parsed.data.revision,
          details.currentRevision,
        );
      }
      return failure(courseBuilderErrorCode(error));
    }
    throw error;
  }
}

export async function commandLessonPageAction(
  courseId: string,
  lessonId: string,
  pageId: string,
  command: "move_up" | "move_down" | "duplicate" | "toggle_hidden",
  expectedRevision: number,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const ids = z
    .object({ courseId: idSchema, lessonId: idSchema, pageId: idSchema })
    .safeParse({ courseId, lessonId, pageId });
  const parsedCommand = lessonPageCommandSchema.safeParse({
    command,
    revision: expectedRevision,
  });
  if (!ids.success || !parsedCommand.success) {
    return failure("course_builder.invalid_input");
  }
  if (
    !(await pageInLesson(
      ids.data.courseId,
      ids.data.lessonId,
      ids.data.pageId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  try {
    const result = await db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "page",
        id: ids.data.pageId,
      });
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`lesson-page-title-sync:${ids.data.lessonId}`}, 0)
        )
      `);
      const pages = await tx
        .select()
        .from(lessonPages)
        .where(eq(lessonPages.lessonId, ids.data.lessonId))
        .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id))
        .for("update");
      const index = pages.findIndex((page) => page.id === ids.data.pageId);
      const current = pages[index];
      if (!current)
        throw new ApiError(404, "not_found", "Seite nicht gefunden.");
      if (current.revision !== parsedCommand.data.revision) {
        throw new ApiError(
          409,
          "conflict",
          "Die Seite wurde zwischenzeitlich geaendert.",
          {
            resourceId: current.id,
            expectedRevision: parsedCommand.data.revision,
            currentRevision: current.revision,
          },
        );
      }
      if (parsedCommand.data.command === "duplicate") {
        const [created] = await tx
          .insert(lessonPages)
          .values({
            lessonId: current.lessonId,
            title: `${current.title} (Kopie)`.slice(0, 220),
            titleSyncedWithLesson: false,
            slug: uniqueSlug(`${current.title}-kopie`),
            sortOrder:
              pages.reduce(
                (maximum, page) => Math.max(maximum, page.sortOrder),
                -1,
              ) + 1,
            status: "draft",
            layoutWidth: current.layoutWidth,
            backgroundTone: current.backgroundTone,
            contentSpacing: current.contentSpacing,
          })
          .returning();
        const sourceBlocks = await tx
          .select()
          .from(contentBlocks)
          .where(eq(contentBlocks.pageId, current.id))
          .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id));
        if (sourceBlocks.length) {
          const copiedBlocks = await tx
            .insert(contentBlocks)
            .values(
              sourceBlocks.map((block) => ({
                lessonId: block.lessonId,
                pageId: created.id,
                type: block.type,
                title: block.title,
                sortOrder: block.sortOrder,
                required: block.required,
                data: courseContentDataForCopy(block.type, block.data),
                style: block.style,
              })),
            )
            .returning({
              id: contentBlocks.id,
              type: contentBlocks.type,
              data: contentBlocks.data,
              revision: contentBlocks.revision,
            });
          await enqueueCopiedVideoDescriptionJobsInTransaction(tx, {
            organizationId: user.organizationId,
            originCourseId: ids.data.courseId,
            requestedById: user.id,
            blocks: copiedBlocks,
            locale: normalizeLocale(await resolveUserLocale(user, tx)),
          });
        }
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "lesson.page.duplicated",
          entityType: "page",
          entityId: created.id,
          metadata: { courseId, lessonId, sourcePageId: current.id },
        });
        return {
          id: created.id,
          code: "course_builder.page.duplicated" as const,
        };
      }
      if (parsedCommand.data.command === "toggle_hidden") {
        const [updated] = await tx
          .update(lessonPages)
          .set({
            status: current.status === "published" ? "draft" : "published",
            revision: sql`${lessonPages.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(lessonPages.id, current.id),
              eq(lessonPages.revision, parsedCommand.data.revision),
            ),
          )
          .returning();
        if (!updated)
          throw new ApiError(
            409,
            "conflict",
            "Die Seite wurde zwischenzeitlich geaendert.",
            {
              resourceId: current.id,
              expectedRevision: parsedCommand.data.revision,
              currentRevision: current.revision,
            },
          );
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "lesson.page.visibility.updated",
          entityType: "page",
          entityId: current.id,
          metadata: { courseId, lessonId, status: updated.status },
        });
        return {
          id: current.id,
          code: "course_builder.page.visibility_saved" as const,
        };
      }
      const offset = parsedCommand.data.command === "move_up" ? -1 : 1;
      const neighbor = pages[index + offset];
      if (!neighbor) {
        return {
          id: current.id,
          code: "course_builder.page.edge_reached" as const,
        };
      }
      const reordered = [...pages];
      reordered[index] = neighbor;
      reordered[index + offset] = current;
      if (pages[0]?.titleSyncedWithLesson && reordered[0]?.id !== pages[0].id) {
        throw new ApiError(
          422,
          "validation_error",
          "Loese zuerst die Titelsynchronisierung der ersten Seite.",
        );
      }
      const now = new Date();
      const [updated] = await tx
        .update(lessonPages)
        .set({
          sortOrder: neighbor.sortOrder,
          revision: sql`${lessonPages.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(lessonPages.id, current.id),
            eq(lessonPages.revision, parsedCommand.data.revision),
          ),
        )
        .returning();
      if (!updated)
        throw new ApiError(
          409,
          "conflict",
          "Die Seite wurde zwischenzeitlich geaendert.",
          {
            resourceId: current.id,
            expectedRevision: parsedCommand.data.revision,
            currentRevision: current.revision,
          },
        );
      await tx
        .update(lessonPages)
        .set({
          sortOrder: current.sortOrder,
          revision: sql`${lessonPages.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(lessonPages.id, neighbor.id));
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "lesson.page.moved",
        entityType: "page",
        entityId: current.id,
        metadata: { courseId, lessonId, direction: parsedCommand.data.command },
      });
      return { id: current.id, code: "course_builder.page.moved" as const };
    });
    revalidateCourse(courseId);
    return success(result.code, result.id, undefined, lessonId, result.id);
  } catch (error) {
    if (error instanceof ApiError) {
      const details =
        error.details && typeof error.details === "object"
          ? (error.details as {
              resourceId?: string;
              expectedRevision?: number;
              currentRevision?: number;
            })
          : null;
      if (error.status === 409 && details?.resourceId) {
        return revisionFailure(
          details.resourceId,
          details.expectedRevision ?? expectedRevision,
          details.currentRevision,
        );
      }
      return failure(courseBuilderErrorCode(error));
    }
    throw error;
  }
}

export async function addCourseContentBlockAction(
  courseId: string,
  lessonId: string,
  pageId: string | null,
  type: string,
  agentId?: string,
  requestedLocale?: AppLocale,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const locale = normalizeLocale(
    requestedLocale,
    await resolveUserLocale(user),
  );
  const structuredCopy = getCourseParityCopy(locale).structured;
  const contentDefaults = getCourseContentDefaults(locale);
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      pageId: idSchema.nullable(),
      type: contentTypeSchema,
      agentId: idSchema.nullable(),
    })
    .safeParse({ courseId, lessonId, pageId, type, agentId: agentId ?? null });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if ((parsed.data.type === "ai_agent") !== Boolean(parsed.data.agentId)) {
    return failure("course_builder.block.agent_required");
  }
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  if (
    parsed.data.pageId &&
    !(await pageInLesson(
      parsed.data.courseId,
      parsed.data.lessonId,
      parsed.data.pageId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }

  const defaults: Record<
    z.infer<typeof contentTypeSchema>,
    { title: string | null; required: boolean; data: ContentBlockData }
  > = {
    ai_agent: {
      title: contentDefaults.aiAgentTitle,
      required: false,
      data: { agentId: parsed.data.agentId! },
    },
    heading: {
      title: null,
      required: false,
      data: { text: contentDefaults.headingText },
    },
    text: {
      title: null,
      required: false,
      data: { text: contentDefaults.paragraph },
    },
    rich_text: {
      title: contentDefaults.richTextTitle,
      required: false,
      data: {
        richText: createRichTextDocument(contentDefaults.paragraph),
      },
    },
    button: {
      title: contentDefaults.buttonLabel,
      required: false,
      data: {
        button: createLinkButtonDocument(
          contentDefaults.buttonLabel,
          "/academy/courses",
          "primary",
        )!,
      },
    },
    gallery: {
      title: contentDefaults.galleryTitle,
      required: false,
      data: { gallery: createEmptyGalleryDocument() },
    },
    callout: {
      title: structuredCopy.tones.info,
      required: false,
      data: {
        callout: defaultStructuredDocument(
          "callout",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").CalloutDocument,
      },
    },
    quote: {
      title: structuredCopy.quote,
      required: false,
      data: {
        quote: defaultStructuredDocument(
          "quote",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").QuoteDocument,
      },
    },
    divider: {
      title: null,
      required: false,
      data: {
        divider: defaultStructuredDocument(
          "divider",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").DividerDocument,
      },
    },
    accordion: {
      title: structuredCopy.item,
      required: false,
      data: {
        accordion: defaultStructuredDocument(
          "accordion",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").AccordionDocument,
      },
    },
    tabs: {
      title: structuredCopy.newTabLabel(1),
      required: false,
      data: {
        tabs: defaultStructuredDocument(
          "tabs",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").TabsDocument,
      },
    },
    columns: {
      title: structuredCopy.newColumnHeading(1),
      required: false,
      data: {
        columns: defaultStructuredDocument(
          "columns",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").ColumnsDocument,
      },
    },
    code: {
      title: structuredCopy.code,
      required: false,
      data: {
        code: defaultStructuredDocument(
          "code",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").CodeDocument,
      },
    },
    table: {
      title: structuredCopy.defaultTableCaption,
      required: false,
      data: {
        table: defaultStructuredDocument(
          "table",
          locale,
        )! as import("@/lib/content-blocks/layout-documents").TableDocument,
      },
    },
    download: {
      title: contentDefaults.downloadTitle,
      required: false,
      data: {},
    },
    data_form: {
      title: contentDefaults.formTitle,
      required: false,
      data: {},
    },
    info: {
      title: contentDefaults.infoTitle,
      required: false,
      data: { text: contentDefaults.infoBody, accent: "teal" },
    },
    checklist: {
      title: contentDefaults.checklistTitle,
      required: true,
      data: { items: contentDefaults.checklistItems },
    },
    image: {
      title: contentDefaults.imageTitle,
      required: false,
      data: { caption: contentDefaults.imageCaption },
    },
    video: {
      title: contentDefaults.videoTitle,
      required: false,
      data: {},
    },
    audio: {
      title: contentDefaults.audioTitle,
      required: false,
      data: {},
    },
    file: {
      title: contentDefaults.fileTitle,
      required: false,
      data: { fileName: contentDefaults.fileName },
    },
    embed: {
      title: contentDefaults.embedTitle,
      required: false,
      data: {},
    },
    multiple_choice: {
      title: contentDefaults.multipleChoice.title,
      required: true,
      data: {
        prompt: contentDefaults.multipleChoice.prompt,
        options: contentDefaults.multipleChoice.options,
        correctOption: 0,
      },
    },
    true_false: {
      title: contentDefaults.trueFalse.title,
      required: true,
      data: {
        prompt: contentDefaults.trueFalse.prompt,
        options: contentDefaults.trueFalse.options,
        correctOption: 0,
      },
    },
    multi_select: {
      title: contentDefaults.multiSelect.title,
      required: true,
      data: {
        prompt: contentDefaults.multiSelect.prompt,
        options: contentDefaults.multiSelect.options,
        correctOptions: [0, 1],
      },
    },
    fill_blank: {
      title: contentDefaults.fillBlank.title,
      required: true,
      data: {
        prompt: contentDefaults.fillBlank.prompt,
        acceptedAnswers: [contentDefaults.fillBlank.answer],
        caseSensitive: false,
      },
    },
    ordering: {
      title: contentDefaults.ordering.title,
      required: true,
      data: {
        prompt: contentDefaults.ordering.prompt,
        options: contentDefaults.ordering.options,
      },
    },
    submission: {
      title: contentDefaults.submission.title,
      required: true,
      data: {
        prompt: contentDefaults.submission.prompt,
      },
    },
  };
  const targetCondition = parsed.data.pageId
    ? eq(contentBlocks.pageId, parsed.data.pageId)
    : isNull(contentBlocks.pageId);
  const block = defaults[parsed.data.type];
  const createdMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      const embeddedAgent = await assertPublishedAiAgentContentBlock({
        transaction: tx,
        organizationId: user.organizationId,
        type: parsed.data.type,
        data: block.data,
      });
      if (block.data.formId) {
        await lockCourseContentBlocksForMutation(tx);
        if (
          !(await lockActiveCourseDataForms(tx, user.organizationId, [
            { type: parsed.data.type, data: block.data },
          ]))
        ) {
          return null;
        }
      }
      const [last] = await tx
        .select({ sortOrder: contentBlocks.sortOrder })
        .from(contentBlocks)
        .where(
          and(
            eq(contentBlocks.lessonId, parsed.data.lessonId),
            targetCondition,
          ),
        )
        .orderBy(desc(contentBlocks.sortOrder))
        .limit(1);
      const [record] = await tx
        .insert(contentBlocks)
        .values({
          lessonId: parsed.data.lessonId,
          pageId: parsed.data.pageId,
          type: parsed.data.type,
          title: embeddedAgent?.name ?? block.title,
          required: block.required,
          data: block.data,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        })
        .returning({ id: contentBlocks.id });
      return record;
    }),
  );
  if ("error" in createdMutation) return failure(createdMutation.error);
  const created = createdMutation.value;
  if (!created) {
    return failure("course_builder.block.data_form_unavailable");
  }
  revalidateCourse(courseId);
  return success("course_builder.block.created", created.id);
}

export async function updateCourseContentBlockAction(
  courseId: string,
  blockId: string,
  expectedRevision: number,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(user),
  );
  const ids = z
    .object({
      courseId: idSchema,
      blockId: idSchema,
      expectedRevision: z.number().int().min(1),
    })
    .safeParse({ courseId, blockId, expectedRevision });
  if (!ids.success) return failure("course_builder.invalid_input");
  const block = await blockInCourse(
    ids.data.courseId,
    ids.data.blockId,
    user.organizationId,
  );
  if (!block) return failure("course_builder.unavailable");
  if (block.revision !== ids.data.expectedRevision) {
    return revisionFailure(block.id, ids.data.expectedRevision, block.revision);
  }
  const parsedType = editableContentTypeSchema.safeParse(block.type);
  if (!parsedType.success)
    return failure("course_builder.block.type_uneditable");
  const parsed = parseBlockForm(parsedType.data, formData, locale);
  if ("error" in parsed) return failure("course_builder.invalid_input");
  const style = contentBlockStyleSchema.safeParse({
    width: value(formData, "style.width"),
    alignment: value(formData, "style.alignment"),
    surface: value(formData, "style.surface"),
  });
  if (!style.success) return failure("course_builder.invalid_input");
  const savedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      const shared = await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "block",
        id: block.id,
      });
      const referencedCourseIds = shared.referencedCourseIds;
      const [lockedBlock] = await tx
        .select({ revision: contentBlocks.revision })
        .from(contentBlocks)
        .where(
          and(
            eq(contentBlocks.id, block.id),
            eq(contentBlocks.lessonId, block.lessonId),
          ),
        )
        .limit(1)
        .for("update");
      if (!lockedBlock || lockedBlock.revision !== ids.data.expectedRevision) {
        return "conflict" as const;
      }
      let data: ContentBlockData = parsed.data;
      let videoDescriptionAsset: {
        id: string;
        contentSha256: string;
      } | null = null;
      const stockImageSelectionId =
        "stockImageSelectionId" in parsed
          ? parsed.stockImageSelectionId
          : undefined;
      if (block.type === "image" && stockImageSelectionId) {
        const selection = await consumeStockImageSelection(tx, {
          organizationId: user.organizationId,
          courseId: ids.data.courseId,
          selectionId: stockImageSelectionId,
        });
        data = {
          ...data,
          imageUrl: selection.imageUrl,
          stockImage: {
            selectionId: selection.id,
            provider: selection.provider,
            externalId: selection.externalId,
            author: selection.author,
            ...(selection.authorUrl ? { authorUrl: selection.authorUrl } : {}),
            sourceUrl: selection.sourceUrl,
            attribution: selection.attribution,
          },
        };
      } else if (
        block.type === "image" &&
        block.data.stockImage &&
        data.imageUrl === block.data.imageUrl
      ) {
        data = { ...data, stockImage: block.data.stockImage };
      }
      const embeddedAgent = await assertPublishedAiAgentContentBlock({
        transaction: tx,
        organizationId: user.organizationId,
        type: block.type,
        data,
      });
      if (block.type === "data_form") {
        await lockCourseContentBlocksForMutation(tx);
        if (
          !(await lockActiveCourseDataForms(tx, user.organizationId, [
            { type: block.type, data },
          ]))
        ) {
          return "invalid" as const;
        }
      }
      const galleryDraft =
        "galleryDraft" in parsed ? parsed.galleryDraft : undefined;
      if (galleryDraft) {
        const assetIds = galleryDraft.items.flatMap((item) =>
          item.mediaAssetId ? [item.mediaAssetId] : [],
        );
        if (new Set(assetIds).size !== assetIds.length)
          return "invalid" as const;
        const assetsById = await assertManageableSharedCourseMedia(tx, user, {
          referencedCourseIds,
          references: new Map(
            assetIds.map((assetId) => [assetId, "image"] as const),
          ),
        });
        const gallery = sanitizeGalleryDocument({
          version: 1,
          layout: galleryDraft.layout,
          items: galleryDraft.items.map((item) => {
            const asset = item.mediaAssetId
              ? assetsById.get(item.mediaAssetId)
              : null;
            return {
              source: asset
                ? `/api/media-assets/${asset.id}/download`
                : item.source,
              alt: item.alt,
              caption: item.caption,
              ...(asset
                ? {
                    mediaAssetId: asset.id,
                    mediaAssetName: asset.originalFileName,
                  }
                : {}),
            };
          }),
        });
        if (
          !galleryDocumentHasContent(gallery) ||
          gallery.items.length !== galleryDraft.items.length
        ) {
          return "invalid" as const;
        }
        data = { gallery };
        await bindSharedCourseMedia(tx, user, {
          referencedCourseIds,
          mediaAssetIds: assetIds,
        });
      } else {
        const mediaAssetId = data.mediaAssetId ?? data.download?.mediaAssetId;
        if (mediaAssetId) {
          const expectedKind: SharedCourseMediaKind | null =
            block.type === "file" || block.type === "download"
              ? "document"
              : block.type === "image" ||
                  block.type === "video" ||
                  block.type === "audio"
                ? block.type
                : null;
          if (!expectedKind) return "invalid" as const;
          const poster =
            block.type === "video" && data.videoPoster
              ? (data.videoPoster as VideoPoster)
              : null;
          const compositionAssetIds =
            block.type === "video" && data.videoComposition
              ? [
                  ...new Set(
                    data.videoComposition.audioTracks.map(
                      (track) => track.mediaAssetId,
                    ),
                  ),
                ]
              : [];
          const mediaReferences = new Map<string, SharedCourseMediaKind>([
            [mediaAssetId, expectedKind],
            ...compositionAssetIds.map(
              (compositionAssetId) =>
                [compositionAssetId, "audio"] as const,
            ),
            ...(poster?.source === "upload"
              ? ([[poster.mediaAssetId, "image"]] as const)
              : []),
          ]);
          const manageableAssets = await assertManageableSharedCourseMedia(
            tx,
            user,
            { referencedCourseIds, references: mediaReferences },
          );
          const asset = manageableAssets.get(mediaAssetId);
          if (!asset) return "invalid" as const;
          if (
            block.type === "video" &&
            asset.contentSha256 &&
            /^[0-9a-f]{64}$/.test(asset.contentSha256)
          ) {
            videoDescriptionAsset = {
              id: asset.id,
              contentSha256: asset.contentSha256,
            };
          }
          if (
            block.type === "video" &&
            data.transcript &&
            (!asset.durationMilliseconds ||
              data.transcript.segments.some(
                (segment) => segment.endMs > asset.durationMilliseconds!,
              ))
          ) {
            return "invalid" as const;
          }
          if (block.type === "video" && data.videoPlayback) {
            const policy = data.videoPlayback;
            const duration = asset.durationMilliseconds;
            if (!duration || !playbackWindowMilliseconds(policy, duration)) {
              return "invalid" as const;
            }
          }
          let posterAsset: {
            id: string;
            originalFileName: string;
          } | null = null;
          if (poster) {
            if (poster.source === "frame") {
              if (
                !asset.durationMilliseconds ||
                poster.atMilliseconds >= asset.durationMilliseconds
              ) {
                return "invalid" as const;
              }
            } else {
              const candidate = manageableAssets.get(poster.mediaAssetId);
              if (!candidate) return "invalid" as const;
              posterAsset = candidate;
              data = {
                ...data,
                videoPoster: {
                  ...poster,
                  mediaAssetName: candidate.originalFileName,
                },
              };
            }
          }
          const compositionAssets: Array<{
            id: string;
            originalFileName: string;
            durationMilliseconds: number | null;
          }> = [];
          if (block.type === "video" && data.videoComposition) {
            const audioAssets = compositionAssetIds.flatMap((assetId) => {
              const audioAsset = manageableAssets.get(assetId);
              return audioAsset ? [audioAsset] : [];
            });
            if (audioAssets.length !== compositionAssetIds.length)
              return "invalid" as const;
            const audioAssetsById = new Map(
              audioAssets.map((audioAsset) => [audioAsset.id, audioAsset]),
            );
            const durations = new Map(
              audioAssets.flatMap((audioAsset) =>
                audioAsset.durationMilliseconds
                  ? [[audioAsset.id, audioAsset.durationMilliseconds] as const]
                  : [],
              ),
            );
            const validatedComposition = sanitizeVideoComposition(
              {
                ...data.videoComposition,
                audioTracks: data.videoComposition.audioTracks.map((track) => ({
                  ...track,
                  mediaAssetName: audioAssetsById.get(track.mediaAssetId)
                    ?.originalFileName,
                })),
              },
              durations,
            );
            if (
              !validatedComposition ||
              durations.size !== compositionAssetIds.length
            ) {
              return "invalid" as const;
            }
            if (validatedComposition.renderJobId) {
              const [renderJob] = await tx
                .select({
                  sourceAssetId: mediaProcessingJobs.sourceAssetId,
                  type: mediaProcessingJobs.type,
                  status: mediaProcessingJobs.status,
                  options: mediaProcessingJobs.options,
                })
                .from(mediaProcessingJobs)
                .where(
                  and(
                    eq(
                      mediaProcessingJobs.id,
                      validatedComposition.renderJobId,
                    ),
                    eq(mediaProcessingJobs.organizationId, user.organizationId),
                  ),
                )
                .limit(1)
                .for("share");
              if (
                !renderJob ||
                renderJob.sourceAssetId !== asset.id ||
                renderJob.type !== "transcode" ||
                (renderJob.options.videoCompositionBlockId
                  ? renderJob.options.videoCompositionBlockId !== block.id
                  : !referencedCourseIds.includes(
                      renderJob.options.videoCompositionCourseId ?? "",
                    )) ||
                !["queued", "processing", "succeeded"].includes(
                  renderJob.status,
                ) ||
                !boundVideoCompositionMatchesDocument(
                  renderJob.options.videoComposition,
                  validatedComposition,
                ) ||
                renderJob.options.videoEdit !== undefined
              ) {
                return "invalid" as const;
              }
            }
            data = { ...data, videoComposition: validatedComposition };
            compositionAssets.push(...audioAssets);
          }
          const contentUrl = `/api/media-assets/${asset.id}/download`;
          data = {
            ...data,
            mediaAssetId: asset.id,
            mediaAssetName: asset.originalFileName,
            ...(block.type === "image" ? { imageUrl: contentUrl } : {}),
            ...(block.type === "video" ? { videoUrl: contentUrl } : {}),
            ...(block.type === "audio" ? { audioUrl: contentUrl } : {}),
            ...(block.type === "file" ? { fileUrl: contentUrl } : {}),
            ...(block.type === "download" && data.download
              ? {
                  download: {
                    ...data.download,
                    mediaAssetId: asset.id,
                    fileName: data.download.fileName || asset.originalFileName,
                  },
                }
              : {}),
          };
          await bindSharedCourseMedia(tx, user, {
            referencedCourseIds,
            mediaAssetIds: [
              asset.id,
              ...compositionAssets.map((mediaAsset) => mediaAsset.id),
              ...(posterAsset ? [posterAsset.id] : []),
            ],
          });
        }
        if (
          block.type === "video" &&
          !mediaAssetId &&
          (data.videoPlayback?.completionMode === "required" ||
            Boolean(data.videoComposition) ||
            Boolean(data.videoPoster))
        ) {
          return "invalid" as const;
        }
      }
      const [updated] = await tx
        .update(contentBlocks)
        .set({
          title: embeddedAgent?.name ?? parsed.title,
          required: parsed.required,
          data,
          style: style.data,
          revision: sql`${contentBlocks.revision} + 1`,
        })
        .where(
          and(
            eq(contentBlocks.id, block.id),
            eq(contentBlocks.lessonId, block.lessonId),
            eq(contentBlocks.revision, ids.data.expectedRevision),
          ),
        )
        .returning({ id: contentBlocks.id, revision: contentBlocks.revision });
      if (
        updated &&
        block.type === "video" &&
        videoDescriptionAsset &&
        !data.caption?.trim() &&
        "videoDescriptionIntent" in parsed &&
        parsed.videoDescriptionIntent === "automatic" &&
        "transcriptLanguage" in parsed &&
        typeof parsed.transcriptLanguage === "string"
      ) {
        await enqueueReadyTranscriptInTransaction(tx, {
          organizationId: user.organizationId,
          sourceAssetId: videoDescriptionAsset.id,
          sourceContentSha256: videoDescriptionAsset.contentSha256,
          requestedById: user.id,
          language: parsed.transcriptLanguage,
        });
        await enqueueVideoDescriptionJobInTransaction(tx, {
          organizationId: user.organizationId,
          originCourseId: ids.data.courseId,
          blockId: block.id,
          sourceAssetId: videoDescriptionAsset.id,
          sourceContentSha256: videoDescriptionAsset.contentSha256,
          expectedBlockRevision: updated.revision,
          locale,
          transcriptLanguage: parsed.transcriptLanguage,
          requestedById: user.id,
        });
      }
      return updated ? ("saved" as const) : ("conflict" as const);
    }),
  );
  if ("error" in savedMutation) return failure(savedMutation.error);
  const saved = savedMutation.value;
  if (saved !== "saved") {
    if (saved === "conflict") {
      const current = await blockInCourse(
        ids.data.courseId,
        ids.data.blockId,
        user.organizationId,
      );
      return revisionFailure(
        ids.data.blockId,
        ids.data.expectedRevision,
        current?.revision,
      );
    }
    return failure(
      block.type === "data_form"
        ? "course_builder.block.data_form_unavailable"
        : "course_builder.failed",
    );
  }
  revalidateCourse(courseId);
  return success("course_builder.block.saved", block.id);
}

export async function deleteCourseContentBlockAction(
  courseId: string,
  blockId: string,
  expectedRevision: number,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const ids = z
    .object({
      courseId: idSchema,
      blockId: idSchema,
      expectedRevision: z.number().int().min(1),
    })
    .safeParse({ courseId, blockId, expectedRevision });
  if (!ids.success) return failure("course_builder.invalid_input");
  const block = await blockInCourse(
    ids.data.courseId,
    ids.data.blockId,
    user.organizationId,
  );
  if (!block) return failure("course_builder.unavailable");
  const deletedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "block",
        id: block.id,
      });
      return tx
        .delete(contentBlocks)
        .where(
          and(
            eq(contentBlocks.id, block.id),
            eq(contentBlocks.lessonId, block.lessonId),
            eq(contentBlocks.revision, ids.data.expectedRevision),
          ),
        )
        .returning({ id: contentBlocks.id });
    }),
  );
  if ("error" in deletedMutation) return failure(deletedMutation.error);
  const [deleted] = deletedMutation.value;
  if (!deleted) {
    const current = await blockInCourse(
      ids.data.courseId,
      ids.data.blockId,
      user.organizationId,
    );
    return revisionFailure(
      ids.data.blockId,
      ids.data.expectedRevision,
      current?.revision,
    );
  }
  revalidateCourse(courseId);
  return success("course_builder.block.deleted");
}

export async function duplicateCourseContentBlockAction(
  courseId: string,
  blockId: string,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const ids = z
    .object({ courseId: idSchema, blockId: idSchema })
    .safeParse({ courseId, blockId });
  if (!ids.success) return failure("course_builder.invalid_input");
  const owned = await blockInCourse(
    ids.data.courseId,
    ids.data.blockId,
    user.organizationId,
  );
  if (!owned) return failure("course_builder.unavailable");

  const createdMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "block",
        id: owned.id,
      });
      const [source] = await tx
        .select()
        .from(contentBlocks)
        .where(eq(contentBlocks.id, owned.id))
        .limit(1);
      if (!source) return null;
      const embeddedAgent = await assertPublishedAiAgentContentBlock({
        transaction: tx,
        organizationId: user.organizationId,
        type: source.type,
        data: source.data,
      });
      const targetCondition = source.pageId
        ? eq(contentBlocks.pageId, source.pageId)
        : isNull(contentBlocks.pageId);
      const [last] = await tx
        .select({ sortOrder: contentBlocks.sortOrder })
        .from(contentBlocks)
        .where(
          and(eq(contentBlocks.lessonId, source.lessonId), targetCondition),
        )
        .orderBy(desc(contentBlocks.sortOrder))
        .limit(1);
      const [copy] = await tx
        .insert(contentBlocks)
        .values({
          lessonId: source.lessonId,
          pageId: source.pageId,
          type: source.type,
          title: embeddedAgent
            ? `${embeddedAgent.name} (Kopie)`
            : source.title
              ? `${source.title} (Kopie)`
              : null,
          required: source.required,
          data: courseContentDataForCopy(source.type, source.data),
          style: source.style,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        })
        .returning({
          id: contentBlocks.id,
          type: contentBlocks.type,
          data: contentBlocks.data,
          revision: contentBlocks.revision,
        });
      if (copy) {
        await enqueueCopiedVideoDescriptionJobsInTransaction(tx, {
          organizationId: user.organizationId,
          originCourseId: ids.data.courseId,
          requestedById: user.id,
          blocks: [copy],
          locale: normalizeLocale(await resolveUserLocale(user, tx)),
        });
      }
      return copy;
    }),
  );
  if ("error" in createdMutation) return failure(createdMutation.error);
  const created = createdMutation.value;
  if (!created) return failure("course_builder.failed");
  revalidateCourse(courseId);
  return success("course_builder.block.duplicated", created.id);
}

export async function reorderCourseContentBlocksAction(
  courseId: string,
  lessonId: string,
  pageId: string | null,
  orderedIds: string[],
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      pageId: idSchema.nullable(),
      orderedIds: z
        .array(idSchema)
        .max(500)
        .refine(
          (ids) => new Set(ids).size === ids.length,
          "Inhaltselemente duerfen nicht doppelt vorkommen.",
        ),
    })
    .safeParse({ courseId, lessonId, pageId, orderedIds });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  if (
    parsed.data.pageId &&
    !(await pageInLesson(
      parsed.data.courseId,
      parsed.data.lessonId,
      parsed.data.pageId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }

  const targetCondition = parsed.data.pageId
    ? eq(contentBlocks.pageId, parsed.data.pageId)
    : isNull(contentBlocks.pageId);
  const reorderedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`content-order:${parsed.data.lessonId}:${parsed.data.pageId ?? "root"}`}))`,
      );
      const current = await tx
        .select({ id: contentBlocks.id })
        .from(contentBlocks)
        .where(
          and(
            eq(contentBlocks.lessonId, parsed.data.lessonId),
            targetCondition,
          ),
        );
      const currentIds = current.map((block) => block.id).sort();
      const nextIds = [...parsed.data.orderedIds].sort();
      if (
        currentIds.length !== nextIds.length ||
        currentIds.some((id, index) => id !== nextIds[index])
      ) {
        return false;
      }
      for (const [sortOrder, id] of parsed.data.orderedIds.entries()) {
        await tx
          .update(contentBlocks)
          .set({ sortOrder })
          .where(
            and(
              eq(contentBlocks.id, id),
              eq(contentBlocks.lessonId, parsed.data.lessonId),
              inArray(contentBlocks.id, parsed.data.orderedIds),
              targetCondition,
            ),
          );
      }
      return true;
    }),
  );
  if ("error" in reorderedMutation) return failure(reorderedMutation.error);
  const reordered = reorderedMutation.value;
  if (!reordered) {
    return failure("course_builder.block.order_conflict");
  }
  revalidateCourse(courseId);
  return success("course_builder.block.order_saved");
}

export async function updateCourseModuleAccessAction(
  courseId: string,
  moduleId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const dateValue = (name: string) => {
    const input = value(formData, name);
    return input ? new Date(input) : null;
  };
  const parsed = z
    .object({
      courseId: idSchema,
      moduleId: idSchema,
      accessMode: z.enum([
        "visible",
        "after_previous",
        "delay_days",
        "date_window",
        "coming_soon",
        "locked",
        "hidden",
      ]),
      dripDays: z.coerce.number().int().min(0).max(36_500),
      delayPendingState: z.enum(["locked", "hidden"]),
      availableFrom: z.date().nullable(),
      availableUntil: z.date().nullable(),
      windowDefaultState: z.enum([
        "available",
        "read_only",
        "locked",
        "hidden",
      ]),
      windowState: z.enum(["available", "read_only", "locked", "hidden"]),
      requestAccessEnabled: z.boolean(),
      isRequired: z.boolean(),
    })
    .superRefine((input, context) => {
      if (
        input.accessMode === "date_window" &&
        !input.availableFrom &&
        !input.availableUntil
      ) {
        context.addIssue({
          code: "custom",
          path: ["availableFrom"],
          message: "Ein Datumsfenster benoetigt mindestens eine Grenze.",
        });
      }
      if (
        input.availableFrom &&
        input.availableUntil &&
        input.availableUntil <= input.availableFrom
      ) {
        context.addIssue({
          code: "custom",
          path: ["availableUntil"],
          message: "Das Enddatum muss nach dem Startdatum liegen.",
        });
      }
    })
    .safeParse({
      courseId,
      moduleId,
      accessMode: value(formData, "accessMode"),
      dripDays: formData.get("dripDays"),
      delayPendingState: value(formData, "delayPendingState"),
      availableFrom: dateValue("availableFrom"),
      availableUntil: dateValue("availableUntil"),
      windowDefaultState: value(formData, "windowDefaultState"),
      windowState: value(formData, "windowState"),
      requestAccessEnabled: formData.get("requestAccessEnabled") === "on",
      isRequired: formData.get("isRequired") === "on",
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  let updated: { moduleId: string } | undefined;
  try {
    [updated] = await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireCoursePermissionInTransaction(tx, user, courseId, "edit");
      const [current] = await tx
        .select({ kind: modules.kind })
        .from(courseModules)
        .innerJoin(
          modules,
          and(
            eq(modules.id, courseModules.moduleId),
            eq(modules.organizationId, courseModules.organizationId),
          ),
        )
        .where(
          and(
            eq(courseModules.organizationId, user.organizationId),
            eq(courseModules.courseId, parsed.data.courseId),
            eq(courseModules.moduleId, parsed.data.moduleId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) return [];
      if (current.kind === "link" && parsed.data.isRequired) {
        throw new ApiError(
          422,
          "validation_error",
          "Link-Module koennen nicht verpflichtend sein.",
        );
      }
      const rows = await tx
        .update(courseModules)
        .set({
          accessMode: parsed.data.accessMode,
          dripDays:
            parsed.data.accessMode === "delay_days" ? parsed.data.dripDays : 0,
          delayPendingState: parsed.data.delayPendingState,
          availableFrom:
            parsed.data.accessMode === "date_window"
              ? parsed.data.availableFrom
              : null,
          availableUntil:
            parsed.data.accessMode === "date_window"
              ? parsed.data.availableUntil
              : null,
          windowDefaultState: parsed.data.windowDefaultState,
          windowState: parsed.data.windowState,
          requestAccessEnabled: parsed.data.requestAccessEnabled,
          isRequired: current.kind === "link" ? false : parsed.data.isRequired,
        })
        .where(
          and(
            eq(courseModules.organizationId, user.organizationId),
            eq(courseModules.courseId, parsed.data.courseId),
            eq(courseModules.moduleId, parsed.data.moduleId),
          ),
        )
        .returning({ moduleId: courseModules.moduleId });
      if (rows[0]) {
        await tx.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "course.module_access.updated",
          entityType: "module",
          entityId: rows[0].moduleId,
          metadata: {
            courseId: parsed.data.courseId,
            accessMode: parsed.data.accessMode,
          },
        });
      }
      return rows;
    });
  } catch (error) {
    if (error instanceof ApiError)
      return failure(courseBuilderErrorCode(error));
    throw error;
  }
  if (!updated) return failure("course_builder.failed");
  revalidateCourse(courseId);
  return success("course_builder.access.saved", updated.moduleId);
}

export async function updateModuleSectionAccessAction(
  courseId: string,
  sectionId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const parsed = z
    .object({
      courseId: idSchema,
      sectionId: idSchema,
      status: contentStatusSchema,
      visibility: z.enum(["visible", "draft", "coming_soon"]),
      dripDays: z.coerce.number().int().min(0).max(36_500),
      unlockAfterPrevious: z.boolean(),
    })
    .safeParse({
      courseId,
      sectionId,
      status: value(formData, "status"),
      visibility: value(formData, "visibility"),
      dripDays: formData.get("dripDays"),
      unlockAfterPrevious: formData.get("unlockAfterPrevious") === "on",
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await sectionInCourse(
      parsed.data.courseId,
      parsed.data.sectionId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }
  const updatedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "section",
        id: parsed.data.sectionId,
      });
      return tx
        .update(moduleSections)
        .set({
          status: parsed.data.status,
          visibility: parsed.data.visibility,
          dripDays: parsed.data.dripDays,
          unlockAfterPrevious: parsed.data.unlockAfterPrevious,
          updatedAt: new Date(),
        })
        .where(eq(moduleSections.id, parsed.data.sectionId))
        .returning({ id: moduleSections.id });
    }),
  );
  if ("error" in updatedMutation) return failure(updatedMutation.error);
  const [updated] = updatedMutation.value;
  if (!updated) return failure("course_builder.failed");
  revalidateCourse(courseId);
  return success("course_builder.section.settings_saved", updated.id);
}

export async function updateCourseLessonAccessAction(
  courseId: string,
  lessonId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const availableAtValue = value(formData, "availableAt");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      status: contentStatusSchema,
      visibility: z.enum(["visible", "draft", "coming_soon"]),
      availableAt: z
        .string()
        .max(80)
        .refine(
          (input) => !input || !Number.isNaN(new Date(input).getTime()),
          "Freigabezeit ist ungueltig.",
        ),
    })
    .safeParse({
      courseId,
      lessonId,
      status: value(formData, "status"),
      visibility: value(formData, "visibility"),
      availableAt: availableAtValue,
    });
  if (!parsed.success) return failure("course_builder.invalid_input");
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }

  const updatedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      const lesson = await updateLessonWithTitleSync(tx, {
        organizationId: user.organizationId,
        lessonId: parsed.data.lessonId,
        lesson: {
          status: parsed.data.status,
          visibility: parsed.data.visibility,
          availableAt: parsed.data.availableAt
            ? new Date(parsed.data.availableAt)
            : null,
        },
      });
      return { id: lesson.id };
    }),
  );
  if ("error" in updatedMutation) return failure(updatedMutation.error);
  const updated = updatedMutation.value;
  if (!updated) return failure("course_builder.failed");
  revalidateCourse(courseId);
  return success("course_builder.lesson.settings_saved", updated.id);
}

export async function updateCourseLessonAssessmentAction(
  courseId: string,
  lessonId: string,
  formData: FormData,
): Promise<CourseBuilderActionResult> {
  const { user } = await requireCoursePermission(courseId, "edit");
  const maxAttemptsValue = value(formData, "maxAttempts");
  const examSettingsSubmitted = [
    "examDurationMinutes",
    "randomQuestionCount",
    "examResultReleaseMode",
    "examReviewReleaseMode",
    "examContentAccessMode",
  ].some((field) => formData.has(field));
  const examDurationMinutesValue = value(formData, "examDurationMinutes");
  const randomQuestionCountValue = value(formData, "randomQuestionCount");
  const parsed = z
    .object({
      courseId: idSchema,
      lessonId: idSchema,
      passingScore: z.coerce.number().int().min(1).max(100),
      maxAttempts: z.number().int().min(1).max(100).nullable(),
      shuffleQuestions: z.boolean(),
    })
    .safeParse({
      courseId,
      lessonId,
      passingScore: formData.get("passingScore"),
      maxAttempts: maxAttemptsValue ? Number(maxAttemptsValue) : null,
      shuffleQuestions: formData.get("shuffleQuestions") === "on",
    });
  if (!parsed.success) {
    return failure("course_builder.invalid_input");
  }
  const parsedExamSettings = examSettingsSubmitted
    ? examAdminSettingsSchema.safeParse({
        durationMinutes: examDurationMinutesValue
          ? Number(examDurationMinutesValue)
          : null,
        randomQuestionCount: randomQuestionCountValue
          ? Number(randomQuestionCountValue)
          : null,
        resultReleaseMode: formData.get("examResultReleaseMode"),
        reviewReleaseMode: formData.get("examReviewReleaseMode"),
        contentAccessMode: formData.get("examContentAccessMode"),
      })
    : null;
  if (parsedExamSettings && !parsedExamSettings.success) {
    return failure("course_builder.invalid_input");
  }
  const examSettings = parsedExamSettings?.data ?? null;
  if (
    examSettings?.resultReleaseMode === "after_deadline" &&
    examSettings.durationMinutes === null
  ) {
    return failure("course_builder.invalid_input");
  }
  if (
    !(await lessonInCourse(
      parsed.data.courseId,
      parsed.data.lessonId,
      user.organizationId,
    ))
  ) {
    return failure("course_builder.unavailable");
  }

  const updatedMutation = await runCourseBuilderMutation(() =>
    db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(tx, user, courseId, {
        type: "lesson",
        id: parsed.data.lessonId,
      });
      let examLessonUpdate: {
        examDurationSeconds?: number | null;
        examQuestionPools?: ExamQuestionPoolConfiguration[];
        examResultReleaseMode?: "immediate" | "after_deadline" | "manual";
        examReviewReleaseMode?: "never" | "after_result" | "manual";
        examContentAccessMode?: "allow" | "block_course" | "block_academy";
      } = {};
      if (examSettings) {
        const [target] = await tx
          .select({ lessonType: lessons.type, moduleKind: modules.kind })
          .from(lessons)
          .innerJoin(
            modules,
            and(
              eq(modules.id, lessons.moduleId),
              eq(modules.organizationId, lessons.organizationId),
            ),
          )
          .where(
            and(
              eq(lessons.id, parsed.data.lessonId),
              eq(lessons.organizationId, user.organizationId),
            ),
          )
          .limit(1);
        if (!target) {
          throw new ApiError(404, "not_found", "Pruefung nicht gefunden.");
        }
        if (target.lessonType !== "exam" || target.moduleKind !== "exam") {
          throw new ApiError(
            409,
            "conflict",
            "Die erweiterten Einstellungen sind nur fuer Pruefungsmodule verfuegbar.",
          );
        }
        const questionRows = await tx
          .select({ id: contentBlocks.id })
          .from(contentBlocks)
          .leftJoin(
            lessonPages,
            and(
              eq(lessonPages.id, contentBlocks.pageId),
              eq(lessonPages.lessonId, contentBlocks.lessonId),
            ),
          )
          .where(
            and(
              eq(contentBlocks.lessonId, parsed.data.lessonId),
              inArray(contentBlocks.type, [...assessmentQuestionTypes]),
              or(
                isNull(contentBlocks.pageId),
                eq(lessonPages.status, "published"),
              ),
            ),
          )
          .orderBy(
            sql`coalesce(${lessonPages.sortOrder}, -1)`,
            asc(contentBlocks.sortOrder),
            asc(contentBlocks.id),
          );
        const questionIds = questionRows.map((question) => question.id);
        const derivedPools = deriveAdminExamQuestionPools({
          questionIds,
          drawCount: examSettings.randomQuestionCount,
        });
        if (!derivedPools.ok) {
          throw new ApiError(422, "validation_error", derivedPools.message);
        }
        const durationSeconds =
          examSettings.durationMinutes === null
            ? null
            : Math.round(examSettings.durationMinutes * 60);
        const configurationErrors = examLifecycleConfigurationErrors({
          configuration: {
            durationSeconds,
            questionPools: derivedPools.questionPools,
            resultReleaseMode: examSettings.resultReleaseMode,
            reviewReleaseMode: examSettings.reviewReleaseMode,
            contentAccessMode: examSettings.contentAccessMode,
          },
          questionIds,
        });
        if (configurationErrors.length) {
          throw new ApiError(422, "validation_error", configurationErrors[0]);
        }
        examLessonUpdate = {
          examDurationSeconds: durationSeconds,
          examQuestionPools: derivedPools.questionPools,
          examResultReleaseMode: examSettings.resultReleaseMode,
          examReviewReleaseMode: examSettings.reviewReleaseMode,
          examContentAccessMode: examSettings.contentAccessMode,
        };
      }
      const lesson = await updateLessonWithTitleSync(tx, {
        organizationId: user.organizationId,
        lessonId: parsed.data.lessonId,
        lesson: {
          passingScore: parsed.data.passingScore,
          maxAttempts: parsed.data.maxAttempts,
          shuffleQuestions: parsed.data.shuffleQuestions,
          ...examLessonUpdate,
        },
      });
      return { id: lesson.id };
    }),
  );
  if ("error" in updatedMutation) return failure(updatedMutation.error);
  const updated = updatedMutation.value;
  if (!updated) return failure("course_builder.failed");
  revalidateCourse(courseId);
  return success("course_builder.assessment.saved", updated.id);
}
