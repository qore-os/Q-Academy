import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };
const courseBuilderCopy = getCourseBuilderCopy("de");

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
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
    data: { changelog: "Interaktive Assessment-Formate" },
  });
  requestIds.push(response.headers()["x-request-id"]);
  expect(response.status()).toBe(201);
}

test("advanced interactive question types are edited, presented, and graded from published snapshots", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted assessment flow");
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const idempotencyPrefix = `interactive-assessment-${suffix}`;
  const courseSlug = `interactive-assessment-${suffix}`;
  const multiPrompt = `Waehle alle Projektphasen ${suffix}`;
  const fillPrompt = `Ergaenze den Strategiecode ${suffix}`;
  const orderingPrompt = `Sortiere den Projektablauf ${suffix}`;
  const fillAnswer = `Q-Strategie-${suffix}`;
  const alternateAnswerSecret = `SECRET_ALT_${suffix}`;
  const feedbackSecret = `SECRET_FEEDBACK_${suffix}`;
  const draftFeedbackSecret = `DRAFT_FEEDBACK_${suffix}`;
  const correctOrderLabels = [
    `Analysieren ${suffix}`,
    `Planen ${suffix}`,
    `Umsetzen ${suffix}`,
  ];
  const requestIds: string[] = [];
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let multiBlockId = "";
  let fillBlockId = "";
  let orderingBlockId = "";
  let memberId = "";
  let adminPage: Page | null = null;

  try {
    const [identity] = await sql<
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
    if (!identity) throw new Error("Demo identities were not found.");
    memberId = identity.member_id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        created_by_id
      ) values (
        ${identity.organization_id},
        ${`Interaktive Aufgaben ${suffix}`},
        ${courseSlug},
        'Mehrfachauswahl, Lueckentext und Sortieraufgabe.',
        'Fokussierter Testkurs fuer interaktive Assessment-Formate.',
        'draft',
        ${identity.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id,
        title,
        description,
        is_reusable,
        estimated_minutes
      ) values (
        ${identity.organization_id},
        ${`Assessment-Modul ${suffix}`},
        'Drei interaktive Fragetypen.',
        false,
        15
      )
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (${identity.organization_id}, ${courseId}, ${moduleId}, 0, true)
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id,
        module_id,
        title,
        slug,
        summary,
        type,
        passing_score,
        shuffle_questions,
        status
      ) values (
        ${identity.organization_id},
        ${moduleId},
        ${`Interaktiver Wissenstest ${suffix}`},
        ${`interactive-${suffix}`},
        'Alle drei Aufgaben muessen korrekt geloest werden.',
        'quiz',
        100,
        false,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    const blocks = await sql<Array<{ id: string; type: string }>>`
      insert into content_blocks (
        lesson_id,
        type,
        title,
        sort_order,
        required,
        data
      ) values
        (
          ${lessonId}, 'multi_select', 'Mehrfachauswahl', 0, true,
          ${sql.json({
            prompt: multiPrompt,
            options: [
              `Analyse ${suffix}`,
              `Dekoration ${suffix}`,
              `Umsetzung ${suffix}`,
            ],
            correctOptions: [0, 2],
            feedback: feedbackSecret,
          })}
        ),
        (
          ${lessonId}, 'fill_blank', 'Lueckentext', 1, true,
          ${sql.json({
            prompt: fillPrompt,
            acceptedAnswers: [fillAnswer, alternateAnswerSecret],
            caseSensitive: false,
            feedback: feedbackSecret,
          })}
        ),
        (
          ${lessonId}, 'ordering', 'Sortieraufgabe', 2, true,
          ${sql.json({
            prompt: orderingPrompt,
            options: correctOrderLabels,
            feedback: feedbackSecret,
          })}
        )
      returning id, type
    `;
    multiBlockId = blocks.find((block) => block.type === "multi_select")!.id;
    fillBlockId = blocks.find((block) => block.type === "fill_blank")!.id;
    orderingBlockId = blocks.find((block) => block.type === "ordering")!.id;

    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id,
        user_id,
        course_id,
        source
      ) values (
        ${identity.organization_id},
        ${memberId},
        ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;
    await publishCourse(
      request,
      courseId,
      `${idempotencyPrefix}-publish-1`,
      requestIds,
    );

    const adminContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    await login(adminPage, "admin");
    await adminPage.goto(`/admin/courses/${courseId}`);
    await expect(
      adminPage.getByRole("button", { name: "Mehrfachauswahl", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "Lueckentext", exact: true }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "Sortieren", exact: true }),
    ).toBeVisible();
    await adminPage
      .getByRole("button", {
        name: `${courseBuilderCopy.palette.multi_select}: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();
    const editorDialog = adminPage.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    await expect(editorDialog.getByText("Korrekte Antworten")).toBeVisible();
    await editorDialog
      .getByLabel("Feedback nach der Abgabe")
      .fill(draftFeedbackSecret);
    await editorDialog
      .getByRole("button", {
        name: courseBuilderCopy.dialogs.saveChanges,
        exact: true,
      })
      .click();
    await expect(
      adminPage.getByText("Inhaltselement gespeichert.", { exact: true }),
    ).toBeVisible();

    await login(page, "member");
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    await expect(page.getByRole("heading", { name: multiPrompt })).toBeVisible();
    const initialHtml = await page.content();
    expect(initialHtml).not.toContain("correctOptions");
    expect(initialHtml).not.toContain("acceptedAnswers");
    expect(initialHtml).not.toContain("correctOrder");
    expect(initialHtml).not.toContain(feedbackSecret);
    expect(initialHtml).not.toContain(draftFeedbackSecret);
    expect(initialHtml).not.toContain(alternateAnswerSecret);

    await page
      .getByRole("button", { name: `Analyse ${suffix}` })
      .click();
    await page.getByLabel(fillPrompt).fill("Falsche Antwort");
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page.getByRole("main").getByText("Noch nicht bestanden", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Noch nicht richtig", { exact: true }),
    ).toHaveCount(3);
    await expect(page.getByText(feedbackSecret, { exact: true })).toHaveCount(3);
    const failedHtml = await page.content();
    expect(failedHtml).not.toContain("correctOptions");
    expect(failedHtml).not.toContain("acceptedAnswers");
    expect(failedHtml).not.toContain("correctOrder");
    expect(failedHtml).not.toContain(alternateAnswerSecret);

    await page
      .getByRole("button", { name: `Analyse ${suffix}` })
      .click();
    await page
      .getByRole("button", { name: `Umsetzung ${suffix}` })
      .click();
    await page.getByLabel(fillPrompt).fill(`  ${fillAnswer.toUpperCase()}  `);

    const orderingSection = page.locator(
      `[data-quiz-block="${orderingBlockId}"]`,
    );
    for (let target = 0; target < correctOrderLabels.length; target += 1) {
      const label = correctOrderLabels[target];
      while (true) {
        const itemTexts = await orderingSection.locator("ol > li").allTextContents();
        const current = itemTexts.findIndex((text) => text.includes(label));
        if (current <= target) break;
        await orderingSection
          .getByRole("button", { name: `${label} nach oben` })
          .click();
      }
    }
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page.getByRole("main").getByText("Pflichtquiz bestanden", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/100 % in Versuch 2/)).toBeVisible();
    await expect(
      page.getByText("Richtig beantwortet", { exact: true }),
    ).toHaveCount(3);
    await expect(page.getByText(feedbackSecret, { exact: true })).toHaveCount(3);
    const gradedHtml = await page.content();
    expect(gradedHtml).not.toContain("correctOptions");
    expect(gradedHtml).not.toContain("acceptedAnswers");
    expect(gradedHtml).not.toContain("correctOrder");
    expect(gradedHtml).not.toContain(alternateAnswerSecret);

    const [storedAttempt] = await sql<
      Array<{ id: string; assessment_snapshot: Record<string, unknown> }>
    >`
      select id, assessment_snapshot
      from assessment_attempts
      where user_id = ${memberId}
        and course_id = ${courseId}
        and lesson_id = ${lessonId}
      order by attempt_number desc
      limit 1
    `;
    expect(storedAttempt.assessment_snapshot).toMatchObject({ schemaVersion: 3 });
    const storedAnswers = await sql<
      Array<{
        block_id: string;
        question_snapshot: Record<string, unknown>;
        answer_snapshot: Record<string, unknown>;
        correct: boolean;
      }>
    >`
      select block_id, question_snapshot, answer_snapshot, correct
      from assessment_answers
      where attempt_id = ${storedAttempt.id}
      order by answered_at, id
    `;
    expect(storedAnswers).toHaveLength(3);
    expect(storedAnswers.every((answer) => answer.correct)).toBe(true);
    expect(
      storedAnswers.find((answer) => answer.block_id === multiBlockId)
        ?.answer_snapshot,
    ).toMatchObject({ selectedOptions: [0, 2] });
    expect(
      storedAnswers.find((answer) => answer.block_id === fillBlockId)
        ?.answer_snapshot,
    ).toMatchObject({ textAnswer: fillAnswer.toUpperCase() });
    const orderingSnapshot = storedAnswers.find(
      (answer) => answer.block_id === orderingBlockId,
    )?.question_snapshot as { correctOrder: string[] };

    const detailResponse = await request.get(
      `/api/v1/assessment-attempts/${storedAttempt.id}`,
      { headers: authorization },
    );
    requestIds.push(detailResponse.headers()["x-request-id"]);
    expect(detailResponse.status()).toBe(200);
    const detailPayload = JSON.stringify(await detailResponse.json());
    expect(detailPayload).not.toContain("correctOptions");
    expect(detailPayload).not.toContain("acceptedAnswers");
    expect(detailPayload).not.toContain("correctOrder");
    expect(detailPayload).not.toContain(feedbackSecret);
    expect(detailPayload).not.toContain(alternateAnswerSecret);

    const invalidShape = await request.post("/api/v1/assessment-attempts", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${idempotencyPrefix}-invalid-shape`,
      },
      data: {
        userId: memberId,
        courseId,
        lessonId,
        answers: [
          { blockId: multiBlockId, selectedOption: 0 },
          { blockId: fillBlockId, textAnswer: fillAnswer },
          {
            blockId: orderingBlockId,
            orderedItemIds: orderingSnapshot.correctOrder,
          },
        ],
      },
    });
    requestIds.push(invalidShape.headers()["x-request-id"]);
    expect(invalidShape.status()).toBe(422);

    await sql`
      update content_blocks
      set data = ${sql.json({
        prompt: multiPrompt,
        options: [
          `Analyse ${suffix}`,
          `Dekoration ${suffix}`,
          `Umsetzung ${suffix}`,
        ],
        correctOptions: [1],
      })}
      where id = ${multiBlockId}
    `;
    await sql`
      update content_blocks
      set data = ${sql.json({
        prompt: fillPrompt,
        acceptedAnswers: [`Neue-Antwort-${suffix}`],
        caseSensitive: false,
      })}
      where id = ${fillBlockId}
    `;
    await sql`
      update content_blocks
      set data = ${sql.json({
        prompt: orderingPrompt,
        options: [...correctOrderLabels].reverse(),
      })}
      where id = ${orderingBlockId}
    `;

    const publishedSnapshotAnswers = [
      { blockId: multiBlockId, selectedOptions: [0, 2] },
      { blockId: fillBlockId, textAnswer: fillAnswer },
      {
        blockId: orderingBlockId,
        orderedItemIds: orderingSnapshot.correctOrder,
      },
    ];
    const beforeRepublish = await request.post(
      "/api/v1/assessment-attempts",
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-before-republish`,
        },
        data: { userId: memberId, courseId, lessonId, answers: publishedSnapshotAnswers },
      },
    );
    requestIds.push(beforeRepublish.headers()["x-request-id"]);
    expect(beforeRepublish.status()).toBe(201);
    await expect(beforeRepublish.json()).resolves.toMatchObject({
      data: { passed: true, score: 100, attemptsUsed: 3 },
    });

    await publishCourse(
      request,
      courseId,
      `${idempotencyPrefix}-publish-2`,
      requestIds,
    );
    const afterRepublish = await request.post(
      "/api/v1/assessment-attempts",
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-after-republish`,
        },
        data: { userId: memberId, courseId, lessonId, answers: publishedSnapshotAnswers },
      },
    );
    requestIds.push(afterRepublish.headers()["x-request-id"]);
    expect(afterRepublish.status()).toBe(201);
    await expect(afterRepublish.json()).resolves.toMatchObject({
      data: { passed: false, attemptsUsed: 1 },
    });
  } finally {
    await adminPage?.context().close();
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await sql`
      delete from api_idempotency_keys
      where key like ${`${idempotencyPrefix}%`}
    `;
    if (courseId) {
      await sql`
        delete from activity_events
        where metadata ->> 'courseId' = ${courseId}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end();
  }
});
