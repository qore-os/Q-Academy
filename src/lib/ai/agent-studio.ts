import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  aiAgents,
  aiAgentVersionActions,
  aiAgentVersionAccessGrants,
  aiAgentVersionSources,
  aiAgentVersions,
  apiKeys,
  bundles,
  courses,
  customFieldDefinitions,
  enrollments,
  groupBundles,
  groupMembers,
  groups,
  mediaAssets,
  memberBundles,
  users,
  type User,
} from "@/db/schema";
import {
  buildAiCourseContext,
  rankAiCourseContext,
  sanitizeAiReferenceText,
  type AiCourseContext,
} from "@/lib/ai/grounding";
import { getAiAgentPolicy } from "@/lib/ai/agent-policy";
import {
  sanitizeAiAgentDraftPreviewOutput,
  sanitizeAiAgentDraftPreviewProviderText,
  sanitizeAiAgentDraftPreviewSourceText,
} from "@/lib/ai/agent-preview-security";
import {
  completeAiMessage,
  type AiCompletionResult,
} from "@/lib/ai/provider";
import {
  appendAiAgentAdditionalPrompts,
  getAiMemberProfileContext,
} from "@/lib/ai/member-profile-context";
import {
  aiAgentDraftDigest,
  aiAgentDraftUpdateSchema,
  aiAgentPublishSchema,
  aiAgentRollbackSchema,
  type AiAgentAccessGrantInput,
  type AiAgentActionInput,
  type AiAgentSourceInput,
} from "@/lib/ai/agent-studio-model";
import {
  fetchWebKnowledgeSnapshot,
  type WebKnowledgeSnapshot,
} from "@/lib/ai/web-knowledge-source.server";
import {
  AiDocumentKnowledgeSourceError,
  extractDocumentKnowledgeSnapshot,
  type DocumentKnowledgeSnapshot,
} from "@/lib/ai/document-knowledge-source.server";
import { ApiError } from "@/lib/api/errors";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { privacySubjectReference } from "@/lib/privacy/subject-reference";

type AgentExecutor = Pick<typeof db, "select">;

const PREVIEW_MAX_PROVIDER_COURSES = 8;
const PREVIEW_MAX_PROVIDER_SOURCES = 8;

export { sanitizeAiAgentDraftPreviewOutput } from "@/lib/ai/agent-preview-security";

const aiAgentDraftPreviewSchema = z
  .object({
    expectedDraftVersionId: z.string().uuid(),
    expectedDraftRevision: z.number().int().positive(),
    memberId: z.string().uuid(),
    message: z
      .string()
      .trim()
      .min(1, "Bitte gib eine kurze Testfrage ein.")
      .max(600, "Die Testfrage darf hoechstens 600 Zeichen lang sein."),
  })
  .strict();

export type AiAgentActor = Readonly<{
  id: string;
  organizationId: string;
  role: User["role"];
}>;

export async function requireAiApiAdminActor(input: {
  organizationId: string;
  apiKeyId: string;
}): Promise<AiAgentActor> {
  const [actor] = await db
    .select({ id: users.id, role: users.role })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!actor || !isOrganizationAdmin(actor.role)) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel muss einem aktiven Owner oder Admin gehoeren.",
    );
  }
  return {
    id: actor.id,
    organizationId: input.organizationId,
    role: actor.role,
  };
}

type AccessSnapshot = {
  member: {
    id: string;
    role: User["role"];
  };
  groupIds: Set<string>;
  bundleIds: Set<string>;
};

function isOrganizationAdmin(role: User["role"]) {
  return role === "owner" || role === "admin";
}

async function requireOrganizationAdminActor(
  executor: AgentExecutor,
  actor: AiAgentActor,
) {
  const [row] = await executor
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, actor.id),
        eq(users.organizationId, actor.organizationId),
        eq(users.status, "active"),
        eq(users.role, actor.role),
      ),
    )
    .limit(1);
  if (!row || !isOrganizationAdmin(row.role)) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Administratoren duerfen KI-Agenten veroeffentlichen.",
    );
  }
  return row;
}

async function accessSnapshot(
  executor: AgentExecutor,
  organizationId: string,
  userId: string,
): Promise<AccessSnapshot> {
  const [member] = await executor
    .select({
      id: users.id,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!member) {
    throw new ApiError(
      404,
      "not_found",
      "Mitglied nicht gefunden oder nicht aktiv.",
    );
  }

  const [memberGroupRows, directBundleRows, groupBundleRows] =
    await Promise.all([
      executor
        .select({ id: groups.id })
        .from(groupMembers)
        .innerJoin(
          groups,
          and(
            eq(groups.id, groupMembers.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .where(eq(groupMembers.userId, userId)),
      executor
        .select({ id: bundles.id })
        .from(memberBundles)
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, memberBundles.bundleId),
            eq(bundles.organizationId, organizationId),
            eq(bundles.active, true),
          ),
        )
        .where(eq(memberBundles.userId, userId)),
      executor
        .select({ id: bundles.id })
        .from(groupMembers)
        .innerJoin(
          groups,
          and(
            eq(groups.id, groupMembers.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .innerJoin(groupBundles, eq(groupBundles.groupId, groups.id))
        .innerJoin(
          bundles,
          and(
            eq(bundles.id, groupBundles.bundleId),
            eq(bundles.organizationId, organizationId),
            eq(bundles.active, true),
          ),
        )
        .where(eq(groupMembers.userId, userId)),
    ]);

  return {
    member,
    groupIds: new Set(memberGroupRows.map((row) => row.id)),
    bundleIds: new Set(
      [...directBundleRows, ...groupBundleRows].map((row) => row.id),
    ),
  };
}

function grantMatches(
  snapshot: AccessSnapshot,
  grant: {
    subjectType: "role" | "user" | "group" | "bundle";
    subjectRole: User["role"] | null;
    subjectUserId: string | null;
    subjectGroupId: string | null;
    subjectBundleId: string | null;
  },
) {
  switch (grant.subjectType) {
    case "role":
      return grant.subjectRole === snapshot.member.role;
    case "user":
      return grant.subjectUserId === snapshot.member.id;
    case "group":
      return Boolean(
        grant.subjectGroupId && snapshot.groupIds.has(grant.subjectGroupId),
      );
    case "bundle":
      return Boolean(
        grant.subjectBundleId &&
          snapshot.bundleIds.has(grant.subjectBundleId),
      );
  }
}

function draftAccessAllowed(
  snapshot: AccessSnapshot,
  accessMode: "open" | "restricted",
  grants: Array<{
    subjectType: "role" | "user" | "group" | "bundle";
    subjectRole: User["role"] | null;
    subjectUserId: string | null;
    subjectGroupId: string | null;
    subjectBundleId: string | null;
  }>,
) {
  return (
    accessMode === "open" ||
    isOrganizationAdmin(snapshot.member.role) ||
    grants.some((grant) => grantMatches(snapshot, grant))
  );
}

async function accessibleDraftCourseContexts(input: {
  executor: AgentExecutor;
  organizationId: string;
  userId: string;
  courseIds?: readonly string[];
}) {
  if (input.courseIds && input.courseIds.length === 0) return [];
  const rows = await input.executor
    .select({
      courseId: courses.id,
      progress: enrollments.progress,
    })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, input.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .innerJoin(
      users,
      and(
        eq(users.id, enrollments.userId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(enrollments.userId, input.userId),
        eq(enrollments.accessActive, true),
        input.courseIds
          ? inArray(courses.id, [...input.courseIds])
          : undefined,
      ),
    );
  const uniqueRows = [
    ...new Map(rows.map((row) => [row.courseId, row])).values(),
  ];
  const resolved: Array<{
    progress: number;
    access: NonNullable<Awaited<ReturnType<typeof getCourseLearningAccess>>>;
  }> = [];
  for (const row of uniqueRows) {
    const access = await getCourseLearningAccess(input.executor, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: row.courseId,
    });
    if (access) resolved.push({ progress: row.progress, access });
  }
  const globalBudget = { used: 0 };
  return resolved
    .sort((left, right) =>
      left.access.published.snapshot.course.title.localeCompare(
        right.access.published.snapshot.course.title,
        "de-DE",
      ),
    )
    .map(({ access, progress }) =>
      buildAiCourseContext(access, progress, globalBudget),
    );
}

function curatedDraftPreviewContext(input: {
  sequence: number;
  sourceType: "manual_text" | "media_asset" | "web_url";
  title: string;
  content: string;
}): AiCourseContext | null {
  const title = sanitizeAiReferenceText(input.title, 220);
  const excerpt = sanitizeAiAgentDraftPreviewSourceText(input.content);
  if (!title || !excerpt) return null;
  const syntheticId = `agent-preview-source-${input.sequence}`;
  return {
    id: syntheticId,
    versionId: "agent-draft-preview",
    title,
    slug: "agent-draft-preview",
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

function privacySafeDraftPreviewCourses(
  message: string,
  courses: readonly AiCourseContext[],
) {
  const ranked = rankAiCourseContext(message, [...courses]);
  const rankedCourses = ranked.courses.filter(
    (course) => course.sources.length > 0,
  );
  const selectedCourses = (
    rankedCourses.length > 0
      ? rankedCourses
      : courses.slice(0, PREVIEW_MAX_PROVIDER_COURSES).map((course) => ({
          ...course,
          sources: [],
        }))
  ).slice(0, PREVIEW_MAX_PROVIDER_COURSES);

  let sourceSequence = 0;
  return selectedCourses.map((course, courseIndex) => {
    const courseReference = `preview-course-${courseIndex + 1}`;
    const sources = course.sources.flatMap((source) => {
      if (sourceSequence >= PREVIEW_MAX_PROVIDER_SOURCES) return [];
      sourceSequence += 1;
      const sourceReference = `preview-source-${sourceSequence}`;
      return [
        {
          id: sourceReference,
          courseId: courseReference,
          lessonId: `preview-unit-${sourceSequence}`,
          pageId: null,
          courseTitle:
            sanitizeAiAgentDraftPreviewProviderText(course.title, 220) ||
            "Vorschaukurs",
          lessonTitle:
            sanitizeAiAgentDraftPreviewProviderText(source.lessonTitle, 220) ||
            "Vorschauinhalt",
          pageTitle: source.pageTitle
            ? sanitizeAiAgentDraftPreviewProviderText(source.pageTitle, 220) ||
              null
            : null,
          title:
            sanitizeAiAgentDraftPreviewProviderText(source.title, 220) ||
            "Vorschauinhalt",
          excerpt: sanitizeAiAgentDraftPreviewProviderText(
            source.excerpt,
            1_600,
          ),
          href: "",
        },
      ];
    });
    return {
      id: courseReference,
      versionId: "preview-version",
      title:
        sanitizeAiAgentDraftPreviewProviderText(course.title, 220) ||
        "Vorschaukurs",
      slug: "preview-course",
      shortDescription: sanitizeAiAgentDraftPreviewProviderText(
        course.shortDescription,
        600,
      ),
      difficulty: sanitizeAiAgentDraftPreviewProviderText(
        course.difficulty,
        80,
      ),
      estimatedMinutes: Math.max(0, Math.trunc(course.estimatedMinutes)),
      progress: 0,
      sources,
    } satisfies AiCourseContext;
  });
}

function draftPreviewProviderInput(input: {
  draft: typeof aiAgentVersions.$inferSelect;
  message: string;
  courses: readonly AiCourseContext[];
  memberProfile: ReadonlyArray<{ label: string; value: string }>;
}) {
  const agentName =
    sanitizeAiAgentDraftPreviewProviderText(input.draft.name, 160) ||
    "Vorschau-Agent";
  const agentSystemPrompt =
    sanitizeAiAgentDraftPreviewProviderText(
      input.draft.systemPrompt.slice(0, 4_000),
      4_000,
    ) ||
    "Hilf beim Verstehen und Anwenden der Lerninhalte.";
  const courses = privacySafeDraftPreviewCourses(input.message, input.courses);
  const memberProfile = input.memberProfile.slice(0, 25).flatMap((entry) => {
    const label = sanitizeAiAgentDraftPreviewProviderText(entry.label, 160);
    const value = sanitizeAiAgentDraftPreviewProviderText(entry.value, 300);
    return label && value ? [{ label, value }] : [];
  });
  const configuredSystemPrompt = appendAiAgentAdditionalPrompts(
    agentSystemPrompt,
    input.draft.additionalPrompts,
  );
  return {
    agentName,
    agentSystemPrompt: configuredSystemPrompt,
    userFirstName: "Testmitglied",
    courses,
    memberProfile,
    protectedValues: [
      configuredSystemPrompt,
      ...memberProfile.map((entry) => entry.value),
      ...courses.flatMap((course) =>
        course.sources.flatMap((source) =>
          source.excerpt ? [source.excerpt] : [],
        ),
      ),
    ],
  };
}

async function currentPublishedAgentRows(
  executor: AgentExecutor,
  organizationId: string,
  agentId?: string,
) {
  return executor
    .select({
      agentId: aiAgents.id,
      active: aiAgents.active,
      publishedVersionId: aiAgents.publishedVersionId,
      versionId: aiAgentVersions.id,
      version: aiAgentVersions.version,
      type: aiAgentVersions.type,
      name: aiAgentVersions.name,
      description: aiAgentVersions.description,
      systemPrompt: aiAgentVersions.systemPrompt,
      color: aiAgentVersions.color,
      icon: aiAgentVersions.icon,
      knowledgeMode: aiAgentVersions.knowledgeMode,
      accessMode: aiAgentVersions.accessMode,
      publishedAt: aiAgentVersions.publishedAt,
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
        eq(aiAgents.organizationId, organizationId),
        eq(aiAgents.active, true),
        agentId ? eq(aiAgents.id, agentId) : undefined,
      ),
    )
    .orderBy(asc(aiAgentVersions.name), asc(aiAgents.id));
}

export async function listAccessiblePublishedAiAgents(input: {
  executor?: AgentExecutor;
  organizationId: string;
  userId: string;
}) {
  const executor = input.executor ?? db;
  const [snapshot, agentRows] = await Promise.all([
    accessSnapshot(executor, input.organizationId, input.userId),
    currentPublishedAgentRows(executor, input.organizationId),
  ]);
  if (agentRows.length === 0) return [];
  if (isOrganizationAdmin(snapshot.member.role)) return agentRows;

  const restrictedVersionIds = agentRows
    .filter((row) => row.accessMode === "restricted")
    .map((row) => row.versionId);
  const grants = restrictedVersionIds.length
    ? await executor
        .select({
          agentVersionId: aiAgentVersionAccessGrants.agentVersionId,
          subjectType: aiAgentVersionAccessGrants.subjectType,
          subjectRole: aiAgentVersionAccessGrants.subjectRole,
          subjectUserId: aiAgentVersionAccessGrants.subjectUserId,
          subjectGroupId: aiAgentVersionAccessGrants.subjectGroupId,
          subjectBundleId: aiAgentVersionAccessGrants.subjectBundleId,
        })
        .from(aiAgentVersionAccessGrants)
        .where(
          and(
            eq(
              aiAgentVersionAccessGrants.organizationId,
              input.organizationId,
            ),
            inArray(
              aiAgentVersionAccessGrants.agentVersionId,
              restrictedVersionIds,
            ),
          ),
        )
    : [];
  const accessibleRestrictedVersions = new Set(
    grants
      .filter((grant) => grantMatches(snapshot, grant))
      .map((grant) => grant.agentVersionId),
  );
  return agentRows.filter(
    (row) =>
      row.accessMode === "open" ||
      accessibleRestrictedVersions.has(row.versionId),
  );
}

export async function requireAccessiblePublishedAiAgent(input: {
  executor?: AgentExecutor;
  organizationId: string;
  userId: string;
  agentId: string;
}) {
  const rows = await listAccessiblePublishedAiAgents(input);
  const agent = rows.find((row) => row.agentId === input.agentId);
  if (!agent) {
    throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
  }
  return agent;
}

export async function getDefaultAccessiblePublishedAiAgent(input: {
  executor?: AgentExecutor;
  organizationId: string;
  userId: string;
}) {
  const rows = await listAccessiblePublishedAiAgents(input);
  const preferred = rows.find((row) => row.name === "Q-Coach") ?? rows[0];
  if (!preferred) {
    throw new ApiError(
      404,
      "not_found",
      "Fuer dieses Mitglied ist kein aktiver KI-Agent freigegeben.",
    );
  }
  return preferred;
}

function sourceInputFromRow(row: {
  sourceType: "course_version" | "manual_text" | "media_asset" | "web_url";
  courseId: string | null;
  mediaAssetId: string | null;
  title: string | null;
  content: string | null;
  sourceUrl: string | null;
}): AiAgentSourceInput {
  switch (row.sourceType) {
    case "course_version":
      return { sourceType: "course_version", courseId: row.courseId! };
    case "manual_text":
      return {
        sourceType: "manual_text",
        title: row.title!,
        content: row.content!,
      };
    case "media_asset":
      return {
        sourceType: "media_asset",
        mediaAssetId: row.mediaAssetId!,
      };
    case "web_url":
      return { sourceType: "web_url", url: row.sourceUrl! };
  }
}

function grantInputFromRow(row: {
  subjectType: "role" | "user" | "group" | "bundle";
  subjectRole: User["role"] | null;
  subjectUserId: string | null;
  subjectGroupId: string | null;
  subjectBundleId: string | null;
}): AiAgentAccessGrantInput {
  switch (row.subjectType) {
    case "role":
      return { subjectType: "role", subjectRole: row.subjectRole! };
    case "user":
      return { subjectType: "user", subjectUserId: row.subjectUserId! };
    case "group":
      return { subjectType: "group", subjectGroupId: row.subjectGroupId! };
    case "bundle":
      return { subjectType: "bundle", subjectBundleId: row.subjectBundleId! };
  }
}

function actionInputFromRow(
  row: Pick<
    typeof aiAgentVersionActions.$inferSelect,
    | "actionType"
    | "courseId"
    | "groupId"
    | "bundleId"
    | "label"
    | "description"
  >,
): AiAgentActionInput {
  const common = { label: row.label, description: row.description };
  switch (row.actionType) {
    case "course_enrollment":
    case "course_unenrollment":
      return { ...common, actionType: row.actionType, courseId: row.courseId! };
    case "group_membership_add":
    case "group_membership_remove":
      return { ...common, actionType: row.actionType, groupId: row.groupId! };
    case "bundle_assignment_add":
    case "bundle_assignment_remove":
      return { ...common, actionType: row.actionType, bundleId: row.bundleId! };
  }
}

async function validatedSourceRows(
  executor: AgentExecutor,
  organizationId: string,
  sources: readonly AiAgentSourceInput[],
  webSnapshots: ReadonlyMap<string, WebKnowledgeSnapshot> = new Map(),
  documentSnapshots: ReadonlyMap<string, DocumentKnowledgeSnapshot> = new Map(),
) {
  const courseIds = sources.flatMap((source) =>
    source.sourceType === "course_version" ? [source.courseId] : [],
  );
  const mediaIds = sources.flatMap((source) =>
    source.sourceType === "media_asset" ? [source.mediaAssetId] : [],
  );
  const [courseRows, mediaRows] = await Promise.all([
    courseIds.length
      ? executor
          .select({
            id: courses.id,
            publishedVersionId: courses.publishedVersionId,
          })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, organizationId),
              eq(courses.status, "published"),
              inArray(courses.id, courseIds),
              sql`${courses.publishedVersionId} is not null`,
            ),
          )
      : Promise.resolve([]),
    mediaIds.length
      ? executor
          .select({
            id: mediaAssets.id,
            contentSha256: mediaAssets.contentSha256,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.organizationId, organizationId),
              eq(mediaAssets.status, "ready"),
              isNull(mediaAssets.deletedAt),
              inArray(mediaAssets.id, mediaIds),
            ),
          )
          .for("share")
      : Promise.resolve([]),
  ]);
  if (
    courseRows.length !== new Set(courseIds).size ||
    mediaRows.length !== new Set(mediaIds).size
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Mindestens eine Wissensquelle ist nicht veroeffentlicht, nicht geprueft oder mandantenfremd.",
    );
  }
  const courseVersionsById = new Map(
    courseRows.map((row) => [row.id, row.publishedVersionId!]),
  );
  const mediaDigestsById = new Map(
    mediaRows.map((row) => [row.id, row.contentSha256]),
  );
  return sources.map((source, sortOrder) => {
    switch (source.sourceType) {
      case "course_version":
        return {
          organizationId,
          sourceType: source.sourceType,
          courseId: source.courseId,
          courseVersionId: courseVersionsById.get(source.courseId)!,
          sortOrder,
        } as const;
      case "manual_text":
        return {
          organizationId,
          sourceType: source.sourceType,
          title: source.title,
          content: source.content,
          sortOrder,
        } as const;
      case "media_asset":
        const documentSnapshot = documentSnapshots.get(source.mediaAssetId);
        if (
          !documentSnapshot ||
          mediaDigestsById.get(source.mediaAssetId) !==
            documentSnapshot.contentDigest
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der extrahierte Dokument-Snapshot ist nicht mehr gueltig.",
          );
        }
        return {
          organizationId,
          sourceType: source.sourceType,
          mediaAssetId: source.mediaAssetId,
          title: documentSnapshot.title,
          content: documentSnapshot.content,
          contentDigest: documentSnapshot.contentDigest,
          fetchedAt: documentSnapshot.extractedAt,
          sortOrder,
        } as const;
      case "web_url": {
        const snapshot = webSnapshots.get(source.url);
        if (!snapshot) {
          throw new ApiError(
            409,
            "conflict",
            "Der gespeicherte Webquellen-Snapshot ist nicht mehr gueltig.",
          );
        }
        return {
          organizationId,
          sourceType: source.sourceType,
          title: snapshot.title,
          content: snapshot.content,
          sourceUrl: snapshot.sourceUrl,
          contentDigest: snapshot.contentDigest,
          fetchedAt: snapshot.fetchedAt,
          sortOrder,
        } as const;
      }
    }
  });
}

async function snapshotWebSources(
  sources: readonly AiAgentSourceInput[],
  fetchSnapshot: typeof fetchWebKnowledgeSnapshot,
) {
  const webSources = sources.filter(
    (source): source is Extract<AiAgentSourceInput, { sourceType: "web_url" }> =>
      source.sourceType === "web_url",
  );
  const snapshots = await Promise.all(
    webSources.map(async (source) => ({
      source,
      snapshot: await fetchSnapshot(source.url),
    })),
  );
  for (const { source, snapshot } of snapshots) {
    if (snapshot.sourceUrl !== source.url) {
      throw new ApiError(
        422,
        "validation_error",
        "Der Webquellen-Snapshot stimmt nicht mit der konfigurierten URL ueberein.",
      );
    }
  }
  return new Map(
    snapshots.map(({ source, snapshot }) => [source.url, snapshot]),
  );
}

async function snapshotDocumentSources(
  organizationId: string,
  sources: readonly AiAgentSourceInput[],
  extractSnapshot: typeof extractDocumentKnowledgeSnapshot,
) {
  const snapshots = new Map<string, DocumentKnowledgeSnapshot>();
  for (const source of sources) {
    if (source.sourceType !== "media_asset") continue;
    try {
      const snapshot = await extractSnapshot({
        organizationId,
        mediaAssetId: source.mediaAssetId,
      });
      if (snapshot.mediaAssetId !== source.mediaAssetId) {
        throw new AiDocumentKnowledgeSourceError(
          "Die extrahierte Dokumentquelle passt nicht zum ausgewaehlten Asset.",
        );
      }
      snapshots.set(source.mediaAssetId, snapshot);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        422,
        "validation_error",
        error instanceof AiDocumentKnowledgeSourceError
          ? error.message
          : "Die Dokumentquelle konnte nicht sicher extrahiert werden.",
      );
    }
  }
  return snapshots;
}

function storedWebSnapshots(
  rows: readonly (typeof aiAgentVersionSources.$inferSelect)[],
) {
  const snapshots = new Map<string, WebKnowledgeSnapshot>();
  for (const row of rows) {
    if (row.sourceType !== "web_url") continue;
    if (
      !row.sourceUrl ||
      !row.title ||
      !row.content ||
      !row.contentDigest ||
      !row.fetchedAt
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Der gespeicherte Webquellen-Snapshot ist unvollstaendig.",
      );
    }
    const digest = createHash("sha256").update(row.content, "utf8").digest("hex");
    if (digest !== row.contentDigest) {
      throw new ApiError(
        409,
        "conflict",
        "Der gespeicherte Webquellen-Snapshot hat seine Integritaetspruefung nicht bestanden.",
      );
    }
    snapshots.set(row.sourceUrl, {
      sourceUrl: row.sourceUrl,
      title: row.title,
      content: row.content,
      contentDigest: row.contentDigest,
      fetchedAt: row.fetchedAt,
    });
  }
  return snapshots;
}

async function validateGrantTargets(
  executor: AgentExecutor,
  organizationId: string,
  grants: readonly AiAgentAccessGrantInput[],
) {
  const userIds = grants.flatMap((grant) =>
    grant.subjectType === "user" ? [grant.subjectUserId] : [],
  );
  const groupIds = grants.flatMap((grant) =>
    grant.subjectType === "group" ? [grant.subjectGroupId] : [],
  );
  const bundleIds = grants.flatMap((grant) =>
    grant.subjectType === "bundle" ? [grant.subjectBundleId] : [],
  );
  const [userRows, groupRows, bundleRows] = await Promise.all([
    userIds.length
      ? executor
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.organizationId, organizationId),
              eq(users.status, "active"),
              inArray(users.id, userIds),
            ),
          )
      : Promise.resolve([]),
    groupIds.length
      ? executor
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, organizationId),
              inArray(groups.id, groupIds),
            ),
          )
      : Promise.resolve([]),
    bundleIds.length
      ? executor
          .select({ id: bundles.id })
          .from(bundles)
          .where(
            and(
              eq(bundles.organizationId, organizationId),
              eq(bundles.active, true),
              inArray(bundles.id, bundleIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  if (
    userRows.length !== new Set(userIds).size ||
    groupRows.length !== new Set(groupIds).size ||
    bundleRows.length !== new Set(bundleIds).size
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Mindestens eine Agenten-Zielgruppe ist ungueltig, inaktiv oder mandantenfremd.",
    );
  }
}

async function validateActionTargets(
  executor: AgentExecutor,
  organizationId: string,
  actions: readonly AiAgentActionInput[],
) {
  const courseIds = [
    ...new Set(
      actions.flatMap((action) =>
        action.actionType === "course_enrollment" ||
        action.actionType === "course_unenrollment"
          ? [action.courseId]
          : [],
      ),
    ),
  ];
  const groupIds = [
    ...new Set(
      actions.flatMap((action) =>
        action.actionType === "group_membership_add" ||
        action.actionType === "group_membership_remove"
          ? [action.groupId]
          : [],
      ),
    ),
  ];
  const bundleIds = [
    ...new Set(
      actions.flatMap((action) =>
        action.actionType === "bundle_assignment_add" ||
        action.actionType === "bundle_assignment_remove"
          ? [action.bundleId]
          : [],
      ),
    ),
  ];
  const [courseRows, groupRows, bundleRows] = await Promise.all([
    courseIds.length
      ? executor
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.organizationId, organizationId),
              eq(courses.status, "published"),
              sql`${courses.publishedVersionId} is not null`,
              inArray(courses.id, courseIds),
            ),
          )
      : Promise.resolve([]),
    groupIds.length
      ? executor
          .select({ id: groups.id })
          .from(groups)
          .where(
            and(
              eq(groups.organizationId, organizationId),
              inArray(groups.id, groupIds),
            ),
          )
      : Promise.resolve([]),
    bundleIds.length
      ? executor
          .select({ id: bundles.id })
          .from(bundles)
          .where(
            and(
              eq(bundles.organizationId, organizationId),
              eq(bundles.active, true),
              inArray(bundles.id, bundleIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  if (
    courseRows.length !== courseIds.length ||
    groupRows.length !== groupIds.length ||
    bundleRows.length !== bundleIds.length
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Mindestens ein Aktionsziel ist inaktiv, nicht veroeffentlicht oder mandantenfremd.",
    );
  }
}

async function validateProfileFieldTargets(
  executor: AgentExecutor,
  organizationId: string,
  profileFieldIds: readonly string[],
) {
  if (!profileFieldIds.length) return;
  const rows = await executor
    .select({
      id: customFieldDefinitions.id,
      visibility: customFieldDefinitions.visibility,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, organizationId),
        eq(customFieldDefinitions.active, true),
        inArray(customFieldDefinitions.id, [...profileFieldIds]),
      ),
    );
  if (
    rows.length !== profileFieldIds.length ||
    rows.some((row) => row.visibility !== "member")
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Nur aktive, fuer das Mitglied sichtbare Profilfelder duerfen einen Agenten personalisieren.",
    );
  }
}

function actionInsertRow(
  organizationId: string,
  agentVersionId: string,
  action: AiAgentActionInput,
  sortOrder: number,
) {
  return {
    organizationId,
    agentVersionId,
    actionType: action.actionType,
    targetType:
      action.actionType === "course_enrollment" ||
      action.actionType === "course_unenrollment"
        ? ("course" as const)
        : action.actionType === "group_membership_add" ||
            action.actionType === "group_membership_remove"
          ? ("group" as const)
          : ("bundle" as const),
    courseId:
      action.actionType === "course_enrollment" ||
      action.actionType === "course_unenrollment"
        ? action.courseId
        : null,
    groupId:
      action.actionType === "group_membership_add" ||
      action.actionType === "group_membership_remove"
        ? action.groupId
        : null,
    bundleId:
      action.actionType === "bundle_assignment_add" ||
      action.actionType === "bundle_assignment_remove"
        ? action.bundleId
        : null,
    label: action.label,
    description: action.description,
    sortOrder,
  } as const;
}

function grantInsertRow(
  organizationId: string,
  agentVersionId: string,
  grant: AiAgentAccessGrantInput,
) {
  return {
    organizationId,
    agentVersionId,
    subjectType: grant.subjectType,
    subjectRole: grant.subjectType === "role" ? grant.subjectRole : null,
    subjectUserId:
      grant.subjectType === "user" ? grant.subjectUserId : null,
    subjectGroupId:
      grant.subjectType === "group" ? grant.subjectGroupId : null,
    subjectBundleId:
      grant.subjectType === "bundle" ? grant.subjectBundleId : null,
  };
}

export async function updateAiAgentDraft(input: {
  actor: AiAgentActor;
  agentId: string;
  draft: unknown;
}, dependencies: {
  fetchWebSnapshot?: typeof fetchWebKnowledgeSnapshot;
  extractDocumentSnapshot?: typeof extractDocumentKnowledgeSnapshot;
} = {}) {
  const draft = aiAgentDraftUpdateSchema.parse(input.draft);
  await requireOrganizationAdminActor(db, input.actor);
  const [preflight] = await db
    .select({ id: aiAgentVersions.id })
    .from(aiAgents)
    .innerJoin(
      aiAgentVersions,
      and(
        eq(aiAgentVersions.id, aiAgents.draftVersionId),
        eq(aiAgentVersions.agentId, aiAgents.id),
        eq(aiAgentVersions.organizationId, aiAgents.organizationId),
        eq(aiAgentVersions.state, "draft"),
      ),
    )
    .where(
      and(
        eq(aiAgents.id, input.agentId),
        eq(aiAgents.organizationId, input.actor.organizationId),
        eq(aiAgents.draftVersionId, draft.expectedDraftVersionId),
        eq(aiAgentVersions.draftRevision, draft.expectedDraftRevision),
      ),
    )
    .limit(1);
  if (!preflight) {
    throw new ApiError(
      409,
      "conflict",
      "Der Agentenentwurf ist nicht mehr aktuell.",
    );
  }
  const [webSnapshots, documentSnapshots] = await Promise.all([
    snapshotWebSources(
      draft.sources,
      dependencies.fetchWebSnapshot ?? fetchWebKnowledgeSnapshot,
    ),
    snapshotDocumentSources(
      input.actor.organizationId,
      draft.sources,
      dependencies.extractDocumentSnapshot ?? extractDocumentKnowledgeSnapshot,
    ),
  ]);
  return db.transaction(async (tx) => {
    await requireOrganizationAdminActor(tx, input.actor);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-agent:${input.actor.organizationId}:${input.agentId}`}))`,
    );
    const [agent] = await tx
      .select()
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.id, input.agentId),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!agent) {
      throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
    }
    if (agent.draftVersionId !== draft.expectedDraftVersionId) {
      throw new ApiError(
        409,
        "conflict",
        "Der Agentenentwurf wurde zwischenzeitlich veroeffentlicht. Lade den aktuellen Stand neu.",
      );
    }
    const [currentDraft] = await tx
      .select()
      .from(aiAgentVersions)
      .where(
        and(
          eq(aiAgentVersions.id, agent.draftVersionId),
          eq(aiAgentVersions.agentId, agent.id),
          eq(aiAgentVersions.organizationId, input.actor.organizationId),
          eq(aiAgentVersions.state, "draft"),
        ),
      )
      .for("update")
      .limit(1);
    if (!currentDraft) {
      throw new ApiError(409, "conflict", "Der Agentenentwurf ist nicht mehr bearbeitbar.");
    }
    if (currentDraft.draftRevision !== draft.expectedDraftRevision) {
      throw new ApiError(
        409,
        "conflict",
        "Der Agentenentwurf wurde parallel geaendert. Lade den aktuellen Stand neu.",
      );
    }
    const [duplicate] = await tx
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.organizationId, input.actor.organizationId),
          eq(aiAgents.name, draft.name),
          ne(aiAgents.id, agent.id),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(
        409,
        "conflict",
        "Ein KI-Agent mit diesem Namen existiert bereits.",
      );
    }

    const [sourceRows] = await Promise.all([
      validatedSourceRows(
        tx,
        input.actor.organizationId,
        draft.sources,
        webSnapshots,
        documentSnapshots,
      ),
      validateGrantTargets(
        tx,
        input.actor.organizationId,
        draft.accessGrants,
      ),
      validateActionTargets(tx, input.actor.organizationId, draft.actions),
      validateProfileFieldTargets(
        tx,
        input.actor.organizationId,
        draft.profileFieldIds,
      ),
    ]);
    await tx
      .delete(aiAgentVersionSources)
      .where(
        and(
          eq(aiAgentVersionSources.organizationId, input.actor.organizationId),
          eq(aiAgentVersionSources.agentVersionId, currentDraft.id),
        ),
      );
    await tx
      .delete(aiAgentVersionAccessGrants)
      .where(
        and(
          eq(
            aiAgentVersionAccessGrants.organizationId,
            input.actor.organizationId,
          ),
          eq(
            aiAgentVersionAccessGrants.agentVersionId,
            currentDraft.id,
          ),
        ),
      );
    await tx
      .delete(aiAgentVersionActions)
      .where(
        and(
          eq(aiAgentVersionActions.organizationId, input.actor.organizationId),
          eq(aiAgentVersionActions.agentVersionId, currentDraft.id),
        ),
      );
    if (sourceRows.length) {
      await tx.insert(aiAgentVersionSources).values(
        sourceRows.map((row) => ({ ...row, agentVersionId: currentDraft.id })),
      );
    }
    if (draft.accessGrants.length) {
      await tx.insert(aiAgentVersionAccessGrants).values(
        draft.accessGrants.map((grant) =>
          grantInsertRow(
            input.actor.organizationId,
            currentDraft.id,
            grant,
          ),
        ),
      );
    }
    if (draft.actions.length) {
      await tx.insert(aiAgentVersionActions).values(
        draft.actions.map((action, sortOrder) =>
          actionInsertRow(
            input.actor.organizationId,
            currentDraft.id,
            action,
            sortOrder,
          ),
        ),
      );
    }
    const now = new Date();
    const [updatedDraft] = await tx
      .update(aiAgentVersions)
      .set({
        type: draft.agentType,
        name: draft.name,
        description: draft.description,
        systemPrompt: draft.systemPrompt,
        color: draft.color.toLowerCase(),
        icon: draft.icon,
        knowledgeMode: draft.knowledgeMode,
        accessMode: draft.accessMode,
        profileFieldIds: draft.profileFieldIds,
        additionalPrompts: draft.additionalPrompts,
        draftRevision: sql`${aiAgentVersions.draftRevision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiAgentVersions.id, currentDraft.id),
          eq(aiAgentVersions.state, "draft"),
          eq(aiAgentVersions.draftRevision, draft.expectedDraftRevision),
        ),
      )
      .returning();
    if (!updatedDraft) {
      throw new ApiError(
        409,
        "conflict",
        "Der Agentenentwurf wurde parallel geaendert.",
      );
    }
    await tx
      .update(aiAgents)
      .set({
        name: updatedDraft.name,
        description: updatedDraft.description,
        systemPrompt: updatedDraft.systemPrompt,
        color: updatedDraft.color,
        icon: updatedDraft.icon,
      })
      .where(
        and(
          eq(aiAgents.id, agent.id),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "agent.draft.updated",
      entityType: "ai_agent",
      entityId: agent.id,
      metadata: {
        draftVersion: updatedDraft.version,
        draftRevision: updatedDraft.draftRevision,
        agentType: updatedDraft.type,
        knowledgeMode: updatedDraft.knowledgeMode,
        accessMode: updatedDraft.accessMode,
        sourceCount: draft.sources.length,
        webSourceCount: webSnapshots.size,
        documentSourceCount: documentSnapshots.size,
        webSnapshotDigests: [...webSnapshots.values()]
          .map((snapshot) => snapshot.contentDigest)
          .sort(),
        grantCount: draft.accessGrants.length,
        actionCount: draft.actions.length,
        profileFieldCount: draft.profileFieldIds.length,
        additionalPromptCount: draft.additionalPrompts.length,
        digest: aiAgentDraftDigest(draft),
      },
    });
    return updatedDraft;
  });
}

async function draftConfiguration(
  executor: AgentExecutor,
  organizationId: string,
  draft: typeof aiAgentVersions.$inferSelect,
) {
  const [sourceRows, grantRows, actionRows] = await Promise.all([
    executor
      .select()
      .from(aiAgentVersionSources)
      .where(
        and(
          eq(aiAgentVersionSources.organizationId, organizationId),
          eq(aiAgentVersionSources.agentVersionId, draft.id),
        ),
      )
      .orderBy(
        asc(aiAgentVersionSources.sortOrder),
        asc(aiAgentVersionSources.id),
      ),
    executor
      .select()
      .from(aiAgentVersionAccessGrants)
      .where(
        and(
          eq(aiAgentVersionAccessGrants.organizationId, organizationId),
          eq(aiAgentVersionAccessGrants.agentVersionId, draft.id),
        ),
      )
      .orderBy(asc(aiAgentVersionAccessGrants.createdAt)),
    executor
      .select()
      .from(aiAgentVersionActions)
      .where(
        and(
          eq(aiAgentVersionActions.organizationId, organizationId),
          eq(aiAgentVersionActions.agentVersionId, draft.id),
        ),
      )
      .orderBy(
        asc(aiAgentVersionActions.sortOrder),
        asc(aiAgentVersionActions.id),
      ),
  ]);
  const sources = sourceRows.map(sourceInputFromRow);
  const accessGrants = grantRows.map(grantInputFromRow);
  const actions = actionRows.map(actionInputFromRow);
  const parsed = aiAgentDraftUpdateSchema.parse({
    expectedDraftVersionId: draft.id,
    expectedDraftRevision: draft.draftRevision,
    agentType: draft.type,
    name: draft.name,
    description: draft.description,
    systemPrompt: draft.systemPrompt,
    color: draft.color,
    icon: draft.icon,
    knowledgeMode: draft.knowledgeMode,
    accessMode: draft.accessMode,
    sources,
    accessGrants,
    actions,
    profileFieldIds: draft.profileFieldIds,
    additionalPrompts: draft.additionalPrompts,
  });
  return { parsed, sourceRows, grantRows, actionRows };
}

async function boundedDraftPreviewConfiguration(
  executor: AgentExecutor,
  organizationId: string,
  draft: typeof aiAgentVersions.$inferSelect,
) {
  const [sourceRows, grantRows] = await Promise.all([
    executor
      .select({
        id: aiAgentVersionSources.id,
        sourceType: aiAgentVersionSources.sourceType,
        courseId: aiAgentVersionSources.courseId,
        courseVersionId: aiAgentVersionSources.courseVersionId,
        mediaAssetId: aiAgentVersionSources.mediaAssetId,
        title: aiAgentVersionSources.title,
        content: sql<string | null>`left(${aiAgentVersionSources.content}, 4000)`,
        sourceUrl: aiAgentVersionSources.sourceUrl,
        contentDigest: aiAgentVersionSources.contentDigest,
        fetchedAt: aiAgentVersionSources.fetchedAt,
        sortOrder: aiAgentVersionSources.sortOrder,
      })
      .from(aiAgentVersionSources)
      .where(
        and(
          eq(aiAgentVersionSources.organizationId, organizationId),
          eq(aiAgentVersionSources.agentVersionId, draft.id),
        ),
      )
      .orderBy(
        asc(aiAgentVersionSources.sortOrder),
        asc(aiAgentVersionSources.id),
      )
      .limit(101),
    executor
      .select({
        id: aiAgentVersionAccessGrants.id,
        subjectType: aiAgentVersionAccessGrants.subjectType,
        subjectRole: aiAgentVersionAccessGrants.subjectRole,
        subjectUserId: aiAgentVersionAccessGrants.subjectUserId,
        subjectGroupId: aiAgentVersionAccessGrants.subjectGroupId,
        subjectBundleId: aiAgentVersionAccessGrants.subjectBundleId,
      })
      .from(aiAgentVersionAccessGrants)
      .where(
        and(
          eq(aiAgentVersionAccessGrants.organizationId, organizationId),
          eq(aiAgentVersionAccessGrants.agentVersionId, draft.id),
        ),
      )
      .orderBy(asc(aiAgentVersionAccessGrants.createdAt))
      .limit(251),
  ]);
  if (sourceRows.length > 100 || grantRows.length > 250) {
    throw new ApiError(
      409,
      "conflict",
      "Der Agentenentwurf ueberschreitet die sicheren Vorschaugrenzen.",
    );
  }
  return { sourceRows, grantRows };
}

type DraftPreviewConfiguration = Awaited<
  ReturnType<typeof boundedDraftPreviewConfiguration>
>;
type DraftPreviewCoverage = AiAgentDraftPreviewResult["coverage"];

function emptyDraftPreviewCoverage(): DraftPreviewCoverage {
  return {
    courseCount: 0,
    manualSourceCount: 0,
    mediaSourceCount: 0,
    webSourceCount: 0,
    referenceCount: 0,
    unavailableSourceCount: 0,
  };
}

async function resolveDraftPreviewEligibility(input: {
  executor: AgentExecutor;
  organizationId: string;
  memberId: string;
  draft: typeof aiAgentVersions.$inferSelect;
  configuration: DraftPreviewConfiguration;
}) {
  const snapshot = await accessSnapshot(
    input.executor,
    input.organizationId,
    input.memberId,
  );
  const allowed = draftAccessAllowed(
    snapshot,
    input.draft.accessMode,
    input.configuration.grantRows,
  );
  if (!allowed) {
    return {
      allowed,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            memberId: snapshot.member.id,
            role: snapshot.member.role,
            groupIds: [...snapshot.groupIds].sort(),
            bundleIds: [...snapshot.bundleIds].sort(),
            allowed,
          }),
        )
        .digest("hex"),
      coverage: emptyDraftPreviewCoverage(),
      coursesForCompletion: [] as AiCourseContext[],
    };
  }

  const selectedCourseSources = input.configuration.sourceRows.filter(
    (source) => source.sourceType === "course_version" && source.courseId,
  );
  const requestedCourseIds = selectedCourseSources.map(
    (source) => source.courseId!,
  );
  const selectedMediaIds = input.configuration.sourceRows.flatMap((source) =>
    source.sourceType === "media_asset" && source.mediaAssetId
      ? [source.mediaAssetId]
      : [],
  );
  const [accessibleCourses, availableMediaRows] = await Promise.all([
    accessibleDraftCourseContexts({
      executor: input.executor,
      organizationId: input.organizationId,
      userId: snapshot.member.id,
      courseIds:
        input.draft.knowledgeMode === "selected_sources"
          ? requestedCourseIds
          : undefined,
    }),
    selectedMediaIds.length
      ? input.executor
          .select({
            id: mediaAssets.id,
            status: mediaAssets.status,
            deletedAt: mediaAssets.deletedAt,
            contentSha256: mediaAssets.contentSha256,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.organizationId, input.organizationId),
              inArray(mediaAssets.id, selectedMediaIds),
            ),
          )
      : Promise.resolve([]),
  ]);
  const courseById = new Map(
    accessibleCourses.map((course) => [course.id, course]),
  );
  const availableMediaDigests = new Map(
    availableMediaRows
      .filter((media) => media.status === "ready" && !media.deletedAt)
      .map((media) => [media.id, media.contentSha256]),
  );

  let unavailableSourceCount = 0;
  let manualSourceCount = 0;
  let mediaSourceCount = 0;
  let webSourceCount = 0;
  const courseContext =
    input.draft.knowledgeMode === "all_accessible_courses"
      ? accessibleCourses
      : selectedCourseSources.flatMap((source) => {
          const context = courseById.get(source.courseId!);
          if (!context || context.versionId !== source.courseVersionId) {
            unavailableSourceCount += 1;
            return [];
          }
          return [context];
        });
  const curatedContext = input.configuration.sourceRows.flatMap(
    (source, index) => {
      if (source.sourceType === "course_version") return [];
      if (
        source.sourceType === "media_asset" &&
        (!source.mediaAssetId ||
          availableMediaDigests.get(source.mediaAssetId) !==
            source.contentDigest)
      ) {
        unavailableSourceCount += 1;
        return [];
      }
      if (!source.title || !source.content) {
        unavailableSourceCount += 1;
        return [];
      }
      const context = curatedDraftPreviewContext({
        sequence: index + 1,
        sourceType: source.sourceType,
        title: source.title,
        content: source.content,
      });
      if (!context) {
        unavailableSourceCount += 1;
        return [];
      }
      if (source.sourceType === "manual_text") manualSourceCount += 1;
      else if (source.sourceType === "media_asset") mediaSourceCount += 1;
      else webSourceCount += 1;
      return [context];
    },
  );
  const coursesForCompletion = [...courseContext, ...curatedContext];
  const sourceEligibility = input.configuration.sourceRows
    .map((source) => {
      const course = source.courseId ? courseById.get(source.courseId) : null;
      return {
        id: source.id,
        type: source.sourceType,
        courseId: source.courseId,
        configuredCourseVersionId: source.courseVersionId,
        accessibleCourseVersionId: course?.versionId ?? null,
        mediaAssetId: source.mediaAssetId,
        mediaAvailable: source.mediaAssetId
          ? availableMediaDigests.get(source.mediaAssetId) ===
            source.contentDigest
          : null,
        contentDigest: source.contentDigest,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const grants = input.configuration.grantRows
    .map((grant) => ({
      id: grant.id,
      subjectType: grant.subjectType,
      subjectRole: grant.subjectRole,
      subjectUserId: grant.subjectUserId,
      subjectGroupId: grant.subjectGroupId,
      subjectBundleId: grant.subjectBundleId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const accessibleCourseFingerprint = accessibleCourses
    .map((course) => ({
      id: course.id,
      versionId: course.versionId,
      sourceIds: course.sources.map((source) => source.id).sort(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        memberId: snapshot.member.id,
        role: snapshot.member.role,
        groupIds: [...snapshot.groupIds].sort(),
        bundleIds: [...snapshot.bundleIds].sort(),
        allowed,
        accessMode: input.draft.accessMode,
        knowledgeMode: input.draft.knowledgeMode,
        grants,
        sourceEligibility,
        accessibleCourses: accessibleCourseFingerprint,
      }),
    )
    .digest("hex");
  return {
    allowed,
    fingerprint,
    coverage: {
      courseCount: courseContext.length,
      manualSourceCount,
      mediaSourceCount,
      webSourceCount,
      referenceCount: coursesForCompletion.reduce(
        (total, course) => total + course.sources.length,
        0,
      ),
      unavailableSourceCount,
    },
    coursesForCompletion,
  };
}

async function readDraftPreviewState(
  executor: AgentExecutor,
  input: {
    organizationId: string;
    agentId: string;
    expectedDraftVersionId: string;
    expectedDraftRevision: number;
    memberId: string;
  },
) {
  const [agent] = await executor
    .select({
      id: aiAgents.id,
      draftVersionId: aiAgents.draftVersionId,
    })
    .from(aiAgents)
    .where(
      and(
        eq(aiAgents.id, input.agentId),
        eq(aiAgents.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!agent) throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
  if (agent.draftVersionId !== input.expectedDraftVersionId) {
    throw new ApiError(409, "conflict", "Der Agentenentwurf ist nicht mehr aktuell.");
  }

  const [draft] = await executor
    .select()
    .from(aiAgentVersions)
    .where(
      and(
        eq(aiAgentVersions.id, agent.draftVersionId),
        eq(aiAgentVersions.agentId, agent.id),
        eq(aiAgentVersions.organizationId, input.organizationId),
        eq(aiAgentVersions.state, "draft"),
      ),
    )
    .limit(1);
  if (!draft || draft.draftRevision !== input.expectedDraftRevision) {
    throw new ApiError(409, "conflict", "Der Agentenentwurf wurde parallel geaendert.");
  }
  const configuration = await boundedDraftPreviewConfiguration(
    executor,
    input.organizationId,
    draft,
  );
  const eligibility = await resolveDraftPreviewEligibility({
    executor,
    organizationId: input.organizationId,
    memberId: input.memberId,
    draft,
    configuration,
  });
  return { draft, eligibility };
}

async function readConsistentDraftPreviewState(input: Parameters<typeof readDraftPreviewState>[1]) {
  return db.transaction(
    (tx) => readDraftPreviewState(tx, input),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function requireDraftPreviewProviderEgress(organizationId: string) {
  const policy = await getAiAgentPolicy(organizationId);
  if (!policy.enabled) {
    throw new ApiError(
      403,
      "forbidden",
      "KI-Agenten sind fuer diese Academy derzeit deaktiviert.",
      { reason: "ai_agents_disabled" },
    );
  }
}

export type AiAgentDraftPreviewResult = {
  allowed: boolean;
  status: "allowed" | "not_in_audience";
  message: string;
  coverage: {
    courseCount: number;
    manualSourceCount: number;
    mediaSourceCount: number;
    webSourceCount: number;
    referenceCount: number;
    unavailableSourceCount: number;
  };
  answer: string | null;
  suggestions: string[];
};

export async function previewAiAgentDraftAsMember(
  input: {
    actor: AiAgentActor;
    agentId: string;
    preview: unknown;
  },
  dependencies: {
    complete?: (
      input: Parameters<typeof completeAiMessage>[0],
    ) => Promise<AiCompletionResult>;
    beforeEligibilityRecheck?: () => Promise<void>;
  } = {},
): Promise<AiAgentDraftPreviewResult> {
  const preview = aiAgentDraftPreviewSchema.parse(input.preview);
  await requireOrganizationAdminActor(db, input.actor);
  const stateInput = {
    organizationId: input.actor.organizationId,
    agentId: input.agentId,
    expectedDraftVersionId: preview.expectedDraftVersionId,
    expectedDraftRevision: preview.expectedDraftRevision,
    memberId: preview.memberId,
  };
  const initial = await readConsistentDraftPreviewState(stateInput);
  if (!initial.eligibility.allowed) {
    return {
      allowed: false,
      status: "not_in_audience",
      message: "Dieses Mitglied hat mit dem aktuellen Entwurf keinen Zugriff.",
      coverage: emptyDraftPreviewCoverage(),
      answer: null,
      suggestions: [],
    };
  }
  await dependencies.beforeEligibilityRecheck?.();
  const current = await readConsistentDraftPreviewState(stateInput);
  if (
    !current.eligibility.allowed ||
    current.eligibility.fingerprint !== initial.eligibility.fingerprint
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Mitglieds- oder Quellenfreigaben haben sich waehrend der Vorschau geaendert.",
    );
  }
  await requireDraftPreviewProviderEgress(input.actor.organizationId);
  const memberProfile = await getAiMemberProfileContext({
    organizationId: input.actor.organizationId,
    userId: preview.memberId,
    fieldIds: current.draft.profileFieldIds,
  });
  const providerInput = draftPreviewProviderInput({
    draft: current.draft,
    message: preview.message,
    courses: current.eligibility.coursesForCompletion,
    memberProfile,
  });
  const completion = await (dependencies.complete ?? completeAiMessage)({
    agentType: current.draft.type,
    agentName: providerInput.agentName,
    agentSystemPrompt: providerInput.agentSystemPrompt,
    userFirstName: providerInput.userFirstName,
    message: preview.message,
    history: [],
    courses: providerInput.courses,
    safetyIdentifier: privacySubjectReference(
      input.actor.organizationId,
      preview.memberId,
    ),
    memberProfile: providerInput.memberProfile,
  });
  const suggestions = [
    ...new Set(
      completion.suggestions
        .slice(0, 3)
        .map((suggestion) =>
          sanitizeAiAgentDraftPreviewOutput(
            suggestion,
            providerInput.protectedValues,
            180,
          ),
        )
        .filter(Boolean),
    ),
  ];
  return {
    allowed: true,
    status: "allowed",
    message: "Zugriff mit dem aktuellen Entwurf erlaubt.",
    coverage: current.eligibility.coverage,
    answer: sanitizeAiAgentDraftPreviewOutput(
      completion.content,
      providerInput.protectedValues,
    ),
    suggestions,
  };
}

export async function publishAiAgentDraft(input: {
  actor: AiAgentActor;
  agentId: string;
  publication: unknown;
}, dependencies: {
  extractDocumentSnapshot?: typeof extractDocumentKnowledgeSnapshot;
} = {}) {
  const publication = aiAgentPublishSchema.parse(input.publication);
  await requireOrganizationAdminActor(db, input.actor);
  const preflightMediaSources = await db
    .select({ mediaAssetId: aiAgentVersionSources.mediaAssetId })
    .from(aiAgentVersionSources)
    .where(
      and(
        eq(aiAgentVersionSources.organizationId, input.actor.organizationId),
        eq(aiAgentVersionSources.agentVersionId, publication.expectedDraftVersionId),
        eq(aiAgentVersionSources.sourceType, "media_asset"),
      ),
    );
  const documentSnapshots = await snapshotDocumentSources(
    input.actor.organizationId,
    preflightMediaSources.flatMap((source) =>
      source.mediaAssetId
        ? [{ sourceType: "media_asset" as const, mediaAssetId: source.mediaAssetId }]
        : [],
    ),
    dependencies.extractDocumentSnapshot ?? extractDocumentKnowledgeSnapshot,
  );
  return db.transaction(async (tx) => {
    await requireOrganizationAdminActor(tx, input.actor);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-agent:${input.actor.organizationId}:${input.agentId}`}))`,
    );
    const [agent] = await tx
      .select()
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.id, input.agentId),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!agent) throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
    if (agent.draftVersionId !== publication.expectedDraftVersionId) {
      throw new ApiError(409, "conflict", "Der Agentenentwurf ist nicht mehr aktuell.");
    }
    const [draft] = await tx
      .select()
      .from(aiAgentVersions)
      .where(
        and(
          eq(aiAgentVersions.id, agent.draftVersionId),
          eq(aiAgentVersions.agentId, agent.id),
          eq(aiAgentVersions.organizationId, input.actor.organizationId),
          eq(aiAgentVersions.state, "draft"),
        ),
      )
      .for("update")
      .limit(1);
    if (!draft || draft.draftRevision !== publication.expectedDraftRevision) {
      throw new ApiError(409, "conflict", "Der Agentenentwurf wurde parallel geaendert.");
    }
    const configuration = await draftConfiguration(
      tx,
      input.actor.organizationId,
      draft,
    );
    const webSnapshots = storedWebSnapshots(configuration.sourceRows);
    const freshSourceRows = await validatedSourceRows(
      tx,
      input.actor.organizationId,
      configuration.parsed.sources,
      webSnapshots,
      documentSnapshots,
    );
    await validateGrantTargets(
      tx,
      input.actor.organizationId,
      configuration.parsed.accessGrants,
    );
    await validateActionTargets(
      tx,
      input.actor.organizationId,
      configuration.parsed.actions,
    );
    await validateProfileFieldTargets(
      tx,
      input.actor.organizationId,
      configuration.parsed.profileFieldIds,
    );
    await tx
      .delete(aiAgentVersionSources)
      .where(eq(aiAgentVersionSources.agentVersionId, draft.id));
    if (freshSourceRows.length) {
      await tx.insert(aiAgentVersionSources).values(
        freshSourceRows.map((row) => ({ ...row, agentVersionId: draft.id })),
      );
    }

    const publishedAt = new Date();
    const [published] = await tx
      .update(aiAgentVersions)
      .set({ state: "published", publishedAt, updatedAt: publishedAt })
      .where(
        and(
          eq(aiAgentVersions.id, draft.id),
          eq(aiAgentVersions.state, "draft"),
          eq(aiAgentVersions.draftRevision, publication.expectedDraftRevision),
        ),
      )
      .returning();
    if (!published) throw new ApiError(409, "conflict", "Der Entwurf konnte nicht veroeffentlicht werden.");

    const nextDraftId = randomUUID();
    const [nextDraft] = await tx
      .insert(aiAgentVersions)
      .values({
        id: nextDraftId,
        organizationId: input.actor.organizationId,
        agentId: agent.id,
        version: published.version + 1,
        draftRevision: 1,
        state: "draft",
        type: published.type,
        name: published.name,
        description: published.description,
        systemPrompt: published.systemPrompt,
        color: published.color,
        icon: published.icon,
        knowledgeMode: published.knowledgeMode,
        accessMode: published.accessMode,
        profileFieldIds: published.profileFieldIds,
        additionalPrompts: published.additionalPrompts,
        createdById: input.actor.id,
      })
      .returning();
    if (!nextDraft) throw new ApiError(500, "internal_error", "Der Folgeentwurf konnte nicht angelegt werden.");
    if (freshSourceRows.length) {
      await tx.insert(aiAgentVersionSources).values(
        freshSourceRows.map((row) => ({ ...row, agentVersionId: nextDraft.id })),
      );
    }
    if (configuration.parsed.accessGrants.length) {
      await tx.insert(aiAgentVersionAccessGrants).values(
        configuration.parsed.accessGrants.map((grant) =>
          grantInsertRow(
            input.actor.organizationId,
            nextDraft.id,
            grant,
          ),
        ),
      );
    }
    if (configuration.parsed.actions.length) {
      await tx.insert(aiAgentVersionActions).values(
        configuration.parsed.actions.map((action, sortOrder) =>
          actionInsertRow(
            input.actor.organizationId,
            nextDraft.id,
            action,
            sortOrder,
          ),
        ),
      );
    }
    await tx
      .update(aiAgents)
      .set({
        draftVersionId: nextDraft.id,
        publishedVersionId: published.id,
        name: nextDraft.name,
        description: nextDraft.description,
        systemPrompt: nextDraft.systemPrompt,
        color: nextDraft.color,
        icon: nextDraft.icon,
      })
      .where(
        and(
          eq(aiAgents.id, agent.id),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "agent.version.published",
      entityType: "ai_agent",
      entityId: agent.id,
      metadata: {
        publishedVersionId: published.id,
        publishedVersion: published.version,
        previousPublishedVersionId: agent.publishedVersionId,
        sourceCount: freshSourceRows.length,
        webSourceCount: webSnapshots.size,
        webSnapshotDigests: [...webSnapshots.values()]
          .map((snapshot) => snapshot.contentDigest)
          .sort(),
        grantCount: configuration.parsed.accessGrants.length,
        actionCount: configuration.parsed.actions.length,
        accessMode: published.accessMode,
        knowledgeMode: published.knowledgeMode,
      },
    });
    return { published, nextDraft };
  });
}

export async function rollbackAiAgentVersion(input: {
  actor: AiAgentActor;
  agentId: string;
  rollback: unknown;
}) {
  const rollback = aiAgentRollbackSchema.parse(input.rollback);
  return db.transaction(async (tx) => {
    await requireOrganizationAdminActor(tx, input.actor);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-agent:${input.actor.organizationId}:${input.agentId}`}))`,
    );
    const [agent] = await tx
      .select()
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.id, input.agentId),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!agent) throw new ApiError(404, "not_found", "KI-Agent nicht gefunden.");
    const [target] = await tx
      .select()
      .from(aiAgentVersions)
      .where(
        and(
          eq(aiAgentVersions.id, rollback.publishedVersionId),
          eq(aiAgentVersions.agentId, agent.id),
          eq(aiAgentVersions.organizationId, input.actor.organizationId),
          eq(aiAgentVersions.state, "published"),
        ),
      )
      .limit(1);
    if (!target) {
      throw new ApiError(404, "not_found", "Veroeffentlichte Agentenversion nicht gefunden.");
    }
    if (agent.publishedVersionId === target.id) return target;
    await tx
      .update(aiAgents)
      .set({ publishedVersionId: target.id })
      .where(
        and(
          eq(aiAgents.id, agent.id),
          eq(aiAgents.organizationId, input.actor.organizationId),
        ),
      );
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "agent.version.rolled_back",
      entityType: "ai_agent",
      entityId: agent.id,
      metadata: {
        previousPublishedVersionId: agent.publishedVersionId,
        publishedVersionId: target.id,
        publishedVersion: target.version,
      },
    });
    return target;
  });
}

export async function getAiAgentStudioAdminData(
  actor: AiAgentActor,
) {
  await requireOrganizationAdminActor(db, actor);
  const [agentRows, versionRows, sourceRows, grantRows, actionRows, courseRows, userRows, groupRows, bundleRows, mediaRows, profileFieldRows] =
    await Promise.all([
      db.select().from(aiAgents).where(eq(aiAgents.organizationId, actor.organizationId)).orderBy(asc(aiAgents.name)),
      db.select().from(aiAgentVersions).where(eq(aiAgentVersions.organizationId, actor.organizationId)).orderBy(asc(aiAgentVersions.agentId), asc(aiAgentVersions.version)),
      db.select().from(aiAgentVersionSources).where(eq(aiAgentVersionSources.organizationId, actor.organizationId)).orderBy(asc(aiAgentVersionSources.sortOrder)),
      db.select().from(aiAgentVersionAccessGrants).where(eq(aiAgentVersionAccessGrants.organizationId, actor.organizationId)),
      db.select().from(aiAgentVersionActions).where(eq(aiAgentVersionActions.organizationId, actor.organizationId)).orderBy(asc(aiAgentVersionActions.sortOrder), asc(aiAgentVersionActions.id)),
      db.select({ id: courses.id, title: courses.title, publishedVersionId: courses.publishedVersionId }).from(courses).where(and(eq(courses.organizationId, actor.organizationId), eq(courses.status, "published"), sql`${courses.publishedVersionId} is not null`)).orderBy(asc(courses.title)),
      db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(users).where(and(eq(users.organizationId, actor.organizationId), eq(users.status, "active"))).orderBy(asc(users.lastName), asc(users.firstName)),
      db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.organizationId, actor.organizationId)).orderBy(asc(groups.name)),
      db.select({ id: bundles.id, name: bundles.name }).from(bundles).where(and(eq(bundles.organizationId, actor.organizationId), eq(bundles.active, true))).orderBy(asc(bundles.name)),
      db.select({ id: mediaAssets.id, fileName: mediaAssets.originalFileName, kind: mediaAssets.kind }).from(mediaAssets).where(and(eq(mediaAssets.organizationId, actor.organizationId), eq(mediaAssets.kind, "document"), eq(mediaAssets.status, "ready"), isNull(mediaAssets.deletedAt))).orderBy(asc(mediaAssets.originalFileName)),
      db.select({ id: customFieldDefinitions.id, label: customFieldDefinitions.label, category: customFieldDefinitions.category, type: customFieldDefinitions.type }).from(customFieldDefinitions).where(and(eq(customFieldDefinitions.organizationId, actor.organizationId), eq(customFieldDefinitions.active, true), eq(customFieldDefinitions.visibility, "member"))).orderBy(asc(customFieldDefinitions.category), asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label)),
    ]);
  const versionsById = new Map(versionRows.map((version) => [version.id, version]));
  const sourcesByVersion = new Map<string, typeof sourceRows>();
  for (const source of sourceRows) {
    const rows = sourcesByVersion.get(source.agentVersionId) ?? [];
    rows.push(source);
    sourcesByVersion.set(source.agentVersionId, rows);
  }
  const grantsByVersion = new Map<string, typeof grantRows>();
  for (const grant of grantRows) {
    const rows = grantsByVersion.get(grant.agentVersionId) ?? [];
    rows.push(grant);
    grantsByVersion.set(grant.agentVersionId, rows);
  }
  const actionsByVersion = new Map<string, typeof actionRows>();
  for (const action of actionRows) {
    const rows = actionsByVersion.get(action.agentVersionId) ?? [];
    rows.push(action);
    actionsByVersion.set(action.agentVersionId, rows);
  }
  return {
    agents: agentRows.map((agent) => ({
      ...agent,
      draft: versionsById.get(agent.draftVersionId)!,
      published: agent.publishedVersionId
        ? versionsById.get(agent.publishedVersionId) ?? null
        : null,
      history: versionRows.filter(
        (version) => version.agentId === agent.id && version.state === "published",
      ),
      draftSources: (sourcesByVersion.get(agent.draftVersionId) ?? []).map(
        (source) =>
          source.sourceType === "web_url" && source.content
            ? { ...source, content: source.content.slice(0, 4_000) }
            : source,
      ),
      draftAccessGrants: grantsByVersion.get(agent.draftVersionId) ?? [],
      draftActions: actionsByVersion.get(agent.draftVersionId) ?? [],
    })),
    options: {
      courses: courseRows,
      users: userRows.map((user) => ({
        id: user.id,
        label: `${user.firstName} ${user.lastName} (${user.email})`,
      })),
      groups: groupRows,
      bundles: bundleRows,
      mediaAssets: mediaRows,
      profileFields: profileFieldRows,
    },
  };
}

export async function createAiAgentDraftIdentity(input: {
  actor: AiAgentActor;
  name: string;
  description: string;
  systemPrompt: string;
  color: string;
  icon: string;
  publish?: boolean;
  active?: boolean;
}) {
  const agentId = randomUUID();
  const initialVersionId = randomUUID();
  const nextDraftVersionId = input.publish ? randomUUID() : null;
  const baseDraft = aiAgentDraftUpdateSchema.parse({
    expectedDraftVersionId: initialVersionId,
    expectedDraftRevision: 1,
    agentType: "learning_coach",
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
    color: input.color,
    icon: input.icon,
    knowledgeMode: "all_accessible_courses",
    accessMode: "open",
    sources: [],
    accessGrants: [],
  });
  return db.transaction(async (tx) => {
    await requireOrganizationAdminActor(tx, input.actor);
    const [duplicate] = await tx
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .where(
        and(
          eq(aiAgents.organizationId, input.actor.organizationId),
          eq(aiAgents.name, baseDraft.name),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new ApiError(409, "conflict", "Ein KI-Agent mit diesem Namen existiert bereits.");
    }
    await tx.insert(aiAgents).values({
      id: agentId,
      organizationId: input.actor.organizationId,
      name: baseDraft.name,
      description: baseDraft.description,
      systemPrompt: baseDraft.systemPrompt,
      color: baseDraft.color.toLowerCase(),
      icon: baseDraft.icon,
      active: false,
      draftVersionId: initialVersionId,
      publishedVersionId: null,
    });
    const versionBase = {
      organizationId: input.actor.organizationId,
      agentId,
      type: baseDraft.agentType,
      name: baseDraft.name,
      description: baseDraft.description,
      systemPrompt: baseDraft.systemPrompt,
      color: baseDraft.color.toLowerCase(),
      icon: baseDraft.icon,
      knowledgeMode: baseDraft.knowledgeMode,
      accessMode: baseDraft.accessMode,
      profileFieldIds: baseDraft.profileFieldIds,
      additionalPrompts: baseDraft.additionalPrompts,
      createdById: input.actor.id,
    } as const;
    const [initialDraft] = await tx
      .insert(aiAgentVersions)
      .values({
        ...versionBase,
        id: initialVersionId,
        version: 1,
        draftRevision: 1,
        state: "draft",
      })
      .returning();
    if (!initialDraft) {
      throw new ApiError(
        500,
        "internal_error",
        "Der Agentenentwurf konnte nicht angelegt werden.",
      );
    }
    let draft = initialDraft;
    if (input.publish && nextDraftVersionId) {
      const publishedAt = new Date();
      const [published] = await tx
        .update(aiAgentVersions)
        .set({ state: "published", publishedAt, updatedAt: publishedAt })
        .where(
          and(
            eq(aiAgentVersions.id, initialDraft.id),
            eq(aiAgentVersions.state, "draft"),
          ),
        )
        .returning();
      if (!published) {
        throw new ApiError(
          500,
          "internal_error",
          "Die initiale Agentenversion konnte nicht versiegelt werden.",
        );
      }
      const [nextDraft] = await tx
        .insert(aiAgentVersions)
        .values({
          ...versionBase,
          id: nextDraftVersionId,
          version: 2,
          draftRevision: 1,
          state: "draft",
        })
        .returning();
      if (!nextDraft) {
        throw new ApiError(
          500,
          "internal_error",
          "Der Folgeentwurf konnte nicht angelegt werden.",
        );
      }
      await tx
        .update(aiAgents)
        .set({
          active: input.active !== false,
          draftVersionId: nextDraft.id,
          publishedVersionId: published.id,
        })
        .where(
          and(
            eq(aiAgents.id, agentId),
            eq(aiAgents.organizationId, input.actor.organizationId),
          ),
        );
      draft = nextDraft;
    }
    await tx.insert(activityEvents).values({
      organizationId: input.actor.organizationId,
      userId: input.actor.id,
      type: "agent.draft.created",
      entityType: "ai_agent",
      entityId: agentId,
      metadata: {
        draftVersionId: draft.id,
        draftVersion: draft.version,
        publishedVersionId: input.publish ? initialVersionId : null,
      },
    });
    return { agentId, draft };
  });
}
