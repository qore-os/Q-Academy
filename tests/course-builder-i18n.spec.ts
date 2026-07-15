import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { hash } from "bcryptjs";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("course builder deep copy follows the tenant locale on desktop and mobile", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const organizationId = randomUUID();
  const userId = randomUUID();
  const courseId = randomUUID();
  const tenantSlug = `builder-locale-${suffix.slice(0, 8)}`;
  const tenantOrigin = `http://${tenantSlug}.localhost:3000`;
  const email = `builder-locale-${suffix}@example.test`;
  const password = `Builder-${suffix.slice(0, 8)}!`;
  const courseTitle = `Locale course ${suffix.slice(0, 8)}`;

  try {
    const passwordHash = await hash(password, 8);
    await sql`
      insert into organizations (id, name, slug, default_locale)
      values (
        ${organizationId},
        ${`Builder Locale ${suffix.slice(0, 8)}`},
        ${tenantSlug},
        'en'
      )
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${userId}, ${organizationId}, ${email}, ${passwordHash},
        'Course', 'Owner', 'owner', 'active', 'en'
      )
    `;
    await sql`
      insert into courses (
        id, organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${courseId}, ${organizationId}, ${courseTitle},
        ${`locale-course-${suffix.slice(0, 8)}`},
        'Self-contained localisation fixture.',
        'Course used only for the CourseBuilder localisation regression test.',
        'draft', ${userId}
      )
    `;

    await page.goto(`${tenantOrigin}/login`);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: /Sign in to Builder Locale/ })
      .click();
    await expect(page).toHaveURL(`${tenantOrigin}/admin`);

    await page.goto(`${tenantOrigin}/admin/courses/${courseId}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      page.getByRole("heading", { name: courseTitle, exact: true }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Information", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Course information", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
      courseTitle,
    );
    await expect(page.getByText("Kursinformationen", { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Access", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Access and release", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Enrolled", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Zugang und Freischaltung", { exact: true }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "Analytics", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Course analytics", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Progress distribution", { exact: true })).toBeVisible();
    await expect(page.getByText("Kursstatistik", { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Submissions", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Latest submissions", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No submissions yet", { exact: true })).toBeVisible();
    await expect(page.getByText("Letzte Abgaben", { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Content", exact: true }).click();
    await page
      .getByRole("button", { name: "Create module", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Create module" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Module type", { exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Module title", { exact: true })).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Modul anlegen", { exact: true })).toHaveCount(0);

  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
