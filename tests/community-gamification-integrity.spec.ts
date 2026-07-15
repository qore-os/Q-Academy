import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres, { type Sql } from "postgres";

import { resolveCommunityActionMessage } from "../src/lib/i18n/community-actions";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const postRateLimitMessage = resolveCommunityActionMessage("de", {
  code: "contentRateLimited",
  params: { target: "post" },
});

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const rateLimitSecret =
  process.env.AUTH_RATE_LIMIT_SECRET?.trim() ||
  process.env.SESSION_SECRET?.trim() ||
  "q-academy-local-development-secret-change-me";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function rateLimitKey(action: string, identifier: string) {
  return createHmac("sha256", rateLimitSecret)
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

function writeHeaders(secret: string, key: string) {
  return {
    Authorization: `Bearer ${secret}`,
    "Idempotency-Key": key,
  };
}

type IntegrityFixture = {
  organizationId: string;
  spaceId: string;
  memberAId: string;
  memberBId: string;
  adminId: string;
  memberASecret: string;
  memberBSecret: string;
  adminSecret: string;
};

async function createFixture(sql: Sql, suffix: string): Promise<IntegrityFixture> {
  const [organization] = await sql<Array<{ id: string }>>`
    insert into organizations (name, slug)
    values (
      ${`Community Integrity ${suffix}`},
      ${`community-integrity-${suffix}`}
    )
    returning id
  `;
  const users = await sql<Array<{ id: string; email: string; role: string }>>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, role, status
    ) values
      (
        ${organization.id}, ${`integrity-a-${suffix}@example.test`},
        'not-a-login-hash', 'Ada', 'Integrity', 'member', 'active'
      ),
      (
        ${organization.id}, ${`integrity-b-${suffix}@example.test`},
        'not-a-login-hash', 'Ben', 'Integrity', 'member', 'active'
      ),
      (
        ${organization.id}, ${`integrity-admin-${suffix}@example.test`},
        'not-a-login-hash', 'Mara', 'Integrity', 'admin', 'active'
      )
    returning id, email, role
  `;
  const memberAId = users.find((row) => row.email.startsWith("integrity-a-"))!.id;
  const memberBId = users.find((row) => row.email.startsWith("integrity-b-"))!.id;
  const adminId = users.find((row) => row.role === "admin")!.id;
  const area = await ensureCommunityAreaFixture(sql, organization.id);
  const [space] = await sql<Array<{ id: string }>>`
    insert into community_spaces (
      organization_id, area_id, title, slug, description, color, type,
      access_mode, sort_order
    ) values (
      ${organization.id}, ${area.id}, 'Integrity Feed',
      ${`integrity-feed-${suffix}`}, 'Isolierter Integritaetstest', '#2bb7a9',
      'feed', 'open', ${area.nextSpaceSortOrder}
    )
    returning id
  `;

  const memberASecret = `qak_integrity_a_${randomBytes(24).toString("base64url")}`;
  const memberBSecret = `qak_integrity_b_${randomBytes(24).toString("base64url")}`;
  const adminSecret = `qak_integrity_admin_${randomBytes(24).toString("base64url")}`;
  await sql`
    insert into api_keys (
      organization_id, created_by_id, name, prefix, key_hash, scopes
    ) values
      (
        ${organization.id}, ${memberAId}, 'Integrity A',
        ${memberASecret.slice(0, 20)}, ${hashSecret(memberASecret)},
        array['community:read', 'community:write']
      ),
      (
        ${organization.id}, ${memberBId}, 'Integrity B',
        ${memberBSecret.slice(0, 20)}, ${hashSecret(memberBSecret)},
        array['community:read', 'community:write']
      ),
      (
        ${organization.id}, ${adminId}, 'Integrity Admin',
        ${adminSecret.slice(0, 20)}, ${hashSecret(adminSecret)},
        array['community:read', 'community:write']
      )
  `;

  const badges = await sql<Array<{ id: string; slug: string }>>`
    insert into badge_definitions (
      organization_id, name, slug, description, points_threshold
    ) values
      (
        ${organization.id}, 'Automatic Integrity', ${`automatic-${suffix}`},
        'Automatisch vergebener Badge', 5
      ),
      (
        ${organization.id}, 'Manual Integrity', ${`manual-${suffix}`},
        'Manuell vergebener Badge', 5
      ),
      (
        ${organization.id}, 'Manual Prefix Integrity', ${`manual-prefix-${suffix}`},
        'Manueller Badge mit aehnlicher Quelle', 5
      )
    returning id, slug
  `;
  await sql`
    insert into user_badges (organization_id, user_id, badge_id, source)
    values
      (
        ${organization.id}, ${memberAId},
        ${badges.find((badge) => badge.slug === `manual-${suffix}`)!.id},
        'manual'
      ),
      (
        ${organization.id}, ${memberAId},
        ${badges.find((badge) => badge.slug === `manual-prefix-${suffix}`)!.id},
        'points:manual'
      )
  `;

  return {
    organizationId: organization.id,
    spaceId: space.id,
    memberAId,
    memberBId,
    adminId,
    memberASecret,
    memberBSecret,
    adminSecret,
  };
}

async function createSpace(sql: Sql, fixture: IntegrityFixture, suffix: string) {
  const area = await ensureCommunityAreaFixture(sql, fixture.organizationId);
  const [space] = await sql<Array<{ id: string }>>`
    insert into community_spaces (
      organization_id, area_id, title, slug, description, color, type,
      access_mode, sort_order
    ) values (
      ${fixture.organizationId}, ${area.id}, ${`Integrity ${suffix}`},
      ${`integrity-${suffix}`}, 'Isolierter Integritaetstest', '#2bb7a9',
      'feed', 'open', ${area.nextSpaceSortOrder}
    )
    returning id
  `;
  return space.id;
}

async function createPost(
  request: APIRequestContext,
  input: {
    secret: string;
    key: string;
    spaceId: string;
    authorId: string;
    content: string;
  },
) {
  const response = await request.post("/api/v1/community/posts", {
    headers: writeHeaders(input.secret, input.key),
    data: {
      spaceId: input.spaceId,
      authorId: input.authorId,
      content: input.content,
      attachmentIds: [],
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).data.id as string;
}

async function createComment(
  request: APIRequestContext,
  input: {
    secret: string;
    key: string;
    postId: string;
    authorId: string;
    content: string;
    parentId?: string;
  },
) {
  const response = await request.post(
    `/api/v1/community/posts/${input.postId}/comments`,
    {
      headers: writeHeaders(input.secret, input.key),
      data: {
        authorId: input.authorId,
        content: input.content,
        parentId: input.parentId,
        attachmentIds: [],
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()).data.id as string;
}

async function deletePost(
  request: APIRequestContext,
  postId: string,
  secret: string,
  key: string,
) {
  return request.delete(`/api/v1/community/posts/${postId}`, {
    headers: writeHeaders(secret, key),
  });
}

async function deleteComment(
  request: APIRequestContext,
  commentId: string,
  secret: string,
  key: string,
) {
  return request.delete(`/api/v1/community/comments/${commentId}`, {
    headers: writeHeaders(secret, key),
  });
}

async function userPoints(sql: Sql, userIds: string[]) {
  return sql<Array<{ id: string; points: number }>>`
    select id, points
    from users
    where id = any(${userIds}::uuid[])
    order by id
  `;
}

async function holdSpaceUpdateLock(sql: Sql, spaceId: string) {
  let markReady!: () => void;
  let releaseGate!: () => void;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const finished = sql.begin(async (tx) => {
    await tx`select id from community_spaces where id = ${spaceId} for update`;
    markReady();
    await gate;
  });
  await ready;
  return async () => {
    releaseGate();
    await finished;
  };
}

async function waitForSpaceLockWaiters(sql: Sql, minimum: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [row] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from pg_stat_activity
      where datname = current_database()
        and pid <> pg_backend_pid()
        and wait_event_type = 'Lock'
        and query ilike '%community_spaces%'
    `;
    if (row.count >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Expected at least ${minimum} blocked community-space transactions.`);
}

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("community deletion reverses points exactly once and remains race safe", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused API/Postgres flow");
  test.setTimeout(240_000);

  const sql = postgres(databaseUrl, { max: 5, prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  let fixture: IntegrityFixture | null = null;
  let keySequence = 0;
  const key = (label: string) => `integrity-${suffix}-${label}-${keySequence++}`;

  try {
    fixture = await createFixture(sql, suffix);

    const badgePostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("badge-create"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Badge-Rueckbuchung",
    });
    expect(await userPoints(sql, [fixture.memberAId])).toEqual([
      { id: fixture.memberAId, points: 10 },
    ]);
    const earnedSources = await sql<Array<{ source: string | null }>>`
      select source
      from user_badges
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.memberAId}
      order by source
    `;
    expect(earnedSources.map((row) => row.source)).toEqual([
      "manual",
      "points:10",
      "points:manual",
    ]);
    expect(
      (await deletePost(
        request,
        badgePostId,
        fixture.memberASecret,
        key("badge-delete"),
      )).status(),
    ).toBe(200);
    expect(await userPoints(sql, [fixture.memberAId])).toEqual([
      { id: fixture.memberAId, points: 0 },
    ]);
    const remainingSources = await sql<Array<{ source: string | null }>>`
      select source
      from user_badges
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.memberAId}
      order by source
    `;
    expect(remainingSources.map((row) => row.source)).toEqual([
      "manual",
      "points:manual",
    ]);

    const cascadePostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("cascade-post"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Mehr-Autoren-Kaskade",
    });
    const cascadeRootId = await createComment(request, {
      secret: fixture.memberBSecret,
      key: key("cascade-root"),
      postId: cascadePostId,
      authorId: fixture.memberBId,
      content: "Root von B",
    });
    const cascadeReplyId = await createComment(request, {
      secret: fixture.memberASecret,
      key: key("cascade-reply"),
      postId: cascadePostId,
      parentId: cascadeRootId,
      authorId: fixture.memberAId,
      content: "Reply von A",
    });
    const cascadeSecondRootId = await createComment(request, {
      secret: fixture.memberBSecret,
      key: key("cascade-second-root"),
      postId: cascadePostId,
      authorId: fixture.memberBId,
      content: "Zweiter Root von B",
    });
    const concurrentDeletes = await Promise.all([
      deletePost(
        request,
        cascadePostId,
        fixture.memberASecret,
        key("cascade-delete-a"),
      ),
      deletePost(
        request,
        cascadePostId,
        fixture.memberASecret,
        key("cascade-delete-b"),
      ),
    ]);
    expect(concurrentDeletes.map((response) => response.status()).sort()).toEqual([
      200,
      404,
    ]);
    expect(
      await userPoints(sql, [fixture.memberAId, fixture.memberBId]),
    ).toEqual(
      [fixture.memberAId, fixture.memberBId]
        .sort()
        .map((id) => ({ id, points: 0 })),
    );
    const cascadeLedger = await sql<
      Array<{ entity_id: string; entries: number; amount: number }>
    >`
      select entity_id, count(*)::int as entries, sum(amount)::int as amount
      from point_transactions
      where organization_id = ${fixture.organizationId}
        and entity_id = any(
          ${[
            cascadePostId,
            cascadeRootId,
            cascadeReplyId,
            cascadeSecondRootId,
          ]}::uuid[]
        )
      group by entity_id
      order by entity_id
    `;
    expect(cascadeLedger).toHaveLength(4);
    expect(cascadeLedger.every((row) => row.entries === 2 && row.amount === 0)).toBe(
      true,
    );

    const commentPostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("comment-post"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Direkte Reply-Kaskade",
    });
    const commentRootId = await createComment(request, {
      secret: fixture.memberBSecret,
      key: key("comment-root"),
      postId: commentPostId,
      authorId: fixture.memberBId,
      content: "Zu loeschender Root",
    });
    const commentReplyId = await createComment(request, {
      secret: fixture.memberASecret,
      key: key("comment-reply"),
      postId: commentPostId,
      parentId: commentRootId,
      authorId: fixture.memberAId,
      content: "Direkte Antwort",
    });
    expect(
      (await deleteComment(
        request,
        commentRootId,
        fixture.memberBSecret,
        key("comment-delete"),
      )).status(),
    ).toBe(200);
    const [commentCount] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from comments
      where id = any(${[commentRootId, commentReplyId]}::uuid[])
    `;
    expect(commentCount.count).toBe(0);
    expect(
      await userPoints(sql, [fixture.memberAId, fixture.memberBId]),
    ).toEqual(
      [
        { id: fixture.memberAId, points: 10 },
        { id: fixture.memberBId, points: 0 },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    expect(
      (await deletePost(
        request,
        commentPostId,
        fixture.memberASecret,
        key("comment-post-delete"),
      )).status(),
    ).toBe(200);

    const spacePostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("space-post"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Space-Kaskade",
    });
    await createComment(request, {
      secret: fixture.memberBSecret,
      key: key("space-comment"),
      postId: spacePostId,
      authorId: fixture.memberBId,
      content: "Space-Kommentar",
    });
    const spaceDelete = await request.delete(
      `/api/v1/community/spaces/${fixture.spaceId}`,
      { headers: writeHeaders(fixture.adminSecret, key("space-delete")) },
    );
    expect(spaceDelete.status()).toBe(200);
    expect(
      await userPoints(sql, [fixture.memberAId, fixture.memberBId]),
    ).toEqual(
      [fixture.memberAId, fixture.memberBId]
        .sort()
        .map((id) => ({ id, points: 0 })),
    );

    fixture.spaceId = await createSpace(sql, fixture, `${suffix}-underflow`);
    const underflowPostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("underflow-create"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Unterlauf muss rollbacken",
    });
    await sql`update users set points = 0 where id = ${fixture.memberAId}`;
    const underflowDelete = await deletePost(
      request,
      underflowPostId,
      fixture.memberASecret,
      key("underflow-delete"),
    );
    expect(underflowDelete.status()).toBe(500);
    const [underflowState] = await sql<
      Array<{ post_count: number; reversal_count: number }>
    >`
      select
        (select count(*)::int from posts where id = ${underflowPostId}) as post_count,
        (
          select count(*)::int
          from point_transactions
          where entity_id = ${underflowPostId}
            and reason = 'community.post.created.reversal'
        ) as reversal_count
    `;
    expect(underflowState).toEqual({ post_count: 1, reversal_count: 0 });
    await sql`update users set points = 10 where id = ${fixture.memberAId}`;
    expect(
      (await deletePost(
        request,
        underflowPostId,
        fixture.memberASecret,
        key("underflow-retry"),
      )).status(),
    ).toBe(200);

    const roleRacePostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("role-race-create"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Admin-Rollenrennen",
    });
    const releaseRoleLock = await holdSpaceUpdateLock(sql, fixture.spaceId);
    const roleRaceDelete = deletePost(
      request,
      roleRacePostId,
      fixture.adminSecret,
      key("role-race-delete"),
    );
    await waitForSpaceLockWaiters(sql, 1);
    await sql`update users set role = 'member' where id = ${fixture.adminId}`;
    await releaseRoleLock();
    expect((await roleRaceDelete).status()).toBe(403);
    expect(
      (await sql<Array<{ count: number }>>`
        select count(*)::int as count from posts where id = ${roleRacePostId}
      `)[0].count,
    ).toBe(1);
    await sql`update users set role = 'admin' where id = ${fixture.adminId}`;

    const releaseStatusLock = await holdSpaceUpdateLock(sql, fixture.spaceId);
    const statusRaceDelete = deletePost(
      request,
      roleRacePostId,
      fixture.memberASecret,
      key("status-race-delete"),
    );
    await waitForSpaceLockWaiters(sql, 1);
    await sql`update users set status = 'disabled' where id = ${fixture.memberAId}`;
    await releaseStatusLock();
    expect((await statusRaceDelete).status()).toBe(403);
    expect(
      (await sql<Array<{ count: number }>>`
        select count(*)::int as count from posts where id = ${roleRacePostId}
      `)[0].count,
    ).toBe(1);
    await sql`update users set status = 'active' where id = ${fixture.memberAId}`;
    expect(
      (await deletePost(
        request,
        roleRacePostId,
        fixture.memberASecret,
        key("race-cleanup"),
      )).status(),
    ).toBe(200);

    const createDeletePostId = await createPost(request, {
      secret: fixture.memberASecret,
      key: key("create-delete-post"),
      spaceId: fixture.spaceId,
      authorId: fixture.memberAId,
      content: "Create-vs-Delete",
    });
    const releaseCreateDeleteLock = await holdSpaceUpdateLock(sql, fixture.spaceId);
    const racingCreate = request.post(
      `/api/v1/community/posts/${createDeletePostId}/comments`,
      {
        headers: writeHeaders(fixture.memberBSecret, key("racing-create")),
        data: {
          authorId: fixture.memberBId,
          content: "Wird atomar mitgeloescht",
          attachmentIds: [],
        },
      },
    );
    await waitForSpaceLockWaiters(sql, 1);
    const racingDelete = deletePost(
      request,
      createDeletePostId,
      fixture.memberASecret,
      key("racing-delete"),
    );
    await waitForSpaceLockWaiters(sql, 2);
    await releaseCreateDeleteLock();
    const [createResponse, deleteResponse] = await Promise.all([
      racingCreate,
      racingDelete,
    ]);
    expect(createResponse.status()).toBe(201);
    expect(deleteResponse.status()).toBe(200);
    expect(
      await userPoints(sql, [fixture.memberAId, fixture.memberBId]),
    ).toEqual(
      [fixture.memberAId, fixture.memberBId]
        .sort()
        .map((id) => ({ id, points: 0 })),
    );

    const reversalEvents = await sql<Array<{ metadata: Record<string, unknown> }>>`
      select metadata
      from activity_events
      where organization_id = ${fixture.organizationId}
        and type = 'community_points.reversed'
    `;
    expect(reversalEvents.length).toBeGreaterThan(0);
    for (const event of reversalEvents) {
      expect(Object.keys(event.metadata).sort()).toEqual(["amount", "sourceReason"]);
    }
  } finally {
    if (fixture) {
      await sql`delete from organizations where id = ${fixture.organizationId}`;
    }
    await sql`
      delete from auth_rate_limits
      where action in (
        'community_post_create',
        'community_post_create_tenant',
        'community_comment_create',
        'community_comment_create_tenant'
      )
        and updated_at >= ${startedAt}
    `;
    await sql.end();
  }
});

test("browser and REST share persistent tenant-isolated create limits", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused API/browser rate flow");
  test.setTimeout(240_000);

  const sql = postgres(databaseUrl, { max: 3, prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date();
  const email = `community-limit-${suffix}@example.test`;
  const secret = `qak_community_limit_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";
  let userId = "";
  let apiKeyId = "";
  let spaceId = "";
  let foreignOrganizationId = "";
  let sequence = 0;
  const key = (label: string) => `community-limit-${suffix}-${label}-${sequence++}`;

  try {
    const [seed] = await sql<
      Array<{ organization_id: string; password_hash: string }>
    >`
      select organization_id, password_hash
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    organizationId = seed.organization_id;
    const [user] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${organizationId}, ${email}, ${seed.password_hash},
        'Lina', 'Ratenlimit', 'member', 'active'
      )
      returning id
    `;
    userId = user.id;
    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Ratenlimit ${suffix}`},
        ${`rate-${suffix}`}, 'Gemeinsames Browser- und API-Limit', '#2bb7a9',
        'feed', 'open', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${organizationId}, ${userId}, ${`Community Limit ${suffix}`},
        ${secret.slice(0, 20)}, ${hashSecret(secret)},
        array['community:read', 'community:write']
      )
      returning id
    `;
    apiKeyId = apiKey.id;

    const postIds: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      postIds.push(
        await createPost(request, {
          secret,
          key: key(`post-${index}`),
          spaceId,
          authorId: userId,
          content: `REST-Limit-Beitrag ${index}`,
        }),
      );
    }

    const [storedPosts] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from posts
      where organization_id = ${organizationId}
        and space_id = ${spaceId}
        and author_id = ${userId}
    `;
    expect(storedPosts.count).toBe(30);

    const restPostLimit = await request.post("/api/v1/community/posts", {
      headers: writeHeaders(secret, key("post-over-limit")),
      data: {
        spaceId,
        authorId: userId,
        content: "REST bleibt im selben Limit",
        attachmentIds: [],
      },
    });
    expect(restPostLimit.status()).toBe(429);
    expect(Number(restPostLimit.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
    await expect(restPostLimit.json()).resolves.toMatchObject({
      code: "rate_limit_exceeded",
      errors: {
        limit: 30,
        remaining: 0,
        resetAt: expect.any(String),
        retryAfterSeconds: expect.any(Number),
      },
    });

    for (let index = 0; index < 60; index += 1) {
      await createComment(request, {
        secret,
        key: key(`comment-${index}`),
        postId: postIds[0],
        authorId: userId,
        content: `REST-Limit-Antwort ${index}`,
      });
    }
    const restCommentLimit = await request.post(
      `/api/v1/community/posts/${postIds[0]}/comments`,
      {
        headers: writeHeaders(secret, key("comment-over-limit")),
        data: {
          authorId: userId,
          content: "Diese Antwort liegt ueber dem Limit.",
          attachmentIds: [],
        },
      },
    );
    expect(restCommentLimit.status()).toBe(429);
    expect(Number(restCommentLimit.headers()["retry-after"])).toBeGreaterThanOrEqual(1);
    await expect(restCommentLimit.json()).resolves.toMatchObject({
      code: "rate_limit_exceeded",
      errors: {
        limit: 60,
        remaining: 0,
        resetAt: expect.any(String),
        retryAfterSeconds: expect.any(Number),
      },
    });

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Foreign Community Limit ${suffix}`},
        ${`foreign-community-limit-${suffix}`}
      )
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${foreignOrganizationId}, ${email}, 'not-a-login-hash',
        'Lina', 'Foreign', 'member', 'active'
      )
      returning id
    `;
    const foreignArea = await ensureCommunityAreaFixture(
      sql,
      foreignOrganizationId,
    );
    const [foreignSpace] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${foreignOrganizationId}, ${foreignArea.id}, 'Foreign Rate Feed',
        'foreign-rate-feed', 'Mandantenisoliertes Limit', '#2bb7a9', 'feed',
        'open', ${foreignArea.nextSpaceSortOrder}
      )
      returning id
    `;
    const foreignSecret = `qak_foreign_limit_${randomBytes(24).toString("base64url")}`;
    await sql`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${foreignOrganizationId}, ${foreignUser.id}, 'Foreign Limit',
        ${foreignSecret.slice(0, 20)}, ${hashSecret(foreignSecret)},
        array['community:read', 'community:write']
      )
    `;
    const foreignCreate = await request.post("/api/v1/community/posts", {
      headers: writeHeaders(foreignSecret, key("foreign-create")),
      data: {
        spaceId: foreignSpace.id,
        authorId: foreignUser.id,
        content: "Der zweite Mandant besitzt einen eigenen Bucket.",
        attachmentIds: [],
      },
    });
    expect(foreignCreate.status()).toBe(201);

    await login(page, email);
    await page.goto("/academy/community", { waitUntil: "domcontentloaded" });
    const openComposer = page.getByRole("button", { name: /Teile eine Frage/ });
    await expect(openComposer).toBeVisible({ timeout: 30_000 });
    await openComposer.click();
    const composer = page.getByRole("dialog", { name: "Neuer Beitrag" });
    await composer.locator('select[name="spaceId"]').selectOption(spaceId);
    await composer
      .locator('textarea[name="content"]')
      .fill("Dieser Browser-Beitrag muss am gemeinsamen Limit scheitern.");
    await composer.getByRole("button", { name: "Veroeffentlichen" }).click();
    await expect(
      composer.getByText(
        postRateLimitMessage,
        { exact: true },
      ),
    ).toBeVisible();
  } finally {
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    if (apiKeyId) await sql`delete from api_keys where id = ${apiKeyId}`;
    if (spaceId) await sql`delete from community_spaces where id = ${spaceId}`;
    if (userId) await sql`delete from users where id = ${userId}`;

    const exactBuckets = [
      ["community_post_create", userId],
      ["community_post_create_tenant", organizationId],
      ["community_comment_create", userId],
      ["community_comment_create_tenant", organizationId],
      ["api_write", apiKeyId],
      ["api_write_tenant", organizationId],
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
        and action in (
          'login', 'login_scope', 'login_ip',
          'community_feed_read', 'community_feed_read_tenant'
        )
    `;
    await sql.end();
  }
});
