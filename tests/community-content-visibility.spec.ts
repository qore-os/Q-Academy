import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { ensureCommunityAreaFixture } from "./helpers/community-area";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function environmentValue(name: string) {
  if (process.env[name]) return process.env[name]!;
  return readFile(resolve(process.cwd(), ".env"), "utf8").then((source) => {
    const line = source
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || "";
  });
}

async function rateLimitHash(action: string, identifier: string) {
  return createHmac("sha256", await environmentValue("AUTH_RATE_LIMIT_SECRET"))
    .update(["v1", action, identifier, ""].join("\0"))
    .digest("hex");
}

function apiHeaders(secret: string, idempotencyKey?: string) {
  return {
    Authorization: `Bearer ${secret}`,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function downloadApiMedia(
  request: APIRequestContext,
  href: string,
  secret: string,
) {
  const redirect = await request.get(href, {
    headers: apiHeaders(secret),
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(307);
  const location = redirect.headers().location;
  expect(location).toBeTruthy();
  return request.get(location, { headers: apiHeaders(secret) });
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("non-published community content stays out of normal reads and downloads", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "visibility matrix runs once",
  );
  test.setTimeout(180_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = randomUUID().slice(0, 8);
  const publishedMarker = `QVIS-${suffix}-PUBLISHED`;
  const hiddenMarker = `QVIS-${suffix}-HIDDEN`;
  const memberSecret = `qak_visibility_member_${randomBytes(24).toString("base64url")}`;
  const authorSecret = `qak_visibility_author_${randomBytes(24).toString("base64url")}`;
  let organizationId = "";
  let memberId = "";
  let authorId = "";
  let adminId = "";
  let spaceId = "";
  const keyIds: string[] = [];
  const postIds: Record<string, string> = {};
  const commentIds: Record<string, string> = {};
  const assetIds: string[] = [];
  const storagePaths: string[] = [];

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        memberId: string;
        authorId: string;
        adminId: string;
      }>
    >`
      select member.organization_id as "organizationId",
             member.id as "memberId", author.id as "authorId",
             admin.id as "adminId"
      from users member
      join users author on author.organization_id = member.organization_id
      join users admin on admin.organization_id = member.organization_id
      where member.email = 'lea@q-academy.de'
        and author.email = 'jonas@q-academy.de'
        and admin.email = 'admin@q-academy.de'
      limit 1
    `;
    if (!fixture) throw new Error("Seeded visibility actors are missing.");
    ({ organizationId, memberId, authorId, adminId } = fixture);

    const area = await ensureCommunityAreaFixture(sql, organizationId);

    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, type, access_mode, color,
        sort_order
      ) values (
        ${organizationId}, ${area.id}, ${`Visibility ${suffix}`},
        ${`visibility-${suffix}`}, 'discussion', 'open', '#278c82',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;

    const createdPosts = await sql<
      Array<{ id: string; moderationState: string }>
    >`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        moderation_state, published_at
      ) values
        (${organizationId}, ${spaceId}, ${authorId}, ${publishedMarker},
          ${publishedMarker}, 'published', now()),
        (${organizationId}, ${spaceId}, ${authorId}, ${`${hiddenMarker}-PENDING`},
          ${`${hiddenMarker}-PENDING`}, 'pending', null),
        (${organizationId}, ${spaceId}, ${authorId}, ${`${hiddenMarker}-HELD`},
          ${`${hiddenMarker}-HELD`}, 'held', null),
        (${organizationId}, ${spaceId}, ${authorId}, ${`${hiddenMarker}-REJECTED`},
          ${`${hiddenMarker}-REJECTED`}, 'rejected', null)
      returning id, moderation_state as "moderationState"
    `;
    for (const post of createdPosts) postIds[post.moderationState] = post.id;

    const createdComments = await sql<
      Array<{ id: string; moderationState: string }>
    >`
      insert into comments (
        organization_id, post_id, author_id, content,
        moderation_state, published_at
      ) values
        (${organizationId}, ${postIds.published}, ${authorId},
          ${`${publishedMarker}-COMMENT`}, 'published', now()),
        (${organizationId}, ${postIds.published}, ${authorId},
          ${`${hiddenMarker}-COMMENT-PENDING`}, 'pending', null),
        (${organizationId}, ${postIds.published}, ${authorId},
          ${`${hiddenMarker}-COMMENT-HELD`}, 'held', null),
        (${organizationId}, ${postIds.published}, ${authorId},
          ${`${hiddenMarker}-COMMENT-REJECTED`}, 'rejected', null),
        (${organizationId}, ${postIds.held}, ${authorId},
          ${`${hiddenMarker}-PUBLISHED-COMMENT-ON-HELD-POST`}, 'published', now())
      returning id, moderation_state as "moderationState"
    `;
    commentIds.published = createdComments[0]!.id;
    commentIds.pending = createdComments[1]!.id;
    commentIds.held = createdComments[2]!.id;
    commentIds.rejected = createdComments[3]!.id;
    commentIds.publishedOnHeldPost = createdComments[4]!.id;

    await sql`
      insert into post_likes (organization_id, post_id, user_id, reaction)
      values (${organizationId}, ${postIds.held}, ${memberId}, 'like')
    `;
    await sql`
      insert into post_votes (organization_id, post_id, user_id, value)
      values (${organizationId}, ${postIds.held}, ${memberId}, 1)
    `;

    const insertAsset = async (name: string) => {
      const id = randomUUID();
      const body = Buffer.from(`visibility-${name}-${suffix}`, "utf8");
      const storageKey = `tenants/${organizationId}/assets/${id}/${name}.txt`;
      const stagingStorageKey = `incoming/tenants/${organizationId}/assets/${id}/${name}.txt`;
      const storagePath = resolve(
        process.cwd(),
        ".data",
        "media",
        ...storageKey.split("/"),
      );
      await mkdir(dirname(storagePath), { recursive: true });
      await writeFile(storagePath, body);
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
          status, storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          detected_mime_type, declared_size_bytes, actual_size_bytes,
          quota_bytes, content_sha256, upload_expires_at, uploaded_at,
          scan_completed_at
        ) values (
          ${id}, ${organizationId}, ${authorId}, ${authorId}, 'community',
          'document', 'ready', 'filesystem', ${storageKey}, ${stagingStorageKey},
          ${`${name}.txt`}, ${`${name}.txt`}, 'text/plain', 'text/plain',
          ${body.byteLength}, ${body.byteLength}, ${body.byteLength},
          ${createHash("sha256").update(body).digest("hex")},
          now() + interval '1 hour', now(), now()
        )
      `;
      assetIds.push(id);
      storagePaths.push(storagePath);
      return { id, body };
    };

    const publishedAsset = await insertAsset("published");
    const heldPostAsset = await insertAsset("held-post");
    const heldCommentAsset = await insertAsset("held-comment");
    await sql`
      insert into community_post_attachments (
        organization_id, post_id, media_asset_id, sort_order
      ) values
        (${organizationId}, ${postIds.published}, ${publishedAsset.id}, 0),
        (${organizationId}, ${postIds.held}, ${heldPostAsset.id}, 0)
    `;
    await sql`
      insert into community_comment_attachments (
        organization_id, comment_id, post_id, media_asset_id, sort_order
      ) values (
        ${organizationId}, ${commentIds.held}, ${postIds.published},
        ${heldCommentAsset.id}, 0
      )
    `;

    const keys = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values
        (${organizationId}, ${memberId}, ${`Visibility member ${suffix}`},
          ${memberSecret.slice(0, 20)},
          ${createHash("sha256").update(memberSecret).digest("hex")},
          array['community:read', 'community:write', 'search:read']),
        (${organizationId}, ${authorId}, ${`Visibility author ${suffix}`},
          ${authorSecret.slice(0, 20)},
          ${createHash("sha256").update(authorSecret).digest("hex")},
          array['community:read'])
      returning id
    `;
    keyIds.push(...keys.map((key) => key.id));

    const spacesResponse = await request.get(
      `/api/v1/community/spaces?search=${encodeURIComponent(`Visibility ${suffix}`)}`,
      { headers: apiHeaders(memberSecret) },
    );
    expect(spacesResponse.status()).toBe(200);
    const matchingSpace = (await spacesResponse.json()).data.find(
      (space: { id: string }) => space.id === spaceId,
    );
    expect(matchingSpace.postCount).toBe(1);

    const listed = await request.get(
      `/api/v1/community/posts?search=${encodeURIComponent(`QVIS-${suffix}`)}&limit=50`,
      { headers: apiHeaders(memberSecret) },
    );
    expect(listed.status()).toBe(200);
    const listedBody = await listed.json();
    expect(listedBody.data.map((post: { id: string }) => post.id)).toEqual([
      postIds.published,
    ]);
    expect(listedBody.data[0].commentCount).toBe(1);

    const feed = await request.get(
      "/api/v1/community/feed?mode=latest&limit=50",
      {
        headers: apiHeaders(memberSecret),
      },
    );
    expect(feed.status()).toBe(200);
    const feedBody = await feed.json();
    expect(
      feedBody.data.items.some(
        (post: { id: string }) => post.id === postIds.published,
      ),
    ).toBe(true);
    expect(
      feedBody.data.items.some((post: { id: string }) =>
        [postIds.pending, postIds.held, postIds.rejected].includes(post.id),
      ),
    ).toBe(false);
    const feedPost = feedBody.data.items.find(
      (post: { id: string }) => post.id === postIds.published,
    );
    expect(feedPost.commentCount).toBe(1);
    expect(
      feedPost.comments.map((comment: { id: string }) => comment.id),
    ).toEqual([commentIds.published]);

    for (const id of [postIds.pending, postIds.held, postIds.rejected]) {
      expect(
        (
          await request.get(`/api/v1/community/posts/${id}`, {
            headers: apiHeaders(memberSecret),
          })
        ).status(),
      ).toBe(404);
    }

    const comments = await request.get(
      `/api/v1/community/posts/${postIds.published}/comments?limit=50`,
      { headers: apiHeaders(memberSecret) },
    );
    expect(comments.status()).toBe(200);
    expect(
      (await comments.json()).data.map((comment: { id: string }) => comment.id),
    ).toEqual([commentIds.published]);
    for (const id of [
      commentIds.pending,
      commentIds.held,
      commentIds.rejected,
      commentIds.publishedOnHeldPost,
    ]) {
      expect(
        (
          await request.get(`/api/v1/community/comments/${id}`, {
            headers: apiHeaders(memberSecret),
          })
        ).status(),
      ).toBe(404);
    }
    expect(
      (
        await request.get(`/api/v1/community/posts/${postIds.held}/comments`, {
          headers: apiHeaders(memberSecret),
        })
      ).status(),
    ).toBe(404);

    expect(
      (
        await request.get(`/api/v1/community/posts/${postIds.held}/reactions`, {
          headers: apiHeaders(memberSecret),
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get(`/api/v1/community/posts/${postIds.held}/votes`, {
          headers: apiHeaders(memberSecret),
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(
          `/api/v1/community/posts/${postIds.held}/reactions`,
          {
            headers: apiHeaders(memberSecret, `visibility-reaction-${suffix}`),
            data: { userId: memberId, reaction: "like" },
          },
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`/api/v1/community/posts/${postIds.held}/votes`, {
          headers: apiHeaders(memberSecret, `visibility-vote-${suffix}`),
          data: { userId: memberId, value: 1 },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post(`/api/v1/community/posts/${postIds.held}/comments`, {
          headers: apiHeaders(memberSecret, `visibility-comment-${suffix}`),
          data: { authorId: memberId, content: "Must not be created" },
        })
      ).status(),
    ).toBe(404);

    const hiddenSearch = await request.get(
      `/api/v1/search?q=${encodeURIComponent(hiddenMarker)}&types=community&limit=20`,
      { headers: apiHeaders(memberSecret) },
    );
    expect(hiddenSearch.status()).toBe(200);
    expect((await hiddenSearch.json()).data).toEqual([]);
    const publishedSearch = await request.get(
      `/api/v1/search?q=${encodeURIComponent(publishedMarker)}&types=community&limit=20`,
      { headers: apiHeaders(memberSecret) },
    );
    expect(publishedSearch.status()).toBe(200);
    expect(
      (await publishedSearch.json()).data.some(
        (result: { id: string }) => result.id === postIds.published,
      ),
    ).toBe(true);

    const publishedApiDownload = await downloadApiMedia(
      request,
      `/api/v1/media-assets/${publishedAsset.id}/download`,
      memberSecret,
    );
    expect(publishedApiDownload.status()).toBe(200);
    expect(await publishedApiDownload.body()).toEqual(publishedAsset.body);
    for (const [secret, assetId] of [
      [memberSecret, heldPostAsset.id],
      [memberSecret, heldCommentAsset.id],
      [authorSecret, heldPostAsset.id],
    ] as const) {
      expect(
        (
          await request.get(`/api/v1/media-assets/${assetId}/download`, {
            headers: apiHeaders(secret),
          })
        ).status(),
      ).toBe(404);
    }

    await loginAsMember(page);
    const memberFeedResponse = await page.request.get(
      "/api/community/feed?mode=latest&limit=50",
    );
    expect(memberFeedResponse.status()).toBe(200);
    const memberFeed = (await memberFeedResponse.json()).data;
    expect(
      memberFeed.items.some(
        (post: { id: string }) => post.id === postIds.published,
      ),
    ).toBe(true);
    expect(
      memberFeed.items.some((post: { id: string }) =>
        [postIds.pending, postIds.held, postIds.rejected].includes(post.id),
      ),
    ).toBe(false);
    const memberFeedPost = memberFeed.items.find(
      (post: { id: string }) => post.id === postIds.published,
    );
    expect(memberFeedPost.commentCount).toBe(1);
    expect(
      memberFeedPost.comments.map((comment: { id: string }) => comment.id),
    ).toEqual([commentIds.published]);

    const memberCommentsResponse = await page.request.get(
      `/api/community/posts/${postIds.published}/comments?limit=50`,
    );
    expect(memberCommentsResponse.status()).toBe(200);
    expect(
      (await memberCommentsResponse.json()).data.items.map(
        (comment: { id: string }) => comment.id,
      ),
    ).toEqual([commentIds.published]);
    expect(
      (
        await page.request.get(
          `/api/community/posts/${postIds.held}/comments?limit=50`,
        )
      ).status(),
    ).toBe(404);

    await page.goto("/academy");
    await expect(
      page.getByText(publishedMarker, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(new RegExp(hiddenMarker))).toHaveCount(0);
    const memberNavigation = await page.evaluate(async (query) => {
      const response = await fetch(
        `/api/navigation-search?mode=member&q=${encodeURIComponent(query)}`,
      );
      return { status: response.status, body: await response.json() };
    }, hiddenMarker);
    expect(memberNavigation.status).toBe(200);
    expect(memberNavigation.body.data).toEqual([]);
    expect(
      (
        await page.request.get(`/api/media-assets/${heldPostAsset.id}/download`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.get(
          `/api/media-assets/${heldCommentAsset.id}/download`,
        )
      ).status(),
    ).toBe(404);
    const memberPublishedDownload = await page.request.get(
      `/api/media-assets/${publishedAsset.id}/download`,
    );
    expect(memberPublishedDownload.status()).toBe(200);
    expect(await memberPublishedDownload.body()).toEqual(publishedAsset.body);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    const adminNavigation = await page.evaluate(async (query) => {
      const response = await fetch(
        `/api/navigation-search?mode=admin&q=${encodeURIComponent(query)}`,
      );
      return { status: response.status, body: await response.json() };
    }, hiddenMarker);
    expect(adminNavigation.status).toBe(200);
    expect(adminNavigation.body.data).toEqual([]);
    expect(
      (
        await page.request.get(`/api/media-assets/${heldPostAsset.id}/download`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.get(
          `/api/media-assets/${heldCommentAsset.id}/download`,
        )
      ).status(),
    ).toBe(404);
    await page.goto("/admin/community");
    const adminSpace = page.locator(`#space-${spaceId}`);
    await expect(
      adminSpace.getByText(adminCopy.moderation.postsCount("1"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      adminSpace.getByText(adminCopy.moderation.repliesCount("1"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: publishedMarker, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(new RegExp(hiddenMarker))).toHaveCount(0);
  } finally {
    if (keyIds.length) {
      await sql`
        delete from api_audit_logs
        where api_key_id = any(${keyIds}::uuid[]) and created_at >= ${startedAt}
      `;
      await sql`
        delete from api_idempotency_keys
        where api_key_id = any(${keyIds}::uuid[]) and created_at >= ${startedAt}
      `;
      await sql`delete from api_keys where id = any(${keyIds}::uuid[])`;
    }
    if (spaceId) await sql`delete from community_spaces where id = ${spaceId}`;
    if (assetIds.length) {
      await sql`delete from media_assets where id = any(${assetIds}::uuid[])`;
    }
    if (organizationId) {
      const hashes = await Promise.all([
        ...keyIds.flatMap((keyId) => [
          rateLimitHash("api_read", keyId),
          rateLimitHash("api_write", keyId),
        ]),
        rateLimitHash("api_read_tenant", organizationId),
        rateLimitHash("api_write_tenant", organizationId),
        rateLimitHash("community_feed_read_tenant", organizationId),
        rateLimitHash("community_comment_create_tenant", organizationId),
        rateLimitHash("community_reaction_mutation_tenant", organizationId),
        rateLimitHash("community_vote_mutation_tenant", organizationId),
        rateLimitHash("media_download_tenant", organizationId),
        ...(memberId
          ? [
              rateLimitHash(
                "community_feed_read",
                `${organizationId}\0${memberId}`,
              ),
              rateLimitHash("community_comment_create", memberId),
              rateLimitHash(
                "community_reaction_mutation",
                `${organizationId}\0${memberId}`,
              ),
              rateLimitHash(
                "community_vote_mutation",
                `${organizationId}\0${memberId}`,
              ),
              ...assetIds.map((assetId) =>
                rateLimitHash("media_download", `${memberId}:${assetId}`),
              ),
            ]
          : []),
        ...(adminId
          ? assetIds.map((assetId) =>
              rateLimitHash("media_download", `${adminId}:${assetId}`),
            )
          : []),
      ]);
      await sql`
        delete from auth_rate_limits where key_hash = any(${hashes}::varchar[])
      `;
    }
    for (const storagePath of storagePaths) {
      await unlink(storagePath).catch(() => undefined);
    }
    await sql.end();
  }
});
