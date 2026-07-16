import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { ensureCommunityAreaFixture } from "./helpers/community-area";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name:
        role === "admin"
          ? /Admin-Demo|Als Admin testen/
          : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

test("personalized feed modes paginate top-level comments and replies independently", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "data lifecycle runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  let spaceId = "";

  try {
    const [fixture] = await sql<
      Array<{ organization_id: string; author_id: string }>
    >`
      select member.organization_id, author.id as author_id
      from users member
      join users author
        on author.organization_id = member.organization_id
       and author.email = 'jonas@q-academy.de'
      where member.email = 'lea@q-academy.de'
      limit 1
    `;
    const area = await ensureCommunityAreaFixture(sql, fixture.organization_id);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        sort_order
      ) values (
        ${fixture.organization_id}, ${area.id},
        ${`Feed-Pagination ${suffix}`}, ${`feed-pagination-${suffix}`},
        'Isolierter Bereich fuer Feed-Pagination.', '#2b9188', 'discussion',
        ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [post] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content
      ) values (
        ${fixture.organization_id}, ${spaceId}, ${fixture.author_id},
        ${`Pagination ${suffix}`}, ${`Feed-Pagination fuer ${suffix}`}
      )
      returning id
    `;
    await sql`
      insert into comments (
        organization_id, post_id, author_id, content, created_at, updated_at
      )
      select
        ${fixture.organization_id}, ${post.id}, ${fixture.author_id},
        ${`Aelterer Kommentar `} || series::text || ${` ${suffix}`},
        now() - ((series + 2)::text || ' minutes')::interval,
        now() - ((series + 2)::text || ' minutes')::interval
      from generate_series(1, 24) as series
    `;
    const [rootComment] = await sql<Array<{ id: string }>>`
      insert into comments (
        organization_id, post_id, author_id, content, created_at, updated_at
      ) values (
        ${fixture.organization_id}, ${post.id}, ${fixture.author_id},
        ${`Antwort-Thread ${suffix}`}, now() - interval '1 minute',
        now() - interval '1 minute'
      )
      returning id
    `;
    await sql`
      insert into comments (
        organization_id, post_id, author_id, parent_id, content,
        created_at, updated_at
      )
      select
        ${fixture.organization_id}, ${post.id}, ${fixture.author_id},
        ${rootComment.id},
        ${`Thread-Antwort `} || series::text || ${` ${suffix}`},
        now() - interval '55 seconds' + (series::text || ' seconds')::interval,
        now() - interval '55 seconds' + (series::text || ' seconds')::interval
      from generate_series(1, 25) as series
    `;

    await login(page, "member");
    await page.goto("/academy/community");
    await expect(page.getByRole("button", { name: "Fuer dich" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Folge ich" })).toBeVisible();
    await page.getByRole("button", { name: "Neueste", exact: true }).click();

    const article = page.locator(`#post-${post.id}`);
    await expect(article).toBeVisible();
    await expect(
      article.getByText(`Antwort-Thread ${suffix}`, { exact: true }),
    ).toBeVisible();
    await expect(
      article.getByText(`Thread-Antwort 3 ${suffix}`, { exact: true }),
    ).toHaveCount(0);

    const rootThread = article
      .locator(`#comment-${rootComment.id}`)
      .locator("..");
    await rootThread
      .getByRole("button", { name: "Weitere Antworten laden" })
      .click();
    await expect(
      rootThread.getByText(`Thread-Antwort 20 ${suffix}`, { exact: true }),
    ).toBeVisible();
    await rootThread
      .getByRole("button", { name: "Weitere Antworten laden" })
      .click();
    await expect(
      rootThread.getByText(`Thread-Antwort 25 ${suffix}`, { exact: true }),
    ).toBeVisible();
    await expect(
      rootThread.getByRole("button", { name: "Weitere Antworten laden" }),
    ).toHaveCount(0);

    await article
      .getByRole("button", { name: "Weitere Kommentare laden" })
      .click();
    await expect(
      article.getByText(`Aelterer Kommentar 19 ${suffix}`, { exact: true }),
    ).toBeVisible();
    await article
      .getByRole("button", { name: "Weitere Kommentare laden" })
      .click();
    await expect(
      article.getByText(`Aelterer Kommentar 24 ${suffix}`, { exact: true }),
    ).toBeVisible();
  } finally {
    if (spaceId) {
      await sql`delete from community_spaces where id = ${spaceId}`;
    }
    await sql.end();
  }
});

test("community feed and admin controls stay usable without horizontal overflow", async ({
  page,
}, testInfo) => {
  await login(page, testInfo.project.name === "mobile" ? "member" : "admin");
  await page.goto(
    testInfo.project.name === "mobile"
      ? "/academy/community"
      : "/admin/community",
  );

  if (testInfo.project.name === "mobile") {
    await expect(
      page.getByRole("heading", { name: "Q-Community" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Neueste" })).toBeVisible();
  } else {
    await expect(
      page.getByRole("heading", { name: adminCopy.boost.heading }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: adminCopy.moderation.feedHeading }),
    ).toBeVisible();
  }
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("member follows drive Following mode and admin boosts stay explainable", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "isolated workflow runs once",
  );
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const authorFirstName = "Feed";
  const authorLastName = `Autor ${suffix}`;
  const authorName = `${authorFirstName} ${authorLastName}`;
  const spaceTitle = `Follow-Bereich ${suffix}`;
  const postTitle = `Follow und Boost ${suffix}`;
  const initialReason = `Interne Startbegruendung ${suffix}`;
  const updatedReason = `Interne geaenderte Begruendung ${suffix}`;
  let organizationId = "";
  let memberId = "";
  let authorId = "";
  let spaceId = "";

  try {
    const [member] = await sql<Array<{ id: string; organization_id: string }>>`
      select id, organization_id
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    memberId = member.id;
    organizationId = member.organization_id;
    const [author] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status, job_title
      ) values (
        ${organizationId}, ${`feed-author-${suffix}@example.test`},
        'not-a-login-hash', ${authorFirstName}, ${authorLastName},
        'member', 'active', 'Community-Autor'
      )
      returning id
    `;
    authorId = author.id;
    const area = await ensureCommunityAreaFixture(sql, organizationId);
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${spaceTitle}, ${`follow-${suffix}`},
        'Isolierter Bereich fuer Follow- und Boost-Tests.',
        '#4f7cac', 'discussion', 'open', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;
    const [post] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content
      ) values (
        ${organizationId}, ${spaceId}, ${authorId}, ${postTitle},
        ${`Isolierter Community-Beitrag ${suffix}`}
      )
      returning id
    `;

    await login(page, "member");
    await page.goto("/academy/community");
    await page.getByRole("button", { name: "Neueste", exact: true }).click();
    const article = page.locator(`#post-${post.id}`);
    await expect(article).toBeVisible();

    const authorFollow = article.getByRole("button", {
      name: `${authorName} folgen`,
    });
    await expect(authorFollow).toBeEnabled();
    await authorFollow.click();
    await expect(
      article.getByRole("button", {
        name: `${authorName} nicht mehr folgen`,
      }),
    ).toBeEnabled();

    const spaceFollow = page.getByRole("button", {
      name: `${spaceTitle} folgen`,
    });
    await expect(spaceFollow).toBeEnabled();
    await spaceFollow.click();
    await expect(
      page.getByRole("button", {
        name: `${spaceTitle} nicht mehr folgen`,
      }),
    ).toBeEnabled();

    await page.getByRole("button", { name: "Folge ich", exact: true }).click();
    await expect(article).toBeVisible();
    await expect(
      article.getByText("Du folgst dieser Person", { exact: true }),
    ).toBeVisible();
    await expect(
      article.getByText("Du folgst diesem Bereich", { exact: true }),
    ).toBeVisible();

    await article
      .getByRole("button", { name: `${authorName} nicht mehr folgen` })
      .click();
    await expect(article).toBeVisible();
    await expect(
      article.getByText("Du folgst diesem Bereich", { exact: true }),
    ).toBeVisible();
    const spaceUnfollow = page.getByRole("button", {
      name: `${spaceTitle} nicht mehr folgen`,
    });
    await expect(spaceUnfollow).toBeEnabled();
    await spaceUnfollow.click();
    await expect(article).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, "admin");
    await page.goto("/admin/community");
    const manager = page.locator(
      'section[aria-labelledby="community-boost-heading"]',
    );
    await expect(manager).toBeVisible();
    const boostEndpoint = `/api/admin/community/boosts/${encodeURIComponent(authorId)}`;
    const saveBoostAndWait = async () => {
      const [response] = await Promise.all([
        page.waitForResponse(
          (candidate) =>
            candidate.request().method() === "PUT" &&
            new URL(candidate.url()).pathname === boostEndpoint,
          { timeout: 60_000 },
        ),
        manager
          .getByRole("button", { name: adminCopy.common.save, exact: true })
          .click(),
      ]);
      expect(
        response.ok(),
        `Reach-Boost save failed with HTTP ${response.status()}.`,
      ).toBe(true);
    };
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    await manager
      .getByLabel(adminCopy.boost.person)
      .selectOption({ label: authorName });
    await manager.getByLabel(adminCopy.boost.strength).selectOption("medium");
    await manager
      .getByLabel(adminCopy.boost.startsAt)
      .fill(localDateTime(startsAt));
    await manager
      .getByLabel(adminCopy.boost.endsAt)
      .fill(localDateTime(endsAt));
    await manager
      .getByLabel(adminCopy.boost.internalReason)
      .fill(initialReason);
    await saveBoostAndWait();

    const editBoost = manager.getByRole("button", {
      name: adminCopy.boost.editNamed(authorName),
    });
    await expect(editBoost).toBeVisible();
    const boostRow = editBoost.locator("../..");
    await expect(
      boostRow.getByText(adminCopy.boost.strengths.medium, { exact: true }),
    ).toBeVisible();
    await expect(
      boostRow.getByText(initialReason, { exact: true }),
    ).toBeVisible();

    await editBoost.click();
    await manager.getByLabel(adminCopy.boost.strength).selectOption("high");
    await manager
      .getByLabel(adminCopy.boost.internalReason)
      .fill(updatedReason);
    await saveBoostAndWait();
    await expect(
      boostRow.getByText(adminCopy.boost.strengths.high, { exact: true }),
    ).toBeVisible();
    await expect(
      boostRow.getByText(updatedReason, { exact: true }),
    ).toBeVisible();

    await page.context().clearCookies();
    await login(page, "member");
    await page.goto("/academy/community");
    const recommendedArticle = page.locator(`#post-${post.id}`);
    await expect(recommendedArticle).toBeVisible();
    await expect(
      recommendedArticle.getByText("Empfohlen vom Academy-Team", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      recommendedArticle.getByText("Stark", { exact: true }),
    ).toHaveCount(0);
    await expect(
      recommendedArticle.getByText(updatedReason, { exact: true }),
    ).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, "admin");
    await page.goto("/admin/community");
    const removeBoost = page.getByRole("button", {
      name: adminCopy.boost.removeNamed(authorName),
    });
    await expect(removeBoost).toBeVisible();
    await removeBoost.click();
    const removeDialog = page.getByRole("dialog", {
      name: adminCopy.boost.removeAria,
    });
    await expect(removeDialog).toBeVisible();
    await removeDialog
      .getByRole("button", { name: adminCopy.common.remove, exact: true })
      .click();
    await expect(removeDialog).toBeHidden();
    await expect(removeBoost).toHaveCount(0);
  } finally {
    if (organizationId && (authorId || spaceId)) {
      await sql`
        delete from community_follows
        where organization_id = ${organizationId}
          and follower_id = ${memberId}
          and (
            target_author_id = ${authorId || null}
            or target_space_id = ${spaceId || null}
          )
      `;
    }
    if (organizationId && authorId) {
      await sql`
        delete from community_author_boosts
        where organization_id = ${organizationId}
          and author_id = ${authorId}
      `;
    }
    if (spaceId) await sql`delete from community_spaces where id = ${spaceId}`;
    if (authorId) await sql`delete from users where id = ${authorId}`;
    await sql.end();
  }
});
