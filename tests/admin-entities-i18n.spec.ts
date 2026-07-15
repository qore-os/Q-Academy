import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const localized = {
  en: {
    locale: "en",
    groups: "Groups",
    groupEyebrow: "Member management",
    newGroup: "New group",
    createGroup: "Create group",
    groupDetail: "Group management",
    groupName: "Group name",
    save: "Save",
    groupSaved: "Group saved.",
    beginner: "Beginner",
    bundles: "Bundles",
    bundleEyebrow: "Access management",
    active: "Active",
    sync: "Changes synchronize automatically",
    newBundle: "New bundle",
    createBundle: "Create bundle",
    bundleDetail: "Bundle management",
    bundleName: "Bundle name",
    bundleSaved: "Bundle saved.",
    hubs: "Hubs",
    hubEyebrow: "Custom dashboards",
    draft: "Draft",
    forAll: "For all members",
    newHub: "New hub",
    createHub: "Create hub",
    hubSettings: "Hub settings",
    title: "Title",
    saveSettings: "Save settings",
    hubSaved: "Hub settings saved.",
    emptyLayout: "0 rows with 0 widgets",
    addRow: "Add row",
    layoutRow: "Layout row 1",
    addWidget: "Add widget",
    widgetDialog: "Add widget",
    closeWidget: "Close widget dialog",
    closeCreate: "Close dialog",
  },
  fr: {
    locale: "fr",
    groups: "Groupes",
    groupEyebrow: "Gestion des membres",
    newGroup: "Nouveau groupe",
    createGroup: "Créer un groupe",
    groupDetail: "Gestion du groupe",
    groupName: "Nom du groupe",
    save: "Enregistrer",
    groupSaved: "Groupe enregistré.",
    beginner: "Débutant",
    bundles: "Packs",
    bundleEyebrow: "Gestion des accès",
    active: "Actif",
    sync: "Les modifications sont synchronisées automatiquement",
    newBundle: "Nouveau pack",
    createBundle: "Créer un pack",
    bundleDetail: "Gestion du pack",
    bundleName: "Nom du pack",
    bundleSaved: "Pack enregistré.",
    hubs: "Hubs",
    hubEyebrow: "Tableaux de bord personnalisés",
    draft: "Brouillon",
    forAll: "Pour tous les membres",
    newHub: "Nouveau hub",
    createHub: "Créer un hub",
    hubSettings: "Paramètres du hub",
    title: "Titre",
    saveSettings: "Enregistrer les paramètres",
    hubSaved: "Paramètres du hub enregistrés.",
    emptyLayout: "0 lignes avec 0 widgets",
    addRow: "Ajouter une ligne",
    layoutRow: "Ligne de mise en page 1",
    addWidget: "Ajouter un widget",
    widgetDialog: "Ajouter un widget",
    closeWidget: "Fermer la boîte de dialogue du widget",
    closeCreate: "Fermer la boîte de dialogue",
  },
} as const;

test("admin group, bundle, and hub workflows honor EN desktop and FR mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const copy = testInfo.project.name === "mobile" ? localized.fr : localized.en;
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const ownerId = randomUUID();
  const slug = `entities-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${slug}.localhost:3000`;
  const email = `entities-${suffix}@example.test`;
  const password = "Demo123!";
  const groupName = `Customer Group ${suffix.slice(0, 6)}`;
  const bundleName = `Customer Bundle ${suffix.slice(0, 6)}`;
  const hubTitle = `Customer Hub ${suffix.slice(0, 6)}`;
  const courseTitle = `Customer Course ${suffix.slice(0, 6)}`;

  try {
    const [template] = await sql<Array<{ password_hash: string }>>`
      select password_hash from users where email = 'admin@q-academy.de' limit 1
    `;
    if (!template) throw new Error("Admin entity password fixture is missing.");

    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (${organizationId}, 'Entity Locale Academy', ${slug}, ${copy.locale})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${ownerId}, ${organizationId}, ${email}, ${template.password_hash},
        'Entity', 'Owner', 'owner', 'active'
      )
    `;
    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, difficulty, estimated_minutes, created_by_id
      ) values (
        ${organizationId}, ${courseTitle}, ${`course-${suffix.slice(0, 12)}`},
        'Customer-authored summary', 'Customer-authored course description',
        'published', 'Grundlagen', 95, ${ownerId}
      ) returning id
    `;
    const [group] = await sql<Array<{ id: string }>>`
      insert into groups (organization_id, name, description, color)
      values (
        ${organizationId}, ${groupName}, 'Customer-authored group description',
        '#4f7cac'
      ) returning id
    `;
    const [bundle] = await sql<Array<{ id: string }>>`
      insert into bundles (organization_id, name, description, color, active)
      values (
        ${organizationId}, ${bundleName}, 'Customer-authored bundle description',
        '#ee6c5d', true
      ) returning id
    `;
    const [hub] = await sql<Array<{ id: string }>>`
      insert into hubs (organization_id, title, slug, description, status, layout)
      values (
        ${organizationId}, ${hubTitle}, ${`hub-${suffix.slice(0, 12)}`},
        'Customer-authored hub description', 'draft', '[]'::jsonb
      ) returning id
    `;
    await sql`
      insert into group_courses (group_id, course_id)
      values (${group.id}, ${course.id})
    `;
    await sql`
      insert into bundle_courses (bundle_id, course_id)
      values (${bundle.id}, ${course.id})
    `;
    await sql`
      insert into group_bundles (group_id, bundle_id)
      values (${group.id}, ${bundle.id})
    `;

    await page.goto(`${tenantOrigin}/login`);
    await expect(page.locator("html")).toHaveAttribute("lang", copy.locale);
    const loginForm = page.locator("form").filter({
      has: page.locator('input[name="email"]'),
    });
    await loginForm.locator('input[name="email"]').fill(email);
    await loginForm.locator('input[name="password"]').fill(password);
    await loginForm.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(`${tenantOrigin}/admin`);

    await page.goto(`${tenantOrigin}/admin/groups`);
    await expect(page.getByRole("heading", { name: copy.groups })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(copy.groupEyebrow, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(groupName, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.newGroup }).click();
    await expect(
      page.getByRole("dialog", { name: copy.createGroup }),
    ).toBeVisible();
    await page.getByRole("button", { name: copy.closeCreate }).last().click();

    await page.goto(`${tenantOrigin}/admin/groups/${group.id}`);
    await expect(page.getByText(copy.groupDetail, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();
    await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(bundleName, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.beginner)).toBeVisible();
    await page.getByLabel(copy.groupName).fill(groupName);
    await page.getByRole("button", { name: copy.save, exact: true }).click();
    await expect(page.getByText(copy.groupSaved, { exact: true })).toBeVisible();

    await page.goto(`${tenantOrigin}/admin/bundles`);
    await expect(page.getByRole("heading", { name: copy.bundles })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(copy.bundleEyebrow, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(bundleName, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.active, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.sync, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.newBundle }).click();
    await expect(
      page.getByRole("dialog", { name: copy.createBundle }),
    ).toBeVisible();
    await page.getByRole("button", { name: copy.closeCreate }).last().click();

    await page.goto(`${tenantOrigin}/admin/bundles/${bundle.id}`);
    await expect(page.getByText(copy.bundleDetail, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: bundleName })).toBeVisible();
    await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.beginner)).toBeVisible();
    await page.getByLabel(copy.bundleName).fill(bundleName);
    await page.getByRole("button", { name: copy.save, exact: true }).click();
    await expect(page.getByText(copy.bundleSaved, { exact: true })).toBeVisible();

    await page.goto(`${tenantOrigin}/admin/hubs`);
    await expect(page.getByRole("heading", { name: copy.hubs })).toBeVisible();
    await expect(
      page.getByRole("main").getByText(copy.hubEyebrow, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(hubTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.draft, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.forAll, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.newHub }).click();
    await expect(page.getByRole("dialog", { name: copy.createHub })).toBeVisible();
    await page.getByRole("button", { name: copy.closeCreate }).last().click();

    await page.goto(`${tenantOrigin}/admin/hubs/${hub.id}`);
    await expect(page.getByText(copy.hubSettings, { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: hubTitle })).toBeVisible();
    await expect(page.getByText(copy.emptyLayout, { exact: true })).toBeVisible();
    await page.getByLabel(copy.title, { exact: true }).fill(hubTitle);
    await page.getByRole("button", { name: copy.saveSettings }).click();
    await expect(page.getByText(copy.hubSaved, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: copy.addRow }).click();
    await expect(
      page.getByRole("region", { name: copy.layoutRow }),
    ).toBeVisible();
    await page.getByRole("button", { name: copy.addWidget }).click();
    await expect(
      page.getByRole("dialog", { name: copy.widgetDialog }),
    ).toBeVisible();
    await page.getByRole("button", { name: copy.closeWidget }).last().click();

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`admin-entities-${copy.locale}.png`),
      fullPage: true,
    });
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
