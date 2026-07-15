import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("course changelog reviews safe diffs and resets after republishing", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const title = `Changelog Kurs ${suffix}`;
  const slug = `changelog-kurs-${suffix}`;
  const versionOneNote = `Erste Freigabe ${suffix}`;
  const versionTwoNote = `Struktur aktualisiert ${suffix}`;
  const privateAnswer = `PRIVATE_CHANGELOG_ANSWER_${suffix}`;
  let courseId = "";
  let moduleId = "";

  try {
    const [admin] = await client<
      Array<{ id: string; organization_id: string }>
    >`
      select id, organization_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    expect(admin).toBeTruthy();
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${admin.organization_id}, ${title}, ${slug},
        'Kompakter Testkurs fuer den Aenderungsnachweis.',
        'Dieser Kurs prueft einen sicheren und versionierten Aenderungsnachweis.',
        'draft', ${admin.id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, folder, is_reusable,
        estimated_minutes
      ) values (
        ${admin.organization_id}, ${`Grundlagen ${suffix}`},
        'Wiederverwendbares Changelog-Modul.', 'Qualitaet', true, 25
      )
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (${admin.organization_id}, ${courseId}, ${moduleId}, 0)
    `;
    const [section] = await client<Array<{ id: string }>>`
      insert into module_sections (
        organization_id, module_id, title, description, sort_order
      ) values (
        ${admin.organization_id}, ${moduleId}, 'Start',
        'Einstieg in den Kurs.', 0
      )
      returning id
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, summary,
        type, duration_minutes, sort_order
      ) values (
        ${admin.organization_id}, ${moduleId}, ${section.id},
        'Sicherer Einstieg', ${`sicherer-einstieg-${suffix}`},
        'Erste Zusammenfassung.', 'quiz', 12, 0
      )
      returning id
    `;
    const [lessonPage] = await client<Array<{ id: string }>>`
      insert into lesson_pages (lesson_id, title, slug, sort_order)
      values (${lesson.id}, 'Wissen pruefen', ${`wissen-pruefen-${suffix}`}, 0)
      returning id
    `;
    const [block] = await client<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, page_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, ${lessonPage.id}, 'multiple_choice',
        'Sicherheitsfrage', 0, true,
        ${client.json({
          options: ["Richtig", "Falsch"],
          correctOption: 0,
          feedback: "Interner Bewertungshinweis",
        })}
      )
      returning id
    `;

    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${courseId}`);
    await expect(page.getByTestId("course-change-marker")).toBeVisible();
    const reviewTrigger = page.getByRole("button", {
      name: /Aenderungen ansehen/,
    });
    await reviewTrigger.focus();
    await reviewTrigger.click();

    const dialog = page.getByRole("dialog", {
      name: "Versionen und Aenderungen",
    });
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Aenderungen ansehen" }),
    ).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("hidden");
    const backdrop = page.locator('button[aria-hidden="true"]');
    await expect(backdrop).toHaveAttribute("tabindex", "-1");
    await expect(dialog.getByText("Kursinformation", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Module", { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(reviewTrigger).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe("");

    await reviewTrigger.click();
    await dialog.getByLabel("Versionshinweis").fill(versionOneNote);
    await dialog
      .getByRole("button", { name: "Kurs veroeffentlichen" })
      .click();
    await expect
      .poll(async () => {
        const [row] = await client<
          Array<{ count: number; changelog: string }>
        >`
          select count(*)::int as count, max(changelog) as changelog
          from course_versions
          where course_id = ${courseId}
        `;
        return row;
      })
      .toEqual({ count: 1, changelog: versionOneNote });
    await expect(dialog.getByText("Keine offenen Aenderungen")).toBeVisible();
    await dialog.getByRole("button", { name: "Dialog schliessen" }).click();

    const directUpdate = page.getByRole("button", {
      name: /Kurs aktualisieren.*Aenderungen veroeffentlichen/,
    });
    await expect(directUpdate).toBeDisabled();
    await expect(page.getByTestId("course-change-marker")).toBeHidden();

    const noDiffResponse = await request.post(
      `/api/v1/courses/${courseId}/publish`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": `changelog-no-diff-${suffix}`,
        },
        data: { changelog: "Darf keine Version erzeugen" },
      },
    );
    expect(noDiffResponse.status()).toBe(409);

    await client`
      update courses
      set short_description = 'Aktualisierte Kurzbeschreibung.', updated_at = now()
      where id = ${courseId}
    `;
    await client`
      update modules
      set title = ${`Grundlagen aktualisiert ${suffix}`}, updated_at = now()
      where id = ${moduleId}
    `;
    await client`
      update course_modules
      set access_mode = 'delay_days', drip_days = 2
      where course_id = ${courseId} and module_id = ${moduleId}
    `;
    await client`
      update lessons
      set summary = 'Neue Zusammenfassung.', updated_at = now()
      where id = ${lesson.id}
    `;
    await client`
      update lesson_pages
      set title = 'Wissen sicher pruefen', updated_at = now()
      where id = ${lessonPage.id}
    `;
    await client`
      update content_blocks
      set data = ${client.json({
        options: ["Richtig", "Falsch"],
        correctOption: 1,
        acceptedAnswers: [privateAnswer],
      })}
      where id = ${block.id}
    `;

    await page.reload();
    await expect(page.getByTestId("course-change-marker")).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Inhalte enthaelt unveroeffentlichte Aenderungen",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Informationen enthaelt unveroeffentlichte Aenderungen",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("img", {
        name: "Zugriff enthaelt unveroeffentlichte Aenderungen",
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Aenderungen ansehen/ }).click();
    for (const group of [
      "Kursinformation",
      "Module",
      "Zugriff",
      "Lektionen",
      "Seiten",
      "Inhaltsbloecke",
    ]) {
      await expect(
        dialog.locator("summary").filter({ hasText: new RegExp(`^${group}`) }),
      ).toBeVisible();
    }
    expect(await dialog.innerText()).not.toContain(privateAnswer);
    expect(await dialog.innerText()).not.toContain("acceptedAnswers");
    expect(await dialog.innerText()).not.toContain("correctOption");

    await dialog.getByLabel("Versionshinweis").fill(versionTwoNote);
    await dialog
      .getByRole("button", { name: "Version veroeffentlichen" })
      .click();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ count: number }>>`
          select count(*)::int as count
          from course_versions
          where course_id = ${courseId}
        `;
        return row.count;
      })
      .toBe(2);
    await expect(dialog.getByText("Keine offenen Aenderungen")).toBeVisible();

    await page.getByRole("tab", { name: "Versionshistorie" }).click();
    const versionTwo = dialog.getByRole("listitem").filter({
      hasText: "Version 2",
    });
    const versionOne = dialog.getByRole("listitem").filter({
      hasText: "Version 1",
    });
    await expect(versionTwo).toContainText(versionTwoNote);
    await expect(versionTwo).toContainText("Aktuell");
    await expect(versionTwo).toContainText("Anna Berger");
    await expect(versionOne).toContainText(versionOneNote);
    await expect(versionOne).not.toContainText("Aktuell");

    if (testInfo.project.name === "mobile") {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("course-changelog-mobile.png"),
        fullPage: true,
      });
    }
  } finally {
    if (courseId) {
      await client`delete from courses where id = ${courseId}`.catch(
        () => undefined,
      );
    }
    if (moduleId) {
      await client`delete from modules where id = ${moduleId}`.catch(
        () => undefined,
      );
    }
    await client.end({ timeout: 5 });
  }
});
