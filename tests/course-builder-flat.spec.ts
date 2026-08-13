import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

function moduleCard(page: import("@playwright/test").Page, title: string) {
  return page
    .getByText(title, { exact: true })
    .first()
    .locator("xpath=ancestor::section[1]");
}

async function expectLessonAccessLayout(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
) {
  await page.setViewportSize(viewport);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  const accessForm = page
    .locator("form")
    .filter({ has: page.locator('input[name="unlockAfterPrevious"]') });
  await expect(accessForm).toHaveCount(1);
  await expect(accessForm).toBeVisible();
  const editorPane = accessForm.locator("xpath=ancestor::section[1]");
  const formBox = await accessForm.boundingBox();
  const paneBox = await editorPane.boundingBox();
  expect(formBox).not.toBeNull();
  expect(paneBox).not.toBeNull();
  expect(formBox!.x).toBeGreaterThanOrEqual(paneBox!.x - 1);
  expect(formBox!.x + formBox!.width).toBeLessThanOrEqual(
    paneBox!.x + paneBox!.width + 1,
  );

  const overflow = await accessForm.evaluate((form) => ({
    horizontal: form.scrollWidth - form.clientWidth,
    paneHorizontal:
      form.closest("section")!.scrollWidth -
      form.closest("section")!.clientWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.paneHorizontal).toBeLessThanOrEqual(1);

  const gridItems = accessForm.locator(":scope > label, :scope > button");
  expect(await gridItems.count()).toBe(6);
  const boxes = await gridItems.evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        horizontalOverflow: item.scrollWidth - item.clientWidth,
      };
    }),
  );
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(paneBox!.x - 1);
    expect(box.right).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
    expect(box.horizontalOverflow).toBeLessThanOrEqual(1);
  }
  for (let left = 0; left < boxes.length; left += 1) {
    for (let right = left + 1; right < boxes.length; right += 1) {
      const overlapWidth =
        Math.min(boxes[left].right, boxes[right].right) -
        Math.max(boxes[left].left, boxes[right].left);
      const overlapHeight =
        Math.min(boxes[left].bottom, boxes[right].bottom) -
        Math.max(boxes[left].top, boxes[right].top);
      expect(overlapWidth > 1 && overlapHeight > 1).toBe(false);
    }
  }
}

test("flat course builder keeps module selection local and persists lesson order", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused flat-builder coverage runs once on desktop Chromium.",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const courseTitle = `Flat Builder E2E ${suffix}`;
  const firstModuleTitle = `Grundlagen ${suffix}`;
  const emptyModuleTitle = `Leeres Modul ${suffix}`;
  const secondModuleTitle = `Vertiefung ${suffix}`;
  const linkModuleTitle = `Kurslink ${suffix}`;
  const firstLessonTitle = `Lektion Alpha ${suffix}`;
  const secondLessonTitle = `Lektion Beta ${suffix}`;
  const thirdLessonTitle = `Lektion Gamma ${suffix}`;
  const foreignLessonTitle = `Lektion Delta ${suffix}`;
  let courseId = "";
  const moduleIds: string[] = [];
  const lessonIds: string[] = [];

  try {
    const [fixture] = await client<
      { owner_id: string; organization_id: string; target_course_id: string }[]
    >`
      select owner.id as owner_id, owner.organization_id,
             target.id as target_course_id
      from users owner
      join lateral (
        select id
        from courses
        where organization_id = owner.organization_id
          and status = 'published'
        order by created_at, id
        limit 1
      ) target on true
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();

    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${fixture.organization_id}, ${courseTitle},
        ${`flat-builder-e2e-${suffix}`},
        'Isolierter Kurs fuer den flachen Kurseditor.',
        'Prueft Auswahl, Reihenfolge und responsive Zugriffseinstellungen.',
        'draft', ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;

    const createdModules = await client<{ id: string; title: string }[]>`
      insert into modules (
        organization_id, title, description, estimated_minutes, kind,
        linked_course_id
      ) values
        (
          ${fixture.organization_id}, ${firstModuleTitle},
          'Lernmodul mit drei sortierbaren Lektionen.', 30, 'learning', null
        ),
        (
          ${fixture.organization_id}, ${emptyModuleTitle},
          'Lernmodul ohne Lektionen.', 5, 'learning', null
        ),
        (
          ${fixture.organization_id}, ${secondModuleTitle},
          'Lernmodul mit einer eigenen Lektion.', 10, 'learning', null
        ),
        (
          ${fixture.organization_id}, ${linkModuleTitle},
          'Linkmodul ohne eigene Lektionen.', 0, 'link',
          ${fixture.target_course_id}
        )
      returning id, title
    `;
    const createdModuleId = (title: string) => {
      const id = createdModules.find((module) => module.title === title)?.id;
      expect(id).toBeTruthy();
      return id!;
    };
    const firstModuleId = createdModuleId(firstModuleTitle);
    const emptyModuleId = createdModuleId(emptyModuleTitle);
    const secondModuleId = createdModuleId(secondModuleTitle);
    const linkModuleId = createdModuleId(linkModuleTitle);
    moduleIds.push(firstModuleId, emptyModuleId, secondModuleId, linkModuleId);

    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, indent_level,
        is_required
      ) values
        (${fixture.organization_id}, ${courseId}, ${firstModuleId}, 0, 0, true),
        (${fixture.organization_id}, ${courseId}, ${emptyModuleId}, 1, 0, true),
        (${fixture.organization_id}, ${courseId}, ${secondModuleId}, 2, 0, true),
        (${fixture.organization_id}, ${courseId}, ${linkModuleId}, 3, 0, false)
    `;

    const createdLessons = await client<
      { id: string; title: string; sort_order: number }[]
    >`
      insert into lessons (
        organization_id, module_id, title, slug, summary, duration_minutes,
        sort_order, status, visibility
      ) values
        (
          ${fixture.organization_id}, ${firstModuleId}, ${firstLessonTitle},
          ${`alpha-${suffix}`}, 'Erste Lektion.', 5, 0, 'published', 'visible'
        ),
        (
          ${fixture.organization_id}, ${firstModuleId}, ${secondLessonTitle},
          ${`beta-${suffix}`}, 'Zweite Lektion.', 5, 1, 'published', 'visible'
        ),
        (
          ${fixture.organization_id}, ${firstModuleId}, ${thirdLessonTitle},
          ${`gamma-${suffix}`}, 'Dritte Lektion.', 5, 2, 'published', 'visible'
        ),
        (
          ${fixture.organization_id}, ${secondModuleId}, ${foreignLessonTitle},
          ${`delta-${suffix}`}, 'Lektion des zweiten Moduls.', 5, 0,
          'published', 'visible'
        )
      returning id, title, sort_order
    `;
    lessonIds.push(...createdLessons.map((lesson) => lesson.id));

    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsOwner(page);
    await page.goto(`/admin/courses/${courseId}`);
    await expect(
      page.getByRole("heading", { name: courseTitle, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: firstLessonTitle, exact: true }),
    ).toBeVisible();

    await moduleCard(page, emptyModuleTitle)
      .getByRole("button")
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: firstLessonTitle, exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("paragraph").filter({
        hasText: /^Waehle eine Lektion aus$/,
      }),
    ).toBeVisible();

    await moduleCard(page, secondModuleTitle)
      .getByRole("button")
      .first()
      .click();
    await expect(
      page.getByRole("heading", { name: foreignLessonTitle, exact: true }),
    ).toBeVisible();

    await moduleCard(page, linkModuleTitle).getByRole("button").first().click();
    await expect(
      page.getByRole("heading", { name: foreignLessonTitle, exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Linktitel")).toHaveValue(linkModuleTitle);

    const firstModule = moduleCard(page, firstModuleTitle);
    await firstModule.getByRole("button").first().click();
    await expect(
      page.getByRole("heading", { name: firstLessonTitle, exact: true }),
    ).toBeVisible();

    await expect(
      firstModule.getByRole("button", {
        name: `${firstLessonTitle}: Nach oben`,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      firstModule.getByRole("button", {
        name: `${thirdLessonTitle}: Nach unten`,
        exact: true,
      }),
    ).toBeDisabled();
    await expect(
      firstModule.getByRole("button", {
        name: `${secondLessonTitle}: Nach oben`,
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      firstModule.getByRole("button", {
        name: `${secondLessonTitle}: Nach unten`,
        exact: true,
      }),
    ).toBeEnabled();

    await firstModule
      .getByRole("button", {
        name: `${secondLessonTitle}: Nach unten`,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const rows = await client<{ title: string }[]>`
          select title
          from lessons
          where module_id = ${firstModuleId}
          order by sort_order, id
        `;
        return rows.map((row) => row.title);
      })
      .toEqual([firstLessonTitle, thirdLessonTitle, secondLessonTitle]);
    await expect(
      firstModule.getByRole("button", {
        name: `2. ${thirdLessonTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstModule.getByRole("button", {
        name: `3. ${secondLessonTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstModule.getByRole("button", {
        name: `${secondLessonTitle}: Nach unten`,
        exact: true,
      }),
    ).toBeDisabled();

    await firstModule
      .getByRole("button", {
        name: `${secondLessonTitle}: Nach oben`,
        exact: true,
      })
      .click();
    await expect
      .poll(async () => {
        const rows = await client<{ title: string }[]>`
          select title
          from lessons
          where module_id = ${firstModuleId}
          order by sort_order, id
        `;
        return rows.map((row) => row.title);
      })
      .toEqual([firstLessonTitle, secondLessonTitle, thirdLessonTitle]);
    await expect(
      firstModule.getByRole("button", {
        name: `2. ${secondLessonTitle}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      firstModule.getByRole("button", {
        name: `3. ${thirdLessonTitle}`,
        exact: true,
      }),
    ).toBeVisible();

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
    ]) {
      await expectLessonAccessLayout(page, viewport);
      await page.screenshot({
        path: testInfo.outputPath(
          `flat-builder-access-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: false,
      });
    }
  } finally {
    if (courseId) {
      await client`
        delete from activity_events
        where metadata ->> 'courseId' = ${courseId}
      `;
    }
    for (const lessonId of lessonIds) {
      await client`delete from activity_events where entity_id = ${lessonId}`;
    }
    for (const moduleId of moduleIds) {
      await client`delete from activity_events where entity_id = ${moduleId}`;
    }
    if (courseId) {
      await client`delete from courses where id = ${courseId}`;
    }
    for (const moduleId of moduleIds) {
      await client`delete from modules where id = ${moduleId}`;
    }
    await client.end();
  }
});
