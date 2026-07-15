import assert from "node:assert/strict";
import test from "node:test";

import { and, eq } from "drizzle-orm";

import {
  communityAreas,
  communityModerationCases,
  communitySpaces,
  organizations,
  posts,
  users,
} from "../src/db/schema";
import { ApiError } from "../src/lib/api/errors";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
process.env.DATABASE_URL = databaseUrl;
process.env.SESSION_SECRET ??=
  "community-governance-integration-session-secret-32-bytes";
process.env.AUTH_RATE_LIMIT_SECRET ??=
  "community-governance-integration-cursor-secret-32-bytes";

function isApiError(code: string, status: number) {
  return (error: unknown) =>
    error instanceof ApiError && error.code === code && error.status === status;
}

test("community governance API services enforce tenant, role, cursor and version contracts", async () => {
  const [{ db, postgresClient }, moderation, governance, queue] =
    await Promise.all([
      import("../src/db/index"),
      import("../src/lib/community-moderation-admin"),
      import("../src/lib/community-governance"),
      import("../src/lib/community-moderation-queue"),
    ]);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organizationIds: string[] = [];

  try {
    const [organization, foreignOrganization] = await db
      .insert(organizations)
      .values([
        { name: `Governance ${suffix}`, slug: `governance-${suffix}` },
        {
          name: `Foreign governance ${suffix}`,
          slug: `foreign-governance-${suffix}`,
        },
      ])
      .returning({ id: organizations.id, slug: organizations.slug });
    organizationIds.push(organization.id, foreignOrganization.id);

    const createdUsers = await db
      .insert(users)
      .values([
        {
          organizationId: organization.id,
          email: `owner-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Owner",
          lastName: "Governance",
          role: "owner",
        },
        {
          organizationId: organization.id,
          email: `trainer-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Trainer",
          lastName: "Denied",
          role: "trainer",
        },
        {
          organizationId: organization.id,
          email: `author-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Queue",
          lastName: "Author",
          role: "member",
        },
        {
          organizationId: foreignOrganization.id,
          email: `foreign-admin-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Foreign",
          lastName: "Admin",
          role: "admin",
        },
      ])
      .returning({
        id: users.id,
        organizationId: users.organizationId,
        role: users.role,
      });
    const owner = createdUsers.find((user) => user.role === "owner")!;
    const trainer = createdUsers.find((user) => user.role === "trainer")!;
    const author = createdUsers.find((user) => user.role === "member")!;
    const foreignAdmin = createdUsers.find(
      (user) => user.organizationId === foreignOrganization.id,
    )!;

    const [area] = await db
      .insert(communityAreas)
      .values({
        organizationId: organization.id,
        title: "Allgemein",
        slug: "allgemein",
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space] = await db
      .insert(communitySpaces)
      .values({
        organizationId: organization.id,
        areaId: area.id,
        title: `Governance queue ${suffix}`,
        slug: `governance-queue-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    const postRows = await db
      .insert(posts)
      .values(
        [90, 80, 70].map((priority) => ({
          organizationId: organization.id,
          spaceId: space.id,
          authorId: author.id,
          title: `Priority ${priority}`,
          content: `Queue content ${priority} ${suffix}`,
          moderationState: "pending" as const,
          moderationVersion: 1,
          publishedAt: null,
        })),
      )
      .returning({ id: posts.id, title: posts.title });
    const cases = await db
      .insert(communityModerationCases)
      .values(
        postRows.map((post, index) => ({
          organizationId: organization.id,
          targetType: "post" as const,
          targetId: post.id,
          targetAuthorId: author.id,
          contentVersion: 1,
          policyVersion: 1,
          reason: "manual" as const,
          priority: 90 - index * 10,
          status: "open" as const,
          decisionVersion: 1,
          createdAt: new Date(Date.now() + index * 1000),
        })),
      )
      .returning({
        id: communityModerationCases.id,
        priority: communityModerationCases.priority,
      });

    const firstPage = await queue.getCommunityModerationQueuePage({
      organizationId: organization.id,
      limit: 2,
    });
    assert.deepEqual(
      firstPage.items.map((item) => item.priority),
      [90, 80],
    );
    assert.equal(firstPage.hasMore, true);
    assert.ok(firstPage.nextCursor);
    for (const item of firstPage.items) {
      assert.equal(Object.hasOwn(item, "reporterId"), false);
      assert.equal(Object.hasOwn(item, "signals"), false);
    }

    const secondPage = await queue.getCommunityModerationQueuePage({
      organizationId: organization.id,
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    assert.deepEqual(
      secondPage.items.map((item) => item.priority),
      [70],
    );
    assert.equal(secondPage.hasMore, false);
    assert.equal(secondPage.nextCursor, null);
    await assert.rejects(
      queue.getCommunityModerationQueuePage({
        organizationId: organization.id,
        limit: 2,
        cursor: `${firstPage.nextCursor}tampered`,
      }),
      isApiError("bad_request", 400),
    );
    await assert.rejects(
      queue.getCommunityModerationQueuePage({
        organizationId: organization.id,
        targetType: "comment",
        limit: 2,
        cursor: firstPage.nextCursor!,
      }),
      isApiError("bad_request", 400),
    );

    const claimTarget = cases.find((item) => item.priority === 90)!;
    await assert.rejects(
      db.transaction((tx) =>
        moderation.claimCommunityModerationCase(tx, {
          organizationId: organization.id,
          actorId: trainer.id,
          caseId: claimTarget.id,
          expectedDecisionVersion: 1,
          expectedContentVersion: 1,
        }),
      ),
      isApiError("forbidden", 403),
    );
    await assert.rejects(
      db.transaction((tx) =>
        moderation.claimCommunityModerationCase(tx, {
          organizationId: foreignOrganization.id,
          actorId: foreignAdmin.id,
          caseId: claimTarget.id,
          expectedDecisionVersion: 1,
          expectedContentVersion: 1,
        }),
      ),
      isApiError("not_found", 404),
    );
    await assert.rejects(
      db.transaction((tx) =>
        moderation.claimCommunityModerationCase(tx, {
          organizationId: organization.id,
          actorId: owner.id,
          caseId: claimTarget.id,
          expectedDecisionVersion: 1,
          expectedContentVersion: 2,
        }),
      ),
      isApiError("conflict", 409),
    );
    const claimed = await db.transaction((tx) =>
      moderation.claimCommunityModerationCase(tx, {
        organizationId: organization.id,
        actorId: owner.id,
        caseId: claimTarget.id,
        expectedDecisionVersion: 1,
        expectedContentVersion: 1,
      }),
    );
    assert.deepEqual(
      {
        caseId: claimed.caseId,
        status: claimed.status,
        contentVersion: claimed.contentVersion,
        decisionVersion: claimed.decisionVersion,
      },
      {
        caseId: claimTarget.id,
        status: "reviewing",
        contentVersion: 1,
        decisionVersion: 2,
      },
    );

    const defaultPolicy = await governance.getCommunitySpaceModerationPolicy(
      organization.id,
      space.id,
    );
    assert.equal(defaultPolicy.version, 1);
    await assert.rejects(
      governance.updateCommunitySpaceModerationPolicy({
        organizationId: organization.id,
        actorId: trainer.id,
        spaceId: space.id,
        expectedVersion: 1,
        postApproval: "members",
        commentApproval: "off",
        automationMode: "observe",
        reportThreshold: 3,
        duplicateWindowMinutes: 30,
        linkLimit: 2,
      }),
      isApiError("forbidden", 403),
    );
    const policy = await governance.updateCommunitySpaceModerationPolicy({
      organizationId: organization.id,
      actorId: owner.id,
      spaceId: space.id,
      expectedVersion: 1,
      postApproval: "members",
      commentApproval: "off",
      automationMode: "observe",
      reportThreshold: 3,
      duplicateWindowMinutes: 30,
      linkLimit: 2,
    });
    assert.deepEqual(
      {
        spaceId: policy.spaceId,
        postApproval: policy.postApproval,
        automationMode: policy.automationMode,
        version: policy.version,
      },
      {
        spaceId: space.id,
        postApproval: "members",
        automationMode: "observe",
        version: 2,
      },
    );

    await assert.rejects(
      governance.replaceCommunityLevelConfiguration({
        organizationId: organization.id,
        actorId: trainer.id,
        expectedRevision: 1,
        enabled: false,
        levels: [],
      }),
      isApiError("forbidden", 403),
    );
    const levels = await governance.replaceCommunityLevelConfiguration({
      organizationId: organization.id,
      actorId: owner.id,
      expectedRevision: 1,
      enabled: true,
      levels: [
        {
          position: 1,
          name: "Start",
          description: "Startlevel",
          minPoints: 0,
          icon: "award",
          color: "#2bb7a9",
          active: true,
        },
      ],
    });
    assert.equal(levels.revision, 2);
    assert.equal(levels.levels.length, 1);

    const storedClaim = await db
      .select({
        status: communityModerationCases.status,
        decisionVersion: communityModerationCases.decisionVersion,
        contentVersion: communityModerationCases.contentVersion,
      })
      .from(communityModerationCases)
      .where(
        and(
          eq(communityModerationCases.organizationId, organization.id),
          eq(communityModerationCases.id, claimTarget.id),
        ),
      )
      .limit(1);
    assert.deepEqual(storedClaim[0], {
      status: "reviewing",
      decisionVersion: 2,
      contentVersion: 1,
    });
  } finally {
    for (const organizationId of organizationIds) {
      await db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
    await postgresClient.end();
  }
});
