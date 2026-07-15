import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import {
  getCommunityNotificationCopy,
  resolveCommunityActionMessage,
} from "../src/lib/i18n/community-actions";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const notificationCopy = getCommunityNotificationCopy("de");
const publishedPostMessage = resolveCommunityActionMessage("de", {
  code: "contentCreated",
  params: { target: "post", moderationState: "published" },
});

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("typed forums enforce threads, reactions, votes, mentions and tenant boundaries", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "community lifecycle runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const discussionTitle = `Diskussion ${suffix}`;
  const announcementTitle = `Ankuendigung ${suffix}`;
  const apiSecret = `qak_forum_${randomBytes(28).toString("base64url")}`;
  let organizationId = "";
  let memberId = "";
  let mentionedUserId = "";
  let adminId = "";
  let originalPoints = 0;
  let originalAdminPoints = 0;
  let discussionSpaceId = "";
  let announcementSpaceId = "";
  let feedSpaceId = "";
  let postId = "";
  let rootCommentId = "";
  let replyId = "";
  let apiKeyId = "";
  let foreignOrganizationId = "";

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        member_id: string;
        mentioned_user_id: string;
        admin_id: string;
        points: number;
        admin_points: number;
      }>
    >`
      select
        member.organization_id,
        member.id as member_id,
        mentioned.id as mentioned_user_id,
        admin.id as admin_id,
        member.points,
        admin.points as admin_points
      from users member
      join users mentioned
        on mentioned.organization_id = member.organization_id
       and mentioned.email = 'jonas@q-academy.de'
      join users admin
        on admin.organization_id = member.organization_id
       and admin.email = 'admin@q-academy.de'
      where member.email = 'lea@q-academy.de'
      limit 1
    `;
    organizationId = fixture.organization_id;
    memberId = fixture.member_id;
    mentionedUserId = fixture.mentioned_user_id;
    adminId = fixture.admin_id;
    originalPoints = fixture.points;
    originalAdminPoints = fixture.admin_points;

    const area = await ensureCommunityAreaFixture(sql, organizationId);

    const spaces = await sql<Array<{ id: string; type: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        sort_order
      ) values
        (${organizationId}, ${area.id}, ${`Forum ${suffix}`},
          ${`forum-${suffix}`}, 'Diskussionsforum fuer E2E', '#2bb7a9',
          'discussion', ${area.nextSpaceSortOrder}),
        (${organizationId}, ${area.id}, ${`News ${suffix}`},
          ${`news-${suffix}`}, 'Ankuendigungsforum fuer E2E', '#4f7cac',
          'announcement', ${area.nextSpaceSortOrder + 1}),
        (${organizationId}, ${area.id}, ${`Feed ${suffix}`},
          ${`feed-${suffix}`}, 'Feed fuer negative Vote-Tests', '#ee6c5d',
          'feed', ${area.nextSpaceSortOrder + 2})
      returning id, type
    `;
    discussionSpaceId = spaces.find((space) => space.type === "discussion")!.id;
    announcementSpaceId = spaces.find((space) => space.type === "announcement")!.id;
    feedSpaceId = spaces.find((space) => space.type === "feed")!.id;

    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, created_by_id, name, prefix, key_hash, scopes
      ) values (
        ${organizationId}, ${adminId}, ${`Forum ${suffix}`},
        ${apiSecret.slice(0, 20)}, ${hashSecret(apiSecret)},
        array['community:read', 'community:write']
      )
      returning id
    `;
    apiKeyId = apiKey.id;
    const headers = {
      Authorization: `Bearer ${apiSecret}`,
      "Content-Type": "application/json",
    };

    await login(page, "member");
    await page.goto("/academy/community");
    await page.getByRole("button", { name: /Teile eine Frage/ }).click();
    const composer = page.getByRole("dialog", { name: "Neuer Beitrag" });
    await expect(
      composer.locator(`option[value="${announcementSpaceId}"]`),
    ).toHaveCount(0);
    await composer.locator('select[name="spaceId"]').selectOption(discussionSpaceId);
    await composer.getByPlaceholder("Titel der Diskussion").fill(discussionTitle);
    await composer
      .locator('textarea[name="content"]')
      .fill(`Wie bewertet ihr diesen Ansatz, @jonas? ${suffix}`);
    await composer.getByRole("button", { name: "Veroeffentlichen" }).click();
    await expect(
      composer.getByText(publishedPostMessage, { exact: true }),
    ).toBeVisible();
    await composer.getByRole("button", { name: "Dialog schliessen" }).click();
    await expect(composer).toBeHidden();

    const article = page.locator("article").filter({
      has: page.getByRole("heading", { name: discussionTitle }),
    });
    await expect(article).toBeVisible();
    await article.getByRole("button", { name: "Hilfreich" }).click();
    await article.getByRole("button", { name: "Positiv voten" }).click();
    await article.getByPlaceholder("Antwort schreiben...").fill(`Erste Antwort ${suffix}`);
    await article.getByRole("button", { name: "Antwort veroeffentlichen" }).click();
    await expect(article.getByText(`Erste Antwort ${suffix}`, { exact: true })).toBeVisible();
    await article.getByRole("button", { name: /Auf Antwort von .* antworten/ }).click();
    const threadComposer = article.locator("form").filter({
      has: page.getByPlaceholder("Im Thread antworten..."),
    });
    await threadComposer
      .getByPlaceholder("Im Thread antworten...")
      .fill(`Thread-Antwort ${suffix}`);
    await threadComposer
      .getByRole("button", { name: "Antwort veroeffentlichen" })
      .click();
    await expect(article.getByText(`Thread-Antwort ${suffix}`, { exact: true })).toBeVisible();

    const [storedPost] = await sql<
      Array<{ id: string; title: string; locked: boolean; type: string }>
    >`
      select p.id, p.title, p.locked, s.type
      from posts p
      join community_spaces s on s.id = p.space_id
      where p.organization_id = ${organizationId}
        and p.title = ${discussionTitle}
    `;
    postId = storedPost.id;
    expect(storedPost).toMatchObject({
      title: discussionTitle,
      locked: false,
      type: "discussion",
    });
    const commentRows = await sql<
      Array<{ id: string; parent_id: string | null; content: string }>
    >`
      select id, parent_id, content
      from comments
      where post_id = ${postId}
      order by created_at
    `;
    rootCommentId = commentRows.find((comment) => !comment.parent_id)!.id;
    replyId = commentRows.find((comment) => comment.parent_id)!.id;
    expect(commentRows.find((comment) => comment.id === replyId)?.parent_id).toBe(
      rootCommentId,
    );

    const [socialState] = await sql<
      Array<{
        reaction: string;
        vote: number;
        mention_count: number;
        notification_count: number;
      }>
    >`
      select
        (select reaction from post_likes where post_id = ${postId} and user_id = ${memberId}) as reaction,
        (select value from post_votes where post_id = ${postId} and user_id = ${memberId}) as vote,
        (select count(*)::int from community_mentions where post_id = ${postId} and mentioned_user_id = ${mentionedUserId}) as mention_count,
        (select count(*)::int from notifications where user_id = ${mentionedUserId} and title = ${notificationCopy.mentionTitle} and created_at >= ${startedAt}) as notification_count
    `;
    expect(socialState).toEqual({
      reaction: "insightful",
      vote: 1,
      mention_count: 1,
      notification_count: 1,
    });

    const nestedReply = await request.post(
      `/api/v1/community/posts/${postId}/comments`,
      {
        headers: { ...headers, "Idempotency-Key": `nested-${suffix}` },
        data: {
          authorId: memberId,
          parentId: replyId,
          content: "Unzulaessige dritte Ebene",
        },
      },
    );
    expect(nestedReply.status()).toBe(422);

    const memberAnnouncement = await request.post("/api/v1/community/posts", {
      headers: { ...headers, "Idempotency-Key": `member-news-${suffix}` },
      data: {
        spaceId: announcementSpaceId,
        authorId: memberId,
        title: "Nicht erlaubt",
        content: "Mitglieder duerfen keine Ankuendigung erstellen.",
      },
    });
    expect(memberAnnouncement.status()).toBe(403);

    const [feedPost] = await sql<Array<{ id: string }>>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${organizationId}, ${feedSpaceId}, ${memberId}, 'Feed Vote Guard')
      returning id
    `;
    const feedVote = await request.post(
      `/api/v1/community/posts/${feedPost.id}/votes`,
      {
        headers: { ...headers, "Idempotency-Key": `feed-vote-${suffix}` },
        data: { userId: memberId, value: 1 },
      },
    );
    expect(feedVote.status()).toBe(422);

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign forum ${suffix}`}, ${`foreign-forum-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name
      ) values (
        ${foreignOrganizationId}, ${`foreign-${suffix}@example.test`},
        'not-a-login-hash', 'Foreign', 'Author'
      )
      returning id
    `;
    const foreignAuthor = await request.post("/api/v1/community/posts", {
      headers: { ...headers, "Idempotency-Key": `foreign-${suffix}` },
      data: {
        spaceId: discussionSpaceId,
        authorId: foreignUser.id,
        title: "Tenant leak",
        content: "Darf nicht erstellt werden.",
      },
    });
    expect(foreignAuthor.status()).toBe(404);
    const foreignMention = await request.post("/api/v1/community/posts", {
      headers: { ...headers, "Idempotency-Key": `foreign-mention-${suffix}` },
      data: {
        spaceId: discussionSpaceId,
        authorId: memberId,
        title: "Tenantgebundene Mention",
        content: `Diese Mention darf nicht aufgeloest werden: @foreign-${suffix}`,
      },
    });
    expect(foreignMention.status()).toBe(201);
    const foreignMentionBody = (await foreignMention.json()) as {
      data: { id: string };
    };
    const [foreignMentionCount] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from community_mentions
      where organization_id = ${organizationId}
        and mentioned_user_id = ${foreignUser.id}
    `;
    expect(foreignMentionCount.count).toBe(0);
    await expect(
      sql`
        insert into comments (
          organization_id, post_id, author_id, parent_id, content
        ) values (
          ${organizationId}, ${foreignMentionBody.data.id}, ${memberId},
          ${rootCommentId}, 'Cross-post parent'
        )
      `,
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      sql`
        insert into post_likes (organization_id, post_id, user_id, reaction)
        values (${organizationId}, ${postId}, ${foreignUser.id}, 'like')
      `,
    ).rejects.toMatchObject({ code: "23503" });

    await page.context().clearCookies();
    await login(page, "admin");
    await page.goto("/admin/community");
    await page.getByRole("button", { name: /Teile eine Frage/ }).click();
    const adminComposer = page.getByRole("dialog", { name: "Neuer Beitrag" });
    await adminComposer.locator('select[name="spaceId"]').selectOption(announcementSpaceId);
    await adminComposer.getByPlaceholder("Titel der Ankuendigung").fill(announcementTitle);
    await adminComposer.locator('textarea[name="content"]').fill(`Wichtige Nachricht ${suffix}`);
    await adminComposer.getByRole("button", { name: "Veroeffentlichen" }).click();
    await expect(
      adminComposer.getByText(publishedPostMessage, { exact: true }),
    ).toBeVisible();
    await adminComposer
      .getByRole("button", { name: "Dialog schliessen" })
      .click();
    await expect(adminComposer).toBeHidden();
    const [announcement] = await sql<
      Array<{ id: string; locked: boolean; type: string }>
    >`
      select p.id, p.locked, s.type
      from posts p
      join community_spaces s on s.id = p.space_id
      where p.organization_id = ${organizationId}
        and p.title = ${announcementTitle}
    `;
    expect(announcement).toMatchObject({ locked: true, type: "announcement" });
  } finally {
    if (apiKeyId) {
      await sql`delete from api_audit_logs where api_key_id = ${apiKeyId}`;
      await sql`delete from api_keys where id = ${apiKeyId}`;
    }
    if (discussionSpaceId || announcementSpaceId || feedSpaceId) {
      await sql`
        delete from community_spaces
        where id = any(${[discussionSpaceId, announcementSpaceId, feedSpaceId].filter(Boolean)}::uuid[])
      `;
    }
    if (organizationId && memberId) {
      await sql`
        delete from point_transactions
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and reason in ('community.post.created', 'community.comment.created')
      `;
      await sql`update users set points = ${originalPoints} where id = ${memberId}`;
      await sql`update users set points = ${originalAdminPoints} where id = ${adminId}`;
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and created_at >= ${startedAt}
          and (type like 'community%' or type in ('post.created', 'comment.created'))
      `;
      await sql`
        delete from notifications
        where user_id = any(${[memberId, mentionedUserId].filter(Boolean)}::uuid[])
          and created_at >= ${startedAt}
          and type = 'community'
      `;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});

test("typed community composer and threads fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout audit");
  await login(page, "member");
  await page.goto("/academy/community");
  await page.getByRole("button", { name: /Teile eine Frage/ }).click();
  const dialog = page.getByRole("dialog", { name: "Neuer Beitrag" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole("button", { name: "Dialog schliessen" }).click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
