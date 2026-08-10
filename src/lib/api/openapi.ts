/**
 * OpenAPI 3.1 contract for the implemented /api/v1 route handlers.
 *
 * Request components are derived from the same Zod schemas used by the route
 * handlers. Paths and response statuses remain explicit so this document also
 * acts as a reviewable HTTP contract.
 */

import { z } from "zod";
import * as apiSchemas from "@/lib/api/schemas";
import {
  AUTOMATION_CONNECTOR_CONTRACT_VERSION,
  AUTOMATION_CONNECTOR_REQUIRED_SCOPES,
} from "@/lib/automation-connector";
import {
  mediaAssetCreateSchema,
  mediaMultipartPartAuthorizationSchema,
} from "@/lib/media/api-schemas";
import { MEDIA_PURPOSES } from "@/lib/media/mime-policy";
import {
  examAttemptApiStartSchema,
  examAttemptStartSchema,
  examAttemptDraftSchema,
  examAttemptReleaseSchema,
  examAttemptSubmitSchema,
} from "@/lib/exam-lifecycle-model";
import { stockImageSelectionInputSchema } from "@/lib/stock-image-model";

type OpenApiMap = Record<string, unknown>;
export type OpenApiHttpMethod = "get" | "post" | "patch" | "put" | "delete";

export type OpenApiOperation = {
  tags: string[];
  summary: string;
  description?: string;
  deprecated?: boolean;
  operationId: string;
  security?: OpenApiMap[];
  parameters?: OpenApiMap[];
  requestBody?: OpenApiMap;
  responses: Record<string, OpenApiMap>;
  "x-required-scopes"?: string[];
  "x-always-error"?: boolean;
};

export type OpenApiPathItem = Partial<
  Record<OpenApiHttpMethod, OpenApiOperation>
>;
export type OpenApiPaths = Record<string, OpenApiPathItem>;

type OpenApiDocumentShape = {
  openapi: "3.1.0";
  jsonSchemaDialect: string;
  info: OpenApiMap;
  servers: readonly OpenApiMap[];
  tags: readonly OpenApiMap[];
  security: readonly OpenApiMap[];
  paths: OpenApiPaths;
  components: {
    securitySchemes: Record<string, OpenApiMap>;
    parameters: Record<string, OpenApiMap>;
    headers: Record<string, OpenApiMap>;
    responses: Record<string, OpenApiMap>;
    schemas: Record<string, OpenApiMap>;
  };
};

const schemaRef = (name: string): OpenApiMap => ({
  $ref: `#/components/schemas/${name}`,
});
const parameterRef = (name: string): OpenApiMap => ({
  $ref: `#/components/parameters/${name}`,
});
const headerRef = (name: string): OpenApiMap => ({
  $ref: `#/components/headers/${name}`,
});
const responseRef = (name: string): OpenApiMap => ({
  $ref: `#/components/responses/${name}`,
});

const uuidSchema = { type: "string", format: "uuid" } as const;
const dateTimeSchema = { type: "string", format: "date-time" } as const;
const nullableDateTimeSchema = {
  anyOf: [dateTimeSchema, { type: "null" }],
} as const;

function zodRequestSchema(
  source: z.ZodType,
  propertyOverrides: Record<string, OpenApiMap> = {},
): OpenApiMap {
  const generated = z.toJSONSchema(source, {
    io: "input",
    unrepresentable: "any",
  }) as OpenApiMap;
  delete generated.$schema;
  if (Object.keys(propertyOverrides).length) {
    generated.properties = {
      ...((generated.properties as Record<string, OpenApiMap> | undefined) ??
        {}),
      ...propertyOverrides,
    };
  }
  return generated;
}

function courseWidgetRequestOpenApiSchema(source: z.ZodType): OpenApiMap {
  const generated = zodRequestSchema(source);
  const variants = generated.oneOf as OpenApiMap[] | undefined;
  if (!variants || variants.length !== 3) return generated;
  const imageVariant = variants[2];
  const imageProperties = imageVariant.properties as
    Record<string, OpenApiMap> | undefined;
  if (!imageProperties) return generated;
  const sharedProperties = {
    type: { type: "string", const: "image_link" },
    altText: imageProperties.altText,
    linkUrl: imageProperties.linkUrl,
    sortOrder: imageProperties.sortOrder,
  };
  return {
    oneOf: [
      variants[0],
      variants[1],
      {
        type: "object",
        additionalProperties: false,
        required: ["type", "imageUrl", "altText", "linkUrl"],
        properties: {
          ...sharedProperties,
          mediaAssetId: {
            type: "null",
            description: "Omit this field when a public image URL is used.",
          },
          imageUrl: {
            type: "string",
            minLength: 1,
            maxLength: 2_000,
            pattern: "^(?:/images/|https://)",
            description: "Safe public /images path or HTTPS URL.",
          },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["type", "mediaAssetId", "altText", "linkUrl"],
        properties: {
          ...sharedProperties,
          mediaAssetId: uuidSchema,
          imageUrl: {
            type: "string",
            pattern: "^/api/media-assets/[0-9a-fA-F-]{36}/download$",
            description:
              "Optional canonical download URL. When supplied, its UUID must equal mediaAssetId.",
          },
        },
      },
    ],
  };
}

const richTextLeafOpenApi: OpenApiMap = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "text"],
      properties: {
        type: { type: "string", const: "text" },
        text: { type: "string" },
        bold: { type: "boolean", const: true },
        italic: { type: "boolean", const: true },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["type"],
      properties: { type: { type: "string", const: "linebreak" } },
    },
  ],
};

const richTextInlineOpenApi: OpenApiMap = {
  oneOf: [
    ...(richTextLeafOpenApi.oneOf as OpenApiMap[]),
    {
      type: "object",
      additionalProperties: false,
      required: ["type", "href", "children"],
      properties: {
        type: { type: "string", const: "link" },
        href: { type: "string", maxLength: 2000 },
        children: {
          type: "array",
          maxItems: 1000,
          items: richTextLeafOpenApi,
        },
      },
    },
  ],
};

const richTextDocumentOpenApi: OpenApiMap = {
  type: "object",
  additionalProperties: false,
  required: ["version", "blocks"],
  properties: {
    version: { type: "integer", const: 1 },
    blocks: {
      type: "array",
      maxItems: 200,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "children"],
            properties: {
              type: { type: "string", const: "paragraph" },
              children: {
                type: "array",
                maxItems: 1000,
                items: richTextInlineOpenApi,
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "level", "children"],
            properties: {
              type: { type: "string", const: "heading" },
              level: { type: "integer", enum: [2, 3] },
              children: {
                type: "array",
                maxItems: 1000,
                items: richTextInlineOpenApi,
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "style", "items"],
            properties: {
              type: { type: "string", const: "list" },
              style: { type: "string", enum: ["bullet", "number"] },
              items: {
                type: "array",
                maxItems: 100,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["children"],
                  properties: {
                    children: {
                      type: "array",
                      maxItems: 1000,
                      items: richTextInlineOpenApi,
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
};

const announcementContentDocumentOpenApi: OpenApiMap = {
  type: "object",
  additionalProperties: false,
  required: ["version", "blocks"],
  properties: {
    version: { type: "integer", const: 1 },
    blocks: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "document"],
            properties: {
              id: uuidSchema,
              type: { type: "string", const: "rich_text" },
              document: schemaRef("RichTextDocument"),
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "tone", "title", "body"],
            properties: {
              id: uuidSchema,
              type: { type: "string", const: "callout" },
              tone: {
                type: "string",
                enum: ["info", "success", "warning", "critical"],
              },
              title: {
                anyOf: [
                  { type: "string", minLength: 1, maxLength: 120 },
                  { type: "null" },
                ],
              },
              body: { type: "string", minLength: 1, maxLength: 1000 },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "style"],
            properties: {
              id: uuidSchema,
              type: { type: "string", const: "divider" },
              style: {
                type: "string",
                enum: ["solid", "dashed", "dotted"],
              },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "label", "href", "style"],
            properties: {
              id: uuidSchema,
              type: { type: "string", const: "cta" },
              label: { type: "string", minLength: 1, maxLength: 80 },
              href: { type: "string", minLength: 1, maxLength: 2000 },
              style: {
                type: "string",
                enum: ["primary", "secondary"],
              },
            },
          },
        ],
      },
    },
  },
};

const structuredContentDocumentOpenApi: Record<string, OpenApiMap> = {
  callout: {
    type: "object",
    additionalProperties: false,
    required: ["version", "tone", "body"],
    properties: {
      version: { type: "integer", const: 1 },
      tone: { type: "string", enum: ["info", "success", "warning", "danger"] },
      heading: { type: "string", maxLength: 220 },
      body: { type: "string", minLength: 1, maxLength: 12000 },
    },
  },
  quote: {
    type: "object",
    additionalProperties: false,
    required: ["version", "quote"],
    properties: {
      version: { type: "integer", const: 1 },
      quote: { type: "string", minLength: 1, maxLength: 12000 },
      attribution: { type: "string", maxLength: 500 },
      sourceUrl: { type: "string", maxLength: 2000 },
    },
  },
  divider: {
    type: "object",
    additionalProperties: false,
    required: ["version", "style", "spacing"],
    properties: {
      version: { type: "integer", const: 1 },
      style: { type: "string", enum: ["solid", "dashed", "dotted"] },
      spacing: { type: "string", enum: ["compact", "normal", "wide"] },
    },
  },
  accordion: {
    type: "object",
    additionalProperties: false,
    required: ["version", "items"],
    properties: {
      version: { type: "integer", const: 1 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "body", "openByDefault"],
          properties: {
            id: { type: "string", maxLength: 80 },
            title: { type: "string", minLength: 1, maxLength: 220 },
            body: { type: "string", minLength: 1, maxLength: 12000 },
            openByDefault: { type: "boolean" },
          },
        },
      },
    },
  },
  tabs: {
    type: "object",
    additionalProperties: false,
    required: ["version", "tabs", "defaultTabId"],
    properties: {
      version: { type: "integer", const: 1 },
      defaultTabId: { type: "string", maxLength: 80 },
      tabs: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "label", "body"],
          properties: {
            id: { type: "string", maxLength: 80 },
            label: { type: "string", minLength: 1, maxLength: 120 },
            body: { type: "string", minLength: 1, maxLength: 12000 },
          },
        },
      },
    },
  },
  columns: {
    type: "object",
    additionalProperties: false,
    required: ["version", "layout", "columns"],
    properties: {
      version: { type: "integer", const: 1 },
      layout: {
        type: "string",
        enum: ["equal", "sidebar_left", "sidebar_right"],
      },
      columns: {
        type: "array",
        minItems: 2,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "body"],
          properties: {
            id: { type: "string", maxLength: 80 },
            heading: { type: "string", maxLength: 220 },
            body: { type: "string", minLength: 1, maxLength: 12000 },
          },
        },
      },
    },
  },
  download: {
    type: "object",
    additionalProperties: false,
    required: ["version", "mediaAssetId", "fileName", "label"],
    properties: {
      version: { type: "integer", const: 1 },
      mediaAssetId: uuidSchema,
      fileName: { type: "string", minLength: 1, maxLength: 500 },
      label: { type: "string", minLength: 1, maxLength: 220 },
      description: { type: "string", maxLength: 2000 },
    },
  },
  code: {
    type: "object",
    additionalProperties: false,
    required: ["version", "language", "code", "lineNumbers", "wrap"],
    properties: {
      version: { type: "integer", const: 1 },
      language: {
        type: "string",
        enum: [
          "plaintext",
          "bash",
          "css",
          "html",
          "javascript",
          "json",
          "python",
          "sql",
          "typescript",
        ],
      },
      code: { type: "string", minLength: 1, maxLength: 30000 },
      lineNumbers: { type: "boolean" },
      wrap: { type: "boolean" },
    },
  },
  table: {
    type: "object",
    additionalProperties: false,
    required: ["version", "headers", "rows", "striped"],
    properties: {
      version: { type: "integer", const: 1 },
      caption: { type: "string", maxLength: 500 },
      headers: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      rows: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        items: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", maxLength: 2000 },
        },
      },
      striped: { type: "boolean" },
    },
  },
};

function contentBlockRequestSchema(source: z.ZodType) {
  const generated = zodRequestSchema(source);
  const properties = generated.properties as Record<string, OpenApiMap>;
  const data = properties.data as OpenApiMap;
  data.properties = {
    ...((data.properties as Record<string, OpenApiMap> | undefined) ?? {}),
    ...structuredContentDocumentOpenApi,
  };
  return generated;
}

function communityContentRequestSchema(
  source: z.ZodType,
  mode: "exactly_one" | "at_most_one",
): OpenApiMap {
  const schema = zodRequestSchema(source, {
    richText: schemaRef("RichTextDocument"),
  });
  return mode === "exactly_one"
    ? {
        ...schema,
        oneOf: [
          { required: ["content"], not: { required: ["richText"] } },
          { required: ["richText"], not: { required: ["content"] } },
        ],
      }
    : { ...schema, not: { required: ["content", "richText"] } };
}

function communityProfileSettingsReplaceRequestSchema(): OpenApiMap {
  const schema = zodRequestSchema(
    apiSchemas.communityProfileSettingsReplaceSchema,
  );
  const properties = schema.properties as Record<string, OpenApiMap>;
  const fields = properties.fields as OpenApiMap;
  const items = fields.items as OpenApiMap;
  return {
    ...schema,
    properties: {
      ...properties,
      fields: {
        ...fields,
        items: {
          ...items,
          oneOf: [
            {
              required: ["standardField"],
              not: { required: ["customFieldId"] },
              properties: {
                standardField: {
                  type: "string",
                  enum: [
                    "avatar",
                    "job_title",
                    "department",
                    "bio",
                    "community_points",
                    "badges",
                  ],
                },
              },
            },
            {
              required: ["customFieldId"],
              not: { required: ["standardField"] },
              properties: { customFieldId: uuidSchema },
            },
          ],
        },
      },
    },
  };
}

const requestSchemas: Record<string, OpenApiMap> = {
  StockImageSelection: zodRequestSchema(stockImageSelectionInputSchema),
  AuthLogin: zodRequestSchema(apiSchemas.authLoginSchema),
  AuthMfaComplete: zodRequestSchema(apiSchemas.authMfaCompleteSchema),
  PasswordForgot: zodRequestSchema(apiSchemas.passwordForgotSchema),
  PasswordReset: zodRequestSchema(apiSchemas.passwordResetSchema),
  InvitationAccept: zodRequestSchema(apiSchemas.invitationAcceptSchema),
  OrganizationUpdate: zodRequestSchema(apiSchemas.organizationUpdateSchema),
  CustomDomainClaimCreate: zodRequestSchema(
    apiSchemas.customDomainClaimCreateSchema,
  ),
  CustomDomainClaimMutation: zodRequestSchema(
    apiSchemas.customDomainClaimMutationSchema,
  ),
  OidcConfigurationUpdate: zodRequestSchema(
    apiSchemas.oidcConfigurationApiUpdateSchema,
  ),
  MemberWelcomeSettingsUpdate: zodRequestSchema(
    apiSchemas.memberWelcomeSettingsUpdateSchema,
  ),
  TranscriptSearchSettingsUpdate: zodRequestSchema(
    apiSchemas.transcriptSearchSettingsInputSchema,
  ),
  EmailDeliveryRetry: zodRequestSchema(
    apiSchemas.emailDeliveryRetryInputSchema,
  ),
  EmailSuppressionRelease: zodRequestSchema(
    apiSchemas.emailSuppressionReleaseSchema,
  ),
  EmailTemplateSettingsUpdate: zodRequestSchema(
    apiSchemas.emailTemplateSettingsUpdateInputSchema,
  ),
  EmailTemplateTestDeliveryCreate: zodRequestSchema(
    apiSchemas.emailTemplateTestInputSchema,
  ),
  CommerceConnectionCreate: zodRequestSchema(
    apiSchemas.commerceConnectionInputSchema,
  ),
  CommerceProductCreate: zodRequestSchema(
    apiSchemas.commerceProductInputSchema,
  ),
  CommerceMappingCreate: zodRequestSchema(
    apiSchemas.commerceMappingInputSchema,
  ),
  CommerceEntitlementCommand: zodRequestSchema(
    apiSchemas.commerceEntitlementCommandSchema,
  ),
  AutomationMemberUpsert: zodRequestSchema(
    apiSchemas.automationMemberUpsertSchema,
  ),
  N8nWorkflowCreate: zodRequestSchema(apiSchemas.n8nWorkflowInputSchema),
  N8nTrigger: zodRequestSchema(apiSchemas.n8nTriggerSchema),
  SupportSettingsUpdate: zodRequestSchema(
    apiSchemas.supportSettingsInputSchema,
  ),
  CourseCreate: zodRequestSchema(apiSchemas.courseCreateSchema),
  CourseUpdate: zodRequestSchema(apiSchemas.courseUpdateSchema),
  CourseClone: zodRequestSchema(apiSchemas.courseCloneSchema),
  CourseVersionCreate: zodRequestSchema(apiSchemas.courseVersionCreateSchema),
  CoursePublish: zodRequestSchema(apiSchemas.coursePublishSchema),
  CourseCategoryCreate: zodRequestSchema(apiSchemas.courseCategoryCreateSchema),
  CourseCategoryUpdate: zodRequestSchema(apiSchemas.courseCategoryUpdateSchema),
  CourseCategoryReorder: zodRequestSchema(
    apiSchemas.courseCategoryReorderSchema,
  ),
  ModuleCreate: zodRequestSchema(apiSchemas.moduleCreateSchema),
  ModuleUpdate: zodRequestSchema(apiSchemas.moduleUpdateSchema),
  SectionCreate: zodRequestSchema(apiSchemas.sectionCreateSchema),
  SectionUpdate: zodRequestSchema(apiSchemas.sectionUpdateSchema),
  SectionLessonVisibilityUpdate: zodRequestSchema(
    apiSchemas.sectionLessonVisibilityUpdateSchema,
  ),
  CourseModuleAttach: zodRequestSchema(apiSchemas.courseModuleAttachSchema, {
    availableFrom: nullableDateTimeSchema,
    availableUntil: nullableDateTimeSchema,
  }),
  CourseModuleUpdate: zodRequestSchema(apiSchemas.courseModuleUpdateSchema, {
    availableFrom: nullableDateTimeSchema,
    availableUntil: nullableDateTimeSchema,
  }),
  CourseModuleOutline: zodRequestSchema(apiSchemas.courseModuleOutlineSchema),
  CourseModuleAccessRequestCreate: zodRequestSchema(
    apiSchemas.courseModuleAccessRequestCreateSchema,
  ),
  CourseModuleAccessRequestCancel: zodRequestSchema(
    apiSchemas.courseModuleAccessRequestCancelSchema,
  ),
  CourseModuleAccessRequestDecision: zodRequestSchema(
    apiSchemas.courseModuleAccessRequestDecisionSchema,
    { expiresAt: nullableDateTimeSchema },
  ),
  CourseModuleAccessOverride: zodRequestSchema(
    apiSchemas.courseModuleAccessOverrideSchema,
    { expiresAt: nullableDateTimeSchema },
  ),
  CourseModuleAccessOverrideDelete: zodRequestSchema(
    apiSchemas.courseModuleAccessOverrideDeleteSchema,
  ),
  CourseWidgetCreate: courseWidgetRequestOpenApiSchema(
    apiSchemas.courseWidgetCreateSchema,
  ),
  CourseWidgetUpdate: courseWidgetRequestOpenApiSchema(
    apiSchemas.courseWidgetUpdateSchema,
  ),
  CourseWidgetOrder: zodRequestSchema(apiSchemas.courseWidgetOrderSchema),
  LessonCreate: zodRequestSchema(apiSchemas.lessonCreateSchema, {
    availableAt: nullableDateTimeSchema,
  }),
  LessonUpdate: zodRequestSchema(apiSchemas.lessonUpdateSchema, {
    availableAt: nullableDateTimeSchema,
  }),
  LessonPageCreate: zodRequestSchema(apiSchemas.lessonPageCreateSchema),
  LessonPageUpdate: zodRequestSchema(apiSchemas.lessonPageUpdateSchema),
  ContentBlockCreate: contentBlockRequestSchema(
    apiSchemas.contentBlockCreateSchema,
  ),
  ContentBlockUpdate: contentBlockRequestSchema(
    apiSchemas.contentBlockUpdateSchema,
  ),
  AssessmentAttemptSubmit: zodRequestSchema(
    apiSchemas.assessmentAttemptSubmitSchema,
  ),
  ExamAttemptStart: zodRequestSchema(examAttemptApiStartSchema),
  ExamAttemptSessionStart: zodRequestSchema(examAttemptStartSchema),
  ExamAttemptDraft: zodRequestSchema(examAttemptDraftSchema),
  ExamAttemptSubmit: zodRequestSchema(examAttemptSubmitSchema),
  ExamAttemptRelease: zodRequestSchema(examAttemptReleaseSchema),
  MemberCreate: zodRequestSchema(apiSchemas.memberCreateSchema),
  MemberUpdate: zodRequestSchema(apiSchemas.memberUpdateSchema),
  TeamRoleCreate: zodRequestSchema(apiSchemas.teamRoleCreateSchema),
  TeamRoleUpdate: zodRequestSchema(apiSchemas.teamRoleUpdateSchema),
  TeamRoleAssignment: zodRequestSchema(apiSchemas.teamRoleAssignmentSchema),
  CustomFieldCreate: zodRequestSchema(apiSchemas.customFieldCreateSchema),
  CustomFieldUpdate: zodRequestSchema(apiSchemas.customFieldUpdateSchema),
  CustomFieldValues: zodRequestSchema(apiSchemas.customFieldValuesSchema),
  EnrollmentCreate: zodRequestSchema(apiSchemas.enrollmentCreateSchema),
  EnrollmentUpdate: zodRequestSchema(apiSchemas.enrollmentUpdateSchema),
  LessonProgressUpdate: zodRequestSchema(apiSchemas.lessonProgressUpdateSchema),
  GroupCreate: zodRequestSchema(apiSchemas.groupCreateSchema),
  GroupUpdate: zodRequestSchema(apiSchemas.groupUpdateSchema),
  GroupMember: zodRequestSchema(apiSchemas.groupMemberSchema),
  BundleCreate: zodRequestSchema(apiSchemas.bundleCreateSchema),
  BundleUpdate: zodRequestSchema(apiSchemas.bundleUpdateSchema),
  BundleCourse: zodRequestSchema(apiSchemas.bundleCourseSchema, {
    availableFrom: nullableDateTimeSchema,
    availableUntil: nullableDateTimeSchema,
  }),
  BundleCoursePolicy: zodRequestSchema(apiSchemas.bundleCoursePolicySchema, {
    availableFrom: nullableDateTimeSchema,
    availableUntil: nullableDateTimeSchema,
  }),
  EventCreate: zodRequestSchema(apiSchemas.eventCreateSchema, {
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
  }),
  EventUpdate: zodRequestSchema(apiSchemas.eventUpdateSchema, {
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema,
  }),
  EventLifecycleCommand: zodRequestSchema(
    apiSchemas.eventLifecycleCommandSchema,
    { startsAt: dateTimeSchema, endsAt: dateTimeSchema },
  ),
  AttendanceCreate: zodRequestSchema(apiSchemas.attendanceSchema),
  AttendanceUpdate: zodRequestSchema(apiSchemas.attendanceUpdateSchema),
  NotificationUpdate: zodRequestSchema(apiSchemas.notificationUpdateSchema),
  NotificationBulkMarkRead: zodRequestSchema(
    apiSchemas.notificationBulkMarkReadSchema,
  ),
  LessonAvailabilitySubscriptionMutation: zodRequestSchema(
    apiSchemas.lessonAvailabilitySubscriptionMutationSchema,
  ),
  AnnouncementCreate: zodRequestSchema(apiSchemas.announcementCreateSchema, {
    startsAt: dateTimeSchema,
    endsAt: nullableDateTimeSchema,
    contentDocument: schemaRef("AnnouncementContentDocument"),
  }),
  AnnouncementUpdate: zodRequestSchema(apiSchemas.announcementUpdateSchema, {
    startsAt: dateTimeSchema,
    endsAt: nullableDateTimeSchema,
    contentDocument: schemaRef("AnnouncementContentDocument"),
  }),
  CommunitySpaceCreate: zodRequestSchema(apiSchemas.communitySpaceCreateSchema),
  CommunitySpaceUpdate: zodRequestSchema(apiSchemas.communitySpaceUpdateSchema),
  CommunitySpaceMove: zodRequestSchema(apiSchemas.communitySpaceMoveSchema),
  CommunityAreaCreate: zodRequestSchema(apiSchemas.communityAreaCreateSchema),
  CommunityAreaUpdate: zodRequestSchema(apiSchemas.communityAreaUpdateSchema),
  CommunityAreaMove: zodRequestSchema(apiSchemas.communityAreaMoveSchema),
  CommunityProfileSettingsReplace:
    communityProfileSettingsReplaceRequestSchema(),
  CommunitySpaceAccessPolicy: zodRequestSchema(
    apiSchemas.communitySpaceAccessPolicySchema,
  ),
  PostCreate: communityContentRequestSchema(
    apiSchemas.postCreateSchema,
    "exactly_one",
  ),
  PostUpdate: communityContentRequestSchema(
    apiSchemas.postUpdateSchema,
    "at_most_one",
  ),
  CommentCreate: communityContentRequestSchema(
    apiSchemas.commentCreateSchema,
    "exactly_one",
  ),
  CommentUpdate: communityContentRequestSchema(
    apiSchemas.commentUpdateSchema,
    "exactly_one",
  ),
  PostReaction: zodRequestSchema(apiSchemas.postReactionSchema),
  CommentReactionUpdate: zodRequestSchema(
    apiSchemas.commentReactionUpdateSchema,
  ),
  PostVote: zodRequestSchema(apiSchemas.postVoteSchema),
  CommunityFollowUpdate: zodRequestSchema(
    apiSchemas.communityFollowUpdateSchema,
  ),
  CommunityBoostUpdate: zodRequestSchema(
    apiSchemas.communityBoostUpdateSchema,
    {
      startsAt: dateTimeSchema,
      endsAt: dateTimeSchema,
    },
  ),
  CommunityModerationCaseClaim: zodRequestSchema(
    apiSchemas.communityModerationCaseClaimSchema,
  ),
  CommunityModerationCaseDecision: zodRequestSchema(
    apiSchemas.communityModerationCaseDecisionSchema,
  ),
  CommunityModerationAppealDecision: zodRequestSchema(
    apiSchemas.communityModerationAppealDecisionSchema,
  ),
  CommunityModerationPolicyUpdate: zodRequestSchema(
    apiSchemas.communityModerationPolicyUpdateSchema,
  ),
  CommunityLevelConfigurationUpdate: zodRequestSchema(
    apiSchemas.communityLevelConfigurationUpdateSchema,
  ),
  SubmissionCreate: zodRequestSchema(apiSchemas.submissionCreateSchema, {
    richText: {
      anyOf: [schemaRef("RichTextDocument"), { type: "null" }],
      description:
        "Structured alternative to content. The server sanitizes it and stores projection version 1 in content.",
    },
  }),
  SubmissionReview: zodRequestSchema(apiSchemas.submissionReviewSchema),
  MediaAssetCreate: zodRequestSchema(mediaAssetCreateSchema),
  MediaMultipartPartAuthorizeRequest: zodRequestSchema(
    mediaMultipartPartAuthorizationSchema,
  ),
  FeedbackCreate: zodRequestSchema(apiSchemas.feedbackCreateSchema),
  FeedbackUpdate: zodRequestSchema(apiSchemas.feedbackUpdateSchema),
  FeedbackReply: zodRequestSchema(apiSchemas.feedbackReplySchema),
  BadgeCreate: zodRequestSchema(apiSchemas.badgeCreateSchema),
  BadgeUpdate: zodRequestSchema(apiSchemas.badgeUpdateSchema),
  BadgeAssign: zodRequestSchema(apiSchemas.badgeAssignSchema),
  BadgeGroupCreate: zodRequestSchema(apiSchemas.badgeGroupCreateSchema),
  BadgeGroupUpdate: zodRequestSchema(apiSchemas.badgeGroupUpdateSchema),
  HubCreate: zodRequestSchema(apiSchemas.hubCreateSchema),
  HubUpdate: zodRequestSchema(apiSchemas.hubUpdateSchema),
  HubClone: zodRequestSchema(apiSchemas.hubCloneSchema),
  HubAccess: zodRequestSchema(apiSchemas.hubAccessSchema),
  AgentCreate: zodRequestSchema(apiSchemas.agentCreateSchema),
  AgentUpdate: zodRequestSchema(apiSchemas.agentUpdateSchema),
  AgentDraftUpdate: zodRequestSchema(apiSchemas.agentDraftUpdateSchema),
  AgentPublish: zodRequestSchema(apiSchemas.agentPublishSchema),
  AgentRollback: zodRequestSchema(apiSchemas.agentRollbackSchema),
  AgentActionRequestCreate: zodRequestSchema(
    apiSchemas.agentActionRequestCreateSchema,
  ),
  AgentActionDecision: zodRequestSchema(apiSchemas.agentActionDecisionSchema),
  AgentChatCreate: zodRequestSchema(apiSchemas.agentChatCreateSchema),
  AgentChatUpdate: zodRequestSchema(apiSchemas.agentChatUpdateSchema),
  ChatMessageCreate: zodRequestSchema(apiSchemas.chatMessageCreateSchema),
  WebhookCreate: zodRequestSchema(apiSchemas.webhookCreateSchema),
  WebhookUpdate: zodRequestSchema(apiSchemas.webhookUpdateSchema),
  ApiKeyCreate: zodRequestSchema(apiSchemas.apiKeyCreateSchema, {
    expiresAt: nullableDateTimeSchema,
  }),
  ApiKeyUpdate: zodRequestSchema(apiSchemas.apiKeyUpdateSchema, {
    expiresAt: nullableDateTimeSchema,
  }),
  PrivacyRequestCreate: zodRequestSchema(apiSchemas.privacyRequestCreateSchema),
};

const emailDeliveryEventValues = [
  "feedback.reply",
  "lesson.available",
  "course.modules.released",
  "event.rescheduled",
  "event.cancelled",
  "email.template.test",
  "invitation.created",
  "password.reset",
] as const;
const emailRetryEventValues = [
  "feedback.reply",
  "lesson.available",
  "course.modules.released",
  "event.rescheduled",
  "event.cancelled",
  "email.template.test",
] as const;
const emailTemplateEventValues = [
  "feedback.reply",
  "lesson.available",
  "course.modules.released",
  "invitation.created",
  "password.reset",
] as const;
const emailDeliveryStatusValues = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "retrying",
] as const;

const privacyRequestStatusValues = [
  "received",
  "identity_verified",
  "approved",
  "processing",
  "blocked",
  "completed",
  "rejected",
  "cancelled",
  "failed",
] as const;
const nullableUuidSchema = {
  anyOf: [uuidSchema, { type: "null" }],
} as const;
const nullableStringSchema = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;
const nullablePrivacyStatusSchema = {
  anyOf: [
    { type: "string", enum: privacyRequestStatusValues },
    { type: "null" },
  ],
} as const;
const privacyRequestRequired = [
  "id",
  "subjectUserId",
  "clientRequestId",
  "type",
  "status",
  "dueAt",
  "identityVerifiedAt",
  "approvedAt",
  "processingStartedAt",
  "completedAt",
  "backupExpiresAt",
  "policyVersion",
  "createdAt",
  "updatedAt",
] as const;
const privacyRequestProperties = {
  id: uuidSchema,
  subjectUserId: nullableUuidSchema,
  clientRequestId: { type: "string", minLength: 4, maxLength: 180 },
  type: { type: "string", enum: ["access_export", "erasure"] },
  status: { type: "string", enum: privacyRequestStatusValues },
  dueAt: dateTimeSchema,
  identityVerifiedAt: nullableDateTimeSchema,
  approvedAt: nullableDateTimeSchema,
  processingStartedAt: nullableDateTimeSchema,
  completedAt: nullableDateTimeSchema,
  backupExpiresAt: nullableDateTimeSchema,
  policyVersion: nullableStringSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
} satisfies Record<string, OpenApiMap>;

const responseMetaSchema: OpenApiMap = {
  type: "object",
  required: ["requestId", "timestamp"],
  properties: {
    requestId: { type: "string", format: "uuid" },
    timestamp: dateTimeSchema,
    pagination: schemaRef("PaginationMeta"),
  },
  additionalProperties: true,
};

const emailDeliveryBaseRequired = [
  "id",
  "event",
  "status",
  "attempt",
  "responseStatus",
  "nextRetryAt",
  "deliveredAt",
  "createdAt",
  "updatedAt",
] as const;
const emailDeliveryBaseProperties = {
  id: uuidSchema,
  event: { type: "string", minLength: 1, maxLength: 120 },
  status: { type: "string", enum: emailDeliveryStatusValues },
  attempt: { type: "integer", minimum: 0 },
  responseStatus: {
    anyOf: [{ type: "integer", minimum: 100, maximum: 599 }, { type: "null" }],
  },
  nextRetryAt: nullableDateTimeSchema,
  deliveredAt: nullableDateTimeSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
} as const;
const emailTemplateProperties = {
  version: { type: "integer", const: 1 },
  locale: { type: "string", enum: ["de", "en", "it", "es", "fr"] },
  source: {
    type: "string",
    enum: ["localized", "legacy", "default"],
  },
  templates: {
    type: "object",
    additionalProperties: false,
    required: emailTemplateEventValues,
    properties: {
      "feedback.reply": schemaRef("EmailTemplate"),
      "lesson.available": schemaRef("EmailTemplate"),
      "course.modules.released": schemaRef("EmailTemplate"),
      "invitation.created": schemaRef("EmailTemplate"),
      "password.reset": schemaRef("EmailTemplate"),
    },
  },
  updatedAt: nullableDateTimeSchema,
} as const;

const webhookDeliverySummaryRequired = [
  "id",
  "webhookId",
  "webhookName",
  "event",
  "status",
  "attempt",
  "maxAttempts",
  "responseStatus",
  "responseSummary",
  "responseBodyRedacted",
  "failureKind",
  "durationMs",
  "nextRetryAt",
  "deliveredAt",
  "createdAt",
  "updatedAt",
  "replayable",
] as const;
const webhookDeliverySummaryProperties = {
  id: uuidSchema,
  webhookId: uuidSchema,
  webhookName: { type: "string", maxLength: 160 },
  event: { type: "string", maxLength: 120 },
  status: {
    type: "string",
    enum: ["pending", "processing", "delivered", "failed", "retrying"],
  },
  attempt: { type: "integer", minimum: 0 },
  maxAttempts: { type: "integer", minimum: 1 },
  responseStatus: {
    anyOf: [{ type: "integer", minimum: 0, maximum: 599 }, { type: "null" }],
  },
  responseSummary: nullableStringSchema,
  responseBodyRedacted: { type: "boolean" },
  failureKind: {
    anyOf: [
      {
        type: "string",
        enum: [
          "http",
          "timeout",
          "dns",
          "tls",
          "connection",
          "configuration",
          "unknown",
        ],
      },
      { type: "null" },
    ],
  },
  durationMs: {
    anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
  },
  nextRetryAt: nullableDateTimeSchema,
  deliveredAt: nullableDateTimeSchema,
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  replayable: { type: "boolean" },
} as const;

const webhookDeliveryAttemptRequired = [
  "id",
  "replayGeneration",
  "attempt",
  "outcome",
  "responseStatus",
  "responseBodyRedacted",
  "failureKind",
  "durationMs",
  "startedAt",
  "completedAt",
] as const;

const schemas: Record<string, OpenApiMap> = {
  ...requestSchemas,
  MediaAssetUploadAuthorization: {
    description:
      "Provider-dependent upload authorization. PUT uploads send the file as the raw request body and honor the returned header contract; browser user agents supply the forbidden Content-Length header from the exact body size. POST uploads send every returned field plus the file in one multipart/form-data request and must not add custom request headers. Native S3 multipart sessions use the returned control-plane endpoints and sign each checksummed part separately.",
    oneOf: [
      {
        title: "Raw PUT upload",
        type: "object",
        additionalProperties: false,
        required: ["transport", "method", "url", "headers", "expiresInSeconds"],
        properties: {
          transport: { type: "string", enum: ["s3", "application"] },
          method: { type: "string", const: "PUT" },
          url: { type: "string", format: "uri" },
          headers: {
            type: "object",
            description:
              "Exact signed or application upload headers to apply to the raw file request.",
            required: ["Content-Length", "Content-Type", "If-None-Match"],
            properties: {
              "Content-Length": { type: "string", pattern: "^[1-9][0-9]*$" },
              "Content-Type": { type: "string", minLength: 3, maxLength: 180 },
              "If-None-Match": { type: "string", const: "*" },
            },
            additionalProperties: { type: "string" },
          },
          expiresInSeconds: {
            anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
          },
        },
      },
      {
        title: "Signed multipart POST upload",
        type: "object",
        additionalProperties: false,
        required: ["transport", "method", "url", "fields", "expiresInSeconds"],
        properties: {
          transport: { type: "string", const: "s3" },
          method: { type: "string", const: "POST" },
          url: { type: "string", format: "uri" },
          fields: {
            type: "object",
            minProperties: 1,
            description:
              "Exact signed form fields. Append all fields before one file part named `file`; do not convert them into HTTP headers.",
            additionalProperties: { type: "string" },
          },
          expiresInSeconds: { type: "integer", minimum: 1 },
        },
      },
      {
        title: "Native S3 multipart upload session",
        type: "object",
        additionalProperties: false,
        required: [
          "transport",
          "statusUrl",
          "partsUrl",
          "completeUrl",
          "abortUrl",
          "partSizeBytes",
          "partCount",
          "concurrency",
          "expiresAt",
        ],
        properties: {
          transport: { type: "string", const: "s3-multipart" },
          statusUrl: {
            type: "string",
            pattern: "^/api/v1/media-assets/[0-9a-fA-F-]{36}/multipart$",
          },
          partsUrl: {
            type: "string",
            pattern: "^/api/v1/media-assets/[0-9a-fA-F-]{36}/multipart/parts$",
          },
          completeUrl: {
            type: "string",
            pattern: "^/api/v1/media-assets/[0-9a-fA-F-]{36}/complete$",
          },
          abortUrl: {
            type: "string",
            pattern: "^/api/v1/media-assets/[0-9a-fA-F-]{36}/multipart$",
          },
          partSizeBytes: { type: "integer", minimum: 5_242_880 },
          partCount: { type: "integer", minimum: 1, maximum: 10_000 },
          concurrency: { type: "integer", minimum: 1, maximum: 3 },
          expiresAt: dateTimeSchema,
        },
      },
    ],
  },
  MediaAssetCreated: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "uploadedById",
      "ownerUserId",
      "purpose",
      "kind",
      "status",
      "originalFileName",
      "safeFileName",
      "declaredMimeType",
      "detectedMimeType",
      "declaredSizeBytes",
      "actualSizeBytes",
      "durationMilliseconds",
      "uploadExpiresAt",
      "uploadedAt",
      "scanAttempt",
      "scanCompletedAt",
      "scanFailureCode",
      "deletedAt",
      "createdAt",
      "updatedAt",
      "upload",
    ],
    properties: {
      id: uuidSchema,
      uploadedById: uuidSchema,
      ownerUserId: nullableUuidSchema,
      purpose: { type: "string", enum: [...MEDIA_PURPOSES] },
      kind: {
        type: "string",
        enum: ["image", "audio", "video", "document"],
      },
      status: { type: "string", const: "pending" },
      originalFileName: { type: "string", minLength: 1, maxLength: 255 },
      safeFileName: { type: "string", minLength: 1, maxLength: 255 },
      declaredMimeType: { type: "string", minLength: 3, maxLength: 180 },
      detectedMimeType: { type: "null" },
      declaredSizeBytes: { type: "integer", minimum: 1 },
      actualSizeBytes: { type: "null" },
      durationMilliseconds: { type: "null" },
      uploadExpiresAt: dateTimeSchema,
      uploadedAt: { type: "null" },
      scanAttempt: { type: "integer", const: 0 },
      scanCompletedAt: { type: "null" },
      scanFailureCode: { type: "null" },
      deletedAt: { type: "null" },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      upload: schemaRef("MediaAssetUploadAuthorization"),
    },
  },
  MediaMultipartUploadedPart: {
    type: "object",
    additionalProperties: false,
    required: ["partNumber", "sizeBytes"],
    properties: {
      partNumber: { type: "integer", minimum: 1, maximum: 10_000 },
      sizeBytes: { type: "integer", minimum: 1 },
    },
  },
  MediaMultipartStatus: {
    type: "object",
    additionalProperties: false,
    required: [
      "state",
      "partSizeBytes",
      "partCount",
      "uploadedBytes",
      "uploadedParts",
      "expiresAt",
      "completeUrl",
    ],
    properties: {
      state: {
        type: "string",
        enum: ["uploading", "completing", "completion_pending", "completed"],
      },
      partSizeBytes: { type: "integer", minimum: 5_242_880 },
      partCount: { type: "integer", minimum: 1, maximum: 10_000 },
      uploadedBytes: { type: "integer", minimum: 0 },
      uploadedParts: {
        type: "array",
        maxItems: 10_000,
        items: schemaRef("MediaMultipartUploadedPart"),
      },
      expiresAt: nullableDateTimeSchema,
      completeUrl: {
        type: "string",
        pattern: "^/api/v1/media-assets/[0-9a-fA-F-]{36}/complete$",
      },
    },
  },
  MediaMultipartPartAuthorization: {
    type: "object",
    additionalProperties: false,
    required: [
      "method",
      "url",
      "headers",
      "partNumber",
      "sizeBytes",
      "expiresInSeconds",
    ],
    properties: {
      method: { type: "string", const: "PUT" },
      url: { type: "string", format: "uri" },
      headers: {
        type: "object",
        additionalProperties: false,
        required: ["Content-Length", "X-Amz-Checksum-Sha256"],
        properties: {
          "Content-Length": { type: "string", pattern: "^[1-9][0-9]*$" },
          "X-Amz-Checksum-Sha256": {
            type: "string",
            pattern: "^[A-Za-z0-9+/]{43}=$",
          },
        },
      },
      partNumber: { type: "integer", minimum: 1, maximum: 10_000 },
      sizeBytes: { type: "integer", minimum: 1 },
      expiresInSeconds: { type: "integer", minimum: 1 },
    },
  },
  MediaMultipartAbortResult: {
    type: "object",
    additionalProperties: false,
    required: ["id", "aborted", "deleted"],
    properties: {
      id: uuidSchema,
      aborted: { type: "boolean", const: true },
      deleted: { type: "boolean", const: true },
    },
  },
  AutomationConnectorStatus: {
    type: "object",
    additionalProperties: false,
    required: [
      "connected",
      "contractVersion",
      "apiVersion",
      "organizationId",
      "apiKeyName",
      "requiredScopes",
      "capabilities",
    ],
    properties: {
      connected: { type: "boolean", const: true },
      contractVersion: {
        type: "string",
        const: AUTOMATION_CONNECTOR_CONTRACT_VERSION,
      },
      apiVersion: { type: "string", const: "v1" },
      organizationId: uuidSchema,
      apiKeyName: { type: "string", minLength: 1, maxLength: 160 },
      requiredScopes: {
        type: "array",
        minItems: AUTOMATION_CONNECTOR_REQUIRED_SCOPES.length,
        maxItems: AUTOMATION_CONNECTOR_REQUIRED_SCOPES.length,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES],
        },
      },
      capabilities: {
        type: "object",
        additionalProperties: false,
        required: ["memberUpsert", "bundleSelection"],
        properties: {
          memberUpsert: { type: "boolean", const: true },
          bundleSelection: { type: "boolean", const: true },
        },
      },
    },
  },
  AutomationMemberUpsertResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "email",
      "status",
      "created",
      "bundleId",
      "bundleAction",
      "bundleAccessChanged",
    ],
    properties: {
      id: uuidSchema,
      email: { type: "string", format: "email", maxLength: 255 },
      status: {
        type: "string",
        enum: ["active", "invited", "disabled"],
      },
      created: { type: "boolean" },
      bundleId: { anyOf: [uuidSchema, { type: "null" }] },
      bundleAction: { type: "string", enum: ["grant", "revoke"] },
      bundleAccessChanged: { type: "boolean" },
    },
  },
  WebhookDeliverySummary: {
    type: "object",
    additionalProperties: false,
    required: webhookDeliverySummaryRequired,
    properties: webhookDeliverySummaryProperties,
  },
  WebhookDeliveryAttempt: {
    type: "object",
    additionalProperties: false,
    required: webhookDeliveryAttemptRequired,
    properties: {
      id: uuidSchema,
      replayGeneration: { type: "integer", minimum: 0 },
      attempt: { type: "integer", minimum: 1 },
      outcome: {
        type: "string",
        enum: ["delivered", "retrying", "failed"],
      },
      responseStatus: {
        anyOf: [
          { type: "integer", minimum: 100, maximum: 599 },
          { type: "null" },
        ],
      },
      responseBodyRedacted: { type: "boolean" },
      failureKind: webhookDeliverySummaryProperties.failureKind,
      durationMs: { type: "integer", minimum: 0 },
      startedAt: dateTimeSchema,
      completedAt: dateTimeSchema,
    },
  },
  WebhookDeliveryDetail: {
    type: "object",
    additionalProperties: false,
    required: [...webhookDeliverySummaryRequired, "payload", "attempts"],
    properties: {
      ...webhookDeliverySummaryProperties,
      payload: {
        type: "object",
        additionalProperties: false,
        required: ["id", "type", "createdAt", "dataKeys"],
        properties: {
          id: nullableStringSchema,
          type: nullableStringSchema,
          createdAt: nullableDateTimeSchema,
          dataKeys: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
        },
        description:
          "Structural payload metadata only. Payload values are never returned.",
      },
      attempts: {
        type: "array",
        maxItems: 50,
        items: schemaRef("WebhookDeliveryAttempt"),
        description:
          "Newest-first immutable delivery-attempt history. Response bodies are never returned.",
      },
    },
  },
  CommunityArea: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "slug",
      "description",
      "sortOrder",
      "createdAt",
      "updatedAt",
      "spaceIds",
    ],
    properties: {
      id: uuidSchema,
      title: { type: "string", minLength: 2, maxLength: 160 },
      slug: { type: "string", maxLength: 120 },
      description: {
        anyOf: [{ type: "string", maxLength: 5000 }, { type: "null" }],
      },
      sortOrder: { type: "integer", minimum: 0 },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      spaceIds: { type: "array", items: uuidSchema },
    },
  },
  CommunityAreaMoveResult: {
    type: "object",
    additionalProperties: false,
    required: ["id", "position"],
    properties: {
      id: uuidSchema,
      position: { type: "integer", minimum: 0 },
    },
  },
  CommunityEntityDeletionResult: {
    type: "object",
    additionalProperties: false,
    required: ["id", "deleted"],
    properties: { id: uuidSchema, deleted: { type: "boolean", const: true } },
  },
  CommunitySpaceMoveResult: {
    type: "object",
    additionalProperties: false,
    required: ["id", "areaId", "position"],
    properties: {
      id: uuidSchema,
      areaId: uuidSchema,
      position: { type: "integer", minimum: 0 },
    },
  },
  CommunitySpace: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "areaId",
      "title",
      "slug",
      "description",
      "color",
      "type",
      "accessMode",
      "sortOrder",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      areaId: uuidSchema,
      title: { type: "string", minLength: 2, maxLength: 160 },
      slug: { type: "string", maxLength: 120 },
      description: {
        anyOf: [{ type: "string", maxLength: 5000 }, { type: "null" }],
      },
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      type: {
        type: "string",
        enum: ["feed", "discussion", "announcement"],
      },
      accessMode: { type: "string", enum: ["open", "restricted"] },
      sortOrder: { type: "integer", minimum: 0 },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      areaTitle: { type: "string" },
      areaSlug: { type: "string" },
      areaDescription: {
        anyOf: [{ type: "string", maxLength: 5000 }, { type: "null" }],
      },
      areaSortOrder: { type: "integer", minimum: 0 },
      postCount: { type: "integer", minimum: 0 },
      permissions: schemaRef("CommunitySpacePermissions"),
    },
  },
  CommunitySpaceAccessRule: {
    type: "object",
    additionalProperties: false,
    required: [
      "subjectType",
      "subjectRole",
      "subjectUserId",
      "subjectGroupId",
      "subjectBundleId",
      "canView",
      "canPost",
      "canComment",
    ],
    properties: {
      subjectType: {
        type: "string",
        enum: ["role", "user", "group", "bundle"],
      },
      subjectRole: {
        anyOf: [
          { type: "string", enum: ["owner", "admin", "trainer", "member"] },
          { type: "null" },
        ],
      },
      subjectUserId: nullableUuidSchema,
      subjectGroupId: nullableUuidSchema,
      subjectBundleId: nullableUuidSchema,
      canView: { type: "boolean" },
      canPost: { type: "boolean" },
      canComment: { type: "boolean" },
    },
  },
  CommunitySpaceAccessPolicyData: {
    type: "object",
    additionalProperties: false,
    required: ["spaceId", "accessMode", "rules"],
    properties: {
      spaceId: uuidSchema,
      accessMode: { type: "string", enum: ["open", "restricted"] },
      rules: {
        type: "array",
        maxItems: 500,
        items: schemaRef("CommunitySpaceAccessRule"),
      },
    },
  },
  CommunityPublicProfileCustomField: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "id", "key", "label", "type", "value"],
    properties: {
      kind: { type: "string", const: "custom" },
      id: uuidSchema,
      key: { type: "string", maxLength: 120 },
      label: { type: "string", maxLength: 180 },
      type: {
        type: "string",
        enum: ["text", "number", "boolean", "date", "select", "multiselect"],
      },
      value: { type: "string", maxLength: 1000 },
    },
  },
  CommunityPublicProfileField: {
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["kind", "key", "label", "value"],
        properties: {
          kind: { type: "string", const: "standard" },
          key: {
            type: "string",
            enum: [
              "avatar",
              "job_title",
              "department",
              "bio",
              "community_points",
              "badges",
            ],
          },
          label: { type: "string" },
          value: {
            anyOf: [
              { type: "string" },
              { type: "integer" },
              { type: "array", items: schemaRef("CommunityBadge") },
              { type: "null" },
            ],
          },
        },
      },
      schemaRef("CommunityPublicProfileCustomField"),
    ],
  },
  CommunityPublicProfile: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "firstName",
      "lastName",
      "avatarUrl",
      "jobTitle",
      "department",
      "bio",
      "communityPoints",
      "badges",
      "customFields",
      "fields",
    ],
    properties: {
      id: uuidSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      avatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      jobTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
      department: { anyOf: [{ type: "string" }, { type: "null" }] },
      bio: { anyOf: [{ type: "string" }, { type: "null" }] },
      communityPoints: {
        anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      },
      badges: { type: "array", items: schemaRef("CommunityBadge") },
      customFields: {
        type: "array",
        items: schemaRef("CommunityPublicProfileCustomField"),
      },
      fields: {
        type: "array",
        maxItems: 100,
        items: schemaRef("CommunityPublicProfileField"),
      },
    },
  },
  CommunityProfileCompletion: {
    type: "object",
    additionalProperties: false,
    required: [
      "complete",
      "gateEnabled",
      "revision",
      "missingFields",
      "profileHref",
    ],
    properties: {
      complete: { type: "boolean" },
      gateEnabled: { type: "boolean" },
      revision: { type: "integer", minimum: 0 },
      missingFields: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label"],
          properties: {
            key: { type: "string" },
            label: { type: "string" },
          },
        },
      },
      profileHref: {
        type: "string",
        const: "/academy/profile?community=required",
      },
    },
  },
  CommunityProfileSettingsAdminData: {
    type: "object",
    additionalProperties: false,
    required: [
      "settings",
      "fields",
      "customFieldCatalog",
      "activeMemberCount",
      "incompleteActiveMemberCount",
    ],
    properties: {
      settings: {
        type: "object",
        additionalProperties: false,
        required: [
          "organizationId",
          "completionGateEnabled",
          "revision",
          "updatedAt",
        ],
        properties: {
          organizationId: uuidSchema,
          completionGateEnabled: { type: "boolean" },
          revision: { type: "integer", minimum: 0 },
          updatedAt: dateTimeSchema,
        },
      },
      fields: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "organizationId",
            "standardField",
            "customFieldId",
            "requiredForPosting",
            "sortOrder",
            "createdAt",
          ],
          properties: {
            id: uuidSchema,
            organizationId: uuidSchema,
            standardField: {
              anyOf: [
                {
                  type: "string",
                  enum: [
                    "avatar",
                    "job_title",
                    "department",
                    "bio",
                    "community_points",
                    "badges",
                  ],
                },
                { type: "null" },
              ],
            },
            customFieldId: { anyOf: [uuidSchema, { type: "null" }] },
            requiredForPosting: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0 },
            createdAt: dateTimeSchema,
          },
        },
      },
      customFieldCatalog: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "key", "label", "type", "options"],
          properties: {
            id: uuidSchema,
            key: { type: "string", maxLength: 120 },
            label: { type: "string", maxLength: 180 },
            type: {
              type: "string",
              enum: [
                "text",
                "number",
                "boolean",
                "date",
                "select",
                "multiselect",
              ],
            },
            options: {
              type: "array",
              maxItems: 100,
              items: { type: "string" },
            },
          },
        },
      },
      activeMemberCount: { type: "integer", minimum: 0 },
      incompleteActiveMemberCount: { type: "integer", minimum: 0 },
    },
  },
  CustomDomainClaim: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "hostname",
      "status",
      "expired",
      "revision",
      "recordName",
      "challengeExpiresAt",
      "lastCheckedAt",
      "lastCheckCode",
      "verifiedAt",
      "revokedAt",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      hostname: { type: "string", minLength: 3, maxLength: 253 },
      status: { type: "string", enum: ["pending", "verified", "revoked"] },
      expired: { type: "boolean" },
      revision: { type: "integer", minimum: 1 },
      recordName: { type: "string", minLength: 3, maxLength: 280 },
      challengeExpiresAt: dateTimeSchema,
      lastCheckedAt: nullableDateTimeSchema,
      lastCheckCode: {
        anyOf: [
          {
            type: "string",
            enum: ["verified", "no_match", "dns_error", "timeout", "expired"],
          },
          { type: "null" },
        ],
      },
      verifiedAt: nullableDateTimeSchema,
      revokedAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  CustomDomainChallenge: {
    type: "object",
    additionalProperties: false,
    required: ["recordName", "recordValue", "expiresAt"],
    properties: {
      recordName: { type: "string", minLength: 3, maxLength: 280 },
      recordValue: { type: "string", minLength: 40, maxLength: 120 },
      expiresAt: dateTimeSchema,
    },
  },
  CustomDomainClaimIssued: {
    type: "object",
    additionalProperties: false,
    required: ["claim", "challenge"],
    properties: {
      claim: schemaRef("CustomDomainClaim"),
      challenge: schemaRef("CustomDomainChallenge"),
    },
  },
  CustomDomainVerificationResult: {
    type: "object",
    additionalProperties: false,
    required: ["verified", "code", "claim"],
    properties: {
      verified: { type: "boolean" },
      code: {
        type: "string",
        enum: ["verified", "no_match", "dns_error", "timeout", "expired"],
      },
      claim: schemaRef("CustomDomainClaim"),
    },
  },
  OrganizationContractOverview: {
    type: "object",
    additionalProperties: false,
    required: ["contract", "usage"],
    properties: {
      contract: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            required: [
              "organizationId",
              "planCode",
              "status",
              "seatLimit",
              "courseLimit",
              "storageLimitBytes",
              "aiMonthlyCredits",
              "featureEntitlements",
              "externalReference",
              "startsAt",
              "endsAt",
              "revision",
              "createdAt",
              "updatedAt",
            ],
            properties: {
              organizationId: uuidSchema,
              planCode: { type: "string", minLength: 2, maxLength: 64 },
              status: {
                type: "string",
                enum: ["trial", "active", "past_due", "suspended", "cancelled"],
              },
              seatLimit: {
                anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
              },
              courseLimit: {
                anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
              },
              storageLimitBytes: {
                anyOf: [
                  { type: "integer", minimum: 1048576 },
                  { type: "null" },
                ],
              },
              aiMonthlyCredits: {
                anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
              },
              featureEntitlements: {
                type: "array",
                maxItems: 64,
                items: { type: "string", minLength: 2, maxLength: 64 },
              },
              externalReference: {
                anyOf: [{ type: "string", maxLength: 255 }, { type: "null" }],
              },
              startsAt: dateTimeSchema,
              endsAt: nullableDateTimeSchema,
              revision: { type: "integer", minimum: 1 },
              createdAt: dateTimeSchema,
              updatedAt: dateTimeSchema,
            },
          },
          { type: "null" },
        ],
      },
      usage: {
        type: "object",
        additionalProperties: false,
        required: ["seats", "courses", "storageBytes"],
        properties: {
          seats: { type: "integer", minimum: 0 },
          courses: { type: "integer", minimum: 0 },
          storageBytes: { type: "integer", minimum: 0 },
        },
      },
    },
  },
  CommunityFollow: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "targetType",
      "targetId",
      "notify",
      "createdAt",
      "updatedAt",
      "targetLabel",
      "targetAvatarUrl",
    ],
    properties: {
      id: uuidSchema,
      targetType: { type: "string", enum: ["author", "space"] },
      targetId: uuidSchema,
      notify: {
        type: "boolean",
        const: false,
        description: "Reserved; notification delivery is not enabled.",
      },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      targetLabel: { type: "string" },
      targetAvatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  },
  CommunityAuthorBoost: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "authorId",
      "authorName",
      "strength",
      "startsAt",
      "endsAt",
      "reason",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      authorId: uuidSchema,
      authorName: { type: "string" },
      strength: { type: "string", enum: ["light", "medium", "high"] },
      startsAt: dateTimeSchema,
      endsAt: dateTimeSchema,
      reason: { type: "string", minLength: 3, maxLength: 500 },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  CommunityModerationQueueAppeal: {
    type: "object",
    additionalProperties: false,
    required: ["id", "statement", "createdAt"],
    properties: {
      id: uuidSchema,
      statement: { type: "string", minLength: 3, maxLength: 2000 },
      createdAt: dateTimeSchema,
    },
  },
  CommunityModerationQueueItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "targetType",
      "targetId",
      "targetMissing",
      "targetTitle",
      "contentExcerpt",
      "contentState",
      "contentVersion",
      "decisionVersion",
      "reason",
      "priority",
      "status",
      "authorId",
      "authorName",
      "spaceTitle",
      "reportCount",
      "claimedById",
      "claimedAt",
      "createdAt",
      "updatedAt",
      "appeal",
    ],
    properties: {
      id: uuidSchema,
      targetType: { type: "string", enum: ["post", "comment"] },
      targetId: uuidSchema,
      targetMissing: { type: "boolean" },
      targetTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
      contentExcerpt: { type: "string", maxLength: 500 },
      contentState: {
        anyOf: [
          {
            type: "string",
            enum: ["pending", "published", "held", "rejected"],
          },
          { type: "null" },
        ],
      },
      contentVersion: { type: "integer", minimum: 1 },
      decisionVersion: { type: "integer", minimum: 1 },
      reason: {
        type: "string",
        enum: [
          "approval_required",
          "report_threshold",
          "duplicate",
          "link_limit",
          "manual",
        ],
      },
      priority: { type: "integer" },
      status: {
        type: "string",
        enum: ["open", "reviewing", "resolved", "appealed"],
      },
      authorId: nullableUuidSchema,
      authorName: { type: "string" },
      spaceTitle: { type: "string" },
      reportCount: { type: "integer", minimum: 0 },
      claimedById: nullableUuidSchema,
      claimedAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      appeal: {
        anyOf: [schemaRef("CommunityModerationQueueAppeal"), { type: "null" }],
      },
    },
    description:
      "Tenant-scoped moderation work item. Reports are represented only by an aggregate count; reporter identities and automated assessment signals are never exposed.",
  },
  CommunityModerationCaseClaimResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "caseId",
      "status",
      "claimedById",
      "claimedAt",
      "contentVersion",
      "decisionVersion",
    ],
    properties: {
      caseId: uuidSchema,
      status: { type: "string", enum: ["reviewing", "appealed"] },
      claimedById: uuidSchema,
      claimedAt: dateTimeSchema,
      contentVersion: { type: "integer", minimum: 1 },
      decisionVersion: { type: "integer", minimum: 1 },
    },
  },
  CommunityModerationCaseDecisionResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "caseId",
      "action",
      "targetType",
      "targetId",
      "state",
      "contentVersion",
      "decisionVersion",
    ],
    properties: {
      caseId: uuidSchema,
      action: { type: "string", enum: ["approve", "reject", "restore"] },
      targetType: { type: "string", enum: ["post", "comment"] },
      targetId: uuidSchema,
      state: {
        type: "string",
        enum: ["pending", "published", "held", "rejected"],
      },
      contentVersion: { type: "integer", minimum: 1 },
      decisionVersion: { type: "integer", minimum: 1 },
    },
  },
  CommunityModerationAppealResolutionResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "appealId",
      "caseId",
      "action",
      "status",
      "state",
      "contentVersion",
      "decisionVersion",
    ],
    properties: {
      appealId: uuidSchema,
      caseId: uuidSchema,
      action: { type: "string", enum: ["uphold", "overturn"] },
      status: { type: "string", const: "resolved" },
      state: {
        type: "string",
        enum: ["pending", "published", "held", "rejected"],
      },
      contentVersion: { type: "integer", minimum: 1 },
      decisionVersion: { type: "integer", minimum: 1 },
    },
  },
  CommunityModerationPolicy: {
    type: "object",
    additionalProperties: false,
    required: [
      "spaceId",
      "spaceTitle",
      "spaceType",
      "postApproval",
      "commentApproval",
      "automationMode",
      "reportThreshold",
      "duplicateWindowMinutes",
      "linkLimit",
      "version",
    ],
    properties: {
      spaceId: uuidSchema,
      spaceTitle: { type: "string" },
      spaceType: {
        type: "string",
        enum: ["feed", "discussion", "announcement"],
      },
      postApproval: {
        type: "string",
        enum: ["off", "members", "non_admins"],
      },
      commentApproval: {
        type: "string",
        enum: ["off", "members", "non_admins"],
      },
      automationMode: {
        type: "string",
        enum: ["off", "observe", "enforce"],
      },
      reportThreshold: {
        anyOf: [{ type: "integer", minimum: 2, maximum: 20 }, { type: "null" }],
      },
      duplicateWindowMinutes: {
        type: "integer",
        minimum: 0,
        maximum: 1440,
      },
      linkLimit: { type: "integer", minimum: 0, maximum: 20 },
      version: { type: "integer", minimum: 1 },
    },
  },
  CommunityLevel: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "position",
      "name",
      "description",
      "minPoints",
      "icon",
      "color",
      "active",
    ],
    properties: {
      id: uuidSchema,
      position: { type: "integer", minimum: 1, maximum: 100 },
      name: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 5000 },
      minPoints: { type: "integer", minimum: 0, maximum: 2147483647 },
      icon: { type: "string", minLength: 1, maxLength: 60 },
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      active: { type: "boolean" },
    },
  },
  CommunityLevelConfiguration: {
    type: "object",
    additionalProperties: false,
    required: ["enabled", "revision", "levels"],
    properties: {
      enabled: { type: "boolean" },
      revision: { type: "integer", minimum: 1 },
      levels: {
        type: "array",
        maxItems: 100,
        items: schemaRef("CommunityLevel"),
      },
    },
  },
  CommunityBadge: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "name",
      "description",
      "icon",
      "color",
      "groupId",
      "groupName",
    ],
    properties: {
      id: uuidSchema,
      name: { type: "string", minLength: 1, maxLength: 160 },
      description: { type: "string", maxLength: 5000 },
      icon: { type: "string", minLength: 1, maxLength: 60 },
      color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      groupId: { anyOf: [uuidSchema, { type: "null" }] },
      groupName: {
        anyOf: [{ type: "string", maxLength: 160 }, { type: "null" }],
      },
    },
  },
  CommunityLeaderboardEntry: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "firstName",
      "lastName",
      "avatarUrl",
      "department",
      "communityPoints",
      "badges",
      "badgeCount",
      "rank",
      "level",
    ],
    properties: {
      id: uuidSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      avatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      department: { anyOf: [{ type: "string" }, { type: "null" }] },
      communityPoints: { type: "integer", minimum: 0 },
      badges: { type: "array", items: schemaRef("CommunityBadge") },
      badgeCount: { type: "integer", minimum: 0 },
      rank: { type: "integer", minimum: 1 },
      level: { anyOf: [schemaRef("CommunityLevel"), { type: "null" }] },
    },
  },
  CommunityFeedComment: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "authorId",
      "parentId",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "createdAt",
      "updatedAt",
      "firstName",
      "lastName",
      "authorAvatarUrl",
      "badges",
      "reported",
      "replyCount",
      "reactionCount",
      "likeReactionCount",
      "celebrateReactionCount",
      "insightfulReactionCount",
      "questionReactionCount",
      "myReaction",
      "attachments",
      "replies",
    ],
    properties: {
      id: uuidSchema,
      authorId: uuidSchema,
      parentId: { anyOf: [uuidSchema, { type: "null" }] },
      content: { type: "string" },
      contentFormat: {
        type: "string",
        enum: ["plain_text", "rich_text"],
      },
      richText: {
        anyOf: [schemaRef("RichTextDocument"), { type: "null" }],
      },
      contentProjectionVersion: { type: "integer", const: 1 },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      authorAvatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      badges: { type: "array", items: schemaRef("CommunityBadge") },
      reported: { type: "boolean" },
      replyCount: { type: "integer", minimum: 0 },
      reactionCount: { type: "integer", minimum: 0 },
      likeReactionCount: { type: "integer", minimum: 0 },
      celebrateReactionCount: { type: "integer", minimum: 0 },
      insightfulReactionCount: { type: "integer", minimum: 0 },
      questionReactionCount: { type: "integer", minimum: 0 },
      myReaction: {
        anyOf: [
          {
            type: "string",
            enum: ["like", "celebrate", "insightful", "question"],
          },
          { type: "null" },
        ],
      },
      attachments: {
        type: "array",
        maxItems: 3,
        items: schemaRef("CommunityAttachment"),
      },
      replies: {
        type: "array",
        maxItems: 2,
        items: schemaRef("CommunityFeedComment"),
      },
    },
  },
  CommunityCourseLink: {
    type: "object",
    additionalProperties: false,
    required: ["type", "courseId", "title", "slug", "href"],
    properties: {
      type: { type: "string", enum: ["course"] },
      courseId: uuidSchema,
      title: { type: "string", maxLength: 220 },
      slug: { type: "string", maxLength: 180 },
      href: {
        type: "string",
        pattern: "^/academy/courses/[a-z0-9]+(?:-[a-z0-9]+)*$",
      },
    },
    description:
      "Typed tenant-local course link. It is returned only when the current actor can view the published course; arbitrary URLs are never accepted or persisted.",
  },
  CommunityPostRecord: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "spaceId",
      "authorId",
      "title",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "imageUrl",
      "pinned",
      "locked",
      "moderationState",
      "moderationVersion",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "courseLink",
      "attachments",
    ],
    properties: {
      id: uuidSchema,
      spaceId: uuidSchema,
      authorId: uuidSchema,
      title: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] },
      content: { type: "string" },
      contentFormat: { type: "string", enum: ["plain_text", "rich_text"] },
      richText: { anyOf: [schemaRef("RichTextDocument"), { type: "null" }] },
      contentProjectionVersion: { type: "integer", const: 1 },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      pinned: { type: "boolean" },
      locked: { type: "boolean" },
      moderationState: {
        type: "string",
        enum: ["pending", "published", "held", "rejected"],
      },
      moderationVersion: { type: "integer", minimum: 1 },
      publishedAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      courseLink: {
        anyOf: [schemaRef("CommunityCourseLink"), { type: "null" }],
      },
      attachments: {
        type: "array",
        maxItems: 6,
        items: schemaRef("CommunityAttachment"),
      },
      commentCount: { type: "integer", minimum: 0 },
      comments: {
        type: "array",
        maxItems: 3,
        items: schemaRef("CommunityFeedComment"),
      },
      hasMoreComments: { type: "boolean" },
    },
  },
  CommunityPostListItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "imageUrl",
      "pinned",
      "locked",
      "createdAt",
      "updatedAt",
      "spaceId",
      "spaceTitle",
      "spaceType",
      "authorId",
      "authorFirstName",
      "authorLastName",
      "authorAvatarUrl",
      "authorProfile",
      "reactionCount",
      "likeCount",
      "celebrateCount",
      "insightfulCount",
      "questionCount",
      "voteScore",
      "commentCount",
      "courseLink",
      "attachments",
    ],
    properties: {
      id: uuidSchema,
      title: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] },
      content: { type: "string" },
      contentFormat: { type: "string", enum: ["plain_text", "rich_text"] },
      richText: { anyOf: [schemaRef("RichTextDocument"), { type: "null" }] },
      contentProjectionVersion: { type: "integer", const: 1 },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      pinned: { type: "boolean" },
      locked: { type: "boolean" },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      spaceId: uuidSchema,
      spaceTitle: { type: "string" },
      spaceType: {
        type: "string",
        enum: ["feed", "discussion", "announcement"],
      },
      authorId: uuidSchema,
      authorFirstName: { type: "string" },
      authorLastName: { type: "string" },
      authorAvatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      authorProfile: {
        anyOf: [schemaRef("CommunityPublicProfile"), { type: "null" }],
      },
      reactionCount: { type: "integer", minimum: 0 },
      likeCount: { type: "integer", minimum: 0 },
      celebrateCount: { type: "integer", minimum: 0 },
      insightfulCount: { type: "integer", minimum: 0 },
      questionCount: { type: "integer", minimum: 0 },
      voteScore: { type: "integer" },
      commentCount: { type: "integer", minimum: 0 },
      courseLink: {
        anyOf: [schemaRef("CommunityCourseLink"), { type: "null" }],
      },
      attachments: {
        type: "array",
        maxItems: 6,
        items: schemaRef("CommunityAttachment"),
      },
    },
  },
  CommunityCommentRecord: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "postId",
      "authorId",
      "parentId",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "moderationState",
      "moderationVersion",
      "publishedAt",
      "createdAt",
      "updatedAt",
      "attachments",
    ],
    properties: {
      id: uuidSchema,
      postId: uuidSchema,
      authorId: uuidSchema,
      parentId: nullableUuidSchema,
      content: { type: "string" },
      contentFormat: { type: "string", enum: ["plain_text", "rich_text"] },
      richText: { anyOf: [schemaRef("RichTextDocument"), { type: "null" }] },
      contentProjectionVersion: { type: "integer", const: 1 },
      moderationState: {
        type: "string",
        enum: ["pending", "published", "held", "rejected"],
      },
      moderationVersion: { type: "integer", minimum: 1 },
      publishedAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      attachments: {
        type: "array",
        maxItems: 3,
        items: schemaRef("CommunityAttachment"),
      },
    },
  },
  CommunityCommentListItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "parentId",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "createdAt",
      "updatedAt",
      "authorId",
      "authorFirstName",
      "authorLastName",
      "authorAvatarUrl",
      "authorProfile",
      "attachments",
    ],
    properties: {
      id: uuidSchema,
      parentId: nullableUuidSchema,
      content: { type: "string" },
      contentFormat: { type: "string", enum: ["plain_text", "rich_text"] },
      richText: { anyOf: [schemaRef("RichTextDocument"), { type: "null" }] },
      contentProjectionVersion: { type: "integer", const: 1 },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      authorId: uuidSchema,
      authorFirstName: { type: "string" },
      authorLastName: { type: "string" },
      authorAvatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      authorProfile: {
        anyOf: [schemaRef("CommunityPublicProfile"), { type: "null" }],
      },
      attachments: {
        type: "array",
        maxItems: 3,
        items: schemaRef("CommunityAttachment"),
      },
    },
  },
  CommunityFeedPost: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "title",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "imageUrl",
      "pinned",
      "locked",
      "courseLink",
      "createdAt",
      "updatedAt",
      "authorId",
      "firstName",
      "lastName",
      "authorAvatarUrl",
      "badges",
      "jobTitle",
      "points",
      "spaceId",
      "spaceTitle",
      "spaceColor",
      "spaceType",
      "likeCount",
      "likeReactionCount",
      "celebrateReactionCount",
      "insightfulReactionCount",
      "questionReactionCount",
      "commentCount",
      "myReaction",
      "voteScore",
      "myVote",
      "reported",
      "reasonCodes",
      "isFollowingAuthor",
      "isFollowingSpace",
      "attachments",
      "comments",
    ],
    properties: {
      id: uuidSchema,
      title: { anyOf: [{ type: "string", maxLength: 240 }, { type: "null" }] },
      content: { type: "string" },
      contentFormat: {
        type: "string",
        enum: ["plain_text", "rich_text"],
      },
      richText: {
        anyOf: [schemaRef("RichTextDocument"), { type: "null" }],
      },
      contentProjectionVersion: { type: "integer", const: 1 },
      imageUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      pinned: { type: "boolean" },
      locked: { type: "boolean" },
      courseLink: {
        anyOf: [schemaRef("CommunityCourseLink"), { type: "null" }],
      },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
      authorId: uuidSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      authorAvatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      badges: { type: "array", items: schemaRef("CommunityBadge") },
      jobTitle: { anyOf: [{ type: "string" }, { type: "null" }] },
      points: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
      spaceId: uuidSchema,
      spaceTitle: { type: "string" },
      spaceColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      spaceType: {
        type: "string",
        enum: ["feed", "discussion", "announcement"],
      },
      likeCount: { type: "integer", minimum: 0 },
      likeReactionCount: { type: "integer", minimum: 0 },
      celebrateReactionCount: { type: "integer", minimum: 0 },
      insightfulReactionCount: { type: "integer", minimum: 0 },
      questionReactionCount: { type: "integer", minimum: 0 },
      commentCount: { type: "integer", minimum: 0 },
      myReaction: {
        anyOf: [
          {
            type: "string",
            enum: ["like", "celebrate", "insightful", "question"],
          },
          { type: "null" },
        ],
      },
      voteScore: { type: "integer" },
      myVote: { type: "integer", enum: [-1, 0, 1] },
      reported: { type: "boolean" },
      reasonCodes: {
        type: "array",
        maxItems: 3,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            "pinned",
            "followed_author",
            "followed_space",
            "boosted",
            "trending",
            "recent",
          ],
        },
      },
      isFollowingAuthor: { type: "boolean" },
      isFollowingSpace: { type: "boolean" },
      attachments: {
        type: "array",
        maxItems: 6,
        items: schemaRef("CommunityAttachment"),
      },
      comments: {
        type: "array",
        maxItems: 3,
        items: schemaRef("CommunityFeedComment"),
      },
    },
    description:
      "ACL-filtered post with bounded comment previews and explainable reason codes. Internal rank scores and boost strength are not exposed.",
  },
  CommunityFeedPage: {
    type: "object",
    additionalProperties: false,
    required: ["mode", "asOf", "items", "nextCursor", "hasMore"],
    properties: {
      mode: { type: "string", enum: ["for_you", "following", "latest"] },
      asOf: dateTimeSchema,
      items: {
        type: "array",
        maxItems: 50,
        items: schemaRef("CommunityFeedPost"),
      },
      nextCursor: {
        anyOf: [{ type: "string", maxLength: 2048 }, { type: "null" }],
      },
      hasMore: { type: "boolean" },
    },
  },
  CommunityCommentReactionSummary: {
    type: "object",
    additionalProperties: false,
    required: ["commentId", "userId", "myReaction", "counts"],
    properties: {
      commentId: uuidSchema,
      userId: uuidSchema,
      myReaction: {
        anyOf: [
          {
            type: "string",
            enum: ["like", "celebrate", "insightful", "question"],
          },
          { type: "null" },
        ],
      },
      counts: {
        type: "object",
        additionalProperties: false,
        required: ["like", "celebrate", "insightful", "question", "total"],
        properties: {
          like: { type: "integer", minimum: 0 },
          celebrate: { type: "integer", minimum: 0 },
          insightful: { type: "integer", minimum: 0 },
          question: { type: "integer", minimum: 0 },
          total: { type: "integer", minimum: 0 },
        },
      },
    },
  },
  CommunityPostReactionMutation: {
    type: "object",
    additionalProperties: false,
    required: ["postId", "userId", "reaction"],
    properties: {
      postId: uuidSchema,
      userId: uuidSchema,
      reaction: {
        anyOf: [
          {
            type: "string",
            enum: ["like", "celebrate", "insightful", "question"],
          },
          { type: "null" },
        ],
      },
    },
  },
  CommunityPostReactionListItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "firstName",
      "lastName",
      "reaction",
      "createdAt",
      "avatarUrl",
      "profile",
    ],
    properties: {
      userId: uuidSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      reaction: {
        type: "string",
        enum: ["like", "celebrate", "insightful", "question"],
      },
      createdAt: dateTimeSchema,
      avatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
      profile: {
        anyOf: [schemaRef("CommunityPublicProfile"), { type: "null" }],
      },
    },
  },
  CommunityPostVoteMutation: {
    type: "object",
    additionalProperties: false,
    required: ["postId", "userId", "value"],
    properties: {
      postId: uuidSchema,
      userId: uuidSchema,
      value: { type: "integer", enum: [-1, 0, 1] },
    },
  },
  CommunityPostVoteListItem: {
    type: "object",
    additionalProperties: false,
    required: [
      "userId",
      "firstName",
      "lastName",
      "value",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      userId: uuidSchema,
      firstName: { type: "string" },
      lastName: { type: "string" },
      value: { type: "integer", enum: [-1, 1] },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  CommunityCommentReactionMutation: {
    type: "object",
    additionalProperties: false,
    required: ["commentId", "userId", "reaction"],
    properties: {
      commentId: uuidSchema,
      userId: uuidSchema,
      reaction: {
        anyOf: [
          {
            type: "string",
            enum: ["like", "celebrate", "insightful", "question"],
          },
          { type: "null" },
        ],
      },
    },
  },
  CommunityRemovalResult: {
    type: "object",
    additionalProperties: false,
    required: ["removed"],
    properties: { removed: { type: "boolean" } },
  },
  CommunityAttachment: {
    type: "object",
    additionalProperties: false,
    required: ["id", "name", "kind", "mimeType", "sizeBytes", "downloadHref"],
    properties: {
      id: uuidSchema,
      name: { type: "string", minLength: 1, maxLength: 255 },
      kind: {
        type: "string",
        enum: ["image", "audio", "video", "document"],
      },
      mimeType: { type: "string", minLength: 3, maxLength: 180 },
      sizeBytes: { type: "integer", minimum: 1 },
      downloadHref: {
        type: "string",
        pattern: "^/api/v1/media-assets/[0-9a-f-]+/download$",
        description:
          "Bearer-authenticated API download endpoint. Access is re-evaluated against the current space policy on every request.",
      },
    },
  },
  CommunitySpacePermissions: {
    type: "object",
    additionalProperties: false,
    required: ["canView", "canPost", "canComment", "canManage"],
    properties: {
      canView: { type: "boolean" },
      canPost: { type: "boolean" },
      canComment: { type: "boolean" },
      canManage: { type: "boolean" },
    },
  },
  RichTextDocument: richTextDocumentOpenApi,
  AnnouncementContentDocument: announcementContentDocumentOpenApi,
  SubmissionReviewAnnotation: {
    description:
      "Immutable review annotation with a minimal discriminated public representation.",
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "body",
          "startOffset",
          "endOffset",
          "createdAt",
        ],
        properties: {
          id: uuidSchema,
          type: { type: "string", const: "text_range" },
          body: { type: "string", minLength: 1, maxLength: 2000 },
          startOffset: { type: "integer", minimum: 0 },
          endOffset: { type: "integer", minimum: 1 },
          createdAt: dateTimeSchema,
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "type",
          "body",
          "mediaAssetId",
          "timestampMilliseconds",
          "createdAt",
        ],
        properties: {
          id: uuidSchema,
          type: { type: "string", const: "media_timestamp" },
          body: { type: "string", minLength: 1, maxLength: 2000 },
          mediaAssetId: uuidSchema,
          timestampMilliseconds: { type: "integer", minimum: 0 },
          createdAt: dateTimeSchema,
        },
      },
    ],
  },
  SubmissionRecord: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "organizationId",
      "userId",
      "courseId",
      "lessonId",
      "blockId",
      "attemptNumber",
      "supersedesId",
      "title",
      "type",
      "content",
      "contentFormat",
      "richText",
      "contentProjectionVersion",
      "fileName",
      "status",
      "reviewerId",
      "feedback",
      "score",
      "submittedAt",
      "reviewedAt",
    ],
    properties: {
      id: uuidSchema,
      organizationId: uuidSchema,
      userId: uuidSchema,
      courseId: uuidSchema,
      lessonId: nullableUuidSchema,
      blockId: nullableUuidSchema,
      attemptNumber: { type: "integer", minimum: 1 },
      supersedesId: nullableUuidSchema,
      title: { type: "string", maxLength: 220 },
      type: { type: "string", maxLength: 40 },
      content: {
        ...nullableStringSchema,
        description:
          "Immutable plain-text projection used by text-range review offsets. Offsets count UTF-16 code units.",
      },
      contentFormat: {
        type: "string",
        enum: ["plain_text", "rich_text"],
      },
      richText: {
        anyOf: [schemaRef("RichTextDocument"), { type: "null" }],
      },
      contentProjectionVersion: { type: "integer", const: 1 },
      fileName: nullableStringSchema,
      status: {
        type: "string",
        enum: ["open", "in_review", "revision", "approved"],
      },
      reviewerId: nullableUuidSchema,
      feedback: nullableStringSchema,
      score: {
        anyOf: [{ type: "number", minimum: 0, maximum: 100 }, { type: "null" }],
      },
      submittedAt: dateTimeSchema,
      reviewedAt: nullableDateTimeSchema,
    },
  },
  SubmissionReviewRecord: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "organizationId",
      "submissionId",
      "reviewerId",
      "decision",
      "feedback",
      "score",
      "reviewedAt",
      "annotations",
    ],
    properties: {
      id: uuidSchema,
      organizationId: uuidSchema,
      submissionId: uuidSchema,
      reviewerId: nullableUuidSchema,
      decision: { type: "string", enum: ["revision", "approved"] },
      feedback: { type: "string", minLength: 1, maxLength: 5000 },
      score: { type: "number", minimum: 0, maximum: 100 },
      reviewedAt: dateTimeSchema,
      annotations: {
        type: "array",
        maxItems: 100,
        items: schemaRef("SubmissionReviewAnnotation"),
      },
    },
  },
  SubmissionNotification: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "userId",
      "title",
      "body",
      "type",
      "href",
      "read",
      "createdAt",
    ],
    properties: {
      id: uuidSchema,
      userId: uuidSchema,
      title: { type: "string", maxLength: 180 },
      body: { type: "string" },
      type: { type: "string", maxLength: 50 },
      href: nullableStringSchema,
      read: { type: "boolean" },
      createdAt: dateTimeSchema,
    },
  },
  SubmissionReviewResult: {
    type: "object",
    additionalProperties: false,
    required: ["submission", "review", "notification"],
    properties: {
      submission: schemaRef("SubmissionRecord"),
      review: schemaRef("SubmissionReviewRecord"),
      notification: schemaRef("SubmissionNotification"),
    },
  },
  SubmissionDetail: {
    type: "object",
    additionalProperties: false,
    required: ["submission", "member", "course", "reviews"],
    properties: {
      submission: schemaRef("SubmissionRecord"),
      member: {
        type: "object",
        additionalProperties: false,
        required: ["id", "email", "firstName", "lastName"],
        properties: {
          id: uuidSchema,
          email: { type: "string", format: "email" },
          firstName: { type: "string" },
          lastName: { type: "string" },
        },
      },
      course: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "slug"],
        properties: {
          id: uuidSchema,
          title: { type: "string" },
          slug: { type: "string" },
        },
      },
      reviews: {
        type: "array",
        items: schemaRef("SubmissionReviewRecord"),
      },
    },
  },
  PrivacySubjectSummary: {
    type: "object",
    additionalProperties: false,
    required: ["id", "email", "firstName", "lastName"],
    properties: {
      id: uuidSchema,
      email: { type: "string", format: "email" },
      firstName: { type: "string" },
      lastName: { type: "string" },
    },
  },
  MemberWelcomeSettings: {
    type: "object",
    additionalProperties: false,
    required: [
      "organizationId",
      "enabled",
      "title",
      "welcomeText",
      "videoUrl",
      "promptProfileImage",
      "promptProfileCompletion",
      "version",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      organizationId: uuidSchema,
      enabled: { type: "boolean" },
      title: { type: "string", minLength: 1, maxLength: 160 },
      welcomeText: { type: "string", minLength: 1, maxLength: 5000 },
      videoUrl: {
        anyOf: [
          { type: "string", format: "uri", pattern: "^https://" },
          { type: "null" },
        ],
      },
      promptProfileImage: { type: "boolean" },
      promptProfileCompletion: { type: "boolean" },
      version: { type: "integer", minimum: 0 },
      createdAt: nullableDateTimeSchema,
      updatedAt: nullableDateTimeSchema,
    },
  },
  OidcConfiguration: {
    type: "object",
    additionalProperties: false,
    required: [
      "enabled",
      "displayName",
      "issuer",
      "clientId",
      "clientSecretConfigured",
      "autoProvisionMembers",
      "allowedEmailDomains",
      "passwordLoginEnabled",
      "version",
      "updatedAt",
    ],
    properties: {
      enabled: { type: "boolean" },
      displayName: { type: "string", minLength: 2, maxLength: 80 },
      issuer: {
        anyOf: [
          { type: "string", format: "uri", maxLength: 2000 },
          { type: "null" },
        ],
      },
      clientId: {
        anyOf: [
          { type: "string", minLength: 1, maxLength: 512 },
          { type: "null" },
        ],
      },
      clientSecretConfigured: { type: "boolean" },
      autoProvisionMembers: { type: "boolean" },
      allowedEmailDomains: {
        type: "array",
        maxItems: 50,
        uniqueItems: true,
        items: { type: "string", minLength: 3, maxLength: 253 },
      },
      passwordLoginEnabled: { type: "boolean" },
      version: { type: "integer", minimum: 0 },
      updatedAt: nullableDateTimeSchema,
    },
  },
  OidcAuthorizationStart: {
    type: "object",
    additionalProperties: false,
    required: ["authorizationUrl"],
    properties: {
      authorizationUrl: {
        type: "string",
        format: "uri",
        pattern: "^https?://",
        description:
          "Validated provider authorization URL generated by the server after the session-bound transaction cookie has been set.",
      },
    },
  },
  TranscriptSearchSettings: {
    type: "object",
    additionalProperties: false,
    required: ["organizationId", "excludedSearchTerms", "updatedAt"],
    properties: {
      organizationId: uuidSchema,
      excludedSearchTerms: {
        type: "array",
        maxItems: 100,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 120 },
      },
      updatedAt: nullableDateTimeSchema,
    },
  },
  EmailDeliveryMaskedRecipient: {
    type: "object",
    description:
      "Masked recipient identity for list views. The values are display strings, not a deliverable address.",
    additionalProperties: false,
    required: ["name", "email"],
    properties: {
      name: { type: "string" },
      email: { type: "string" },
    },
  },
  EmailDeliveryRecipient: {
    type: "object",
    additionalProperties: false,
    required: ["id", "email", "firstName", "lastName", "status", "role"],
    properties: {
      id: uuidSchema,
      email: { type: "string", format: "email" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      status: { type: "string", enum: ["active", "invited", "disabled"] },
      role: {
        type: "string",
        enum: ["owner", "admin", "trainer", "member"],
      },
    },
  },
  EmailDeliveryContent: {
    description:
      "Validated, redacted delivery content. Authentication links and invalid or unsupported payloads are never exposed.",
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: ["available", "subject", "message", "html", "linksRedacted"],
        properties: {
          available: { type: "boolean", const: true },
          subject: { type: "string", maxLength: 200 },
          message: { type: "string", maxLength: 10000 },
          html: {
            type: "string",
            maxLength: 70000,
            description:
              "Server-generated HTML derived from the safe plain-text message.",
          },
          linksRedacted: { type: "boolean" },
        },
      },
      {
        type: "object",
        additionalProperties: false,
        required: ["available", "reason"],
        properties: {
          available: { type: "boolean", const: false },
          reason: {
            type: "string",
            enum: [
              "authentication_link",
              "unsupported_event",
              "invalid_payload",
            ],
          },
        },
      },
    ],
  },
  EmailDeliveryListItem: {
    type: "object",
    description:
      "Tenant-scoped delivery metadata without encrypted payload or raw gateway response body.",
    additionalProperties: false,
    required: [...emailDeliveryBaseRequired, "recipient"],
    properties: {
      ...emailDeliveryBaseProperties,
      recipient: schemaRef("EmailDeliveryMaskedRecipient"),
    },
  },
  EmailDeliveryListMeta: {
    type: "object",
    additionalProperties: false,
    required: ["requestId", "timestamp", "pagination", "total"],
    properties: {
      requestId: uuidSchema,
      timestamp: dateTimeSchema,
      pagination: schemaRef("PaginationMeta"),
      total: { type: "integer", minimum: 0 },
    },
  },
  EmailDeliveryDetail: {
    type: "object",
    description:
      "Tenant-scoped delivery detail without encrypted payload or raw gateway response body. Failure text and optional content are server-sanitized.",
    additionalProperties: false,
    required: [
      ...emailDeliveryBaseRequired,
      "failureSummary",
      "recipient",
      "content",
      "canRetry",
    ],
    properties: {
      ...emailDeliveryBaseProperties,
      failureSummary: nullableStringSchema,
      recipient: schemaRef("EmailDeliveryRecipient"),
      content: schemaRef("EmailDeliveryContent"),
      canRetry: { type: "boolean" },
    },
  },
  EmailDeliveryRetryResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "event",
      "status",
      "attempt",
      "nextRetryAt",
      "updatedAt",
      "changed",
    ],
    properties: {
      id: uuidSchema,
      event: { type: "string", enum: emailRetryEventValues },
      status: { type: "string", enum: emailDeliveryStatusValues },
      attempt: { type: "integer", minimum: 0 },
      nextRetryAt: nullableDateTimeSchema,
      updatedAt: dateTimeSchema,
      changed: {
        type: "boolean",
        description:
          "False when the idempotent request already refers to the queued delivery state.",
      },
    },
  },
  EmailSuppressionListItem: {
    type: "object",
    description:
      "Tenant-scoped suppression lifecycle with a masked recipient. Recipient hashes, source deliveries, actor identifiers, and provider reason codes are never returned.",
    additionalProperties: false,
    required: [
      "id",
      "reason",
      "status",
      "occurrenceCount",
      "recipient",
      "firstOccurredAt",
      "lastOccurredAt",
      "expiresAt",
      "releasedAt",
      "releaseReason",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      reason: {
        type: "string",
        enum: ["hard_bounce", "soft_bounce", "complaint"],
      },
      status: {
        type: "string",
        enum: ["active", "released", "expired"],
      },
      occurrenceCount: { type: "integer", minimum: 1 },
      recipient: schemaRef("EmailDeliveryMaskedRecipient"),
      firstOccurredAt: dateTimeSchema,
      lastOccurredAt: dateTimeSchema,
      expiresAt: nullableDateTimeSchema,
      releasedAt: nullableDateTimeSchema,
      releaseReason: {
        anyOf: [
          {
            type: "string",
            enum: [
              "address_corrected",
              "provider_error",
              "member_request",
              "other_verified",
            ],
          },
          { type: "null" },
        ],
      },
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  EmailSuppressionReleaseResult: {
    type: "object",
    additionalProperties: false,
    required: ["id", "status", "releasedAt", "releaseReason", "changed"],
    properties: {
      id: uuidSchema,
      status: { type: "string", const: "released" },
      releasedAt: dateTimeSchema,
      releaseReason: {
        anyOf: [
          {
            type: "string",
            enum: [
              "address_corrected",
              "provider_error",
              "member_request",
              "other_verified",
            ],
          },
          { type: "null" },
        ],
      },
      changed: { type: "boolean" },
    },
  },
  EmailTemplate: {
    type: "object",
    additionalProperties: false,
    required: ["subject", "body"],
    properties: {
      subject: { type: "string", minLength: 1, maxLength: 500 },
      body: { type: "string", minLength: 1, maxLength: 10000 },
    },
  },
  EmailTemplateSettings: {
    type: "object",
    additionalProperties: false,
    required: ["version", "locale", "source", "templates", "updatedAt"],
    properties: emailTemplateProperties,
  },
  EmailTemplateSettingsUpdateResult: {
    type: "object",
    additionalProperties: false,
    required: [
      "version",
      "locale",
      "source",
      "templates",
      "updatedAt",
      "changed",
      "migratedLegacy",
    ],
    properties: {
      ...emailTemplateProperties,
      changed: { type: "boolean" },
      migratedLegacy: {
        type: "boolean",
        description:
          "True when a valid unqualified legacy template set was materialized under its stable locale key without changing rendered configuration.",
      },
    },
  },
  EmailTemplateTestDelivery: {
    type: "object",
    description:
      "Idempotently queued self-test delivery for the active owner or admin associated with the API key.",
    additionalProperties: false,
    required: [
      "id",
      "event",
      "status",
      "attempt",
      "locale",
      "createdAt",
      "changed",
    ],
    properties: {
      id: uuidSchema,
      event: { type: "string", const: "email.template.test" },
      status: { type: "string", enum: emailDeliveryStatusValues },
      attempt: { type: "integer", minimum: 0 },
      locale: { type: "string", enum: ["de", "en", "it", "es", "fr"] },
      createdAt: dateTimeSchema,
      changed: {
        type: "boolean",
        description:
          "False when requestId already identifies the same test delivery.",
      },
    },
  },
  LessonAvailabilitySubscription: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "userId",
      "courseId",
      "lessonId",
      "subscribedVersionId",
      "fulfilledVersionId",
      "status",
      "subscribedAt",
      "cancelledAt",
      "fulfilledAt",
    ],
    properties: {
      id: uuidSchema,
      userId: uuidSchema,
      courseId: uuidSchema,
      lessonId: uuidSchema,
      subscribedVersionId: uuidSchema,
      fulfilledVersionId: nullableUuidSchema,
      status: {
        type: "string",
        enum: ["active", "cancelled", "fulfilled"],
      },
      subscribedAt: dateTimeSchema,
      cancelledAt: nullableDateTimeSchema,
      fulfilledAt: nullableDateTimeSchema,
    },
  },
  PrivacyRequest: {
    type: "object",
    additionalProperties: false,
    required: privacyRequestRequired,
    properties: privacyRequestProperties,
  },
  PrivacyRequestListItem: {
    type: "object",
    additionalProperties: false,
    required: [...privacyRequestRequired, "subject"],
    properties: {
      ...privacyRequestProperties,
      subject: {
        anyOf: [schemaRef("PrivacySubjectSummary"), { type: "null" }],
      },
    },
  },
  PrivacyRequestEvent: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "event",
      "fromStatus",
      "toStatus",
      "metadata",
      "createdAt",
    ],
    properties: {
      id: uuidSchema,
      event: { type: "string" },
      fromStatus: nullablePrivacyStatusSchema,
      toStatus: nullablePrivacyStatusSchema,
      metadata: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string" },
          policyVersion: { type: "string" },
          artifactId: { type: "string", format: "uuid" },
          scope: { type: "string" },
          sizeBytes: { type: "integer", minimum: 0 },
          artifactSha256: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
          },
          failureCode: { type: "string" },
        },
      },
      createdAt: dateTimeSchema,
    },
  },
  PrivacyLegalHoldSummary: {
    type: "object",
    description:
      "Legal-hold timing and scope without references, legal basis, reasons, or actor identifiers.",
    additionalProperties: false,
    required: [
      "id",
      "scope",
      "startsAt",
      "expiresAt",
      "releasedAt",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      scope: {
        type: "string",
        enum: [
          "all",
          "profile",
          "authentication",
          "learning",
          "certificates",
          "community",
          "feedback",
          "events",
          "gamification",
          "ai",
          "media",
          "audit",
          "integrations",
          "communications",
        ],
      },
      startsAt: dateTimeSchema,
      expiresAt: nullableDateTimeSchema,
      releasedAt: nullableDateTimeSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  PrivacyExportArtifactSummary: {
    type: "object",
    description:
      "Export artifact metadata without storage location, storage identity, or failure details.",
    additionalProperties: false,
    required: [
      "id",
      "status",
      "format",
      "safeFileName",
      "contentType",
      "manifestSha256",
      "artifactSha256",
      "sizeBytes",
      "fileCount",
      "expiresAt",
      "readyAt",
      "deletedAt",
      "failureCode",
      "createdAt",
      "updatedAt",
    ],
    properties: {
      id: uuidSchema,
      status: {
        type: "string",
        enum: ["building", "ready", "failed", "deleted"],
      },
      format: { type: "string", enum: ["json", "zip"] },
      safeFileName: { type: "string" },
      contentType: { type: "string" },
      manifestSha256: {
        anyOf: [
          { type: "string", pattern: "^[0-9a-f]{64}$" },
          { type: "null" },
        ],
      },
      artifactSha256: {
        anyOf: [
          { type: "string", pattern: "^[0-9a-f]{64}$" },
          { type: "null" },
        ],
      },
      sizeBytes: {
        anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
      },
      fileCount: {
        anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
      },
      expiresAt: dateTimeSchema,
      readyAt: nullableDateTimeSchema,
      deletedAt: nullableDateTimeSchema,
      failureCode: nullableStringSchema,
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    },
  },
  PrivacyRequestDetail: {
    type: "object",
    additionalProperties: false,
    required: [
      ...privacyRequestRequired,
      "subject",
      "events",
      "legalHolds",
      "artifacts",
    ],
    properties: {
      ...privacyRequestProperties,
      subject: {
        anyOf: [schemaRef("PrivacySubjectSummary"), { type: "null" }],
      },
      events: {
        type: "array",
        items: schemaRef("PrivacyRequestEvent"),
      },
      legalHolds: {
        type: "array",
        items: schemaRef("PrivacyLegalHoldSummary"),
      },
      artifacts: {
        type: "array",
        items: schemaRef("PrivacyExportArtifactSummary"),
      },
    },
  },
  PaginationMeta: {
    type: "object",
    additionalProperties: false,
    required: ["limit", "returned", "nextCursor"],
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      returned: { type: "integer", minimum: 0 },
      nextCursor: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
  },
  ResponseMeta: responseMetaSchema,
  ProblemDetails: {
    type: "object",
    description: "RFC 9457 Problem Details with stable Q-Academy error fields.",
    required: [
      "type",
      "title",
      "status",
      "detail",
      "code",
      "instance",
      "requestId",
      "errors",
    ],
    properties: {
      type: { type: "string", format: "uri-reference" },
      title: { type: "string" },
      status: { type: "integer", minimum: 400, maximum: 599 },
      detail: { type: "string" },
      code: { type: "string" },
      instance: { type: "string" },
      requestId: { type: "string", format: "uuid" },
      errors: {},
    },
    additionalProperties: false,
  },
  HealthData: {
    type: "object",
    required: ["status"],
    properties: {
      status: { type: "string" },
      service: { type: "string" },
      version: { type: "string" },
      database: { type: "string" },
      timestamp: dateTimeSchema,
      latencyMs: { type: "integer", minimum: 0 },
    },
    additionalProperties: true,
  },
};

const requestIdHeader = { "X-Request-Id": headerRef("ResponseRequestId") };
const apiRateHeaders = {
  "X-RateLimit-Limit": headerRef("RateLimitLimit"),
  "X-RateLimit-Remaining": headerRef("RateLimitRemaining"),
  "X-RateLimit-Reset": headerRef("RateLimitReset"),
};

function envelopeSchema(
  list = false,
  paginated = false,
  dataSchema?: OpenApiMap,
  metaSchema?: OpenApiMap,
): OpenApiMap {
  const meta =
    metaSchema ??
    (paginated
      ? {
          allOf: [
            schemaRef("ResponseMeta"),
            {
              type: "object",
              required: ["pagination"],
              properties: { pagination: schemaRef("PaginationMeta") },
            },
          ],
        }
      : schemaRef("ResponseMeta"));
  return {
    type: "object",
    additionalProperties: false,
    required: ["data", "meta"],
    properties: {
      data: dataSchema ?? (list ? { type: "array", items: {} } : {}),
      meta,
    },
  };
}

function successResponse(
  description: string,
  options: {
    list?: boolean;
    paginated?: boolean;
    rateHeaders?: boolean;
    dataSchema?: OpenApiMap;
    metaSchema?: OpenApiMap;
  } = {},
): OpenApiMap {
  return {
    description,
    headers: {
      ...requestIdHeader,
      ...(options.rateHeaders === false ? {} : apiRateHeaders),
    },
    content: {
      "application/json": {
        schema: envelopeSchema(
          options.list,
          options.paginated,
          options.dataSchema,
          options.metaSchema,
        ),
      },
    },
  };
}

const standardErrors: Record<string, OpenApiMap> = {
  "400": responseRef("BadRequest"),
  "401": responseRef("Unauthorized"),
  "403": responseRef("Forbidden"),
  "404": responseRef("NotFound"),
  "409": responseRef("Conflict"),
  "413": responseRef("PayloadTooLarge"),
  "422": responseRef("ValidationFailed"),
  "429": responseRef("RateLimited"),
  "500": responseRef("InternalError"),
};

const pathParameter = (
  name: string,
  description: string,
  schema: OpenApiMap = uuidSchema,
): OpenApiMap => ({ name, in: "path", required: true, description, schema });

const queryParameter = (
  name: string,
  description: string,
  schema: OpenApiMap = { type: "string" },
  required = false,
): OpenApiMap => ({ name, in: "query", required, description, schema });

const enumQuery = (name: string, description: string, values: string[]) =>
  queryParameter(name, description, { type: "string", enum: values });

const id = pathParameter("id", "Resource identifier.");
const emailTemplateLocale = queryParameter(
  "locale",
  "Template locale. When omitted, the current tenant default locale is used.",
  { type: "string", enum: ["de", "en", "it", "es", "fr"] },
);
const contentBlockRevisionHeader: OpenApiMap = {
  name: "If-Match",
  in: "header",
  required: true,
  description:
    "Current positive content-block revision returned by the read endpoint.",
  schema: { type: "string", pattern: '^"?[1-9][0-9]*"?$' },
};
const lessonPageRevisionHeader: OpenApiMap = {
  name: "If-Match",
  in: "header",
  required: true,
  description:
    "Current positive lesson-page revision returned by the read endpoint.",
  schema: { type: "string", pattern: '^"?[1-9][0-9]*"?$' },
};
const courseId = pathParameter("courseId", "Course identifier.");
const moduleId = pathParameter("moduleId", "Module identifier.");
const requestId = pathParameter("requestId", "Access request identifier.");
const widgetId = pathParameter("widgetId", "Course widget identifier.");
const lessonId = pathParameter("lessonId", "Lesson identifier.");
const versionId = pathParameter("versionId", "Course version identifier.");
const bundleId = pathParameter("bundleId", "Bundle identifier.");
const userId = pathParameter("userId", "Member identifier.");
const teamRoleId = pathParameter("id", "Team-role identifier.");
const chatId = pathParameter("chatId", "Conversation identifier.");
const deliveryId = pathParameter("deliveryId", "Webhook delivery identifier.");

type ApiOperationOptions = {
  tag: string;
  summary: string;
  operationId: string;
  scopes: string[];
  parameters?: OpenApiMap[];
  query?: OpenApiMap[];
  requestSchema?: string;
  responseSchema?: string;
  responseMetaSchema?: string;
  status?: "200" | "201" | "202";
  list?: boolean;
  paginated?: boolean;
  idempotent?: boolean;
  precondition?: boolean;
  serviceUnavailable?: boolean;
  description?: string;
};

function apiOperation(options: ApiOperationOptions): OpenApiOperation {
  const status = options.status ?? "200";
  const parameters = [
    parameterRef("RequestId"),
    ...(options.idempotent ? [parameterRef("IdempotencyKey")] : []),
    ...(options.parameters ?? []),
    ...(options.paginated
      ? [parameterRef("Cursor"), parameterRef("Limit")]
      : []),
    ...(options.query ?? []),
  ];
  return {
    tags: [options.tag],
    summary: options.summary,
    ...(options.description ? { description: options.description } : {}),
    operationId: options.operationId,
    security: [{ BearerApiKey: [] }],
    "x-required-scopes": options.scopes,
    parameters,
    ...(options.requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: schemaRef(options.requestSchema) },
            },
          },
        }
      : {}),
    responses: {
      [status]: successResponse(`${options.summary} succeeded.`, {
        list: options.list,
        paginated: options.paginated,
        dataSchema: options.responseSchema
          ? options.list
            ? { type: "array", items: schemaRef(options.responseSchema) }
            : schemaRef(options.responseSchema)
          : undefined,
        metaSchema: options.responseMetaSchema
          ? schemaRef(options.responseMetaSchema)
          : undefined,
      }),
      ...(options.precondition
        ? { "428": responseRef("PreconditionRequired") }
        : {}),
      ...(options.serviceUnavailable
        ? { "503": responseRef("ServiceUnavailable") }
        : {}),
      ...standardErrors,
    },
  };
}

type PublicOperationOptions = {
  tag: string;
  summary: string;
  operationId: string;
  security?: OpenApiMap[];
  parameters?: OpenApiMap[];
  requestSchema?: string;
  status?: "200" | "201" | "202";
  list?: boolean;
  errors?: string[];
  description?: string;
};

function publicOperation(options: PublicOperationOptions): OpenApiOperation {
  const status = options.status ?? "200";
  return {
    tags: [options.tag],
    summary: options.summary,
    ...(options.description ? { description: options.description } : {}),
    operationId: options.operationId,
    security: options.security ?? [],
    parameters: [parameterRef("RequestId"), ...(options.parameters ?? [])],
    ...(options.requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: schemaRef(options.requestSchema) },
            },
          },
        }
      : {}),
    responses: {
      [status]: successResponse(`${options.summary} succeeded.`, {
        list: options.list,
        rateHeaders: false,
      }),
      ...Object.fromEntries(
        (options.errors ?? []).map((code) => [
          code,
          responseRef(`Http${code}`),
        ]),
      ),
    },
  };
}

type CrudOptions = {
  base: string;
  tag: string;
  singular: string;
  plural: string;
  prefix: string;
  createSchema: string;
  updateSchema: string;
  readScopes: string[];
  writeScopes: string[];
  listQuery?: OpenApiMap[];
  itemQuery?: OpenApiMap[];
  deleteVerb?: string;
  createDescription?: string;
  updateDescription?: string;
  deleteDescription?: string;
  deleteUnsupported?: boolean;
  listResponseSchema?: string;
  createResponseSchema?: string;
  itemResponseSchema?: string;
  updateResponseSchema?: string;
  deleteResponseSchema?: string;
};

const paths: OpenApiPaths = {};

function addCrud(options: CrudOptions) {
  paths[options.base] = {
    get: apiOperation({
      tag: options.tag,
      summary: `List ${options.plural}`,
      operationId: `list${options.prefix}`,
      scopes: options.readScopes,
      query: options.listQuery,
      list: true,
      paginated: true,
      responseSchema: options.listResponseSchema,
    }),
    post: apiOperation({
      tag: options.tag,
      summary: `Create ${options.singular}`,
      operationId: `create${options.prefix.replace(/s$/, "")}`,
      scopes: options.writeScopes,
      requestSchema: options.createSchema,
      status: "201",
      idempotent: true,
      description: options.createDescription,
      responseSchema: options.createResponseSchema,
    }),
  };
  const deleteOperation = apiOperation({
    tag: options.tag,
    summary: `${options.deleteVerb ?? "Delete"} ${options.singular}`,
    operationId: `${(options.deleteVerb ?? "delete").toLowerCase()}${options.prefix.replace(/s$/, "")}`,
    scopes: options.writeScopes,
    parameters: [id],
    idempotent: true,
    description: options.deleteDescription,
    responseSchema: options.deleteResponseSchema,
  });
  if (options.deleteUnsupported) {
    deleteOperation.deprecated = true;
    deleteOperation["x-always-error"] = true;
    deleteOperation.responses = {
      "400": standardErrors["400"],
      "401": standardErrors["401"],
      "403": standardErrors["403"],
      "404": standardErrors["404"],
      "409": standardErrors["409"],
      "429": standardErrors["429"],
      "500": standardErrors["500"],
    };
  }
  paths[`${options.base}/{id}`] = {
    get: apiOperation({
      tag: options.tag,
      summary: `Get ${options.singular}`,
      operationId: `get${options.prefix.replace(/s$/, "")}`,
      scopes: options.readScopes,
      parameters: [id],
      query: options.itemQuery,
      responseSchema: options.itemResponseSchema,
    }),
    patch: apiOperation({
      tag: options.tag,
      summary: `Update ${options.singular}`,
      operationId: `update${options.prefix.replace(/s$/, "")}`,
      scopes: options.writeScopes,
      parameters: [id],
      requestSchema: options.updateSchema,
      idempotent: true,
      description: options.updateDescription,
      responseSchema: options.updateResponseSchema,
    }),
    delete: deleteOperation,
  };
}

paths["/openapi"] = {
  get: {
    tags: ["System"],
    summary: "Get the OpenAPI document",
    description:
      "Returns this OpenAPI 3.1 document without an authentication requirement.",
    operationId: "getOpenApiDocument",
    security: [],
    parameters: [],
    responses: {
      "200": {
        description: "OpenAPI document returned.",
        headers: requestIdHeader,
        content: { "application/json": { schema: { type: "object" } } },
      },
    },
  },
};

paths["/health"] = {
  get: {
    tags: ["System"],
    summary: "Check aggregate service health",
    operationId: "getHealth",
    security: [],
    parameters: [],
    responses: {
      "200": {
        description: "Service and database are healthy.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["data"],
              properties: { data: schemaRef("HealthData") },
              additionalProperties: false,
            },
          },
        },
      },
      "503": {
        description: "Database connectivity is degraded.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["data"],
              properties: { data: schemaRef("HealthData") },
              additionalProperties: false,
            },
          },
        },
      },
    },
  },
};

paths["/health/live"] = {
  get: {
    tags: ["System"],
    summary: "Check process liveness",
    operationId: "getLiveness",
    security: [],
    parameters: [],
    responses: {
      "200": successResponse("Process is alive.", { rateHeaders: false }),
    },
  },
};

paths["/health/ready"] = {
  get: {
    tags: ["System"],
    summary: "Check database readiness",
    operationId: "getReadiness",
    security: [],
    parameters: [],
    responses: {
      "200": successResponse("Service is ready.", {
        rateHeaders: false,
        dataSchema: schemaRef("HealthData"),
      }),
      "503": {
        description: "The database is unavailable.",
        headers: requestIdHeader,
        content: {
          "application/problem+json": {
            schema: {
              type: "object",
              required: ["type", "title", "status", "detail", "requestId"],
              properties: {
                type: { type: "string" },
                title: { type: "string" },
                status: { const: 503 },
                detail: { type: "string" },
                requestId: { type: "string", format: "uuid" },
              },
              additionalProperties: false,
            },
          },
        },
      },
    },
  },
};

paths["/auth/login"] = {
  post: publicOperation({
    tag: "Authentication",
    summary: "Create browser session",
    operationId: "login",
    requestSchema: "AuthLogin",
    errors: ["400", "401", "413", "422", "429"],
    description:
      "Validates credentials and sets the HttpOnly `q_academy_session` cookie. API keys are not accepted by this browser-session endpoint.",
  }),
};
paths["/auth/login"]!.post!.responses["202"] = successResponse(
  "Primary credentials are valid and an MFA challenge must be completed before a browser session exists.",
  { rateHeaders: false },
);

paths["/auth/mfa"] = {
  get: publicOperation({
    tag: "Authentication",
    summary: "Read active MFA challenge",
    operationId: "getMfaChallenge",
    errors: ["401", "409"],
    description:
      "Reads the short-lived HttpOnly challenge cookie. Enrollment responses contain only the current otpauth provisioning data; no application session exists yet and responses are never cached.",
  }),
  post: publicOperation({
    tag: "Authentication",
    summary: "Complete MFA challenge",
    operationId: "completeMfaChallenge",
    requestSchema: "AuthMfaComplete",
    errors: ["400", "401", "403", "409", "413", "422", "429"],
    description:
      "Requires the tenant-canonical same-origin browser mutation, consumes the database-bound challenge exactly once, rejects replayed TOTP counters, consumes recovery codes once, and creates the persisted session only after success. The response includes a role-safe redirect destination and, only during enrollment, the one-time recovery codes.",
  }),
};

const oidcNoStoreResponseHeaders = {
  "Cache-Control": {
    schema: { type: "string", const: "no-store" },
    description: "OIDC initiation responses must never be cached.",
  },
  "Referrer-Policy": {
    schema: { type: "string", const: "no-referrer" },
    description:
      "Prevents authorization parameters from being disclosed through referrers.",
  },
};
const oidcTransactionResponseHeaders = {
  ...oidcNoStoreResponseHeaders,
  "Set-Cookie": {
    schema: { type: "string" },
    description:
      "Sets the short-lived encrypted, HttpOnly, SameSite=Lax OIDC transaction cookie and the pseudonymous rate-client cookie. Secure is enabled in production.",
  },
};
const oidcAuthorizationRedirectHeaders = {
  ...oidcTransactionResponseHeaders,
  Location: { schema: { type: "string", format: "uri" } },
};
const oidcFailClosedRedirectHeaders = {
  ...oidcNoStoreResponseHeaders,
  Location: { schema: { type: "string", format: "uri-reference" } },
  "Set-Cookie": {
    schema: { type: "string" },
    description:
      "May set or refresh only the pseudonymous rate-client cookie; fail-closed errors do not issue a usable OIDC transaction.",
  },
};

paths["/auth/oidc/start"] = {
  get: {
    tags: ["Authentication"],
    summary: "Start OpenID Connect login",
    description:
      "Resolves the active tenant from the trusted login hostname, validates provider discovery, binds state, nonce, PKCE verifier, tenant, issuer, configuration version, and redirect URI in a short-lived encrypted HttpOnly cookie, then redirects to the provider with 302. Canonical-host and fail-closed error redirects use 307.",
    operationId: "startOidcLogin",
    security: [],
    parameters: [
      {
        name: "return_to",
        in: "query",
        required: false,
        description:
          "Optional same-origin destination inside the role's own application area.",
        schema: { type: "string", maxLength: 300 },
      },
    ],
    responses: {
      "302": {
        description:
          "Redirect to the validated provider authorization endpoint after issuing the bound transaction cookie.",
        headers: oidcAuthorizationRedirectHeaders,
      },
      "307": {
        description:
          "Redirect to the canonical tenant start endpoint or back to the login page with a non-sensitive fail-closed error code.",
        headers: oidcFailClosedRedirectHeaders,
      },
    },
  },
  post: {
    tags: ["Authentication"],
    summary: "Link the current browser session to OpenID Connect",
    description:
      "Requires a live same-tenant CookieSession and an exact same-origin POST. With `Accept: application/json`, returns the validated authorization URL with 200 so a CSP-safe client can navigate explicitly; other successful clients receive a 303 provider redirect. The encrypted transaction binds the exact user and persisted session, and fail-closed redirects use 307.",
    operationId: "linkCurrentOidcSession",
    security: [{ CookieSession: [] }],
    parameters: [
      {
        name: "return_to",
        in: "query",
        required: false,
        description:
          "Optional same-origin destination inside the role's own application area.",
        schema: { type: "string", maxLength: 300 },
      },
    ],
    responses: {
      "200": {
        description:
          "CSP-safe authorization handoff for clients requesting application/json. The transaction is already sealed and set as a cookie before this URL is returned.",
        headers: oidcTransactionResponseHeaders,
        content: {
          "application/json": {
            schema: schemaRef("OidcAuthorizationStart"),
          },
        },
      },
      "303": {
        description:
          "Redirect to the validated provider authorization endpoint after binding the current session.",
        headers: oidcAuthorizationRedirectHeaders,
      },
      "307": {
        description:
          "Redirect to the login page with a non-sensitive error when the session, tenant, origin, rate limit or provider configuration fails closed.",
        headers: oidcFailClosedRedirectHeaders,
      },
    },
  },
};

paths["/auth/oidc/callback"] = {
  get: {
    tags: ["Authentication"],
    summary: "Complete OpenID Connect login",
    description:
      "Validates the encrypted transaction, state, PKCE, nonce, signed ID Token, issuer, audience, verified email, tenant configuration version, and durable issuer-subject identity before creating a persisted browser session. Provider tokens are never stored.",
    operationId: "completeOidcLogin",
    security: [],
    parameters: [
      {
        name: "code",
        in: "query",
        required: false,
        schema: { type: "string", maxLength: 4096 },
      },
      {
        name: "state",
        in: "query",
        required: true,
        schema: { type: "string", maxLength: 256 },
      },
      {
        name: "error",
        in: "query",
        required: false,
        schema: { type: "string", maxLength: 200 },
      },
    ],
    responses: {
      "307": {
        description:
          "Redirect to the role-bound application destination after success, or to the login page with a non-sensitive error code.",
        headers: {
          Location: { schema: { type: "string", format: "uri-reference" } },
          "Set-Cookie": {
            schema: { type: "string" },
            description:
              "Clears the OIDC transaction and sets a persisted session only after successful validation.",
          },
        },
      },
    },
  },
};

paths["/auth/logout"] = {
  post: publicOperation({
    tag: "Authentication",
    summary: "End browser session",
    operationId: "logout",
    security: [{}, { CookieSession: [] }],
    errors: ["403"],
    description:
      "Revokes the current persisted session when present and clears the session cookie. Requests with an Origin header are protected by same-origin validation.",
  }),
};

paths["/me"] = {
  get: publicOperation({
    tag: "Authentication",
    summary: "Get current browser-session user",
    operationId: "getCurrentSessionUser",
    security: [{ CookieSession: [] }],
    errors: ["401"],
  }),
};

paths["/me/sessions"] = {
  get: publicOperation({
    tag: "Authentication",
    summary: "List active browser sessions",
    operationId: "listBrowserSessions",
    security: [{ CookieSession: [] }],
    list: true,
    errors: ["401"],
  }),
};

paths["/me/sessions/{id}"] = {
  delete: publicOperation({
    tag: "Authentication",
    summary: "Revoke browser session",
    operationId: "revokeBrowserSession",
    security: [{ CookieSession: [] }],
    parameters: [id],
    errors: ["400", "401", "403", "404"],
    description: "Revoking the current session also clears the session cookie.",
  }),
};

paths["/me/exam-attempts"] = {
  post: publicOperation({
    tag: "Assessments",
    summary: "Start or resume an exam in the browser session",
    operationId: "startSessionExamAttempt",
    security: [{ CookieSession: [] }],
    requestSchema: "ExamAttemptSessionStart",
    status: "201",
    errors: ["400", "401", "403", "404", "409", "413", "422"],
    description:
      "Starts a frozen exam attempt or returns the existing active or pending-release attempt for the signed-in learner. Mutations require a trusted same-origin browser request.",
  }),
};

paths["/me/exam-attempts/{id}"] = {
  get: publicOperation({
    tag: "Assessments",
    summary: "Get own browser-session exam attempt",
    operationId: "getSessionExamAttempt",
    security: [{ CookieSession: [] }],
    parameters: [id],
    errors: ["401", "404"],
  }),
  patch: publicOperation({
    tag: "Assessments",
    summary: "Autosave own browser-session exam attempt",
    operationId: "saveSessionExamAttempt",
    security: [{ CookieSession: [] }],
    parameters: [id],
    requestSchema: "ExamAttemptDraft",
    errors: ["400", "401", "403", "404", "409", "413", "422"],
    description:
      "Uses optimistic draft revisions and requires a trusted same-origin browser request.",
  }),
};

paths["/me/exam-attempts/{id}/submit"] = {
  post: publicOperation({
    tag: "Assessments",
    summary: "Submit own browser-session exam attempt",
    operationId: "submitSessionExamAttempt",
    security: [{ CookieSession: [] }],
    parameters: [id],
    requestSchema: "ExamAttemptSubmit",
    errors: ["400", "401", "403", "404", "409", "413", "422"],
    description: "Requires a trusted same-origin browser request.",
  }),
};

paths["/me/exam-attempts/{id}/result"] = {
  get: publicOperation({
    tag: "Assessments",
    summary: "Get own released browser-session exam result",
    operationId: "getSessionExamAttemptResult",
    security: [{ CookieSession: [] }],
    parameters: [id],
    errors: ["401", "404"],
  }),
};

paths["/me/exam-attempts/{id}/release"] = {
  post: publicOperation({
    tag: "Assessments",
    summary: "Release an exam from an authorized staff browser session",
    operationId: "releaseSessionExamAttempt",
    security: [{ CookieSession: [] }],
    parameters: [id],
    requestSchema: "ExamAttemptRelease",
    errors: ["400", "401", "403", "404", "409", "413", "422"],
    description:
      "Requires an active staff account, current course edit permission, and a trusted same-origin browser request.",
  }),
};

paths["/me/exam-attempts/{id}/finalize"] = {
  post: publicOperation({
    tag: "Assessments",
    summary: "Finalize an exam from an authorized staff browser session",
    operationId: "finalizeSessionExamAttempt",
    security: [{ CookieSession: [] }],
    parameters: [id],
    errors: ["401", "403", "404", "409"],
    description:
      "Grades the current draft to recover an abandoned active attempt. Requires current course edit permission and a trusted same-origin browser request.",
  }),
};

paths["/password/forgot"] = {
  post: publicOperation({
    tag: "Authentication",
    summary: "Request password reset",
    operationId: "requestPasswordReset",
    requestSchema: "PasswordForgot",
    status: "202",
    errors: ["400", "413", "422", "429"],
  }),
};

paths["/password/reset"] = {
  post: publicOperation({
    tag: "Authentication",
    summary: "Reset password",
    operationId: "resetPassword",
    requestSchema: "PasswordReset",
    errors: ["400", "413", "422", "429"],
  }),
};

paths["/invitations/{token}/accept"] = {
  post: publicOperation({
    tag: "Authentication",
    summary: "Accept invitation",
    operationId: "acceptInvitation",
    parameters: [
      pathParameter("token", "Opaque invitation token.", {
        type: "string",
        minLength: 32,
      }),
    ],
    requestSchema: "InvitationAccept",
    errors: ["400", "409", "413", "422"],
    description:
      "Activates the invited account. A privileged account subject to MFA receives a short-lived challenge and no browser session until the second factor succeeds.",
  }),
};
paths["/invitations/{token}/accept"]!.post!.responses["202"] = successResponse(
  "Invitation accepted and MFA enrollment is required before a browser session exists.",
  { rateHeaders: false },
);

paths["/organization"] = {
  get: apiOperation({
    tag: "Organization",
    summary: "Get organization",
    operationId: "getOrganization",
    scopes: ["organization:read"],
  }),
  patch: apiOperation({
    tag: "Organization",
    summary: "Update organization",
    operationId: "updateOrganization",
    scopes: ["organization:write"],
    requestSchema: "OrganizationUpdate",
    idempotent: true,
  }),
};

paths["/organization/domains"] = {
  get: apiOperation({
    tag: "Authentication",
    summary: "List custom-domain claims",
    operationId: "listCustomDomainClaims",
    scopes: ["authentication:read"],
    responseSchema: "CustomDomainClaim",
    list: true,
    description:
      "Lists only safe lifecycle metadata for the current tenant. Challenge hashes and previously issued TXT values are never returned.",
  }),
  post: apiOperation({
    tag: "Authentication",
    summary: "Create a custom-domain claim",
    operationId: "createCustomDomainClaim",
    scopes: ["authentication:write"],
    requestSchema: "CustomDomainClaimCreate",
    responseSchema: "CustomDomainClaimIssued",
    status: "201",
    description:
      "Requires an owner-bound key and the custom-domains entitlement. The exact TXT value is returned once; only its SHA-256 hash is persisted. This secret-returning operation is deliberately not idempotency-replayed.",
  }),
};

paths["/organization/domains/{id}/rotate"] = {
  post: apiOperation({
    tag: "Authentication",
    summary: "Rotate a pending domain challenge",
    operationId: "rotateCustomDomainChallenge",
    scopes: ["authentication:write"],
    parameters: [id],
    requestSchema: "CustomDomainClaimMutation",
    responseSchema: "CustomDomainClaimIssued",
    description:
      "Replaces a pending challenge under optimistic revision control and returns the new TXT value once. The previous value becomes unusable immediately.",
  }),
};

paths["/organization/domains/{id}/verify"] = {
  post: apiOperation({
    tag: "Authentication",
    summary: "Verify and activate a custom domain",
    operationId: "verifyCustomDomainClaim",
    scopes: ["authentication:write"],
    parameters: [id],
    requestSchema: "CustomDomainClaimMutation",
    responseSchema: "CustomDomainVerificationResult",
    idempotent: true,
    description:
      "Performs a bounded DNS TXT lookup and requires an exact challenge match. Tenant, owner, status, revision, expiry, and challenge identity are revalidated before the verified host is atomically activated for branding and authentication links.",
  }),
};

paths["/organization/domains/{id}/revoke"] = {
  post: apiOperation({
    tag: "Authentication",
    summary: "Revoke a custom-domain claim",
    operationId: "revokeCustomDomainClaim",
    scopes: ["authentication:write"],
    parameters: [id],
    requestSchema: "CustomDomainClaimMutation",
    responseSchema: "CustomDomainClaim",
    idempotent: true,
    description:
      "Revokes the tenant-bound claim under optimistic revision control and atomically removes the host from runtime branding. Existing host-only browser sessions and API-key tenant binding are unchanged.",
  }),
};

paths["/organization/contract"] = {
  get: apiOperation({
    tag: "Organization",
    summary: "Get contract, entitlements, limits, and current usage",
    operationId: "getOrganizationContract",
    scopes: ["organization:read"],
    responseSchema: "OrganizationContractOverview",
  }),
};

paths["/organization/welcome-popup"] = {
  get: apiOperation({
    tag: "Organization",
    summary: "Get member welcome popup configuration",
    operationId: "getMemberWelcomeSettings",
    scopes: ["organization:read"],
    responseSchema: "MemberWelcomeSettings",
  }),
  patch: apiOperation({
    tag: "Organization",
    summary: "Update member welcome popup configuration",
    operationId: "updateMemberWelcomeSettings",
    scopes: ["organization:write"],
    requestSchema: "MemberWelcomeSettingsUpdate",
    responseSchema: "MemberWelcomeSettings",
    idempotent: true,
    description:
      "Material changes atomically advance the tenant configuration version so members acknowledge the new popup once.",
  }),
};

paths["/organization/oidc"] = {
  get: apiOperation({
    tag: "Organization",
    summary: "Get OpenID Connect configuration",
    operationId: "getOidcConfiguration",
    scopes: ["authentication:read"],
    responseSchema: "OidcConfiguration",
    description:
      "Returns tenant OIDC metadata and only a boolean secret-presence marker; the encrypted or plaintext client secret is never returned.",
  }),
  patch: apiOperation({
    tag: "Organization",
    summary: "Validate and update OpenID Connect configuration",
    operationId: "updateOidcConfiguration",
    scopes: ["authentication:write"],
    requestSchema: "OidcConfigurationUpdate",
    responseSchema: "OidcConfiguration",
    idempotent: true,
    description:
      "Requires an explicit owner-bound authentication:write scope, validates provider discovery before the transaction, revalidates owner/key state in the commit, and applies optimistic configuration versioning.",
  }),
};

paths["/organization/transcript-search"] = {
  get: apiOperation({
    tag: "Organization",
    summary: "Get transcript search exclusions",
    operationId: "getTranscriptSearchSettings",
    scopes: ["organization:read"],
    responseSchema: "TranscriptSearchSettings",
  }),
  patch: apiOperation({
    tag: "Organization",
    summary: "Update transcript search exclusions",
    operationId: "updateTranscriptSearchSettings",
    scopes: ["organization:write"],
    requestSchema: "TranscriptSearchSettingsUpdate",
    responseSchema: "TranscriptSearchSettings",
    idempotent: true,
    description:
      "Stores normalized tenant-scoped words and phrases. A search is suppressed when its normalized token sequence contains one configured word or contiguous phrase; transcript content is not modified.",
  }),
};

addCrud({
  base: "/team-roles",
  tag: "Team Roles",
  singular: "team role",
  plural: "team roles",
  prefix: "TeamRoles",
  createSchema: "TeamRoleCreate",
  updateSchema: "TeamRoleUpdate",
  readScopes: ["team_roles:read"],
  writeScopes: ["team_roles:write"],
  createDescription:
    "Creates a tenant-bound custom staff role. The scope is owner-bound and permission keys are restricted to the published allowlist.",
  updateDescription:
    "Updates a role with mandatory optimistic revision checking. Inactive or malformed assignments resolve fail-closed.",
  deleteDescription:
    "Deletes only an unassigned same-tenant role. Assigned roles must be unassigned first.",
});

paths["/team-roles/{id}/assignments"] = {
  get: apiOperation({
    tag: "Team Roles",
    summary: "List team-role assignments",
    operationId: "listTeamRoleAssignments",
    scopes: ["team_roles:read"],
    parameters: [teamRoleId],
    list: true,
  }),
  post: apiOperation({
    tag: "Team Roles",
    summary: "Assign team role",
    operationId: "assignTeamRole",
    scopes: ["team_roles:write"],
    parameters: [teamRoleId],
    requestSchema: "TeamRoleAssignment",
    status: "201",
    idempotent: true,
    description:
      "Assigns an active same-tenant custom role to an active administrator or trainer. Owner accounts are immutable.",
  }),
};

paths["/team-roles/{id}/assignments/{userId}"] = {
  delete: apiOperation({
    tag: "Team Roles",
    summary: "Remove team-role assignment",
    operationId: "unassignTeamRole",
    scopes: ["team_roles:write"],
    parameters: [teamRoleId, userId],
    idempotent: true,
    description:
      "Removes only the assignment identified by both role and user within the API key tenant. The base-role defaults then apply again.",
  }),
};

addCrud({
  base: "/announcements",
  tag: "Announcements",
  singular: "announcement",
  plural: "announcements",
  prefix: "Announcements",
  createSchema: "AnnouncementCreate",
  updateSchema: "AnnouncementUpdate",
  readScopes: ["notifications:read"],
  writeScopes: ["notifications:write"],
  listQuery: [
    queryParameter("search", "Search announcement title and body."),
    enumQuery("active", "Filter active state.", ["true", "false"]),
    enumQuery("audience", "Filter audience type.", ["all", "user", "group"]),
    enumQuery("placement", "Filter placement.", ["banner", "modal"]),
  ],
});

paths["/agents/{id}/draft"] = {
  put: apiOperation({
    tag: "AI Agents",
    summary: "Replace an AI agent draft",
    description:
      "Optimistically replaces the mutable draft configuration, curated sources and audience grants. Published versions remain immutable.",
    operationId: "replaceAgentDraft",
    scopes: ["agents:write"],
    parameters: [id],
    requestSchema: "AgentDraftUpdate",
    idempotent: true,
  }),
};

paths["/agents/{id}/publish"] = {
  post: apiOperation({
    tag: "AI Agents",
    summary: "Publish an AI agent draft",
    description:
      "Seals the expected draft as an immutable version, freezes current course versions and creates the next editable draft atomically.",
    operationId: "publishAgentDraft",
    scopes: ["agents:write"],
    parameters: [id],
    requestSchema: "AgentPublish",
    idempotent: true,
  }),
};

paths["/agents/{id}/rollback"] = {
  post: apiOperation({
    tag: "AI Agents",
    summary: "Roll back the current AI agent version",
    description:
      "Atomically points new conversations and current access checks to an earlier immutable published version. Existing conversations retain their bound version.",
    operationId: "rollbackAgentVersion",
    scopes: ["agents:write"],
    parameters: [id],
    requestSchema: "AgentRollback",
    idempotent: true,
  }),
};

paths["/agents/{id}/versions"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "List AI agent versions",
    operationId: "listAgentVersions",
    scopes: ["agents:read"],
    parameters: [id],
  }),
};

paths["/agent-actions"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "List AI agent action requests",
    description:
      "Returns the tenant-bound approval queue with typed course, group, or bundle targets and without prompt or message content. The API key must belong to an active owner or admin.",
    operationId: "listAgentActionRequests",
    scopes: ["agents:read"],
    query: [
      enumQuery("status", "Filter decision status.", [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
      ]),
      queryParameter("memberId", "Filter by requesting member.", uuidSchema),
      queryParameter("agentId", "Filter by agent.", uuidSchema),
    ],
    list: true,
  }),
  post: apiOperation({
    tag: "AI Agents",
    summary: "Request a configured AI agent action",
    description:
      "Creates one pending, approval-gated request for an accessible member and immutable published action configuration. The target is snapshotted as course, group, or bundle; the request never mutates access directly.",
    operationId: "createAgentActionRequest",
    scopes: ["agents:write"],
    requestSchema: "AgentActionRequestCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/agent-actions/{id}/decision"] = {
  post: apiOperation({
    tag: "AI Agents",
    summary: "Approve or reject an AI agent action",
    description:
      "Uses optimistic request revisions. Approval, the typed access mutation, provenance update, append-only decision event, activity audit and webhook outbox are committed atomically. Group or bundle removal is limited to active assignments created by the same AI agent.",
    operationId: "decideAgentActionRequest",
    scopes: ["agents:write"],
    parameters: [id],
    requestSchema: "AgentActionDecision",
    idempotent: true,
  }),
};

paths["/agent-actions/{id}/events"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "List the immutable action decision history",
    description:
      "Returns the ordered status transitions after verifying every event against the immutable request payload digest. Actor pseudonyms, digests and metadata are never exposed.",
    operationId: "listAgentActionEvents",
    scopes: ["agents:read"],
    parameters: [id],
    list: true,
  }),
};

paths["/community/spaces/{id}/access-policy"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get community space access policy",
    description:
      "Returns normalized role, user, group, and active-bundle rules. Only the API key's active owner or admin creator may read policy internals.",
    operationId: "getCommunitySpaceAccessPolicy",
    scopes: ["community:read"],
    parameters: [id],
    responseSchema: "CommunitySpaceAccessPolicyData",
  }),
  put: apiOperation({
    tag: "Community",
    summary: "Replace community space access policy",
    description:
      "Atomically replaces every rule and the open or restricted mode. Owner and admin API-key creators bypass effective rules; announcements remain admin-write and never accept comments.",
    operationId: "replaceCommunitySpaceAccessPolicy",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunitySpaceAccessPolicy",
    responseSchema: "CommunitySpaceAccessPolicyData",
    idempotent: true,
  }),
};

addCrud({
  base: "/agents",
  tag: "AI Agents",
  singular: "AI agent",
  plural: "AI agents",
  prefix: "Agents",
  createSchema: "AgentCreate",
  updateSchema: "AgentUpdate",
  readScopes: ["agents:read"],
  writeScopes: ["agents:write"],
  listQuery: [
    queryParameter("search", "Search name and description."),
    enumQuery("active", "Filter by active state.", ["true", "false"]),
    queryParameter("icon", "Filter by icon."),
    queryParameter("sort", "Sort expression."),
  ],
});

paths["/events/{id}/lifecycle"] = {
  get: apiOperation({
    tag: "Events",
    summary: "List immutable event lifecycle history",
    operationId: "listEventLifecycleHistory",
    scopes: ["events:read"],
    parameters: [id],
    list: true,
  }),
  patch: apiOperation({
    tag: "Events",
    summary: "Cancel or reschedule an event",
    description:
      "Applies a revisioned lifecycle transition and atomically queues member notifications, email deliveries and webhooks.",
    operationId: "updateEventLifecycle",
    scopes: ["events:write"],
    parameters: [id],
    requestSchema: "EventLifecycleCommand",
    idempotent: true,
  }),
};

addCrud({
  base: "/bundles",
  tag: "Bundles",
  singular: "bundle",
  plural: "bundles",
  prefix: "Bundles",
  createSchema: "BundleCreate",
  updateSchema: "BundleUpdate",
  readScopes: ["bundles:read"],
  writeScopes: ["bundles:write"],
  listQuery: [
    queryParameter("search", "Search bundle names."),
    enumQuery("active", "Filter by active state.", ["true", "false"]),
    queryParameter("sort", "Sort expression."),
  ],
});

addCrud({
  base: "/badges",
  tag: "Badges",
  singular: "badge",
  plural: "badges",
  prefix: "Badges",
  createSchema: "BadgeCreate",
  updateSchema: "BadgeUpdate",
  readScopes: ["community:read"],
  writeScopes: ["community:write"],
  deleteVerb: "Disable",
  listQuery: [
    queryParameter("search", "Search badge names."),
    enumQuery("active", "Filter by active state.", ["true", "false"]),
  ],
});

addCrud({
  base: "/badge-groups",
  tag: "Badges",
  singular: "badge group",
  plural: "badge groups",
  prefix: "BadgeGroups",
  createSchema: "BadgeGroupCreate",
  updateSchema: "BadgeGroupUpdate",
  readScopes: ["community:read"],
  writeScopes: ["community:write"],
  deleteVerb: "Disable",
  listQuery: [queryParameter("search", "Search badge-group names.")],
});

addCrud({
  base: "/community/spaces",
  tag: "Community",
  singular: "community space",
  plural: "community spaces",
  prefix: "CommunitySpaces",
  createSchema: "CommunitySpaceCreate",
  updateSchema: "CommunitySpaceUpdate",
  readScopes: ["community:read"],
  writeScopes: ["community:write"],
  listQuery: [queryParameter("search", "Search spaces.")],
  listResponseSchema: "CommunitySpace",
  createResponseSchema: "CommunitySpace",
  itemResponseSchema: "CommunitySpace",
  updateResponseSchema: "CommunitySpace",
  deleteResponseSchema: "CommunityEntityDeletionResult",
});

paths["/community/areas"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List visible community areas",
    operationId: "listCommunityAreas",
    scopes: ["community:read"],
    responseSchema: "CommunityArea",
    list: true,
    description:
      "Owners and administrators see all tenant areas. Other actors see only areas containing at least one space visible under the current space policy.",
  }),
  post: apiOperation({
    tag: "Community",
    summary: "Create community area",
    operationId: "createCommunityArea",
    scopes: ["community:write"],
    requestSchema: "CommunityAreaCreate",
    responseSchema: "CommunityArea",
    status: "201",
    idempotent: true,
  }),
};

paths["/community/areas/{id}"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get visible community area",
    operationId: "getCommunityArea",
    scopes: ["community:read"],
    parameters: [id],
    responseSchema: "CommunityArea",
  }),
  patch: apiOperation({
    tag: "Community",
    summary: "Update community area",
    operationId: "updateCommunityArea",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityAreaUpdate",
    responseSchema: "CommunityArea",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Delete empty community area",
    operationId: "deleteCommunityArea",
    scopes: ["community:write"],
    parameters: [id],
    responseSchema: "CommunityEntityDeletionResult",
    idempotent: true,
    description:
      "Requires an active owner or administrator. Areas containing spaces and the tenant's final area cannot be deleted.",
  }),
};

paths["/community/areas/{id}/move"] = {
  post: apiOperation({
    tag: "Community",
    summary: "Move community area",
    operationId: "moveCommunityArea",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityAreaMove",
    responseSchema: "CommunityAreaMoveResult",
    idempotent: true,
    description:
      "Serializes the tenant layout and rewrites area positions to a dense zero-based order.",
  }),
};

paths["/community/spaces/{id}/move"] = {
  post: apiOperation({
    tag: "Community",
    summary: "Move community space",
    operationId: "moveCommunitySpace",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunitySpaceMove",
    responseSchema: "CommunitySpaceMoveResult",
    idempotent: true,
    description:
      "Moves a space within or across tenant areas and atomically compacts both affected orders.",
  }),
};

paths["/community/profile-settings"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get community public-profile settings",
    operationId: "getCommunityProfileSettings",
    scopes: ["community:read"],
    responseSchema: "CommunityProfileSettingsAdminData",
    description: "Requires an active owner or administrator.",
  }),
  put: apiOperation({
    tag: "Community",
    summary: "Replace community public-profile settings",
    operationId: "replaceCommunityProfileSettings",
    scopes: ["community:write"],
    requestSchema: "CommunityProfileSettingsReplace",
    responseSchema: "CommunityProfileSettingsAdminData",
    idempotent: true,
    description:
      "Requires an active owner or administrator and an exact expectedRevision. Enabling the posting gate requires at least one valid required field.",
  }),
};

paths["/community/profile-completion"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get own community profile completion",
    operationId: "getOwnCommunityProfileCompletion",
    scopes: ["community:read"],
    responseSchema: "CommunityProfileCompletion",
  }),
};

paths["/community/profiles/{id}"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get configured public community profile",
    operationId: "getCommunityPublicProfile",
    scopes: ["community:read"],
    parameters: [id],
    responseSchema: "CommunityPublicProfile",
    description:
      "Returns first and last name plus only the tenant-configured safe fields of an active same-tenant member. Fields preserve the administrator's mixed standard/custom order.",
  }),
};

addCrud({
  base: "/community/posts",
  tag: "Community",
  singular: "post",
  plural: "posts",
  prefix: "CommunityPosts",
  createSchema: "PostCreate",
  updateSchema: "PostUpdate",
  readScopes: ["community:read"],
  writeScopes: ["community:write"],
  listQuery: [
    queryParameter("spaceId", "Filter by space.", uuidSchema),
    queryParameter("authorId", "Filter by author.", uuidSchema),
    queryParameter("search", "Search post content."),
  ],
  createDescription:
    "Creates the post and binds up to six ready community assets atomically. Optional courseId creates only a typed tenant-local link after published-course and author-visibility checks; arbitrary URLs are rejected. Returned attachment downloadHref values use bearer-authenticated /api/v1 media endpoints.",
  listResponseSchema: "CommunityPostListItem",
  createResponseSchema: "CommunityPostRecord",
  itemResponseSchema: "CommunityPostRecord",
  updateResponseSchema: "CommunityPostRecord",
  deleteResponseSchema: "CommunityEntityDeletionResult",
});

addCrud({
  base: "/course-categories",
  tag: "Course Categories",
  singular: "course category",
  plural: "course categories",
  prefix: "CourseCategories",
  createSchema: "CourseCategoryCreate",
  updateSchema: "CourseCategoryUpdate",
  readScopes: ["courses:read"],
  writeScopes: ["courses:write"],
  listQuery: [queryParameter("search", "Search categories.")],
  deleteDescription:
    "Deletes the tenant category atomically. Assigned courses remain intact and are explicitly changed to have no category; the response reports the number of removed assignments.",
});

paths["/course-categories/reorder"] = {
  patch: apiOperation({
    tag: "Course Categories",
    summary: "Reorder all course categories",
    description:
      "Replaces the complete tenant category order atomically. The request must contain every current tenant category exactly once; stale, missing, duplicate, or foreign identifiers fail without changing any sort position.",
    operationId: "reorderCourseCategories",
    scopes: ["courses:write"],
    requestSchema: "CourseCategoryReorder",
    idempotent: true,
  }),
};

addCrud({
  base: "/courses",
  tag: "Courses",
  singular: "course",
  plural: "courses",
  prefix: "Courses",
  createSchema: "CourseCreate",
  updateSchema: "CourseUpdate",
  readScopes: ["courses:read"],
  writeScopes: ["courses:write"],
  deleteVerb: "Archive",
  listQuery: [
    queryParameter("search", "Search title and description."),
    enumQuery("status", "Filter course status.", [
      "draft",
      "published",
      "archived",
    ]),
    queryParameter("categoryId", "Filter by category.", uuidSchema),
    queryParameter("sort", "Sort expression."),
  ],
});

addCrud({
  base: "/custom-fields",
  tag: "Custom Fields",
  singular: "custom field",
  plural: "custom fields",
  prefix: "CustomFields",
  createSchema: "CustomFieldCreate",
  updateSchema: "CustomFieldUpdate",
  readScopes: ["custom_fields:read"],
  writeScopes: ["custom_fields:write"],
  deleteVerb: "Disable",
  listQuery: [
    queryParameter("search", "Search field labels."),
    queryParameter("category", "Filter field category."),
    enumQuery("active", "Filter by active state.", ["true", "false"]),
  ],
});

addCrud({
  base: "/events",
  tag: "Events",
  singular: "event",
  plural: "events",
  prefix: "Events",
  createSchema: "EventCreate",
  updateSchema: "EventUpdate",
  readScopes: ["events:read"],
  writeScopes: ["events:write"],
  deleteUnsupported: true,
  deleteDescription:
    "For an existing accessible event, returns 409 because lifecycle history is append-only; no success response is possible. Cancel the event through /events/{id}/lifecycle instead.",
  listQuery: [
    queryParameter("search", "Search events."),
    queryParameter("from", "Start of time range.", dateTimeSchema),
    queryParameter("to", "End of time range.", dateTimeSchema),
    enumQuery("type", "Filter event type.", [
      "live_call",
      "workshop",
      "deadline",
      "webinar",
    ]),
    queryParameter("sort", "Sort expression."),
    queryParameter(
      "userId",
      "Return only events visible to this tenant member.",
      uuidSchema,
    ),
  ],
  itemQuery: [
    queryParameter(
      "userId",
      "Return 404 when the event is not visible to this tenant member.",
      uuidSchema,
    ),
  ],
});

addCrud({
  base: "/feedback",
  tag: "Feedback",
  singular: "feedback entry",
  plural: "feedback entries",
  prefix: "FeedbackEntries",
  createSchema: "FeedbackCreate",
  updateSchema: "FeedbackUpdate",
  readScopes: ["feedback:read"],
  writeScopes: ["feedback:write"],
  createDescription:
    "Creates feedback on behalf of an active tenant member. Lesson feedback requires courseId and lessonId; its optional comment may be empty.",
  listQuery: [
    enumQuery("status", "Filter review status.", [
      "open",
      "completed",
      "new",
      "reviewed",
      "archived",
    ]),
    enumQuery("type", "Filter feedback type.", [
      "course",
      "lesson",
      "platform",
      "event",
    ]),
    queryParameter("courseId", "Filter by course.", uuidSchema),
    queryParameter("userId", "Filter by member.", uuidSchema),
    queryParameter("search", "Search feedback content or member identity."),
    enumQuery("sort", "Sort feedback entries.", [
      "latest",
      "name",
      "rating_asc",
      "rating_desc",
    ]),
  ],
});

paths["/feedback/{id}/reply"] = {
  post: apiOperation({
    tag: "Feedback",
    summary: "Queue a feedback reply email",
    operationId: "replyToFeedbackEntry",
    scopes: ["feedback:write"],
    parameters: [id],
    requestSchema: "FeedbackReply",
    status: "201",
    idempotent: true,
    description:
      "Queues an encrypted tenant-bound email to the active member who created the feedback and marks the feedback reviewed. The outbox record, status update, and reply audit marker commit atomically.",
  }),
};

addCrud({
  base: "/groups",
  tag: "Groups",
  singular: "group",
  plural: "groups",
  prefix: "Groups",
  createSchema: "GroupCreate",
  updateSchema: "GroupUpdate",
  readScopes: ["groups:read"],
  writeScopes: ["groups:write"],
  listQuery: [
    queryParameter("search", "Search groups."),
    queryParameter("sort", "Sort expression."),
  ],
});

addCrud({
  base: "/hubs",
  tag: "Hubs",
  singular: "hub",
  plural: "hubs",
  prefix: "Hubs",
  createSchema: "HubCreate",
  updateSchema: "HubUpdate",
  readScopes: ["hubs:read"],
  writeScopes: ["hubs:write"],
  listQuery: [
    queryParameter("search", "Search hubs."),
    enumQuery("status", "Filter hub status.", [
      "draft",
      "published",
      "archived",
    ]),
    queryParameter("sort", "Sort expression."),
  ],
});

addCrud({
  base: "/members",
  tag: "Members",
  singular: "member",
  plural: "members",
  prefix: "Members",
  createSchema: "MemberCreate",
  updateSchema: "MemberUpdate",
  readScopes: ["members:read"],
  writeScopes: ["members:write"],
  deleteVerb: "Disable",
  createDescription:
    "The members:write scope can create only role=member accounts with status=invited. Staff accounts cannot be created through this API.",
  updateDescription:
    "The members:write scope can update only existing role=member accounts and cannot promote members to staff or mutate staff accounts.",
  deleteDescription:
    "Disables an existing role=member account. Owner, admin, and trainer accounts are protected from this API operation.",
  listQuery: [
    queryParameter("search", "Search members."),
    enumQuery("role", "Filter member role.", [
      "owner",
      "admin",
      "trainer",
      "member",
    ]),
    enumQuery("status", "Filter account status.", [
      "active",
      "invited",
      "disabled",
    ]),
    queryParameter("sort", "Sort expression."),
  ],
});

addCrud({
  base: "/modules",
  tag: "Modules",
  singular: "module",
  plural: "modules",
  prefix: "Modules",
  createSchema: "ModuleCreate",
  updateSchema: "ModuleUpdate",
  readScopes: ["modules:read"],
  writeScopes: ["modules:write"],
  listQuery: [
    queryParameter("search", "Search modules."),
    queryParameter("folder", "Filter by folder."),
    enumQuery("kind", "Filter by module type.", ["learning", "exam", "link"]),
  ],
});

addCrud({
  base: "/webhooks",
  tag: "Webhooks",
  singular: "webhook",
  plural: "webhooks",
  prefix: "Webhooks",
  createSchema: "WebhookCreate",
  updateSchema: "WebhookUpdate",
  readScopes: ["webhooks:read"],
  writeScopes: ["webhooks:write"],
  listQuery: [
    queryParameter("search", "Search webhooks."),
    enumQuery("active", "Filter by active state.", ["true", "false"]),
  ],
});

addCrud({
  base: "/api-keys",
  tag: "API Keys",
  singular: "API key",
  plural: "API keys",
  prefix: "ApiKeys",
  createSchema: "ApiKeyCreate",
  updateSchema: "ApiKeyUpdate",
  readScopes: ["api_keys:read"],
  writeScopes: ["api_keys:write"],
  deleteVerb: "Revoke",
  createDescription:
    "Requested scopes must be a subset of the authenticated API key's scopes. Wildcard delegation requires wildcard or every concrete scope.",
  updateDescription:
    "Scope and lifetime changes must remain delegable by the authenticated key. A key cannot change its own scopes or lifetime.",
  deleteDescription:
    "Revokes another API key. The currently authenticated key cannot revoke itself.",
  listQuery: [
    queryParameter("search", "Search API key names."),
    enumQuery("status", "Filter key status.", ["active", "revoked"]),
  ],
});

paths["/agents/{id}/chats"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "List agent conversations",
    operationId: "listAgentChats",
    scopes: ["agents:read"],
    parameters: [id],
    query: [
      enumQuery("status", "Filter conversation status.", [
        "active",
        "archived",
      ]),
      queryParameter("memberId", "Filter by member.", uuidSchema),
    ],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "AI Agents",
    summary: "Create agent conversation",
    operationId: "createAgentChat",
    scopes: ["agents:write"],
    parameters: [id],
    requestSchema: "AgentChatCreate",
    status: "201",
    idempotent: true,
    precondition: true,
    description:
      "When initialMessage is supplied, the conversation member must already have acknowledged the current tenant AI transparency notice.",
  }),
};

paths["/agents/{id}/chats/{chatId}"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "Get agent conversation",
    operationId: "getAgentChat",
    scopes: ["agents:read"],
    parameters: [id, chatId],
  }),
  patch: apiOperation({
    tag: "AI Agents",
    summary: "Update agent conversation",
    operationId: "updateAgentChat",
    scopes: ["agents:write"],
    parameters: [id, chatId],
    requestSchema: "AgentChatUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "AI Agents",
    summary: "Delete agent conversation",
    operationId: "deleteAgentChat",
    scopes: ["agents:write"],
    parameters: [id, chatId],
    idempotent: true,
  }),
};

paths["/agents/{id}/chats/{chatId}/messages"] = {
  get: apiOperation({
    tag: "AI Agents",
    summary: "List conversation messages",
    operationId: "listAgentChatMessages",
    scopes: ["agents:read"],
    parameters: [id, chatId],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "AI Agents",
    summary: "Send conversation message",
    operationId: "createAgentChatMessage",
    scopes: ["agents:write"],
    parameters: [id, chatId],
    requestSchema: "ChatMessageCreate",
    status: "201",
    idempotent: true,
    precondition: true,
    description:
      "The conversation member must already have acknowledged the current tenant AI transparency notice before provider processing can start.",
  }),
};

paths["/analytics/overview"] = {
  get: apiOperation({
    tag: "Analytics",
    summary: "Get analytics overview",
    operationId: "getAnalyticsOverview",
    scopes: ["analytics:read"],
  }),
};

paths["/member-properties/analytics"] = {
  get: apiOperation({
    tag: "Analytics",
    summary: "Aggregate member profile properties",
    operationId: "getMemberPropertyAnalytics",
    scopes: ["analytics:read", "custom_fields:read", "members:read"],
    query: [
      queryParameter("fieldId", "Profile field to aggregate.", uuidSchema),
      queryParameter(
        "profileDefinitionId",
        "Profile definition context for multi-profile values.",
        uuidSchema,
      ),
      enumQuery("operator", "Member filter operator.", [
        "is_set",
        "is_not_set",
        "equals",
        "not_equals",
        "contains",
      ]),
      queryParameter("value", "Comparison value for value-based operators."),
    ],
    description:
      "Returns tenant-bound aggregate distributions across active member profiles. It never returns member identities or raw profile rows; private fields require the explicit API scopes listed above.",
  }),
};

paths["/member-properties/variables"] = {
  get: apiOperation({
    tag: "Custom Fields",
    summary: "List enabled member-property template variables",
    operationId: "listMemberPropertyVariables",
    scopes: ["custom_fields:read"],
    list: true,
    description:
      "Returns the explicit tenant-bound variable catalog for Hub and announcement text plus the corresponding email token. Only active, member-visible fields with personalization opt-in are included; no member values are returned.",
  }),
};

paths["/analytics/activity"] = {
  get: apiOperation({
    tag: "Analytics",
    summary: "List activity analytics",
    operationId: "listAnalyticsActivity",
    scopes: ["analytics:read"],
    query: [
      queryParameter("type", "Filter activity type."),
      queryParameter("memberId", "Filter by member.", uuidSchema),
      queryParameter("entityType", "Filter entity type."),
      queryParameter("entityId", "Filter entity identifier.", uuidSchema),
      queryParameter("courseId", "Alias for entityId.", uuidSchema),
      queryParameter(
        "from",
        "Include activity from this time.",
        dateTimeSchema,
      ),
      queryParameter(
        "to",
        "Include activity through this time.",
        dateTimeSchema,
      ),
    ],
    list: true,
    paginated: true,
  }),
};

paths["/analytics/courses/{id}"] = {
  get: apiOperation({
    tag: "Analytics",
    summary: "Get course analytics",
    operationId: "getCourseAnalytics",
    scopes: ["analytics:read"],
    parameters: [id],
  }),
};

paths["/analytics/members/{id}"] = {
  get: apiOperation({
    tag: "Analytics",
    summary: "Get member analytics",
    operationId: "getMemberAnalytics",
    scopes: ["analytics:read"],
    parameters: [id],
  }),
};

paths["/api-keys/{id}/rotate"] = {
  post: apiOperation({
    tag: "API Keys",
    summary: "Rotate API key secret",
    operationId: "rotateApiKey",
    scopes: ["api_keys:write"],
    parameters: [id],
    idempotent: true,
    description:
      "Returns the replacement secret once; the previous secret is revoked. The target key's scopes must be delegable by the caller, and a key cannot rotate itself.",
  }),
};

paths["/assessment-attempts"] = {
  get: apiOperation({
    tag: "Assessments",
    summary: "List assessment attempts",
    operationId: "listAssessmentAttempts",
    scopes: ["members:read", "courses:read"],
    query: [
      queryParameter("userId", "Filter by member.", uuidSchema),
      queryParameter("courseId", "Filter by course.", uuidSchema),
      queryParameter("lessonId", "Filter by lesson.", uuidSchema),
      enumQuery("status", "Filter attempt status.", [
        "in_progress",
        "submitted",
        "graded",
      ]),
      enumQuery("passed", "Filter passing result.", ["true", "false"]),
    ],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Assessments",
    summary: "Submit assessment attempt",
    operationId: "submitAssessmentAttempt",
    scopes: ["members:write", "courses:read"],
    requestSchema: "AssessmentAttemptSubmit",
    status: "201",
    idempotent: true,
  }),
};

paths["/assessment-attempts/{id}"] = {
  get: apiOperation({
    tag: "Assessments",
    summary: "Get assessment attempt",
    operationId: "getAssessmentAttempt",
    scopes: ["members:read", "courses:read"],
    parameters: [id],
  }),
};

paths["/exam-attempts"] = {
  post: apiOperation({
    tag: "Assessments",
    summary: "Start or resume an exam attempt",
    operationId: "startExamAttempt",
    scopes: ["assessments:write", "courses:read"],
    requestSchema: "ExamAttemptStart",
    status: "201",
    idempotent: true,
  }),
};

paths["/exam-attempts/{id}"] = {
  get: apiOperation({
    tag: "Assessments",
    summary: "Get an active exam attempt",
    operationId: "getExamAttempt",
    scopes: ["assessments:read"],
    parameters: [id],
  }),
  patch: apiOperation({
    tag: "Assessments",
    summary: "Autosave an exam attempt",
    operationId: "saveExamAttempt",
    scopes: ["assessments:write"],
    parameters: [id],
    requestSchema: "ExamAttemptDraft",
    idempotent: true,
  }),
};

paths["/exam-attempts/{id}/submit"] = {
  post: apiOperation({
    tag: "Assessments",
    summary: "Submit an exam attempt",
    operationId: "submitExamLifecycleAttempt",
    scopes: ["assessments:write"],
    parameters: [id],
    requestSchema: "ExamAttemptSubmit",
    idempotent: true,
  }),
};

paths["/exam-attempts/{id}/result"] = {
  get: apiOperation({
    tag: "Assessments",
    summary: "Get a released exam result",
    operationId: "getExamAttemptResult",
    scopes: ["assessments:read"],
    parameters: [id],
  }),
};

paths["/exam-attempts/{id}/release"] = {
  post: apiOperation({
    tag: "Assessments",
    summary: "Release an exam result or review",
    operationId: "releaseExamAttempt",
    scopes: ["assessments:write", "courses:write"],
    parameters: [id],
    requestSchema: "ExamAttemptRelease",
    idempotent: true,
  }),
};

paths["/exam-attempts/{id}/finalize"] = {
  post: apiOperation({
    tag: "Assessments",
    summary: "Finalize an abandoned exam attempt",
    operationId: "finalizeExamAttempt",
    scopes: ["assessments:write", "courses:write"],
    parameters: [id],
    idempotent: true,
  }),
};

paths["/audit-log"] = {
  get: apiOperation({
    tag: "Audit Log",
    summary: "List API audit entries",
    operationId: "listAuditLogEntries",
    scopes: ["audit:read"],
    query: [
      queryParameter("method", "Filter HTTP method."),
      queryParameter("action", "Filter action."),
      queryParameter("resourceType", "Filter resource type."),
      queryParameter("apiKeyId", "Filter API key.", uuidSchema),
      queryParameter("requestId", "Filter request identifier.", uuidSchema),
      queryParameter("status", "Filter response status.", {
        type: "integer",
        minimum: 100,
        maximum: 599,
      }),
      queryParameter("from", "Include entries from this time.", dateTimeSchema),
      queryParameter(
        "to",
        "Include entries through this time.",
        dateTimeSchema,
      ),
    ],
    list: true,
    paginated: true,
  }),
};

paths["/audit-log/{id}"] = {
  get: apiOperation({
    tag: "Audit Log",
    summary: "Get API audit entry",
    operationId: "getAuditLogEntry",
    scopes: ["audit:read"],
    parameters: [id],
  }),
};

paths["/blocks/{id}"] = {
  get: apiOperation({
    tag: "Content",
    summary: "Get content block",
    operationId: "getContentBlock",
    scopes: ["modules:read"],
    parameters: [id],
  }),
  patch: apiOperation({
    tag: "Content",
    summary: "Update content block",
    operationId: "updateContentBlock",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "ContentBlockUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Content",
    summary: "Delete content block",
    operationId: "deleteContentBlock",
    scopes: ["modules:write"],
    parameters: [id, contentBlockRevisionHeader],
    idempotent: true,
  }),
};

paths["/bundles/{id}/courses"] = {
  get: apiOperation({
    tag: "Bundles",
    summary: "List bundle courses",
    operationId: "listBundleCourses",
    scopes: ["bundles:read", "courses:read"],
    parameters: [id],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Bundles",
    summary: "Add course to bundle",
    operationId: "addBundleCourse",
    scopes: ["bundles:write"],
    parameters: [id],
    requestSchema: "BundleCourse",
    status: "201",
    idempotent: true,
  }),
};

paths["/bundles/{id}/courses/{courseId}"] = {
  patch: apiOperation({
    tag: "Bundles",
    summary: "Update bundle course availability",
    operationId: "updateBundleCoursePolicy",
    scopes: ["bundles:write"],
    parameters: [id, courseId],
    requestSchema: "BundleCoursePolicy",
    idempotent: true,
  }),
  put: apiOperation({
    tag: "Bundles",
    summary: "Assign course to bundle",
    operationId: "putBundleCourse",
    scopes: ["bundles:write"],
    parameters: [id, courseId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Bundles",
    summary: "Remove course from bundle",
    operationId: "removeBundleCourse",
    scopes: ["bundles:write"],
    parameters: [id, courseId],
    idempotent: true,
  }),
};

paths["/community/comments/{id}"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get comment",
    operationId: "getCommunityComment",
    scopes: ["community:read"],
    parameters: [id],
    responseSchema: "CommunityCommentRecord",
  }),
  patch: apiOperation({
    tag: "Community",
    summary: "Update comment",
    operationId: "updateCommunityComment",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommentUpdate",
    responseSchema: "CommunityCommentRecord",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Delete comment",
    operationId: "deleteCommunityComment",
    scopes: ["community:write"],
    parameters: [id],
    responseSchema: "CommunityEntityDeletionResult",
    idempotent: true,
  }),
};

paths["/community/comments/{id}/reactions"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get comment reaction state",
    operationId: "getCommentReactionState",
    scopes: ["community:read"],
    parameters: [id],
    query: [
      queryParameter(
        "userId",
        "Member whose reaction state is returned. Defaults to the API-key creator; another member requires owner or administrator act-as permission.",
        uuidSchema,
      ),
    ],
    responseSchema: "CommunityCommentReactionSummary",
    description:
      "Returns the selected member's reaction and aggregate counts only for a published comment on a published, currently visible post.",
  }),
  put: apiOperation({
    tag: "Community",
    summary: "Set comment reaction",
    operationId: "setCommentReaction",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommentReactionUpdate",
    responseSchema: "CommunityCommentReactionMutation",
    idempotent: true,
    description:
      "Sets the API-key creator's reaction by default. An optional different userId requires owner or administrator act-as permission. The comment and its post must be published and visible to that member.",
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Remove comment reaction",
    operationId: "removeCommentReaction",
    scopes: ["community:write"],
    parameters: [id],
    query: [
      queryParameter(
        "userId",
        "Member whose reaction is removed. Defaults to the API-key creator; another member requires owner or administrator act-as permission.",
        uuidSchema,
      ),
    ],
    responseSchema: "CommunityCommentReactionMutation",
    idempotent: true,
    description:
      "Returns reaction=null whether or not the selected member previously reacted. The comment and its post must remain published and visible.",
  }),
};

paths["/community/feed"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get explainable personal feed",
    operationId: "getCommunityPersonalFeed",
    scopes: ["community:read"],
    query: [
      enumQuery("mode", "Feed mode.", ["for_you", "following", "latest"]),
      queryParameter("limit", "Page size from 1 through 50.", {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 20,
      }),
      queryParameter("cursor", "Opaque signed keyset cursor.", {
        type: "string",
        maxLength: 2048,
      }),
    ],
    responseSchema: "CommunityFeedPage",
    description:
      "Candidates are tenant- and space-ACL-filtered before bounded ranking. The signed cursor fixes the snapshot and is invalidated after ranking or visibility mutations.",
  }),
};

paths["/community/follows"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List personal community follows",
    operationId: "listCommunityFollows",
    scopes: ["community:read"],
    responseSchema: "CommunityFollow",
    list: true,
    paginated: true,
  }),
};

paths["/community/follows/{targetType}/{targetId}"] = {
  put: apiOperation({
    tag: "Community",
    summary: "Follow an author or space",
    operationId: "putCommunityFollow",
    scopes: ["community:write"],
    parameters: [
      pathParameter("targetType", "Follow target type.", {
        type: "string",
        enum: ["author", "space"],
      }),
      pathParameter("targetId", "Author or space identifier."),
    ],
    requestSchema: "CommunityFollowUpdate",
    responseSchema: "CommunityFollow",
    idempotent: true,
    description:
      "The API-key creator is the follower. Self-follows and cross-tenant or inaccessible targets are rejected. notify=true is reserved and rejected.",
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Remove an author or space follow",
    operationId: "deleteCommunityFollow",
    scopes: ["community:write"],
    parameters: [
      pathParameter("targetType", "Follow target type.", {
        type: "string",
        enum: ["author", "space"],
      }),
      pathParameter("targetId", "Author or space identifier."),
    ],
    responseSchema: "CommunityRemovalResult",
    idempotent: true,
  }),
};

paths["/admin/community/boosts"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List community author boosts",
    operationId: "listCommunityAuthorBoosts",
    scopes: ["community:read"],
    query: [
      enumQuery("state", "Filter boost lifecycle state.", [
        "all",
        "active",
        "scheduled",
        "expired",
      ]),
    ],
    responseSchema: "CommunityAuthorBoost",
    list: true,
    paginated: true,
    description:
      "The API-key creator must currently be an active organization owner or administrator.",
  }),
};

paths["/admin/community/boosts/{authorId}"] = {
  put: apiOperation({
    tag: "Community",
    summary: "Replace an author boost",
    operationId: "putCommunityAuthorBoost",
    scopes: ["community:write"],
    parameters: [
      pathParameter("authorId", "Active same-tenant author identifier."),
    ],
    requestSchema: "CommunityBoostUpdate",
    responseSchema: "CommunityAuthorBoost",
    idempotent: true,
    description:
      "Requires a current organization owner or administrator. One boost per author is replaced atomically and audited without storing the raw reason in audit metadata.",
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Remove an author boost",
    operationId: "deleteCommunityAuthorBoost",
    scopes: ["community:write"],
    parameters: [pathParameter("authorId", "Same-tenant author identifier.")],
    responseSchema: "CommunityRemovalResult",
    idempotent: true,
  }),
};

paths["/admin/community/moderation-cases"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List community moderation cases",
    operationId: "listCommunityModerationCases",
    scopes: ["community:read"],
    query: [
      enumQuery("status", "Filter moderation-case status.", [
        "open",
        "reviewing",
        "resolved",
        "appealed",
      ]),
      enumQuery("targetType", "Filter moderated content type.", [
        "post",
        "comment",
      ]),
    ],
    responseSchema: "CommunityModerationQueueItem",
    list: true,
    paginated: true,
    description:
      "Requires an active owner or administrator API-key creator. Pagination uses a signed tenant- and filter-bound keyset cursor. Reporter identities, raw reports, fingerprints, and automated assessment signals are excluded from every queue item.",
  }),
};

paths["/admin/community/moderation-cases/{id}/claim"] = {
  post: apiOperation({
    tag: "Community",
    summary: "Claim community moderation case",
    operationId: "claimCommunityModerationCase",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityModerationCaseClaim",
    responseSchema: "CommunityModerationCaseClaimResult",
    idempotent: true,
    description:
      "Atomically revalidates the active owner or administrator role and both decision and content versions before assigning the case.",
  }),
};

paths["/admin/community/moderation-cases/{id}/decision"] = {
  post: apiOperation({
    tag: "Community",
    summary: "Decide community moderation case",
    operationId: "decideCommunityModerationCase",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityModerationCaseDecision",
    responseSchema: "CommunityModerationCaseDecisionResult",
    idempotent: true,
    description:
      "Applies the moderation lifecycle, first-publication effects, score reversal or restoration, report closure, and notifications in one transaction. Both optimistic versions are mandatory.",
  }),
};

paths["/admin/community/moderation-appeals/{id}/resolution"] = {
  post: apiOperation({
    tag: "Community",
    summary: "Resolve community moderation appeal",
    operationId: "resolveCommunityModerationAppeal",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityModerationAppealDecision",
    responseSchema: "CommunityModerationAppealResolutionResult",
    idempotent: true,
    description:
      "Enforces tenant isolation, active administrator status, independent review, and both optimistic versions. Overturn restores the content and eligible score contributions atomically.",
  }),
};

paths["/admin/community/spaces/{id}/moderation-policy"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get community space moderation policy",
    operationId: "getCommunitySpaceModerationPolicy",
    scopes: ["community:read"],
    parameters: [id],
    responseSchema: "CommunityModerationPolicy",
    description:
      "Returns the effective tenant-scoped policy, including explicit defaults when no policy row has been created yet. Requires an active owner or administrator.",
  }),
  put: apiOperation({
    tag: "Community",
    summary: "Replace community space moderation policy",
    operationId: "replaceCommunitySpaceModerationPolicy",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommunityModerationPolicyUpdate",
    responseSchema: "CommunityModerationPolicy",
    idempotent: true,
    description:
      "Uses the mandatory expectedVersion and revalidates the active owner or administrator role in the mutation transaction.",
  }),
};

paths["/admin/community/level-configuration"] = {
  get: apiOperation({
    tag: "Community",
    summary: "Get community level configuration",
    operationId: "getCommunityLevelConfiguration",
    scopes: ["community:read"],
    responseSchema: "CommunityLevelConfiguration",
    description:
      "Returns the tenant-wide level revision and ordered level definitions to active owners and administrators.",
  }),
  put: apiOperation({
    tag: "Community",
    summary: "Replace community level configuration",
    operationId: "replaceCommunityLevelConfiguration",
    scopes: ["community:write"],
    requestSchema: "CommunityLevelConfigurationUpdate",
    responseSchema: "CommunityLevelConfiguration",
    idempotent: true,
    description:
      "Atomically replaces all tenant levels using the mandatory expectedRevision and an active owner or administrator role recheck.",
  }),
};

paths["/community/posts/{id}/comments"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List post comments",
    operationId: "listPostComments",
    scopes: ["community:read"],
    parameters: [id],
    list: true,
    paginated: true,
    responseSchema: "CommunityCommentListItem",
  }),
  post: apiOperation({
    tag: "Community",
    summary: "Create post comment",
    operationId: "createPostComment",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "CommentCreate",
    responseSchema: "CommunityCommentRecord",
    status: "201",
    idempotent: true,
  }),
};

paths["/community/posts/{id}/reactions"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List post reactions",
    operationId: "listPostReactions",
    scopes: ["community:read"],
    parameters: [id],
    list: true,
    paginated: true,
    responseSchema: "CommunityPostReactionListItem",
  }),
  post: apiOperation({
    tag: "Community",
    summary: "Create post reaction",
    operationId: "createPostReaction",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "PostReaction",
    responseSchema: "CommunityPostReactionMutation",
    status: "201",
    idempotent: true,
  }),
};

paths["/community/posts/{id}/reactions/{userId}"] = {
  put: apiOperation({
    tag: "Community",
    summary: "Set member post reaction",
    operationId: "setMemberPostReaction",
    scopes: ["community:write"],
    parameters: [id, userId],
    responseSchema: "CommunityPostReactionMutation",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Community",
    summary: "Remove member post reaction",
    operationId: "removeMemberPostReaction",
    scopes: ["community:write"],
    parameters: [id, userId],
    responseSchema: "CommunityPostReactionMutation",
    idempotent: true,
  }),
};

paths["/community/posts/{id}/votes"] = {
  get: apiOperation({
    tag: "Community",
    summary: "List discussion votes",
    operationId: "listPostVotes",
    scopes: ["community:read"],
    parameters: [id],
    list: true,
    paginated: true,
    responseSchema: "CommunityPostVoteListItem",
  }),
  post: apiOperation({
    tag: "Community",
    summary: "Set discussion vote",
    operationId: "setPostVote",
    scopes: ["community:write"],
    parameters: [id],
    requestSchema: "PostVote",
    responseSchema: "CommunityPostVoteMutation",
    idempotent: true,
  }),
};

paths["/courses/{id}/clone"] = {
  post: apiOperation({
    tag: "Courses",
    summary: "Clone course",
    operationId: "cloneCourse",
    scopes: ["courses:write", "modules:write"],
    parameters: [id],
    requestSchema: "CourseClone",
    status: "201",
    idempotent: true,
  }),
};

paths["/courses/{id}/modules"] = {
  get: apiOperation({
    tag: "Courses",
    summary: "List course modules",
    operationId: "listCourseModules",
    scopes: ["courses:read", "modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Courses",
    summary: "Attach module to course",
    operationId: "attachCourseModule",
    scopes: ["courses:write", "modules:read"],
    parameters: [id],
    requestSchema: "CourseModuleAttach",
    status: "201",
    idempotent: true,
  }),
};

paths["/courses/{id}/modules/{moduleId}"] = {
  patch: apiOperation({
    tag: "Courses",
    summary: "Update course module relationship",
    operationId: "updateCourseModule",
    scopes: ["courses:write"],
    parameters: [id, moduleId],
    requestSchema: "CourseModuleUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Courses",
    summary: "Detach module from course",
    operationId: "detachCourseModule",
    scopes: ["courses:write"],
    parameters: [id, moduleId],
    idempotent: true,
  }),
};

paths["/courses/{id}/modules/outline"] = {
  put: apiOperation({
    tag: "Courses",
    summary: "Replace complete module order and indentation",
    operationId: "replaceCourseModuleOutline",
    scopes: ["courses:write"],
    parameters: [id],
    requestSchema: "CourseModuleOutline",
    idempotent: true,
  }),
};

paths["/courses/{id}/modules/{moduleId}/access-requests"] = {
  get: apiOperation({
    tag: "Module Access",
    summary: "List module access requests",
    operationId: "listCourseModuleAccessRequests",
    scopes: ["courses:read"],
    parameters: [id, moduleId],
    query: [
      enumQuery("status", "Filter request status.", [
        "pending",
        "approved",
        "rejected",
        "cancelled",
      ]),
      queryParameter("userId", "Filter by tenant member.", uuidSchema),
    ],
    list: true,
  }),
  post: apiOperation({
    tag: "Module Access",
    summary: "Create module access request for member",
    operationId: "createCourseModuleAccessRequest",
    scopes: ["courses:write"],
    parameters: [id, moduleId],
    requestSchema: "CourseModuleAccessRequestCreate",
    status: "201",
    idempotent: true,
    description:
      "Creates a request only when the target is an active tenant member with an active enrollment and the module is currently published, listed, locked, and requestable.",
  }),
};

paths["/courses/{id}/modules/{moduleId}/access-requests/{requestId}"] = {
  patch: apiOperation({
    tag: "Module Access",
    summary: "Approve or reject module access request",
    operationId: "decideCourseModuleAccessRequest",
    scopes: ["courses:write"],
    parameters: [id, moduleId, requestId],
    requestSchema: "CourseModuleAccessRequestDecision",
    idempotent: true,
    description:
      "Approvals atomically create an available override. Requests made before the current publication or targeting a no-longer-requestable module are rejected fail closed.",
  }),
  delete: apiOperation({
    tag: "Module Access",
    summary: "Withdraw own pending module access request",
    operationId: "withdrawCourseModuleAccessRequest",
    scopes: ["courses:write"],
    parameters: [id, moduleId, requestId],
    requestSchema: "CourseModuleAccessRequestCancel",
    idempotent: true,
  }),
};

paths["/courses/{id}/modules/{moduleId}/access-overrides"] = {
  get: apiOperation({
    tag: "Module Access",
    summary: "List individual module access overrides",
    operationId: "listCourseModuleAccessOverrides",
    scopes: ["courses:read"],
    parameters: [id, moduleId],
    list: true,
  }),
};

paths["/courses/{id}/modules/{moduleId}/access-overrides/{userId}"] = {
  put: apiOperation({
    tag: "Module Access",
    summary: "Create or replace individual module access override",
    operationId: "putCourseModuleAccessOverride",
    scopes: ["courses:write"],
    parameters: [id, moduleId, userId],
    requestSchema: "CourseModuleAccessOverride",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Module Access",
    summary: "Delete individual module access override",
    operationId: "deleteCourseModuleAccessOverride",
    scopes: ["courses:write"],
    parameters: [id, moduleId, userId],
    requestSchema: "CourseModuleAccessOverrideDelete",
    idempotent: true,
  }),
};

paths["/courses/{id}/widgets"] = {
  get: apiOperation({
    tag: "Courses",
    summary: "List ordered course overview widgets",
    operationId: "listCourseWidgets",
    scopes: ["courses:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Courses",
    summary: "Create course overview widget",
    operationId: "createCourseWidget",
    scopes: ["courses:write"],
    parameters: [id],
    requestSchema: "CourseWidgetCreate",
    status: "201",
    idempotent: true,
  }),
  patch: apiOperation({
    tag: "Courses",
    summary: "Reorder all course overview widgets",
    operationId: "reorderCourseWidgets",
    scopes: ["courses:write"],
    parameters: [id],
    requestSchema: "CourseWidgetOrder",
    idempotent: true,
  }),
};

paths["/courses/{id}/widgets/{widgetId}"] = {
  get: apiOperation({
    tag: "Courses",
    summary: "Get course overview widget",
    operationId: "getCourseWidget",
    scopes: ["courses:read"],
    parameters: [id, widgetId],
  }),
  patch: apiOperation({
    tag: "Courses",
    summary: "Update course overview widget",
    operationId: "updateCourseWidget",
    scopes: ["courses:write"],
    parameters: [id, widgetId],
    requestSchema: "CourseWidgetUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Courses",
    summary: "Delete course overview widget",
    operationId: "deleteCourseWidget",
    scopes: ["courses:write"],
    parameters: [id, widgetId],
    idempotent: true,
  }),
};

paths["/courses/{id}/publish"] = {
  post: apiOperation({
    tag: "Courses",
    summary: "Publish course version",
    operationId: "publishCourse",
    scopes: ["courses:write"],
    parameters: [id],
    requestSchema: "CoursePublish",
    status: "201",
    idempotent: true,
  }),
};

paths["/courses/{id}/versions"] = {
  get: apiOperation({
    tag: "Courses",
    summary: "List course versions",
    operationId: "listCourseVersions",
    scopes: ["courses:read"],
    parameters: [id],
    query: [
      enumQuery("published", "Filter published versions.", ["true", "false"]),
    ],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Courses",
    summary: "Create course version",
    operationId: "createCourseVersion",
    scopes: ["courses:write"],
    parameters: [id],
    requestSchema: "CourseVersionCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/courses/{id}/versions/{versionId}"] = {
  get: apiOperation({
    tag: "Courses",
    summary: "Get course version",
    operationId: "getCourseVersion",
    scopes: ["courses:read"],
    parameters: [id, versionId],
  }),
};

paths["/events/{id}/attendees"] = {
  get: apiOperation({
    tag: "Events",
    summary: "List event attendees",
    operationId: "listEventAttendees",
    scopes: ["events:read"],
    parameters: [id],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Events",
    summary: "Set event attendance",
    operationId: "createEventAttendance",
    scopes: ["events:write"],
    parameters: [id],
    requestSchema: "AttendanceCreate",
    idempotent: true,
  }),
};

const eventAttendanceUpdate = apiOperation({
  tag: "Events",
  summary: "Update event attendance",
  operationId: "updateEventAttendance",
  scopes: ["events:write"],
  parameters: [id, userId],
  requestSchema: "AttendanceUpdate",
  idempotent: true,
});

paths["/events/{id}/attendees/{userId}"] = {
  get: apiOperation({
    tag: "Events",
    summary: "Get event attendance",
    operationId: "getEventAttendance",
    scopes: ["events:read"],
    parameters: [id, userId],
  }),
  put: { ...eventAttendanceUpdate, operationId: "putEventAttendance" },
  patch: eventAttendanceUpdate,
  delete: apiOperation({
    tag: "Events",
    summary: "Delete event attendance",
    operationId: "deleteEventAttendance",
    scopes: ["events:write"],
    parameters: [id, userId],
    idempotent: true,
  }),
};

paths["/groups/{id}/members"] = {
  get: apiOperation({
    tag: "Groups",
    summary: "List group members",
    operationId: "listGroupMembers",
    scopes: ["groups:read", "members:read"],
    parameters: [id],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Groups",
    summary: "Add group member",
    operationId: "addGroupMember",
    scopes: ["groups:write"],
    parameters: [id],
    requestSchema: "GroupMember",
    status: "201",
    idempotent: true,
  }),
};

paths["/groups/{id}/members/{userId}"] = {
  put: apiOperation({
    tag: "Groups",
    summary: "Assign group member",
    operationId: "putGroupMember",
    scopes: ["groups:write"],
    parameters: [id, userId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Groups",
    summary: "Remove group member",
    operationId: "removeGroupMember",
    scopes: ["groups:write"],
    parameters: [id, userId],
    idempotent: true,
  }),
};

paths["/groups/{id}/courses/{courseId}"] = {
  get: apiOperation({
    tag: "Access Grants",
    summary: "Get group course assignment",
    operationId: "getGroupCourseAssignment",
    scopes: ["groups:read"],
    parameters: [id, courseId],
  }),
  put: apiOperation({
    tag: "Access Grants",
    summary: "Assign course to group",
    operationId: "assignGroupCourse",
    scopes: ["groups:write"],
    parameters: [id, courseId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Access Grants",
    summary: "Unassign course from group",
    operationId: "unassignGroupCourse",
    scopes: ["groups:write"],
    parameters: [id, courseId],
    idempotent: true,
  }),
};

paths["/groups/{id}/bundles/{bundleId}"] = {
  get: apiOperation({
    tag: "Access Grants",
    summary: "Get group bundle assignment",
    operationId: "getGroupBundleAssignment",
    scopes: ["groups:read"],
    parameters: [id, bundleId],
  }),
  put: apiOperation({
    tag: "Access Grants",
    summary: "Assign bundle to group",
    operationId: "assignGroupBundle",
    scopes: ["groups:write"],
    parameters: [id, bundleId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Access Grants",
    summary: "Unassign bundle from group",
    operationId: "unassignGroupBundle",
    scopes: ["groups:write"],
    parameters: [id, bundleId],
    idempotent: true,
  }),
};

paths["/hubs/{id}/clone"] = {
  post: apiOperation({
    tag: "Hubs",
    summary: "Clone hub as draft",
    operationId: "cloneHub",
    scopes: ["hubs:write"],
    parameters: [id],
    requestSchema: "HubClone",
    status: "201",
    idempotent: true,
  }),
};

paths["/hubs/{id}/access"] = {
  get: apiOperation({
    tag: "Hubs",
    summary: "List hub access grants",
    operationId: "listHubAccessGrants",
    scopes: ["hubs:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Hubs",
    summary: "Create hub access grant",
    operationId: "createHubAccessGrant",
    scopes: ["hubs:write"],
    parameters: [id],
    requestSchema: "HubAccess",
    status: "201",
    idempotent: true,
  }),
};

paths["/hubs/{id}/access/{subjectType}/{subjectId}"] = {
  delete: apiOperation({
    tag: "Hubs",
    summary: "Revoke hub access grant",
    operationId: "revokeHubAccessGrant",
    scopes: ["hubs:write"],
    parameters: [
      id,
      pathParameter("subjectType", "Access subject type.", {
        type: "string",
        enum: ["user", "group", "bundle"],
      }),
      pathParameter("subjectId", "Access subject identifier."),
    ],
    idempotent: true,
  }),
};

paths["/lessons/{id}"] = {
  get: apiOperation({
    tag: "Content",
    summary: "Get lesson",
    operationId: "getLesson",
    scopes: ["modules:read"],
    parameters: [id],
  }),
  patch: apiOperation({
    tag: "Content",
    summary: "Update lesson",
    operationId: "updateLesson",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "LessonUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Content",
    summary: "Delete lesson",
    operationId: "deleteLesson",
    scopes: ["modules:write"],
    parameters: [id],
    idempotent: true,
  }),
};

paths["/lessons/{id}/blocks"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List lesson blocks",
    operationId: "listLessonBlocks",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create lesson block",
    operationId: "createLessonBlock",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "ContentBlockCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/lessons/{id}/pages"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List lesson pages",
    operationId: "listLessonPages",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create lesson page",
    operationId: "createLessonPage",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "LessonPageCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/members/{id}/bundles/{bundleId}"] = {
  get: apiOperation({
    tag: "Access Grants",
    summary: "Get member bundle assignment",
    operationId: "getMemberBundleAssignment",
    scopes: ["members:read"],
    parameters: [id, bundleId],
  }),
  put: apiOperation({
    tag: "Access Grants",
    summary: "Assign bundle to member",
    operationId: "assignMemberBundle",
    scopes: ["members:write"],
    parameters: [id, bundleId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Access Grants",
    summary: "Unassign bundle from member",
    operationId: "unassignMemberBundle",
    scopes: ["members:write"],
    parameters: [id, bundleId],
    idempotent: true,
  }),
};

paths["/members/{id}/enrollments"] = {
  get: apiOperation({
    tag: "Access Grants",
    summary: "List member enrollments",
    operationId: "listMemberEnrollments",
    scopes: ["members:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Access Grants",
    summary: "Grant direct course access",
    operationId: "grantDirectCourseAccess",
    scopes: ["members:write"],
    parameters: [id],
    requestSchema: "EnrollmentCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/members/{id}/enrollments/{courseId}"] = {
  patch: apiOperation({
    tag: "Access Grants",
    summary: "Reconcile enrollment progress",
    operationId: "updateMemberEnrollment",
    scopes: ["members:write"],
    parameters: [id, courseId],
    requestSchema: "EnrollmentUpdate",
    idempotent: true,
    description:
      "Recalculates status and progress from the published required lessons. Supplied status or progress fields act as preconditions and return `409 Conflict` when they do not match the server-derived state.",
  }),
  delete: apiOperation({
    tag: "Access Grants",
    summary: "Revoke direct course access",
    operationId: "revokeDirectCourseAccess",
    scopes: ["members:write"],
    parameters: [id, courseId],
    idempotent: true,
    description:
      "Removes only the direct grant. The enrollment and progress are preserved, and access remains active while another grant source exists.",
  }),
};

paths["/members/{id}/progress"] = {
  get: apiOperation({
    tag: "Progress",
    summary: "List member lesson progress",
    operationId: "listMemberLessonProgress",
    scopes: ["members:read", "courses:read"],
    parameters: [id],
    list: true,
  }),
};

paths["/members/{id}/progress/{lessonId}"] = {
  get: apiOperation({
    tag: "Progress",
    summary: "Get member lesson progress",
    operationId: "getMemberLessonProgress",
    scopes: ["members:read"],
    parameters: [id, lessonId],
  }),
  put: apiOperation({
    tag: "Progress",
    summary: "Set member lesson progress",
    operationId: "setMemberLessonProgress",
    scopes: ["members:write"],
    parameters: [id, lessonId],
    requestSchema: "LessonProgressUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Progress",
    summary: "Reset member lesson progress",
    operationId: "resetMemberLessonProgress",
    scopes: ["members:write"],
    parameters: [id, lessonId],
    idempotent: true,
    description:
      "Returns `409 Conflict` when the reset would invalidate an active course certificate. Revoke that certificate explicitly before lowering progress.",
  }),
};

paths["/modules/{id}/lessons"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List module lessons",
    operationId: "listModuleLessons",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create module lesson",
    operationId: "createModuleLesson",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "LessonCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/modules/{id}/sections"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List module sections",
    operationId: "listModuleSections",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create module section",
    operationId: "createModuleSection",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "SectionCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/notifications"] = {
  get: apiOperation({
    tag: "Notifications",
    summary: "List member notifications",
    operationId: "listNotifications",
    scopes: ["notifications:read"],
    query: [
      queryParameter(
        "userId",
        "Member whose notifications are returned.",
        uuidSchema,
        true,
      ),
      enumQuery("unread", "Return only unread or read notifications.", [
        "true",
        "false",
      ]),
    ],
    list: true,
    paginated: true,
  }),
};

const notificationUpdate = apiOperation({
  tag: "Notifications",
  summary: "Update notification read state",
  operationId: "updateNotification",
  scopes: ["notifications:write"],
  parameters: [id],
  requestSchema: "NotificationUpdate",
  idempotent: true,
});

paths["/notifications/{id}"] = {
  put: { ...notificationUpdate, operationId: "putNotification" },
  patch: notificationUpdate,
  delete: apiOperation({
    tag: "Notifications",
    summary: "Delete notification",
    operationId: "deleteNotification",
    scopes: ["notifications:write"],
    parameters: [id],
    query: [
      queryParameter("userId", "Owning member identifier.", uuidSchema, true),
    ],
  }),
};

paths["/notifications/mark-read"] = {
  post: apiOperation({
    tag: "Notifications",
    summary: "Mark notifications as read",
    operationId: "markNotificationsRead",
    scopes: ["notifications:write"],
    requestSchema: "NotificationBulkMarkRead",
    idempotent: true,
  }),
};

paths["/lesson-availability-subscriptions"] = {
  get: apiOperation({
    tag: "Notifications",
    summary: "List lesson availability subscriptions",
    operationId: "listLessonAvailabilitySubscriptions",
    scopes: ["notifications:read"],
    query: [
      queryParameter("userId", "Filter by member.", uuidSchema),
      queryParameter("courseId", "Filter by course.", uuidSchema),
      queryParameter("lessonId", "Filter by lesson.", uuidSchema),
      enumQuery("status", "Filter by lifecycle status.", [
        "active",
        "cancelled",
        "fulfilled",
      ]),
    ],
    responseSchema: "LessonAvailabilitySubscription",
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Notifications",
    summary: "Subscribe to a coming-soon lesson",
    operationId: "createLessonAvailabilitySubscription",
    scopes: ["notifications:write"],
    requestSchema: "LessonAvailabilitySubscriptionMutation",
    responseSchema: "LessonAvailabilitySubscription",
    status: "201",
    idempotent: true,
    description:
      "Revalidates active membership, enrollment, course access, and the current published combined lesson access policy.",
  }),
  delete: apiOperation({
    tag: "Notifications",
    summary: "Cancel a lesson availability subscription",
    operationId: "deleteLessonAvailabilitySubscription",
    scopes: ["notifications:write"],
    requestSchema: "LessonAvailabilitySubscriptionMutation",
    responseSchema: "LessonAvailabilitySubscription",
    idempotent: true,
  }),
};

paths["/pages/{id}"] = {
  get: apiOperation({
    tag: "Content",
    summary: "Get lesson page",
    operationId: "getLessonPage",
    scopes: ["modules:read"],
    parameters: [id],
  }),
  patch: apiOperation({
    tag: "Content",
    summary: "Update lesson page",
    operationId: "updateLessonPage",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "LessonPageUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Content",
    summary: "Delete lesson page",
    operationId: "deleteLessonPage",
    scopes: ["modules:write"],
    parameters: [id, lessonPageRevisionHeader],
    idempotent: true,
  }),
};

paths["/courses/{id}/editor-presence"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List active course editors",
    operationId: "listCourseEditorPresence",
    scopes: ["modules:read"],
    parameters: [id],
    description:
      "Returns short-lived editor identity and location metadata only; no draft content is included.",
  }),
};

paths["/pages/{id}/blocks"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List page blocks",
    operationId: "listPageBlocks",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create page block",
    operationId: "createPageBlock",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "ContentBlockCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/search"] = {
  get: apiOperation({
    tag: "Search",
    summary: "Search organization resources",
    operationId: "searchOrganization",
    scopes: ["search:read"],
    description:
      "Searching the members type additionally requires members:read. Without that scope the request fails with insufficient_scope and never returns member email or profile metadata.",
    query: [
      queryParameter(
        "q",
        "Search phrase.",
        { type: "string", minLength: 2, maxLength: 200 },
        true,
      ),
      queryParameter("types", "Comma-separated resource types.", {
        type: "string",
        description: "courses,modules,members,community,hubs,events",
      }),
      queryParameter("limit", "Maximum combined results.", {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 25,
      }),
    ],
    list: true,
  }),
};

paths["/sections/{id}"] = {
  get: apiOperation({
    tag: "Content",
    summary: "Get module section",
    operationId: "getModuleSection",
    scopes: ["modules:read"],
    parameters: [id],
  }),
  patch: apiOperation({
    tag: "Content",
    summary: "Update module section",
    operationId: "updateModuleSection",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "SectionUpdate",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Content",
    summary: "Delete module section",
    operationId: "deleteModuleSection",
    scopes: ["modules:write"],
    parameters: [id],
    idempotent: true,
  }),
};

paths["/sections/{id}/lessons"] = {
  get: apiOperation({
    tag: "Content",
    summary: "List section lessons",
    operationId: "listSectionLessons",
    scopes: ["modules:read"],
    parameters: [id],
    list: true,
  }),
  post: apiOperation({
    tag: "Content",
    summary: "Create section lesson",
    operationId: "createSectionLesson",
    scopes: ["modules:write"],
    parameters: [id],
    requestSchema: "LessonCreate",
    status: "201",
    idempotent: true,
  }),
};

const sectionLessonVisibilityUpdate = apiOperation({
  tag: "Content",
  summary: "Set visibility for all section lessons",
  operationId: "updateSectionLessonVisibility",
  scopes: ["modules:write"],
  parameters: [id],
  requestSchema: "SectionLessonVisibilityUpdate",
  idempotent: true,
  description:
    "Atomically updates every tenant-bound lesson currently assigned to the section. Published course snapshots remain unchanged until the course is published again.",
});

paths["/sections/{id}/lesson-visibility"] = {
  put: {
    ...sectionLessonVisibilityUpdate,
    operationId: "putSectionLessonVisibility",
  },
  patch: sectionLessonVisibilityUpdate,
};

paths["/submissions"] = {
  get: apiOperation({
    tag: "Submissions",
    summary: "List submissions",
    operationId: "listSubmissions",
    scopes: ["submissions:read"],
    query: [
      enumQuery("status", "Filter review status.", [
        "open",
        "in_review",
        "revision",
        "approved",
      ]),
      queryParameter("userId", "Filter by member.", uuidSchema),
      queryParameter("courseId", "Filter by course.", uuidSchema),
      queryParameter("lessonId", "Filter by lesson.", uuidSchema),
      queryParameter("blockId", "Filter by submission block.", uuidSchema),
      queryParameter("search", "Search title and content."),
    ],
    list: true,
    paginated: true,
  }),
  post: apiOperation({
    tag: "Submissions",
    summary: "Create first or revised submission attempt",
    operationId: "createSubmission",
    scopes: ["submissions:write"],
    requestSchema: "SubmissionCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/submissions/{id}"] = {
  get: apiOperation({
    tag: "Submissions",
    summary: "Get submission",
    operationId: "getSubmission",
    scopes: ["submissions:read"],
    parameters: [id],
    responseSchema: "SubmissionDetail",
  }),
  delete: apiOperation({
    tag: "Submissions",
    summary: "Delete submission",
    operationId: "deleteSubmission",
    scopes: ["submissions:write"],
    parameters: [id],
    idempotent: true,
  }),
};

paths["/submissions/{id}/review"] = {
  post: apiOperation({
    tag: "Submissions",
    summary: "Append immutable submission review",
    operationId: "reviewSubmission",
    scopes: ["submissions:write"],
    parameters: [id],
    requestSchema: "SubmissionReview",
    responseSchema: "SubmissionReviewResult",
    idempotent: true,
    description:
      "Creates one immutable review and all validated annotations atomically. Media timestamps must reference an audio or video asset attached to the same tenant-scoped submission.",
  }),
};

paths["/leaderboard"] = {
  get: apiOperation({
    tag: "Badges",
    summary: "Get member leaderboard",
    operationId: "getLeaderboard",
    scopes: ["community:read"],
    query: [
      queryParameter("limit", "Maximum ranked members.", {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 25,
      }),
    ],
    list: true,
    responseSchema: "CommunityLeaderboardEntry",
  }),
};

paths["/announcements/{id}/dismissals"] = {
  get: apiOperation({
    tag: "Announcements",
    summary: "List announcement dismissals",
    operationId: "listAnnouncementDismissals",
    scopes: ["notifications:read"],
    parameters: [id],
    list: true,
    paginated: true,
  }),
};

paths["/announcements/{id}/dismissals/{userId}"] = {
  put: apiOperation({
    tag: "Announcements",
    summary: "Dismiss announcement for member",
    operationId: "dismissAnnouncementForMember",
    scopes: ["notifications:write"],
    parameters: [id, userId],
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Announcements",
    summary: "Restore announcement for member",
    operationId: "restoreAnnouncementForMember",
    scopes: ["notifications:write"],
    parameters: [id, userId],
    idempotent: true,
  }),
};

paths["/members/{id}/custom-fields"] = {
  get: apiOperation({
    tag: "Custom Fields",
    summary: "List member custom-field values",
    operationId: "listMemberCustomFields",
    scopes: ["custom_fields:read", "members:read"],
    parameters: [id],
    list: true,
  }),
  put: apiOperation({
    tag: "Custom Fields",
    summary: "Set member custom-field values",
    operationId: "setMemberCustomFields",
    scopes: ["custom_fields:write", "members:write"],
    parameters: [id],
    requestSchema: "CustomFieldValues",
    list: true,
    idempotent: true,
  }),
};

paths["/members/{id}/badges"] = {
  get: apiOperation({
    tag: "Badges",
    summary: "List member badges",
    operationId: "listMemberBadges",
    scopes: ["community:read", "members:read"],
    parameters: [id],
    list: true,
  }),
};

paths["/members/{id}/badges/{badgeId}"] = {
  put: apiOperation({
    tag: "Badges",
    summary: "Award badge to member",
    operationId: "awardMemberBadge",
    scopes: ["community:write", "members:write"],
    parameters: [id, pathParameter("badgeId", "Badge identifier.")],
    requestSchema: "BadgeAssign",
    idempotent: true,
  }),
  delete: apiOperation({
    tag: "Badges",
    summary: "Revoke member badge",
    operationId: "revokeMemberBadge",
    scopes: ["community:write", "members:write"],
    parameters: [id, pathParameter("badgeId", "Badge identifier.")],
    idempotent: true,
  }),
};

paths["/members/{id}/invite"] = {
  post: apiOperation({
    tag: "Members",
    summary: "Issue member invitation",
    operationId: "inviteMember",
    scopes: ["members:write"],
    parameters: [id],
    idempotent: true,
    description:
      "Creates a single-use invitation, delivers its link, and returns the opaque token once in the response. Only tenant-scoped role=member accounts with status=invited can be invited again.",
  }),
};

paths["/email-deliveries"] = {
  get: apiOperation({
    tag: "Email Center",
    summary: "List email deliveries",
    operationId: "listEmailDeliveries",
    scopes: ["email:read"],
    query: [
      queryParameter("search", "Search recipient name or email literally.", {
        type: "string",
        maxLength: 200,
      }),
      enumQuery("event", "Filter by supported email event.", [
        ...emailDeliveryEventValues,
      ]),
      enumQuery("status", "Filter by outbox status.", [
        ...emailDeliveryStatusValues,
      ]),
      queryParameter(
        "from",
        "Include deliveries created at or after this timestamp.",
        dateTimeSchema,
      ),
      queryParameter(
        "to",
        "Include deliveries created at or before this timestamp. Must not precede from.",
        dateTimeSchema,
      ),
    ],
    responseSchema: "EmailDeliveryListItem",
    responseMetaSchema: "EmailDeliveryListMeta",
    list: true,
    paginated: true,
    description:
      "Returns tenant-scoped delivery metadata with masked recipients and meta.total. Encrypted payloads and raw gateway response bodies are never returned.",
  }),
};

paths["/email-deliveries/{id}"] = {
  get: apiOperation({
    tag: "Email Center",
    summary: "Get email delivery",
    operationId: "getEmailDelivery",
    scopes: ["email:read"],
    parameters: [id],
    responseSchema: "EmailDeliveryDetail",
    description:
      "Returns tenant-scoped recipient and status metadata plus optional validated, redacted content. Authentication links, encrypted payloads, and raw gateway response bodies are never returned.",
  }),
};

paths["/email-deliveries/{id}/retry"] = {
  post: apiOperation({
    tag: "Email Center",
    summary: "Retry failed email delivery",
    operationId: "retryEmailDelivery",
    scopes: ["email:write"],
    parameters: [id],
    requestSchema: "EmailDeliveryRetry",
    responseSchema: "EmailDeliveryRetryResult",
    status: "202",
    idempotent: true,
    description:
      "Queues a failed feedback, lesson-availability, or template-test delivery again. Invitation and password-reset deliveries must be regenerated through their authentication workflows. The JSON request body is an empty object.",
  }),
};

paths["/email-suppressions"] = {
  get: apiOperation({
    tag: "Email Center",
    summary: "List recipient suppressions",
    operationId: "listEmailSuppressions",
    scopes: ["email:read"],
    query: [
      queryParameter("search", "Search recipient name or email literally.", {
        type: "string",
        maxLength: 160,
      }),
      enumQuery("status", "Filter by suppression lifecycle.", [
        "active",
        "released",
        "expired",
      ]),
      enumQuery("reason", "Filter by suppression reason.", [
        "hard_bounce",
        "soft_bounce",
        "complaint",
      ]),
    ],
    responseSchema: "EmailSuppressionListItem",
    responseMetaSchema: "EmailDeliveryListMeta",
    list: true,
    paginated: true,
    description:
      "Lists tenant-scoped bounce and complaint suppressions with masked recipients. Hashes, provider reason codes, source deliveries, and release actors are not exposed.",
  }),
};

paths["/email-suppressions/{id}/release"] = {
  post: apiOperation({
    tag: "Email Center",
    summary: "Release recipient suppression",
    operationId: "releaseEmailSuppression",
    scopes: ["email:write"],
    parameters: [id],
    requestSchema: "EmailSuppressionRelease",
    responseSchema: "EmailSuppressionReleaseResult",
    idempotent: true,
    description:
      "Releases one tenant-scoped suppression with a closed review reason. The API-key actor must remain an active owner or admin, and every changed release is written to the activity audit without recipient data.",
  }),
};

paths["/email-templates"] = {
  get: apiOperation({
    tag: "Email Center",
    summary: "Get email templates",
    operationId: "getEmailTemplates",
    scopes: ["email:read"],
    parameters: [emailTemplateLocale],
    responseSchema: "EmailTemplateSettings",
  }),
  patch: apiOperation({
    tag: "Email Center",
    summary: "Update email templates",
    operationId: "updateEmailTemplates",
    scopes: ["email:write"],
    requestSchema: "EmailTemplateSettingsUpdate",
    responseSchema: "EmailTemplateSettingsUpdateResult",
    idempotent: true,
    description:
      "Updates one locale-specific strict version-1 plain-text template set for feedback replies, lesson availability, invitations, and password recovery. Omitted locale preserves the legacy contract and targets the tenant default. Enabled member-property email tokens from /member-properties/variables are accepted only for feedback and lesson-availability templates. HTML, control characters, unknown placeholders, and event-incompatible placeholders are rejected. Authentication-link templates stay closed to profile variables, and their payloads remain encrypted and hidden from delivery details.",
  }),
};

paths["/email-templates/test-deliveries"] = {
  post: apiOperation({
    tag: "Email Center",
    summary: "Queue email template test delivery",
    operationId: "createEmailTemplateTestDelivery",
    scopes: ["email:write"],
    requestSchema: "EmailTemplateTestDeliveryCreate",
    responseSchema: "EmailTemplateTestDelivery",
    status: "202",
    idempotent: true,
    description:
      "Queues a safe locale-specific self-test to the active owner or admin associated with the API key. Omitted locale resolves the recipient preference. requestId identifies the delivery deterministically; arbitrary recipient addresses are not accepted.",
  }),
};

paths["/webhooks/{id}/test"] = {
  post: apiOperation({
    tag: "Webhooks",
    summary: "Queue test webhook delivery",
    operationId: "testWebhook",
    scopes: ["webhooks:write"],
    parameters: [id],
    status: "202",
    idempotent: true,
  }),
};

paths["/webhooks/{id}/rotate-secret"] = {
  post: apiOperation({
    tag: "Webhooks",
    summary: "Rotate webhook signing secret",
    operationId: "rotateWebhookSecret",
    scopes: ["webhooks:write"],
    parameters: [id],
    idempotent: true,
    description: "Returns the replacement signing secret once.",
  }),
};

paths["/webhooks/{id}/deliveries"] = {
  get: apiOperation({
    tag: "Webhooks",
    summary: "List webhook deliveries",
    operationId: "listWebhookDeliveries",
    scopes: ["webhooks:read"],
    parameters: [id],
    list: true,
    paginated: true,
    responseSchema: "WebhookDeliverySummary",
    description:
      "Returns privacy-safe delivery metadata. Raw payload and downstream response bodies are never exposed.",
  }),
};

paths["/webhooks/{id}/deliveries/{deliveryId}"] = {
  get: apiOperation({
    tag: "Webhooks",
    summary: "Get webhook delivery",
    operationId: "getWebhookDelivery",
    scopes: ["webhooks:read"],
    parameters: [id, deliveryId],
    responseSchema: "WebhookDeliveryDetail",
    description:
      "Returns sanitized response diagnostics and payload structure without payload values or raw downstream response bodies.",
  }),
};

paths["/webhooks/{id}/deliveries/{deliveryId}/retry"] = {
  post: apiOperation({
    tag: "Webhooks",
    summary: "Retry webhook delivery",
    operationId: "retryWebhookDelivery",
    scopes: ["webhooks:write"],
    parameters: [id, deliveryId],
    status: "202",
    idempotent: true,
    responseSchema: "WebhookDeliveryDetail",
    description:
      "Requeues an end-state failed delivery. Other delivery states return 409 Conflict.",
  }),
};

paths["/webhooks/deliveries"] = {
  get: apiOperation({
    tag: "Webhooks",
    summary: "List all webhook deliveries",
    operationId: "listAllWebhookDeliveries",
    scopes: ["webhooks:read"],
    query: [
      queryParameter("webhookId", "Filter by webhook.", uuidSchema),
      enumQuery("status", "Filter delivery status.", [
        "pending",
        "processing",
        "delivered",
        "failed",
        "retrying",
      ]),
    ],
    list: true,
    paginated: true,
    responseSchema: "WebhookDeliverySummary",
    description:
      "Lists privacy-safe delivery metadata across webhook targets in the authenticated tenant.",
  }),
};

paths["/webhooks/deliveries/{id}/replay"] = {
  post: apiOperation({
    tag: "Webhooks",
    summary: "Replay webhook delivery",
    operationId: "replayWebhookDelivery",
    scopes: ["webhooks:write"],
    parameters: [id],
    status: "202",
    idempotent: true,
    responseSchema: "WebhookDeliveryDetail",
    description:
      "Requeues an end-state failed delivery. Other delivery states return 409 Conflict.",
  }),
};

const createPrivacyRequestOperation = apiOperation({
  tag: "Privacy",
  summary: "Create privacy request",
  operationId: "createPrivacyRequest",
  scopes: ["privacy:write"],
  requestSchema: "PrivacyRequestCreate",
  responseSchema: "PrivacyRequest",
  status: "201",
  idempotent: true,
  description:
    "Creates an access-export or erasure request for a member of the authenticated tenant. Reusing clientRequestId with the same subject and type returns the existing request with HTTP 200; a different payload returns HTTP 409.",
});
createPrivacyRequestOperation.responses["200"] = successResponse(
  "An existing privacy request with the same clientRequestId was returned.",
  { dataSchema: schemaRef("PrivacyRequest") },
);

paths["/privacy-requests"] = {
  get: apiOperation({
    tag: "Privacy",
    summary: "List privacy requests",
    operationId: "listPrivacyRequests",
    scopes: ["privacy:read"],
    responseSchema: "PrivacyRequestListItem",
    list: true,
    paginated: true,
    description:
      "Lists tenant-scoped privacy requests without subject hashes, internal policy snapshots, status reasons, processing attempts, or processing claims.",
  }),
  post: createPrivacyRequestOperation,
};

paths["/privacy-requests/{id}"] = {
  get: apiOperation({
    tag: "Privacy",
    summary: "Get privacy request",
    operationId: "getPrivacyRequest",
    scopes: ["privacy:read"],
    parameters: [id],
    responseSchema: "PrivacyRequestDetail",
    description:
      "Returns safe request, subject, event, legal-hold, and artifact metadata. Actor references, hold reasons and legal basis, storage identities, processing claims, and artifact failure details are never returned.",
  }),
};

const mediaScopeDescription =
  "Access is purpose-dependent: course content uses courses/modules scopes, submissions use submissions scopes, community media uses community scopes, avatars use members scopes, and branding uses organization scopes. Unbound submission and community drafts are readable only by their uploader or owner. Bound community media additionally requires current canView permission for its source space and cannot be deleted independently.";

paths["/media-assets/stock-images"] = {
  get: apiOperation({
    tag: "Media",
    summary: "Search configured stock images",
    operationId: "searchStockImages",
    scopes: ["modules:write"],
    query: [
      queryParameter("courseId", "Target course identifier.", uuidSchema, true),
      queryParameter(
        "query",
        "Stock image search phrase.",
        { type: "string", minLength: 2, maxLength: 100 },
        true,
      ),
      queryParameter("page", "Provider result page.", {
        type: "integer",
        minimum: 1,
        maximum: 50,
        default: 1,
      }),
      queryParameter("perPage", "Results per page.", {
        type: "integer",
        minimum: 1,
        maximum: 30,
        default: 12,
      }),
    ],
    description:
      "Disabled unless a HTTPS provider and explicit response-host allowlist are configured.",
  }),
  post: apiOperation({
    tag: "Media",
    summary: "Select and track a stock image",
    operationId: "selectStockImage",
    scopes: ["modules:write"],
    requestSchema: "StockImageSelection",
    status: "201",
    description:
      "Re-resolves the provider item and records required attribution and download tracking.",
  }),
};

paths["/media-assets"] = {
  get: apiOperation({
    tag: "Media Assets",
    summary: "List media assets",
    operationId: "listMediaAssets",
    scopes: [],
    list: true,
    paginated: true,
    description: mediaScopeDescription,
    query: [
      enumQuery("purpose", "Filter by media purpose.", [...MEDIA_PURPOSES]),
      enumQuery("status", "Filter by lifecycle status.", [
        "pending",
        "uploaded",
        "scanning",
        "ready",
        "quarantined",
        "failed",
      ]),
    ],
  }),
  post: apiOperation({
    tag: "Media Assets",
    summary: "Create media upload intent",
    operationId: "createMediaAsset",
    scopes: [],
    requestSchema: "MediaAssetCreate",
    responseSchema: "MediaAssetCreated",
    status: "201",
    idempotent: true,
    serviceUnavailable: true,
    description: `${mediaScopeDescription} Versioned S3 uses resumable native multipart uploads for large objects and the signed raw-PUT contract for smaller objects. Reduced STRATO capability remains on its bounded signed multipart/form-data POST transport and does not provide a native write-once guarantee: Q-Academy uses a unique staging key and verifies exact length, metadata, ETag, and content digest before promotion. All uploads remain below the 2,000,000,000-byte scanner boundary.`,
  }),
};

paths["/media-assets/{id}"] = {
  get: apiOperation({
    tag: "Media Assets",
    summary: "Get media asset",
    operationId: "getMediaAsset",
    scopes: [],
    parameters: [id],
    description: mediaScopeDescription,
  }),
  delete: apiOperation({
    tag: "Media Assets",
    summary: "Delete media asset",
    operationId: "deleteMediaAsset",
    scopes: [],
    parameters: [id],
    idempotent: true,
    description: `${mediaScopeDescription} Pending assets are manageable only by their uploader or an administrator; bound submission attachments cannot be deleted.`,
  }),
};

paths["/media-assets/{id}/complete"] = {
  post: apiOperation({
    tag: "Media Assets",
    summary: "Complete S3 upload",
    operationId: "completeMediaAssetUpload",
    scopes: [],
    parameters: [id],
    idempotent: true,
    serviceUnavailable: true,
    description: `${mediaScopeDescription} For native multipart uploads, claims and verifies the provider part inventory before completion. If the provider reports a missing upload after an ambiguous completion, the exact finished staging object is verified before database finalization. Single-upload transports retain their existing staged-object verification.`,
  }),
};

paths["/media-assets/{id}/multipart"] = {
  get: apiOperation({
    tag: "Media Assets",
    summary: "Get multipart upload status",
    operationId: "getMediaAssetMultipartStatus",
    scopes: [],
    parameters: [id],
    responseSchema: "MediaMultipartStatus",
    serviceUnavailable: true,
    description: `${mediaScopeDescription} Read-only provider inventory lookup. A missing provider upload is reported without creating a replacement; use the recovery operation explicitly.`,
  }),
  post: apiOperation({
    tag: "Media Assets",
    summary: "Recover multipart upload status",
    operationId: "recoverMediaAssetMultipartStatus",
    scopes: [],
    parameters: [id],
    responseSchema: "MediaMultipartStatus",
    idempotent: true,
    serviceUnavailable: true,
    description: `${mediaScopeDescription} Reconciles the provider upload. On NoSuchUpload, it first verifies whether the exact staging object was already completed and only creates a replacement session when the object is absent and the original upload deadline has sufficient safety reserve.`,
  }),
  delete: apiOperation({
    tag: "Media Assets",
    summary: "Abort multipart upload",
    operationId: "abortMediaAssetMultipartUpload",
    scopes: [],
    parameters: [id],
    responseSchema: "MediaMultipartAbortResult",
    idempotent: true,
    serviceUnavailable: true,
    description: `${mediaScopeDescription} Fences active completion work, aborts the provider upload, removes staged data, marks the upload intent deleted, and releases its reserved quota.`,
  }),
};

paths["/media-assets/{id}/multipart/parts"] = {
  post: apiOperation({
    tag: "Media Assets",
    summary: "Authorize multipart upload part",
    operationId: "authorizeMediaAssetMultipartPart",
    scopes: [],
    parameters: [id],
    requestSchema: "MediaMultipartPartAuthorizeRequest",
    responseSchema: "MediaMultipartPartAuthorization",
    idempotent: true,
    serviceUnavailable: true,
    description: `${mediaScopeDescription} Signs one plan-bound part number and exact SHA-256 checksum. Send the exact returned Content-Length and X-Amz-Checksum-Sha256 headers with the raw part body.`,
  }),
};

const mediaByteRangeHeaders: OpenApiMap = {
  ...requestIdHeader,
  ...apiRateHeaders,
  "Accept-Ranges": {
    description: "Supported range unit.",
    schema: { type: "string", const: "bytes" },
  },
  "Content-Length": {
    description: "Exact number of bytes in this response body.",
    schema: { type: "integer", minimum: 1 },
  },
  "Content-Disposition": {
    description: "Safe inline or attachment disposition and filename.",
    schema: { type: "string" },
  },
};

const mediaContentResponse: OpenApiMap = {
  "application/octet-stream": {
    schema: { type: "string", contentEncoding: "binary" },
  },
};

paths["/media-assets/{id}/content"] = {
  get: {
    tags: ["Media Assets"],
    summary: "Read ready development media content",
    description:
      "Development-filesystem only. Content is returned only after successful inspection; document kinds always use attachment disposition.",
    operationId: "readMediaAssetContent",
    security: [{ BearerApiKey: [] }],
    "x-required-scopes": [],
    parameters: [
      parameterRef("RequestId"),
      id,
      enumQuery("disposition", "Requested safe content disposition.", [
        "inline",
        "attachment",
      ]),
      {
        name: "Range",
        in: "header",
        required: false,
        description:
          "One or more HTTP byte ranges. The development transport returns the first satisfiable range.",
        schema: { type: "string", pattern: "^bytes=.+$" },
      },
    ],
    responses: {
      "200": {
        description: "Ready media body.",
        headers: mediaByteRangeHeaders,
        content: mediaContentResponse,
      },
      "206": {
        description: "Requested satisfiable byte range.",
        headers: {
          ...mediaByteRangeHeaders,
          "Content-Range": {
            description: "Inclusive byte range and immutable total size.",
            schema: {
              type: "string",
              pattern: "^bytes [0-9]+-[0-9]+/[0-9]+$",
            },
          },
        },
        content: mediaContentResponse,
      },
      "416": {
        description: "No requested byte range is satisfiable.",
        headers: {
          ...requestIdHeader,
          ...apiRateHeaders,
          "Accept-Ranges": mediaByteRangeHeaders["Accept-Ranges"],
          "Content-Range": {
            description: "Immutable total size for retrying the request.",
            schema: { type: "string", pattern: "^bytes \\*/[0-9]+$" },
          },
        },
      },
      ...standardErrors,
    },
  },
  put: {
    tags: ["Media Assets"],
    summary: "Upload development media content",
    description:
      "Development-filesystem only. The body must match the declared MIME type and exact Content-Length and is published write-once.",
    operationId: "uploadMediaAssetContent",
    security: [{ BearerApiKey: [] }],
    "x-required-scopes": [],
    parameters: [parameterRef("RequestId"), id],
    requestBody: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: { type: "string", contentEncoding: "binary" },
        },
      },
    },
    responses: {
      "204": { description: "Upload accepted for asynchronous inspection." },
      ...standardErrors,
    },
  },
};

paths["/media-assets/{id}/download"] = {
  get: {
    tags: ["Media Assets"],
    summary: "Authorize ready media download",
    description:
      "Returns only ready assets. Strict versioned S3 responds with a 307 redirect to a short-lived version-bound authorization; application storage and the ETag-bound STRATO proxy stream the binary body with 200 or 206 and support byte ranges. Required scopes depend on purpose. For avatar assets, members:read permits the normal privileged path; community:read alone permits only an active same-tenant member's exact current avatar when avatar is configured as a public community-profile field. Documents always download as attachments.",
    operationId: "downloadMediaAsset",
    security: [{ BearerApiKey: [] }],
    "x-required-scopes": [],
    parameters: [
      parameterRef("RequestId"),
      id,
      enumQuery("disposition", "Requested safe content disposition.", [
        "inline",
        "attachment",
      ]),
      {
        name: "Range",
        in: "header",
        required: false,
        description:
          "One or more HTTP byte ranges. Streaming transports return the first satisfiable range and do not produce multipart/byteranges.",
        schema: { type: "string", pattern: "^bytes=.+$" },
      },
    ],
    responses: {
      "200": {
        description:
          "Complete ready-media body from an application streaming transport.",
        headers: mediaByteRangeHeaders,
        content: mediaContentResponse,
      },
      "206": {
        description:
          "First satisfiable byte range from an application streaming transport.",
        headers: {
          ...mediaByteRangeHeaders,
          "Content-Range": {
            description: "Inclusive byte range and immutable total size.",
            schema: {
              type: "string",
              pattern: "^bytes [0-9]+-[0-9]+/[0-9]+$",
            },
          },
        },
        content: mediaContentResponse,
      },
      "307": {
        description:
          "Temporary redirect to a strict versioned-S3 download authorization.",
        headers: {
          ...requestIdHeader,
          ...apiRateHeaders,
          Location: {
            description: "Short-lived, version-bound ready-object URL.",
            schema: { type: "string", format: "uri" },
          },
        },
      },
      "416": {
        description:
          "No requested byte range is satisfiable for a streaming transport.",
        headers: {
          ...requestIdHeader,
          ...apiRateHeaders,
          "Accept-Ranges": mediaByteRangeHeaders["Accept-Ranges"],
          "Content-Range": {
            description: "Immutable total size for retrying the request.",
            schema: { type: "string", pattern: "^bytes \\*/[0-9]+$" },
          },
        },
      },
      ...standardErrors,
    },
  },
};

paths["/commerce/connections"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List commerce provider connections",
    operationId: "listCommerceConnections",
    scopes: ["commerce:read"],
    list: true,
  }),
  post: apiOperation({
    tag: "Commerce",
    summary: "Create commerce provider connection",
    operationId: "createCommerceConnection",
    scopes: ["commerce:write"],
    requestSchema: "CommerceConnectionCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/commerce/products"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List commerce products",
    operationId: "listCommerceProducts",
    scopes: ["commerce:read"],
    list: true,
  }),
  post: apiOperation({
    tag: "Commerce",
    summary: "Create commerce product",
    operationId: "createCommerceProduct",
    scopes: ["commerce:write"],
    requestSchema: "CommerceProductCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/commerce/mappings"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List provider product mappings",
    operationId: "listCommerceMappings",
    scopes: ["commerce:read"],
    list: true,
  }),
  post: apiOperation({
    tag: "Commerce",
    summary: "Create provider product mapping",
    operationId: "createCommerceMapping",
    scopes: ["commerce:write"],
    requestSchema: "CommerceMappingCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/commerce/orders"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List normalized orders",
    operationId: "listCommerceOrders",
    scopes: ["commerce:read"],
    list: true,
  }),
};

paths["/commerce/subscriptions"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List normalized subscriptions",
    operationId: "listCommerceSubscriptions",
    scopes: ["commerce:read"],
    list: true,
  }),
};

paths["/commerce/entitlements"] = {
  get: apiOperation({
    tag: "Commerce",
    summary: "List commerce entitlements",
    operationId: "listCommerceEntitlements",
    scopes: ["commerce:read"],
    list: true,
  }),
  post: apiOperation({
    tag: "Commerce",
    summary: "Grant or revoke commerce entitlement",
    operationId: "commandCommerceEntitlement",
    scopes: ["commerce:write"],
    requestSchema: "CommerceEntitlementCommand",
    idempotent: true,
  }),
};

paths["/commerce/reconcile"] = {
  post: apiOperation({
    tag: "Commerce",
    summary: "Reconcile expired commerce entitlements",
    operationId: "reconcileCommerceEntitlements",
    scopes: ["commerce:write"],
    idempotent: true,
  }),
};

paths["/automation/members/upsert"] = {
  post: apiOperation({
    tag: "Automations",
    summary: "Upsert member and grant or revoke automation bundle access",
    operationId: "upsertAutomationMember",
    scopes: ["automations:write"],
    requestSchema: "AutomationMemberUpsert",
    responseSchema: "AutomationMemberUpsertResult",
    status: "201",
    idempotent: true,
  }),
};

paths["/automation/members/upsert"]!.post!.responses["200"] = successResponse(
  "Existing member and bundle access updated successfully.",
  { dataSchema: schemaRef("AutomationMemberUpsertResult") },
);

paths["/automation/connector-status"] = {
  get: apiOperation({
    tag: "Automations",
    summary: "Verify automation connector credentials and capabilities",
    operationId: "getAutomationConnectorStatus",
    scopes: [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES],
    responseSchema: "AutomationConnectorStatus",
    description:
      "Read-only connection test for Zapier and Make. A successful response proves that the API key can execute member upserts and load bundle choices.",
  }),
};

paths["/automation/n8n/workflows"] = {
  get: apiOperation({
    tag: "Automations",
    summary: "List n8n workflow connections",
    operationId: "listN8nWorkflows",
    scopes: ["commerce:read"],
    list: true,
  }),
  post: apiOperation({
    tag: "Automations",
    summary: "Create signed n8n workflow connection",
    operationId: "createN8nWorkflow",
    scopes: ["commerce:write"],
    requestSchema: "N8nWorkflowCreate",
    status: "201",
    idempotent: true,
  }),
};

paths["/automation/n8n/trigger"] = {
  post: apiOperation({
    tag: "Automations",
    summary: "Trigger signed n8n workflow delivery",
    operationId: "triggerN8nWorkflow",
    scopes: ["automations:write"],
    requestSchema: "N8nTrigger",
    status: "202",
    idempotent: true,
  }),
};

paths["/organization/support"] = {
  get: apiOperation({
    tag: "Support",
    summary: "Read support launcher configuration",
    operationId: "getSupportSettings",
    scopes: ["commerce:read"],
  }),
  patch: apiOperation({
    tag: "Support",
    summary: "Update support launcher configuration",
    operationId: "updateSupportSettings",
    scopes: ["commerce:write"],
    requestSchema: "SupportSettingsUpdate",
    idempotent: true,
  }),
};

function problemResponse(description: string): OpenApiMap {
  return {
    description,
    headers: requestIdHeader,
    content: {
      "application/problem+json": { schema: schemaRef("ProblemDetails") },
    },
  };
}

const componentResponses: Record<string, OpenApiMap> = {
  BadRequest: problemResponse(
    "The request syntax, identifier, cursor, or query is invalid.",
  ),
  Unauthorized: problemResponse(
    "Authentication is missing, invalid, expired, or revoked.",
  ),
  Forbidden: problemResponse(
    "The credential lacks the required scope or the browser Origin is not trusted.",
  ),
  NotFound: problemResponse("The tenant-scoped resource was not found."),
  Conflict: problemResponse(
    "The request conflicts with current state or an idempotency record.",
  ),
  PayloadTooLarge: problemResponse(
    "The JSON request body exceeds the supported size limit.",
  ),
  ValidationFailed: problemResponse(
    "The JSON body or query failed validation.",
  ),
  PreconditionRequired: problemResponse(
    "The member has not acknowledged the current tenant AI transparency notice.",
  ),
  RateLimited: {
    ...problemResponse("The request rate limit was exceeded."),
    headers: {
      ...requestIdHeader,
      "Retry-After": {
        description: "Seconds until the client may retry.",
        schema: { type: "integer", minimum: 1 },
      },
      ...apiRateHeaders,
    },
  },
  InternalError: problemResponse("An unexpected server error occurred."),
  ServiceUnavailable: problemResponse(
    "The configured media storage provider is temporarily unavailable.",
  ),
  Http400: responseRef("BadRequest"),
  Http401: responseRef("Unauthorized"),
  Http403: responseRef("Forbidden"),
  Http404: responseRef("NotFound"),
  Http409: responseRef("Conflict"),
  Http413: responseRef("PayloadTooLarge"),
  Http422: responseRef("ValidationFailed"),
  Http428: responseRef("PreconditionRequired"),
  Http429: responseRef("RateLimited"),
};

export const openApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Q-Academy REST API",
    version: "1.7.0",
    summary: "Tenant-scoped learning-platform and browser-session API.",
    description:
      "Administrative `/api/v1` operations use organization API keys and per-operation scopes. Browser identity endpoints use a persisted HttpOnly cookie session instead; public authentication and health endpoints explicitly opt out of API-key security. Standard successful JSON responses use `{ data, meta }`, where `meta` always contains `requestId` and `timestamp` and paginated lists add `meta.pagination`. Errors use `application/problem+json` and the RFC 9457 Problem Details members plus stable `code`, `requestId`, and `errors` extensions.",
    license: {
      name: "Proprietary",
      identifier: "LicenseRef-Q-Academy-Proprietary",
    },
  },
  servers: [{ url: "/api/v1", description: "Current application origin" }],
  tags: [
    { name: "System", description: "Discovery, liveness, and readiness." },
    {
      name: "Authentication",
      description:
        "Public authentication and persisted browser cookie sessions.",
    },
    { name: "Organization", description: "Current tenant configuration." },
    {
      name: "Courses",
      description: "Courses, publication, versions, and module relationships.",
    },
    { name: "Course Categories", description: "Course taxonomy." },
    {
      name: "Modules",
      description: "Reusable learning and examination modules.",
    },
    {
      name: "Module Access",
      description:
        "Tenant-scoped module access requests, decisions, and individual overrides.",
    },
    {
      name: "Content",
      description: "Sections, lessons, pages, and content blocks.",
    },
    { name: "Members", description: "Tenant members and lifecycle." },
    {
      name: "Team Roles",
      description:
        "Owner-bound tenant custom roles, visible permission keys, and staff assignments.",
    },
    {
      name: "Custom Fields",
      description: "Tenant-defined member profile fields and values.",
    },
    { name: "Groups", description: "Member groups." },
    { name: "Bundles", description: "Course bundles." },
    {
      name: "Access Grants",
      description: "Direct, group, and bundle course-access sources.",
    },
    {
      name: "Progress",
      description: "Lesson progress for active enrollments.",
    },
    { name: "Assessments", description: "Quiz and assessment attempts." },
    { name: "Submissions", description: "Assignments and trainer reviews." },
    {
      name: "Media Assets",
      description:
        "Tenant media upload, inspection, and safe download lifecycle.",
    },
    {
      name: "Feedback",
      description: "Course, lesson, platform, and event feedback.",
    },
    {
      name: "Badges",
      description: "Badge definitions, awards, and leaderboard.",
    },
    {
      name: "Community",
      description: "Spaces, posts, comments, and reactions.",
    },
    { name: "Events", description: "Events and attendance." },
    { name: "Notifications", description: "Member notification state." },
    {
      name: "Announcements",
      description: "Scheduled, targeted member banners and modals.",
    },
    { name: "Search", description: "Tenant-wide normalized search." },
    { name: "Hubs", description: "Learning hubs and access grants." },
    {
      name: "AI Agents",
      description: "AI agents, conversations, and messages.",
    },
    { name: "Analytics", description: "Aggregated and activity analytics." },
    {
      name: "Commerce",
      description:
        "Provider-neutral products, orders, subscriptions, and entitlements.",
    },
    {
      name: "Automations",
      description: "Zapier, Make, and signed n8n workflow actions.",
    },
    { name: "Support", description: "Tenant support launcher configuration." },
    {
      name: "Email Center",
      description:
        "Tenant email templates and privacy-safe transactional outbox metadata.",
    },
    {
      name: "Webhooks",
      description: "Webhook subscriptions, secrets, and deliveries.",
    },
    { name: "API Keys", description: "Machine credentials and scopes." },
    {
      name: "Privacy",
      description:
        "Tenant-scoped access-export and erasure request intake and read-only status metadata.",
    },
    { name: "Audit Log", description: "API request audit records." },
  ],
  security: [{ BearerApiKey: [] }],
  paths,
  components: {
    securitySchemes: {
      BearerApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "Q-Academy API key",
        description:
          "Organization API key sent as `Authorization: Bearer <secret>`. It authenticates machine/admin API calls, selects the tenant, enforces `x-required-scopes`, and is rate limited. It does not create a browser login session.",
      },
      CookieSession: {
        type: "apiKey",
        in: "cookie",
        name: "q_academy_session",
        description:
          "Signed HttpOnly browser cookie backed by a persisted, revocable server-side session. Created by login or invitation acceptance and used only by `/me`, `/me/sessions`, and logout flows; it is distinct from an API key.",
      },
    },
    parameters: {
      RequestId: {
        name: "X-Request-Id",
        in: "header",
        required: false,
        description:
          "Optional UUID correlation identifier. A UUID is generated when omitted or invalid.",
        schema: { type: "string", format: "uuid" },
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        required: false,
        description:
          "Key for replaying an idempotent mutation. It is scoped to the organization and request path, retained for 24 hours, and must not be reused with different input.",
        schema: { type: "string", minLength: 8, maxLength: 180 },
      },
      Cursor: {
        name: "cursor",
        in: "query",
        required: false,
        description:
          "Opaque base64url cursor returned in `meta.pagination.nextCursor`.",
        schema: { type: "string", minLength: 1 },
      },
      Limit: {
        name: "limit",
        in: "query",
        required: false,
        description: "Maximum number of records.",
        schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
      },
    },
    headers: {
      ResponseRequestId: {
        description: "Request correlation UUID.",
        schema: { type: "string", format: "uuid" },
      },
      RateLimitLimit: {
        description: "Maximum requests in the current one-minute window.",
        schema: { type: "integer", minimum: 1 },
      },
      RateLimitRemaining: {
        description: "Remaining requests in the current window.",
        schema: { type: "integer", minimum: 0 },
      },
      RateLimitReset: {
        description:
          "Unix timestamp in seconds when the current window resets.",
        schema: { type: "integer", minimum: 0 },
      },
    },
    responses: componentResponses,
    schemas,
  },
} as const satisfies OpenApiDocumentShape;

export const openApiSpec = openApiDocument;
export type OpenApiDocument = typeof openApiDocument;
export default openApiDocument;
