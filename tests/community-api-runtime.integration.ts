/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime API envelopes are inspected recursively as untrusted JSON. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const sql = postgres(databaseUrl, { max: 3, prepare: false });

after(() => sql.end());

type ApiResult = {
  status: number;
  body: Record<string, any>;
};

const internalKeys = new Set([
  "organizationId",
  "organization_id",
  "moderationFingerprint",
  "moderation_fingerprint",
  "moderatedById",
  "moderated_by_id",
  "moderatorId",
  "moderator_id",
]);

const privateMemberKeys = new Set([
  "email",
  "phone",
  "passwordHash",
  "password_hash",
  "points",
]);

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function createApiKey(input: {
  organizationId: string;
  creatorId: string;
  scopes: string[];
  name: string;
}) {
  const token = `qak_test_${randomBytes(28).toString("base64url")}`;
  await sql`
    insert into api_keys (
      organization_id, name, prefix, key_hash, scopes, created_by_id
    ) values (
      ${input.organizationId}, ${input.name}, 'qak_test', ${hashToken(token)},
      ${input.scopes}, ${input.creatorId}
    )
  `;
  return token;
}

async function api(
  token: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (method !== "GET") headers["Idempotency-Key"] = randomUUID();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let parsed: Record<string, any>;
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, any>) : {};
  } catch {
    assert.fail(`${method} ${path} returned non-JSON status ${response.status}: ${raw}`);
  }
  return { status: response.status, body: parsed! };
}

function expectStatus(result: ApiResult, status: number) {
  assert.equal(
    result.status,
    status,
    `Expected ${status}, received ${result.status}: ${JSON.stringify(result.body)}`,
  );
  return result.body;
}

function expectProblem(result: ApiResult, status: number, code: string) {
  const body = expectStatus(result, status);
  assert.equal(body.code, code, JSON.stringify(body));
  return body;
}

function assertNoKeys(value: unknown, forbidden: ReadonlySet<string>, label: string) {
  if (Array.isArray(value)) {
    for (const item of value) assertNoKeys(item, forbidden, label);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `${label} exposed ${key}.`);
    assertNoKeys(child, forbidden, label);
  }
}

function expectPublic(result: ApiResult, status = 200) {
  const body = expectStatus(result, status);
  assertNoKeys(body, internalKeys, "Public community response");
  return body.data;
}

function assertPublicMemberShape(value: unknown, label: string) {
  assertNoKeys(value, internalKeys, label);
  assertNoKeys(value, privateMemberKeys, label);
}

const richText = (text: string) => ({
  version: 1,
  blocks: [
    {
      type: "paragraph",
      children: [{ type: "text", text }],
    },
  ],
});

test(
  "community REST surface enforces tenant, profile, DTO, visibility and leaderboard contracts",
  { timeout: 180_000 },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const organizationIds: string[] = [];

    try {
      const organizations = await sql<
        Array<{ id: string; slug: string }>
      >`
        insert into organizations (name, slug) values
          (${`Community API QA ${suffix}`}, ${`community-api-qa-${suffix}`}),
          (${`Foreign Community QA ${suffix}`}, ${`foreign-community-qa-${suffix}`})
        returning id, slug
      `;
      const organization = organizations[0]!;
      const foreignOrganization = organizations[1]!;
      organizationIds.push(organization.id, foreignOrganization.id);

      const members = await sql<
        Array<{
          id: string;
          firstName: string;
          role: string;
          status: string;
        }>
      >`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          avatar_url, role, status, department, phone, bio, points,
          community_points
        ) values
          (${organization.id}, ${`owner-${suffix}@example.test`}, 'unused', 'Owner', 'QA', '/images/qa-owner.png', 'owner', 'active', 'Owner Secret', '+49111111111', null, 8000, 80),
          (${organization.id}, ${`complete-${suffix}@example.test`}, 'unused', 'Complete', 'Member', '/images/qa-complete.png', 'member', 'active', 'Learning Secret', '+49222222222', 'Complete bio', 9999, 40),
          (${organization.id}, ${`incomplete-${suffix}@example.test`}, 'unused', 'Incomplete', 'Member', '/images/qa-incomplete.png', 'member', 'active', 'Community Team', '+49333333333', null, 1, 120),
          (${organization.id}, ${`future-disabled-${suffix}@example.test`}, 'unused', 'Future', 'Disabled', '/images/qa-future.png', 'member', 'active', 'Archive', '+49444444444', 'Visible until disabled', 3000, 30),
          (${organization.id}, ${`disabled-${suffix}@example.test`}, 'unused', 'Already', 'Disabled', '/images/qa-disabled.png', 'member', 'disabled', 'Disabled Secret', '+49555555555', 'Disabled bio', 7000, 500),
          (${foreignOrganization.id}, ${`foreign-${suffix}@example.test`}, 'unused', 'Foreign', 'Member', '/images/qa-foreign.png', 'owner', 'active', 'Foreign Secret', '+49666666666', 'Foreign bio', 9000, 900)
        returning id, first_name as "firstName", role, status
      `;
      const owner = members.find((member) => member.firstName === "Owner")!;
      const complete = members.find((member) => member.firstName === "Complete")!;
      const incomplete = members.find(
        (member) => member.firstName === "Incomplete",
      )!;
      const futureDisabled = members.find(
        (member) => member.firstName === "Future",
      )!;
      const disabled = members.find((member) => member.firstName === "Already")!;
      const foreignOwner = members.find(
        (member) => member.firstName === "Foreign",
      )!;

      const ownerToken = await createApiKey({
        organizationId: organization.id,
        creatorId: owner.id,
        scopes: [
          "community:read",
          "community:write",
          "search:read",
          "members:read",
        ],
        name: "Community owner QA",
      });
      const memberToken = await createApiKey({
        organizationId: organization.id,
        creatorId: incomplete.id,
        scopes: ["community:read", "community:write"],
        name: "Community member QA",
      });
      const searchOnlyToken = await createApiKey({
        organizationId: organization.id,
        creatorId: owner.id,
        scopes: ["search:read"],
        name: "Search-only QA",
      });
      const wildcardToken = await createApiKey({
        organizationId: organization.id,
        creatorId: owner.id,
        scopes: ["*"],
        name: "Wildcard QA",
      });
      const foreignToken = await createApiKey({
        organizationId: foreignOrganization.id,
        creatorId: foreignOwner.id,
        scopes: ["community:read", "community:write"],
        name: "Foreign Community QA",
      });

      const defaultProfileSettings = expectStatus(
        await api(ownerToken, "GET", "/api/v1/community/profile-settings"),
        200,
      ).data;
      assert.equal(defaultProfileSettings.settings.revision, 0);
      assert.equal(defaultProfileSettings.incompleteActiveMemberCount, 0);
      expectProblem(
        await api(memberToken, "GET", "/api/v1/community/profile-settings"),
        403,
        "forbidden",
      );

      expectProblem(
        await api(memberToken, "POST", "/api/v1/community/areas", {
          title: "Member area",
        }),
        403,
        "forbidden",
      );
      const areaA = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/areas", {
          title: "General",
          slug: `general-${suffix}`,
          position: 0,
        }),
        201,
      );
      const areaB = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/areas", {
          title: "Projects",
          slug: `projects-${suffix}`,
          position: 1,
        }),
        201,
      );
      const temporaryArea = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/areas", {
          title: "Temporary",
          slug: `temporary-${suffix}`,
          position: 2,
        }),
        201,
      );
      expectPublic(
        await api(
          ownerToken,
          "PATCH",
          `/api/v1/community/areas/${areaA.id}`,
          { description: "Tenant-safe area" },
        ),
      );
      const movedArea = expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/areas/${areaB.id}/move`,
          { position: 0 },
        ),
      );
      assert.equal(movedArea.position, 0);
      const areaList = expectPublic(
        await api(ownerToken, "GET", "/api/v1/community/areas"),
      );
      assert.equal(areaList[0].id, areaB.id);
      expectPublic(
        await api(
          ownerToken,
          "DELETE",
          `/api/v1/community/areas/${temporaryArea.id}`,
        ),
      );
      expectProblem(
        await api(
          foreignToken,
          "GET",
          `/api/v1/community/areas/${areaA.id}`,
        ),
        404,
        "not_found",
      );

      const discussion = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/spaces", {
          areaId: areaA.id,
          title: "Questions",
          slug: `questions-${suffix}`,
          type: "discussion",
          position: 0,
        }),
        201,
      );
      const movableSpace = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/spaces", {
          areaId: areaA.id,
          title: "Move me",
          slug: `move-me-${suffix}`,
          type: "feed",
          position: 1,
        }),
        201,
      );
      const temporarySpace = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/spaces", {
          areaId: areaB.id,
          title: "Delete me",
          slug: `delete-me-${suffix}`,
          type: "feed",
          position: 0,
        }),
        201,
      );
      expectProblem(
        await api(memberToken, "POST", "/api/v1/community/spaces", {
          areaId: areaA.id,
          title: "Denied",
        }),
        403,
        "forbidden",
      );
      expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/spaces/${movableSpace.id}/move`,
          { areaId: areaB.id, position: 1 },
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "DELETE",
          `/api/v1/community/spaces/${temporarySpace.id}`,
        ),
      );
      const policy = expectPublic(
        await api(
          ownerToken,
          "PUT",
          `/api/v1/community/spaces/${discussion.id}/access-policy`,
          {
            accessMode: "restricted",
            rules: [
              {
                subjectType: "role",
                subjectRole: "member",
                canView: true,
                canPost: true,
                canComment: true,
              },
            ],
          },
        ),
      );
      assert.equal(policy.rules[0].subjectUserId, null);
      expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/spaces/${discussion.id}/access-policy`,
        ),
      );
      expectProblem(
        await api(
          foreignToken,
          "GET",
          `/api/v1/community/spaces/${discussion.id}`,
        ),
        404,
        "not_found",
      );

      expectProblem(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 0,
          completionGateEnabled: true,
          fields: [{ standardField: null, requiredForPosting: true }],
        }),
        422,
        "validation_error",
      );
      expectProblem(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 0,
          completionGateEnabled: true,
          fields: [{ standardField: "email", requiredForPosting: true }],
        }),
        422,
        "validation_error",
      );
      const profileSettings = expectStatus(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 0,
          completionGateEnabled: true,
          fields: [
            { standardField: "avatar" },
            { standardField: "department" },
            { standardField: "bio", requiredForPosting: true },
            { standardField: "community_points" },
            { standardField: "badges" },
          ],
        }),
        200,
      ).data;
      assert.equal(profileSettings.settings.revision, 1);
      assert.equal(profileSettings.incompleteActiveMemberCount, 2);
      expectProblem(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 0,
          completionGateEnabled: false,
          fields: [],
        }),
        409,
        "conflict",
      );

      const incompleteCompletion = expectPublic(
        await api(memberToken, "GET", "/api/v1/community/profile-completion"),
      );
      assert.equal(incompleteCompletion.complete, false);
      assert.equal(incompleteCompletion.missingFields[0].key, "bio");
      for (const authorId of [owner.id, incomplete.id]) {
        expectProblem(
          await api(ownerToken, "POST", "/api/v1/community/posts", {
            spaceId: discussion.id,
            authorId,
            title: "Blocked by profile",
            content: "This post must not be created",
          }),
          422,
          "profile_incomplete",
        );
      }

      const seedPost = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/posts", {
          spaceId: discussion.id,
          authorId: complete.id,
          title: "Gate seed",
          content: "A complete author can post",
        }),
        201,
      );
      const seedComment = expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${seedPost.id}/comments`,
          { authorId: complete.id, content: "Complete root comment" },
        ),
        201,
      );
      expectProblem(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${seedPost.id}/comments`,
          {
            authorId: owner.id,
            parentId: seedComment.id,
            content: "Incomplete owner reply",
          },
        ),
        422,
        "profile_incomplete",
      );
      expectProblem(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${seedPost.id}/comments`,
          {
            authorId: incomplete.id,
            parentId: seedComment.id,
            content: "Incomplete act-as reply",
          },
        ),
        422,
        "profile_incomplete",
      );

      await sql`
        update users
        set bio = case
          when id = ${owner.id} then 'Owner bio'
          when id = ${incomplete.id} then 'Completed member bio'
          else bio
        end
        where organization_id = ${organization.id}
          and id in (${owner.id}, ${incomplete.id})
      `;
      const completeCompletion = expectPublic(
        await api(memberToken, "GET", "/api/v1/community/profile-completion"),
      );
      assert.equal(completeCompletion.complete, true);

      const profile = expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/profiles/${complete.id}`,
        ),
      );
      assertPublicMemberShape(profile, "Public community profile");
      assert.ok(profile.avatarUrl);
      assert.equal(profile.department, "Learning Secret");
      assert.equal(profile.communityPoints, 40);
      assert.equal(
        JSON.stringify(profile).includes(`complete-${suffix}@example.test`),
        false,
      );
      expectProblem(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/profiles/${disabled.id}`,
        ),
        404,
        "not_found",
      );
      expectProblem(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/profiles/${foreignOwner.id}`,
        ),
        404,
        "not_found",
      );
      expectProblem(
        await api(
          foreignToken,
          "GET",
          `/api/v1/community/profiles/${complete.id}`,
        ),
        404,
        "not_found",
      );

      const rich = richText("Rich roundtrip body");
      expectProblem(
        await api(memberToken, "POST", "/api/v1/community/posts", {
          spaceId: discussion.id,
          authorId: incomplete.id,
          title: "Neither",
        }),
        422,
        "validation_error",
      );
      expectProblem(
        await api(memberToken, "POST", "/api/v1/community/posts", {
          spaceId: discussion.id,
          authorId: incomplete.id,
          title: "Both",
          content: "Plain body",
          richText: rich,
        }),
        422,
        "validation_error",
      );
      const richPost = expectPublic(
        await api(memberToken, "POST", "/api/v1/community/posts", {
          spaceId: discussion.id,
          authorId: incomplete.id,
          title: "Rich post",
          richText: rich,
        }),
        201,
      );
      assert.equal(richPost.content, "Rich roundtrip body");
      assert.equal(richPost.contentFormat, "rich_text");
      assert.equal(richPost.contentProjectionVersion, 1);
      assert.deepEqual(richPost.richText, rich);

      expectProblem(
        await api(
          memberToken,
          "PATCH",
          `/api/v1/community/posts/${richPost.id}`,
          {
            expectedContentVersion: richPost.moderationVersion,
            content: "Plain update",
            richText: richText("Conflicting update"),
          },
        ),
        422,
        "validation_error",
      );
      const updatedPost = expectPublic(
        await api(
          memberToken,
          "PATCH",
          `/api/v1/community/posts/${richPost.id}`,
          {
            expectedContentVersion: richPost.moderationVersion,
            richText: richText("Updated rich body"),
          },
        ),
      );
      assert.equal(updatedPost.content, "Updated rich body");
      assert.equal(updatedPost.contentFormat, "rich_text");

      const richComment = expectPublic(
        await api(
          memberToken,
          "POST",
          `/api/v1/community/posts/${richPost.id}/comments`,
          { authorId: incomplete.id, richText: richText("Rich comment") },
        ),
        201,
      );
      assert.equal(richComment.content, "Rich comment");
      assert.equal(richComment.contentFormat, "rich_text");
      expectProblem(
        await api(
          memberToken,
          "PATCH",
          `/api/v1/community/comments/${richComment.id}`,
          { expectedContentVersion: richComment.moderationVersion },
        ),
        422,
        "validation_error",
      );
      expectProblem(
        await api(
          memberToken,
          "PATCH",
          `/api/v1/community/comments/${richComment.id}`,
          {
            expectedContentVersion: richComment.moderationVersion,
            content: "Plain comment update",
            richText: richText("Conflict"),
          },
        ),
        422,
        "validation_error",
      );
      const updatedComment = expectPublic(
        await api(
          memberToken,
          "PATCH",
          `/api/v1/community/comments/${richComment.id}`,
          {
            expectedContentVersion: richComment.moderationVersion,
            content: "Plain comment update",
          },
        ),
      );
      assert.equal(updatedComment.contentFormat, "plain_text");
      assert.equal(updatedComment.richText, null);

      await sql`
        update posts set
          moderation_fingerprint = ${"a".repeat(64)},
          moderated_by_id = ${owner.id}
        where id = ${richPost.id}
      `;
      await sql`
        update comments set
          moderation_fingerprint = ${"b".repeat(64)},
          moderated_by_id = ${owner.id}
        where id = ${richComment.id}
      `;
      expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/posts/${richPost.id}`,
        ),
      );
      expectPublic(
        await api(ownerToken, "GET", "/api/v1/community/posts?limit=100"),
      );
      expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/posts/${richPost.id}/comments?limit=100`,
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/comments/${richComment.id}`,
        ),
      );

      expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${richPost.id}/reactions`,
          { userId: owner.id, reaction: "celebrate" },
        ),
        201,
      );
      const reactions = expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/posts/${richPost.id}/reactions?limit=100`,
        ),
      );
      assertPublicMemberShape(reactions, "Post reaction list");
      assert.ok(reactions[0].avatarUrl);
      expectPublic(
        await api(
          ownerToken,
          "PUT",
          `/api/v1/community/posts/${richPost.id}/reactions/${complete.id}`,
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "DELETE",
          `/api/v1/community/posts/${richPost.id}/reactions/${complete.id}`,
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${richPost.id}/votes`,
          { userId: owner.id, value: 1 },
        ),
      );
      const votes = expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/posts/${richPost.id}/votes?limit=100`,
        ),
      );
      assertPublicMemberShape(votes, "Post vote list");
      expectPublic(
        await api(
          ownerToken,
          "PUT",
          `/api/v1/community/comments/${richComment.id}/reactions`,
          { userId: owner.id, reaction: "insightful" },
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/comments/${richComment.id}/reactions?userId=${owner.id}`,
        ),
      );
      expectPublic(
        await api(
          ownerToken,
          "DELETE",
          `/api/v1/community/comments/${richComment.id}/reactions?userId=${owner.id}`,
        ),
      );

      const follow = expectPublic(
        await api(
          ownerToken,
          "PUT",
          `/api/v1/community/follows/author/${complete.id}`,
          { notify: false },
        ),
      );
      assert.ok(follow.targetAvatarUrl);
      const follows = expectPublic(
        await api(ownerToken, "GET", "/api/v1/community/follows?limit=100"),
      );
      assertPublicMemberShape(follows, "Community follow list");

      const searchQuery = `/api/v1/search?q=Complete&types=members&limit=10`;
      expectProblem(
        await api(searchOnlyToken, "GET", searchQuery),
        403,
        "insufficient_scope",
      );
      expectPublic(await api(ownerToken, "GET", searchQuery));
      expectPublic(await api(wildcardToken, "GET", searchQuery));

      const [badge] = await sql<Array<{ id: string }>>`
        insert into badge_definitions (
          organization_id, name, slug, description, icon, color
        ) values (
          ${organization.id}, 'Community QA Badge', ${`community-qa-${suffix}`},
          'Visible only when configured', 'award', '#228866'
        ) returning id
      `;
      await sql`
        insert into user_badges (organization_id, user_id, badge_id, source)
        values (${organization.id}, ${incomplete.id}, ${badge!.id}, 'manual:qa')
      `;
      await sql`
        insert into community_level_settings (
          organization_id, enabled, revision, updated_by_id
        ) values (${organization.id}, true, 1, ${owner.id})
        on conflict (organization_id) do update set
          enabled = excluded.enabled,
          revision = community_level_settings.revision + 1,
          updated_by_id = excluded.updated_by_id,
          updated_at = now()
      `;
      await sql`
        insert into community_levels (
          organization_id, position, name, description, min_points, icon,
          color, active
        ) values
          (${organization.id}, 1, 'Starter', 'Starts here', 0, 'award', '#228866', true),
          (${organization.id}, 2, 'Pro', 'One hundred points', 100, 'star', '#3344aa', true)
      `;
      await sql`
        update users set
          points = case
            when id = ${complete.id} then 9999
            when id = ${owner.id} then 8000
            when id = ${incomplete.id} then 1
            else points
          end,
          community_points = case
            when id = ${complete.id} then 40
            when id = ${owner.id} then 80
            when id = ${incomplete.id} then 120
            when id = ${futureDisabled.id} then 30
            else community_points
          end
        where organization_id = ${organization.id}
      `;
      const leaderboard = expectPublic(
        await api(ownerToken, "GET", "/api/v1/leaderboard?limit=3"),
      );
      assert.deepEqual(
        leaderboard.map((entry: { id: string }) => entry.id),
        [incomplete.id, owner.id, complete.id],
      );
      assert.equal(leaderboard[0].communityPoints, 120);
      assert.equal(leaderboard[0].rank, 1);
      assert.equal(leaderboard[0].level.name, "Pro");
      assert.equal(leaderboard[0].badgeCount, 1);
      assert.ok(leaderboard[0].avatarUrl);
      assert.equal(leaderboard[0].department, "Community Team");
      assertPublicMemberShape(leaderboard, "Community leaderboard");

      const hiddenSettings = expectStatus(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 1,
          completionGateEnabled: true,
          fields: [
            { standardField: "bio", requiredForPosting: true },
            { standardField: "community_points" },
          ],
        }),
        200,
      ).data;
      assert.equal(hiddenSettings.settings.revision, 2);
      const hiddenLeaderboard = expectPublic(
        await api(ownerToken, "GET", "/api/v1/leaderboard?limit=3"),
      );
      assert.equal(hiddenLeaderboard[0].avatarUrl, null);
      assert.equal(hiddenLeaderboard[0].department, null);
      assert.deepEqual(hiddenLeaderboard[0].badges, []);
      assert.equal(hiddenLeaderboard[0].badgeCount, 0);
      const hiddenFollows = expectPublic(
        await api(ownerToken, "GET", "/api/v1/community/follows?limit=100"),
      );
      assert.equal(hiddenFollows[0].targetAvatarUrl, null);
      const hiddenReactions = expectPublic(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/posts/${richPost.id}/reactions?limit=100`,
        ),
      );
      assert.equal(hiddenReactions[0].avatarUrl, null);
      assert.equal(hiddenReactions[0].profile.department, null);

      const pointsHiddenSettings = expectStatus(
        await api(ownerToken, "PUT", "/api/v1/community/profile-settings", {
          expectedRevision: 2,
          completionGateEnabled: true,
          fields: [{ standardField: "bio", requiredForPosting: true }],
        }),
        200,
      ).data;
      assert.equal(pointsHiddenSettings.settings.revision, 3);
      assert.deepEqual(
        expectPublic(
          await api(ownerToken, "GET", "/api/v1/leaderboard?limit=100"),
        ),
        [],
      );

      const inactivePost = expectPublic(
        await api(ownerToken, "POST", "/api/v1/community/posts", {
          spaceId: discussion.id,
          authorId: futureDisabled.id,
          title: "Soon hidden",
          content: "Author visibility must be rechecked",
        }),
        201,
      );
      const inactiveComment = expectPublic(
        await api(
          ownerToken,
          "POST",
          `/api/v1/community/posts/${inactivePost.id}/comments`,
          {
            authorId: futureDisabled.id,
            content: "Comment visibility must be rechecked",
          },
        ),
        201,
      );
      await sql`
        update users set status = 'disabled'
        where organization_id = ${organization.id} and id = ${futureDisabled.id}
      `;

      for (const [method, path, body] of [
        ["GET", `/api/v1/community/posts/${inactivePost.id}`, undefined],
        ["GET", `/api/v1/community/posts/${inactivePost.id}/comments`, undefined],
        ["GET", `/api/v1/community/posts/${inactivePost.id}/reactions`, undefined],
        ["GET", `/api/v1/community/posts/${inactivePost.id}/votes`, undefined],
        ["POST", `/api/v1/community/posts/${inactivePost.id}/reactions`, { userId: owner.id, reaction: "like" }],
        ["POST", `/api/v1/community/posts/${inactivePost.id}/votes`, { userId: owner.id, value: 1 }],
        ["GET", `/api/v1/community/comments/${inactiveComment.id}`, undefined],
        ["GET", `/api/v1/community/comments/${inactiveComment.id}/reactions`, undefined],
        ["PUT", `/api/v1/community/comments/${inactiveComment.id}/reactions`, { userId: owner.id, reaction: "like" }],
      ] as const) {
        expectProblem(
          await api(ownerToken, method, path, body),
          404,
          "not_found",
        );
      }
      const finalPosts = expectPublic(
        await api(ownerToken, "GET", "/api/v1/community/posts?limit=100"),
      );
      assert.equal(
        finalPosts.some((post: { id: string }) => post.id === inactivePost.id),
        false,
      );
      expectProblem(
        await api(
          ownerToken,
          "GET",
          `/api/v1/community/profiles/${futureDisabled.id}`,
        ),
        404,
        "not_found",
      );
      expectProblem(
        await api(
          foreignToken,
          "POST",
          "/api/v1/community/posts",
          {
            spaceId: discussion.id,
            authorId: foreignOwner.id,
            title: "Cross tenant",
            content: "Must not be created",
          },
        ),
        404,
        "not_found",
      );
    } finally {
      for (const organizationId of organizationIds.reverse()) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
    }
  },
);
