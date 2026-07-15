import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const adminCopy = {
  en: {
    title: "Announcements",
    search: "Search announcements",
    create: "New announcement",
    template: "Announcement template",
    applyTemplate: "Apply template",
    blocks: "Content blocks",
    richText: "Rich text block 1",
    titleField: "Title",
    save: "Save announcement",
    saved: "Announcement created.",
    close: "Close editor",
    preview: "Content preview",
    layerEyebrow: "New in your Academy",
    layerRegion: "Announcements",
    layerClose: "Close announcement",
  },
  it: {
    title: "Annunci",
    search: "Cerca annunci",
    create: "Nuovo annuncio",
    template: "Modello di annuncio",
    applyTemplate: "Applica modello",
    blocks: "Blocchi di contenuto",
    richText: "Blocco di testo ricco 1",
    titleField: "Titolo",
    save: "Salva annuncio",
    saved: "Annuncio creato.",
    close: "Chiudi editor",
    preview: "Anteprima contenuto",
    layerEyebrow: "Novita nella tua Academy",
    layerRegion: "Annunci",
    layerClose: "Chiudi annuncio",
  },
} as const;

test("announcement administration and learner delivery follow the effective locale", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const adminLocale = testInfo.project.name === "mobile" ? "it" : "en";
  const copy = adminCopy[adminLocale];
  const slug = `announcement-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `announcement-${suffix}@example.test`;
  const authoredTitle = `Authored ${suffix}`;
  const authoredBody = `Unchanged author content ${suffix}`;
  const bannerTitle = `Banner sentinel ${suffix}`;
  const modalTitle = `Modal sentinel ${suffix}`;

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("Announcement password fixture is missing.");

    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Announcement Locale Academy', ${slug}, ${adminLocale})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${userId}, ${organizationId}, ${email}, ${template.password_hash},
        'Locale', 'Owner', 'owner', 'active', ${adminLocale}
      )
    `;

    const bannerDocument = {
      version: 1,
      blocks: [
        {
          id: randomUUID(),
          type: "rich_text",
          document: {
            version: 1,
            blocks: [
              {
                type: "paragraph",
                children: [{ type: "text", text: `Banner body ${suffix}` }],
              },
            ],
          },
        },
      ],
    };
    const modalDocument = {
      version: 1,
      blocks: [
        {
          id: randomUUID(),
          type: "rich_text",
          document: {
            version: 1,
            blocks: [
              {
                type: "paragraph",
                children: [{ type: "text", text: `Modal body ${suffix}` }],
              },
            ],
          },
        },
      ],
    };
    await sql`
      insert into announcements (
        organization_id, created_by_id, title, body, content_document,
        placement, audience, starts_at, dismissible, active
      ) values
        (
          ${organizationId}, ${userId}, ${bannerTitle}, ${`Banner body ${suffix}`},
          ${sql.json(bannerDocument)}, 'banner', 'all', now() - interval '1 minute',
          true, true
        ),
        (
          ${organizationId}, ${userId}, ${modalTitle}, ${`Modal body ${suffix}`},
          ${sql.json(modalDocument)}, 'modal', 'all', now() - interval '1 minute',
          true, true
        )
    `;

    await page.goto(`${tenantOrigin}/login`);
    const loginForm = page.locator("form").filter({
      has: page.locator('input[name="email"]'),
    });
    await loginForm.locator('input[name="email"]').fill(email);
    await loginForm.locator('input[name="password"]').fill("Demo123!");
    await loginForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(`${tenantOrigin}/admin`);

    await page.goto(`${tenantOrigin}/admin/announcements`);
    await expect(
      page.getByRole("heading", { name: copy.title, exact: true }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(copy.search)).toBeVisible();
    await page.getByRole("button", { name: copy.create }).click();
    const dialog = page.getByRole("dialog", { name: copy.create });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(copy.template)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: copy.applyTemplate }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("heading", { name: copy.blocks }),
    ).toBeVisible();
    await expect(dialog.getByLabel(copy.preview)).toBeVisible();
    await dialog.getByLabel(copy.titleField).fill(authoredTitle);
    await dialog.getByLabel(copy.richText).fill(authoredBody);
    await dialog.getByRole("button", { name: copy.save }).click();
    await expect(dialog.getByText(copy.saved, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: copy.close }).click();
    await expect(
      page.getByRole("heading", { name: authoredTitle, exact: true }),
    ).toBeVisible();

    if (testInfo.project.name === "mobile") {
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
    }

    await page.goto(`${tenantOrigin}/academy`);
    await expect(page.locator("[data-tenant-branding]")).toHaveAttribute(
      "lang",
      adminLocale,
    );
    const modal = page.getByRole("dialog", { name: modalTitle });
    await expect(modal).toContainText(copy.layerEyebrow);
    await modal.getByRole("button", { name: copy.layerClose }).click();

    const announcementRegion = page.getByLabel(copy.layerRegion);
    const banner = announcementRegion.locator("section").filter({
      has: page.getByRole("heading", { name: bannerTitle, exact: true }),
    });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(`Banner body ${suffix}`);
    await banner.getByRole("button", { name: copy.layerClose }).click();
    await expect(banner).toBeHidden();

    await page.screenshot({
      path: testInfo.outputPath(
        `announcement-i18n-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});

test("French learner announcement controls are localized while authored content is unchanged", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "French desktop locale coverage");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const slug = `announcement-fr-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `announcement-fr-${suffix}@example.test`;
  const modalTitle = `Contenu auteur ${suffix}`;
  const modalBody = `Texte auteur inchange ${suffix}`;

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("Announcement password fixture is missing.");
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Academy Francaise', ${slug}, 'fr')
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${userId}, ${organizationId}, ${email}, ${template.password_hash},
        'Locale', 'Francais', 'owner', 'active', 'fr'
      )
    `;
    await sql`
      insert into announcements (
        organization_id, created_by_id, title, body, content_document,
        placement, audience, starts_at, dismissible, active
      ) values (
        ${organizationId}, ${userId}, ${modalTitle}, ${modalBody},
        ${sql.json({
          version: 1,
          blocks: [
            {
              id: randomUUID(),
              type: "callout",
              tone: "info",
              title: null,
              body: modalBody,
            },
          ],
        })},
        'modal', 'all', now() - interval '1 minute', true, true
      )
    `;

    await page.goto(`${tenantOrigin}/login`);
    const loginForm = page.locator("form").filter({
      has: page.locator('input[name="email"]'),
    });
    await loginForm.locator('input[name="email"]').fill(email);
    await loginForm.locator('input[name="password"]').fill("Demo123!");
    await loginForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(`${tenantOrigin}/admin`);
    await page.goto(`${tenantOrigin}/academy`);

    await expect(page.locator("[data-tenant-branding]")).toHaveAttribute(
      "lang",
      "fr",
    );
    const modal = page.getByRole("dialog", { name: modalTitle });
    await expect(modal).toContainText("Nouveau dans votre Academy");
    await expect(modal).toContainText(modalBody);
    await modal.getByRole("button", { name: "Fermer l'annonce" }).click();
    await expect(modal).toBeHidden();
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
