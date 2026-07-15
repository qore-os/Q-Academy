import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("tenant and profile locale drive auth, navigation and responsive settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const slug = `locale-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `locale-${suffix}@example.test`;
  const password = "Demo123!";

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("Locale test password fixture is missing.");
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Locale Academy', ${slug}, 'en')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${userId}, ${organizationId}, ${email}, ${template.password_hash},
        'Locale', 'Owner', 'owner', 'active', null
      )
    `;

    await page.goto(`${tenantOrigin}/login`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in to Locale Academy" }).click();
    await expect(page).toHaveURL(`${tenantOrigin}/admin`);
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Close navigation" }).last().click();
    }
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(
      page.getByRole("dialog", { name: "Notifications" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close notifications" }).last().click();

    await page.goto(`${tenantOrigin}/admin/analytics`);
    await expect(
      page.getByRole("heading", { name: "Analytics", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Progress by member" }),
    ).toBeVisible();

    await page.goto(`${tenantOrigin}/admin/settings#sprache`);
    const organizationPanel = page.locator("#sprache");
    await expect(
      page.getByRole("heading", { name: "Privileged accounts" }),
    ).toBeVisible();
    await expect(
      organizationPanel.getByRole("heading", { name: "Language & localisation" }),
    ).toBeVisible();
    await organizationPanel.getByLabel("Organisation default").selectOption("fr");
    await organizationPanel.getByRole("button", { name: "Save language" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await page.goto(`${tenantOrigin}/academy/profile`);
    const profileLanguage = page.locator("form").filter({
      has: page.getByRole("heading", { name: "Langue" }),
    });
    await profileLanguage.getByLabel("Langue").selectOption("it");
    await profileLanguage.getByRole("button", { name: "Enregistrer la langue" }).click();
    await expect(page.locator("[data-tenant-branding]"))
      .toHaveAttribute("lang", "it");
    await expect(
      page.getByRole("heading", { name: "Profili dati" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Dati personali" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Notifiche", exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sessioni attive" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Autenticazione a più fattori" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Notifiche/ }).click();
    await expect(page.getByRole("dialog", { name: "Notifiche" })).toBeVisible();
    await page.getByRole("button", { name: "Chiudi notifiche" }).last().click();

    if (testInfo.project.name === "mobile") {
      await page.getByRole("button", { name: "Apri navigazione" }).click();
      const drawer = page.getByRole("complementary").last();
      await expect(drawer.getByRole("link", { name: "I miei corsi" })).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await drawer.getByRole("button", { name: "Chiudi navigazione" }).click();
    } else {
      await expect(page.getByRole("link", { name: "I miei corsi" })).toBeVisible();
    }

    await page.goto(`${tenantOrigin}/academy/courses`);
    await expect(page.getByLabel("Cerca corsi")).toBeVisible();
    await expect(page.getByText("Nessun corso corrispondente")).toBeVisible();
    await expect(page.getByRole("group", { name: "Filtra per stato del corso" }))
      .toBeVisible();

    await page.goto(`${tenantOrigin}/academy/bookmarks`);
    await expect(
      page.getByRole("heading", { name: "Segnalibri", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Nessun segnalibro", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await page.goto(`${tenantOrigin}/orbit`);
    await expect(
      page.getByRole("heading", { name: "Orbit Piano di controllo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Nuova organizzazione" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Codice istanza" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await page.goto(`${tenantOrigin}/academy/profile`);

    await page.locator("header details summary").click();
    await page.getByRole("banner").getByRole("button", { name: "Esci" }).click();
    await expect(page).toHaveURL(`${tenantOrigin}/login`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByLabel("Adresse e-mail")).toBeVisible();

    const [organization, user, audit] = await Promise.all([
      sql<Array<{ locale: string }>>`
        select default_locale as locale from organizations where id = ${organizationId}
      `,
      sql<Array<{ locale: string | null }>>`
        select preferred_locale as locale from users where id = ${userId}
      `,
      sql<Array<{ type: string }>>`
        select type from activity_events
        where organization_id = ${organizationId}
          and type in ('organization.locale_updated', 'profile.locale_updated')
      `,
    ]);
    expect(organization[0]?.locale).toBe("fr");
    expect(user[0]?.locale).toBe("it");
    expect(new Set(audit.map(({ type }) => type))).toEqual(
      new Set(["organization.locale_updated", "profile.locale_updated"]),
    );

    await page.screenshot({
      path: testInfo.outputPath(`locale-${testInfo.project.name}.png`),
      fullPage: true,
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
