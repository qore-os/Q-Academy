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
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

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

async function publishCourse(
  request: APIRequestContext,
  courseId: string,
  idempotencyKey: string,
  requestIds: string[],
) {
  const response = await request.post(`/api/v1/courses/${courseId}/publish`, {
    headers: { ...authorization, "Idempotency-Key": idempotencyKey },
    data: { changelog: "Advanced assessment E2E publication" },
  });
  requestIds.push(response.headers()["x-request-id"]);
  expect(response.status()).toBe(201);
}

test("advanced assessments enforce published rules without leaking answer keys", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
  const idempotencyPrefix = `advanced-assessment-${suffix}`;
  const primarySlug = `assessment-primary-${suffix}`;
  const secondarySlug = `assessment-secondary-${suffix}`;
  const mainTitle = `50 Prozent Pruefung ${suffix}`;
  const limitTitle = `Limit Pruefung ${suffix}`;
  const lockedTitle = `Gesperrte Pruefung ${suffix}`;
  const draftTitle = `Entwurfspruefung ${suffix}`;
  const mainLessonSlug = `main-${suffix}`;
  const limitLessonSlug = `limit-${suffix}`;
  const lockedLessonSlug = `locked-${suffix}`;
  const draftLessonSlug = `draft-${suffix}`;
  const correctOption = `Richtige Option ${suffix}`;
  const incorrectOption = `Falsche Option ${suffix}`;
  const secretFeedback = `SECRET_FEEDBACK_${suffix}`;
  const requestIds: string[] = [];
  let primaryCourseId = "";
  let secondaryCourseId = "";
  let moduleId = "";
  let mainLessonId = "";
  let limitLessonId = "";
  let lockedLessonId = "";
  let draftLessonId = "";
  let mainMultipleChoiceId = "";
  let mainTrueFalseId = "";
  let limitTrueFalseId = "";
  let lockedBlockId = "";
  let draftBlockId = "";
  let memberId = "";
  let adminContext: BrowserContext | null = null;

  try {
    const [fixture] = await sql<
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
    memberId = fixture.member_id;

    const courses = await sql<Array<{ id: string; slug: string }>>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        created_by_id
      ) values
        (
          ${fixture.organization_id},
          ${`Assessment Primaerkurs ${suffix}`},
          ${primarySlug},
          'Publizierte Pruefungsregeln mit sicherer Auswertung.',
          'Isolierter Testkurs fuer Bestehensgrenze, Versuche und Republish.',
          'draft',
          ${fixture.owner_id}
        ),
        (
          ${fixture.organization_id},
          ${`Assessment Zweitkurs ${suffix}`},
          ${secondarySlug},
          'Geteiltes Modul mit eigenstaendigem Assessment-Kontext.',
          'Versuche und Erfolge bleiben trotz geteilter Lektions-ID kursbezogen.',
          'draft',
          ${fixture.owner_id}
        )
      returning id, slug
    `;
    primaryCourseId = courses.find((course) => course.slug === primarySlug)!.id;
    secondaryCourseId = courses.find(
      (course) => course.slug === secondarySlug,
    )!.id;

    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id,
        title,
        description,
        is_reusable,
        estimated_minutes
      ) values (
        ${fixture.organization_id},
        ${`Geteiltes Pruefungsmodul ${suffix}`},
        'Ein Modul, zwei veroeffentlichte Kurs-Snapshots.',
        true,
        30
      )
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values
        (${fixture.organization_id}, ${primaryCourseId}, ${moduleId}, 0, true),
        (${fixture.organization_id}, ${secondaryCourseId}, ${moduleId}, 0, true)
    `;
    const [section] = await sql<Array<{ id: string }>>`
      insert into module_sections (
        organization_id, module_id, title, sort_order, status
      )
      values (${fixture.organization_id}, ${moduleId}, 'Pruefungen', 0, 'published')
      returning id
    `;

    const lessonRows = await sql<Array<{ id: string; slug: string }>>`
      insert into lessons (
        organization_id,
        module_id,
        section_id,
        title,
        slug,
        summary,
        type,
        duration_minutes,
        passing_score,
        max_attempts,
        shuffle_questions,
        sort_order,
        status,
        available_at
      ) values
        (
          ${fixture.organization_id}, ${moduleId}, ${section.id}, ${mainTitle}, ${mainLessonSlug},
          'Eine von zwei richtigen Antworten reicht.', 'quiz', 10,
          50, 3, true, 0, 'published', null
        ),
        (
          ${fixture.organization_id}, ${moduleId}, ${section.id}, ${limitTitle}, ${limitLessonSlug},
          'Nach einem Fehlversuch ist das Quiz gesperrt.', 'quiz', 10,
          100, 1, false, 1, 'published', null
        ),
        (
          ${fixture.organization_id}, ${moduleId}, ${section.id}, ${lockedTitle}, ${lockedLessonSlug},
          'Diese Pruefung ist zeitlich gesperrt.', 'quiz', 10,
          100, 2, false, 2, 'published', now() + interval '7 days'
        ),
        (
          ${fixture.organization_id}, ${moduleId}, ${section.id}, ${draftTitle}, ${draftLessonSlug},
          'Diese Pruefung ist nur im Entwurf.', 'quiz', 10,
          100, 2, false, 3, 'draft', null
        )
      returning id, slug
    `;
    mainLessonId = lessonRows.find(
      (lesson) => lesson.slug === mainLessonSlug,
    )!.id;
    limitLessonId = lessonRows.find(
      (lesson) => lesson.slug === limitLessonSlug,
    )!.id;
    lockedLessonId = lessonRows.find(
      (lesson) => lesson.slug === lockedLessonSlug,
    )!.id;
    draftLessonId = lessonRows.find(
      (lesson) => lesson.slug === draftLessonSlug,
    )!.id;

    const blockRows = await sql<
      Array<{ id: string; lesson_id: string; type: string }>
    >`
      insert into content_blocks (
        lesson_id,
        type,
        title,
        sort_order,
        required,
        data
      ) values
        (
          ${mainLessonId}, 'multiple_choice', 'Halbe Punktzahl', 0, true,
          ${sql.json({
            prompt: `Waehle die richtige Option ${suffix}`,
            options: [correctOption, incorrectOption],
            correctOption: 0,
            feedback: secretFeedback,
          })}
        ),
        (
          ${mainLessonId}, 'true_false', 'Wahr oder falsch', 1, true,
          ${sql.json({
            prompt: `Diese Aussage ist falsch ${suffix}`,
            options: ["Richtig", "Falsch"],
            correctOption: 1,
            feedback: secretFeedback,
          })}
        ),
        (
          ${limitLessonId}, 'true_false', 'Nur ein Versuch', 0, true,
          ${sql.json({
            prompt: `Diese Aussage ist richtig ${suffix}`,
            options: ["Richtig", "Falsch"],
            correctOption: 0,
            feedback: secretFeedback,
          })}
        ),
        (
          ${lockedLessonId}, 'multiple_choice', 'Noch gesperrt', 0, true,
          ${sql.json({
            prompt: "Gesperrte Frage",
            options: ["Ja", "Nein"],
            correctOption: 0,
          })}
        ),
        (
          ${draftLessonId}, 'multiple_choice', 'Nur Entwurf', 0, true,
          ${sql.json({
            prompt: "Entwurfsfrage",
            options: ["Ja", "Nein"],
            correctOption: 0,
          })}
        )
      returning id, lesson_id, type
    `;
    mainMultipleChoiceId = blockRows.find(
      (block) =>
        block.lesson_id === mainLessonId && block.type === "multiple_choice",
    )!.id;
    mainTrueFalseId = blockRows.find(
      (block) =>
        block.lesson_id === mainLessonId && block.type === "true_false",
    )!.id;
    limitTrueFalseId = blockRows.find(
      (block) => block.lesson_id === limitLessonId,
    )!.id;
    lockedBlockId = blockRows.find(
      (block) => block.lesson_id === lockedLessonId,
    )!.id;
    draftBlockId = blockRows.find(
      (block) => block.lesson_id === draftLessonId,
    )!.id;

    const enrollments = await sql<Array<{ id: string; course_id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values
        (${memberId}, ${primaryCourseId}, true),
        (${memberId}, ${secondaryCourseId}, true)
      returning id, course_id
    `;
    for (const enrollment of enrollments) {
      await sql`
        insert into course_access_grants (
          organization_id,
          user_id,
          course_id,
          source
        ) values (
          ${fixture.organization_id},
          ${memberId},
          ${enrollment.course_id},
          ${`direct:${enrollment.id}`}
        )
      `;
    }

    await publishCourse(
      request,
      primaryCourseId,
      `${idempotencyPrefix}-publish-primary-1`,
      requestIds,
    );
    await publishCourse(
      request,
      secondaryCourseId,
      `${idempotencyPrefix}-publish-secondary-1`,
      requestIds,
    );
    const malformedTrueFalse = await request.post(
      `/api/v1/lessons/${mainLessonId}/blocks`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-malformed-true-false`,
        },
        data: {
          type: "true_false",
          required: true,
          data: {
            prompt: "Ungueltige Wahr/Falsch-Frage",
            options: ["Ja", "Nein", "Vielleicht"],
            correctOption: 0,
          },
        },
      },
    );
    requestIds.push(malformedTrueFalse.headers()["x-request-id"]);
    expect(malformedTrueFalse.status()).toBe(422);

    await login(page, "member");
    await page.goto(`/academy/courses/${primarySlug}/learn/${mainLessonId}`);
    await expect(
      page.getByRole("heading", {
        name: `Waehle die richtige Option ${suffix}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Bestehen ab 50 %", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Versuche: 0 / 3", { exact: true }),
    ).toBeVisible();
    const initialOrder = await page
      .locator("[data-quiz-block]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-quiz-block")),
      );
    await page.reload();
    const reloadOrder = await page
      .locator("[data-quiz-block]")
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute("data-quiz-block")),
      );
    expect(reloadOrder).toEqual(initialOrder);
    const memberPayload = await page.content();
    expect(memberPayload).not.toContain("correctOption");
    expect(memberPayload).not.toMatch(/(?:\\?")feedback(?:\\?")\s*:/);
    expect(memberPayload).not.toContain(secretFeedback);

    await page.getByRole("button", { name: new RegExp(correctOption) }).click();
    await page.getByRole("button", { name: /Richtig$/ }).click();
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page
        .getByRole("main")
        .getByText("Pflichtquiz bestanden", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/50 % in Versuch 1/)).toBeVisible();

    await page.goto(`/academy/courses/${secondarySlug}/learn/${mainLessonId}`);
    await expect(
      page.getByText("Versuche: 0 / 3", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByText("Pflichtquiz bestanden", { exact: true }),
    ).toHaveCount(0);

    const sharedCompletionBlocked = await request.put(
      `/api/v1/members/${memberId}/progress/${mainLessonId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-shared-completion`,
        },
        data: { status: "completed", percent: 100 },
      },
    );
    requestIds.push(sharedCompletionBlocked.headers()["x-request-id"]);
    expect(sharedCompletionBlocked.status()).toBe(409);

    const secondaryAttempt = await request.post("/api/v1/assessment-attempts", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${idempotencyPrefix}-secondary-attempt`,
      },
      data: {
        userId: memberId,
        courseId: secondaryCourseId,
        lessonId: mainLessonId,
        answers: [
          { blockId: mainMultipleChoiceId, selectedOption: 0 },
          { blockId: mainTrueFalseId, selectedOption: 0 },
        ],
      },
    });
    requestIds.push(secondaryAttempt.headers()["x-request-id"]);
    expect(secondaryAttempt.status()).toBe(201);
    const secondaryAttemptBody = await secondaryAttempt.json();
    expect(secondaryAttemptBody.data).toMatchObject({
      passed: true,
      score: 50,
      passingScore: 50,
      attemptsUsed: 1,
    });
    expect(JSON.stringify(secondaryAttemptBody)).not.toContain("correctOption");
    expect(JSON.stringify(secondaryAttemptBody)).not.toContain("feedback");
    expect(JSON.stringify(secondaryAttemptBody)).not.toContain(secretFeedback);

    const draftSettings = await request.patch(
      `/api/v1/lessons/${mainLessonId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-draft-settings`,
        },
        data: { passingScore: 100 },
      },
    );
    requestIds.push(draftSettings.headers()["x-request-id"]);
    expect(draftSettings.status()).toBe(200);

    await page.goto(`/academy/courses/${primarySlug}/learn/${mainLessonId}`);
    await expect(
      page.getByText("Bestehen ab 50 %", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByText("Pflichtquiz bestanden", { exact: true }),
    ).toBeVisible();

    if (testInfo.project.name === "chromium") {
      adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      await login(adminPage, "admin");
      await adminPage.goto(`/admin/courses/${primaryCourseId}`);
      await expect(adminPage.getByLabel("Bestehen ab (%)")).toHaveValue("100");
      await expect(
        adminPage.getByRole("button", { name: "Wahr / Falsch" }),
      ).toBeVisible();
      const assessmentForm = adminPage.locator("form").filter({
        has: adminPage.getByText("Pruefungseinstellungen", { exact: true }),
      });
      await assessmentForm.getByLabel("Bestehen ab (%)").fill("75");
      await assessmentForm.getByLabel("Max. Versuche").fill("2");
      await assessmentForm.getByRole("button", { name: "Speichern" }).click();
      await expect(
        adminPage.getByText("Pruefungseinstellungen gespeichert.", {
          exact: true,
        }),
      ).toBeVisible();

      const restoreSettings = await request.patch(
        `/api/v1/lessons/${mainLessonId}`,
        {
          headers: {
            ...authorization,
            "Idempotency-Key": `${idempotencyPrefix}-restore-settings`,
          },
          data: { passingScore: 100, maxAttempts: 3, shuffleQuestions: true },
        },
      );
      requestIds.push(restoreSettings.headers()["x-request-id"]);
      expect(restoreSettings.status()).toBe(200);
    }

    await publishCourse(
      request,
      primaryCourseId,
      `${idempotencyPrefix}-publish-primary-2`,
      requestIds,
    );
    await page.reload();
    await expect(
      page.getByText("Bestehen ab 100 %", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Versuche: 0 / 3", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByText("Pflichtquiz bestanden", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(correctOption) }).click();
    await page.getByRole("button", { name: /Richtig$/ }).click();
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page.getByRole("main").getByText("Noch nicht bestanden", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/50 %/)).toBeVisible();

    await page.goto(`/academy/courses/${secondarySlug}/learn/${mainLessonId}`);
    await expect(
      page.getByText("Bestehen ab 50 %", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("main")
        .getByText("Pflichtquiz bestanden", { exact: true }),
    ).toBeVisible();

    const lockedAttempt = await request.post("/api/v1/assessment-attempts", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${idempotencyPrefix}-locked-attempt`,
      },
      data: {
        userId: memberId,
        courseId: primaryCourseId,
        lessonId: lockedLessonId,
        answers: [{ blockId: lockedBlockId, selectedOption: 0 }],
      },
    });
    requestIds.push(lockedAttempt.headers()["x-request-id"]);
    expect(lockedAttempt.status()).toBe(404);
    const draftAttempt = await request.post("/api/v1/assessment-attempts", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${idempotencyPrefix}-draft-attempt`,
      },
      data: {
        userId: memberId,
        courseId: primaryCourseId,
        lessonId: draftLessonId,
        answers: [{ blockId: draftBlockId, selectedOption: 0 }],
      },
    });
    requestIds.push(draftAttempt.headers()["x-request-id"]);
    expect(draftAttempt.status()).toBe(404);
    expect(
      (
        await page.goto(
          `/academy/courses/${primarySlug}/learn/${lockedLessonId}`,
        )
      )?.status(),
    ).toBe(404);
    expect(
      (
        await page.goto(
          `/academy/courses/${primarySlug}/learn/${draftLessonId}`,
        )
      )?.status(),
    ).toBe(404);

    const concurrentAttempts = await Promise.all(
      ["a", "b"].map((race) =>
        request.post("/api/v1/assessment-attempts", {
          headers: {
            ...authorization,
            "Idempotency-Key": `${idempotencyPrefix}-limit-race-${race}`,
          },
          data: {
            userId: memberId,
            courseId: primaryCourseId,
            lessonId: limitLessonId,
            answers: [{ blockId: limitTrueFalseId, selectedOption: 1 }],
          },
        }),
      ),
    );
    requestIds.push(
      ...concurrentAttempts.map(
        (response) => response.headers()["x-request-id"],
      ),
    );
    expect(
      concurrentAttempts.map((response) => response.status()).sort(),
    ).toEqual([201, 409]);
    const successfulRaceResponse = concurrentAttempts.find(
      (response) => response.status() === 201,
    )!;
    const successfulRaceBody = await successfulRaceResponse.json();
    await sql`
      delete from activity_events
      where entity_type = 'assessment_attempt'
        and entity_id = ${successfulRaceBody.data.id}
    `;
    await sql`
      delete from assessment_attempts
      where id = ${successfulRaceBody.data.id}
    `;

    await page.goto(`/academy/courses/${primarySlug}/learn/${limitLessonId}`);
    await expect(
      page.getByRole("heading", {
        name: `Diese Aussage ist richtig ${suffix}`,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Bestehen ab 100 %", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Versuche: 0 / 1", { exact: true }),
    ).toBeVisible();
    expect(await page.content()).not.toContain("correctOption");
    expect(await page.content()).not.toContain(secretFeedback);
    await page.getByRole("button", { name: /Falsch$/ }).click();
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page
        .getByRole("main")
        .getByText("Versuchslimit erreicht", { exact: true }),
    ).toBeVisible();
    const exhaustedButton = page.getByRole("button", {
      name: "Keine Versuche verbleibend",
    });
    await expect(exhaustedButton).toBeDisabled();
    await expect(
      page.getByText("Versuche: 1 / 1", { exact: true }),
    ).toBeVisible();

    const retry = await request.post("/api/v1/assessment-attempts", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${idempotencyPrefix}-limit-retry`,
      },
      data: {
        userId: memberId,
        courseId: primaryCourseId,
        lessonId: limitLessonId,
        answers: [{ blockId: limitTrueFalseId, selectedOption: 1 }],
      },
    });
    requestIds.push(retry.headers()["x-request-id"]);
    expect(retry.status()).toBe(409);
    await expect(retry.json()).resolves.toMatchObject({
      code: "conflict",
      errors: { maxAttempts: 1, attemptsUsed: 1 },
    });

    const [storedLimitAttempt] = await sql<Array<{ id: string }>>`
      select id
      from assessment_attempts
      where user_id = ${memberId}
        and course_id = ${primaryCourseId}
        and lesson_id = ${limitLessonId}
      order by attempt_number desc
      limit 1
    `;
    const attemptResponse = await request.get(
      `/api/v1/assessment-attempts/${storedLimitAttempt.id}`,
      { headers: authorization },
    );
    requestIds.push(attemptResponse.headers()["x-request-id"]);
    expect(attemptResponse.status()).toBe(200);
    const attemptPayload = JSON.stringify(await attemptResponse.json());
    expect(attemptPayload).not.toContain("correctOption");
    expect(attemptPayload).not.toContain("feedback");
    expect(attemptPayload).not.toContain(secretFeedback);

    const [attemptCounts] = await sql<
      Array<{
        limit_count: number;
        primary_count: number;
        secondary_count: number;
      }>
    >`
      select
        count(*) filter (
          where course_id = ${primaryCourseId} and lesson_id = ${limitLessonId}
        )::int as limit_count,
        count(*) filter (
          where course_id = ${primaryCourseId} and lesson_id = ${mainLessonId}
        )::int as primary_count,
        count(*) filter (
          where course_id = ${secondaryCourseId} and lesson_id = ${mainLessonId}
        )::int as secondary_count
      from assessment_attempts
      where user_id = ${memberId}
        and course_id in (${primaryCourseId}, ${secondaryCourseId})
    `;
    expect(attemptCounts).toMatchObject({
      limit_count: 1,
      primary_count: 2,
      secondary_count: 1,
    });
  } finally {
    if (adminContext) await adminContext.close();
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await sql`
      delete from api_idempotency_keys
      where key like ${`${idempotencyPrefix}%`}
    `;
    if (primaryCourseId || secondaryCourseId) {
      await sql`
        delete from activity_events
        where metadata ->> 'courseId' in (${primaryCourseId}, ${secondaryCourseId})
      `;
      await sql`
        delete from courses
        where id in (${primaryCourseId}, ${secondaryCourseId})
      `;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end();
  }
});
