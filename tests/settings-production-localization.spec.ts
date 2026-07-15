import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getSettingsAdminCopy } from "../src/lib/i18n/settings-admin";
import type { AppLocale } from "../src/lib/i18n/model";
import { MEMBER_SIDEBAR_LINK_ICONS } from "../src/lib/member-sidebar-link-model";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function login(
  page: Page,
  origin: string,
  email: string,
  password: string,
  destination: "/admin" | "/academy",
) {
  await page.goto(`${origin}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('form:has(input[name="email"]) button[type="submit"]').click();
  await page.waitForURL((url) => url.origin === origin && url.pathname === destination);
}

test("settings and member welcome are localized, responsive, and dirty-aware", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const locale: AppLocale = testInfo.project.name === "mobile" ? "fr" : "en";
  const copy = getSettingsAdminCopy(locale);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const slug = `settings-locale-${locale}-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const ownerEmail = `settings-owner-${suffix}@example.test`;
  const memberEmail = `settings-member-${suffix}@example.test`;
  const password = "Demo123!";
  const authoredLink = `Authored resource ${suffix}`;
  const authoredDescription = `Authored navigation copy ${suffix}`;
  const authoredWelcomeTitle = `Authored welcome ${suffix}`;
  const authoredWelcomeText = `Authored member text ${suffix}`;
  const changedPlatformName = `Authored Academy ${suffix}`;

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
      values (${organizationId}, ${`Settings Locale ${suffix}`}, ${slug}, ${locale})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values
      (
        ${ownerId}, ${organizationId}, ${ownerEmail}, ${template.passwordHash},
        'Settings', 'Owner', 'owner', 'active', ${locale}
      ),
      (
        ${memberId}, ${organizationId}, ${memberEmail}, ${template.passwordHash},
        'Settings', 'Member', 'member', 'active', ${locale}
      )
    `;
    await sql`
      insert into member_sidebar_links (
        organization_id, label, description, href, icon, sort_order, active
      ) values (
        ${organizationId}, ${authoredLink}, ${authoredDescription},
        '/academy', 'book-open', 0, true
      )
    `;
    await sql`
      insert into member_welcome_settings (
        organization_id, enabled, title, welcome_text,
        prompt_profile_image, prompt_profile_completion, version
      ) values (
        ${organizationId}, true, ${authoredWelcomeTitle}, ${authoredWelcomeText},
        true, true, 1
      )
    `;

    await login(page, origin, ownerEmail, password, "/admin");
    await page.goto(`${origin}/admin/settings`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(new RegExp(copy.page.metadataTitle, "i"));

    const nativeForm = page.locator("form#app-start");
    await expect(nativeForm.getByRole("heading", { name: copy.nativeStart.title })).toBeVisible();
    const nativeSave = nativeForm.getByRole("button", { name: copy.nativeStart.save });
    await expect(nativeSave).toBeDisabled();
    await nativeForm.getByRole("radio", { name: copy.nativeStart.community }).check();
    await expect(nativeSave).toBeEnabled();

    const sidebar = page.locator("#mitglieder-links");
    await expect(sidebar.getByRole("heading", { name: copy.sidebar.title })).toBeVisible();
    const createForm = sidebar.locator("form").first();
    await expect(createForm.locator('input[name="icon"]')).toHaveCount(
      MEMBER_SIDEBAR_LINK_ICONS.length,
    );
    const existingForm = sidebar.locator(`form:has(input[name="label"][value="${authoredLink}"])`);
    await expect(existingForm).toBeVisible();
    await expect(existingForm.locator('input[name="icon"][value="book-open"]')).toBeChecked();
    const existingSave = existingForm.getByRole("button", { name: copy.common.save });
    await expect(existingSave).toBeDisabled();
    await existingForm.getByLabel(copy.sidebar.descriptionLabel).fill(`${authoredDescription} updated`);
    await expect(existingSave).toBeEnabled();

    await expect(page.getByRole("heading", { name: copy.contract.title }).first()).toBeAttached();
    await expect(page.getByRole("heading", { name: copy.domain.title })).toBeAttached();

    const designForm = page.locator("#design form");
    const designSave = designForm.getByRole("button", { name: copy.design.save });
    await expect(designSave).toBeDisabled();
    await designForm.getByLabel(copy.design.platformName).fill(changedPlatformName);
    await expect(designSave).toBeEnabled();
    await expect(designForm.getByText(changedPlatformName, { exact: true }).first()).toBeVisible();

    const welcomeForm = page.locator("form#willkommen");
    const welcomeSave = welcomeForm.getByRole("button", { name: copy.welcome.save });
    await expect(welcomeSave).toBeDisabled();
    await welcomeForm.getByLabel(copy.welcome.titleLabel).fill(`${authoredWelcomeTitle} preview`);
    await expect(welcomeSave).toBeEnabled();
    await expect(welcomeForm.getByText(`${authoredWelcomeTitle} preview`, { exact: true })).toBeVisible();

    const transcriptForm = page.locator("form#transkripte");
    const transcriptSave = transcriptForm.getByRole("button", { name: copy.transcript.save });
    await expect(transcriptSave).toBeDisabled();
    await transcriptForm.getByLabel(copy.transcript.excluded).fill(`internal-${suffix}`);
    await expect(transcriptSave).toBeEnabled();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`settings-localization-${locale}.png`),
      fullPage: true,
    });

    await page.context().clearCookies();
    await login(page, origin, memberEmail, password, "/academy");
    const welcomeDialog = page.getByRole("dialog", { name: authoredWelcomeTitle });
    await expect(welcomeDialog).toBeVisible();
    await expect(welcomeDialog.getByText(authoredWelcomeText, { exact: true })).toBeVisible();
    await expect(
      welcomeDialog.getByRole("link", { name: copy.welcome.addProfileImage }),
    ).toBeVisible();
    await expect(
      welcomeDialog.getByRole("button", { name: copy.welcome.modalClose }),
    ).toBeVisible();
    await expect(welcomeDialog.getByRole("button", { name: copy.welcome.getStarted })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`member-welcome-localization-${locale}.png`),
      fullPage: true,
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
