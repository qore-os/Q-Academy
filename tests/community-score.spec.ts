import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres, { type Sql } from "postgres";

import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name]!;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || "";
}

const rateLimitSecret =
  environmentValue("AUTH_RATE_LIMIT_SECRET") ||
  environmentValue("SESSION_SECRET") ||
  "q-academy-local-development-secret-change-me";

function rateLimitKey(action: string, identifier: string) {
  return createHmac("sha256", rateLimitSecret)
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

function apiSecret(label: string) {
  return `qak_community_score_${label}_${randomBytes(24).toString("base64url")}`;
}

function writeHeaders(secret: string, key: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Idempotency-Key": key,
  };
}

async function responseJson(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  expectedStatus: number,
) {
  const body = await response.text();
  expect(response.status(), body).toBe(expectedStatus);
  return JSON.parse(body) as { data: Record<string, unknown> };
}

async function login(page: Page, email: string, tenantOrigin: string) {
  await page.context().clearCookies();
  await page.goto(`${tenantOrigin}/login`);
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function balances(sql: Sql, userIds: string[]) {
  return sql<Array<{ id: string; points: number; communityPoints: number }>>`
    select id, points, community_points as "communityPoints"
    from users
    where id = any(${userIds}::uuid[])
    order by id
  `;
}

test("community score is reversible and comment reactions stay tenant-visible and mobile-safe", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "isolated API, UI and PostgreSQL flow",
  );
  test.setTimeout(180_000);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const memberASecret = apiSecret("a");
  const memberBSecret = apiSecret("b");
  const adminSecret = apiSecret("admin");
  const key = (label: string) => `community-score-${suffix}-${label}`;
  let organizationId = "";
  let memberAId = "";
  let memberBId = "";
  let adminId = "";
  let memberAEmail = "";
  const apiKeyIds: string[] = [];
  const organizationSlug = `community-score-${suffix}`;
  const tenantOrigin = `http://${organizationSlug}.localhost:3000`;

  try {
    const [demo] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users where email = 'lea@q-academy.de'
      limit 1
    `;
    if (!demo) throw new Error("Seeded login fixture is missing.");
    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Community score ${suffix}`},
        ${organizationSlug}
      ) returning id
    `;
    organizationId = organization.id;
    memberAEmail = `community-score-a-${suffix}@example.test`;
    const users = await sql<Array<{ id: string; email: string; role: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role,
        status
      ) values
        (
          ${organizationId}, ${memberAEmail}, ${demo.passwordHash},
          'Ada', 'Score', 'member', 'active'
        ),
        (
          ${organizationId}, ${`community-score-b-${suffix}@example.test`},
          ${demo.passwordHash}, 'Ben', 'Score', 'member', 'active'
        ),
        (
          ${organizationId}, ${`community-score-admin-${suffix}@example.test`},
          ${demo.passwordHash}, 'Mara', 'Score', 'admin', 'active'
        )
      returning id, email, role
    `;
    memberAId = users.find((user) => user.email === memberAEmail)!.id;
    memberBId = users.find((user) => user.email.includes("score-b-"))!.id;
    adminId = users.find((user) => user.role === "admin")!.id;
    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, type, access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, 'Score feed', ${`score-feed-${suffix}`},
        'feed', 'open', ${area.nextSpaceSortOrder}
      ) returning id
    `;
    await sql`
      insert into community_level_settings (organization_id, enabled)
      values (${organizationId}, true)
    `;
    await sql`
      insert into community_levels (
        organization_id, position, name, description, min_points, icon,
        color, active
      ) values
        (
          ${organizationId}, 1, 'Starter', 'Erster Schritt', 0, 'sparkles',
          '#2b9188', true
        ),
        (
          ${organizationId}, 2, 'Contributor', 'Aktive Beteiligung', 3,
          'award', '#365f8d', true
        )
    `;
    const apiKeys = await sql<Array<{ id: string; createdById: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values
        (
          ${organizationId}, ${memberAId}, 'Score A',
          ${memberASecret.slice(0, 20)},
          ${createHash("sha256").update(memberASecret).digest("hex")},
          array['community:read', 'community:write']
        ),
        (
          ${organizationId}, ${memberBId}, 'Score B',
          ${memberBSecret.slice(0, 20)},
          ${createHash("sha256").update(memberBSecret).digest("hex")},
          array['community:read', 'community:write']
        ),
        (
          ${organizationId}, ${adminId}, 'Score admin',
          ${adminSecret.slice(0, 20)},
          ${createHash("sha256").update(adminSecret).digest("hex")},
          array['community:read', 'community:write']
        )
      returning id, created_by_id as "createdById"
    `;
    apiKeyIds.push(...apiKeys.map((apiKey) => apiKey.id));

    const postPayload = await responseJson(
      await request.post("/api/v1/community/posts", {
        headers: writeHeaders(memberASecret, key("post")),
        data: {
          spaceId: space.id,
          authorId: memberAId,
          content: `Score post ${suffix}`,
          attachmentIds: [],
        },
      }),
      201,
    );
    const postId = String(postPayload.data.id);
    const topCommentPayload = await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/comments`, {
        headers: writeHeaders(memberBSecret, key("top-comment")),
        data: {
          authorId: memberBId,
          content: `Scored top comment ${suffix}`,
          attachmentIds: [],
        },
      }),
      201,
    );
    const topCommentId = String(topCommentPayload.data.id);
    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/comments`, {
        headers: writeHeaders(memberASecret, key("reply")),
        data: {
          authorId: memberAId,
          parentId: topCommentId,
          content: `Scored reply ${suffix}`,
          attachmentIds: [],
        },
      }),
      201,
    );
    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/comments`, {
        headers: writeHeaders(memberASecret, key("self-comment")),
        data: {
          authorId: memberAId,
          content: `Self comment ${suffix}`,
          attachmentIds: [],
        },
      }),
      201,
    );

    const initialBalances = await balances(sql, [memberAId, memberBId]);
    expect(initialBalances).toEqual(
      [
        { id: memberAId, points: 18, communityPoints: 2 },
        { id: memberBId, points: 4, communityPoints: 1 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/reactions`, {
        headers: writeHeaders(memberBSecret, key("post-reaction")),
        data: { userId: memberBId, reaction: "celebrate" },
      }),
      201,
    );
    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/reactions`, {
        headers: writeHeaders(memberBSecret, key("post-reaction-update")),
        data: { userId: memberBId, reaction: "question" },
      }),
      201,
    );
    expect((await balances(sql, [memberAId])).at(0)?.communityPoints).toBe(3);
    await responseJson(
      await request.delete(
        `/api/v1/community/posts/${postId}/reactions/${memberBId}`,
        { headers: writeHeaders(memberBSecret, key("post-reaction-delete")) },
      ),
      200,
    );
    expect((await balances(sql, [memberAId])).at(0)?.communityPoints).toBe(2);
    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/reactions`, {
        headers: writeHeaders(memberBSecret, key("post-reaction-reinsert")),
        data: { userId: memberBId, reaction: "like" },
      }),
      201,
    );
    await responseJson(
      await request.post(`/api/v1/community/posts/${postId}/reactions`, {
        headers: writeHeaders(memberASecret, key("post-self-reaction")),
        data: { userId: memberAId, reaction: "like" },
      }),
      201,
    );
    expect((await balances(sql, [memberAId])).at(0)?.communityPoints).toBe(3);

    await responseJson(
      await request.put(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(memberASecret, key("comment-reaction")),
          data: { reaction: "insightful" },
        },
      ),
      200,
    );
    expect((await balances(sql, [memberBId])).at(0)?.communityPoints).toBe(2);
    const summary = await responseJson(
      await request.get(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        { headers: { Authorization: `Bearer ${memberASecret}` } },
      ),
      200,
    );
    expect(summary.data).toMatchObject({
      commentId: topCommentId,
      userId: memberAId,
      myReaction: "insightful",
      counts: {
        like: 0,
        celebrate: 0,
        insightful: 1,
        question: 0,
        total: 1,
      },
    });
    await responseJson(
      await request.delete(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(memberASecret, key("comment-reaction-delete")),
        },
      ),
      200,
    );
    expect((await balances(sql, [memberBId])).at(0)?.communityPoints).toBe(1);
    await responseJson(
      await request.put(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(
            memberASecret,
            key("comment-reaction-reinsert"),
          ),
          data: { reaction: "celebrate" },
        },
      ),
      200,
    );
    await responseJson(
      await request.put(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(memberBSecret, key("comment-self-reaction")),
          data: { reaction: "like" },
        },
      ),
      200,
    );
    expect((await balances(sql, [memberBId])).at(0)?.communityPoints).toBe(2);

    await responseJson(
      await request.put(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(memberASecret, key("member-act-as")),
          data: { userId: memberBId, reaction: "question" },
        },
      ),
      403,
    );
    await responseJson(
      await request.put(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        {
          headers: writeHeaders(adminSecret, key("admin-act-as")),
          data: { userId: memberBId, reaction: "question" },
        },
      ),
      200,
    );

    const [heldPost, heldComment] = await sql<
      Array<{ id: string; kind: string }>
    >`
      with held_post as (
        insert into posts (
          organization_id, space_id, author_id, content, moderation_state,
          published_at
        ) values (
          ${organizationId}, ${space.id}, ${memberAId}, 'Held score post',
          'held', null
        ) returning id
      ), held_comment as (
        insert into comments (
          organization_id, post_id, author_id, content, moderation_state,
          published_at
        ) values (
          ${organizationId}, ${postId}, ${memberAId}, 'Held score comment',
          'held', null
        ) returning id
      )
      select id, 'post' as kind from held_post
      union all
      select id, 'comment' as kind from held_comment
    `;
    const hiddenPostId =
      heldPost.kind === "post" ? heldPost.id : heldComment.id;
    const hiddenCommentId =
      heldPost.kind === "comment" ? heldPost.id : heldComment.id;
    await responseJson(
      await request.post(`/api/v1/community/posts/${hiddenPostId}/reactions`, {
        headers: writeHeaders(memberBSecret, key("hidden-post")),
        data: { userId: memberBId, reaction: "like" },
      }),
      404,
    );
    await responseJson(
      await request.put(
        `/api/v1/community/comments/${hiddenCommentId}/reactions`,
        {
          headers: writeHeaders(memberBSecret, key("hidden-comment")),
          data: { reaction: "like" },
        },
      ),
      404,
    );

    await responseJson(
      await request.delete(
        `/api/v1/community/comments/${topCommentId}/reactions`,
        { headers: writeHeaders(memberASecret, key("ui-reaction-reset")) },
      ),
      200,
    );
    await login(page, memberAEmail, tenantOrigin);
    await page.goto(`${tenantOrigin}/academy/community`, {
      waitUntil: "networkidle",
    });
    const commentRow = page.locator(`#comment-${topCommentId}`);
    await expect(commentRow).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Community-Ranking", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Contributor", { exact: true }).first(),
    ).toBeVisible();
    const commentReactions = commentRow.getByLabel("Kommentarreaktionen");
    const helpfulReaction = commentReactions.getByRole("button", {
      name: "Hilfreich",
    });
    await helpfulReaction.click();
    await expect(helpfulReaction).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(
        async () => (await balances(sql, [memberBId])).at(0)?.communityPoints,
      )
      .toBe(2);

    await page.setViewportSize({ width: 360, height: 800 });
    await commentRow.scrollIntoViewIfNeeded();
    const mobileLayout = await commentReactions.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(mobileLayout.left).toBeGreaterThanOrEqual(0);
    expect(mobileLayout.right).toBeLessThanOrEqual(361);
    expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(
      mobileLayout.clientWidth + 1,
    );

    await responseJson(
      await request.delete(`/api/v1/community/comments/${topCommentId}`, {
        headers: writeHeaders(memberBSecret, key("comment-delete")),
      }),
      200,
    );
    const afterCommentDelete = await balances(sql, [memberAId, memberBId]);
    expect(afterCommentDelete).toEqual(
      [
        { id: memberAId, points: 14, communityPoints: 1 },
        { id: memberBId, points: 0, communityPoints: 0 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    await responseJson(
      await request.delete(
        `/api/v1/community/posts/${postId}/reactions/${memberBId}`,
        {
          headers: writeHeaders(
            memberBSecret,
            key("post-reaction-final-delete"),
          ),
        },
      ),
      200,
    );
    expect((await balances(sql, [memberAId])).at(0)?.communityPoints).toBe(0);
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    const exactBuckets = [
      ...apiKeyIds.flatMap((apiKeyId) => [
        ["api_read", apiKeyId],
        ["api_write", apiKeyId],
      ]),
      ["api_read_tenant", organizationId],
      ["api_write_tenant", organizationId],
      ["community_post_create", memberAId],
      ["community_post_create_tenant", organizationId],
      ["community_comment_create", memberAId],
      ["community_comment_create", memberBId],
      ["community_comment_create_tenant", organizationId],
      ["community_reaction_mutation", `${organizationId}\0${memberAId}`],
      ["community_reaction_mutation", `${organizationId}\0${memberBId}`],
      ["community_reaction_mutation_tenant", organizationId],
      ["community_feed_read", `${organizationId}\0${memberAId}`],
      ["community_feed_read_tenant", organizationId],
    ].filter((entry) => entry[1]);
    for (const [action, identifier] of exactBuckets) {
      await sql`
        delete from auth_rate_limits
        where action = ${action}
          and key_hash = ${rateLimitKey(action, identifier)}
      `;
    }
    await sql`
      delete from auth_rate_limits
      where updated_at >= ${startedAt}
        and action in ('login', 'login_scope', 'login_ip')
    `;
    await sql.end();
  }
});
