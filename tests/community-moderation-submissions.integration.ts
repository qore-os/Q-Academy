import assert from "node:assert/strict";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import {
  communityAreas,
  communityModerationAppeals,
  communityModerationCases,
  communityReports,
  communitySpaces,
  organizations,
  posts,
  users,
} from "../src/db/schema";
import { queryOwnCommunityModerationSubmissions } from "../src/lib/community-moderation-submissions-core";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const client = postgres(databaseUrl, { max: 2, prepare: false });
const database = drizzle(client, { schema });

test("own moderation submissions are tenant-bound and expose only the author-safe projection", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const now = new Date("2026-07-12T12:00:00.000Z");
  const resolvedAt = new Date("2026-07-02T12:00:00.000Z");
  let organizationId = "";

  try {
    const [organization] = await database
      .insert(organizations)
      .values({
        name: `Own moderation ${suffix}`,
        slug: `own-moderation-${suffix}`,
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
          firstName: "Own",
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
          email: `reporter-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Secret",
          lastName: "Reporter",
          role: "trainer",
        },
        {
          organizationId,
          email: `reviewer-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Internal",
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
    const reporter = createdUsers.find((user) =>
      user.email.startsWith("reporter-"),
    )!;
    const reviewer = createdUsers.find((user) =>
      user.email.startsWith("reviewer-"),
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
        title: "Safe submissions",
        slug: `safe-submissions-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    const createdPosts = await database
      .insert(posts)
      .values([
        {
          organizationId,
          spaceId: space.id,
          authorId: author.id,
          title: "Eigener abgelehnter Beitrag",
          content: "Nur der Autor darf diesen verborgenen Inhalt lesen.",
          moderationState: "rejected",
          moderationVersion: 2,
          publishedAt: null,
          moderatedAt: resolvedAt,
          moderatedById: reviewer.id,
        },
        {
          organizationId,
          spaceId: space.id,
          authorId: author.id,
          title: "Eigener Beitrag mit Einspruch",
          content: "Dieser Inhalt befindet sich bereits im Einspruch.",
          moderationState: "rejected",
          moderationVersion: 2,
          publishedAt: null,
          moderatedAt: resolvedAt,
          moderatedById: reviewer.id,
        },
        {
          organizationId,
          spaceId: space.id,
          authorId: foreignAuthor.id,
          title: "Fremder verborgener Beitrag",
          content: "Dieser fremde Inhalt darf niemals ausgegeben werden.",
          moderationState: "rejected",
          moderationVersion: 2,
          publishedAt: null,
          moderatedAt: resolvedAt,
          moderatedById: reviewer.id,
        },
      ])
      .returning({ id: posts.id, title: posts.title });
    const ownRejectedPost = createdPosts.find(
      (post) => post.title === "Eigener abgelehnter Beitrag",
    )!;
    const ownAppealedPost = createdPosts.find(
      (post) => post.title === "Eigener Beitrag mit Einspruch",
    )!;
    const foreignPost = createdPosts.find(
      (post) => post.title === "Fremder verborgener Beitrag",
    )!;
    const createdCases = await database
      .insert(communityModerationCases)
      .values([
        {
          organizationId,
          targetType: "post",
          targetId: ownRejectedPost.id,
          targetAuthorId: author.id,
          contentVersion: 2,
          policyVersion: 91,
          reason: "report_threshold",
          priority: 99,
          status: "resolved",
          resolvedById: reviewer.id,
          resolvedAt,
          decisionVersion: 2,
          createdAt: new Date("2026-07-01T12:00:00.000Z"),
          updatedAt: resolvedAt,
        },
        {
          organizationId,
          targetType: "post",
          targetId: ownRejectedPost.id,
          targetAuthorId: author.id,
          contentVersion: 2,
          policyVersion: 90,
          reason: "manual",
          priority: 96,
          status: "resolved",
          resolvedById: reviewer.id,
          resolvedAt,
          decisionVersion: 2,
          createdAt: new Date("2026-06-30T12:00:00.000Z"),
          updatedAt: resolvedAt,
        },
        {
          organizationId,
          targetType: "post",
          targetId: ownAppealedPost.id,
          targetAuthorId: author.id,
          contentVersion: 2,
          policyVersion: 92,
          reason: "manual",
          priority: 98,
          status: "appealed",
          resolvedById: reviewer.id,
          resolvedAt,
          decisionVersion: 3,
          createdAt: new Date("2026-07-03T12:00:00.000Z"),
          updatedAt: new Date("2026-07-04T12:00:00.000Z"),
        },
        {
          organizationId,
          targetType: "post",
          targetId: foreignPost.id,
          targetAuthorId: foreignAuthor.id,
          contentVersion: 2,
          policyVersion: 93,
          reason: "manual",
          priority: 97,
          status: "resolved",
          resolvedById: reviewer.id,
          resolvedAt,
          decisionVersion: 2,
          createdAt: new Date("2026-07-05T12:00:00.000Z"),
          updatedAt: resolvedAt,
        },
      ])
      .returning({
        id: communityModerationCases.id,
        targetId: communityModerationCases.targetId,
        createdAt: communityModerationCases.createdAt,
      });
    const ownRejectedCase = createdCases.find(
      (moderationCase) =>
        moderationCase.targetId === ownRejectedPost.id &&
        moderationCase.createdAt.getTime() ===
          new Date("2026-07-01T12:00:00.000Z").getTime(),
    )!;
    const historicalOwnCase = createdCases.find(
      (moderationCase) =>
        moderationCase.targetId === ownRejectedPost.id &&
        moderationCase.id !== ownRejectedCase.id,
    )!;
    const ownAppealedCase = createdCases.find(
      (moderationCase) => moderationCase.targetId === ownAppealedPost.id,
    )!;
    await database.insert(communityModerationAppeals).values({
      organizationId,
      caseId: ownAppealedCase.id,
      appellantId: author.id,
      statement: "Mein bereits laufender Einspruch.",
      decisionVersion: 3,
      createdAt: new Date("2026-07-04T12:00:00.000Z"),
      updatedAt: new Date("2026-07-04T12:00:00.000Z"),
    });
    await database.insert(communityReports).values({
      organizationId,
      caseId: ownRejectedCase.id,
      reporterId: reporter.id,
      targetType: "post",
      targetId: ownRejectedPost.id,
      targetAuthorId: author.id,
      contentExcerpt: "Intern gespeicherter Report-Auszug",
      reason: "spam",
      details: "Geheime Reporter-Begruendung",
    });

    const result = await queryOwnCommunityModerationSubmissions(database, {
      organizationId,
      authorId: author.id,
      now,
      limit: 10,
    });
    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map((item) => item.title),
      [
        "Eigener Beitrag mit Einspruch",
        "Eigener abgelehnter Beitrag",
        "Eigener abgelehnter Beitrag",
      ],
    );
    const appealed = result.find((item) => item.caseId === ownAppealedCase.id)!;
    assert.equal(appealed.status, "appeal_pending");
    assert.equal(appealed.canAppeal, false);
    assert.deepEqual(appealed.appeal, {
      status: "pending",
      submittedAt: "2026-07-04T12:00:00.000Z",
      resolvedAt: null,
    });
    const eligible = result.find((item) => item.caseId === ownRejectedCase.id)!;
    assert.equal(eligible.reason, "report_threshold");
    assert.equal(eligible.reasonLabel, "Community-Pruefung erforderlich");
    assert.equal(eligible.targetTitle, "Eigener abgelehnter Beitrag");
    assert.equal(eligible.status, "rejected");
    assert.equal(eligible.canAppeal, true);
    assert.equal(eligible.appealDeadline, "2026-08-01T12:00:00.000Z");
    assert.equal(eligible.appeal, null);
    const historical = result.find(
      (item) => item.caseId === historicalOwnCase.id,
    )!;
    assert.equal(historical.canAppeal, false);
    assert.equal(historical.appealDeadline, "2026-08-01T12:00:00.000Z");
    assert.deepEqual(Object.keys(eligible).sort(), [
      "appeal",
      "appealDeadline",
      "canAppeal",
      "caseId",
      "excerpt",
      "reason",
      "reasonLabel",
      "spaceTitle",
      "status",
      "submittedAt",
      "targetTitle",
      "targetType",
      "title",
    ]);
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      reporter.id,
      reporter.email,
      reviewer.id,
      reviewer.email,
      foreignAuthor.id,
      "Fremder verborgener Beitrag",
      "Dieser fremde Inhalt darf niemals ausgegeben werden.",
      "Geheime Reporter-Begruendung",
      "Intern gespeicherter Report-Auszug",
      "policyVersion",
      "decisionVersion",
      "priority",
      "resolvedById",
      "reporterId",
    ]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  } finally {
    if (organizationId) {
      await client`
        delete from community_reports
        where organization_id = ${organizationId}
      `;
      await client`
        delete from community_moderation_appeals
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
