import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("reusable module can be attached and edited from a course", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused reusable-module flow");
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const moduleTitle = `E2E Bibliothek ${suffix}`;
  const courseTitle = `E2E Zielkurs ${suffix}`;
  let moduleId = "";
  let courseId = "";

  try {
    const [fixture] = await client<{ organization_id: string; owner_id: string }[]>`
      select organization_id, id as owner_id
      from users where email = 'admin@q-academy.de' limit 1
    `;
    const [module] = await client<{ id: string }[]>`
      insert into modules (
        organization_id, title, description, folder, is_reusable, estimated_minutes
      ) values (
        ${fixture.organization_id}, ${moduleTitle}, 'Wiederverwendbares Testmodul.',
        'E2E Bibliothek', true, 25
      ) returning id
    `;
    moduleId = module.id;
    await client`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        status, duration_minutes, sort_order
      ) values (
        ${fixture.organization_id}, ${moduleId},
        'Bibliothekslektion', ${`bibliothek-${suffix}`}, 'Synchroner Inhalt.',
        'lesson', 'published', 12, 0
      )
    `;
    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values (
        ${fixture.organization_id}, ${courseTitle}, ${`e2e-reuse-${suffix}`},
        'Zielkurs fuer ein Bibliotheksmodul.', 'Temporarer E2E-Zielkurs.', 'draft',
        ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;

    await page.goto("/login");
    await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
    await page.waitForURL("**/admin");
    await page.goto(`/admin/courses/${courseId}`);
    await page
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Modul anlegen" });
    await dialog
      .getByRole("radio", {
        name: `${moduleTitle} auswaehlen`,
        exact: true,
      })
      .check({ force: true });
    await dialog.getByRole("button", { name: "Hinzufuegen" }).click();
    await expect(
      page.getByText("Wiederverwendbares Modul hinzugefuegt.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(moduleTitle, { exact: true })).toBeVisible();

    const [assignment] = await client<{ count: number }[]>`
      select count(*)::int as count from course_modules
      where course_id = ${courseId} and module_id = ${moduleId}
    `;
    expect(assignment.count).toBe(1);

    await page.goto("/admin/modules");
    const card = page.locator("article").filter({ hasText: moduleTitle });
    await expect(
      card.getByRole("link", { name: "In Kurs bearbeiten" }),
    ).toHaveAttribute("href", `/admin/courses/${courseId}`);
  } finally {
    if (moduleId) await client`delete from activity_events where entity_id = ${moduleId}`;
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    await client.end();
  }
});
