import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

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

function rateLimitHash(action: string, identifier: string) {
  const secret =
    environmentValue("AUTH_RATE_LIMIT_SECRET") ||
    environmentValue("SESSION_SECRET") ||
    "q-academy-local-development-secret-change-me";
  return createHmac("sha256", secret)
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

function apiHeaders(secret: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${secret}`,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("personal feed enforces tenant ACLs, stable cursors, follows, boosts, and bounded comments", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "personal feed integration runs once",
  );
  test.setTimeout(180_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const memberSecret = `qak_feed_member_${randomBytes(24).toString("base64url")}`;
  const readOnlySecret = `qak_feed_read_${randomBytes(24).toString("base64url")}`;
  const adminSecret = `qak_feed_admin_${randomBytes(24).toString("base64url")}`;
  const startedAt = new Date();
  const idempotencyKeys = {
    boostCreate: `boost-create-${suffix}`,
    boostNoOp: `boost-noop-${suffix}`,
    boostDelete: `boost-delete-${suffix}`,
    followCreate: `follow-create-${suffix}`,
    followNoOp: `follow-noop-${suffix}`,
    followDelete: `follow-delete-${suffix}`,
  };
  const replayRequestIds: string[] = [];
  let organizationId = "";
  let memberId = "";
  let adminId = "";
  const ids = {
    memberKey: "",
    readOnlyKey: "",
    adminKey: "",
    follow: "",
    openSpace: "",
    restrictedSpace: "",
    foreignOrganization: "",
    foreignUser: "",
    authorA: "",
    authorB: "",
    selfPost: "",
    boostPost: "",
    cursorReactionPost: "",
    restrictedPost: "",
    activeBoost: "",
    expiredBoost: "",
    mediaAsset: randomUUID(),
  };
  const postIds: string[] = [];
  const activityIds: string[] = [];

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        memberId: string;
        adminId: string;
        otherId: string;
        passwordHash: string;
        memberStatus: "active" | "invited" | "disabled";
        adminRole: "owner" | "admin" | "trainer" | "member";
      }>
    >`
      select member.organization_id as "organizationId",
             member.id as "memberId", admin.id as "adminId",
             other_member.id as "otherId", member.password_hash as "passwordHash",
             member.status as "memberStatus", admin.role as "adminRole"
      from users member
      join users admin on admin.organization_id = member.organization_id
      join users other_member on other_member.organization_id = member.organization_id
      where member.email = 'lea@q-academy.de'
        and admin.email = 'admin@q-academy.de'
        and other_member.email = 'jonas@q-academy.de'
      limit 1
    `;
    if (!fixture) throw new Error("Seeded community actors are missing.");
    organizationId = fixture.organizationId;
    memberId = fixture.memberId;
    adminId = fixture.adminId;

    const authors = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values
        (${fixture.organizationId}, ${`feed-a-${suffix}@example.test`},
          ${fixture.passwordHash}, 'Feed', 'Author A'),
        (${fixture.organizationId}, ${`feed-b-${suffix}@example.test`},
          ${fixture.passwordHash}, 'Feed', 'Author B')
      returning id
    `;
    [ids.authorA, ids.authorB] = authors.map((row) => row.id);

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Feed foreign ${suffix}`}, ${`feed-foreign-${suffix}`})
      returning id
    `;
    ids.foreignOrganization = foreignOrganization.id;
    const [foreignUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values (${ids.foreignOrganization}, ${`foreign-${suffix}@example.test`},
        ${fixture.passwordHash}, 'Foreign', 'Feed')
      returning id
    `;
    ids.foreignUser = foreignUser.id;

    const area = await ensureCommunityAreaFixture(sql, fixture.organizationId);
    const [openSpace, restrictedSpace] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, type, access_mode, color,
        sort_order
      ) values
        (${fixture.organizationId}, ${area.id}, ${`Feed open ${suffix}`},
          ${`feed-open-${suffix}`}, 'discussion', 'open', '#278c82',
          ${area.nextSpaceSortOrder}),
        (${fixture.organizationId}, ${area.id}, ${`Feed restricted ${suffix}`},
          ${`feed-restricted-${suffix}`}, 'discussion', 'restricted', '#8a5d3b',
          ${area.nextSpaceSortOrder + 1})
      returning id
    `;
    ids.openSpace = openSpace.id;
    ids.restrictedSpace = restrictedSpace.id;

    const createdPosts = await sql<Array<{ id: string; content: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content, created_at, updated_at
      ) values
        (${fixture.organizationId}, ${ids.openSpace}, ${ids.authorA},
          'Self interactions', ${`Self-only ${suffix}`}, now() - interval '7 hours', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${ids.authorB},
          'Boosted author', ${`Boosted ${suffix}`}, now() - interval '2 days', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${fixture.otherId},
          'Cursor reaction', ${`Cursor reaction ${suffix}`}, now() - interval '4 hours', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${fixture.otherId},
          'Recent 1', ${`Recent one ${suffix}`}, now() - interval '3 hours', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${ids.authorA},
          'Recent 2', ${`Recent two ${suffix}`}, now() - interval '2 hours', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${ids.authorB},
          'Recent 3', ${`Recent three ${suffix}`}, now() - interval '1 hour', now()),
        (${fixture.organizationId}, ${ids.openSpace}, ${fixture.otherId},
          'Recent 4', ${`Recent four ${suffix}`}, now() - interval '30 minutes', now())
      returning id, content
    `;
    postIds.push(...createdPosts.map((row) => row.id));
    ids.selfPost = createdPosts.find(
      (row) => row.content === `Self-only ${suffix}`,
    )!.id;
    ids.boostPost = createdPosts.find(
      (row) => row.content === `Boosted ${suffix}`,
    )!.id;
    ids.cursorReactionPost = createdPosts.find(
      (row) => row.content === `Cursor reaction ${suffix}`,
    )!.id;

    const [restrictedPost] = await sql<Array<{ id: string }>>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${fixture.organizationId}, ${ids.restrictedSpace}, ${ids.authorB},
        ${`RESTRICTED-${suffix}`})
      returning id
    `;
    ids.restrictedPost = restrictedPost.id;
    postIds.push(ids.restrictedPost);

    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
        upload_expires_at, uploaded_at, scan_completed_at
      ) values (
        ${ids.mediaAsset}, ${fixture.organizationId}, ${ids.authorB}, ${ids.authorB},
        'community', 'document', 'ready', 'filesystem',
        ${`tenants/${fixture.organizationId}/assets/${ids.mediaAsset}/feed.txt`},
        ${`incoming/tenants/${fixture.organizationId}/assets/${ids.mediaAsset}/feed.txt`},
        'feed.txt', 'feed.txt', 'text/plain', 'text/plain', 32, 32, 32,
        now() + interval '1 hour', now(), now()
      )
    `;
    await sql`
      insert into community_post_attachments (
        organization_id, post_id, media_asset_id, sort_order
      ) values (${fixture.organizationId}, ${ids.boostPost}, ${ids.mediaAsset}, 0)
    `;

    await sql`
      insert into post_likes (organization_id, post_id, user_id, reaction)
      values
        (${fixture.organizationId}, ${ids.selfPost}, ${ids.authorA}, 'like'),
        (${fixture.organizationId}, ${ids.cursorReactionPost}, ${fixture.memberId}, 'like')
    `;
    await sql`
      insert into post_votes (organization_id, post_id, user_id, value)
      values (${fixture.organizationId}, ${ids.selfPost}, ${ids.authorA}, 1)
    `;
    await sql`
      insert into comments (organization_id, post_id, author_id, content)
      values (${fixture.organizationId}, ${ids.selfPost}, ${ids.authorA}, 'Self comment')
    `;

    for (let parentIndex = 0; parentIndex < 4; parentIndex += 1) {
      const [parent] = await sql<Array<{ id: string }>>`
        insert into comments (
          organization_id, post_id, author_id, content, created_at
        ) values (${fixture.organizationId}, ${ids.boostPost}, ${fixture.otherId},
          ${`Parent ${parentIndex} ${suffix}`}, now() - ${`${parentIndex + 1} minutes`}::interval)
        returning id
      `;
      await sql`
        insert into comments (
          organization_id, post_id, author_id, parent_id, content, created_at
        )
        select ${fixture.organizationId}, ${ids.boostPost}, ${fixture.memberId},
               ${parent.id}, 'Reply ' || value::text || ' ' || ${suffix},
               now() + (value || ' seconds')::interval
        from generate_series(1, 4) value
      `;
    }

    const [expiredBoost] = await sql<Array<{ id: string }>>`
      insert into community_author_boosts (
        organization_id, author_id, strength, starts_at, ends_at, reason,
        created_by_id
      ) values (${fixture.organizationId}, ${ids.authorA}, 'high',
        now() - interval '3 days', now() - interval '2 days',
        'Expired feed test', ${fixture.adminId})
      returning id
    `;
    ids.expiredBoost = expiredBoost.id;

    const [memberKey, readOnlyKey, adminKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values
        (${fixture.organizationId}, ${fixture.memberId},
          ${`Personal feed member ${suffix}`}, ${memberSecret.slice(0, 20)},
          ${createHash("sha256").update(memberSecret).digest("hex")},
          array['community:read', 'community:write']),
        (${fixture.organizationId}, ${fixture.memberId},
          ${`Personal feed read ${suffix}`}, ${readOnlySecret.slice(0, 20)},
          ${createHash("sha256").update(readOnlySecret).digest("hex")},
          array['community:read']),
        (${fixture.organizationId}, ${fixture.adminId},
          ${`Personal feed admin ${suffix}`}, ${adminSecret.slice(0, 20)},
          ${createHash("sha256").update(adminSecret).digest("hex")},
          array['community:read', 'community:write'])
      returning id
    `;
    ids.memberKey = memberKey.id;
    ids.readOnlyKey = readOnlyKey.id;
    ids.adminKey = adminKey.id;

    const scopeRejected = await request.put(
      `/api/v1/community/follows/author/${ids.authorA}`,
      {
        headers: apiHeaders(readOnlySecret, `follow-scope-${suffix}`),
        data: { notify: false },
      },
    );
    expect(scopeRejected.status()).toBe(403);

    const deniedBoost = await request.put(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      {
        headers: apiHeaders(memberSecret, `boost-denied-${suffix}`),
        data: {
          strength: "medium",
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 86_400_000).toISOString(),
          reason: "Member may not boost",
        },
      },
    );
    expect(deniedBoost.status()).toBe(403);

    const longBoost = await request.put(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      {
        headers: apiHeaders(adminSecret, `boost-long-${suffix}`),
        data: {
          strength: "medium",
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 91 * 86_400_000).toISOString(),
          reason: "Window exceeds policy",
        },
      },
    );
    expect(longBoost.status()).toBe(422);

    const boostReason = `Launch relevance ${suffix}`;
    const boostInput = {
      strength: "medium",
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
      reason: boostReason,
    };
    const boostResponse = await request.put(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      {
        headers: apiHeaders(adminSecret, idempotencyKeys.boostCreate),
        data: boostInput,
      },
    );
    const boostResponseText = await boostResponse.text();
    expect(boostResponse.status(), boostResponseText).toBe(200);
    ids.activeBoost = JSON.parse(boostResponseText).data.id;
    const boostReplay = await request.put(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      {
        headers: apiHeaders(adminSecret, idempotencyKeys.boostCreate),
        data: boostInput,
      },
    );
    expect(boostReplay.status()).toBe(200);
    expect(boostReplay.headers()["idempotent-replayed"]).toBe("true");
    expect(await boostReplay.text()).toBe(boostResponseText);
    replayRequestIds.push(
      boostResponse.headers()["x-request-id"],
      boostReplay.headers()["x-request-id"],
    );
    const boostNoOp = await request.put(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      {
        headers: apiHeaders(adminSecret, idempotencyKeys.boostNoOp),
        data: boostInput,
      },
    );
    expect(boostNoOp.status()).toBe(200);
    expect((await boostNoOp.json()).data.id).toBe(ids.activeBoost);

    await sql`
      update users set role = 'trainer'
      where id = ${fixture.adminId} and organization_id = ${fixture.organizationId}
    `;
    try {
      const revokedBoostList = await request.get(
        "/api/v1/admin/community/boosts?limit=10",
        { headers: apiHeaders(adminSecret) },
      );
      expect([403, 422]).toContain(revokedBoostList.status());
      const revokedBoostBody = await revokedBoostList.text();
      expect(revokedBoostBody).not.toContain(boostReason);
      expect(revokedBoostBody).not.toContain(`RESTRICTED-${suffix}`);
    } finally {
      await sql`
        update users set role = ${fixture.adminRole}::role
        where id = ${fixture.adminId} and organization_id = ${fixture.organizationId}
      `;
    }

    const notifyingFollow = await request.put(
      `/api/v1/community/follows/author/${ids.authorA}`,
      {
        headers: apiHeaders(memberSecret, `follow-notify-${suffix}`),
        data: { notify: true },
      },
    );
    expect(notifyingFollow.status()).toBe(200);
    await expect(notifyingFollow.json()).resolves.toMatchObject({
      data: { targetType: "author", targetId: ids.authorA, notify: true },
    });
    const selfRejected = await request.put(
      `/api/v1/community/follows/author/${fixture.memberId}`,
      {
        headers: apiHeaders(memberSecret, `follow-self-${suffix}`),
        data: { notify: false },
      },
    );
    expect(selfRejected.status()).toBe(422);
    const foreignRejected = await request.put(
      `/api/v1/community/follows/author/${ids.foreignUser}`,
      {
        headers: apiHeaders(memberSecret, `follow-foreign-${suffix}`),
        data: { notify: false },
      },
    );
    expect(foreignRejected.status()).toBe(404);
    const apiFollow = await request.put(
      `/api/v1/community/follows/author/${ids.authorB}`,
      {
        headers: apiHeaders(memberSecret, idempotencyKeys.followCreate),
        data: { notify: false },
      },
    );
    expect(apiFollow.status()).toBe(200);
    const apiFollowText = await apiFollow.text();
    const apiFollowBody = JSON.parse(apiFollowText);
    ids.follow = apiFollowBody.data.id;
    const [storedFollow] = await sql<Array<{ followerId: string }>>`
      select follower_id as "followerId" from community_follows
      where id = ${ids.follow}
    `;
    expect(storedFollow.followerId).toBe(fixture.memberId);
    const followReplay = await request.put(
      `/api/v1/community/follows/author/${ids.authorB}`,
      {
        headers: apiHeaders(memberSecret, idempotencyKeys.followCreate),
        data: { notify: false },
      },
    );
    expect(followReplay.status()).toBe(200);
    expect(followReplay.headers()["idempotent-replayed"]).toBe("true");
    expect(await followReplay.text()).toBe(apiFollowText);
    replayRequestIds.push(
      apiFollow.headers()["x-request-id"],
      followReplay.headers()["x-request-id"],
    );
    const followNoOp = await request.put(
      `/api/v1/community/follows/author/${ids.authorB}`,
      {
        headers: apiHeaders(memberSecret, idempotencyKeys.followNoOp),
        data: { notify: false },
      },
    );
    expect(followNoOp.status()).toBe(200);
    expect((await followNoOp.json()).data.id).toBe(ids.follow);

    const [singleMutationState] = await sql<
      Array<{ boosts: number; follows: number }>
    >`
      select
        (select count(*)::int from community_author_boosts
         where id = ${ids.activeBoost}) as boosts,
        (select count(*)::int from community_follows
         where id = ${ids.follow}) as follows
    `;
    expect(singleMutationState).toEqual({ boosts: 1, follows: 1 });

    const invalidPathId = await request.get(
      "/api/v1/community/posts/not-a-uuid",
      { headers: apiHeaders(memberSecret) },
    );
    expect(invalidPathId.status()).toBe(400);
    const invalidFilterId = await request.get(
      "/api/v1/community/posts?spaceId=not-a-uuid",
      { headers: apiHeaders(memberSecret) },
    );
    expect(invalidFilterId.status()).toBe(400);

    const [reactionBefore] = await sql<
      Array<{ createdAt: Date; revision: number }>
    >`
      select post_likes.created_at as "createdAt", feed_revision.revision::int as revision
      from post_likes
      cross join lateral (
        select coalesce((
          select revision from community_feed_revisions
          where organization_id = ${fixture.organizationId}
        ), 0) as revision
      ) feed_revision
      where post_likes.organization_id = ${fixture.organizationId}
        and post_likes.post_id = ${ids.cursorReactionPost}
        and post_likes.user_id = ${fixture.memberId}
    `;
    const reactionUpdate = await request.post(
      `/api/v1/community/posts/${ids.cursorReactionPost}/reactions`,
      {
        headers: apiHeaders(memberSecret, `reaction-update-${suffix}`),
        data: { userId: fixture.memberId, reaction: "insightful" },
      },
    );
    expect(reactionUpdate.status()).toBe(201);
    const [reactionAfter] = await sql<
      Array<{ createdAt: Date; revision: number; reaction: string }>
    >`
      select post_likes.created_at as "createdAt", post_likes.reaction,
             feed_revision.revision::int as revision
      from post_likes
      cross join lateral (
        select coalesce((
          select revision from community_feed_revisions
          where organization_id = ${fixture.organizationId}
        ), 0) as revision
      ) feed_revision
      where post_likes.organization_id = ${fixture.organizationId}
        and post_likes.post_id = ${ids.cursorReactionPost}
        and post_likes.user_id = ${fixture.memberId}
    `;
    expect(reactionAfter.reaction).toBe("insightful");
    expect(reactionAfter.createdAt.toISOString()).toBe(
      reactionBefore.createdAt.toISOString(),
    );
    expect(reactionAfter.revision).toBe(reactionBefore.revision);

    const apiFeedResponse = await request.get(
      "/api/v1/community/feed?mode=for_you&limit=50",
      { headers: apiHeaders(memberSecret) },
    );
    expect(apiFeedResponse.status()).toBe(200);
    const apiFeed = (await apiFeedResponse.json()).data;
    expect(
      apiFeed.items.some(
        (post: { id: string }) => post.id === ids.restrictedPost,
      ),
    ).toBe(false);
    const apiBoosted = apiFeed.items.find(
      (post: { id: string }) => post.id === ids.boostPost,
    );
    expect(apiBoosted.attachments[0].downloadHref).toBe(
      `/api/v1/media-assets/${ids.mediaAsset}/download`,
    );

    const memberCursorResponse = await request.get(
      "/api/v1/community/feed?mode=latest&limit=2",
      { headers: apiHeaders(memberSecret) },
    );
    const memberCursor = (await memberCursorResponse.json()).data.nextCursor;
    expect(memberCursor).toBeTruthy();
    await sql`
      update users set status = 'disabled'
      where id = ${fixture.memberId} and organization_id = ${fixture.organizationId}
    `;
    try {
      const revokedCursorPage = await request.get(
        `/api/v1/community/feed?mode=latest&limit=2&cursor=${encodeURIComponent(memberCursor)}`,
        { headers: apiHeaders(memberSecret) },
      );
      expect([403, 422]).toContain(revokedCursorPage.status());
      const revokedCursorBody = await revokedCursorPage.text();
      expect(revokedCursorBody).not.toContain(`RESTRICTED-${suffix}`);
      expect(revokedCursorBody).not.toContain(boostReason);
    } finally {
      await sql`
        update users set status = ${fixture.memberStatus}::user_status
        where id = ${fixture.memberId} and organization_id = ${fixture.organizationId}
      `;
    }
    const crossActorCursor = await request.get(
      `/api/v1/community/feed?mode=latest&limit=2&cursor=${encodeURIComponent(memberCursor)}`,
      { headers: apiHeaders(adminSecret) },
    );
    expect(crossActorCursor.status()).toBe(422);

    await loginAsMember(page);
    const sessionRequest = page.context().request;
    const fullFeedResponse = await sessionRequest.get(
      "/api/community/feed?mode=for_you&limit=50",
    );
    expect(fullFeedResponse.status()).toBe(200);
    const fullFeed = (await fullFeedResponse.json()).data;
    expect(
      fullFeed.items.some(
        (post: { id: string }) => post.id === ids.restrictedPost,
      ),
    ).toBe(false);
    const boosted = fullFeed.items.find(
      (post: { id: string }) => post.id === ids.boostPost,
    );
    expect(boosted.reasonCodes).toContain("boosted");
    expect(boosted).not.toHaveProperty("score");
    expect(boosted).not.toHaveProperty("boostStrength");
    expect(boosted.attachments[0].downloadHref).toBe(
      `/api/media-assets/${ids.mediaAsset}/download`,
    );
    expect(boosted.commentCount).toBe(20);
    expect(boosted.comments).toHaveLength(3);
    for (const comment of boosted.comments) {
      expect(comment.replies.length).toBeLessThanOrEqual(2);
      expect(comment.replyCount).toBe(4);
    }
    const selfOnly = fullFeed.items.find(
      (post: { id: string }) => post.id === ids.selfPost,
    );
    expect(selfOnly.reasonCodes).not.toContain("trending");
    expect(selfOnly.reasonCodes).not.toContain("boosted");

    const topCommentsResponse = await sessionRequest.get(
      `/api/community/posts/${ids.boostPost}/comments?limit=2`,
    );
    expect(topCommentsResponse.status()).toBe(200);
    const topComments = (await topCommentsResponse.json()).data;
    expect(topComments.items).toHaveLength(2);
    expect(topComments.hasMore).toBe(true);
    expect(topComments.items[0].replyCount).toBe(4);
    const repliesResponse = await sessionRequest.get(
      `/api/community/posts/${ids.boostPost}/comments?limit=2&parentId=${topComments.items[0].id}`,
    );
    expect(repliesResponse.status()).toBe(200);
    const replies = (await repliesResponse.json()).data;
    expect(replies.items).toHaveLength(2);
    expect(replies.hasMore).toBe(true);

    const firstPageResponse = await sessionRequest.get(
      "/api/community/feed?mode=latest&limit=2",
    );
    expect(firstPageResponse.status()).toBe(200);
    const firstPage = (await firstPageResponse.json()).data;
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).toBeTruthy();
    const tamperedResponse = await sessionRequest.get(
      `/api/community/feed?mode=latest&limit=2&cursor=${encodeURIComponent(`${firstPage.nextCursor}x`)}`,
    );
    expect(tamperedResponse.status()).toBe(422);
    const mismatchResponse = await sessionRequest.get(
      `/api/community/feed?mode=for_you&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    expect(mismatchResponse.status()).toBe(422);

    const [newPost] = await sql<Array<{ id: string }>>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${fixture.organizationId}, ${ids.openSpace}, ${ids.authorA},
        ${`After snapshot ${suffix}`})
      returning id
    `;
    postIds.push(newPost.id);
    const secondPageResponse = await sessionRequest.get(
      `/api/community/feed?mode=latest&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    expect(secondPageResponse.status()).toBe(200);
    const secondPage = (await secondPageResponse.json()).data;
    expect(
      secondPage.items.some((post: { id: string }) => post.id === newPost.id),
    ).toBe(false);
    expect(
      secondPage.items.some((post: { id: string }) =>
        firstPage.items.some((first: { id: string }) => first.id === post.id),
      ),
    ).toBe(false);

    await sql`
      delete from post_likes
      where organization_id = ${fixture.organizationId}
        and post_id = ${ids.cursorReactionPost}
        and user_id = ${fixture.memberId}
    `;
    const invalidatedResponse = await sessionRequest.get(
      `/api/community/feed?mode=latest&limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    );
    expect(invalidatedResponse.status()).toBe(422);

    const followingResponse = await sessionRequest.get(
      "/api/community/feed?mode=following&limit=50",
    );
    expect(followingResponse.status()).toBe(200);
    expect(
      (await followingResponse.json()).data.items.some(
        (post: { authorId: string }) => post.authorId === ids.authorB,
      ),
    ).toBe(true);

    const deleteFollow = await request.delete(
      `/api/v1/community/follows/author/${ids.authorB}`,
      { headers: apiHeaders(memberSecret, idempotencyKeys.followDelete) },
    );
    expect(deleteFollow.status()).toBe(200);
    const deleteFollowText = await deleteFollow.text();
    expect(JSON.parse(deleteFollowText).data.removed).toBe(true);
    const deleteFollowReplay = await request.delete(
      `/api/v1/community/follows/author/${ids.authorB}`,
      { headers: apiHeaders(memberSecret, idempotencyKeys.followDelete) },
    );
    expect(deleteFollowReplay.status()).toBe(200);
    expect(deleteFollowReplay.headers()["idempotent-replayed"]).toBe("true");
    expect(await deleteFollowReplay.text()).toBe(deleteFollowText);
    replayRequestIds.push(
      deleteFollow.headers()["x-request-id"],
      deleteFollowReplay.headers()["x-request-id"],
    );
    const deleteBoost = await request.delete(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      { headers: apiHeaders(adminSecret, idempotencyKeys.boostDelete) },
    );
    expect(deleteBoost.status()).toBe(200);
    const deleteBoostText = await deleteBoost.text();
    expect(JSON.parse(deleteBoostText).data.removed).toBe(true);
    const deleteBoostReplay = await request.delete(
      `/api/v1/admin/community/boosts/${ids.authorB}`,
      { headers: apiHeaders(adminSecret, idempotencyKeys.boostDelete) },
    );
    expect(deleteBoostReplay.status()).toBe(200);
    expect(deleteBoostReplay.headers()["idempotent-replayed"]).toBe("true");
    expect(await deleteBoostReplay.text()).toBe(deleteBoostText);
    replayRequestIds.push(
      deleteBoost.headers()["x-request-id"],
      deleteBoostReplay.headers()["x-request-id"],
    );

    const [removedMutationState] = await sql<
      Array<{ boosts: number; follows: number }>
    >`
      select
        (select count(*)::int from community_author_boosts
         where id = ${ids.activeBoost}) as boosts,
        (select count(*)::int from community_follows
         where id = ${ids.follow}) as follows
    `;
    expect(removedMutationState).toEqual({ boosts: 0, follows: 0 });

    const boostEvents = await sql<
      Array<{ id: string; type: string; metadata: unknown }>
    >`
      select id, type, metadata from activity_events
      where organization_id = ${fixture.organizationId}
        and entity_type = 'community_author_boost'
        and entity_id = ${ids.activeBoost}
    `;
    activityIds.push(...boostEvents.map((event) => event.id));
    expect(
      JSON.stringify(boostEvents.map((event) => event.metadata)),
    ).not.toContain(boostReason);
    expect(
      boostEvents.filter(
        (event) => event.type === "community.author_boost.replaced",
      ),
    ).toHaveLength(1);
    expect(
      boostEvents.filter(
        (event) => event.type === "community.author_boost.removed",
      ),
    ).toHaveLength(1);
    const followEvents = await sql<Array<{ id: string; type: string }>>`
      select id, type from activity_events
      where organization_id = ${fixture.organizationId}
        and entity_type = 'community_follow'
        and entity_id = ${ids.follow}
    `;
    activityIds.push(...followEvents.map((event) => event.id));
    expect(
      followEvents.filter((event) => event.type === "community.follow.created"),
    ).toHaveLength(1);
    expect(
      followEvents.filter((event) => event.type === "community.follow.removed"),
    ).toHaveLength(1);

    const [replayState] = await sql<
      Array<{ audits: number; idempotencyClaims: number }>
    >`
      select
        (select count(*)::int from api_audit_logs
         where request_id = any(${replayRequestIds}::uuid[])) as audits,
        (select count(*)::int from api_idempotency_keys
         where key = any(${[
           idempotencyKeys.boostCreate,
           idempotencyKeys.boostDelete,
           idempotencyKeys.followCreate,
           idempotencyKeys.followDelete,
         ]}::varchar[])
           and status = 'completed') as "idempotencyClaims"
    `;
    expect(replayState).toEqual({ audits: 8, idempotencyClaims: 4 });

    const feedPrimaryHash = rateLimitHash(
      "community_feed_read",
      `${fixture.organizationId}\0${fixture.memberId}`,
    );
    const feedTenantHash = rateLimitHash(
      "community_feed_read_tenant",
      fixture.organizationId,
    );
    await sql`
      insert into auth_rate_limits (action, key_hash, attempts, reset_at, updated_at)
      values
        ('community_feed_read', ${feedPrimaryHash}, 120, now() + interval '10 minutes', now()),
        ('community_feed_read_tenant', ${feedTenantHash}, 10, now() + interval '10 minutes', now())
      on conflict (action, key_hash) do update
      set attempts = excluded.attempts, reset_at = excluded.reset_at,
          updated_at = excluded.updated_at
    `;
    const limitedFeed = await sessionRequest.get(
      "/api/community/feed?mode=latest&limit=1",
    );
    expect(limitedFeed.status()).toBe(429);
    expect(Number(limitedFeed.headers()["retry-after"])).toBeGreaterThan(0);
    const [feedTenantBucket] = await sql<Array<{ attempts: number }>>`
      select attempts from auth_rate_limits
      where action = 'community_feed_read_tenant' and key_hash = ${feedTenantHash}
    `;
    expect(feedTenantBucket.attempts).toBe(10);

    const reactionPrimaryHash = rateLimitHash(
      "community_reaction_mutation",
      `${fixture.organizationId}\0${fixture.memberId}`,
    );
    const reactionTenantHash = rateLimitHash(
      "community_reaction_mutation_tenant",
      fixture.organizationId,
    );
    await sql`
      insert into auth_rate_limits (action, key_hash, attempts, reset_at, updated_at)
      values
        ('community_reaction_mutation', ${reactionPrimaryHash}, 120, now() + interval '10 minutes', now()),
        ('community_reaction_mutation_tenant', ${reactionTenantHash}, 10, now() + interval '10 minutes', now())
      on conflict (action, key_hash) do update
      set attempts = excluded.attempts, reset_at = excluded.reset_at,
          updated_at = excluded.updated_at
    `;
    const limitedReaction = await request.post(
      `/api/v1/community/posts/${ids.selfPost}/reactions`,
      {
        headers: apiHeaders(memberSecret, `reaction-limited-${suffix}`),
        data: { userId: fixture.memberId, reaction: "like" },
      },
    );
    expect(limitedReaction.status()).toBe(429);
    const [reactionTenantBucket] = await sql<Array<{ attempts: number }>>`
      select attempts from auth_rate_limits
      where action = 'community_reaction_mutation_tenant'
        and key_hash = ${reactionTenantHash}
    `;
    expect(reactionTenantBucket.attempts).toBe(10);
  } finally {
    const keyIds = [ids.memberKey, ids.readOnlyKey, ids.adminKey].filter(
      Boolean,
    );
    if (keyIds.length) {
      await sql`
        delete from api_audit_logs
        where api_key_id = any(${keyIds}::uuid[]) and created_at >= ${startedAt}
      `;
      await sql`
        delete from api_idempotency_keys
        where api_key_id = any(${keyIds}::uuid[]) and created_at >= ${startedAt}
      `;
    }
    if (organizationId) {
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and type in (
            'community.follow.created', 'community.follow.updated',
            'community.follow.removed', 'community.author_boost.replaced',
            'community.author_boost.removed'
          )
          and (
            entity_id = any(${[ids.follow, ids.activeBoost].filter(Boolean)}::uuid[])
            or user_id = any(${[memberId, adminId].filter(Boolean)}::uuid[])
          )
      `;
    }
    if (keyIds.length) {
      await sql`
        delete from api_keys
        where id = any(${keyIds}::uuid[])
      `;
    }
    if (ids.openSpace || ids.restrictedSpace) {
      await sql`
        delete from community_spaces
        where id = any(${[ids.openSpace, ids.restrictedSpace].filter(Boolean)}::uuid[])
      `;
    }
    if (ids.authorA || ids.authorB) {
      await sql`
        delete from users
        where id = any(${[ids.authorA, ids.authorB].filter(Boolean)}::uuid[])
      `;
    }
    if (ids.foreignOrganization) {
      await sql`delete from organizations where id = ${ids.foreignOrganization}`;
    }
    await sql`delete from media_assets where id = ${ids.mediaAsset}`;
    if (organizationId) {
      const rateHashes = [
        ...keyIds.flatMap((keyId) => [
          rateLimitHash("api_read", keyId),
          rateLimitHash("api_write", keyId),
        ]),
        rateLimitHash("api_read_tenant", organizationId),
        rateLimitHash("api_write_tenant", organizationId),
        rateLimitHash("community_follow_mutation_tenant", organizationId),
        rateLimitHash("community_boost_mutation_tenant", organizationId),
        rateLimitHash("community_feed_read_tenant", organizationId),
        rateLimitHash("community_comment_read_tenant", organizationId),
        rateLimitHash("community_reaction_mutation_tenant", organizationId),
        ...(memberId
          ? [
              rateLimitHash(
                "community_follow_mutation",
                `${organizationId}\0${memberId}`,
              ),
              rateLimitHash(
                "community_feed_read",
                `${organizationId}\0${memberId}`,
              ),
              rateLimitHash(
                "community_comment_read",
                `${organizationId}\0${memberId}`,
              ),
              rateLimitHash(
                "community_reaction_mutation",
                `${organizationId}\0${memberId}`,
              ),
            ]
          : []),
        ...(adminId
          ? [
              rateLimitHash(
                "community_boost_mutation",
                `${organizationId}\0${adminId}`,
              ),
              rateLimitHash(
                "community_feed_read",
                `${organizationId}\0${adminId}`,
              ),
            ]
          : []),
      ];
      await sql`
        delete from auth_rate_limits where key_hash = any(${rateHashes}::varchar[])
      `;
    }
    await sql.end();
  }
});
