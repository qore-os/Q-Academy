import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
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
  await page.waitForURL(`${origin}/admin`);
}

test("community administration follows the owner locale on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const locale: AppLocale = testInfo.project.name === "mobile" ? "fr" : "en";
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const authorId = randomUUID();
  const slug = `community-admin-${locale}-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const ownerEmail = `community-owner-${suffix}@example.test`;
  const password = "Demo123!";
  const areaTitle = `User area ${suffix}`;
  const areaDescription = `User-authored area description ${suffix}`;
  const spaceTitle = `User space ${suffix}`;
  const spaceDescription = `User-authored space description ${suffix}`;
  const authorName = `Author Sentinel ${suffix}`;
  const postTitle = `User-authored post ${suffix}`;
  const postContent = `User-authored moderation content ${suffix}`;

  try {
    const [template] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    if (!template) throw new Error("Seeded login fixture is missing.");

    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId}, ${`Community admin ${suffix}`}, ${slug}, ${locale}
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
        (
          ${ownerId}, ${organizationId}, ${ownerEmail}, ${template.passwordHash},
          'Locale', 'Owner', 'owner', 'active', ${locale}
        ),
        (
          ${authorId}, ${organizationId}, ${`community-author-${suffix}@example.test`},
          ${template.passwordHash}, 'Author', ${`Sentinel ${suffix}`},
          'member', 'active', ${locale}
        )
    `;
    const [area] = await sql<Array<{ id: string }>>`
      insert into community_areas (
        organization_id, title, slug, description, sort_order
      ) values (
        ${organizationId}, ${areaTitle}, ${`user-area-${suffix}`},
        ${areaDescription}, 0
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
    const [post] = await sql<Array<{ id: string }>>`
      insert into posts (
        organization_id, space_id, author_id, title, content,
        moderation_state, moderation_version, published_at, created_at,
        updated_at
      ) values (
        ${organizationId}, ${space.id}, ${authorId}, ${postTitle}, ${postContent},
        'published', 1, now(), now() - interval '2 minutes',
        now() - interval '2 minutes'
      )
      returning id
    `;
    await sql`
      insert into comments (
        organization_id, post_id, author_id, content,
        moderation_state, moderation_version, created_at, updated_at
      ) values (
        ${organizationId}, ${post.id}, ${ownerId},
        ${`User-authored reply ${suffix}`}, 'published', 1,
        now() - interval '1 minute', now() - interval '1 minute'
      )
    `;

    await login(page, origin, ownerEmail, password);
    await page.goto(`${origin}/admin/community`, { waitUntil: "networkidle" });

    const copy = getCommunityAdminCopy(locale);
    const pageCopy = getMainPageDictionary(locale).admin.headers.community;
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(new RegExp(pageCopy.title));
    await expect(
      page.getByRole("heading", { name: pageCopy.title, exact: true }),
    ).toBeVisible();

    for (const heading of [
      copy.layout.heading,
      copy.profile.heading,
      copy.queue.heading,
      copy.access.heading,
      copy.governance.moderationHeading,
      copy.governance.levelHeading,
      copy.badge.heading,
      copy.boost.heading,
      copy.moderation.reportsHeading,
      copy.moderation.spacesHeading,
      copy.moderation.feedHeading,
    ]) {
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeAttached();
    }

    await expect(
      page.getByRole("heading", { name: areaTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(areaDescription, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(spaceTitle, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(spaceDescription, { exact: true }).first(),
    ).toBeVisible();
    const moderationFeed = page.getByRole("region", {
      name: copy.moderation.feedHeading,
    });
    await expect(
      moderationFeed.getByText(authorName, { exact: true }),
    ).toBeAttached();
    await expect(
      moderationFeed.getByText(postTitle, { exact: true }),
    ).toBeAttached();
    await expect(
      moderationFeed.getByText(postContent, { exact: true }),
    ).toBeAttached();

    await page
      .getByRole("button", { name: copy.layout.newSpace, exact: true })
      .first()
      .click();
    const createDialog = page.getByRole("dialog", {
      name: copy.layout.createSpaceTitle,
    });
    await expect(createDialog).toBeVisible();
    await expect(
      createDialog.getByPlaceholder(copy.layout.spaceTitlePlaceholder),
    ).toBeVisible();
    await expect(
      createDialog.getByText(copy.moderation.forumType, { exact: true }),
    ).toBeVisible();
    const dialogBox = await createDialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(
      viewport!.width + 1,
    );
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(
      viewport!.height + 1,
    );
    await page.keyboard.press("Escape");
    await expect(createDialog).toBeHidden();

    const profileRegion = page.getByRole("region", {
      name: copy.profile.heading,
    });
    const profileSave = profileRegion.getByRole("button", {
      name: copy.profile.save,
      exact: true,
    });
    await profileSave.click();
    await expect(
      profileRegion
        .getByRole("status")
        .filter({ hasText: copy.actions.profileSaved }),
    ).toBeVisible();

    const oldGermanCopy = [
      "Areas und Bereiche",
      "Oeffentliche Community-Profile",
      "Moderationsfaelle",
      "Bereichszugriff",
      "Freigabe & Automatik",
      "Manuelle Vergabe",
      "Moderationsmeldungen",
      "Neueste Beitraege moderieren",
    ];
    for (const german of oldGermanCopy) {
      await expect(page.getByText(german, { exact: true })).toHaveCount(0);
    }

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: testInfo.outputPath(
        `community-admin-${locale}-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  } finally {
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = 'replica'`;
      await transaction`delete from organizations where id = ${organizationId}`;
    });
    await sql.end();
  }
});
