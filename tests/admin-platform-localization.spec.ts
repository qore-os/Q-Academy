import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import { getEventAdminCopy } from "../src/lib/i18n/event-admin";
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

test("event administration and member lifecycle follow locale on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const locale: AppLocale = testInfo.project.name === "mobile" ? "fr" : "en";
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const slug = `event-locale-${locale}-${suffix}`;
  const origin = `http://${slug}.localhost:3000`;
  const email = `event-owner-${suffix}@example.test`;
  const password = "Demo123!";
  const scheduledTitle = `Authored live session ${suffix}`;
  const cancelledTitle = `Authored cancelled session ${suffix}`;
  const authoredDescription = `Authored event description ${suffix}`;
  const authoredLocation = `Authored room ${suffix}`;
  const eventCopy = getEventAdminCopy(locale);

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
      values (${organizationId}, ${`Event Locale ${suffix}`}, ${slug}, ${locale})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${ownerId}, ${organizationId}, ${email}, ${template.passwordHash},
        'Event', 'Owner', 'owner', 'active', ${locale}
      )
    `;
    const [scheduled] = await sql<Array<{ id: string }>>`
      insert into events (
        organization_id, title, description, type, starts_at, ends_at,
        location, color, capacity, created_by_id
      ) values (
        ${organizationId}, ${scheduledTitle}, ${authoredDescription}, 'workshop',
        '2030-01-15T09:30:00.000Z', '2030-01-15T11:00:00.000Z',
        ${authoredLocation}, '#2bb7a9', 12, ${ownerId}
      ) returning id
    `;
    await sql`
      insert into events (
        organization_id, title, description, type, starts_at, ends_at,
        location, color, status, created_by_id
      ) values (
        ${organizationId}, ${cancelledTitle}, ${authoredDescription}, 'webinar',
        '2030-02-10T13:00:00.000Z', '2030-02-10T14:00:00.000Z',
        ${authoredLocation}, '#ee6c5d', 'cancelled', ${ownerId}
      )
    `;

    await login(page, origin, email, password);
    await page.goto(`${origin}/admin/events`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    const adminHeader = getMainPageDictionary(locale).admin.headers.events;
    await expect(
      page.getByRole("heading", { name: adminHeader.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: eventCopy.manager.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(scheduledTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(cancelledTitle, { exact: true })).toBeVisible();
    await expect(
      page.getByText(authoredDescription, { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: eventCopy.create.button }).click();
    const createDialog = page.getByRole("dialog", {
      name: eventCopy.create.title,
    });
    await expect(createDialog).toBeVisible();
    await expect(
      createDialog.getByLabel(eventCopy.details.title),
    ).toBeVisible();
    await expect(
      createDialog.getByLabel(eventCopy.details.startsAt, { exact: true }),
    ).toBeVisible();
    await expect(
      createDialog.getByLabel(eventCopy.details.endsAt, { exact: true }),
    ).toBeVisible();
    await createDialog
      .getByRole("button", { name: eventCopy.common.closeDialog })
      .click();

    const scheduledRow = page.locator(`#event-${scheduled.id}`);
    await scheduledRow
      .getByRole("button", { name: eventCopy.manager.manage })
      .click();
    const manageDialog = page.getByRole("dialog", {
      name: eventCopy.dialog.manage(scheduledTitle),
    });
    await expect(manageDialog).toBeVisible();
    for (const tab of [
      eventCopy.dialog.details,
      eventCopy.dialog.lifecycle,
      eventCopy.dialog.audience,
      eventCopy.dialog.attendance("0"),
    ]) {
      await expect(manageDialog.getByRole("tab", { name: tab })).toBeAttached();
    }
    await manageDialog
      .getByRole("tab", { name: eventCopy.dialog.lifecycle })
      .click();
    await expect(
      manageDialog.getByText(eventCopy.lifecycle.currentStatus),
    ).toBeVisible();
    await manageDialog
      .getByRole("button", { name: eventCopy.common.closeDialog })
      .click();

    const csvResponse = await page.evaluate(async (url) => {
      const response = await fetch(url);
      return {
        ok: response.ok,
        disposition: response.headers.get("content-disposition"),
        text: await response.text(),
      };
    }, `/admin/events/${scheduled.id}/attendees.csv`);
    expect(csvResponse.ok).toBe(true);
    expect(csvResponse.disposition).toContain(
      eventCopy.csv.fileName(scheduled.id),
    );
    expect(csvResponse.text).toContain(`"${eventCopy.csv.headers[0]}"`);

    await page.goto(`${origin}/academy/events`);
    const memberHeader = getCoreDictionary(locale).experience.events;
    await expect(
      page.getByRole("heading", { name: memberHeader.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(cancelledTitle, { exact: true })).toBeVisible();
    await expect(
      page.getByText(memberHeader.cancelled, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(authoredLocation, { exact: true }).first(),
    ).toBeVisible();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`event-localization-${locale}.png`),
      fullPage: true,
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
