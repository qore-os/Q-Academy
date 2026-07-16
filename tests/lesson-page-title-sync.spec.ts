import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${apiKey}` };

function mutationHeaders(key: string) {
  return { ...authorization, "Idempotency-Key": key };
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("title sync API is tenant-safe, idempotent and concurrency-safe", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API lifecycle runs once.");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const requestIds: string[] = [];
  let organizationId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let examModuleId = "";
  let cloneId = "";
  let foreignOrganizationId = "";

  try {
    const [admin] = await client<
      Array<{ id: string; organization_id: string; password_hash: string }>
    >`
      select id, organization_id, password_hash
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    organizationId = admin.organization_id;
    const pageRevision = async (pageId: string) => {
      const [page] = await client<Array<{ revision: number }>>`
        select revision from lesson_pages where id = ${pageId}
      `;
      if (!page) throw new Error(`Page revision missing: ${pageId}`);
      return page.revision;
    };
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${organizationId}, ${`Sync API ${suffix}`}, ${`sync-api-${suffix}`},
        'API-Test fuer atomare Titelkopplung.',
        'API-Test fuer atomare Titelkopplung und Tenant-Sicherheit.',
        'draft', ${admin.id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (organization_id, title, is_reusable)
      values (${organizationId}, ${`Sync Modul ${suffix}`}, true)
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (organization_id, course_id, module_id)
      values (${organizationId}, ${courseId}, ${moduleId})
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary
      ) values (
        ${organizationId}, ${moduleId}, ${`Lektion ${suffix}`},
        ${`lektion-${suffix}`}, 'Titel-Sync API'
      ) returning id
    `;
    lessonId = lesson.id;

    const firstCreate = await request.post(`/api/v1/lessons/${lessonId}/pages`, {
      headers: mutationHeaders(`sync-first-${suffix}`),
      data: { title: "Abweichender API-Seitentitel" },
    });
    requestIds.push(firstCreate.headers()["x-request-id"]);
    expect(firstCreate.status()).toBe(201);
    const firstPage = (await firstCreate.json()).data as {
      id: string;
      title: string;
      titleSyncedWithLesson: boolean;
      sortOrder: number;
    };
    expect(firstPage).toMatchObject({
      title: `Lektion ${suffix}`,
      titleSyncedWithLesson: true,
      sortOrder: 0,
    });

    const sharedTitle = `Gemeinsamer Titel ${suffix}`;
    const linkedRenameKey = `sync-linked-rename-${suffix}`;
    const linkedRenameInput = {
      revision: await pageRevision(firstPage.id),
      title: sharedTitle,
    };
    const linkedRename = await request.patch(`/api/v1/pages/${firstPage.id}`, {
      headers: mutationHeaders(linkedRenameKey),
      data: linkedRenameInput,
    });
    requestIds.push(linkedRename.headers()["x-request-id"]);
    expect(linkedRename.status()).toBe(200);
    const linkedReplay = await request.patch(`/api/v1/pages/${firstPage.id}`, {
      headers: mutationHeaders(linkedRenameKey),
      data: linkedRenameInput,
    });
    expect(linkedReplay.status()).toBe(200);
    expect(linkedReplay.headers()["idempotent-replayed"]).toBe("true");
    const [afterPageRename] = await client<
      Array<{ lesson_title: string; page_title: string }>
    >`
      select l.title as lesson_title, p.title as page_title
      from lessons l join lesson_pages p on p.lesson_id = l.id
      where p.id = ${firstPage.id}
    `;
    expect(afterPageRename).toEqual({
      lesson_title: sharedTitle,
      page_title: sharedTitle,
    });

    const lessonRename = `Von der Lektion ${suffix}`;
    const lessonPatch = await request.patch(`/api/v1/lessons/${lessonId}`, {
      headers: mutationHeaders(`sync-lesson-rename-${suffix}`),
      data: { title: lessonRename },
    });
    requestIds.push(lessonPatch.headers()["x-request-id"]);
    expect(lessonPatch.status()).toBe(200);
    const [afterLessonRename] = await client<
      Array<{ lesson_title: string; page_title: string }>
    >`
      select l.title as lesson_title, p.title as page_title
      from lessons l join lesson_pages p on p.lesson_id = l.id
      where p.id = ${firstPage.id}
    `;
    expect(afterLessonRename.lesson_title).toBe(lessonRename);
    expect(afterLessonRename.page_title).toBe(lessonRename);

    const unlink = await request.patch(`/api/v1/pages/${firstPage.id}`, {
      headers: mutationHeaders(`sync-unlink-${suffix}`),
      data: {
        revision: await pageRevision(firstPage.id),
        titleSyncedWithLesson: false,
      },
    });
    requestIds.push(unlink.headers()["x-request-id"]);
    expect(unlink.status()).toBe(200);
    const independentTitle = `Eigene Seite ${suffix}`;
    const independentRename = await request.patch(
      `/api/v1/pages/${firstPage.id}`,
      {
        headers: mutationHeaders(`sync-independent-${suffix}`),
        data: {
          revision: await pageRevision(firstPage.id),
          title: independentTitle,
        },
      },
    );
    requestIds.push(independentRename.headers()["x-request-id"]);
    expect(independentRename.status()).toBe(200);
    const [independent] = await client<
      Array<{ lesson_title: string; page_title: string; synced: boolean }>
    >`
      select l.title as lesson_title, p.title as page_title,
             p.title_synced_with_lesson as synced
      from lessons l join lesson_pages p on p.lesson_id = l.id
      where p.id = ${firstPage.id}
    `;
    expect(independent).toEqual({
      lesson_title: lessonRename,
      page_title: independentTitle,
      synced: false,
    });

    const restore = await request.patch(`/api/v1/pages/${firstPage.id}`, {
      headers: mutationHeaders(`sync-restore-${suffix}`),
      data: {
        revision: await pageRevision(firstPage.id),
        titleSyncedWithLesson: true,
      },
    });
    requestIds.push(restore.headers()["x-request-id"]);
    expect(restore.status()).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({
      data: { title: lessonRename, titleSyncedWithLesson: true },
    });

    const secondCreate = await request.post(
      `/api/v1/lessons/${lessonId}/pages`,
      {
        headers: mutationHeaders(`sync-second-${suffix}`),
        data: { title: `Zweite Seite ${suffix}` },
      },
    );
    requestIds.push(secondCreate.headers()["x-request-id"]);
    expect(secondCreate.status()).toBe(201);
    const secondPage = (await secondCreate.json()).data as {
      id: string;
      titleSyncedWithLesson: boolean;
      sortOrder: number;
    };
    expect(secondPage.titleSyncedWithLesson).toBe(false);
    expect(secondPage.sortOrder).toBe(1);
    const invalidSecondLink = await request.patch(
      `/api/v1/pages/${secondPage.id}`,
      {
        headers: mutationHeaders(`sync-invalid-second-${suffix}`),
        data: {
          revision: await pageRevision(secondPage.id),
          titleSyncedWithLesson: true,
        },
      },
    );
    requestIds.push(invalidSecondLink.headers()["x-request-id"]);
    expect(invalidSecondLink.status()).toBe(422);

    const moveLinkedAway = await request.patch(
      `/api/v1/pages/${firstPage.id}`,
      {
        headers: mutationHeaders(`sync-reorder-${suffix}`),
        data: {
          revision: await pageRevision(firstPage.id),
          sortOrder: 5,
        },
      },
    );
    requestIds.push(moveLinkedAway.headers()["x-request-id"]);
    expect(moveLinkedAway.status()).toBe(200);
    await expect(moveLinkedAway.json()).resolves.toMatchObject({
      data: { titleSyncedWithLesson: false },
    });
    const linkNewFirst = await request.patch(`/api/v1/pages/${secondPage.id}`, {
      headers: mutationHeaders(`sync-new-first-${suffix}`),
      data: {
        revision: await pageRevision(secondPage.id),
        titleSyncedWithLesson: true,
      },
    });
    requestIds.push(linkNewFirst.headers()["x-request-id"]);
    expect(linkNewFirst.status()).toBe(200);

    const cloneResponse = await request.post(`/api/v1/courses/${courseId}/clone`, {
      headers: mutationHeaders(`sync-clone-${suffix}`),
      data: { title: `Sync Clone ${suffix}` },
    });
    requestIds.push(cloneResponse.headers()["x-request-id"]);
    expect(cloneResponse.status()).toBe(201);
    cloneId = ((await cloneResponse.json()).data as { id: string }).id;
    const [cloneInvariant] = await client<
      Array<{ linked: number; first_linked: boolean }>
    >`
      with clone_pages as (
        select p.*, row_number() over (
          partition by p.lesson_id order by p.sort_order, p.id
        ) as position
        from course_modules cm
        join lessons l on l.module_id = cm.module_id
        join lesson_pages p on p.lesson_id = l.id
        where cm.course_id = ${cloneId}
      )
      select
        count(*) filter (where title_synced_with_lesson)::int as linked,
        bool_and(not title_synced_with_lesson or position = 1) as first_linked
      from clone_pages
    `;
    expect(cloneInvariant).toEqual({ linked: 1, first_linked: true });

    const deleteLinked = await request.delete(
      `/api/v1/pages/${secondPage.id}`,
      {
        headers: {
          ...mutationHeaders(`sync-delete-${suffix}`),
          "If-Match": String(await pageRevision(secondPage.id)),
        },
      },
    );
    requestIds.push(deleteLinked.headers()["x-request-id"]);
    expect(deleteLinked.status()).toBe(200);
    const [afterDelete] = await client<Array<{ linked: number }>>`
      select count(*) filter (where title_synced_with_lesson)::int as linked
      from lesson_pages where lesson_id = ${lessonId}
    `;
    expect(afterDelete.linked).toBe(0);

    const [concurrentLesson] = await client<Array<{ id: string }>>`
      insert into lessons (organization_id, module_id, title, slug)
      values (
        ${organizationId}, ${moduleId}, ${`Parallel ${suffix}`},
        ${`parallel-${suffix}`}
      ) returning id
    `;
    const concurrentCreates = await Promise.all([
      request.post(`/api/v1/lessons/${concurrentLesson.id}/pages`, {
        headers: mutationHeaders(`sync-race-a-${suffix}`),
        data: { title: "Parallel A" },
      }),
      request.post(`/api/v1/lessons/${concurrentLesson.id}/pages`, {
        headers: mutationHeaders(`sync-race-b-${suffix}`),
        data: { title: "Parallel B" },
      }),
    ]);
    for (const response of concurrentCreates) {
      requestIds.push(response.headers()["x-request-id"]);
      expect(response.status()).toBe(201);
    }
    const [raceInvariant] = await client<
      Array<{ pages: number; linked: number; linked_is_first: boolean }>
    >`
      with ordered as (
        select *, row_number() over (order by sort_order, id) as position
        from lesson_pages where lesson_id = ${concurrentLesson.id}
      )
      select count(*)::int as pages,
        count(*) filter (where title_synced_with_lesson)::int as linked,
        bool_and(not title_synced_with_lesson or position = 1)
          as linked_is_first
      from ordered
    `;
    expect(raceInvariant).toEqual({
      pages: 2,
      linked: 1,
      linked_is_first: true,
    });

    const [examModule] = await client<Array<{ id: string }>>`
      insert into modules (organization_id, title, kind)
      values (${organizationId}, ${`Exam Sync ${suffix}`}, 'learning')
      returning id
    `;
    examModuleId = examModule.id;
    const [examLesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, type
      ) values (
        ${organizationId}, ${examModuleId}, ${`Exam Lektion ${suffix}`},
        ${`exam-lesson-${suffix}`}, 'exam'
      ) returning id
    `;
    const [examPage] = await client<Array<{ id: string }>>`
      insert into lesson_pages (
        lesson_id, title, title_synced_with_lesson, slug
      ) values (
        ${examLesson.id}, ${`Exam Lektion ${suffix}`}, true,
        ${`exam-page-${suffix}`}
      ) returning id
    `;
    await client`
      update modules set kind = 'exam' where id = ${examModuleId}
    `;
    const examTitle = `Exam Parallel ${suffix}`;
    const examPageRevision = await pageRevision(examPage.id);
    const [examPagePatch, examLessonPatch] = await Promise.all([
      request.patch(`/api/v1/pages/${examPage.id}`, {
        headers: mutationHeaders(`sync-exam-page-${suffix}`),
        data: { revision: examPageRevision, title: examTitle },
      }),
      request.patch(`/api/v1/lessons/${examLesson.id}`, {
        headers: mutationHeaders(`sync-exam-lesson-${suffix}`),
        data: { summary: "Parallel aktualisierte Pruefungsbeschreibung." },
      }),
    ]);
    requestIds.push(
      examPagePatch.headers()["x-request-id"],
      examLessonPatch.headers()["x-request-id"],
    );
    expect(examPagePatch.status()).toBe(200);
    expect(examLessonPatch.status()).toBe(200);
    const [examAfter] = await client<
      Array<{ lesson_title: string; page_title: string; kind: string }>
    >`
      select l.title as lesson_title, p.title as page_title, m.kind::text as kind
      from modules m
      join lessons l on l.module_id = m.id
      join lesson_pages p on p.lesson_id = l.id
      where m.id = ${examModuleId}
    `;
    expect(examAfter).toEqual({
      lesson_title: examTitle,
      page_title: examTitle,
      kind: "exam",
    });

    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign Sync ${suffix}`}, ${`foreign-sync-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignModule] = await client<Array<{ id: string }>>`
      insert into modules (organization_id, title)
      values (${foreignOrganizationId}, 'Foreign module') returning id
    `;
    const [foreignLesson] = await client<Array<{ id: string }>>`
      insert into lessons (organization_id, module_id, title, slug)
      values (${foreignOrganizationId}, ${foreignModule.id}, 'Foreign lesson', 'foreign-lesson')
      returning id
    `;
    const [foreignPage] = await client<Array<{ id: string }>>`
      insert into lesson_pages (lesson_id, title, slug)
      values (${foreignLesson.id}, 'Foreign page', 'foreign-page') returning id
    `;
    const foreignPatch = await request.patch(`/api/v1/pages/${foreignPage.id}`, {
      headers: mutationHeaders(`sync-foreign-${suffix}`),
      data: {
        revision: await pageRevision(foreignPage.id),
        title: "Cross tenant",
      },
    });
    requestIds.push(foreignPatch.headers()["x-request-id"]);
    expect(foreignPatch.status()).toBe(404);
    const [foreignAfter] = await client<Array<{ title: string }>>`
      select title from lesson_pages where id = ${foreignPage.id}
    `;
    expect(foreignAfter.title).toBe("Foreign page");

    const [evidence] = await client<
      Array<{ audits: number; activities: number }>
    >`
      select
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds}::uuid[])) as audits,
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and type in (
              'lesson.page.created', 'lesson.page.updated',
              'lesson.page.deleted', 'lesson.updated'
            )) as activities
    `;
    expect(evidence.audits).toBe(requestIds.length);
    expect(evidence.activities).toBeGreaterThanOrEqual(10);
  } finally {
    if (cloneId) {
      const cloneModules = await client<Array<{ module_id: string }>>`
        select module_id from course_modules where course_id = ${cloneId}
      `.catch(() => []);
      await client`delete from courses where id = ${cloneId}`.catch(
        () => undefined,
      );
      for (const row of cloneModules) {
        await client`delete from modules where id = ${row.module_id}`.catch(
          () => undefined,
        );
      }
    }
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
    if (examModuleId) {
      await client`delete from modules where id = ${examModuleId}`.catch(
        () => undefined,
      );
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`.catch(
        () => undefined,
      );
    }
    await client.end({ timeout: 5 });
  }
});

test("admin toggles bidirectional lesson and page title sync", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const lessonTitle = `UI Lektion ${suffix}`;
  let courseId = "";
  let moduleId = "";

  try {
    const [admin] = await client<Array<{ id: string; organization_id: string }>>`
      select id, organization_id from users
      where email = 'admin@q-academy.de' limit 1
    `;
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${admin.organization_id}, ${`Sync UI ${suffix}`}, ${`sync-ui-${suffix}`},
        'UI-Test fuer gekoppelte Titel.',
        'UI-Test fuer gekoppelte Lektions- und Seitentitel.',
        'draft', ${admin.id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (organization_id, title)
      values (${admin.organization_id}, ${`UI Modul ${suffix}`}) returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (organization_id, course_id, module_id)
      values (${admin.organization_id}, ${courseId}, ${moduleId})
    `;
    await client`
      insert into lessons (organization_id, module_id, title, slug)
      values (
        ${admin.organization_id}, ${moduleId}, ${lessonTitle},
        ${`ui-lesson-${suffix}`}
      )
    `;

    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("button", { name: "Seite", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Lektionsseite anlegen" });
    await expect(dialog.getByLabel("Seitentitel")).toHaveValue(lessonTitle);
    await expect(
      dialog.getByLabel("Mit Lektionstitel synchronisieren"),
    ).toBeChecked();
    await dialog.getByRole("button", { name: "Lektionsseite anlegen" }).click();
    await expect(dialog).toBeHidden();

    let pageTitleInput = page.getByLabel("Seitentitel");
    await expect(pageTitleInput).toHaveValue(lessonTitle);
    let unlinkButton = page.getByRole("button", {
      name: "Titelsynchronisierung aufheben",
    });
    await expect(unlinkButton).toHaveAttribute("aria-pressed", "true");

    let lessonTitleInput = page.getByRole("textbox", {
      name: "Lektionstitel",
      exact: true,
    });
    const lessonTitleForm = lessonTitleInput.locator("xpath=ancestor::form");
    const renamedFromLesson = `Von Lektion ${suffix}`;
    await lessonTitleInput.fill(renamedFromLesson);
    await lessonTitleForm.getByRole("button", { name: "Speichern" }).click();
    await expect(pageTitleInput).toHaveValue(renamedFromLesson);

    pageTitleInput = page.getByLabel("Seitentitel");
    const pageTitleForm = pageTitleInput.locator("xpath=ancestor::form");
    const renamedFromPage = `Von Seite ${suffix}`;
    await pageTitleInput.fill(renamedFromPage);
    await pageTitleForm.getByRole("button", { name: "Speichern" }).click();
    lessonTitleInput = page.getByRole("textbox", {
      name: "Lektionstitel",
      exact: true,
    });
    await expect(lessonTitleInput).toHaveValue(renamedFromPage);

    unlinkButton = page.getByRole("button", {
      name: "Titelsynchronisierung aufheben",
    });
    await unlinkButton.click();
    const linkButton = page.getByRole("button", {
      name: "Mit Lektionstitel synchronisieren",
    });
    await expect(linkButton).toHaveAttribute("aria-pressed", "false");
    pageTitleInput = page.getByLabel("Seitentitel");
    const independentPageTitle = `Unabhaengig ${suffix}`;
    await pageTitleInput.fill(independentPageTitle);
    await pageTitleInput
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Speichern" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Lektionstitel", exact: true }),
    ).toHaveValue(renamedFromPage);
    await linkButton.click();
    await expect(page.getByLabel("Seitentitel")).toHaveValue(renamedFromPage);

    await page.getByRole("button", { name: "Seite", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Lektionsseite anlegen" });
    await expect(
      dialog.getByLabel("Mit Lektionstitel synchronisieren"),
    ).toHaveCount(0);
    await dialog.getByLabel("Seitentitel").fill(`Zweite UI Seite ${suffix}`);
    await dialog.getByRole("button", { name: "Lektionsseite anlegen" }).click();
    await expect(dialog).toBeHidden();
    const unavailableLink = page.getByRole("button", {
      name: "Nur die erste Seite kann synchronisiert werden",
    });
    await expect(unavailableLink).toBeDisabled();

    await page.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ status: string }>>`
          select status from courses where id = ${courseId}
        `;
        return row.status;
      })
      .toBe("published");
    await page.getByRole("button", { name: new RegExp(`1\\. ${renamedFromPage}`) }).click();
    lessonTitleInput = page.getByRole("textbox", {
      name: "Lektionstitel",
      exact: true,
    });
    const finalTitle = `Nach Publish ${suffix}`;
    await lessonTitleInput.fill(finalTitle);
    await lessonTitleInput
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "Speichern" })
      .click();
    await page.getByRole("button", { name: /Änderungen ansehen/ }).click();
    const changelog = page.getByRole("dialog", {
      name: "Versionen und Änderungen",
    });
    await expect(
      changelog.locator("summary").filter({ hasText: /^Lektionen/ }),
    ).toBeVisible();
    await expect(
      changelog.locator("summary").filter({ hasText: /^Seiten/ }),
    ).toBeVisible();

    if (testInfo.project.name === "mobile") {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("lesson-page-title-sync-mobile.png"),
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
