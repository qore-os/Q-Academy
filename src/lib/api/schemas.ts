import { z } from "zod";
import { optionalPhoneSchema } from "@/lib/phone-number";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";
import {
  announcementTargetRuleSetSchema,
  EMPTY_ANNOUNCEMENT_TARGET_RULE_SET,
} from "@/lib/announcement-rules";
import {
  announcementContentDocumentSchema,
  safeAnnouncementHref,
} from "@/lib/announcement-content";
export { eventLifecycleCommandSchema } from "@/lib/event-lifecycle-model";
import { API_SCOPES, WEBHOOK_EVENTS } from "@/lib/api/scopes";
import {
  richTextDocumentHasContent,
  sanitizeRichTextDocument,
} from "@/lib/rich-text/document";
import {
  galleryDocumentHasContent,
  sanitizeGalleryDocument,
  sanitizeLinkButtonDocument,
} from "@/lib/content-blocks/interactive-documents";
import { sanitizeVideoTranscriptDocument } from "@/lib/content-blocks/video-transcript";
import { sanitizeVideoEndCard } from "@/lib/media/video-end-card";
import { parseVideoPlaybackPolicy } from "@/lib/media/video-playback-policy";
import { sanitizeVideoComposition } from "@/lib/media/video-composition";
import { sanitizeVideoPoster } from "@/lib/media/video-poster";
import {
  DEFAULT_EVENT_TIME_ZONE,
  isValidEventTimeZone,
} from "@/lib/event-timezone";
import {
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
  courseAuthorIdsSchema,
  courseLearningGoalsSchema,
} from "@/lib/course-information";
import {
  MAX_COURSE_COVER_LENGTH,
  safeCourseCoverSource,
} from "@/lib/course-cover";
import { oidcConfigurationPatchSchema } from "@/lib/oidc-model";
import { submissionReviewAnnotationsInputSchema } from "@/lib/submission-review-annotations";
import { submissionRichTextDocumentSchema } from "@/lib/submission-rich-text";
import {
  safeHubEmbedUrl,
} from "@/lib/hub-embed-policy";
import {
  COURSE_INTEGRATION_LAYOUTS,
  COURSE_INTEGRATION_PROVIDERS,
  resolveCourseIntegration,
} from "@/lib/content-blocks/integration-catalog";
import { HUB_CUSTOM_CODE_MAX_LENGTH } from "@/lib/hub-custom-code-policy";
export {
  aiAgentDraftUpdateSchema as agentDraftUpdateSchema,
  aiAgentPublishSchema as agentPublishSchema,
  aiAgentRollbackSchema as agentRollbackSchema,
} from "@/lib/ai/agent-studio-model";
export {
  aiAgentActionRequestCreateSchema as agentActionRequestCreateSchema,
  aiAgentActionDecisionSchema as agentActionDecisionSchema,
} from "@/lib/ai/agent-actions-model";
export {
  courseWidgetCreateSchema,
  courseWidgetOrderSchema,
  courseWidgetUpdateSchema,
} from "@/lib/course-widgets";
export { courseCategoryReorderSchema } from "@/lib/course-category-model";
export { memberWelcomeSettingsUpdateSchema } from "@/lib/member-welcome-model";
export { transcriptSearchSettingsInputSchema } from "@/lib/transcript-search-settings-model";
export {
  customDomainClaimCreateSchema,
  customDomainClaimMutationSchema,
} from "@/lib/custom-domain-model";
export {
  teamRoleAssignmentSchema,
  teamRoleCreateSchema,
  teamRoleUpdateSchema,
} from "@/lib/team-permission-policy";
export {
  emailDeliveryListQuerySchema,
  emailDeliveryRetryInputSchema,
  emailTemplateLocaleQuerySchema,
  emailTemplateSettingsInputSchema,
  emailTemplateSettingsUpdateInputSchema,
  emailTemplateTestInputSchema,
} from "@/lib/email-center-model";
export { emailSuppressionReleaseSchema } from "@/lib/email-feedback-model";
export {
  automationMemberUpsertSchema,
  commerceConnectionInputSchema,
  commerceEntitlementCommandSchema,
  commerceMappingInputSchema,
  commerceProductInputSchema,
  n8nTriggerSchema,
  n8nWorkflowInputSchema,
  supportSettingsInputSchema,
} from "@/lib/commerce/model";

type StrictPartialShape<T extends z.ZodRawShape> = {
  [K in keyof T]: z.ZodOptional<T[K]>;
};

function strictPartialWithoutDefaults<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const inputField = field as z.ZodType;
      const fieldWithoutDefault =
        inputField instanceof z.ZodDefault
          ? inputField.removeDefault()
          : inputField;
      return [key, z.optional(fieldWithoutDefault)];
    }),
  ) as StrictPartialShape<T>;

  return z.object(shape).strict();
}

const optionalNullableString = z
  .string()
  .trim()
  .max(5000)
  .nullable()
  .optional();

const httpUrl = z
  .string()
  .url()
  .max(2000)
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Es sind nur HTTP(S)-URLs erlaubt.",
  );

const courseCoverApiSchema = z
  .string()
  .trim()
  .max(MAX_COURSE_COVER_LENGTH)
  .nullable()
  .refine(
    (value) => value === null || value === "" || safeCourseCoverSource(value),
    "Titelbilder muessen ein lokaler Bildpfad oder ein sicherer Kursmedien-Pfad sein.",
  )
  .transform((value) => safeCourseCoverSource(value));

const strongPassword = z
  .string()
  .min(10)
  .max(200)
  .regex(/[a-z]/, "Passwort muss einen Kleinbuchstaben enthalten.")
  .regex(/[A-Z]/, "Passwort muss einen Grossbuchstaben enthalten.")
  .regex(/[0-9]/, "Passwort muss eine Zahl enthalten.");

export const authLoginSchema = z
  .object({
    email: z.string().trim().email().max(255),
    password: z.string().min(8).max(200),
    organizationSlug: z.string().trim().min(2).max(100).optional(),
  })
  .strict();
export const authMfaCompleteSchema = z
  .object({ code: z.string().trim().min(6).max(32) })
  .strict();
export const passwordForgotSchema = z
  .object({
    email: z.string().trim().email().max(255),
    organizationSlug: z.string().trim().min(2).max(100).optional(),
  })
  .strict();
export const passwordResetSchema = z
  .object({ token: z.string().min(32).max(300), password: strongPassword })
  .strict();
export const invitationAcceptSchema = z
  .object({ password: strongPassword })
  .strict();

export const organizationUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: optionalNullableString,
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    logoMark: z.string().trim().min(1).max(12).optional(),
    defaultLocale: z.enum(SUPPORTED_LOCALES).optional(),
    settings: z
      .record(z.string().min(1).max(120), z.record(z.string(), z.unknown()))
      .refine(
        (value) =>
          !Object.hasOwn(value, "transcripts") &&
          !Object.hasOwn(value, "email_templates"),
        "Reservierte Plattform-Einstellungen muessen ueber ihren dedizierten Endpunkt geaendert werden.",
      )
      .optional(),
  })
  .strict();

export const oidcConfigurationApiUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    configuration: oidcConfigurationPatchSchema,
  })
  .strict();

const courseBaseSchema = z
  .object({
    title: z.string().trim().min(3).max(220),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .optional(),
    shortDescription: z.string().trim().min(10).max(600),
    description: z.string().trim().min(10).max(12_000),
    categoryId: z.string().uuid().nullable().optional(),
    coverImage: courseCoverApiSchema.optional(),
    status: z.enum(["draft", "published", "archived"]),
    difficulty: z.string().trim().min(2).max(40),
    estimatedMinutes: z.number().int().min(1).max(100_000),
    certificateEnabled: z.boolean(),
    featured: z.boolean(),
    visibleInCatalog: z.boolean(),
    showProgressPercentage: z.boolean(),
    notifyMembersOnModuleRelease: z.boolean(),
    learningGoals: courseLearningGoalsSchema,
    authorIds: courseAuthorIdsSchema,
  })
  .strict();

export const courseCreateSchema = courseBaseSchema
  .extend({
    status: courseBaseSchema.shape.status.default("draft"),
    difficulty: courseBaseSchema.shape.difficulty.default("Grundlagen"),
    estimatedMinutes: courseBaseSchema.shape.estimatedMinutes.default(60),
    certificateEnabled: courseBaseSchema.shape.certificateEnabled.default(true),
    featured: courseBaseSchema.shape.featured.default(false),
    visibleInCatalog: courseBaseSchema.shape.visibleInCatalog.default(true),
    showProgressPercentage:
      courseBaseSchema.shape.showProgressPercentage.default(true),
    notifyMembersOnModuleRelease:
      courseBaseSchema.shape.notifyMembersOnModuleRelease.default(false),
    learningGoals: courseBaseSchema.shape.learningGoals.default([]),
    authorIds: courseBaseSchema.shape.authorIds.default([]),
  })
  .strict();

export const courseUpdateSchema =
  strictPartialWithoutDefaults(courseBaseSchema);
export const courseCloneSchema = z
  .object({ title: z.string().trim().min(3).max(220).optional() })
  .strict();

export const courseVersionCreateSchema = z
  .object({ changelog: z.string().trim().max(5000).default("") })
  .strict();

export const coursePublishSchema = z
  .object({ changelog: z.string().trim().max(5000).default("") })
  .strict();

export const courseCategoryCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .optional(),
    description: optionalNullableString,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#2bb7a9"),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export const courseCategoryUpdateSchema = strictPartialWithoutDefaults(
  courseCategoryCreateSchema,
);

export const moduleCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(220),
    kind: z.enum(["learning", "exam", "link"]).default("learning"),
    linkedCourseId: z.string().uuid().nullable().default(null),
    description: optionalNullableString,
    folder: z.string().trim().min(1).max(120).default("Allgemein"),
    isReusable: z.boolean().default(true),
    estimatedMinutes: z.number().int().min(1).max(100_000).default(30),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.kind === "link" && !input.linkedCourseId) {
      context.addIssue({
        code: "custom",
        path: ["linkedCourseId"],
        message: "Ein Link-Modul benoetigt einen Zielkurs.",
      });
    }
    if (input.kind !== "link" && input.linkedCourseId) {
      context.addIssue({
        code: "custom",
        path: ["linkedCourseId"],
        message: "Nur Link-Module duerfen einen Zielkurs besitzen.",
      });
    }
  });

export const moduleUpdateSchema = strictPartialWithoutDefaults(
  z
    .object({
      title: z.string().trim().min(3).max(220),
      linkedCourseId: z.string().uuid().nullable(),
      description: optionalNullableString,
      folder: z.string().trim().min(1).max(120),
      isReusable: z.boolean(),
      estimatedMinutes: z.number().int().min(1).max(100_000),
    })
    .strict(),
);

const courseModuleAccessModeSchema = z.enum([
  "visible",
  "after_previous",
  "delay_days",
  "date_window",
  "coming_soon",
  "locked",
  "hidden",
]);
const courseModuleAccessStateSchema = z.enum([
  "available",
  "read_only",
  "locked",
  "hidden",
]);
const courseModuleConfigurationShape = {
  sortOrder: z.number().int().min(0).max(100_000),
  indentLevel: z.number().int().min(0).max(3),
  accessMode: courseModuleAccessModeSchema,
  dripDays: z.number().int().min(0).max(36_500),
  delayPendingState: z.enum(["locked", "hidden"]),
  availableFrom: z.coerce.date().nullable(),
  availableUntil: z.coerce.date().nullable(),
  windowDefaultState: courseModuleAccessStateSchema,
  windowState: courseModuleAccessStateSchema,
  requestAccessEnabled: z.boolean(),
  isRequired: z.boolean(),
} satisfies z.ZodRawShape;

type CourseModuleConfiguration = {
  accessMode: z.infer<typeof courseModuleAccessModeSchema>;
  dripDays: number;
  availableFrom: Date | null;
  availableUntil: Date | null;
};

function validateCourseModuleConfiguration(
  input: CourseModuleConfiguration,
  context: z.RefinementCtx,
) {
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
  if (input.accessMode !== "delay_days" && input.dripDays !== 0) {
    context.addIssue({
      code: "custom",
      path: ["dripDays"],
      message: "Verzoegerungstage sind nur im Modus delay_days erlaubt.",
    });
  }
  if (
    input.accessMode !== "date_window" &&
    (input.availableFrom || input.availableUntil)
  ) {
    context.addIssue({
      code: "custom",
      path: ["availableFrom"],
      message: "Datumsgrenzen sind nur im Modus date_window erlaubt.",
    });
  }
}

const courseModuleConfigurationCreateShape = {
  sortOrder: courseModuleConfigurationShape.sortOrder.default(0),
  indentLevel: courseModuleConfigurationShape.indentLevel.default(0),
  accessMode: courseModuleConfigurationShape.accessMode.default("visible"),
  dripDays: courseModuleConfigurationShape.dripDays.default(0),
  delayPendingState:
    courseModuleConfigurationShape.delayPendingState.default("locked"),
  availableFrom: courseModuleConfigurationShape.availableFrom.default(null),
  availableUntil: courseModuleConfigurationShape.availableUntil.default(null),
  windowDefaultState:
    courseModuleConfigurationShape.windowDefaultState.default("locked"),
  windowState: courseModuleConfigurationShape.windowState.default("available"),
  requestAccessEnabled:
    courseModuleConfigurationShape.requestAccessEnabled.default(false),
  isRequired: courseModuleConfigurationShape.isRequired.default(true),
} satisfies z.ZodRawShape;

export const courseModuleAccessConfigurationSchema = z
  .object(courseModuleConfigurationCreateShape)
  .strict()
  .superRefine(validateCourseModuleConfiguration);

export const courseModuleAttachSchema = z
  .object({
    moduleId: z.string().uuid(),
    ...courseModuleConfigurationCreateShape,
  })
  .strict()
  .superRefine(validateCourseModuleConfiguration);

export const courseModuleUpdateSchema = strictPartialWithoutDefaults(
  z.object(courseModuleConfigurationShape).strict(),
).superRefine((input, context) => {
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
  if (
    input.accessMode &&
    input.accessMode !== "delay_days" &&
    input.dripDays !== undefined &&
    input.dripDays !== 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["dripDays"],
      message: "Verzoegerungstage sind nur im Modus delay_days erlaubt.",
    });
  }
  if (
    input.accessMode &&
    input.accessMode !== "date_window" &&
    (input.availableFrom || input.availableUntil)
  ) {
    context.addIssue({
      code: "custom",
      path: ["availableFrom"],
      message: "Datumsgrenzen sind nur im Modus date_window erlaubt.",
    });
  }
});

export const courseModuleOutlineSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            moduleId: z.string().uuid(),
            sortOrder: z.number().int().min(0).max(100_000),
            indentLevel: z.number().int().min(0).max(3),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict()
  .superRefine((input, context) => {
    const ids = new Set<string>();
    const orders = new Set<number>();
    const ordered = [...input.items].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder ||
        left.moduleId.localeCompare(right.moduleId),
    );
    for (const [index, item] of ordered.entries()) {
      if (ids.has(item.moduleId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "moduleId"],
          message: "Ein Modul darf nur einmal vorkommen.",
        });
      }
      if (orders.has(item.sortOrder) || item.sortOrder !== index) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "sortOrder"],
          message: "Die Reihenfolge muss lueckenlos bei null beginnen.",
        });
      }
      if (
        (index === 0 && item.indentLevel !== 0) ||
        (index > 0 && item.indentLevel > ordered[index - 1].indentLevel + 1)
      ) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "indentLevel"],
          message: "Die Einrueckung darf nur um eine Ebene steigen.",
        });
      }
      ids.add(item.moduleId);
      orders.add(item.sortOrder);
    }
  });

export const courseModuleAccessRequestCreateSchema = z
  .object({
    userId: z.string().uuid(),
    message: z.string().trim().max(1_000).nullable().optional(),
  })
  .strict();

export const courseModuleAccessRequestCancelSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export const courseModuleAccessRequestDecisionSchema = z
  .object({
    actorId: z.string().uuid(),
    decision: z.enum(["approved", "rejected"]),
    decisionNote: z.string().trim().max(1_000).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const courseModuleAccessRequestListQuerySchema = z
  .object({
    status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(),
    userId: z.string().uuid().optional(),
  })
  .strict();

export const courseModuleAccessOverrideSchema = z
  .object({
    actorId: z.string().uuid(),
    state: z.enum(["available", "read_only", "locked", "hidden"]),
    reason: z.string().trim().max(500).nullable().optional(),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const courseModuleAccessOverrideDeleteSchema = z
  .object({ actorId: z.string().uuid() })
  .strict();

export const examQuestionPoolsSchema = z
  .array(
    z
      .object({
        id: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/)
          .max(80),
        questionIds: z
          .array(z.string().uuid())
          .min(1)
          .max(100)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "Fragen duerfen innerhalb eines Pools nicht doppelt vorkommen.",
          ),
        drawCount: z.number().int().min(1).max(100),
      })
      .strict()
      .refine(
        (pool) => pool.drawCount <= pool.questionIds.length,
        "Die Ziehungsanzahl darf die Poolgroesse nicht ueberschreiten.",
      ),
  )
  .max(20)
  .superRefine((pools, context) => {
    const poolIds = new Set<string>();
    const questionIds = new Set<string>();
    for (const [index, pool] of pools.entries()) {
      if (poolIds.has(pool.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Pool-IDs muessen eindeutig sein.",
        });
      }
      poolIds.add(pool.id);
      for (const questionId of pool.questionIds) {
        if (questionIds.has(questionId)) {
          context.addIssue({
            code: "custom",
            path: [index, "questionIds"],
            message: "Eine Frage darf nur einem Pool angehoeren.",
          });
        }
        questionIds.add(questionId);
      }
    }
  });

export const lessonCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(220),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .optional(),
    summary: optionalNullableString,
    type: z
      .enum(["lesson", "quiz", "assignment", "exam", "live"])
      .default("lesson"),
    durationMinutes: z.number().int().min(1).max(10_000).default(10),
    passingScore: z.number().int().min(1).max(100).default(100),
    maxAttempts: z.number().int().min(1).max(100).nullable().optional(),
    shuffleQuestions: z.boolean().default(false),
    examDurationSeconds: z
      .number()
      .int()
      .min(60)
      .max(86_400)
      .nullable()
      .default(null),
    examQuestionPools: examQuestionPoolsSchema.default([]),
    examResultReleaseMode: z
      .enum(["immediate", "after_deadline", "manual"])
      .default("immediate"),
    examReviewReleaseMode: z
      .enum(["never", "after_result", "manual"])
      .default("after_result"),
    examContentAccessMode: z
      .enum(["allow", "block_course", "block_academy"])
      .default("allow"),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    status: z.enum(["draft", "published", "archived"]).default("published"),
    visibility: z.enum(["visible", "draft", "coming_soon"]).default("visible"),
    availableAt: z.coerce.date().nullable().optional(),
    dripDays: z.number().int().min(0).max(36_500).default(0),
    unlockAfterPrevious: z.boolean().default(false),
  })
  .strict();

export const lessonUpdateSchema =
  strictPartialWithoutDefaults(lessonCreateSchema);

export const lessonPageCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(220),
    titleSyncedWithLesson: z.boolean().optional(),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(180)
      .optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    status: z.enum(["draft", "published", "archived"]).default("published"),
    layoutWidth: z.enum(["narrow", "standard", "wide"]).default("standard"),
    backgroundTone: z.enum(["plain", "soft", "contrast"]).default("plain"),
    contentSpacing: z
      .enum(["compact", "comfortable", "spacious"])
      .default("comfortable"),
  })
  .strict();
export const lessonPageUpdateSchema = strictPartialWithoutDefaults(
  lessonPageCreateSchema,
)
  .extend({ revision: z.number().int().min(1) })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "revision"),
    "Mindestens ein Seitenfeld muss geaendert werden.",
  );

const richTextDocumentSchema = z.unknown().transform((input, context) => {
  const document = sanitizeRichTextDocument(input);
  if (!richTextDocumentHasContent(document)) {
    context.addIssue({
      code: "custom",
      message: "Rich-Text-Inhalte duerfen nicht leer sein.",
    });
    return z.NEVER;
  }
  return document;
});

const linkButtonDocumentSchema = z.unknown().transform((input, context) => {
  const document = sanitizeLinkButtonDocument(input);
  if (!document) {
    context.addIssue({
      code: "custom",
      message: "Button-Beschriftung, Ziel oder Variante ist ungueltig.",
    });
    return z.NEVER;
  }
  return document;
});

const galleryDocumentSchema = z.unknown().transform((input, context) => {
  const document = sanitizeGalleryDocument(input);
  if (!galleryDocumentHasContent(document)) {
    context.addIssue({
      code: "custom",
      message: "Galerien benoetigen mindestens ein gueltiges Bild.",
    });
    return z.NEVER;
  }
  return document;
});

const videoTranscriptDocumentSchema = z
  .unknown()
  .transform((input, context) => {
    const document = sanitizeVideoTranscriptDocument(input);
    if (!document) {
      context.addIssue({
        code: "custom",
        message: "Das Video-Transkript enthaelt keine gueltigen Zeitmarken.",
      });
      return z.NEVER;
    }
    return document;
  });

const videoPlaybackPolicySchema = z.unknown().transform((input, context) => {
  const policy = parseVideoPlaybackPolicy(input);
  if (!policy) {
    context.addIssue({
      code: "custom",
      message: "Die Wiedergabe- und Schnittregeln sind ungueltig.",
    });
    return z.NEVER;
  }
  return policy;
});

const videoEndCardSchema = z.unknown().transform((input, context) => {
  const endCard = sanitizeVideoEndCard(input);
  if (!endCard) {
    context.addIssue({
      code: "custom",
      message: "Die Video-Endkarte ist ungueltig.",
    });
    return z.NEVER;
  }
  return endCard;
});

const videoCompositionSchema = z.unknown().transform((input, context) => {
  const composition = sanitizeVideoComposition(input);
  if (!composition) {
    context.addIssue({
      code: "custom",
      message: "Die Video-Mehrspur-Komposition ist ungueltig.",
    });
    return z.NEVER;
  }
  return composition;
});

const videoPosterSchema = z.unknown().transform((input, context) => {
  const poster = sanitizeVideoPoster(input);
  if (!poster) {
    context.addIssue({
      code: "custom",
      message: "Die Video-Vorschaubild-Auswahl ist ungueltig.",
    });
    return z.NEVER;
  }
  return poster;
});

function structuredDocumentSchema<T>(
  sanitizer: (input: unknown) => T | null,
  message: string,
) {
  return z.unknown().transform((input, context) => {
    const document = sanitizer(input);
    if (!document) {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return document;
  });
}

const calloutDocumentSchema = structuredDocumentSchema(sanitizeCalloutDocument, "Der Callout ist ungueltig.");
const quoteDocumentSchema = structuredDocumentSchema(sanitizeQuoteDocument, "Das Zitat ist ungueltig.");
const dividerDocumentSchema = structuredDocumentSchema(sanitizeDividerDocument, "Der Trenner ist ungueltig.");
const accordionDocumentSchema = structuredDocumentSchema(sanitizeAccordionDocument, "Das Accordion ist ungueltig.");
const tabsDocumentSchema = structuredDocumentSchema(sanitizeTabsDocument, "Die Tabs sind ungueltig.");
const columnsDocumentSchema = structuredDocumentSchema(sanitizeColumnsDocument, "Die Spalten sind ungueltig.");
const downloadDocumentSchema = structuredDocumentSchema(sanitizeDownloadDocument, "Der Download ist ungueltig.");
const codeDocumentSchema = structuredDocumentSchema(sanitizeCodeDocument, "Der Codeblock ist ungueltig.");
const tableDocumentSchema = structuredDocumentSchema(sanitizeTableDocument, "Die Tabelle ist ungueltig.");

const contentBlockDataSchema = z
  .object({
    agentId: z.string().uuid().optional(),
    text: z.string().max(50_000).optional(),
    richText: richTextDocumentSchema.optional(),
    button: linkButtonDocumentSchema.optional(),
    gallery: galleryDocumentSchema.optional(),
    callout: calloutDocumentSchema.optional(),
    quote: quoteDocumentSchema.optional(),
    divider: dividerDocumentSchema.optional(),
    accordion: accordionDocumentSchema.optional(),
    tabs: tabsDocumentSchema.optional(),
    columns: columnsDocumentSchema.optional(),
    download: downloadDocumentSchema.optional(),
    code: codeDocumentSchema.optional(),
    table: tableDocumentSchema.optional(),
    items: z.array(z.string().max(5000)).max(100).optional(),
    videoUrl: httpUrl.optional(),
    transcript: videoTranscriptDocumentSchema.optional(),
    videoEndCard: videoEndCardSchema.optional(),
    videoPlayback: videoPlaybackPolicySchema.optional(),
    videoComposition: videoCompositionSchema.optional(),
    videoPoster: videoPosterSchema.optional(),
    formId: z.string().uuid().optional(),
    imageUrl: httpUrl.optional(),
    audioUrl: httpUrl.optional(),
    fileUrl: httpUrl.optional(),
    fileName: z.string().trim().max(500).optional(),
    embedUrl: httpUrl.optional(),
    embedProvider: z
      .enum(
        COURSE_INTEGRATION_PROVIDERS.map((provider) => provider.id) as [
          (typeof COURSE_INTEGRATION_PROVIDERS)[number]["id"],
          ...(typeof COURSE_INTEGRATION_PROVIDERS)[number]["id"][],
        ],
      )
      .optional(),
    embedLayout: z.enum(COURSE_INTEGRATION_LAYOUTS).optional(),
    caption: z.string().max(5000).optional(),
    options: z
      .array(z.string().trim().min(1).max(1000))
      .min(2)
      .max(20)
      .optional(),
    correctOption: z.number().int().min(0).max(19).optional(),
    correctOptions: z
      .array(z.number().int().min(0).max(19))
      .min(1)
      .max(20)
      .optional(),
    acceptedAnswers: z
      .array(z.string().trim().min(1).max(500))
      .min(1)
      .max(20)
      .optional(),
    caseSensitive: z.boolean().optional(),
    prompt: z.string().trim().max(10_000).optional(),
    feedback: z.string().trim().max(2_000).optional(),
    accent: z.enum(["navy", "teal", "coral", "amber"]).optional(),
  })
  .strict();

function validateAssessmentBlock(
  block: { type?: string; data?: z.infer<typeof contentBlockDataSchema> },
  context: z.core.$RefinementCtx,
) {
  if (
    block.type === "embed" &&
    !resolveCourseIntegration(
      block.data?.embedUrl,
      block.data?.embedProvider,
    )
  ) {
    context.addIssue({
      code: "custom",
      path: ["data", "embedUrl"],
      message:
        "Embed-Bloecke benoetigen eine freigegebene HTTPS-Provider-URL.",
    });
  }
  if (block.type !== "embed" && block.data?.embedUrl) {
    context.addIssue({
      code: "custom",
      path: ["data", "embedUrl"],
      message: "embedUrl ist nur fuer Embed-Bloecke erlaubt.",
    });
  }
  if (
    block.type !== "embed" &&
    (block.data?.embedProvider || block.data?.embedLayout)
  ) {
    context.addIssue({
      code: "custom",
      path: ["data", "embedProvider"],
      message: "Embed-Provider und -Layout sind nur fuer Embed-Bloecke erlaubt.",
    });
  }
  if (block.type === "ai_agent" && !block.data?.agentId) {
    context.addIssue({
      code: "custom",
      path: ["data", "agentId"],
      message: "KI-Agent-Bloecke benoetigen einen veroeffentlichten Agenten.",
    });
  }
  if (
    block.type === "ai_agent" &&
    block.data &&
    Object.keys(block.data).some((key) => key !== "agentId")
  ) {
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "KI-Agent-Bloecke duerfen nur die Agent-ID speichern.",
    });
  }
  if (block.type !== "ai_agent" && block.data?.agentId) {
    context.addIssue({
      code: "custom",
      path: ["data", "agentId"],
      message: "agentId ist nur fuer KI-Agent-Bloecke erlaubt.",
    });
  }
  if (block.type === "rich_text" && !block.data?.richText) {
    context.addIssue({
      code: "custom",
      path: ["data", "richText"],
      message: "Rich-Text-Bloecke benoetigen strukturierte Inhalte.",
    });
  }
  if (block.type === "button" && !block.data?.button) {
    context.addIssue({
      code: "custom",
      path: ["data", "button"],
      message: "Button-Bloecke benoetigen strukturierte Linkdaten.",
    });
  }
  if (block.type === "gallery" && !block.data?.gallery) {
    context.addIssue({
      code: "custom",
      path: ["data", "gallery"],
      message: "Galerie-Bloecke benoetigen strukturierte Bilddaten.",
    });
  }
  const structuredTypes = [
    "callout",
    "quote",
    "divider",
    "accordion",
    "tabs",
    "columns",
    "download",
    "code",
    "table",
  ] as const;
  for (const type of structuredTypes) {
    if (block.type === type && !block.data?.[type]) {
      context.addIssue({
        code: "custom",
        path: ["data", type],
        message: `${type}-Bloecke benoetigen ein strukturiertes Dokument.`,
      });
    }
    if (block.type !== type && block.data?.[type]) {
      context.addIssue({
        code: "custom",
        path: ["data", type],
        message: `${type} ist nur fuer den zugehoerigen Blocktyp erlaubt.`,
      });
    }
  }
  if (block.type !== "video" && block.data?.videoPlayback) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoPlayback"],
      message: "Wiedergaberegeln sind nur fuer Videobloecke erlaubt.",
    });
  }
  if (block.type !== "video" && block.data?.videoEndCard) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoEndCard"],
      message: "Endkarten sind nur fuer Videobloecke erlaubt.",
    });
  }
  if (block.type !== "video" && block.data?.videoComposition) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoComposition"],
      message: "Mehrspur-Kompositionen sind nur fuer Videobloecke erlaubt.",
    });
  }
  if (block.type !== "video" && block.data?.videoPoster) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoPoster"],
      message: "Vorschaubilder sind nur fuer Videobloecke erlaubt.",
    });
  }
  if (block.type === "video" && block.data?.videoPoster) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoPoster"],
      message:
        "Video-Vorschaubilder koennen nur im Kurseditor an gepruefte Assets gebunden werden.",
    });
  }
  if (block.type === "video" && block.data?.videoComposition) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoComposition"],
      message:
        "Mehrspur-Kompositionen koennen nur im Kurseditor an gepruefte Assets gebunden werden.",
    });
  }
  if (
    block.type === "video" &&
    block.data?.videoPlayback?.completionMode === "required"
  ) {
    context.addIssue({
      code: "custom",
      path: ["data", "videoPlayback", "completionMode"],
      message:
        "Pflichtwiedergabe kann nur im Kurseditor an ein geprueftes Asset gebunden werden.",
    });
  }
  const assessmentTypes = [
    "multiple_choice",
    "true_false",
    "multi_select",
    "fill_blank",
    "ordering",
  ];
  if (!block.type || !assessmentTypes.includes(block.type)) return;
  const data = block.data ?? {};
  if (!data.prompt || data.prompt.length < 3) {
    context.addIssue({
      code: "custom",
      path: ["data", "prompt"],
      message:
        "Quizfragen benoetigen einen Fragetext mit mindestens 3 Zeichen.",
    });
  }
  if (block.type === "fill_blank") {
    if (
      !Array.isArray(data.acceptedAnswers) ||
      !data.acceptedAnswers.length ||
      new Set(
        data.acceptedAnswers.map((answer) =>
          answer.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
        ),
      ).size !== data.acceptedAnswers.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["data", "acceptedAnswers"],
        message: "Lueckentexte benoetigen eindeutige akzeptierte Antworten.",
      });
    }
    return;
  }
  if (!Array.isArray(data.options)) {
    context.addIssue({
      code: "custom",
      path: ["data", "options"],
      message: "Quizfragen benoetigen Antwortoptionen.",
    });
    return;
  }
  if (block.type === "true_false" && data.options.length !== 2) {
    context.addIssue({
      code: "custom",
      path: ["data", "options"],
      message: "Wahr/Falsch-Fragen benoetigen genau zwei Antwortoptionen.",
    });
  }
  if (
    new Set(
      data.options.map((option) =>
        option.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase(),
      ),
    ).size !== data.options.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["data", "options"],
      message: "Antwortoptionen muessen eindeutig sein.",
    });
  }
  if (block.type === "ordering") return;
  if (block.type === "multi_select") {
    if (
      !Array.isArray(data.correctOptions) ||
      !data.correctOptions.length ||
      new Set(data.correctOptions).size !== data.correctOptions.length ||
      data.correctOptions.some(
        (option) => option < 0 || option >= data.options!.length,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["data", "correctOptions"],
        message: "Die korrekten Mehrfachantworten sind ungueltig.",
      });
    }
    return;
  }
  if (
    !Number.isInteger(data.correctOption) ||
    Number(data.correctOption) < 0 ||
    Number(data.correctOption) >= data.options.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["data", "correctOption"],
      message: "Die korrekte Antwortoption ist ungueltig.",
    });
  }
}

const contentBlockObjectSchema = z
  .object({
    type: z.string().trim().min(2).max(60),
    title: z.string().trim().max(220).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
    required: z.boolean().default(false),
    data: contentBlockDataSchema.default({}),
    style: z
      .object({
        width: z.enum(["compact", "content", "full"]),
        alignment: z.enum(["left", "center"]),
        surface: z.enum(["plain", "bordered", "muted"]),
      })
      .strict()
      .default({ width: "content", alignment: "left", surface: "plain" }),
  })
  .strict();

export const contentBlockCreateSchema = contentBlockObjectSchema.superRefine(
  validateAssessmentBlock,
);

export const contentBlockUpdateSchema = strictPartialWithoutDefaults(
  contentBlockObjectSchema,
)
  .extend({ revision: z.number().int().min(1) })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "revision"),
    "Mindestens ein Inhaltsfeld muss geaendert werden.",
  );

export function validateAssessmentContentBlock(input: {
  type: string;
  data: unknown;
}) {
  return contentBlockObjectSchema
    .pick({ type: true, data: true })
    .superRefine(validateAssessmentBlock)
    .safeParse(input);
}

const assessmentAnswerBlockSchema = { blockId: z.string().uuid() } as const;
const assessmentAnswerInputSchema = z.union([
  z
    .object({
      ...assessmentAnswerBlockSchema,
      selectedOption: z.number().int().min(0).max(999),
    })
    .strict(),
  z
    .object({
      ...assessmentAnswerBlockSchema,
      selectedOptions: z
        .array(z.number().int().min(0).max(999))
        .min(1)
        .max(20)
        .refine(
          (options) => new Set(options).size === options.length,
          "Antwortoptionen duerfen nicht doppelt vorkommen.",
        ),
    })
    .strict(),
  z
    .object({
      ...assessmentAnswerBlockSchema,
      textAnswer: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      ...assessmentAnswerBlockSchema,
      orderedItemIds: z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .min(2)
        .max(20)
        .refine(
          (items) => new Set(items).size === items.length,
          "Sortierelemente duerfen nicht doppelt vorkommen.",
        ),
    })
    .strict(),
]);

export const assessmentSubmissionSchema = z
  .object({
    courseId: z.string().uuid(),
    lessonId: z.string().uuid(),
    answers: z.array(assessmentAnswerInputSchema).min(1).max(100),
  })
  .strict();

export const assessmentAttemptSubmitSchema = assessmentSubmissionSchema
  .extend({ userId: z.string().uuid() })
  .strict();

export const memberCreatePolicySchema = z
  .object({
    email: z.string().trim().email().max(255),
    firstName: z.string().trim().min(2).max(100),
    lastName: z.string().trim().min(2).max(100),
    role: z.enum(["owner", "admin", "trainer", "member"]).default("member"),
    status: z.enum(["active", "invited", "disabled"]).default("invited"),
    jobTitle: z.string().trim().max(180).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
    phone: optionalPhoneSchema.optional(),
    bio: optionalNullableString,
    preferredLocale: z.enum(SUPPORTED_LOCALES).nullable().optional(),
  })
  .strict();

export const memberCreateSchema = memberCreatePolicySchema.extend({
  role: z.literal("member").default("member"),
  status: z.literal("invited").default("invited"),
});

export const memberUpdatePolicySchema = memberCreatePolicySchema
  .omit({ email: true, role: true, status: true })
  .partial()
  .extend({
    role: z.enum(["owner", "admin", "trainer", "member"]).optional(),
    status: z.enum(["active", "invited", "disabled"]).optional(),
  })
  .strict();

export const memberUpdateSchema = memberUpdatePolicySchema.extend({
  role: z.literal("member").optional(),
});

const customFieldBaseSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*$/)
      .min(2)
      .max(120),
    label: z.string().trim().min(2).max(180),
    description: optionalNullableString,
    type: z
      .enum([
        "text",
        "number",
        "boolean",
        "date",
        "select",
        "multiselect",
        "url",
        "media",
      ])
      .default("text"),
    category: z.string().trim().min(1).max(120).default("Profil"),
    required: z.boolean().default(false),
    visibility: z.enum(["member", "trainer", "admin"]).default("member"),
    personalizationEnabled: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();

const validateCustomFieldOptions = (value: {
  type?: string;
  options?: string[];
}) =>
  !value.type ||
  !["select", "multiselect"].includes(value.type) ||
  (value.options?.length ?? 0) > 0;

export const customFieldCreateSchema = customFieldBaseSchema.refine(
  validateCustomFieldOptions,
  {
    message: "Auswahlfelder benoetigen mindestens eine Option.",
    path: ["options"],
  },
).refine(
  (value) =>
    !value.personalizationEnabled ||
    (value.visibility === "member" && !["url", "media"].includes(value.type)),
  {
    message:
      "Personalisierung ist nur fuer mitgliedsichtbare Text-, Auswahl-, Zahlen-, Datums- und Ja/Nein-Felder erlaubt.",
    path: ["personalizationEnabled"],
  },
);
export const customFieldUpdateSchema = strictPartialWithoutDefaults(
  customFieldBaseSchema,
);
const customFieldValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(1000)).max(100),
  z.null(),
]);
export const customFieldValuesSchema = z
  .object({
    values: z
      .array(
        z
          .object({ fieldId: z.string().uuid(), value: customFieldValueSchema })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.values.map((entry) => entry.fieldId)).size ===
      input.values.length,
    {
      message: "Profilfelder duerfen nicht doppelt uebergeben werden.",
      path: ["values"],
    },
  );

export const enrollmentCreateSchema = z
  .object({ courseId: z.string().uuid() })
  .strict();

export const enrollmentUpdateSchema = z
  .object({
    status: z.enum(["not_started", "in_progress", "completed"]),
    progress: z.number().int().min(0).max(100),
  })
  .partial()
  .strict();

export const lessonProgressUpdateSchema = z
  .object({
    status: z.enum(["not_started", "in_progress", "completed"]),
    percent: z.number().int().min(0).max(100),
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.status !== "completed" ||
      value.percent === undefined ||
      value.percent === 100,
    {
      message:
        "Eine abgeschlossene Lektion muss 100 Prozent Fortschritt haben.",
      path: ["percent"],
    },
  );

export const groupCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: optionalNullableString,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#4f7cac"),
  })
  .strict();

export const groupUpdateSchema =
  strictPartialWithoutDefaults(groupCreateSchema);
export const groupMemberSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export const bundleCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    description: optionalNullableString,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#ee6c5d"),
    active: z.boolean().default(true),
  })
  .strict();

export const bundleUpdateSchema =
  strictPartialWithoutDefaults(bundleCreateSchema);

const bundleCourseDateSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));
const bundleCourseWindowIsValid = (value: {
  availableFrom: Date | null;
  availableUntil: Date | null;
}) =>
  !value.availableFrom ||
  !value.availableUntil ||
  value.availableUntil.getTime() > value.availableFrom.getTime();

export const bundleCoursePolicySchema = z
  .object({
    availableFrom: bundleCourseDateSchema.nullable(),
    availableUntil: bundleCourseDateSchema.nullable(),
    delayDays: z.number().int().min(0).max(3650),
    visible: z.boolean(),
  })
  .strict()
  .refine(bundleCourseWindowIsValid, {
    message: "Das Enddatum muss nach dem Startdatum liegen.",
    path: ["availableUntil"],
  });

export const bundleCourseSchema = z
  .object({
    courseId: z.string().uuid(),
    availableFrom: bundleCourseDateSchema.nullable().default(null),
    availableUntil: bundleCourseDateSchema.nullable().default(null),
    delayDays: z.number().int().min(0).max(3650).default(0),
    visible: z.boolean().default(true),
  })
  .strict()
  .refine(bundleCourseWindowIsValid, {
    message: "Das Enddatum muss nach dem Startdatum liegen.",
    path: ["availableUntil"],
  });

const eventAudienceIdListSchema = z
  .array(z.string().uuid())
  .max(500)
  .default([]);
const eventDateSchema = z
  .union([z.date(), z.string().datetime({ offset: true })])
  .transform((value) => (value instanceof Date ? value : new Date(value)));
const eventTimeZoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidEventTimeZone, "timezone muss eine gueltige IANA-Zeitzone sein.");

export const eventAudienceSchema = z
  .object({
    mode: z.enum(["tenant", "restricted"]).default("tenant"),
    userIds: eventAudienceIdListSchema,
    groupIds: eventAudienceIdListSchema,
    bundleIds: eventAudienceIdListSchema,
  })
  .strict()
  .refine(
    (value) =>
      value.mode === "tenant" ||
      value.userIds.length + value.groupIds.length + value.bundleIds.length > 0,
    {
      message:
        "Eine eingeschraenkte Zielgruppe benoetigt mindestens einen Grant.",
    },
  );

export const eventCreateSchema = z
  .object({
    title: z.string().trim().min(3).max(220),
    description: optionalNullableString,
    type: z
      .enum(["live_call", "workshop", "deadline", "webinar"])
      .default("live_call"),
    startsAt: eventDateSchema,
    endsAt: eventDateSchema,
    timezone: eventTimeZoneSchema.default(DEFAULT_EVENT_TIME_ZONE),
    meetingUrl: z.string().url().max(2000).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#ee6c5d"),
    capacity: z.number().int().min(1).max(100_000).nullable().optional(),
    audience: eventAudienceSchema.optional(),
  })
  .strict()
  .refine((value) => value.endsAt > value.startsAt, {
    message: "endsAt muss nach startsAt liegen.",
    path: ["endsAt"],
  });

export const eventUpdateSchema = z
  .object({
    title: z.string().trim().min(3).max(220).optional(),
    description: optionalNullableString,
    type: z.enum(["live_call", "workshop", "deadline", "webinar"]).optional(),
    startsAt: eventDateSchema.optional(),
    endsAt: eventDateSchema.optional(),
    timezone: eventTimeZoneSchema.optional(),
    meetingUrl: z.string().url().max(2000).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    capacity: z.number().int().min(1).max(100_000).nullable().optional(),
    audience: eventAudienceSchema.optional(),
    lifecycleReason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

export const attendanceSchema = z
  .object({
    userId: z.string().uuid(),
    status: z.enum(["going", "maybe", "declined"]),
  })
  .strict();
export const attendanceUpdateSchema = attendanceSchema.omit({ userId: true });

export const notificationListQuerySchema = z
  .object({
    userId: z.string().uuid(),
    unread: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export const notificationUpdateSchema = z
  .object({
    userId: z.string().uuid(),
    read: z.boolean(),
  })
  .strict();

export const notificationUserSchema = z
  .object({ userId: z.string().uuid() })
  .strict();
export const notificationParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const notificationBulkMarkReadSchema = z
  .object({
    userId: z.string().uuid(),
    notificationIds: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .refine(
        (values) => new Set(values).size === values.length,
        "notificationIds duerfen keine Duplikate enthalten.",
      )
      .optional(),
  })
  .strict();

export const lessonAvailabilitySubscriptionMutationSchema = z
  .object({
    userId: z.string().uuid(),
    courseId: z.string().uuid(),
    lessonId: z.string().uuid(),
  })
  .strict();

export const lessonAvailabilitySubscriptionListQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    courseId: z.string().uuid().optional(),
    lessonId: z.string().uuid().optional(),
    status: z.enum(["active", "cancelled", "fulfilled"]).optional(),
  })
  .strict();

const announcementBaseSchema = z
  .object({
    title: z.string().trim().min(2).max(180),
    body: z.string().trim().min(3).max(5000).optional(),
    tone: z.enum(["info", "success", "warning", "critical"]).default("info"),
    placement: z.enum(["banner", "modal"]).default("banner"),
    audience: z.enum(["all", "user", "group"]).default("all"),
    audienceId: z.string().uuid().nullable().optional(),
    targetRuleSet: announcementTargetRuleSetSchema.default(
      EMPTY_ANNOUNCEMENT_TARGET_RULE_SET,
    ),
    contentDocument: announcementContentDocumentSchema.optional(),
    href: z
      .string()
      .trim()
      .max(2000)
      .refine(
        (value) => Boolean(safeAnnouncementHref(value)),
        "Der Aktionslink muss intern oder eine sichere HTTP(S)-URL sein.",
      )
      .nullable()
      .optional(),
    actionLabel: z.string().trim().min(1).max(80).nullable().optional(),
    startsAt: z.coerce.date().default(() => new Date()),
    endsAt: z.coerce.date().nullable().optional(),
    dismissible: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .strict();

export const announcementCreateSchema = announcementBaseSchema.superRefine(
  (value, context) => {
    if (!value.body && !value.contentDocument) {
      context.addIssue({
        code: "custom",
        message: "Eine Nachricht oder ein Blockdokument ist erforderlich.",
        path: ["body"],
      });
    }
    if (value.audience === "all" && value.audienceId) {
      context.addIssue({
        code: "custom",
        message: "Die Zielgruppe Alle verwendet keine audienceId.",
        path: ["audienceId"],
      });
    }
    if (value.audience !== "all" && !value.audienceId) {
      context.addIssue({
        code: "custom",
        message: "Die gewaehlte Zielgruppe benoetigt eine audienceId.",
        path: ["audienceId"],
      });
    }
    if (value.endsAt && value.endsAt <= value.startsAt) {
      context.addIssue({
        code: "custom",
        message: "Das Enddatum muss nach dem Startdatum liegen.",
        path: ["endsAt"],
      });
    }
    if (value.actionLabel && !value.href) {
      context.addIssue({
        code: "custom",
        message: "Eine Aktionsbeschriftung benoetigt einen Link.",
        path: ["href"],
      });
    }
  },
);

export const announcementUpdateSchema = strictPartialWithoutDefaults(
  announcementBaseSchema,
);

export const globalSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(200),
    types: z.preprocess(
      (value) =>
        typeof value === "string" && value.length > 0
          ? value
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean)
          : ["courses", "modules", "members", "community", "hubs", "events"],
      z
        .array(
          z.enum([
            "courses",
            "modules",
            "members",
            "community",
            "hubs",
            "events",
          ]),
        )
        .min(1)
        .max(6)
        .transform((values) => [...new Set(values)]),
    ),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  })
  .strict();

export const postCreateSchema = z
  .object({
    spaceId: z.string().uuid(),
    authorId: z.string().uuid(),
    courseId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(2).max(240).nullable().optional(),
    content: z.string().trim().min(3).max(10_000).optional(),
    richText: submissionRichTextDocumentSchema.optional(),
    attachmentIds: z.array(z.string().uuid()).max(6).default([]),
    pinned: z.boolean().default(false),
    locked: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.content === undefined) === (value.richText === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "content und richText muessen genau alternativ gesetzt sein.",
      });
    }
  });

export const postUpdateSchema = z
  .object({
    title: z.string().trim().min(2).max(240).nullable().optional(),
    content: z.string().trim().min(3).max(10_000).optional(),
    richText: submissionRichTextDocumentSchema.optional(),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
    expectedContentVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.content !== undefined && value.richText !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "content und richText duerfen nicht gemeinsam gesetzt sein.",
      });
    }
  });

const communityPermissionFields = {
  canView: z.boolean(),
  canPost: z.boolean(),
  canComment: z.boolean(),
};

export const communityAccessRuleSchema = z
  .discriminatedUnion("subjectType", [
    z
      .object({
        subjectType: z.literal("role"),
        subjectRole: z.enum(["owner", "admin", "trainer", "member"]),
        ...communityPermissionFields,
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("user"),
        subjectUserId: z.string().uuid(),
        ...communityPermissionFields,
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("group"),
        subjectGroupId: z.string().uuid(),
        ...communityPermissionFields,
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("bundle"),
        subjectBundleId: z.string().uuid(),
        ...communityPermissionFields,
      })
      .strict(),
  ])
  .superRefine((rule, context) => {
    if (!rule.canView && (rule.canPost || rule.canComment)) {
      context.addIssue({
        code: "custom",
        path: ["canView"],
        message: "Schreib- und Kommentarrechte setzen Leserechte voraus.",
      });
    }
    if (!rule.canView && !rule.canPost && !rule.canComment) {
      context.addIssue({
        code: "custom",
        path: ["canView"],
        message: "Eine Zugriffsregel muss mindestens ein Recht vergeben.",
      });
    }
  });

export const communitySpaceAccessPolicySchema = z
  .object({
    accessMode: z.enum(["open", "restricted"]),
    rules: z.array(communityAccessRuleSchema).max(200),
  })
  .strict();

export const communitySpaceCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .optional(),
    description: optionalNullableString,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#2bb7a9"),
    type: z.enum(["feed", "discussion", "announcement"]).default("feed"),
    accessMode: z.enum(["open", "restricted"]).default("open"),
    areaId: z.string().uuid().optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export const communitySpaceUpdateSchema = strictPartialWithoutDefaults(
  communitySpaceCreateSchema.omit({
    accessMode: true,
    areaId: true,
    position: true,
  }),
);

export const communityAreaCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .optional(),
    description: optionalNullableString,
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();

export const communityAreaUpdateSchema = strictPartialWithoutDefaults(
  communityAreaCreateSchema.omit({ position: true }),
);

export const communityAreaMoveSchema = z
  .object({ position: z.number().int().min(0).max(10_000) })
  .strict();

export const communitySpaceMoveSchema = z
  .object({
    areaId: z.string().uuid(),
    position: z.number().int().min(0).max(10_000),
  })
  .strict();

export const communityPublicProfileFieldSchema = z
  .object({
    standardField: z
      .enum([
        "avatar",
        "job_title",
        "department",
        "bio",
        "community_points",
        "badges",
      ])
      .nullable()
      .optional(),
    customFieldId: z.string().uuid().nullable().optional(),
    requiredForPosting: z.boolean().default(false),
  })
  .strict()
  .superRefine((field, context) => {
    if (Boolean(field.standardField) === Boolean(field.customFieldId)) {
      context.addIssue({
        code: "custom",
        path: ["standardField"],
        message: "Jedes Profilfeld benoetigt genau eine Quelle.",
      });
    }
  });

export const communityProfileSettingsReplaceSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    completionGateEnabled: z.boolean(),
    fields: z.array(communityPublicProfileFieldSchema).max(100),
  })
  .strict();

export const commentCreateSchema = z
  .object({
    authorId: z.string().uuid(),
    content: z.string().trim().min(1).max(5000).optional(),
    richText: submissionRichTextDocumentSchema.optional(),
    parentId: z.string().uuid().nullable().optional(),
    attachmentIds: z.array(z.string().uuid()).max(3).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.content === undefined) === (value.richText === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "content und richText muessen genau alternativ gesetzt sein.",
      });
    }
  });
export const commentUpdateSchema = z
  .object({
    content: z.string().trim().min(1).max(5000).optional(),
    richText: submissionRichTextDocumentSchema.optional(),
    expectedContentVersion: z.number().int().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.content === undefined) === (value.richText === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "content und richText muessen genau alternativ gesetzt sein.",
      });
    }
  });
export const postReactionSchema = z
  .object({
    userId: z.string().uuid(),
    reaction: z
      .enum(["like", "celebrate", "insightful", "question"])
      .default("like"),
  })
  .strict();
export const commentReactionUpdateSchema = z
  .object({
    userId: z.string().uuid().optional(),
    reaction: z.enum(["like", "celebrate", "insightful", "question"]),
  })
  .strict();
export const commentReactionActorQuerySchema = z
  .object({ userId: z.string().uuid().optional() })
  .strict();
export const postVoteSchema = z
  .object({
    userId: z.string().uuid(),
    value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  })
  .strict();

export const communityPostParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const communityCommentParamsSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const communityPostActorParamsSchema = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict();

export const communityFeedQuerySchema = z
  .object({
    mode: z.enum(["for_you", "following", "latest"]).default("for_you"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();

export const communityCommentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2048).optional(),
    parentId: z.string().uuid().optional(),
  })
  .strict();

export const communityFollowParamsSchema = z
  .object({
    targetType: z.enum(["author", "space"]),
    targetId: z.string().uuid(),
  })
  .strict();

export const communityFollowUpdateSchema = z
  .object({ notify: z.boolean().default(false) })
  .strict();

export const communityBoostListQuerySchema = z
  .object({
    state: z.enum(["all", "active", "scheduled", "expired"]).default("all"),
  })
  .strict();

export const communityBoostUpdateSchema = z
  .object({
    strength: z.enum(["light", "medium", "high"]),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.startsAt >= value.endsAt ||
      value.endsAt.getTime() - value.startsAt.getTime() > 90 * 24 * 60 * 60_000
    ) {
      context.addIssue({
        code: "custom",
        path: ["endsAt"],
        message:
          "Der Boost muss nach seinem Start und hoechstens 90 Tage spaeter enden.",
      });
    }
  });

export const communityModerationPolicyUpdateSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    postApproval: z.enum(["off", "members", "non_admins"]),
    commentApproval: z.enum(["off", "members", "non_admins"]),
    automationMode: z.enum(["off", "observe", "enforce"]),
    reportThreshold: z.number().int().min(2).max(20).nullable(),
    duplicateWindowMinutes: z.number().int().min(0).max(1440),
    linkLimit: z.number().int().min(0).max(20),
  })
  .strict();

export const communityModerationQueueQuerySchema = z
  .object({
    status: z
      .enum(["open", "reviewing", "resolved", "appealed"])
      .optional(),
    targetType: z.enum(["post", "comment"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();

export const communityModerationCaseClaimSchema = z
  .object({
    expectedDecisionVersion: z.number().int().min(1),
    expectedContentVersion: z.number().int().min(1),
  })
  .strict();

export const communityModerationCaseDecisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "restore"]),
    expectedDecisionVersion: z.number().int().min(1),
    expectedContentVersion: z.number().int().min(1),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

export const communityModerationAppealDecisionSchema = z
  .object({
    action: z.enum(["uphold", "overturn"]),
    expectedDecisionVersion: z.number().int().min(1),
    expectedContentVersion: z.number().int().min(1),
    note: z.string().trim().min(3).max(1000),
  })
  .strict();

export const communityModerationAppealCreateSchema = z
  .object({
    expectedDecisionVersion: z.number().int().min(1),
    statement: z.string().trim().min(3).max(2000),
  })
  .strict();

export const communityLevelInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    position: z.number().int().min(1).max(100),
    name: z.string().trim().min(1).max(160),
    description: z.string().max(5000),
    minPoints: z.number().int().min(0).max(2_147_483_647),
    icon: z.string().trim().min(1).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    active: z.boolean(),
  })
  .strict();

export const communityLevelConfigurationUpdateSchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    enabled: z.boolean(),
    levels: z.array(communityLevelInputSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    const positions = new Set<number>();
    const thresholds = new Set<number>();
    for (const [index, level] of value.levels.entries()) {
      if (level.id && ids.has(level.id)) {
        context.addIssue({
          code: "custom",
          path: ["levels", index, "id"],
          message: "Level-IDs muessen eindeutig sein.",
        });
      }
      if (level.id) ids.add(level.id);
      if (positions.has(level.position)) {
        context.addIssue({
          code: "custom",
          path: ["levels", index, "position"],
          message: "Level-Positionen muessen eindeutig sein.",
        });
      }
      positions.add(level.position);
      if (thresholds.has(level.minPoints)) {
        context.addIssue({
          code: "custom",
          path: ["levels", index, "minPoints"],
          message: "Level-Schwellen muessen eindeutig sein.",
        });
      }
      thresholds.add(level.minPoints);
    }

    const activeLevels = value.levels.filter((level) => level.active);
    if (
      value.enabled &&
      (!activeLevels.length ||
        Math.min(...activeLevels.map((level) => level.minPoints)) !== 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["levels"],
        message: "Ein aktives Levelsystem muss bei null Punkten beginnen.",
      });
    }
  });

export const badgeGroupCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2_000).default(""),
    displayMode: z.enum(["all", "highest"]).default("all"),
    sortOrder: z.number().int().min(0).max(1_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const badgeGroupUpdateSchema =
  strictPartialWithoutDefaults(badgeGroupCreateSchema);

export const badgeCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .optional(),
    description: z.string().trim().min(3).max(5000),
    groupId: z.string().uuid().nullable().optional(),
    icon: z.string().trim().min(1).max(60).default("award"),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#d6a536"),
    pointsThreshold: z
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .nullable()
      .optional(),
    sortOrder: z.number().int().min(0).max(1_000).default(0),
    active: z.boolean().default(true),
  })
  .strict();
export const badgeUpdateSchema =
  strictPartialWithoutDefaults(badgeCreateSchema);
export const badgeAssignSchema = z
  .object({
    source: z
      .string()
      .trim()
      .max(180)
      .refine(
        (value) => !/^points:[0-9]+$/.test(value),
        "Diese Badge-Quelle ist fuer automatische Punkte-Badges reserviert.",
      )
      .nullable()
      .optional(),
  })
  .strict();

export const submissionReviewSchema = z
  .object({
    decision: z.enum(["revision", "approved"]),
    feedback: z.string().trim().min(3).max(5000),
    score: z.number().min(0).max(100),
    reviewerId: z.string().uuid().optional(),
    annotations: submissionReviewAnnotationsInputSchema.default([]),
  })
  .strict();

export const submissionCreateSchema = z
  .object({
    userId: z.string().uuid(),
    courseId: z.string().uuid(),
    lessonId: z.string().uuid(),
    blockId: z.string().uuid(),
    title: z.string().trim().min(3).max(220),
    type: z.enum(["text", "file", "audio", "video"]).default("text"),
    content: z.string().max(50_000).nullable().optional(),
    richText: submissionRichTextDocumentSchema.nullable().optional(),
    fileName: z.string().trim().max(500).nullable().optional(),
    attachmentIds: z
      .array(z.string().uuid())
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.richText != null && value.content?.trim()) {
      context.addIssue({
        code: "custom",
        path: ["richText"],
        message: "Plaintext und Rich-Text duerfen nicht kombiniert werden.",
      });
    }
  });

export const feedbackCreateSchema = z
  .object({
    userId: z.string().uuid(),
    courseId: z.string().uuid().nullable().optional(),
    lessonId: z.string().uuid().nullable().optional(),
    type: z.enum(["course", "lesson", "platform", "event"]).default("course"),
    rating: z.number().int().min(1).max(5),
    content: z.string().trim().max(10_000),
    testimonialConsent: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type !== "lesson" && value.content.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["content"],
        message: "Feedbacktext muss mindestens 3 Zeichen enthalten.",
      });
    }
    if (
      (value.type === "course" || value.type === "lesson") &&
      !value.courseId
    ) {
      context.addIssue({
        code: "custom",
        path: ["courseId"],
        message: "Kurs- und Lektionsfeedback benoetigt eine courseId.",
      });
    }
    if (value.type === "lesson" && !value.lessonId) {
      context.addIssue({
        code: "custom",
        path: ["lessonId"],
        message: "Lektionsfeedback benoetigt eine lessonId.",
      });
    }
  });
export const feedbackUpdateSchema = z
  .object({
    status: z.enum(["new", "reviewed", "archived"]),
  })
  .strict();
export const feedbackReplySchema = z
  .object({
    subject: z.string().trim().min(3).max(200),
    message: z.string().trim().min(3).max(10_000),
  })
  .strict();

const hubColumnBaseSchema = {
  title: z.string().trim().min(1).max(180),
  description: z.string().max(2000).optional(),
  color: z.string().max(20).optional(),
};

const hubColumnSchema = z.union([
  z
    .object({
      ...hubColumnBaseSchema,
      type: z.enum(["link", "text", "contact", "stat", "event"]),
      href: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      title: hubColumnBaseSchema.title,
      description: z
        .string()
        .min(1)
        .max(HUB_CUSTOM_CODE_MAX_LENGTH)
        .refine((value) => Boolean(value.trim()), {
          message: "Custom-Code darf nicht leer sein.",
        }),
      color: hubColumnBaseSchema.color,
      type: z.literal("code"),
    })
    .strict(),
  z
    .object({
      ...hubColumnBaseSchema,
      type: z.literal("embed"),
      href: z
        .string()
        .url()
        .max(2000)
        .refine((value) => Boolean(safeHubEmbedUrl(value)), {
          message: "Die Embed-URL ist fuer diesen Anbieter nicht freigegeben.",
        })
        .transform((value) => safeHubEmbedUrl(value)!),
    })
    .strict(),
  z
    .object({
      ...hubColumnBaseSchema,
      type: z.literal("data_form"),
      formId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      ...hubColumnBaseSchema,
      type: z.literal("ai_agent"),
      agentId: z.string().uuid(),
    })
    .strict(),
]);

export const hubCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(180),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(140)
      .optional(),
    description: optionalNullableString,
    status: z.enum(["draft", "published", "archived"]).default("published"),
    layout: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            category: z.string().trim().min(1).max(80).optional(),
            columns: z.array(hubColumnSchema).max(12),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();

export const hubUpdateSchema = strictPartialWithoutDefaults(hubCreateSchema);
export const hubCloneSchema = z
  .object({ title: z.string().trim().min(2).max(180).optional() })
  .strict();
export const hubAccessSchema = z
  .object({
    subjectType: z.enum(["user", "group", "bundle"]),
    subjectId: z.string().uuid(),
  })
  .strict();

export const agentCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(3).max(5000),
    systemPrompt: z.string().trim().min(10).max(50_000),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#2bb7a9"),
    icon: z.string().trim().min(1).max(40).default("sparkles"),
    active: z.boolean().default(true),
  })
  .strict();

export const agentUpdateSchema = z
  .object({ active: z.boolean().optional() })
  .strict();

export const agentChatCreateSchema = z
  .object({
    memberId: z.string().uuid().nullable().optional(),
    title: z.string().trim().min(1).max(220).nullable().optional(),
    initialMessage: z.string().trim().min(1).max(50_000).nullable().optional(),
    metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
  })
  .strict();

export const agentChatUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(220).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
    metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
  })
  .strict();

export const chatMessageCreateSchema = z
  .object({
    content: z.string().trim().min(1).max(50_000),
    metadata: z.record(z.string().min(1).max(120), z.unknown()).optional(),
  })
  .strict();

export const webhookCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    url: z
      .string()
      .url()
      .max(2000)
      .refine(
        (value) =>
          value.startsWith("https://") || process.env.NODE_ENV !== "production",
        "In Produktion ist HTTPS erforderlich.",
      ),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length),
    active: z.boolean().default(true),
  })
  .strict();

export const webhookUpdateSchema =
  strictPartialWithoutDefaults(webhookCreateSchema);

export const apiKeyCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    scopes: z
      .array(z.enum(["*", ...API_SCOPES]))
      .min(1)
      .max(API_SCOPES.length + 1)
      .refine(
        (values) => new Set(values).size === values.length,
        "Scopes duerfen nicht doppelt vorkommen.",
      ),
    expiresAt: z.coerce.date().nullable().optional(),
  })
  .strict();

export const apiKeyUpdateSchema = apiKeyCreateSchema.partial().strict();

export const privacyRequestCreateSchema = z
  .object({
    subjectUserId: z.string().uuid(),
    clientRequestId: z
      .string()
      .trim()
      .min(4)
      .max(180)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    type: z.enum(["access_export", "erasure"]),
  })
  .strict();
