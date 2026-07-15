import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const copy = {
  en: {
    listTitle: "Courses",
    search: "Search courses",
    newCourse: "New course",
    manageCategories: "Manage categories",
    createTitle: "Create a new course",
    category: "Category",
    close: "Close dialog",
    informationTab: "Information",
    goals: "Learning objectives",
    widgetsTab: "Widgets",
    widgets: "Course widgets",
    viewChanges: "View changes",
    changesDialog: "Versions and changes",
    team: "Course team permissions",
    permission: "Course permission",
    accessPage: "Module access",
    access: "Individual module access",
    noLearners: "No active learners.",
    preview: "Member preview",
    noLessons: "This course has no lessons yet",
  },
  it: {
    listTitle: "Corsi",
    search: "Cerca corsi",
    newCourse: "Nuovo corso",
    manageCategories: "Gestisci categorie",
    createTitle: "Crea un nuovo corso",
    category: "Categoria",
    close: "Chiudi finestra",
    informationTab: "Informazioni",
    goals: "Obiettivi didattici",
    widgetsTab: "Widget",
    widgets: "Widget del corso",
    viewChanges: "Visualizza modifiche",
    changesDialog: "Versioni e modifiche",
    team: "Permessi del team del corso",
    permission: "Permesso corso",
    accessPage: "Accesso ai moduli",
    access: "Accesso individuale al modulo",
    noLearners: "Nessuno studente attivo.",
    preview: "Anteprima membro",
    noLessons: "Questo corso non contiene ancora lezioni",
  },
  fr: {
    listTitle: "Cours",
    search: "Rechercher des cours",
    newCourse: "Nouveau cours",
    manageCategories: "Gerer les categories",
    createTitle: "Creer un nouveau cours",
    category: "Categorie",
    close: "Fermer la fenetre",
    informationTab: "Informations",
    goals: "Objectifs pedagogiques",
    widgetsTab: "Widgets",
    widgets: "Widgets du cours",
    viewChanges: "Voir les modifications",
    changesDialog: "Versions et modifications",
    team: "Droits de l'equipe du cours",
    permission: "Droit sur le cours",
    accessPage: "Acces aux modules",
    access: "Acces individuel au module",
    noLearners: "Aucun apprenant actif.",
    preview: "Apercu membre",
    noLessons: "Ce cours ne contient pas encore de lecons",
  },
} as const;

for (const locale of ["en", "it", "fr"] as const) {
  test(`course support follows ${locale.toUpperCase()} on desktop and mobile`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const sql = postgres(databaseUrl, { max: 1, prepare: false });
    const suffix = randomUUID();
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const trainerId = randomUUID();
    const categoryId = randomUUID();
    const courseId = randomUUID();
    const moduleId = randomUUID();
    const slug = `course-support-${locale}-${suffix.slice(0, 8)}`;
    const tenantOrigin = `http://${slug}.localhost:3000`;
    const email = `course-support-${locale}-${suffix}@example.test`;
    const courseTitle = `Authored course ${locale} ${suffix.slice(0, 8)}`;
    const moduleTitle = `Authored module ${locale} ${suffix.slice(0, 8)}`;
    const categoryName = `Authored category ${locale} ${suffix.slice(0, 8)}`;
    const expected = copy[locale];

    try {
      const [template] = await sql<Array<{ password_hash: string }>>`
        select password_hash from users where email = 'admin@q-academy.de' limit 1
      `;
      if (!template) throw new Error("Course support password fixture is missing.");

      await sql`
        insert into organizations (id, name, slug, default_locale)
        values (${organizationId}, ${`Course Support ${locale}`}, ${slug}, ${locale})
      `;
      await sql`
        insert into users (
          id, organization_id, email, password_hash, first_name, last_name,
          role, status, preferred_locale
        ) values (
          ${ownerId}, ${organizationId}, ${email}, ${template.password_hash},
          'Locale', 'Owner', 'owner', 'active', ${locale}
        ), (
          ${trainerId}, ${organizationId}, ${`trainer-${suffix}@example.test`},
          ${template.password_hash}, 'Authored', 'Trainer', 'trainer', 'active',
          ${locale}
        )
      `;
      await sql`
        insert into course_categories (
          id, organization_id, name, slug, description, color, sort_order
        ) values (
          ${categoryId}, ${organizationId}, ${categoryName},
          ${`category-${suffix.slice(0, 8)}`}, 'Authored category description',
          '#2bb7a9', 0
        )
      `;
      await sql`
        insert into courses (
          id, organization_id, category_id, title, slug, short_description,
          description, status, created_by_id
        ) values (
          ${courseId}, ${organizationId}, ${categoryId}, ${courseTitle},
          ${`course-${suffix.slice(0, 8)}`}, 'Authored short description',
          'Authored long description', 'draft', ${ownerId}
        )
      `;
      await sql`
        insert into modules (
          id, organization_id, title, description, estimated_minutes
        ) values (
          ${moduleId}, ${organizationId}, ${moduleTitle},
          'Authored module description', 25
        )
      `;
      await sql`
        insert into course_modules (
          organization_id, course_id, module_id, sort_order
        ) values (${organizationId}, ${courseId}, ${moduleId}, 0)
      `;

      await page.goto(`${tenantOrigin}/login`);
      const loginForm = page.locator("form").filter({
        has: page.locator('input[name="email"]'),
      });
      await loginForm.locator('input[name="email"]').fill(email);
      await loginForm.locator('input[name="password"]').fill("Demo123!");
      await loginForm.locator('button[type="submit"]').click();
      await expect(page).toHaveURL(`${tenantOrigin}/admin`);

      await page.goto(`${tenantOrigin}/admin/courses`);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await expect(
        page.getByRole("heading", { name: expected.listTitle, exact: true }),
      ).toBeVisible();
      await expect(page.getByPlaceholder(expected.search)).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: expected.manageCategories,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: courseTitle, exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: expected.newCourse }).click();
      const creationDialog = page.getByRole("dialog", {
        name: expected.createTitle,
      });
      await expect(creationDialog).toBeVisible();
      await expect(
        creationDialog.getByText(expected.category, { exact: true }),
      ).toBeVisible();
      await creationDialog
        .getByRole("button", { name: expected.close })
        .click();

      await page.goto(`${tenantOrigin}/admin/courses/${courseId}`);
      await expect(
        page.getByRole("heading", { name: courseTitle, exact: true }),
      ).toBeVisible();
      await page.getByTestId("course-change-marker").click();
      const changesDialog = page.getByRole("dialog", {
        name: expected.changesDialog,
      });
      await expect(changesDialog).toBeVisible();
      await expect(
        changesDialog.getByRole("tab", { name: expected.viewChanges }),
      ).toBeVisible();
      await changesDialog
        .getByRole("button", { name: expected.close })
        .click();

      await page
        .getByRole("tab", { name: expected.informationTab, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: expected.goals, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("tab", { name: expected.widgetsTab, exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: expected.widgets, exact: true }),
      ).toBeVisible();

      await page.goto(`${tenantOrigin}/admin/courses/${courseId}/team`);
      await expect(page.getByText(expected.team, { exact: true })).toBeVisible();
      await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: expected.permission }),
      ).toBeVisible();

      await page.goto(`${tenantOrigin}/admin/courses/${courseId}/access`);
      await expect(page.getByText(expected.accessPage, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: expected.access, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(moduleTitle, { exact: true })).toBeVisible();
      await expect(page.getByText(expected.noLearners, { exact: true })).toBeVisible();

      await page.goto(`${tenantOrigin}/admin/courses/${courseId}/preview`);
      await expect(page.getByText(expected.preview, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: expected.noLessons, exact: true }),
      ).toBeVisible();
      await expect(page.getByText(courseTitle, { exact: true })).toBeVisible();

      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(`course-support-${locale}.png`),
        fullPage: true,
      });
    } finally {
      await sql`delete from organizations where id = ${organizationId}`;
      await sql.end();
    }
  });
}
