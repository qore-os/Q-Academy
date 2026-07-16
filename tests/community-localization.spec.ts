import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCommunityUiCopy } from "../src/lib/i18n/community";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import type { AppLocale } from "../src/lib/i18n/model";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(
  page: Page,
  origin: string,
  email: string,
  password: string,
) {
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page
    .locator('form:has(input[name="email"]) button[type="submit"]')
    .click();
  await page.waitForURL(`${origin}/academy`);
}

test("community feed, profile and interactions use the member locale on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const locale: AppLocale = testInfo.project.name === "mobile" ? "fr" : "en";
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const memberId = randomUUID();
  const authorId = randomUUID();
  const slug = `community-locale-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const memberEmail = `community-member-${suffix}@example.test`;
  const password = "Demo123!";
  const authorName = "Atlas I18n";
  const areaTitle = `User area ${suffix}`;
  const spaceTitle = `User space ${suffix}`;
  const spaceDescription = `User-authored space description ${suffix}`;
  const authorPostTitle = `User-authored post ${suffix}`;
  const authorPostContent = `User-authored content remains unchanged ${suffix}`;
  const ownPostTitle = `Own user-authored post ${suffix}`;
  const ownCommentContent = `Own user-authored reply ${suffix}`;
  const authorCommentContent = `Author user-authored reply ${suffix}`;
  let authorPostId = "";
  let ownPostId = "";
  let ownCommentId = "";
  let authorCommentId = "";

  try {
    const [template] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    if (!template) throw new Error("Seeded login fixture is missing.");

    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId}, ${`Community locale ${suffix}`}, ${slug}, ${locale}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (
          ${memberId}, ${organizationId}, ${memberEmail}, ${template.passwordHash},
          'Locale', 'Member', 'member', 'active', ${locale}
        ),
        (
          ${authorId}, ${organizationId}, ${`community-author-${suffix}@example.test`},
          ${template.passwordHash}, 'Atlas', 'I18n', 'member', 'active', ${locale}
        )
    `;
    const [area] = await sql<Array<{ id: string }>>`
      insert into community_areas (
        organization_id, title, slug, sort_order
      ) values (
        ${organizationId}, ${areaTitle}, ${`user-area-${suffix}`}, 0
      )
      returning id
    `;
    const [space] = await sql<Array<{ id: string }>>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        access_mode, sort_order
      ) values (
        ${organizationId}, ${area.id}, ${spaceTitle}, ${`user-space-${suffix}`},
        ${spaceDescription}, '#2b9188', 'discussion', 'open', 0
      )
      returning id
    `;
    const posts = await sql<Array<{ id: string; authorId: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content, created_at,
        updated_at
      ) values
        (
          ${organizationId}, ${space.id}, ${authorId}, ${authorPostTitle},
          ${authorPostContent}, now() - interval '2 minutes',
          now() - interval '2 minutes'
        ),
        (
          ${organizationId}, ${space.id}, ${memberId}, ${ownPostTitle},
          ${`Own user-authored content ${suffix}`}, now() - interval '1 minute',
          now() - interval '1 minute'
        )
      returning id, author_id as "authorId"
    `;
    authorPostId = posts.find((post) => post.authorId === authorId)!.id;
    ownPostId = posts.find((post) => post.authorId === memberId)!.id;
    const comments = await sql<Array<{ id: string; authorId: string }>>`
      insert into comments (
        organization_id, post_id, author_id, content, created_at, updated_at
      ) values
        (
          ${organizationId}, ${authorPostId}, ${memberId}, ${ownCommentContent},
          now() - interval '50 seconds', now() - interval '50 seconds'
        ),
        (
          ${organizationId}, ${authorPostId}, ${authorId}, ${authorCommentContent},
          now() - interval '40 seconds', now() - interval '40 seconds'
        )
      returning id, author_id as "authorId"
    `;
    ownCommentId = comments.find((comment) => comment.authorId === memberId)!.id;
    authorCommentId = comments.find((comment) => comment.authorId === authorId)!.id;

    await login(page, origin, memberEmail, password);
    await page.goto(`${origin}/academy/community`, {
      waitUntil: "domcontentloaded",
    });

    const dictionary = getMainPageDictionary(locale);
    const ui = getCommunityUiCopy(locale);
    const pageCopy = dictionary.academy.community;
    const profileCopy = dictionary.academy.communityProfile;

    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: pageCopy.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: ui.personalized.modes.latest,
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: ui.personalized.modes.latest,
        exact: true,
      })
      .click();

    const authorArticle = page.locator(`#post-${authorPostId}`);
    const ownArticle = page.locator(`#post-${ownPostId}`);
    await expect(authorArticle).toBeVisible();
    await expect(ownArticle).toBeVisible();
    await expect(authorArticle.getByText(authorPostTitle, { exact: true })).toBeVisible();
    await expect(
      authorArticle.getByText(authorPostContent, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(areaTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(spaceTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(spaceDescription, { exact: true })).toBeVisible();

    const authorFollow = authorArticle.getByRole("button", {
      name: ui.follow.author(authorName),
    });
    await expect(authorFollow).toBeEnabled();
    await authorFollow.click();
    await expect(
      authorArticle.getByRole("button", {
        name: ui.follow.unfollowAuthor(authorName),
      }),
    ).toBeEnabled();

    const reactions = authorArticle.getByLabel(ui.reactions.groupLabel, {
      exact: true,
    });
    const like = reactions.getByRole("button", {
      name: ui.reactions.options.like,
    });
    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");

    await authorArticle.getByRole("button", { name: ui.report.post }).click();
    const postReport = page.getByRole("dialog", {
      name: ui.report.title(ui.common.post),
    });
    await expect(postReport.getByText(ui.report.moderation)).toBeVisible();
    await expect(postReport.locator('option[value="spam"]')).toHaveText(
      ui.report.reasons.spam,
    );
    await postReport.getByRole("combobox").selectOption("spam");
    await postReport
      .getByRole("button", { name: ui.report.submit, exact: true })
      .click();
    await expect(postReport).toBeHidden();
    await expect(page.getByText(ui.actions.reportSent, { exact: true })).toBeVisible();

    await ownArticle
      .getByRole("button", { name: ui.ownContent.editOwnPost })
      .click();
    const editDialog = page.getByRole("dialog", {
      name: ui.ownContent.editTitle(ui.common.post),
    });
    await expect(
      editDialog.getByRole("button", { name: ui.ownContent.saveChanges }),
    ).toBeVisible();
    await editDialog
      .getByRole("button", { name: ui.ownContent.saveChanges, exact: true })
      .click();
    await expect(editDialog).toBeHidden();
    await expect(page.getByText(ui.actions.postSaved, { exact: true })).toBeVisible();

    await ownArticle
      .getByRole("button", { name: ui.ownContent.deleteOwnPost })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: ui.ownContent.deleteTitle(ui.common.post),
    });
    await expect(deleteDialog.getByText(ui.ownContent.deletePostWarning)).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: ui.ownContent.deleteAction, exact: true })
      .click();
    await expect(deleteDialog).toBeHidden();
    await expect(page.getByText(ui.actions.postDeleted, { exact: true })).toBeVisible();

    const ownComment = page.locator(`#comment-${ownCommentId}`);
    const authorComment = page.locator(`#comment-${authorCommentId}`);
    await expect(ownComment.getByText(ownCommentContent, { exact: true })).toBeVisible();
    await expect(
      ownComment.getByRole("button", { name: ui.comments.editOwn }),
    ).toBeVisible();
    await expect(
      authorComment.getByRole("button", { name: ui.comments.report }),
    ).toBeVisible();

    await page.getByTestId("community-composer-trigger").click();
    const composer = page.getByRole("dialog", { name: pageCopy.newPost });
    await expect(
      composer.getByText(ui.attachments.title).first(),
    ).toBeVisible();
    await expect(
      composer.getByRole("button", { name: ui.attachments.chooseFile }),
    ).toBeVisible();
    await expect(composer.getByLabel(ui.editor.contentFormat)).toBeVisible();
    await composer
      .getByRole("button", { name: pageCopy.closeDialog })
      .click();

    await expect(page.getByText(ui.submissions.empty, { exact: true })).toBeVisible();
    await expect(page.getByText(ui.spaces.title, { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    if (locale === "en") {
      await expect(page.getByText("Latest", { exact: true })).toBeVisible();
      await expect(page.getByText("Neueste", { exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("Récentes", { exact: true })).toBeVisible();
      await expect(page.getByText("Neueste", { exact: true })).toHaveCount(0);
    }

    await page.screenshot({
      path: testInfo.outputPath(`community-${locale}-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page.goto(`${origin}/academy/community/members/${authorId}`);
    await expect(page.getByRole("heading", { name: authorName })).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: profileCopy.back, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(profileCopy.eyebrow, { exact: true })).toBeVisible();
  } finally {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = 'replica'`;
      await transaction`
        delete from community_moderation_events
        where organization_id = ${organizationId}
      `;
    });
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
