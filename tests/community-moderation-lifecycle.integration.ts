import assert from "node:assert/strict";
import test from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import {
  comments,
  communityAreas,
  communityModerationAssessments,
  communityModerationCases,
  communityModerationEvents,
  communityReports,
  communitySpaceModerationPolicies,
  communitySpaces,
  organizations,
  posts,
  users,
} from "../src/db/schema";
import { ApiError } from "../src/lib/api/errors";
import {
  communityApprovalRequired,
  createCommunityModerationLifecycle,
} from "../src/lib/community-moderation-lifecycle-core";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const client = postgres(databaseUrl, { max: 4, prepare: false });
const database = drizzle(client, { schema });
const lifecycle = createCommunityModerationLifecycle({
  getSecret: () => "community-lifecycle-integration-secret-32-bytes",
});

function isApiError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof ApiError && error.code === code && error.status === status;
}

test("community moderation lifecycle is transactional, versioned and non-destructive", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let organizationId = "";
  const firstPublishEffects: Array<{
    targetId: string;
    contentVersion: number;
  }> = [];

  try {
    const [organization] = await database
      .insert(organizations)
      .values({
        name: `Lifecycle ${suffix}`,
        slug: `lifecycle-${suffix}`,
      })
      .returning({ id: organizations.id });
    organizationId = organization.id;
    const createdUsers = await database
      .insert(users)
      .values([
        {
          organizationId,
          email: `member-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Member",
          lastName: "Author",
          role: "member",
        },
        {
          organizationId,
          email: `reporter-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "First",
          lastName: "Reporter",
          role: "trainer",
        },
        {
          organizationId,
          email: `reporter-two-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Second",
          lastName: "Reporter",
          role: "member",
        },
        {
          organizationId,
          email: `admin-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Admin",
          lastName: "Moderator",
          role: "admin",
        },
      ])
      .returning({ id: users.id, role: users.role });
    const member = createdUsers.find((user) => user.role === "member")!;
    const reporters = createdUsers.filter(
      (user) => user.id !== member.id && user.role !== "admin",
    );
    const secondMember = createdUsers.find(
      (user) => user.role === "member" && user.id !== member.id,
    )!;
    const admin = createdUsers.find((user) => user.role === "admin")!;
    const firstReporter = reporters[0]!;
    const secondReporter = secondMember;

    const [area] = await database
      .insert(communityAreas)
      .values({
        organizationId,
        title: "Allgemein",
        slug: "allgemein",
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space, defaultSpace] = await database
      .insert(communitySpaces)
      .values([
        {
          organizationId,
          areaId: area.id,
          title: "Moderated space",
          slug: `moderated-${suffix}`,
          sortOrder: 0,
        },
        {
          organizationId,
          areaId: area.id,
          title: "Default space",
          slug: `default-${suffix}`,
          sortOrder: 1,
        },
      ])
      .returning({ id: communitySpaces.id, slug: communitySpaces.slug });
    const moderatedSpace = space.slug.startsWith("moderated-")
      ? space
      : defaultSpace;
    const unconfiguredSpace = space.slug.startsWith("default-")
      ? space
      : defaultSpace;

    const defaultPolicy = await database.transaction((tx) =>
      lifecycle.loadCommunityModerationPolicy(tx, {
        organizationId,
        spaceId: unconfiguredSpace.id,
      }),
    );
    assert.deepEqual(
      {
        postApproval: defaultPolicy.postApproval,
        commentApproval: defaultPolicy.commentApproval,
        automationMode: defaultPolicy.automationMode,
        reportThreshold: defaultPolicy.reportThreshold,
        duplicateWindowMinutes: defaultPolicy.duplicateWindowMinutes,
        linkLimit: defaultPolicy.linkLimit,
        version: defaultPolicy.version,
      },
      {
        postApproval: "off",
        commentApproval: "off",
        automationMode: "off",
        reportThreshold: null,
        duplicateWindowMinutes: 0,
        linkLimit: 0,
        version: 1,
      },
    );
    assert.equal(
      communityApprovalRequired({ mode: "members", role: "member" }),
      true,
    );
    assert.equal(
      communityApprovalRequired({ mode: "members", role: "trainer" }),
      false,
    );
    assert.equal(
      communityApprovalRequired({ mode: "non_admins", role: "trainer" }),
      true,
    );
    assert.equal(
      communityApprovalRequired({ mode: "non_admins", role: "admin" }),
      false,
    );

    await database.insert(communitySpaceModerationPolicies).values({
      organizationId,
      spaceId: moderatedSpace.id,
      postApproval: "members",
      commentApproval: "non_admins",
      automationMode: "enforce",
      reportThreshold: 2,
      duplicateWindowMinutes: 60,
      linkLimit: 1,
      version: 1,
      updatedById: admin.id,
    });

    async function createPost(input: {
      authorId: string;
      content: string;
      analysisContent?: string;
      onFirstPublish?: (effect: {
        targetId: string;
        contentVersion: number;
      }) => Promise<void>;
    }) {
      return database.transaction((tx) =>
        lifecycle.createCommunityContentWithModeration(tx, {
          organizationId,
          spaceId: moderatedSpace.id,
          targetType: "post",
          authorId: input.authorId,
          content: input.content,
          analysisContent: input.analysisContent,
          persist: async (fields) => {
            const [post] = await tx
              .insert(posts)
              .values({
                organizationId,
                spaceId: moderatedSpace.id,
                authorId: input.authorId,
                content: input.content,
                ...fields,
              })
              .returning({ id: posts.id });
            return post;
          },
          onFirstPublish: input.onFirstPublish,
        }),
      );
    }

    async function updatePost(input: {
      targetId: string;
      actorId: string;
      expectedContentVersion: number;
      content: string;
      analysisContent?: string;
      onFirstPublish?: (effect: {
        targetId: string;
        contentVersion: number;
      }) => Promise<void>;
    }) {
      return database.transaction((tx) =>
        lifecycle.updateCommunityContentWithModeration(tx, {
          organizationId,
          targetType: "post",
          targetId: input.targetId,
          actorId: input.actorId,
          expectedContentVersion: input.expectedContentVersion,
          content: input.content,
          analysisContent: input.analysisContent,
          onFirstPublish: input.onFirstPublish,
          persist: async ({ content, moderation }) => {
            const [post] = await tx
              .update(posts)
              .set({ content, ...moderation, updatedAt: new Date() })
              .where(
                and(
                  eq(posts.id, input.targetId),
                  eq(posts.organizationId, organizationId),
                ),
              )
              .returning({ id: posts.id });
            return post;
          },
        }),
      );
    }

    const pending = await createPost({
      authorId: member.id,
      content: "Dieser Beitrag wartet auf Freigabe.",
      onFirstPublish: async (effect) => {
        firstPublishEffects.push(effect);
      },
    });
    assert.equal(pending.state, "pending");
    assert.ok(pending.caseId);
    assert.equal(pending.firstPublish, null);
    assert.equal(firstPublishEffects.length, 0);

    const approved = await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: pending.caseId!,
        actorId: admin.id,
        action: "approve",
        expectedDecisionVersion: 1,
        expectedContentVersion: 1,
        note: "Freigabe nach manueller Pruefung.",
        onFirstPublish: async (effect) => {
          firstPublishEffects.push(effect);
        },
      }),
    );
    assert.equal(approved.state, "published");
    assert.equal(approved.contentVersion, 2);
    assert.equal(approved.decisionVersion, 2);
    assert.equal(firstPublishEffects.length, 1);
    assert.equal(firstPublishEffects[0]!.targetId, pending.record.id);
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.decideCommunityModerationCase(tx, {
          organizationId,
          caseId: pending.caseId!,
          actorId: admin.id,
          action: "approve",
          expectedDecisionVersion: 1,
          expectedContentVersion: 1,
          onFirstPublish: async (effect) => {
            firstPublishEffects.push(effect);
          },
        }),
      ),
      isApiError("conflict", 409),
    );
    assert.equal(firstPublishEffects.length, 1);

    const hiddenPublishedEdit = await updatePost({
      targetId: pending.record.id,
      actorId: member.id,
      expectedContentVersion: 2,
      content: "Bearbeiteter Beitrag wartet erneut auf Freigabe.",
      analysisContent:
        "Bearbeiteter Titel\nBearbeiteter Beitrag wartet erneut auf Freigabe.",
    });
    assert.equal(hiddenPublishedEdit.previousState, "published");
    assert.equal(hiddenPublishedEdit.state, "pending");
    assert.ok(hiddenPublishedEdit.caseId);
    assert.equal(hiddenPublishedEdit.firstPublish, null);
    const editDecisionRace = await Promise.allSettled([
      updatePost({
        targetId: pending.record.id,
        actorId: member.id,
        expectedContentVersion: 3,
        content: "Konkurrierende Autorenrevision.",
      }),
      database.transaction((tx) =>
        lifecycle.decideCommunityModerationCase(tx, {
          organizationId,
          caseId: hiddenPublishedEdit.caseId!,
          actorId: admin.id,
          action: "approve",
          expectedDecisionVersion: 1,
          expectedContentVersion: 3,
        }),
      ),
    ]);
    assert.equal(
      editDecisionRace.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const lostEditDecisionRace = editDecisionRace.find(
      (result) => result.status === "rejected",
    );
    assert.ok(lostEditDecisionRace?.status === "rejected");
    assert.equal(
      isApiError("conflict", 409)(lostEditDecisionRace.reason),
      true,
    );

    const rejectedCreate = await createPost({
      authorId: member.id,
      content: "Dieser andere Beitrag wird erst abgelehnt.",
    });
    const rejected = await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: rejectedCreate.caseId!,
        actorId: admin.id,
        action: "reject",
        expectedDecisionVersion: 1,
        expectedContentVersion: 1,
        note: "Regelverstoss bestaetigt.",
      }),
    );
    assert.equal(rejected.state, "rejected");
    assert.equal(rejected.firstPublish, null);
    const restored = await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: rejectedCreate.caseId!,
        actorId: admin.id,
        action: "restore",
        expectedDecisionVersion: 2,
        expectedContentVersion: 2,
        note: "Entscheidung korrigiert.",
        onFirstPublish: async (effect) => {
          firstPublishEffects.push(effect);
        },
      }),
    );
    assert.equal(restored.state, "published");
    assert.ok(restored.firstPublish);
    const [restoredRow] = await database
      .select({ state: posts.moderationState })
      .from(posts)
      .where(eq(posts.id, rejectedCreate.record.id));
    assert.equal(restoredRow.state, "published");

    const rejectedResubmitCreate = await createPost({
      authorId: member.id,
      content: "Dieser Beitrag wird nach Ablehnung korrigiert.",
    });
    await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: rejectedResubmitCreate.caseId!,
        actorId: admin.id,
        action: "reject",
        expectedDecisionVersion: 1,
        expectedContentVersion: 1,
      }),
    );
    const rejectedResubmit = await updatePost({
      targetId: rejectedResubmitCreate.record.id,
      actorId: member.id,
      expectedContentVersion: 2,
      content: "Korrigierter Beitrag nach der Ablehnung.",
    });
    assert.equal(rejectedResubmit.previousState, "rejected");
    assert.equal(rejectedResubmit.state, "pending");
    assert.ok(rejectedResubmit.caseId);
    assert.notEqual(rejectedResubmit.caseId, rejectedResubmitCreate.caseId);
    assert.equal(rejectedResubmit.firstPublish, null);
    const [rejectedActiveCaseCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.organizationId, organizationId),
          eq(communityModerationCases.targetType, "post"),
          eq(
            communityModerationCases.targetId,
            rejectedResubmitCreate.record.id,
          ),
          sql`${communityModerationCases.status} in ('open', 'reviewing', 'appealed')`,
        ),
      );
    assert.equal(rejectedActiveCaseCount.count, 1);

    const heldByLinks = await createPost({
      authorId: admin.id,
      content: "Links https://example.com und https://example.org",
    });
    assert.equal(heldByLinks.state, "held");
    assert.deepEqual(heldByLinks.analysis.reasonCodes, ["link_limit"]);
    const heldByTitle = await createPost({
      authorId: admin.id,
      content: "Der gespeicherte Body enthaelt keine Links.",
      analysisContent:
        "Titel https://title.example und https://second.example\nDer gespeicherte Body enthaelt keine Links.",
    });
    assert.equal(heldByTitle.state, "held");
    assert.deepEqual(heldByTitle.analysis.reasonCodes, ["link_limit"]);
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.decideCommunityModerationCase(tx, {
          organizationId,
          caseId: heldByLinks.caseId!,
          actorId: member.id,
          action: "approve",
          expectedDecisionVersion: 1,
          expectedContentVersion: 1,
        }),
      ),
      isApiError("forbidden", 403),
    );
    const concurrentPublishEffects: string[] = [];
    const concurrentDecisions = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        database.transaction((tx) =>
          lifecycle.decideCommunityModerationCase(tx, {
            organizationId,
            caseId: heldByLinks.caseId!,
            actorId: admin.id,
            action: "approve",
            expectedDecisionVersion: 1,
            expectedContentVersion: 1,
            onFirstPublish: async (effect) => {
              concurrentPublishEffects.push(effect.targetId);
            },
          }),
        ),
      ),
    );
    assert.equal(
      concurrentDecisions.filter((result) => result.status === "fulfilled")
        .length,
      1,
    );
    const rejectedConcurrentDecision = concurrentDecisions.find(
      (result) => result.status === "rejected",
    );
    assert.ok(rejectedConcurrentDecision?.status === "rejected");
    assert.equal(
      isApiError("conflict", 409)(rejectedConcurrentDecision.reason),
      true,
    );
    assert.deepEqual(concurrentPublishEffects, [heldByLinks.record.id]);

    const firstDuplicateCandidate = await createPost({
      authorId: admin.id,
      content: "Ein eindeutiger Duplikat-Kandidat.",
      onFirstPublish: async (effect) => {
        firstPublishEffects.push(effect);
      },
    });
    assert.equal(firstDuplicateCandidate.state, "published");
    const selfDuplicateSafeEdit = await updatePost({
      targetId: firstDuplicateCandidate.record.id,
      actorId: admin.id,
      expectedContentVersion: 1,
      content: "Ein eindeutiger Duplikat-Kandidat.",
    });
    assert.equal(selfDuplicateSafeEdit.previousState, "published");
    assert.equal(selfDuplicateSafeEdit.state, "published");
    assert.equal(selfDuplicateSafeEdit.caseId, null);
    assert.deepEqual(selfDuplicateSafeEdit.analysis.reasonCodes, []);
    await assert.rejects(
      updatePost({
        targetId: firstDuplicateCandidate.record.id,
        actorId: firstReporter.id,
        expectedContentVersion: 2,
        content: "Fremder Edit-Versuch.",
      }),
      isApiError("forbidden", 403),
    );
    const duplicate = await createPost({
      authorId: admin.id,
      content: "Ein eindeutiger Duplikat-Kandidat.",
    });
    assert.equal(duplicate.state, "held");
    assert.deepEqual(duplicate.analysis.reasonCodes, ["duplicate"]);

    const parentPost = firstDuplicateCandidate.record.id;
    const pendingComment = await database.transaction((tx) =>
      lifecycle.createCommunityContentWithModeration(tx, {
        organizationId,
        spaceId: moderatedSpace.id,
        targetType: "comment",
        authorId: firstReporter.id,
        content: "Trainer-Antwort mit Freigabepflicht.",
        persist: async (fields) => {
          const [comment] = await tx
            .insert(comments)
            .values({
              organizationId,
              postId: parentPost,
              authorId: firstReporter.id,
              content: "Trainer-Antwort mit Freigabepflicht.",
              ...fields,
            })
            .returning({ id: comments.id });
          return comment;
        },
      }),
    );
    assert.equal(pendingComment.state, "pending");

    await database
      .update(communitySpaceModerationPolicies)
      .set({
        postApproval: "off",
        commentApproval: "off",
        automationMode: "enforce",
        duplicateWindowMinutes: 0,
        linkLimit: 20,
        version: 2,
      })
      .where(
        and(
          eq(communitySpaceModerationPolicies.organizationId, organizationId),
          eq(communitySpaceModerationPolicies.spaceId, moderatedSpace.id),
        ),
      );
    const firstPublishCountBeforeEdit = firstPublishEffects.length;
    const firstPublishedByEdit = await updatePost({
      targetId: rejectedResubmitCreate.record.id,
      actorId: member.id,
      expectedContentVersion: 3,
      content: "Final korrigierter und nun veroeffentlichter Beitrag.",
      onFirstPublish: async (effect) => {
        firstPublishEffects.push(effect);
      },
    });
    assert.equal(firstPublishedByEdit.previousState, "pending");
    assert.equal(firstPublishedByEdit.state, "published");
    assert.ok(firstPublishedByEdit.firstPublish);
    assert.equal(firstPublishEffects.length, firstPublishCountBeforeEdit + 1);
    const reportTarget = await createPost({
      authorId: member.id,
      content: "Dieser veroeffentlichte Beitrag erreicht den Meldeschwellwert.",
      onFirstPublish: async (effect) => {
        firstPublishEffects.push(effect);
      },
    });
    assert.equal(reportTarget.state, "published");

    async function reportAndAttach(reporterId: string, details: string) {
      return database.transaction(async (tx) => {
        const [report] = await tx
          .insert(communityReports)
          .values({
            organizationId,
            reporterId,
            targetType: "post",
            targetId: reportTarget.record.id,
            targetAuthorId: member.id,
            contentExcerpt: reportTarget.record.id,
            reason: "spam",
            details,
          })
          .returning({ id: communityReports.id });
        return lifecycle.attachCommunityReportToModerationCase(tx, {
          organizationId,
          reportId: report.id,
        });
      });
    }

    const firstReport = await reportAndAttach(
      firstReporter.id,
      "Erste unabhaengige Meldung",
    );
    assert.equal(firstReport.distinctReporterCount, 1);
    assert.equal(firstReport.thresholdReached, false);
    assert.equal(firstReport.state, "published");
    const secondReport = await reportAndAttach(
      secondReporter.id,
      "Zweite unabhaengige Meldung",
    );
    assert.equal(secondReport.caseId, firstReport.caseId);
    assert.equal(secondReport.distinctReporterCount, 2);
    assert.equal(secondReport.thresholdReached, true);
    assert.equal(secondReport.state, "held");
    assert.equal(secondReport.contentVersion, 2);

    const [secondStoredReport] = await database
      .select({ id: communityReports.id })
      .from(communityReports)
      .where(
        and(
          eq(communityReports.caseId, secondReport.caseId),
          eq(communityReports.reporterId, secondReporter.id),
        ),
      );
    const eventCountBeforeReplay = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(communityModerationEvents)
      .where(eq(communityModerationEvents.caseId, secondReport.caseId));
    const replayed = await database.transaction((tx) =>
      lifecycle.attachCommunityReportToModerationCase(tx, {
        organizationId,
        reportId: secondStoredReport.id,
      }),
    );
    assert.equal(replayed.alreadyProcessed, true);
    const eventCountAfterReplay = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(communityModerationEvents)
      .where(eq(communityModerationEvents.caseId, secondReport.caseId));
    assert.equal(
      eventCountAfterReplay[0]!.count,
      eventCountBeforeReplay[0]!.count,
    );

    await assert.rejects(
      database.transaction(async (tx) => {
        const [duplicateReport] = await tx
          .insert(communityReports)
          .values({
            organizationId,
            reporterId: firstReporter.id,
            targetType: "post",
            targetId: reportTarget.record.id,
            targetAuthorId: member.id,
            contentExcerpt: "Duplicate reporter",
            reason: "spam",
          })
          .returning({ id: communityReports.id });
        return lifecycle.attachCommunityReportToModerationCase(tx, {
          organizationId,
          reportId: duplicateReport.id,
        });
      }),
      isApiError("conflict", 409),
    );
    const attachedReports = await database
      .select({ reporterId: communityReports.reporterId })
      .from(communityReports)
      .where(eq(communityReports.caseId, secondReport.caseId));
    assert.deepEqual(
      new Set(attachedReports.map((report) => report.reporterId)),
      new Set([firstReporter.id, secondReporter.id]),
    );

    const protectedReportedEdit = await updatePost({
      targetId: reportTarget.record.id,
      actorId: member.id,
      expectedContentVersion: 2,
      content: "Der gemeldete Beitrag wurde vom Autor ueberarbeitet.",
    });
    assert.equal(protectedReportedEdit.previousState, "held");
    assert.equal(protectedReportedEdit.state, "held");
    assert.equal(protectedReportedEdit.caseId, secondReport.caseId);
    assert.equal(protectedReportedEdit.contentVersion, 3);
    assert.equal(protectedReportedEdit.firstPublish, null);
    const [protectedReportedRow] = await database
      .select({
        moderatedById: posts.moderatedById,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(eq(posts.id, reportTarget.record.id));
    assert.equal(protectedReportedRow.moderatedById, null);
    assert.ok(protectedReportedRow.publishedAt);

    const restoredAfterReports = await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: secondReport.caseId,
        actorId: admin.id,
        action: "approve",
        expectedDecisionVersion: 3,
        expectedContentVersion: 3,
      }),
    );
    assert.equal(restoredAfterReports.state, "published");
    assert.equal(restoredAfterReports.firstPublish, null);
    const [beforeBrokenPersistence] = await database
      .select({
        content: posts.content,
        moderationVersion: posts.moderationVersion,
      })
      .from(posts)
      .where(eq(posts.id, reportTarget.record.id));
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.updateCommunityContentWithModeration(tx, {
          organizationId,
          targetType: "post",
          targetId: reportTarget.record.id,
          actorId: member.id,
          expectedContentVersion: 4,
          content: "Unvollstaendig persistierter Edit.",
          persist: async ({ content }) => {
            await tx
              .update(posts)
              .set({ content })
              .where(eq(posts.id, reportTarget.record.id));
            return { id: reportTarget.record.id };
          },
        }),
      ),
      /violated the moderation contract/u,
    );
    const [afterBrokenPersistence] = await database
      .select({
        content: posts.content,
        moderationVersion: posts.moderationVersion,
      })
      .from(posts)
      .where(eq(posts.id, reportTarget.record.id));
    assert.deepEqual(afterBrokenPersistence, beforeBrokenPersistence);

    const caseEvents = await database
      .select({ action: communityModerationEvents.action })
      .from(communityModerationEvents)
      .where(eq(communityModerationEvents.caseId, pending.caseId!));
    assert.deepEqual(
      caseEvents.map((event) => event.action),
      ["submitted", "approved"],
    );
    const reportAssessments = await database
      .select({ revision: communityModerationAssessments.revision })
      .from(communityModerationAssessments)
      .where(eq(communityModerationAssessments.caseId, secondReport.caseId))
      .orderBy(communityModerationAssessments.revision);
    assert.deepEqual(
      reportAssessments.map((assessment) => assessment.revision),
      [1, 2, 3],
    );
  } finally {
    if (organizationId) {
      await client.begin(async (sqlClient) => {
        await sqlClient`set local session_replication_role = 'replica'`;
        await sqlClient`
          delete from community_moderation_events
          where organization_id = ${organizationId}
        `;
      });
      await client`
        delete from community_moderation_assessments
        where organization_id = ${organizationId}
      `;
      await client`
        delete from community_moderation_appeals
        where organization_id = ${organizationId}
      `;
      await client`
        delete from community_reports
        where organization_id = ${organizationId}
      `;
      await client`
        delete from community_moderation_cases
        where organization_id = ${organizationId}
      `;
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});
