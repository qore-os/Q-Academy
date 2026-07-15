import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("course editor supports media, duplication and drag sorting", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused rich-editor flow");
  test.setTimeout(75_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let courseId = "";
  let moduleId = "";
  let lessonId = "";

  try {
    const [fixture] = await client<{ organization_id: string; owner_id: string }[]>`
      select organization_id, id as owner_id
      from users where email = 'admin@q-academy.de' limit 1
    `;
    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values (
        ${fixture.organization_id}, ${`E2E Medienkurs ${suffix}`},
        ${`e2e-media-${suffix}`}, 'Rich-Content-Test.',
        'Temporarer Kurs fuer Medien und Sortierung.', 'draft', ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [module] = await client<{ id: string }[]>`
      insert into modules (
        organization_id, title, folder, is_reusable, estimated_minutes
      ) values (${fixture.organization_id}, 'Medienmodul', 'E2E', false, 30)
      returning id
    `;
    moduleId = module.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, drip_days, is_required
      )
      values (${fixture.organization_id}, ${courseId}, ${moduleId}, 0, 0, true)
    `;
    const [section] = await client<{ id: string }[]>`
      insert into module_sections (organization_id, module_id, title, sort_order)
      values (${fixture.organization_id}, ${moduleId}, 'Start', 0) returning id
    `;
    const [lesson] = await client<{ id: string }[]>`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, type, status,
        duration_minutes, sort_order
      ) values (
        ${fixture.organization_id}, ${moduleId}, ${section.id},
        'Medienlektion', ${`medien-${suffix}`},
        'lesson', 'published', 20, 0
      ) returning id
    `;
    lessonId = lesson.id;

    await page.goto("/login");
    await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
    await page.waitForURL("**/admin");
    await page.goto(`/admin/courses/${courseId}`);

    await page.getByRole("button", { name: "Bild", exact: true }).click();
    await expect(page.getByText("Bild-URL ergaenzen", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Bild: Bearbeiten" }).click();
    const editor = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    await editor.getByLabel("Titel").fill("Hero-Bild");
    await editor
      .getByRole("textbox", { name: "Bild-URL", exact: true })
      .fill("https://example.com/academy-image.png");
    await editor.getByLabel("Bildunterschrift").fill("Eine sichere Medienreferenz.");
    await editor.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(page.getByRole("img", { name: "Hero-Bild" })).toBeVisible();

    await page
      .getByRole("button", { name: "Hero-Bild: Inhaltselement duplizieren" })
      .click();
    await expect(page.getByText("Inhaltselement dupliziert.", { exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Hero-Bild (Kopie)" })).toBeVisible();

    for (const type of ["Video", "Audio", "Datei", "Embed", "Text"]) {
      await page.getByRole("button", { name: type, exact: true }).click();
      await expect(
        page.getByText("Inhaltselement hinzugefuegt.", { exact: true }).last(),
      ).toBeVisible();
    }

    const source = page.getByRole("button", {
      name: "Text: Inhaltselement verschieben",
    });
    await source.focus();
    await source.press("Space");
    for (let index = 0; index < 6; index += 1) {
      await source.press("ArrowUp");
    }
    await source.press("Space");
    await expect(page.getByText("Reihenfolge gespeichert.", { exact: true })).toBeVisible();

    const rows = await client<{ type: string; sort_order: number; title: string | null }[]>`
      select type, sort_order, title
      from content_blocks
      where lesson_id = ${lessonId} and page_id is null
      order by sort_order
    `;
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.type)).toEqual(
      expect.arrayContaining(["image", "video", "audio", "file", "embed", "text"]),
    );
    expect(rows.findIndex((row) => row.type === "text")).toBeLessThan(6);
    expect(rows.filter((row) => row.type === "image")).toHaveLength(2);
  } finally {
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    await client.end();
  }
});
