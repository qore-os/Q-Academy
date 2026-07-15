import { createHash } from "node:crypto";

import { z } from "zod";

export const AI_AGENT_TYPES = [
  "learning_coach",
  "knowledge_assistant",
  "form_assistant",
] as const;

export const AI_AGENT_KNOWLEDGE_MODES = [
  "all_accessible_courses",
  "selected_sources",
] as const;

export const AI_AGENT_ACCESS_MODES = ["open", "restricted"] as const;

export const AI_AGENT_SOURCE_TYPES = [
  "course_version",
  "manual_text",
  "media_asset",
  "web_url",
] as const;

export const AI_AGENT_ACCESS_SUBJECTS = [
  "role",
  "user",
  "group",
  "bundle",
] as const;

export const AI_AGENT_ACTION_TYPES = [
  "course_enrollment",
  "course_unenrollment",
  "group_membership_add",
  "group_membership_remove",
  "bundle_assignment_add",
  "bundle_assignment_remove",
] as const;

const uuid = z.string().uuid();
const boundedText = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

export function normalizeAiAgentWebSourceUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  if (url.port === "443") url.port = "";
  return url.toString();
}

const aiAgentWebSourceUrlSchema = z
  .string()
  .trim()
  .min(12, "Bitte gib eine vollstaendige HTTPS-URL ein.")
  .max(2_048, "Die Webquellen-URL darf hoechstens 2048 Zeichen lang sein.")
  .superRefine((value, context) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        Boolean(url.username || url.password) ||
        Boolean(url.port && url.port !== "443") ||
        !url.hostname
      ) {
        throw new Error("unsafe_web_source_url");
      }
    } catch {
      context.addIssue({
        code: "custom",
        message:
          "Webquellen benoetigen eine oeffentliche HTTPS-URL ohne Zugangsdaten und Sonderport.",
      });
    }
  })
  .transform(normalizeAiAgentWebSourceUrl);

export const aiAgentTypeSchema = z.enum(AI_AGENT_TYPES);
export const aiAgentKnowledgeModeSchema = z.enum(AI_AGENT_KNOWLEDGE_MODES);
export const aiAgentAccessModeSchema = z.enum(AI_AGENT_ACCESS_MODES);

export const aiAgentSourceInputSchema = z.discriminatedUnion("sourceType", [
  z
    .object({
      sourceType: z.literal("course_version"),
      courseId: uuid,
    })
    .strict(),
  z
    .object({
      sourceType: z.literal("manual_text"),
      title: boundedText(2, 220),
      content: boundedText(10, 50_000),
    })
    .strict(),
  z
    .object({
      sourceType: z.literal("media_asset"),
      mediaAssetId: uuid,
      title: boundedText(2, 220).optional(),
      content: boundedText(10, 50_000).optional(),
    })
    .strict(),
  z
    .object({
      sourceType: z.literal("web_url"),
      url: aiAgentWebSourceUrlSchema,
    })
    .strict(),
]);

export const aiAgentAccessGrantInputSchema = z.discriminatedUnion(
  "subjectType",
  [
    z
      .object({
        subjectType: z.literal("role"),
        subjectRole: z.enum(["owner", "admin", "trainer", "member"]),
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("user"),
        subjectUserId: uuid,
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("group"),
        subjectGroupId: uuid,
      })
      .strict(),
    z
      .object({
        subjectType: z.literal("bundle"),
        subjectBundleId: uuid,
      })
      .strict(),
  ],
);

export type AiAgentSourceInput = z.infer<typeof aiAgentSourceInputSchema>;
export type AiAgentAccessGrantInput = z.infer<
  typeof aiAgentAccessGrantInputSchema
>;

const courseActionShape = {
  courseId: uuid,
  label: boundedText(2, 120),
  description: boundedText(3, 500),
} as const;
const groupActionShape = {
  groupId: uuid,
  label: boundedText(2, 120),
  description: boundedText(3, 500),
} as const;
const bundleActionShape = {
  bundleId: uuid,
  label: boundedText(2, 120),
  description: boundedText(3, 500),
} as const;

export const aiAgentActionInputSchema = z.discriminatedUnion("actionType", [
  z
    .object({
      actionType: z.literal("course_enrollment"),
      ...courseActionShape,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("course_unenrollment"),
      ...courseActionShape,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("group_membership_add"),
      ...groupActionShape,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("group_membership_remove"),
      ...groupActionShape,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("bundle_assignment_add"),
      ...bundleActionShape,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("bundle_assignment_remove"),
      ...bundleActionShape,
    })
    .strict(),
]);

export type AiAgentActionInput = z.infer<typeof aiAgentActionInputSchema>;

export const aiAgentAdditionalPromptSchema = z
  .object({
    label: boundedText(2, 120),
    prompt: boundedText(10, 4_000),
  })
  .strict();

export type AiAgentAdditionalPrompt = z.infer<
  typeof aiAgentAdditionalPromptSchema
>;

export function aiAgentSourceIdentity(source: AiAgentSourceInput) {
  switch (source.sourceType) {
    case "course_version":
      return `course:${source.courseId}`;
    case "manual_text":
      return `manual:${createHash("sha256")
        .update(`${source.title}\0${source.content}`)
        .digest("hex")}`;
    case "media_asset":
      return `media:${source.mediaAssetId}`;
    case "web_url":
      return `web:${source.url}`;
  }
}

export function aiAgentAccessGrantIdentity(grant: AiAgentAccessGrantInput) {
  switch (grant.subjectType) {
    case "role":
      return `role:${grant.subjectRole}`;
    case "user":
      return `user:${grant.subjectUserId}`;
    case "group":
      return `group:${grant.subjectGroupId}`;
    case "bundle":
      return `bundle:${grant.subjectBundleId}`;
  }
}

export function aiAgentActionIdentity(action: AiAgentActionInput) {
  switch (action.actionType) {
    case "course_enrollment":
    case "course_unenrollment":
      return `${action.actionType}:${action.courseId}`;
    case "group_membership_add":
    case "group_membership_remove":
      return `${action.actionType}:${action.groupId}`;
    case "bundle_assignment_add":
    case "bundle_assignment_remove":
      return `${action.actionType}:${action.bundleId}`;
  }
}

function duplicateIdentity<T>(
  values: readonly T[],
  identity: (value: T) => string,
) {
  const seen = new Set<string>();
  for (const value of values) {
    const key = identity(value);
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}

export const aiAgentDraftUpdateSchema = z
  .object({
    expectedDraftVersionId: uuid,
    expectedDraftRevision: z.number().int().positive(),
    agentType: aiAgentTypeSchema,
    name: boundedText(2, 120),
    description: boundedText(3, 5_000),
    systemPrompt: boundedText(10, 50_000),
    color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,40}$/),
    knowledgeMode: aiAgentKnowledgeModeSchema,
    accessMode: aiAgentAccessModeSchema,
    sources: z.array(aiAgentSourceInputSchema).max(100),
    accessGrants: z.array(aiAgentAccessGrantInputSchema).max(250),
    actions: z.array(aiAgentActionInputSchema).max(25).default([]),
    profileFieldIds: z.array(uuid).max(25).default([]),
    additionalPrompts: z
      .array(aiAgentAdditionalPromptSchema)
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((input, context) => {
    const duplicateSource = duplicateIdentity(
      input.sources,
      aiAgentSourceIdentity,
    );
    if (duplicateSource) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Eine Wissensquelle ist mehrfach konfiguriert.",
      });
    }

    const duplicateGrant = duplicateIdentity(
      input.accessGrants,
      aiAgentAccessGrantIdentity,
    );
    if (duplicateGrant) {
      context.addIssue({
        code: "custom",
        path: ["accessGrants"],
        message: "Eine Zielgruppenfreigabe ist mehrfach konfiguriert.",
      });
    }

    const duplicateAction = duplicateIdentity(
      input.actions,
      aiAgentActionIdentity,
    );
    if (duplicateAction) {
      context.addIssue({
        code: "custom",
        path: ["actions"],
        message: "Eine Agentenaktion ist mehrfach konfiguriert.",
      });
    }

    if (new Set(input.profileFieldIds).size !== input.profileFieldIds.length) {
      context.addIssue({
        code: "custom",
        path: ["profileFieldIds"],
        message: "Ein Profilfeld ist mehrfach fuer die Personalisierung ausgewaehlt.",
      });
    }

    const normalizedPromptLabels = input.additionalPrompts.map((prompt) =>
      prompt.label.toLocaleLowerCase("de-DE"),
    );
    if (new Set(normalizedPromptLabels).size !== normalizedPromptLabels.length) {
      context.addIssue({
        code: "custom",
        path: ["additionalPrompts"],
        message: "Die Bezeichnungen zusaetzlicher Prompts muessen eindeutig sein.",
      });
    }

    if (input.accessMode === "open" && input.accessGrants.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["accessGrants"],
        message: "Offene Agenten duerfen keine eingeschraenkten Grants besitzen.",
      });
    }
    if (input.accessMode === "restricted" && input.accessGrants.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["accessGrants"],
        message: "Eingeschraenkte Agenten benoetigen mindestens eine Zielgruppe.",
      });
    }
    if (
      input.knowledgeMode === "selected_sources" &&
      input.sources.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Der ausgewaehlte Wissensmodus benoetigt mindestens eine Quelle.",
      });
    }
    if (
      input.sources.filter((source) => source.sourceType === "web_url").length >
      10
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "Ein Agentenentwurf darf hoechstens zehn Webquellen enthalten.",
      });
    }
    if (
      input.sources.filter((source) => source.sourceType === "media_asset")
        .length > 20
    ) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message:
          "Ein Agentenentwurf darf hoechstens zwanzig extrahierte Dokumentquellen enthalten.",
      });
    }
  });

export const aiAgentPublishSchema = z
  .object({
    expectedDraftVersionId: uuid,
    expectedDraftRevision: z.number().int().positive(),
  })
  .strict();

export const aiAgentRollbackSchema = z
  .object({
    publishedVersionId: uuid,
  })
  .strict();

export const aiAgentPreviewSchema = z
  .object({
    expectedDraftVersionId: uuid,
    expectedDraftRevision: z.number().int().positive(),
    memberId: uuid,
    message: boundedText(1, 10_000),
  })
  .strict();

export type AiAgentDraftUpdate = z.infer<typeof aiAgentDraftUpdateSchema>;

export function aiAgentDraftDigest(input: AiAgentDraftUpdate) {
  const normalized = {
    ...input,
    sources: [...input.sources].sort((left, right) =>
      aiAgentSourceIdentity(left).localeCompare(aiAgentSourceIdentity(right)),
    ),
    accessGrants: [...input.accessGrants].sort((left, right) =>
      aiAgentAccessGrantIdentity(left).localeCompare(
        aiAgentAccessGrantIdentity(right),
      ),
    ),
    actions: [...input.actions].sort((left, right) =>
      aiAgentActionIdentity(left).localeCompare(aiAgentActionIdentity(right)),
    ),
    profileFieldIds: [...(input.profileFieldIds ?? [])].sort(),
    additionalPrompts: input.additionalPrompts ?? [],
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
