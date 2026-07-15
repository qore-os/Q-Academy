"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  previewAiAgentDraftAsMember,
  publishAiAgentDraft,
  rollbackAiAgentVersion,
  updateAiAgentDraft,
  type AiAgentDraftPreviewResult,
  type AiAgentActor,
} from "@/lib/ai/agent-studio";
import { ApiError } from "@/lib/api/errors";
import { requireTeamPermission } from "@/lib/auth";
import type { AiAdminMessageCode } from "@/lib/i18n/ai-admin";
import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
} from "@/lib/auth-rate-limit";
import { logServerError } from "@/lib/server-error-logging";

export type AiAgentStudioActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: AiAdminMessageCode;
  messageParams?: Record<string, string | number | boolean>;
  resourceId?: string;
};

export type AiAgentDraftPreviewActionState =
  | { ok: true; preview: AiAgentDraftPreviewResult }
  | {
      ok: false;
      message: string;
      messageCode?: AiAdminMessageCode;
    };

const identifierSchema = z.string().uuid();
const publicationInputSchema = z.object({
  agentId: identifierSchema,
  expectedDraftVersionId: identifierSchema,
  expectedDraftRevision: z.number().int().positive(),
  confirmed: z.literal(true),
});
const rollbackInputSchema = z.object({
  agentId: identifierSchema,
  publishedVersionId: identifierSchema,
  confirmed: z.literal(true),
});
const previewInputSchema = z
  .object({
    agentId: identifierSchema,
    expectedDraftVersionId: identifierSchema,
    expectedDraftRevision: z.number().int().positive(),
    memberId: identifierSchema,
    message: z.string().trim().min(1).max(600),
  })
  .strict();

function failure(
  message: string,
  messageCode: AiAdminMessageCode,
): AiAgentStudioActionState {
  return { ok: false, message, messageCode };
}

function value(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

function values(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim());
}

function actorFromUser(
  user: Awaited<ReturnType<typeof requireTeamPermission>>,
): AiAgentActor {
  return {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };
}

function revalidateAgentStudio() {
  revalidatePath("/admin/ai");
}

function handledError(
  error: unknown,
  fallback: string,
  messageCode: AiAdminMessageCode,
  context: Record<string, string>,
): AiAgentStudioActionState {
  if (error instanceof z.ZodError) {
    return failure(
      error.issues[0]?.message ?? "Bitte pruefe die Agenten-Konfiguration.",
      "invalidConfiguration",
    );
  }
  if (error instanceof ApiError) return failure(error.message, messageCode);
  logServerError(error, context);
  return failure(fallback, messageCode);
}

function normalizeDraft(formData: FormData) {
  const knowledgeMode = value(formData, "knowledgeMode");
  const accessMode = value(formData, "accessMode");
  const sources: Array<Record<string, string>> = [];

  if (knowledgeMode === "selected_sources") {
    for (const courseId of values(formData, "courseIds")) {
      sources.push({ sourceType: "course_version", courseId });
    }

    const manualTitles = values(formData, "manualTitles");
    const manualContents = values(formData, "manualContents");
    const manualCount = Math.max(manualTitles.length, manualContents.length);
    for (let index = 0; index < manualCount; index += 1) {
      const title = manualTitles[index] ?? "";
      const content = manualContents[index] ?? "";
      if (!title && !content) continue;
      sources.push({ sourceType: "manual_text", title, content });
    }

    for (const mediaAssetId of values(formData, "mediaAssetIds")) {
      sources.push({
        sourceType: "media_asset",
        mediaAssetId,
      });
    }

    for (const url of values(formData, "webUrls")) {
      if (url) sources.push({ sourceType: "web_url", url });
    }
  }

  const accessGrants: Array<Record<string, string>> = [];
  if (accessMode === "restricted") {
    for (const subjectRole of values(formData, "grantRoles")) {
      accessGrants.push({ subjectType: "role", subjectRole });
    }
    for (const subjectUserId of values(formData, "grantUserIds")) {
      accessGrants.push({ subjectType: "user", subjectUserId });
    }
    for (const subjectGroupId of values(formData, "grantGroupIds")) {
      accessGrants.push({ subjectType: "group", subjectGroupId });
    }
    for (const subjectBundleId of values(formData, "grantBundleIds")) {
      accessGrants.push({ subjectType: "bundle", subjectBundleId });
    }
  }

  const enrollmentActions = values(formData, "actionCourseIds").map(
    (courseId) => ({
      actionType: "course_enrollment",
      courseId,
      label: value(formData, `actionLabel:course_enrollment:${courseId}`),
      description: value(
        formData,
        `actionDescription:course_enrollment:${courseId}`,
      ),
    }),
  );
  const unenrollmentActions = values(
    formData,
    "actionUnenrollmentCourseIds",
  ).map((courseId) => ({
    actionType: "course_unenrollment",
    courseId,
    label: value(formData, `actionLabel:course_unenrollment:${courseId}`),
    description: value(
      formData,
      `actionDescription:course_unenrollment:${courseId}`,
    ),
  }));
  const groupAssignmentActions = values(
    formData,
    "actionGroupAssignmentIds",
  ).map((groupId) => ({
    actionType: "group_membership_add",
    groupId,
    label: value(formData, `actionLabel:group_membership_add:${groupId}`),
    description: value(
      formData,
      `actionDescription:group_membership_add:${groupId}`,
    ),
  }));
  const groupRemovalActions = values(formData, "actionGroupRemovalIds").map(
    (groupId) => ({
      actionType: "group_membership_remove",
      groupId,
      label: value(
        formData,
        `actionLabel:group_membership_remove:${groupId}`,
      ),
      description: value(
        formData,
        `actionDescription:group_membership_remove:${groupId}`,
      ),
    }),
  );
  const bundleAssignmentActions = values(
    formData,
    "actionBundleAssignmentIds",
  ).map((bundleId) => ({
    actionType: "bundle_assignment_add",
    bundleId,
    label: value(formData, `actionLabel:bundle_assignment_add:${bundleId}`),
    description: value(
      formData,
      `actionDescription:bundle_assignment_add:${bundleId}`,
    ),
  }));
  const bundleRemovalActions = values(formData, "actionBundleRemovalIds").map(
    (bundleId) => ({
      actionType: "bundle_assignment_remove",
      bundleId,
      label: value(
        formData,
        `actionLabel:bundle_assignment_remove:${bundleId}`,
      ),
      description: value(
        formData,
        `actionDescription:bundle_assignment_remove:${bundleId}`,
      ),
    }),
  );
  const actions = [
    ...enrollmentActions,
    ...unenrollmentActions,
    ...groupAssignmentActions,
    ...groupRemovalActions,
    ...bundleAssignmentActions,
    ...bundleRemovalActions,
  ];
  const additionalPromptLabels = values(formData, "additionalPromptLabels");
  const additionalPromptContents = values(
    formData,
    "additionalPromptContents",
  );
  const additionalPrompts = Array.from(
    { length: Math.max(additionalPromptLabels.length, additionalPromptContents.length) },
    (_, index) => ({
      label: additionalPromptLabels[index] ?? "",
      prompt: additionalPromptContents[index] ?? "",
    }),
  ).filter((entry) => entry.label || entry.prompt);

  return {
    expectedDraftVersionId: value(formData, "expectedDraftVersionId"),
    expectedDraftRevision: Number(value(formData, "expectedDraftRevision")),
    agentType: value(formData, "agentType"),
    name: value(formData, "name"),
    description: value(formData, "description"),
    systemPrompt: value(formData, "systemPrompt"),
    color: value(formData, "color"),
    icon: value(formData, "icon"),
    knowledgeMode,
    accessMode,
    sources,
    accessGrants,
    actions,
    profileFieldIds: values(formData, "profileFieldIds"),
    additionalPrompts,
  };
}

export async function updateAiAgentDraftAdminAction(
  agentId: string,
  _state: AiAgentStudioActionState,
  formData: FormData,
): Promise<AiAgentStudioActionState> {
  const user = await requireTeamPermission("ai.manage");
  const parsedAgentId = identifierSchema.safeParse(agentId);
  if (!parsedAgentId.success) {
    return failure("Der KI-Agent ist ungueltig.", "invalidAgent");
  }

  try {
    const draft = await updateAiAgentDraft({
      actor: actorFromUser(user),
      agentId: parsedAgentId.data,
      draft: normalizeDraft(formData),
    });
    revalidateAgentStudio();
    return {
      ok: true,
      message: "Agentenentwurf gespeichert.",
      messageCode: "draftSaved",
      resourceId: draft.id,
    };
  } catch (error) {
    return handledError(
      error,
      "Der Agentenentwurf konnte nicht gespeichert werden.",
      "draftSaveFailed",
      { action: "admin.ai_agent_studio.update", agentId: parsedAgentId.data },
    );
  }
}

export async function publishAiAgentDraftAdminAction(input: {
  agentId: string;
  expectedDraftVersionId: string;
  expectedDraftRevision: number;
  confirmed: boolean;
}): Promise<AiAgentStudioActionState> {
  const user = await requireTeamPermission("ai.manage");
  const parsed = publicationInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "Die Veroeffentlichung wurde nicht bestaetigt oder ist ungueltig.",
      "publishInvalid",
    );
  }

  try {
    const result = await publishAiAgentDraft({
      actor: actorFromUser(user),
      agentId: parsed.data.agentId,
      publication: {
        expectedDraftVersionId: parsed.data.expectedDraftVersionId,
        expectedDraftRevision: parsed.data.expectedDraftRevision,
      },
    });
    revalidateAgentStudio();
    return {
      ok: true,
      message: `Version ${result.published.version} ist jetzt live.`,
      messageCode: "published",
      messageParams: { version: result.published.version },
      resourceId: result.published.id,
    };
  } catch (error) {
    return handledError(
      error,
      "Der Agentenentwurf konnte nicht veroeffentlicht werden.",
      "publishFailed",
      { action: "admin.ai_agent_studio.publish", agentId: parsed.data.agentId },
    );
  }
}

export async function rollbackAiAgentVersionAdminAction(input: {
  agentId: string;
  publishedVersionId: string;
  confirmed: boolean;
}): Promise<AiAgentStudioActionState> {
  const user = await requireTeamPermission("ai.manage");
  const parsed = rollbackInputSchema.safeParse(input);
  if (!parsed.success) {
    return failure(
      "Das Zuruecksetzen wurde nicht bestaetigt oder ist ungueltig.",
      "rollbackInvalid",
    );
  }

  try {
    const version = await rollbackAiAgentVersion({
      actor: actorFromUser(user),
      agentId: parsed.data.agentId,
      rollback: { publishedVersionId: parsed.data.publishedVersionId },
    });
    revalidateAgentStudio();
    return {
      ok: true,
      message: `Version ${version.version} ist wieder live.`,
      messageCode: "rolledBack",
      messageParams: { version: version.version },
      resourceId: version.id,
    };
  } catch (error) {
    return handledError(
      error,
      "Die Live-Version konnte nicht zurueckgesetzt werden.",
      "rollbackFailed",
      { action: "admin.ai_agent_studio.rollback", agentId: parsed.data.agentId },
    );
  }
}

export async function previewAiAgentDraftAsMemberAdminAction(input: {
  agentId: string;
  expectedDraftVersionId: string;
  expectedDraftRevision: number;
  memberId: string;
  message: string;
}): Promise<AiAgentDraftPreviewActionState> {
  const user = await requireTeamPermission("ai.manage");
  const parsed = previewInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "Die Mitgliedsvorschau ist ungueltig.",
      messageCode: "previewInvalid",
    };
  }

  const rateIdentifier = `${user.organizationId}\0${user.id}\0agent-draft-preview`;
  let concurrencyClaimed = false;
  let concurrencyResetAt: Date | null = null;
  try {
    const concurrency = await consumePersistentRateLimit({
      action: "ai_message_concurrent",
      identifier: rateIdentifier,
    });
    if (concurrency.limited) {
      return {
        ok: false,
        message: "Eine andere Vorschau wird noch erstellt. Bitte warte kurz.",
        messageCode: "previewBusy",
      };
    }
    concurrencyClaimed = true;
    concurrencyResetAt = concurrency.resetAt;

    const quota = await consumeGuardedPersistentRateLimit({
      guards: [
        {
          action: "ai_message_tenant",
          identifier: user.organizationId,
        },
      ],
      primary: {
        action: "ai_message",
        identifier: rateIdentifier,
      },
    });
    if (quota.limited) {
      return {
        ok: false,
        message: "Das Vorschau-Limit ist erreicht. Bitte versuche es spaeter erneut.",
        messageCode: "previewRateLimited",
      };
    }

    const preview = await previewAiAgentDraftAsMember({
      actor: actorFromUser(user),
      agentId: parsed.data.agentId,
      preview: {
        expectedDraftVersionId: parsed.data.expectedDraftVersionId,
        expectedDraftRevision: parsed.data.expectedDraftRevision,
        memberId: parsed.data.memberId,
        message: parsed.data.message,
      },
    });
    return { ok: true, preview };
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof ApiError) {
      return {
        ok: false,
        message:
          error instanceof ApiError
            ? error.message
            : error.issues[0]?.message ?? "Die Mitgliedsvorschau ist ungueltig.",
        messageCode:
          error instanceof ApiError ? "previewFailed" : "previewInvalid",
      };
    }
    logServerError(error, { action: "admin.ai_agent_studio.preview" });
    return {
      ok: false,
      message: "Die Mitgliedsvorschau konnte nicht erstellt werden.",
      messageCode: "previewFailed",
    };
  } finally {
    if (concurrencyClaimed && concurrencyResetAt) {
      try {
        await clearPersistentRateLimit({
          action: "ai_message_concurrent",
          identifier: rateIdentifier,
          expectedResetAt: concurrencyResetAt,
        });
      } catch (error) {
        logServerError(error, {
          action: "admin.ai_agent_studio.preview.release",
        });
      }
    }
  }
}
