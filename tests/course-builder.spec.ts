import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("admin builds a paged lesson and manages its content", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused builder lifecycle runs once on desktop Chromium",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const courseTitle = `Builder E2E ${suffix}`;
  const moduleTitle = `Modul ${suffix}`;
  const sectionTitle = `Praxis ${suffix}`;
  const lessonTitle = `Lektion ${suffix}`;
  const pageTitle = `Vertiefung ${suffix}`;
  let courseId = "";

  try {
    const [owner] = await client<{ id: string; organization_id: string }[]>`
      select id, organization_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    expect(owner).toBeTruthy();
    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        created_by_id
      ) values (
        ${owner.organization_id},
        ${courseTitle},
        ${`builder-e2e-${suffix}`},
        'Temporarer Kurs fuer den fokussierten Editor-Test.',
        'Temporarer Kurs fuer den fokussierten Editor-Test und seinen kompletten Seitenfluss.',
        'draft',
        ${owner.id}
      )
      returning id
    `;
    courseId = course.id;

    await loginAsOwner(page);
    await page.goto(`/admin/courses/${courseId}`);
    await expect(
      page.getByRole("heading", { name: courseTitle }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    let dialog = page.getByRole("dialog", { name: "Modul anlegen" });
    await dialog.getByLabel("Modultitel").fill(moduleTitle);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Ein fokussiertes Testmodul fuer den Kurseditor.");
    await dialog.getByLabel("Dauer (Minuten)").fill("45");
    await dialog
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(moduleTitle, { exact: true })).toBeVisible();

    await page
      .getByRole("button", {
        name: `Sektion anlegen: ${moduleTitle}`,
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", { name: "Sektion anlegen" });
    await dialog.getByLabel("Sektionstitel").fill(sectionTitle);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Sektion fuer den Seitenfluss.");
    await dialog
      .getByRole("button", { name: "Sektion anlegen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(sectionTitle, { exact: true })).toBeVisible();

    await page
      .getByRole("button", {
        name: `Lektion anlegen: ${moduleTitle}`,
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", { name: "Lektion anlegen" });
    await dialog.getByLabel("Lektionstitel").fill(lessonTitle);
    await dialog.getByLabel("Sektion").selectOption({ label: sectionTitle });
    await dialog.getByLabel("Dauer (Minuten)").fill("12");
    await dialog
      .getByLabel("Zusammenfassung")
      .fill("Zusammenfassung fuer den E2E-Test.");
    await dialog
      .getByRole("button", { name: "Lektion anlegen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: lessonTitle }),
    ).toBeVisible();

    const preview = page.getByRole("link", { name: "Vorschau", exact: true });
    await expect(preview).toHaveAttribute(
      "href",
      new RegExp(`/admin/courses/${courseId}/preview\\?lesson=.+`),
    );
    const previewHref = await preview.getAttribute("href");
    expect(previewHref).toBeTruthy();
    await page.goto(previewHref!);
    await expect(
      page.getByText("Mitglieder-Vorschau", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: lessonTitle }),
    ).toBeVisible();
    expect(await page.content()).not.toContain("correctOption");
    await page.goto(`/admin/courses/${courseId}`);
    await expect(
      page.getByRole("heading", { name: lessonTitle }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Seite", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Lektionsseite anlegen" });
    await dialog.getByLabel("Seitentitel").fill(pageTitle);
    await dialog
      .getByRole("button", { name: "Lektionsseite anlegen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: `1. ${pageTitle}` }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Ueberschrift", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Neue Ueberschrift" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "heading: Bearbeiten", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    await dialog.getByLabel("Ueberschrift").fill("Ergebnisorientiert lernen");
    await dialog.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "Ergebnisorientiert lernen" }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: "Multiple Choice", exact: true })
      .click();
    await expect(
      page.getByText("Welche Antwort ist richtig?", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Wissenscheck: Bearbeiten", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    await dialog
      .getByLabel("Frage")
      .fill("Welche Option zeigt den gespeicherten Seitenfluss?");
    await dialog
      .getByLabel("Antwortoptionen")
      .fill("Option Eins\nOption Zwei\nOption Drei");
    await dialog.getByLabel("Korrekte Antwort").selectOption("1");
    await dialog.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Welche Option zeigt den gespeicherten Seitenfluss?", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("course-builder-page-flow.png"),
      fullPage: true,
    });

    const [previewTarget] = await client<
      {
        lesson_id: string;
        page_id: string;
      }[]
    >`
      select l.id as lesson_id, lp.id as page_id
      from lessons l
      join lesson_pages lp on lp.lesson_id = l.id
      where l.title = ${lessonTitle}
        and lp.title = ${pageTitle}
      limit 1
    `;
    await page.goto(
      `/admin/courses/${courseId}/preview?lesson=${previewTarget.lesson_id}&page=${previewTarget.page_id}`,
    );
    await expect(
      page.getByText("Welche Option zeigt den gespeicherten Seitenfluss?", {
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.content()).not.toContain("correctOption");
    await page.screenshot({
      path: testInfo.outputPath("course-preview-page.png"),
      fullPage: false,
    });
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("button", { name: `1. ${pageTitle}` }).click();

    await page
      .getByRole("button", { name: "Wissenscheck: Bearbeiten", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    await dialog.getByRole("button", { name: "Loeschen", exact: true }).click();
    const confirm = page.getByRole("dialog", {
      name: "Inhaltselement loeschen",
    });
    await confirm
      .getByRole("button", { name: "Loeschen", exact: true })
      .click();
    await expect(confirm).toBeHidden();
    await expect(
      page.getByText("Welche Option zeigt den gespeicherten Seitenfluss?", {
        exact: true,
      }),
    ).toBeHidden();

    await page
      .getByRole("button", { name: "heading: Bearbeiten", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
    await dialog.getByRole("button", { name: "Loeschen", exact: true }).click();
    const secondConfirm = page.getByRole("dialog", {
      name: "Inhaltselement loeschen",
    });
    await secondConfirm
      .getByRole("button", { name: "Loeschen", exact: true })
      .click();
    await expect(secondConfirm).toBeHidden();
    await expect(
      page.getByText("Diese Seite ist noch leer", { exact: true }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Zugriff", exact: true }).click();
    const accessForm = page.locator("form").filter({ hasText: moduleTitle });
    await accessForm.getByLabel("Freigabemodus").selectOption("delay_days");
    await accessForm.getByLabel("Freigabe nach Tagen").fill("5");
    await accessForm.getByLabel("Pflichtmodul").uncheck();
    await accessForm
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      page.getByText("Zugangseinstellungen gespeichert."),
    ).toBeVisible();

    await page
      .getByRole("tab", { name: "Informationen", exact: true })
      .click();
    const informationForm = page
      .locator("form")
      .filter({ hasText: "Kursinformationen" });
    await informationForm
      .getByLabel("Kurzbeschreibung")
      .fill("Aktualisierte Kurzbeschreibung aus dem E2E-Test.");
    await informationForm
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      page.getByText("Kursinformationen gespeichert."),
    ).toBeVisible();

    const [stored] = await client<
      {
        page_count: number;
        block_count: number;
        drip_days: number;
        is_required: boolean;
        short_description: string;
      }[]
    >`
      select
        (select count(*)::int from lesson_pages lp join lessons l on l.id = lp.lesson_id join course_modules cm on cm.module_id = l.module_id where cm.course_id = c.id) as page_count,
        (select count(*)::int from content_blocks cb join lessons l on l.id = cb.lesson_id join course_modules cm on cm.module_id = l.module_id where cm.course_id = c.id) as block_count,
        (select drip_days from course_modules where course_id = c.id limit 1) as drip_days,
        (select is_required from course_modules where course_id = c.id limit 1) as is_required,
        c.short_description
      from courses c
      where c.id = ${courseId}
    `;
    expect(stored).toMatchObject({
      page_count: 1,
      block_count: 0,
      drip_days: 5,
      is_required: false,
      short_description: "Aktualisierte Kurzbeschreibung aus dem E2E-Test.",
    });
  } finally {
    if (courseId) {
      const moduleRows = await client<{ id: string }[]>`
        select module_id as id from course_modules where course_id = ${courseId}
      `;
      for (const moduleRow of moduleRows) {
        await client`delete from activity_events where entity_id = ${moduleRow.id}`;
      }
      await client`delete from courses where id = ${courseId}`;
      for (const moduleRow of moduleRows) {
        await client`delete from modules where id = ${moduleRow.id}`;
      }
    }
    await client.end();
  }
});

test("course builder fits the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout assertion");
  const client = postgres(databaseUrl, { prepare: false });
  try {
    const [course] = await client<{ id: string }[]>`
      select id from courses where slug = 'ki-grundlagen' limit 1
    `;
    expect(course).toBeTruthy();
    await loginAsOwner(page);
    await page.goto(`/admin/courses/${course.id}`);
    await expect(page.getByText("Kursstruktur", { exact: true })).toBeVisible();
    const statisticsTab = page.getByRole("tab", {
      name: "Statistiken",
      exact: true,
    });
    await expect(statisticsTab).toBeVisible();
    const tabBounds = await statisticsTab.boundingBox();
    expect(tabBounds).not.toBeNull();
    expect(tabBounds!.x + tabBounds!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("course-builder-mobile.png"),
      fullPage: true,
    });
  } finally {
    await client.end();
  }
});
