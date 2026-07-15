import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCourseBuilderCopy } from "@/lib/i18n/course-builder";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const courseBuilderCopy = getCourseBuilderCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sourceSlug = "ki-grundlagen";
const targetSlug = "prompt-engineering-masterclass";
const seededLinkTitle = "Vertiefung: Prompt Engineering";
const screenshotDirectory = path.resolve(
  process.cwd(),
  "artifacts/playwright/course-links-outline",
);

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsDemoMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsMember(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page
    .getByRole("button", { name: "Bei Q-Academy anmelden" })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test.beforeAll(async () => {
  await mkdir(screenshotDirectory, { recursive: true });
});

test("admin creates a link module and persists its indentation", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The builder mutation lifecycle runs once on desktop Chromium.",
  );
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const sourceTitle = `Link-Outline E2E ${suffix}`;
  const linkTitle = `Weiterfuehrender Kurs ${suffix}`;
  let sourceCourseId = "";
  let baseModuleId = "";
  let linkModuleId = "";

  try {
    const [fixture] = await client<
      {
        organization_id: string;
        owner_id: string;
        target_id: string;
        target_title: string;
      }[]
    >`
      select owner.organization_id, owner.id as owner_id,
             target.id as target_id, target.title as target_title
      from users owner
      join courses target
        on target.organization_id = owner.organization_id
       and target.slug = ${targetSlug}
       and target.status = 'published'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();

    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${fixture.organization_id}, ${sourceTitle},
        ${`link-outline-e2e-${suffix}`},
        'Isolierter Kurs fuer den Link-und-Outline-Browsertest.',
        'Dieser Kurs prueft Link-Module und ihre Einrueckung im Kurseditor.',
        'draft', ${fixture.owner_id}
      )
      returning id
    `;
    sourceCourseId = course.id;
    const [baseModule] = await client<{ id: string }[]>`
      insert into modules (
        organization_id, title, description, estimated_minutes, kind
      ) values (
        ${fixture.organization_id}, 'Ausgangspunkt',
        'Erstes Modul als gueltiger Outline-Elternknoten.', 5, 'learning'
      )
      returning id
    `;
    baseModuleId = baseModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, indent_level,
        is_required
      ) values (
        ${fixture.organization_id}, ${sourceCourseId}, ${baseModuleId},
        0, 0, true
      )
    `;

    await loginAsOwner(page);
    await page.goto(`/admin/courses/${sourceCourseId}`);
    await expect(
      page.getByRole("heading", { name: sourceTitle }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Modul anlegen" });
    await dialog
      .getByRole("radio", { name: "Kurs-Link" })
      .check({ force: true });
    await expect(dialog.getByLabel("Zielkurs")).toBeVisible();
    await dialog
      .getByLabel("Zielkurs")
      .selectOption({ label: `${fixture.target_title} (Aktiv)` });
    await dialog.getByLabel("Linktitel").fill(linkTitle);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Ein direkter Verweis auf den bereits publizierten Zielkurs.");
    await dialog
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Modul im Kurs angelegt.", { exact: true }),
    ).toBeVisible();

    const [created] = await client<
      {
        id: string;
        linked_course_id: string;
        indent_level: number;
        is_required: boolean;
        lesson_count: number;
        section_count: number;
      }[]
    >`
      select module.id, module.linked_course_id, association.indent_level,
             association.is_required,
             (select count(*)::int from lessons where module_id = module.id) as lesson_count,
             (select count(*)::int from module_sections where module_id = module.id) as section_count
      from modules module
      join course_modules association on association.module_id = module.id
      where association.course_id = ${sourceCourseId}
        and module.title = ${linkTitle}
      limit 1
    `;
    linkModuleId = created.id;
    expect(created).toMatchObject({
      linked_course_id: fixture.target_id,
      indent_level: 0,
      is_required: false,
      lesson_count: 0,
      section_count: 0,
    });

    await page
      .getByRole("button", {
        name: `${linkTitle}: ${courseBuilderCopy.structure.indent}`,
      })
      .click();
    await expect(
      page.getByText("Kursstruktur gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<{ indent_level: number }[]>`
          select indent_level from course_modules
          where course_id = ${sourceCourseId} and module_id = ${linkModuleId}
        `;
        return row.indent_level;
      })
      .toBe(1);
    await expect(page.getByText("Ebene 1", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(screenshotDirectory, "admin-desktop.png"),
      fullPage: true,
    });
  } finally {
    if (sourceCourseId) {
      await client`
        delete from activity_events
        where entity_id in (
          ${sourceCourseId || null}, ${baseModuleId || null},
          ${linkModuleId || null}
        ) or metadata ->> 'courseId' = ${sourceCourseId}
      `;
      await client`delete from courses where id = ${sourceCourseId}`;
    }
    if (baseModuleId || linkModuleId) {
      await client`
        delete from modules
        where id in (${baseModuleId || null}, ${linkModuleId || null})
      `;
    }
    await client.end();
  }
});

test("authorized members follow the seeded course link", async ({
  page,
}, testInfo) => {
  await loginAsDemoMember(page);
  await page.goto(`/academy/courses/${sourceSlug}`);
  await expect(
    page.getByRole("heading", { name: "KI-Grundlagen" }),
  ).toBeVisible();
  const link = page
    .locator(`a[href="/academy/courses/${targetSlug}"]`)
    .filter({ hasText: seededLinkTitle });
  await expect(link).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `member-link-source-${testInfo.project.name}.png`,
    ),
    fullPage: true,
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/academy/courses/${targetSlug}$`));
  await expect(
    page.getByRole("heading", {
      name: "Prompt Engineering Masterclass",
      exact: true,
    }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(
      screenshotDirectory,
      `member-authorized-${testInfo.project.name}.png`,
    ),
    fullPage: true,
  });
});

test("members without target access receive no link metadata", async ({
  page,
}, testInfo) => {
  const client = postgres(databaseUrl, { prepare: false });
  try {
    const [target] = await client<
      { id: string; title: string; link_module_id: string }[]
    >`
      select target.id, target.title, module.id as link_module_id
      from courses source
      join course_modules association on association.course_id = source.id
      join modules module on module.id = association.module_id
      join courses target on target.id = module.linked_course_id
      where source.slug = ${sourceSlug} and module.kind = 'link'
      limit 1
    `;
    expect(target).toBeTruthy();

    await loginAsMember(page, "aylin@q-academy.de");
    await page.goto(`/academy/courses/${sourceSlug}`);
    await expect(
      page.getByRole("heading", { name: "KI-Grundlagen" }),
    ).toBeVisible();
    await expect(
      page.getByText(seededLinkTitle, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("3 Module", { exact: true })).toBeVisible();
    const html = await page.content();
    for (const secret of [
      target.id,
      target.link_module_id,
      seededLinkTitle,
    ]) {
      expect(html).not.toContain(secret);
    }
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: path.join(
        screenshotDirectory,
        `member-no-access-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  } finally {
    await client.end();
  }
});
