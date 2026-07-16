import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const authorization = {
  Authorization: `Bearer ${
    process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"
  }`,
};

const localeExpectations = {
  en: {
    requiredQuestion: "Required question",
    multipleAnswers: "Multiple answers can be selected",
    practicalSubmission: "Practical submission",
    requiredSubmission: "Required submission",
    title: "Title",
    titlePlaceholder: "Title of your submission",
    submitWork: "Submit work",
    submitQuiz: "Submit required quiz",
    examReady: "Ready to start",
    examQuestions: "Questions",
    examTime: "Time",
    examStart: "Start / continue",
    examQuestion: "Question 1 of 1",
    examDirty: "Unsaved",
    examSaved: "Saved",
    examSubmit: "Submit exam",
    examConfirm: "Submit this exam now? This action is final.",
    examPassed: "Exam passed",
    examReview: "Answer review",
    examAnswer: "Your answer: AUTHOR_EXAM_OPTION_ALPHA",
  },
  fr: {
    requiredQuestion: "Question obligatoire",
    multipleAnswers: "Plusieurs réponses peuvent être sélectionnées",
    practicalSubmission: "Travail pratique",
    requiredSubmission: "Travail obligatoire",
    title: "Titre",
    titlePlaceholder: "Titre de votre travail",
    submitWork: "Envoyer le travail",
    submitQuiz: "Envoyer le quiz obligatoire",
    examReady: "Prêt à commencer",
    examQuestions: "Questions",
    examTime: "Temps",
    examStart: "Démarrer / reprendre",
    examQuestion: "Question 1 sur 1",
    examDirty: "Non enregistré",
    examSaved: "Enregistré",
    examSubmit: "Envoyer l'examen",
    examConfirm: "Envoyer définitivement l'examen maintenant ?",
    examPassed: "Examen réussi",
    examReview: "Consultation des réponses",
    examAnswer: "Votre réponse : AUTHOR_EXAM_OPTION_ALPHA",
  },
} as const;

async function loginMember(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function publishCourse(
  request: APIRequestContext,
  courseId: string,
  idempotencyKey: string,
) {
  const response = await request.post(`/api/v1/courses/${courseId}/publish`, {
    headers: { ...authorization, "Idempotency-Key": idempotencyKey },
    data: { changelog: "Learning locale browser coverage" },
  });
  expect(response.status()).toBe(201);
  return response.headers()["x-request-id"];
}

test("lesson, submission, and exam copy follows the learner locale on desktop and mobile", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const locale = testInfo.project.name === "mobile" ? "fr" : "en";
  const copy = localeExpectations[locale];
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
  const idempotencyKey = `learning-i18n-${suffix}`;
  const memberEmail = `learning-i18n-${suffix}@example.test`;
  const courseSlug = `learning-i18n-${suffix}`;
  const authoredQuizPrompt = `AUTHOR_QUIZ_PROMPT_${suffix}`;
  const authoredSubmissionTitle = `AUTHOR_SUBMISSION_TITLE_${suffix}`;
  const authoredSubmissionPrompt = `AUTHOR_SUBMISSION_PROMPT_${suffix}`;
  const authoredExamSummary = `AUTHOR_EXAM_SUMMARY_${suffix}`;
  const authoredExamPrompt = `AUTHOR_EXAM_PROMPT_${suffix}`;
  let memberId = "";
  let courseId = "";
  let learningModuleId = "";
  let examModuleId = "";
  let quizLessonId = "";
  let examLessonId = "";
  let examPageId = "";
  let requestId = "";

  try {
    const [identity] = await sql<
      Array<{
        organization_id: string;
        owner_id: string;
        password_hash: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        template.password_hash
      from users owner
      cross join users template
      where owner.email = 'admin@q-academy.de'
        and template.email = 'lea@q-academy.de'
      limit 1
    `;
    expect(identity).toBeTruthy();

    const [member] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status, preferred_locale
      ) values (
        ${identity.organization_id}, ${memberEmail}, ${identity.password_hash},
        'Locale', ${`Learner ${suffix}`}, 'member', 'active', ${locale}
      )
      returning id
    `;
    memberId = member.id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${identity.organization_id}, ${`Learning locale ${suffix}`},
        ${courseSlug}, 'Localized learner fixture.',
        'Quiz, submission, and exam localization fixture.', 'draft',
        ${identity.owner_id}
      )
      returning id
    `;
    courseId = course.id;

    const learningModuleTitle = `Learning module ${suffix}`;
    const examModuleTitle = `Exam module ${suffix}`;
    const modules = await sql<Array<{ id: string; title: string }>>`
      insert into modules (
        organization_id, title, description, is_reusable, estimated_minutes
      ) values
        (
          ${identity.organization_id}, ${learningModuleTitle},
          'Localized quiz and submission.', false, 15
        ),
        (
          ${identity.organization_id}, ${examModuleTitle},
          'Localized exam lifecycle.', false, 20
        )
      returning id, title
    `;
    learningModuleId = modules.find(({ title }) => title === learningModuleTitle)!.id;
    examModuleId = modules.find(({ title }) => title === examModuleTitle)!.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      ) values
        (${identity.organization_id}, ${courseId}, ${learningModuleId}, 0, true),
        (${identity.organization_id}, ${courseId}, ${examModuleId}, 1, true)
    `;

    const lessons = await sql<Array<{ id: string; type: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, passing_score, max_attempts, shuffle_questions,
        exam_duration_seconds, exam_result_release_mode,
        exam_review_release_mode, exam_content_access_mode, sort_order, status
      ) values
        (
          ${identity.organization_id}, ${learningModuleId},
          ${`Quiz lesson ${suffix}`}, ${`quiz-${suffix}`},
          'Localized interactive lesson.', 'quiz', 15, 100, 3, false,
          null, 'immediate', 'after_result', 'allow', 0, 'published'
        ),
        (
          ${identity.organization_id}, ${examModuleId},
          ${`Exam lesson ${suffix}`}, ${`exam-${suffix}`},
          ${authoredExamSummary}, 'exam', 20, 100, 2, false,
          3661, 'immediate', 'after_result', 'allow', 0, 'published'
        )
      returning id, type::text
    `;
    quizLessonId = lessons.find(({ type }) => type === "quiz")!.id;
    examLessonId = lessons.find(({ type }) => type === "exam")!.id;
    const [examPage] = await sql<Array<{ id: string }>>`
      insert into lesson_pages (
        lesson_id, title, title_synced_with_lesson, slug, sort_order, status
      ) values (
        ${examLessonId}, ${`Exam lesson ${suffix}`}, true,
        ${`exam-page-${suffix}`}, 0, 'published'
      )
      returning id
    `;
    examPageId = examPage.id;
    await sql`update modules set kind = 'exam' where id = ${examModuleId}`;

    await sql`
      insert into content_blocks (
        lesson_id, page_id, type, title, sort_order, required, data
      ) values
        (
          ${quizLessonId}, null, 'multi_select', 'AUTHOR_QUIZ_TITLE', 0, true,
          ${sql.json({
            prompt: authoredQuizPrompt,
            options: ["AUTHOR_OPTION_ALPHA", "AUTHOR_OPTION_BETA"],
            correctOptions: [0],
          })}
        ),
        (
          ${quizLessonId}, null, 'submission', ${authoredSubmissionTitle}, 1, true,
          ${sql.json({ prompt: authoredSubmissionPrompt })}
        ),
        (
          ${examLessonId}, ${examPageId}, 'multiple_choice',
          'AUTHOR_EXAM_TITLE', 0, true,
          ${sql.json({
            prompt: authoredExamPrompt,
            options: ["AUTHOR_EXAM_OPTION_ALPHA", "AUTHOR_EXAM_OPTION_BETA"],
            correctOption: 0,
          })}
        )
    `;

    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${identity.organization_id}, ${memberId}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    requestId = await publishCourse(request, courseId, idempotencyKey);
    await loginMember(page, memberEmail);
    await page.goto(`/academy/courses/${courseSlug}/learn/${quizLessonId}`);

    await expect(page.locator("[data-tenant-branding]")).toHaveAttribute(
      "lang",
      locale,
    );
    await expect(page.getByText(copy.requiredQuestion, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("group", { name: copy.multipleAnswers }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.practicalSubmission, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(copy.requiredSubmission, { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel(copy.title, { exact: true })).toHaveAttribute(
      "placeholder",
      copy.titlePlaceholder,
    );
    await expect(page.getByRole("button", { name: copy.submitWork })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.submitQuiz })).toBeVisible();
    await expect(page.getByText(authoredQuizPrompt, { exact: true })).toBeVisible();
    await expect(
      page.getByText(authoredSubmissionTitle, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(authoredSubmissionPrompt, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Pflichtfrage", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Pflichtabgabe", { exact: true })).toHaveCount(0);

    await page.goto(`/academy/courses/${courseSlug}/learn/${examLessonId}`);
    await expect(page.getByRole("heading", { name: copy.examReady })).toBeVisible();
    await expect(page.getByText(copy.examQuestions, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.examTime, { exact: true })).toBeVisible();
    await expect(page.getByText(authoredExamSummary, { exact: true })).toBeVisible();
    await expect(page.getByText(/1\s*(hr|h)/i)).toBeVisible();
    await expect(page.getByText(/2\s*min/i)).toBeVisible();
    await page.getByRole("button", { name: copy.examStart }).click();
    await expect(
      page.getByRole("group", { name: copy.examQuestion, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(copy.examSaved, { exact: true })).toBeVisible();
    await expect(page.getByText(authoredExamPrompt, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.examSubmit })).toBeDisabled();
    await expect(page.getByText("Bereit für den Start", { exact: true })).toHaveCount(0);

    await page.getByText("AUTHOR_EXAM_OPTION_ALPHA", { exact: true }).click();
    await expect(page.getByText(copy.examDirty, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.examSaved, { exact: true })).toBeVisible();
    const submitExam = page.getByRole("button", { name: copy.examSubmit });
    await expect(submitExam).toBeEnabled();
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe(copy.examConfirm);
      await dialog.accept();
    });
    await submitExam.click();
    await expect(
      page.getByRole("heading", { name: copy.examPassed, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: copy.examReview, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(copy.examAnswer, { exact: true })).toBeVisible();

    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`learning-i18n-${testInfo.project.name}.png`),
      fullPage: true,
    });
  } finally {
    if (requestId) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await sql`delete from api_idempotency_keys where key = ${idempotencyKey}`;
    if (courseId) {
      await sql`
        delete from activity_events
        where metadata ->> 'courseId' = ${courseId}
           or user_id = ${memberId || null}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (learningModuleId || examModuleId) {
      await sql`
        delete from modules
        where id in (${learningModuleId || null}, ${examModuleId || null})
      `;
    }
    if (memberId) await sql`delete from users where id = ${memberId}`;
    await sql.end();
  }
});
