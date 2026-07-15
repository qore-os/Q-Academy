import "server-only";

import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  aiAgents,
  aiAgentVersionSources,
  aiAgentVersions,
  aiConversations,
  aiMessages,
  apiKeys,
  courses,
  enrollments,
  mediaAssets,
  users,
  type AiConversation,
  type AiMessage,
} from "@/db/schema";
import {
  dedupeAiMessageCitations,
  safeInternalAcademyHref,
} from "@/lib/ai/citations";
import {
  requireAccessiblePublishedAiAgent,
} from "@/lib/ai/agent-studio";
import {
  requireAiAgentPolicyEnabled,
  reserveAiAgentCredit,
} from "@/lib/ai/agent-policy";
import {
  buildAiCourseContext,
  sanitizeAiReferenceText,
  type AiCourseContext,
} from "@/lib/ai/grounding";
import { completeAiMessage } from "@/lib/ai/provider";
import {
  appendAiAgentAdditionalPrompts,
  getAiMemberProfileContext,
} from "@/lib/ai/member-profile-context";
import { requireAiTransparencyAcknowledgement } from "@/lib/ai/transparency";
import { ApiError } from "@/lib/api/errors";
import { getActiveExamContentLock } from "@/lib/exam-content-access";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";

type AiReader = Pick<typeof db, "select">;

export type ConversationListOptions = {
  agentId?: string;
  userId?: string;
  status?: "active" | "archived";
  limit: number;
  offset: number;
};

export function presentAiConversation(conversation: AiConversation) {
  return {
    id: conversation.id,
    agentId: conversation.agentId,
    agentVersionId: conversation.agentVersionId,
    memberId: conversation.userId,
    title: conversation.title,
    status: conversation.status,
    messageCount: conversation.messageCount,
    lastMessageAt: conversation.lastMessageAt,
    metadata: conversation.metadata,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function safeAiCitations(citations: AiMessage["citations"]) {
  const safe: AiMessage["citations"] = [];
  for (const citation of citations) {
    const href = safeInternalAcademyHref(citation.href);
    if (href) {
      safe.push({ ...citation, href });
      continue;
    }
    if (
      citation.courseId?.startsWith("agent-source:") &&
      citation.lessonId === citation.courseId
    ) {
      const title = sanitizeAiReferenceText(citation.title, 220);
      const excerpt = sanitizeAiReferenceText(citation.excerpt, 320);
      if (!title) continue;
      safe.push({
        title,
        courseId: citation.courseId,
        lessonId: citation.lessonId,
        excerpt: excerpt || undefined,
      });
    }
  }
  return dedupeAiMessageCitations(safe);
}

export function presentAiMessage(message: AiMessage) {
  return {
    id: message.id,
    chatId: message.conversationId,
    role: message.role,
    content: message.content,
    citations: safeAiCitations(message.citations),
    toolCalls: message.toolCalls,
    usage: {
      inputTokens: message.inputTokens,
      outputTokens: message.outputTokens,
    },
    latencyMs: message.latencyMs,
    provider: message.provider,
    model: message.model,
    metadata: message.metadata,
    createdAt: message.createdAt,
  };
}

type GroundingMetadata = {
  mode: "generic" | "sources";
  sourceIds: string[];
  courseVersions: Array<{ courseId: string; versionId: string }>;
};

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function parseGroundingMetadata(metadata: Record<string, unknown>) {
  const grounding = metadataRecord(metadata.grounding);
  if (
    !grounding ||
    grounding.schemaVersion !== 2 ||
    (grounding.mode !== "generic" && grounding.mode !== "sources") ||
    !Array.isArray(grounding.sourceIds) ||
    !grounding.sourceIds.every((sourceId) => typeof sourceId === "string") ||
    !Array.isArray(grounding.courseVersions)
  ) {
    return null;
  }
  const courseVersions = grounding.courseVersions.flatMap((value) => {
    const entry = metadataRecord(value);
    return entry &&
      typeof entry.courseId === "string" &&
      typeof entry.versionId === "string"
      ? [{ courseId: entry.courseId, versionId: entry.versionId }]
      : [];
  });
  if (courseVersions.length !== grounding.courseVersions.length) return null;
  const sourceIds = [...new Set(grounding.sourceIds)];
  if (grounding.mode === "sources" && sourceIds.length === 0) return null;
  return {
    mode: grounding.mode,
    sourceIds,
    courseVersions,
  } satisfies GroundingMetadata;
}

function groundingIsCurrent(
  metadata: Record<string, unknown>,
  courses: AiCourseContext[],
) {
  const grounding = parseGroundingMetadata(metadata);
  if (!grounding) return false;
  const currentVersions = new Map(
    courses.map((course) => [course.id, course.versionId]),
  );
  if (
    grounding.courseVersions.some(
      ({ courseId, versionId }) => currentVersions.get(courseId) !== versionId,
    )
  ) {
    return false;
  }
  if (grounding.mode === "generic") return grounding.sourceIds.length === 0;
  const currentSourceIds = new Set(
    courses.flatMap((course) => course.sources.map((source) => source.id)),
  );
  return grounding.sourceIds.every((sourceId) => currentSourceIds.has(sourceId));
}

const unavailableHistoricalAnswer =
  "Diese fruehere Q-Coach-Antwort ist nicht mehr verfuegbar, weil sich deine Freigaben oder der veroeffentlichte Kursstand geaendert haben.";

export function presentAiMessageForCurrentAccess(
  message: AiMessage,
  courses: AiCourseContext[],
) {
  if (
    message.role !== "assistant" ||
    groundingIsCurrent(message.metadata, courses)
  ) {
    return presentAiMessage(message);
  }
  return presentAiMessage({
    ...message,
    content: unavailableHistoricalAnswer,
    citations: [],
    metadata: { groundingUnavailable: true },
  });
}

export async function requireAiAgent(
  organizationId: string,
  agentId: string,
  options: { active?: boolean } = {},
) {
  const conditions: SQL[] = [
    eq(aiAgents.id, agentId),
    eq(aiAgents.organizationId, organizationId),
  ];
  if (options.active) conditions.push(eq(aiAgents.active, true));
  const [agent] = await db.select().from(aiAgents).where(and(...conditions)).limit(1);
  if (!agent) throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
  return agent;
}

export async function getDefaultAiAgent(organizationId: string) {
  const [preferred] = await db
    .select()
    .from(aiAgents)
    .where(
      and(
        eq(aiAgents.organizationId, organizationId),
        eq(aiAgents.name, "Q-Coach"),
        eq(aiAgents.active, true),
      ),
    )
    .limit(1);
  if (preferred) return preferred;

  const [fallback] = await db
    .select()
    .from(aiAgents)
    .where(and(eq(aiAgents.organizationId, organizationId), eq(aiAgents.active, true)))
    .orderBy(asc(aiAgents.createdAt), asc(aiAgents.id))
    .limit(1);
  if (!fallback) {
    throw new ApiError(404, "not_found", "Fuer diese Organisation ist kein aktiver KI-Agent eingerichtet.");
  }
  return fallback;
}

export async function requireAiMember(organizationId: string, userId: string) {
  const [member] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden oder nicht aktiv.");
  return member;
}

export async function getApiActorUserId(organizationId: string, apiKeyId: string) {
  const [key] = await db
    .select({ createdById: apiKeys.createdById })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.organizationId, organizationId)))
    .limit(1);
  if (!key?.createdById) {
    throw new ApiError(
      400,
      "bad_request",
      "memberId ist erforderlich, wenn der API-Schluessel keinem aktiven Mitglied zugeordnet ist.",
    );
  }
  await requireAiMember(organizationId, key.createdById);
  return key.createdById;
}

export async function createAiConversation(input: {
  organizationId: string;
  agentId: string;
  userId: string;
  title?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const [agent] = await Promise.all([
    requireAccessiblePublishedAiAgent({
      organizationId: input.organizationId,
      userId: input.userId,
      agentId: input.agentId,
    }),
    requireAiMember(input.organizationId, input.userId),
    requireAiAgentPolicyEnabled(input.organizationId),
  ]);
  const [conversation] = await db
    .insert(aiConversations)
    .values({
      organizationId: input.organizationId,
      agentId: input.agentId,
      agentVersionId: agent.versionId,
      userId: input.userId,
      title: input.title?.trim() || null,
      metadata: input.metadata ?? {},
    })
    .returning();
  if (!conversation) throw new ApiError(500, "internal_error", "Konversation konnte nicht angelegt werden.");
  return conversation;
}

export async function deleteEmptyAiConversation(input: {
  organizationId: string;
  conversationId: string;
  userId: string;
}) {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select({
        id: aiConversations.id,
        messageCount: aiConversations.messageCount,
      })
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, input.conversationId),
          eq(aiConversations.organizationId, input.organizationId),
          eq(aiConversations.userId, input.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (!conversation || conversation.messageCount !== 0) return false;

    const [message] = await tx
      .select({ id: aiMessages.id })
      .from(aiMessages)
      .where(
        and(
          eq(aiMessages.organizationId, input.organizationId),
          eq(aiMessages.conversationId, conversation.id),
        ),
      )
      .limit(1);
    if (message) return false;

    const [deleted] = await tx
      .delete(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversation.id),
          eq(aiConversations.organizationId, input.organizationId),
          eq(aiConversations.userId, input.userId),
          eq(aiConversations.messageCount, 0),
        ),
      )
      .returning({ id: aiConversations.id });
    return Boolean(deleted);
  });
}

export async function listAiConversations(
  organizationId: string,
  options: ConversationListOptions,
) {
  const conditions: SQL[] = [eq(aiConversations.organizationId, organizationId)];
  if (options.agentId) conditions.push(eq(aiConversations.agentId, options.agentId));
  if (options.userId) conditions.push(eq(aiConversations.userId, options.userId));
  if (options.status) conditions.push(eq(aiConversations.status, options.status));
  return db
    .select()
    .from(aiConversations)
    .where(and(...conditions))
    .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
    .limit(options.limit + 1)
    .offset(options.offset);
}

export async function requireAiConversation(input: {
  organizationId: string;
  conversationId: string;
  agentId?: string;
  userId?: string;
}) {
  const conditions: SQL[] = [
    eq(aiConversations.id, input.conversationId),
    eq(aiConversations.organizationId, input.organizationId),
  ];
  if (input.agentId) conditions.push(eq(aiConversations.agentId, input.agentId));
  if (input.userId) conditions.push(eq(aiConversations.userId, input.userId));
  const [conversation] = await db
    .select()
    .from(aiConversations)
    .where(and(...conditions))
    .limit(1);
  if (!conversation) throw new ApiError(404, "not_found", "Konversation nicht gefunden.");
  return conversation;
}

export async function listAiMessages(input: {
  organizationId: string;
  conversationId: string;
  limit: number;
  offset: number;
}) {
  return db
    .select()
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.organizationId, input.organizationId),
        eq(aiMessages.conversationId, input.conversationId),
      ),
    )
    .orderBy(asc(aiMessages.createdAt), asc(aiMessages.id))
    .limit(input.limit + 1)
    .offset(input.offset);
}

export async function listRecentAiMessages(input: {
  organizationId: string;
  conversationId: string;
  limit: number;
}) {
  const rows = await db
    .select()
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.organizationId, input.organizationId),
        eq(aiMessages.conversationId, input.conversationId),
      ),
    )
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(input.limit);
  return rows.reverse();
}

async function recentAiMessages(
  organizationId: string,
  conversationId: string,
  courseContext: AiCourseContext[],
) {
  const rows = await db
    .select({
      role: aiMessages.role,
      content: aiMessages.content,
      metadata: aiMessages.metadata,
    })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.organizationId, organizationId),
        eq(aiMessages.conversationId, conversationId),
      ),
    )
    .orderBy(desc(aiMessages.createdAt), desc(aiMessages.id))
    .limit(20);
  return rows
    .reverse()
    .filter(
      (
        message,
      ): message is {
        role: "user" | "assistant";
        content: string;
        metadata: Record<string, unknown>;
      } =>
        message.role === "user" ||
        (message.role === "assistant" &&
          groundingIsCurrent(message.metadata, courseContext)),
    )
    .map(({ role, content }) => ({ role, content }));
}

export async function getAccessibleAiCourseContext(
  organizationId: string,
  userId: string,
  reader: AiReader = db,
  lockAccessRows = false,
): Promise<AiCourseContext[]> {
  const query = reader
    .select({
      courseId: courses.id,
      progress: enrollments.progress,
    })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, organizationId),
        eq(courses.status, "published"),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, enrollments.userId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(enrollments.userId, userId),
        eq(enrollments.accessActive, true),
      ),
    );
  const rows = lockAccessRows ? await query.for("share") : await query;
  const uniqueRows = [
    ...new Map(rows.map((row) => [row.courseId, row])).values(),
  ];
  const resolved: Array<{
    row: (typeof uniqueRows)[number];
    access: Awaited<ReturnType<typeof getCourseLearningAccess>>;
  }> = [];
  for (const row of uniqueRows) {
    resolved.push({
      row,
      access: await getCourseLearningAccess(reader, {
        organizationId,
        userId,
        courseId: row.courseId,
      }),
    });
  }
  const sorted = resolved
    .filter(
      (
        entry,
      ): entry is {
        row: (typeof uniqueRows)[number];
        access: NonNullable<Awaited<ReturnType<typeof getCourseLearningAccess>>>;
      } => Boolean(entry.access),
    )
    .sort((left, right) =>
      left.access.published.snapshot.course.title.localeCompare(
        right.access.published.snapshot.course.title,
        "de-DE",
      ),
    );
  const globalBudget = { used: 0 };
  return sorted.map(({ row, access }) =>
    buildAiCourseContext(access, row.progress, globalBudget),
  );
}

async function requirePublishedAiAgentVersion(input: {
  executor?: AiReader;
  organizationId: string;
  agentId: string;
  agentVersionId: string;
}) {
  const executor = input.executor ?? db;
  const [version] = await executor
    .select()
    .from(aiAgentVersions)
    .where(
      and(
        eq(aiAgentVersions.id, input.agentVersionId),
        eq(aiAgentVersions.agentId, input.agentId),
        eq(aiAgentVersions.organizationId, input.organizationId),
        eq(aiAgentVersions.state, "published"),
      ),
    )
    .limit(1);
  if (!version) {
    throw new ApiError(
      404,
      "not_found",
      "Veroeffentlichte Agentenversion nicht gefunden.",
    );
  }
  return version;
}

function syntheticAgentSourceContext(input: {
  agentVersionId: string;
  sourceId: string;
  sourceType: "manual_text" | "media_asset" | "web_url";
  title: string;
  content: string;
}): AiCourseContext | null {
  const title = sanitizeAiReferenceText(input.title, 220);
  const excerpt = sanitizeAiReferenceText(input.content, 1_600);
  if (!title || !excerpt) return null;
  const syntheticId = `agent-source:${input.sourceId}`;
  return {
    id: syntheticId,
    versionId: input.agentVersionId,
    title,
    slug: "agent-source",
    shortDescription: excerpt.slice(0, 600),
    difficulty: "Kuratierte Wissensquelle",
    estimatedMinutes: 0,
    progress: 0,
    sources: [
      {
        id: syntheticId,
        courseId: syntheticId,
        lessonId: syntheticId,
        pageId: null,
        courseTitle: title,
        lessonTitle:
          input.sourceType === "media_asset"
            ? "Geprueftes Dokument"
            : input.sourceType === "web_url"
              ? "Gespeicherter Web-Snapshot"
              : "Manuelle Wissensquelle",
        pageTitle: null,
        title,
        excerpt,
        href: "/academy/ai",
      },
    ],
  };
}

export async function getAiAgentVersionKnowledgeContext(input: {
  executor?: AiReader;
  organizationId: string;
  userId: string;
  agentId: string;
  agentVersionId: string;
  lockAccessRows?: boolean;
}) {
  const executor = input.executor ?? db;
  const [version, accessibleCourses, sourceRows] = await Promise.all([
    requirePublishedAiAgentVersion({
      executor,
      organizationId: input.organizationId,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
    }),
    getAccessibleAiCourseContext(
      input.organizationId,
      input.userId,
      executor,
      input.lockAccessRows,
    ),
    executor
      .select({
        id: aiAgentVersionSources.id,
        sourceType: aiAgentVersionSources.sourceType,
        courseId: aiAgentVersionSources.courseId,
        courseVersionId: aiAgentVersionSources.courseVersionId,
        mediaAssetId: aiAgentVersionSources.mediaAssetId,
        title: aiAgentVersionSources.title,
        content: aiAgentVersionSources.content,
        contentDigest: aiAgentVersionSources.contentDigest,
        mediaStatus: mediaAssets.status,
        mediaDeletedAt: mediaAssets.deletedAt,
        mediaContentDigest: mediaAssets.contentSha256,
      })
      .from(aiAgentVersionSources)
      .leftJoin(
        mediaAssets,
        and(
          eq(mediaAssets.id, aiAgentVersionSources.mediaAssetId),
          eq(
            mediaAssets.organizationId,
            aiAgentVersionSources.organizationId,
          ),
        ),
      )
      .where(
        and(
          eq(
            aiAgentVersionSources.organizationId,
            input.organizationId,
          ),
          eq(aiAgentVersionSources.agentVersionId, input.agentVersionId),
        ),
      )
      .orderBy(
        asc(aiAgentVersionSources.sortOrder),
        asc(aiAgentVersionSources.id),
      ),
  ]);

  const selectedCourseVersions = new Map(
    sourceRows.flatMap((source) =>
      source.sourceType === "course_version" &&
      source.courseId &&
      source.courseVersionId
        ? [[source.courseId, source.courseVersionId] as const]
        : [],
    ),
  );
  const courseContext =
    version.knowledgeMode === "all_accessible_courses"
      ? accessibleCourses
      : accessibleCourses.filter(
          (course) =>
            selectedCourseVersions.get(course.id) === course.versionId,
        );
  const curatedContext = sourceRows.flatMap((source) => {
    if (source.sourceType === "course_version") return [];
    if (
      source.sourceType === "media_asset" &&
      (source.mediaStatus !== "ready" ||
        source.mediaDeletedAt ||
        source.mediaContentDigest !== source.contentDigest)
    ) {
      return [];
    }
    if (!source.title || !source.content) return [];
    const context = syntheticAgentSourceContext({
      agentVersionId: version.id,
      sourceId: source.id,
      sourceType: source.sourceType,
      title: source.title,
      content: source.content,
    });
    return context ? [context] : [];
  });
  return {
    version,
    courses: [...courseContext, ...curatedContext],
    courseIds: courseContext.map((course) => course.id),
  };
}

function conversationTitle(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  const characters = Array.from(compact);
  return characters.length <= 72 ? compact : `${characters.slice(0, 69).join("").trimEnd()}...`;
}

async function assertAiAvailableDuringExam(
  reader: AiReader,
  input: { organizationId: string; userId: string },
) {
  const lock = await getActiveExamContentLock(reader, input);
  if (lock) {
    throw new ApiError(
      409,
      "conflict",
      "Der Q-Coach ist waehrend dieser laufenden Pruefung gesperrt.",
      { reason: "active_exam" },
    );
  }
}

export async function sendAiConversationMessage(input: {
  organizationId: string;
  conversationId: string;
  content: string;
  metadata?: Record<string, unknown>;
}) {
  const content = input.content.trim();
  if (!content || content.length > 50_000) {
    throw new ApiError(422, "validation_error", "Die Nachricht muss zwischen 1 und 50000 Zeichen enthalten.");
  }

  const conversation = await requireAiConversation({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
  });
  if (conversation.status !== "active") {
    throw new ApiError(409, "conflict", "Archivierte Konversationen koennen nicht fortgesetzt werden.");
  }
  const [, member, knowledge] = await Promise.all([
    requireAccessiblePublishedAiAgent({
      organizationId: input.organizationId,
      userId: conversation.userId,
      agentId: conversation.agentId,
    }),
    requireAiMember(input.organizationId, conversation.userId),
    assertAiAvailableDuringExam(db, {
      organizationId: input.organizationId,
      userId: conversation.userId,
    }).then(() =>
      getAiAgentVersionKnowledgeContext({
        organizationId: input.organizationId,
        userId: conversation.userId,
        agentId: conversation.agentId,
        agentVersionId: conversation.agentVersionId,
      }),
    ),
  ]);
  await requireAiTransparencyAcknowledgement({
    organizationId: input.organizationId,
    userId: conversation.userId,
  });
  const courseContext = knowledge.courses;
  const [history, memberProfile] = await Promise.all([
    recentAiMessages(
      input.organizationId,
      conversation.id,
      courseContext,
    ),
    getAiMemberProfileContext({
      organizationId: input.organizationId,
      userId: conversation.userId,
      fieldIds: knowledge.version.profileFieldIds,
    }),
  ]);

  await reserveAiAgentCredit({
    organizationId: input.organizationId,
    userId: conversation.userId,
  });

  const completion = await completeAiMessage({
    agentType: knowledge.version.type,
    agentName: knowledge.version.name,
    agentSystemPrompt: appendAiAgentAdditionalPrompts(
      knowledge.version.systemPrompt,
      knowledge.version.additionalPrompts,
    ),
    userFirstName: member.firstName,
    message: content,
    history,
    courses: courseContext,
    memberProfile,
  });

  return db.transaction(async (transaction) => {
    const [locked] = await transaction
      .select()
      .from(aiConversations)
      .where(
        and(
          eq(aiConversations.id, conversation.id),
          eq(aiConversations.organizationId, input.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!locked) throw new ApiError(404, "not_found", "Konversation nicht gefunden.");
    if (locked.status !== "active") {
      throw new ApiError(409, "conflict", "Archivierte Konversationen koennen nicht fortgesetzt werden.");
    }
    await requireAccessiblePublishedAiAgent({
      executor: transaction,
      organizationId: input.organizationId,
      userId: locked.userId,
      agentId: locked.agentId,
    });

    for (const courseId of [...new Set(knowledge.courseIds)].sort()) {
      await lockMemberCourseProgress(transaction, {
        organizationId: input.organizationId,
        userId: locked.userId,
        courseId,
      });
    }
    const [currentMember] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, locked.userId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!currentMember) {
      throw new ApiError(404, "not_found", "Mitglied nicht gefunden oder nicht aktiv.");
    }
    await assertAiAvailableDuringExam(transaction, {
      organizationId: input.organizationId,
      userId: locked.userId,
    });
    const currentKnowledge = await getAiAgentVersionKnowledgeContext({
      executor: transaction,
      organizationId: input.organizationId,
      userId: locked.userId,
      agentId: locked.agentId,
      agentVersionId: locked.agentVersionId,
      lockAccessRows: true,
    });
    if (!groundingIsCurrent(completion.metadata, currentKnowledge.courses)) {
      throw new ApiError(
        409,
        "conflict",
        "Die Lernfreigaben haben sich waehrend der Antwort geaendert. Bitte sende die Nachricht erneut.",
      );
    }

    const userMessageAt = new Date();
    const assistantMessageAt = new Date(userMessageAt.getTime() + 1);
    const [userMessage] = await transaction
      .insert(aiMessages)
      .values({
        organizationId: input.organizationId,
        conversationId: locked.id,
        role: "user",
        content,
        metadata: input.metadata ?? {},
        createdAt: userMessageAt,
      })
      .returning();
    const [assistantMessage] = await transaction
      .insert(aiMessages)
      .values({
        organizationId: input.organizationId,
        conversationId: locked.id,
        role: "assistant",
        content: completion.content,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        latencyMs: completion.latencyMs,
        provider: completion.provider,
        model: completion.model,
        citations: completion.citations,
        metadata: {
          ...completion.metadata,
          agentVersionId: locked.agentVersionId,
          agentVersion: currentKnowledge.version.version,
        },
        createdAt: assistantMessageAt,
      })
      .returning();
    const [updatedConversation] = await transaction
      .update(aiConversations)
      .set({
        title: locked.title ?? conversationTitle(content),
        messageCount: sql`${aiConversations.messageCount} + 2`,
        lastMessageAt: assistantMessageAt,
        updatedAt: assistantMessageAt,
      })
      .where(
        and(
          eq(aiConversations.id, locked.id),
          eq(aiConversations.organizationId, input.organizationId),
        ),
      )
      .returning();
    if (!userMessage || !assistantMessage || !updatedConversation) {
      throw new ApiError(500, "internal_error", "Die KI-Antwort konnte nicht gespeichert werden.");
    }
    return {
      conversation: updatedConversation,
      userMessage,
      assistantMessage,
      suggestions: completion.suggestions,
    };
  });
}
