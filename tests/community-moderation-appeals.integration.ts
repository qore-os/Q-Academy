import assert from "node:assert/strict";
import test from "node:test";

import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import {
  communityAreas,
  communityModerationAppeals,
  communityModerationCases,
  communityModerationEvents,
  communitySpaceModerationPolicies,
  communitySpaces,
  organizations,
  posts,
  users,
} from "../src/db/schema";
import { ApiError } from "../src/lib/api/errors";
import { createCommunityModerationLifecycle } from "../src/lib/community-moderation-lifecycle-core";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const client = postgres(databaseUrl, { max: 4, prepare: false });
const database = drizzle(client, { schema });
const lifecycle = createCommunityModerationLifecycle({
  getSecret: () => "community-appeals-integration-secret-32-bytes",
});

function isApiError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof ApiError && error.code === code && error.status === status;
}

test("community moderation appeals enforce authorship, four-eyes review and optimistic concurrency", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let organizationId = "";

  try {
    const [organization] = await database
      .insert(organizations)
      .values({
        name: `Appeals ${suffix}`,
        slug: `appeals-${suffix}`,
      })
      .returning({ id: organizations.id });
    organizationId = organization.id;

    const createdUsers = await database
      .insert(users)
      .values([
        {
          organizationId,
          email: `author-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Appeal",
          lastName: "Author",
          role: "member",
        },
        {
          organizationId,
          email: `foreign-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Foreign",
          lastName: "Author",
          role: "member",
        },
        {
          organizationId,
          email: `original-admin-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Original",
          lastName: "Reviewer",
          role: "admin",
        },
        {
          organizationId,
          email: `independent-admin-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Independent",
          lastName: "Reviewer",
          role: "admin",
        },
      ])
      .returning({ id: users.id, email: users.email });
    const author = createdUsers.find((user) =>
      user.email.startsWith("author-"),
    )!;
    const foreignAuthor = createdUsers.find((user) =>
      user.email.startsWith("foreign-"),
    )!;
    const originalAdmin = createdUsers.find((user) =>
      user.email.startsWith("original-admin-"),
    )!;
    const independentAdmin = createdUsers.find((user) =>
      user.email.startsWith("independent-admin-"),
    )!;

    const [area] = await database
      .insert(communityAreas)
      .values({
        organizationId,
        title: "Allgemein",
        slug: "allgemein",
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space] = await database
      .insert(communitySpaces)
      .values({
        organizationId,
        areaId: area.id,
        title: "Appeals space",
        slug: `appeals-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    await database.insert(communitySpaceModerationPolicies).values({
      organizationId,
      spaceId: space.id,
      postApproval: "members",
      commentApproval: "members",
      automationMode: "off",
      reportThreshold: null,
      duplicateWindowMinutes: 0,
      linkLimit: 0,
      version: 1,
      updatedById: originalAdmin.id,
    });

    let contentSequence = 0;
    async function createRejectedPost(resolvedAt = new Date()) {
      contentSequence += 1;
      const content = `Appeal fixture ${contentSequence} ${suffix}`;
      const created = await database.transaction((tx) =>
        lifecycle.createCommunityContentWithModeration(tx, {
          organizationId,
          spaceId: space.id,
          targetType: "post",
          authorId: author.id,
          content,
          now: resolvedAt,
          persist: async (fields) => {
            const [post] = await tx
              .insert(posts)
              .values({
                organizationId,
                spaceId: space.id,
                authorId: author.id,
                content,
                ...fields,
              })
              .returning({ id: posts.id });
            return post;
          },
        }),
      );
      assert.equal(created.state, "pending");
      assert.ok(created.caseId);
      const rejected = await database.transaction((tx) =>
        lifecycle.decideCommunityModerationCase(tx, {
          organizationId,
          caseId: created.caseId!,
          actorId: originalAdmin.id,
          action: "reject",
          expectedDecisionVersion: 1,
          expectedContentVersion: 1,
          now: resolvedAt,
        }),
      );
      assert.equal(rejected.state, "rejected");
      return {
        caseId: created.caseId!,
        postId: created.record.id,
      };
    }

    const authorizationFixture = await createRejectedPost();
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: authorizationFixture.caseId,
          appellantId: foreignAuthor.id,
          expectedDecisionVersion: 2,
          statement: "Ich widerspreche dieser Entscheidung.",
        }),
      ),
      isApiError("forbidden", 403),
    );
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: authorizationFixture.caseId,
          appellantId: author.id,
          expectedDecisionVersion: 1,
          statement: "Ich widerspreche dieser Entscheidung.",
        }),
      ),
      isApiError("conflict", 409),
    );
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: authorizationFixture.caseId,
          appellantId: author.id,
          expectedDecisionVersion: 2,
          statement: " x ",
        }),
      ),
      isApiError("validation_error", 422),
    );

    const createdAppeal = await database.transaction((tx) =>
      lifecycle.createCommunityModerationAppeal(tx, {
        organizationId,
        caseId: authorizationFixture.caseId,
        appellantId: author.id,
        expectedDecisionVersion: 2,
        statement: " Die Ablehnung beruht auf einem Missverstaendnis. ",
      }),
    );
    assert.deepEqual(Object.keys(createdAppeal).sort(), [
      "appealId",
      "createdAt",
      "decisionVersion",
      "status",
    ]);
    assert.equal(createdAppeal.status, "appealed");
    assert.equal(createdAppeal.decisionVersion, 3);

    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.resolveCommunityModerationAppeal(tx, {
          organizationId,
          appealId: createdAppeal.appealId,
          actorId: originalAdmin.id,
          action: "uphold",
          expectedDecisionVersion: 3,
          expectedContentVersion: 2,
        }),
      ),
      isApiError("forbidden", 403),
    );
    const upheld = await database.transaction((tx) =>
      lifecycle.resolveCommunityModerationAppeal(tx, {
        organizationId,
        appealId: createdAppeal.appealId,
        actorId: independentAdmin.id,
        action: "uphold",
        expectedDecisionVersion: 3,
        expectedContentVersion: 2,
        note: "Unabhaengig erneut geprueft.",
      }),
    );
    assert.deepEqual(Object.keys(upheld).sort(), [
      "action",
      "appealId",
      "contentVersion",
      "decisionVersion",
      "firstPublish",
      "state",
      "status",
    ]);
    assert.equal(upheld.action, "uphold");
    assert.equal(upheld.state, "rejected");
    assert.equal(upheld.contentVersion, 3);
    assert.equal(upheld.decisionVersion, 4);
    assert.equal(upheld.firstPublish, null);
    const [storedUpheldAppeal] = await database
      .select({
        action: communityModerationAppeals.resolutionAction,
        resolvedById: communityModerationAppeals.resolvedById,
      })
      .from(communityModerationAppeals)
      .where(eq(communityModerationAppeals.id, createdAppeal.appealId));
    assert.deepEqual(storedUpheldAppeal, {
      action: "appeal_upheld",
      resolvedById: independentAdmin.id,
    });
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.resolveCommunityModerationAppeal(tx, {
          organizationId,
          appealId: createdAppeal.appealId,
          actorId: independentAdmin.id,
          action: "overturn",
          expectedDecisionVersion: 3,
          expectedContentVersion: 2,
        }),
      ),
      isApiError("conflict", 409),
    );

    const expiredAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 - 1);
    const expiredFixture = await createRejectedPost(expiredAt);
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: expiredFixture.caseId,
          appellantId: author.id,
          expectedDecisionVersion: 2,
          statement: "Dieser Einspruch kommt zu spaet.",
        }),
      ),
      isApiError("conflict", 409),
    );

    const historicalFixture = await createRejectedPost();
    const newerCaseTime = new Date(Date.now() + 1_000);
    await database.insert(communityModerationCases).values({
      organizationId,
      targetType: "post",
      targetId: historicalFixture.postId,
      targetAuthorId: author.id,
      contentVersion: 2,
      policyVersion: 1,
      reason: "manual",
      priority: 50,
      status: "resolved",
      resolvedById: originalAdmin.id,
      resolvedAt: newerCaseTime,
      decisionVersion: 2,
      createdAt: newerCaseTime,
      updatedAt: newerCaseTime,
    });
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: historicalFixture.caseId,
          appellantId: author.id,
          expectedDecisionVersion: 2,
          statement: "Ein alter Fall darf nicht erneut angefochten werden.",
        }),
      ),
      isApiError("conflict", 409),
    );

    const inactiveFixture = await createRejectedPost();
    await database
      .update(users)
      .set({ status: "disabled" })
      .where(eq(users.id, author.id));
    await assert.rejects(
      database.transaction((tx) =>
        lifecycle.createCommunityModerationAppeal(tx, {
          organizationId,
          caseId: inactiveFixture.caseId,
          appellantId: author.id,
          expectedDecisionVersion: 2,
          statement: "Ein gesperrtes Mitglied darf nicht widersprechen.",
        }),
      ),
      isApiError("not_found", 404),
    );
    await database
      .update(users)
      .set({ status: "active" })
      .where(eq(users.id, author.id));

    const parallelFixture = await createRejectedPost();
    const parallelAppealResults = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        database.transaction((tx) =>
          lifecycle.createCommunityModerationAppeal(tx, {
            organizationId,
            caseId: parallelFixture.caseId,
            appellantId: author.id,
            expectedDecisionVersion: 2,
            statement: "Paralleler, aber nur einmal gueltiger Einspruch.",
          }),
        ),
      ),
    );
    assert.equal(
      parallelAppealResults.filter((result) => result.status === "fulfilled")
        .length,
      1,
    );
    const rejectedParallelAppeal = parallelAppealResults.find(
      (result) => result.status === "rejected",
    );
    assert.ok(rejectedParallelAppeal?.status === "rejected");
    assert.equal(
      isApiError("conflict", 409)(rejectedParallelAppeal.reason),
      true,
    );
    const acceptedParallelAppeal = parallelAppealResults.find(
      (result) => result.status === "fulfilled",
    );
    assert.ok(acceptedParallelAppeal?.status === "fulfilled");
    const [openAppealCount] = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(communityModerationAppeals)
      .where(
        and(
          eq(communityModerationAppeals.caseId, parallelFixture.caseId),
          sql`${communityModerationAppeals.resolutionAction} is null`,
        ),
      );
    assert.equal(openAppealCount.count, 1);

    const firstPublishEffects: string[] = [];
    const parallelResolutionResults = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        database.transaction((tx) =>
          lifecycle.resolveCommunityModerationAppeal(tx, {
            organizationId,
            appealId: acceptedParallelAppeal.value.appealId,
            actorId: independentAdmin.id,
            action: "overturn",
            expectedDecisionVersion: 3,
            expectedContentVersion: 2,
            onFirstPublish: async (effect) => {
              firstPublishEffects.push(effect.targetId);
            },
          }),
        ),
      ),
    );
    assert.equal(
      parallelResolutionResults.filter(
        (result) => result.status === "fulfilled",
      ).length,
      1,
    );
    const rejectedParallelResolution = parallelResolutionResults.find(
      (result) => result.status === "rejected",
    );
    assert.ok(rejectedParallelResolution?.status === "rejected");
    assert.equal(
      isApiError("conflict", 409)(rejectedParallelResolution.reason),
      true,
    );
    const acceptedParallelResolution = parallelResolutionResults.find(
      (result) => result.status === "fulfilled",
    );
    assert.ok(acceptedParallelResolution?.status === "fulfilled");
    assert.equal(acceptedParallelResolution.value.state, "published");
    assert.ok(acceptedParallelResolution.value.firstPublish);
    assert.equal(firstPublishEffects.length, 1);
    assert.deepEqual(firstPublishEffects, [parallelFixture.postId]);
    const [firstPublishedPost] = await database
      .select({
        state: posts.moderationState,
        publishedAt: posts.publishedAt,
      })
      .from(posts)
      .where(eq(posts.id, parallelFixture.postId));
    assert.equal(firstPublishedPost.state, "published");
    assert.ok(firstPublishedPost.publishedAt);

    await database
      .update(communitySpaceModerationPolicies)
      .set({
        postApproval: "off",
        automationMode: "observe",
        linkLimit: 1,
        version: 2,
      })
      .where(
        and(
          eq(communitySpaceModerationPolicies.organizationId, organizationId),
          eq(communitySpaceModerationPolicies.spaceId, space.id),
        ),
      );
    const publishedContent =
      "Bereits sichtbar mit https://example.test und https://example.org";
    const initiallyPublished = await database.transaction((tx) =>
      lifecycle.createCommunityContentWithModeration(tx, {
        organizationId,
        spaceId: space.id,
        targetType: "post",
        authorId: author.id,
        content: publishedContent,
        persist: async (fields) => {
          const [post] = await tx
            .insert(posts)
            .values({
              organizationId,
              spaceId: space.id,
              authorId: author.id,
              content: publishedContent,
              ...fields,
            })
            .returning({ id: posts.id });
          return post;
        },
      }),
    );
    assert.equal(initiallyPublished.state, "published");
    assert.ok(initiallyPublished.caseId);
    const [initialPublishedRow] = await database
      .select({ publishedAt: posts.publishedAt })
      .from(posts)
      .where(eq(posts.id, initiallyPublished.record.id));
    assert.ok(initialPublishedRow.publishedAt);
    await database.transaction((tx) =>
      lifecycle.decideCommunityModerationCase(tx, {
        organizationId,
        caseId: initiallyPublished.caseId!,
        actorId: originalAdmin.id,
        action: "reject",
        expectedDecisionVersion: 1,
        expectedContentVersion: 1,
      }),
    );
    const existingPublicationAppeal = await database.transaction((tx) =>
      lifecycle.createCommunityModerationAppeal(tx, {
        organizationId,
        caseId: initiallyPublished.caseId!,
        appellantId: author.id,
        expectedDecisionVersion: 2,
        statement: "Dieser Beitrag war bereits korrekt veroeffentlicht.",
      }),
    );
    const repeatedPublishEffects: string[] = [];
    const restoredPublication = await database.transaction((tx) =>
      lifecycle.resolveCommunityModerationAppeal(tx, {
        organizationId,
        appealId: existingPublicationAppeal.appealId,
        actorId: independentAdmin.id,
        action: "overturn",
        expectedDecisionVersion: 3,
        expectedContentVersion: 2,
        onFirstPublish: async (effect) => {
          repeatedPublishEffects.push(effect.targetId);
        },
      }),
    );
    assert.equal(restoredPublication.state, "published");
    assert.equal(restoredPublication.firstPublish, null);
    assert.deepEqual(repeatedPublishEffects, []);
    const [restoredPublishedRow] = await database
      .select({ publishedAt: posts.publishedAt })
      .from(posts)
      .where(eq(posts.id, initiallyPublished.record.id));
    assert.equal(
      restoredPublishedRow.publishedAt?.getTime(),
      initialPublishedRow.publishedAt?.getTime(),
    );

    const appealEvents = await database
      .select({ action: communityModerationEvents.action })
      .from(communityModerationEvents)
      .where(eq(communityModerationEvents.caseId, authorizationFixture.caseId))
      .orderBy(communityModerationEvents.createdAt);
    assert.deepEqual(
      appealEvents.map((event) => event.action),
      ["submitted", "rejected", "appealed", "appeal_upheld"],
    );
    const [resolvedCase] = await database
      .select({
        status: communityModerationCases.status,
        decisionVersion: communityModerationCases.decisionVersion,
        contentVersion: communityModerationCases.contentVersion,
      })
      .from(communityModerationCases)
      .where(eq(communityModerationCases.id, authorizationFixture.caseId));
    assert.deepEqual(resolvedCase, {
      status: "resolved",
      decisionVersion: 4,
      contentVersion: 3,
    });
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
