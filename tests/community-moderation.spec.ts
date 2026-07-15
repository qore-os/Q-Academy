import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("members edit and delete only their own community content", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "ownership lifecycle runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const ownText = `Eigener E2E Beitrag ${suffix}`;
  const foreignText = `Fremder E2E Beitrag ${suffix}`;
  const ownCommentText = `Eigene E2E Antwort ${suffix}`;
  const foreignCommentText = `Fremde E2E Antwort ${suffix}`;
  let spaceId = "";
  let ownPostId = "";
  let foreignPostId = "";
  let ownCommentId = "";
  let foreignCommentId = "";

  try {
    const [lea] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id from users where email = 'lea@q-academy.de' limit 1
    `;
    const [jonas] = await client<{ id: string }[]>`
      select id from users
      where organization_id = ${lea.organization_id} and email = 'jonas@q-academy.de'
      limit 1
    `;
    expect(lea).toBeTruthy();
    expect(jonas).toBeTruthy();

    const area = await ensureCommunityAreaFixture(client, lea.organization_id);
    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, sort_order
      ) values (
        ${lea.organization_id}, ${area.id}, ${`Ownership ${suffix}`},
        ${`ownership-${suffix}`}, 'Isolierter Ownership-Test', '#4f7cac',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [ownPost] = await client<{ id: string }[]>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${lea.organization_id}, ${spaceId}, ${lea.id}, ${ownText})
      returning id
    `;
    ownPostId = ownPost.id;
    const [foreignPost] = await client<{ id: string }[]>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${lea.organization_id}, ${spaceId}, ${jonas.id}, ${foreignText})
      returning id
    `;
    foreignPostId = foreignPost.id;
    const [ownComment] = await client<{ id: string }[]>`
      insert into comments (organization_id, post_id, author_id, content)
      values (${lea.organization_id}, ${ownPostId}, ${lea.id}, ${ownCommentText})
      returning id
    `;
    ownCommentId = ownComment.id;
    const [foreignComment] = await client<{ id: string }[]>`
      insert into comments (organization_id, post_id, author_id, content)
      values (${lea.organization_id}, ${foreignPostId}, ${jonas.id}, ${foreignCommentText})
      returning id
    `;
    foreignCommentId = foreignComment.id;

    await loginAsMember(page);
    await page.goto("/academy/community");

    const ownArticle = page.locator(`#post-${ownPostId}`);
    const foreignArticle = page.locator(`#post-${foreignPostId}`);
    await expect(ownArticle.getByText(ownText, { exact: true })).toBeVisible();
    await expect(
      foreignArticle.getByText(foreignText, { exact: true }),
    ).toBeVisible();
    await expect(
      ownArticle.getByRole("button", { name: "Eigenen Beitrag bearbeiten" }),
    ).toHaveCount(1);
    await expect(
      ownArticle.getByRole("button", { name: "Eigenen Beitrag loeschen" }),
    ).toHaveCount(1);
    await expect(
      foreignArticle.getByRole("button", {
        name: "Eigenen Beitrag bearbeiten",
      }),
    ).toHaveCount(0);
    await expect(
      foreignArticle.getByRole("button", { name: "Eigenen Beitrag loeschen" }),
    ).toHaveCount(0);
    await expect(
      foreignArticle.getByRole("button", { name: "Eigene Antwort bearbeiten" }),
    ).toHaveCount(0);
    await expect(
      foreignArticle.getByRole("button", { name: "Eigene Antwort loeschen" }),
    ).toHaveCount(0);

    await ownArticle
      .getByRole("button", { name: "Eigenen Beitrag bearbeiten" })
      .click();
    let dialog = page.getByRole("dialog", { name: "Beitrag bearbeiten" });
    const updatedPostText = `Bearbeiteter eigener Beitrag ${suffix}`;
    await dialog
      .getByRole("textbox", { name: "Inhalt", exact: true })
      .fill(updatedPostText);
    await dialog.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .locator(`#post-${ownPostId}`)
        .getByText(updatedPostText, { exact: true }),
    ).toBeVisible();

    await page
      .locator(`#post-${ownPostId}`)
      .getByRole("button", { name: "Eigene Antwort bearbeiten" })
      .click();
    dialog = page.getByRole("dialog", { name: "Antwort bearbeiten" });
    const updatedCommentText = `Bearbeitete eigene Antwort ${suffix}`;
    await dialog
      .getByRole("textbox", { name: "Inhalt", exact: true })
      .fill(updatedCommentText);
    await dialog.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .locator(`#post-${ownPostId}`)
        .getByText(updatedCommentText, { exact: true }),
    ).toBeVisible();

    await page
      .locator(`#post-${ownPostId}`)
      .getByRole("button", { name: "Eigene Antwort loeschen" })
      .click();
    dialog = page.getByRole("dialog", { name: "Antwort loeschen" });
    await dialog.getByRole("button", { name: "Loeschen", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(updatedCommentText, { exact: true }),
    ).toHaveCount(0);

    await page
      .locator(`#post-${ownPostId}`)
      .getByRole("button", { name: "Eigenen Beitrag loeschen" })
      .click();
    dialog = page.getByRole("dialog", { name: "Beitrag loeschen" });
    await dialog.getByRole("button", { name: "Loeschen", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`#post-${ownPostId}`)).toHaveCount(0);
    await expect(page.locator(`#post-${foreignPostId}`)).toBeVisible();

    const [ownPostCount] = await client<{ count: number }[]>`
      select count(*)::int as count from posts where id = ${ownPostId}
    `;
    const [ownCommentCount] = await client<{ count: number }[]>`
      select count(*)::int as count from comments where id = ${ownCommentId}
    `;
    const [foreignPostCount] = await client<{ count: number }[]>`
      select count(*)::int as count from posts where id = ${foreignPostId}
    `;
    const [foreignCommentCount] = await client<{ count: number }[]>`
      select count(*)::int as count from comments where id = ${foreignCommentId}
    `;
    expect(ownPostCount.count).toBe(0);
    expect(ownCommentCount.count).toBe(0);
    expect(foreignPostCount.count).toBe(1);
    expect(foreignCommentCount.count).toBe(1);
  } finally {
    if (spaceId)
      await client`delete from community_spaces where id = ${spaceId}`;
    const entityIds = [
      spaceId,
      ownPostId,
      foreignPostId,
      ownCommentId,
      foreignCommentId,
    ].filter(Boolean);
    if (entityIds.length)
      await client`delete from activity_events where entity_id = any(${entityIds}::uuid[])`;
    await client.end();
  }
});

test("admin edits spaces, pins posts and moderates content with cascade confirmation", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "moderation lifecycle runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const title = `Moderation ${suffix}`;
  const editedTitle = `Moderiert ${suffix}`;
  let organizationId = "";
  let authorId = "";
  let secondAuthorId = "";
  let spaceId = "";
  let moderatedPostId = "";
  let cascadedPostId = "";
  let moderatedCommentId = "";
  let cascadedCommentId = "";
  const moderationCaseIds: string[] = [];

  try {
    const [owner] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id from users where email = 'admin@q-academy.de' limit 1
    `;
    const members = await client<{ id: string }[]>`
      select id from users where organization_id = ${owner.organization_id} and role = 'member' order by created_at limit 2
    `;
    organizationId = owner.organization_id;
    authorId = members[0].id;
    secondAuthorId = members[1].id;

    const area = await ensureCommunityAreaFixture(client, organizationId);
    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${title}, ${`moderation-${suffix}`},
        'Bereich vor der E2E-Bearbeitung', '#2bb7a9',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [moderatedPost] = await client<{ id: string }[]>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${organizationId}, ${spaceId}, ${authorId}, ${`Zu moderierender Beitrag ${suffix}`})
      returning id
    `;
    moderatedPostId = moderatedPost.id;
    const [cascadedPost] = await client<{ id: string }[]>`
      insert into posts (organization_id, space_id, author_id, content)
      values (${organizationId}, ${spaceId}, ${secondAuthorId}, ${`Kaskaden-Beitrag ${suffix}`})
      returning id
    `;
    cascadedPostId = cascadedPost.id;
    const [moderatedComment] = await client<{ id: string }[]>`
      insert into comments (organization_id, post_id, author_id, content)
      values (${organizationId}, ${moderatedPostId}, ${secondAuthorId}, ${`Zu moderierende Antwort ${suffix}`})
      returning id
    `;
    moderatedCommentId = moderatedComment.id;
    const [cascadedComment] = await client<{ id: string }[]>`
      insert into comments (organization_id, post_id, author_id, content)
      values (${organizationId}, ${cascadedPostId}, ${authorId}, ${`Kaskaden-Antwort ${suffix}`})
      returning id
    `;
    cascadedCommentId = cascadedComment.id;

    await loginAsOwner(page);
    await page.goto("/admin/community");

    let spaceRow = page.locator(`#space-${spaceId}`);
    await expect(
      spaceRow.getByText(adminCopy.moderation.postsCount("2"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      spaceRow.getByText(adminCopy.moderation.repliesCount("2"), {
        exact: true,
      }),
    ).toBeVisible();
    await spaceRow
      .getByRole("button", { name: adminCopy.layout.editSpace(title) })
      .click();
    let dialog = page.getByRole("dialog", {
      name: adminCopy.moderation.editSpaceTitle,
    });
    await dialog.getByLabel(adminCopy.common.title).fill(editedTitle);
    await dialog
      .getByLabel(adminCopy.common.description)
      .fill("Bearbeitet und fuer Moderation vorbereitet.");
    await dialog
      .getByRole("button", { name: adminCopy.moderation.saveChanges })
      .click();
    await expect(dialog).toBeHidden();
    spaceRow = page.locator(`#space-${spaceId}`);
    await expect(
      spaceRow.getByText(editedTitle, { exact: true }),
    ).toBeVisible();

    let post = page.locator(`#post-${moderatedPostId}`);
    await post.getByRole("button", { name: adminCopy.moderation.pin }).click();
    await expect(
      post.getByRole("button", { name: adminCopy.moderation.unpin }),
    ).toBeVisible();
    const [pinned] = await client<
      { pinned: boolean }[]
    >`select pinned from posts where id = ${moderatedPostId}`;
    expect(pinned.pinned).toBe(true);

    await post.locator("summary").click();
    await post
      .getByRole("button", {
        name: new RegExp(adminCopy.moderation.rejectReplyBy(".*")),
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: adminCopy.moderation.rejectTitle(adminCopy.common.reply),
    });
    await dialog
      .getByRole("button", { name: adminCopy.queue.reject, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    const [storedComment] = await client<
      {
        count: number;
        moderation_state: string;
      }[]
    >`
      select count(*)::int as count,
             max(moderation_state::text) as moderation_state
      from comments where id = ${moderatedCommentId}
    `;
    expect(storedComment).toMatchObject({
      count: 1,
      moderation_state: "rejected",
    });
    const [commentCase] = await client<{ id: string; status: string }[]>`
      select id, status from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'comment'
        and target_id = ${moderatedCommentId}
      order by created_at desc limit 1
    `;
    expect(commentCase.status).toBe("resolved");
    moderationCaseIds.push(commentCase.id);

    post = page.locator(`#post-${moderatedPostId}`);
    await post
      .getByRole("button", { name: adminCopy.moderation.rejectPost })
      .click();
    dialog = page.getByRole("dialog", {
      name: adminCopy.moderation.rejectTitle(adminCopy.common.post),
    });
    await dialog
      .getByRole("button", { name: adminCopy.queue.reject, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`#post-${moderatedPostId}`)).toHaveCount(0);
    const [storedPost] = await client<
      {
        count: number;
        moderation_state: string;
      }[]
    >`
      select count(*)::int as count,
             max(moderation_state::text) as moderation_state
      from posts where id = ${moderatedPostId}
    `;
    expect(storedPost).toMatchObject({
      count: 1,
      moderation_state: "rejected",
    });
    const [postCase] = await client<{ id: string; status: string }[]>`
      select id, status from community_moderation_cases
      where organization_id = ${organizationId}
        and target_type = 'post'
        and target_id = ${moderatedPostId}
      order by created_at desc limit 1
    `;
    expect(postCase.status).toBe("resolved");
    moderationCaseIds.push(postCase.id);

    spaceRow = page.locator(`#space-${spaceId}`);
    await expect(
      spaceRow.getByText(adminCopy.moderation.postsCount("1"), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      spaceRow.getByText(adminCopy.moderation.repliesCount("1"), {
        exact: true,
      }),
    ).toBeVisible();
    await spaceRow
      .getByRole("button", { name: adminCopy.layout.deleteSpace(editedTitle) })
      .click();
    dialog = page.getByRole("dialog", {
      name: adminCopy.moderation.deleteSpaceTitle,
    });
    await expect(
      dialog.getByText(adminCopy.moderation.deleteSpaceDetail("1", "1")),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: adminCopy.common.deletePermanent }),
    ).toBeDisabled();
    await dialog
      .getByLabel(adminCopy.moderation.confirmSpaceAria)
      .fill(editedTitle);
    await dialog
      .getByRole("button", { name: adminCopy.common.deletePermanent })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`#space-${spaceId}`)).toHaveCount(0);

    const [spaceCount] = await client<
      { count: number }[]
    >`select count(*)::int as count from community_spaces where id = ${spaceId}`;
    const [cascadePostCount] = await client<
      { count: number }[]
    >`select count(*)::int as count from posts where id = ${cascadedPostId}`;
    const [cascadeCommentCount] = await client<
      { count: number }[]
    >`select count(*)::int as count from comments where id = ${cascadedCommentId}`;
    expect(spaceCount.count).toBe(0);
    expect(cascadePostCount.count).toBe(0);
    expect(cascadeCommentCount.count).toBe(0);

    const events = await client<{ type: string }[]>`
      select type from activity_events
      where organization_id = ${organizationId}
        and entity_id = any(${[spaceId, moderatedPostId, moderatedCommentId]}::uuid[])
        and created_at >= ${startedAt}
    `;
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "community_space.updated",
        "community_post.pinned",
        "community_space.deleted",
      ]),
    );
    const moderationEvents = await client<{ action: string }[]>`
      select action from community_moderation_events
      where case_id = any(${moderationCaseIds}::uuid[])
    `;
    expect(moderationEvents.map((event) => event.action)).toEqual(
      expect.arrayContaining(["flagged", "rejected"]),
    );
  } finally {
    if (spaceId)
      await client`delete from community_spaces where id = ${spaceId}`;
    if (moderationCaseIds.length) {
      await client.begin(async (sqlClient) => {
        await sqlClient`set local session_replication_role = 'replica'`;
        await sqlClient`
          delete from community_moderation_events
          where case_id = any(${moderationCaseIds}::uuid[])
        `;
      });
      await client`
        delete from community_moderation_assessments
        where case_id = any(${moderationCaseIds}::uuid[])
      `;
      await client`
        delete from community_moderation_appeals
        where case_id = any(${moderationCaseIds}::uuid[])
      `;
      await client`
        delete from community_reports
        where case_id = any(${moderationCaseIds}::uuid[])
      `;
      await client`
        delete from community_moderation_cases
        where id = any(${moderationCaseIds}::uuid[])
      `;
    }
    const entityIds = [
      spaceId,
      moderatedPostId,
      cascadedPostId,
      moderatedCommentId,
      cascadedCommentId,
    ].filter(Boolean);
    if (entityIds.length)
      await client`delete from activity_events where entity_id = any(${entityIds}::uuid[])`;
    if (authorId || secondAuthorId) {
      await client`
        delete from notifications
        where user_id = any(${[authorId, secondAuthorId].filter(Boolean)}::uuid[])
          and title in ('Community-Beitrag moderiert', 'Community-Antwort moderiert', 'Community-Inhalt moderiert')
          and created_at >= ${startedAt}
      `;
    }
    await client.end();
  }
});

test("community moderation dialogs fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only overflow check");
  await loginAsOwner(page);
  await page.goto("/admin/community");
  await expect(
    page.getByRole("heading", { name: "Community", level: 1 }),
  ).toBeVisible();

  const spaceManagement = page.getByRole("region", {
    name: adminCopy.moderation.spacesHeading,
    exact: true,
  });
  await expect(spaceManagement).toBeVisible();
  const editButton = spaceManagement.getByRole("button", {
    name: adminCopy.layout.editSpace("Austausch"),
    exact: true,
  });
  await expect(editButton).toBeVisible();
  await editButton.click();
  const dialog = page.getByRole("dialog", {
    name: adminCopy.moderation.editSpaceTitle,
  });
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

  await page.context().clearCookies();
  await loginAsMember(page);
  await page.goto("/academy/community");
  await expect(
    page.getByRole("heading", { name: "Q-Community" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
