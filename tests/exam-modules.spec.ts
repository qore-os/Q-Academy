import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${apiKey}` };

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name:
        role === "admin"
          ? /Admin-Demo|Als Admin testen/
          : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

function mutationHeaders(key: string) {
  return { ...authorization, "Idempotency-Key": key };
}

async function expectStatus(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  status: number,
  requestIds: string[],
) {
  requestIds.push(response.headers()["x-request-id"]);
  expect(response.status()).toBe(status);
}

test("exam modules are atomic, publishable, tenant-safe and usable without answer-key leaks", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const prefix = `exam-module-${suffix}`;
  const courseSlug = `exam-module-${suffix}`;
  const courseTitle = `Pruefungskurs ${suffix}`;
  const moduleTitle = `Abschlusspruefung ${suffix}`;
  const correctOption = `Freigegebene Antwort ${suffix}`;
  const wrongOption = `Falsche Antwort ${suffix}`;
  const secretFeedback = `SECRET_EXAM_FEEDBACK_${suffix}`;
  const requestIds: string[] = [];
  let organizationId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let pageId = "";
  let questionId = "";
  let memberId = "";
  let foreignOrganizationId = "";
  let foreignModuleId = "";
  let memberContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
      Array<{ organization_id: string; owner_id: string; member_id: string }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        member.id as member_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    memberId = fixture.member_id;
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, estimated_minutes, certificate_enabled, created_by_id
      ) values (
        ${fixture.organization_id}, ${courseTitle}, ${courseSlug},
        'Eigenstaendiges Pruefungsmodul fuer den E2E-Nachweis.',
        'Der Kurs prueft Erstellung, Publikation, Versuche und Tenant-Isolation.',
        'draft', 35, false, ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;

    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);
    await page
      .getByRole("button", { name: "Modul anlegen", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Modul anlegen" });
    const examKind = dialog.getByRole("radio", {
      name: "Pruefung",
      exact: true,
    });
    await examKind.check({ force: true });
    await expect(examKind).toBeChecked();
    await dialog.getByLabel("Modultitel").fill(moduleTitle);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Automatische Fragen und eine gepruefte Transferabgabe.");
    await dialog
      .getByRole("textbox", { name: "Ordner", exact: true })
      .fill("Pruefungen");
    await dialog
      .getByRole("spinbutton", { name: "Dauer (Minuten)", exact: true })
      .fill("35");
    await dialog.getByRole("button", { name: "Modul anlegen" }).click();
    await expect(
      page.getByText("Modul im Kurs angelegt.", { exact: true }),
    ).toBeVisible();

    const [shape] = await client<
      Array<{
        module_id: string;
        lesson_id: string;
        page_id: string;
        kind: string;
        lesson_type: string;
        title_synced: boolean;
        page_revision: number;
        lesson_count: number;
      }>
    >`
      select
        m.id as module_id,
        l.id as lesson_id,
        p.id as page_id,
        m.kind,
        l.type as lesson_type,
        p.title_synced_with_lesson as title_synced,
        p.revision as page_revision,
        (select count(*)::int from lessons where module_id = m.id) as lesson_count
      from modules m
      join lessons l on l.module_id = m.id
      join lesson_pages p on p.lesson_id = l.id
      where m.organization_id = ${fixture.organization_id}
        and m.title = ${moduleTitle}
      limit 1
    `;
    expect(shape).toMatchObject({
      kind: "exam",
      lesson_type: "exam",
      title_synced: true,
      lesson_count: 1,
    });
    moduleId = shape.module_id;
    lessonId = shape.lesson_id;
    pageId = shape.page_id;

    await expect(
      page.getByText("Pruefungsbausteine", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Multiple Choice" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Abgabe" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Vorschau", exact: true }),
    ).toHaveAttribute(
      "href",
      new RegExp(`/admin/courses/${courseId}/preview\\?lesson=${lessonId}`),
    );

    const invalidPublish = await request.post(
      `/api/v1/courses/${courseId}/publish`,
      {
        headers: mutationHeaders(`${prefix}-invalid-publish`),
        data: { changelog: "Noch ohne Pruefungsaufgabe" },
      },
    );
    await expectStatus(invalidPublish, 422, requestIds);
    expect(await invalidPublish.json()).toMatchObject({
      code: "validation_error",
    });

    const secondLesson = await request.post(
      `/api/v1/modules/${moduleId}/lessons`,
      {
        headers: mutationHeaders(`${prefix}-lesson`),
        data: { title: "Zweite Pruefung", type: "exam" },
      },
    );
    await expectStatus(secondLesson, 409, requestIds);
    const typeChange = await request.patch(`/api/v1/lessons/${lessonId}`, {
      headers: mutationHeaders(`${prefix}-type-change`),
      data: { type: "lesson" },
    });
    requestIds.push(typeChange.headers()["x-request-id"]);
    expect(typeChange.status()).toBe(409);
    const lastPageDelete = await request.delete(`/api/v1/pages/${pageId}`, {
      headers: {
        ...mutationHeaders(`${prefix}-page-delete`),
        "If-Match": `"${shape.page_revision}"`,
      },
    });
    requestIds.push(lastPageDelete.headers()["x-request-id"]);
    expect(lastPageDelete.status()).toBe(409);

    const questionResponse = await request.post(
      `/api/v1/pages/${pageId}/blocks`,
      {
        headers: mutationHeaders(`${prefix}-question`),
        data: {
          type: "multiple_choice",
          title: "Sicherer KI-Einsatz",
          sortOrder: 0,
          required: true,
          data: {
            prompt: "Welche Antwort beschreibt den sicheren Einsatz?",
            options: [correctOption, wrongOption],
            correctOption: 0,
            feedback: secretFeedback,
          },
        },
      },
    );
    await expectStatus(questionResponse, 201, requestIds);
    const questionPayload = await questionResponse.json();
    questionId = questionPayload.data.id;
    expect(JSON.stringify(questionPayload)).not.toContain("correctOption");
    expect(JSON.stringify(questionPayload)).not.toContain(secretFeedback);

    const submissionResponse = await request.post(
      `/api/v1/pages/${pageId}/blocks`,
      {
        headers: mutationHeaders(`${prefix}-submission`),
        data: {
          type: "submission",
          title: "Transferanalyse",
          sortOrder: 1,
          required: true,
          data: {
            prompt:
              "Reiche Risiken, Kontrollen und deine Freigabeentscheidung ein.",
          },
        },
      },
    );
    await expectStatus(submissionResponse, 201, requestIds);

    await page.reload();
    const settings = page
      .locator("form")
      .filter({
        has: page.getByText("Pruefungseinstellungen", { exact: true }),
      });
    await settings.getByLabel("Bestehen ab (%)").fill("100");
    await settings.getByLabel("Max. Versuche").fill("2");
    await settings.getByLabel("Fragen je Versuch mischen").check();
    await settings.getByLabel("Zeitlimit (Minuten)").fill("10");
    await settings.getByLabel("Zufallsfragen (von 1)").fill("1");
    await settings
      .locator('select[name="examResultReleaseMode"]')
      .selectOption("immediate");
    await settings
      .locator('select[name="examReviewReleaseMode"]')
      .selectOption("after_result");
    await settings
      .locator('select[name="examContentAccessMode"]')
      .selectOption("block_course");
    await settings.getByRole("button", { name: "Speichern" }).click();
    await expect(
      page.getByText("Pruefungseinstellungen gespeichert.", { exact: true }),
    ).toBeVisible();

    const moduleRead = await request.get(`/api/v1/modules/${moduleId}`, {
      headers: authorization,
    });
    requestIds.push(moduleRead.headers()["x-request-id"]);
    expect(moduleRead.status()).toBe(200);
    const modulePayload = JSON.stringify(await moduleRead.json());
    expect(modulePayload).toContain('"kind":"exam"');
    expect(modulePayload).not.toContain("correctOption");
    expect(modulePayload).not.toContain(secretFeedback);

    const publish = await request.post(`/api/v1/courses/${courseId}/publish`, {
      headers: mutationHeaders(`${prefix}-publish`),
      data: { changelog: "Pruefungsmodul freigegeben" },
    });
    await expectStatus(publish, 201, requestIds);
    const [version] = await client<Array<{ id: string }>>`
      select id from course_versions
      where course_id = ${courseId} and published_at is not null
      order by version desc limit 1
    `;
    const versionRead = await request.get(
      `/api/v1/courses/${courseId}/versions/${version.id}`,
      { headers: authorization },
    );
    requestIds.push(versionRead.headers()["x-request-id"]);
    expect(versionRead.status()).toBe(200);
    const versionPayload = JSON.stringify(await versionRead.json());
    expect(versionPayload).toContain('"moduleKindVersion":1');
    expect(versionPayload).toContain('"kind":"exam"');
    expect(versionPayload).not.toContain("correctOption");
    expect(versionPayload).not.toContain(secretFeedback);

    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${fixture.organization_id}, ${memberId}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    await client.begin(async (tx) => {
      const [organization] = await tx<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Foreign Exam ${suffix}`}, ${`foreign-exam-${suffix}`})
        returning id
      `;
      foreignOrganizationId = organization.id;
      const [foreignModule] = await tx<Array<{ id: string }>>`
        insert into modules (organization_id, title, kind)
        values (${foreignOrganizationId}, ${`Foreign exam ${suffix}`}, 'exam')
        returning id
      `;
      foreignModuleId = foreignModule.id;
      const [foreignLesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, type
        ) values (
          ${foreignOrganizationId}, ${foreignModuleId}, 'Foreign exam',
          ${`foreign-exam-${suffix}`}, 'exam'
        ) returning id
      `;
      await tx`
        insert into lesson_pages (
          lesson_id, title, title_synced_with_lesson, slug, sort_order
        ) values (
          ${foreignLesson.id}, 'Foreign exam', true,
          ${`foreign-exam-${suffix}`}, 0
        )
      `;
    });
    const foreignRead = await request.get(
      `/api/v1/modules/${foreignModuleId}`,
      {
        headers: authorization,
      },
    );
    requestIds.push(foreignRead.headers()["x-request-id"]);
    expect(foreignRead.status()).toBe(404);

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    memberPage.setDefaultTimeout(10_000);
    await login(memberPage, "member");
    await memberPage.goto(`/academy/courses/${courseSlug}`);
    await expect(
      memberPage.getByText("Pruefungsmodul | 1 Pruefung"),
    ).toBeVisible();
    await memberPage
      .getByRole("link", { name: new RegExp(moduleTitle) })
      .click();
    await expect(
      memberPage.getByRole("heading", { name: "Bereit für den Start" }),
    ).toBeVisible();
    await expect(
      memberPage.getByText(wrongOption, { exact: true }),
    ).toHaveCount(0);
    expect(await memberPage.content()).not.toContain("correctOption");
    expect(await memberPage.content()).not.toContain(secretFeedback);

    await memberPage
      .getByRole("button", { name: "Starten / fortsetzen" })
      .click();
    await expect(
      memberPage.getByText(wrongOption, { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByText("Zurueck zum Kurs", { exact: true }),
    ).toHaveAttribute("aria-disabled", "true");

    const supplemental = memberPage
      .getByRole("heading", { name: "Transferanalyse" })
      .locator("..");
    await supplemental
      .getByLabel("Titel")
      .fill("Transferanalyse erster Versuch");
    await supplemental
      .getByLabel("Antwort")
      .fill("Risiko erkannt, Kontrolle dokumentiert und Freigabe abgelehnt.");
    await supplemental
      .getByRole("button", { name: "Abgabe einreichen" })
      .click();
    await expect(
      supplemental.getByText("Wartet auf Bewertung", { exact: true }),
    ).toBeVisible();

    const wrongAnswerRadio = memberPage.getByRole("radio", {
      name: new RegExp(wrongOption),
    });
    await wrongAnswerRadio.press("Space");
    await expect(wrongAnswerRadio).toBeChecked();
    memberPage.once("dialog", (dialog) => void dialog.accept());
    await memberPage.getByRole("button", { name: "Prüfung abgeben" }).click();
    await expect(
      memberPage.getByRole("heading", { name: "Prüfung nicht bestanden" }),
    ).toBeVisible();
    await expect(
      memberPage.getByText(secretFeedback, { exact: true }),
    ).toBeVisible();

    await memberPage
      .getByRole("button", { name: "Neuen Versuch starten" })
      .click();
    const correctAnswerRadio = memberPage.getByRole("radio", {
      name: new RegExp(correctOption),
    });
    await correctAnswerRadio.press("Space");
    await expect(correctAnswerRadio).toBeChecked();
    memberPage.once("dialog", (dialog) => void dialog.accept());
    await memberPage.getByRole("button", { name: "Prüfung abgeben" }).click();
    await expect(
      memberPage
        .getByRole("main")
        .getByText("Prüfung bestanden", { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByText("100 % | 1 von 1 Fragen richtig"),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: "Zurueck zum Kurs" }),
    ).toBeVisible();
    const viewport = await memberPage.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
    expect(viewport.bodyWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);
    await memberPage.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await memberPage.screenshot({
      path: `artifacts/exam-module-${testInfo.project.name}-final.png`,
      fullPage: false,
    });

    const [attemptCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from assessment_attempts
      where organization_id = ${fixture.organization_id}
        and user_id = ${memberId}
        and course_id = ${courseId}
        and lesson_id = ${lessonId}
        and assessment_snapshot -> 'questions' @> ${client.json([{ blockId: questionId }])}
    `;
    expect(attemptCount.count).toBe(2);
  } finally {
    await memberContext?.close().catch(() => undefined);
    const recordedRequestIds = requestIds.filter(Boolean);
    if (recordedRequestIds.length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${recordedRequestIds}::uuid[])
      `.catch(() => undefined);
    }
    if (organizationId) {
      await client`
        delete from api_idempotency_keys
        where organization_id = ${organizationId}
          and key like ${`${prefix}%`}
      `.catch(() => undefined);
    }
    if (courseId && organizationId) {
      await client`
        delete from activity_events
        where organization_id = ${organizationId}
          and (
            metadata ->> 'courseId' = ${courseId}
            or entity_id in (${courseId}, ${moduleId || courseId}, ${lessonId || courseId})
            or entity_id in (
              select id from assessment_attempts where course_id = ${courseId}
            )
          )
      `.catch(() => undefined);
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
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`.catch(
        () => undefined,
      );
    }
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
});
