import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

type AssessmentTarget = {
  course_id: string;
  lesson_id: string;
  user_id: string;
};

async function assessmentTarget() {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const rows = await client`
      select u.id as user_id, c.id as course_id, l.id as lesson_id
      from users u
      join enrollments e on e.user_id = u.id
      join courses c on c.id = e.course_id
      join course_modules cm on cm.course_id = c.id
      join lessons l on l.module_id = cm.module_id
      where u.email = 'lea@q-academy.de'
        and c.slug = 'ki-grundlagen'
        and l.slug = 'wissenscheck-modelle'
      limit 1
    `;
    const target = rows[0] as AssessmentTarget | undefined;
    if (!target) throw new Error("Assessment test fixture was not found.");
    return target;
  } finally {
    await client.end();
  }
}

async function resetAssessment(target: AssessmentTarget) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client.begin(async (transaction) => {
      await transaction`
        delete from assessment_attempts
        where user_id = ${target.user_id}
          and course_id = ${target.course_id}
          and lesson_id = ${target.lesson_id}
      `;
      await transaction`
        delete from lesson_progress
        where user_id = ${target.user_id}
          and lesson_id = ${target.lesson_id}
      `;
    });
  } finally {
    await client.end();
  }
}

async function storedAttempts(target: AssessmentTarget) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    return await client`
      select
        attempt_number,
        score,
        passed,
        status,
        jsonb_array_length(assessment_snapshot -> 'questions') as snapshot_question_count,
        (select count(*)::int from assessment_answers aa where aa.attempt_id = a.id) as answer_count,
        (select bool_and(aa.correct) from assessment_answers aa where aa.attempt_id = a.id) as all_answers_correct
      from assessment_attempts a
      where user_id = ${target.user_id}
        and course_id = ${target.course_id}
        and lesson_id = ${target.lesson_id}
      order by attempt_number asc
    `;
  } finally {
    await client.end();
  }
}

test("required quiz is graded on the server before lesson completion", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted desktop assessment flow");
  const target = await assessmentTarget();
  await resetAssessment(target);

  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
  await page.goto(`/academy/courses/ki-grundlagen/learn/${target.lesson_id}`);
  await expect(page.getByRole("heading", { name: "Wissenscheck: Modelle" })).toBeVisible();
  expect(await page.content()).not.toContain("correctOption");

  const lockedCompletion = page.getByRole("button", {
    name: "Pflichtquiz zuerst bestehen",
  });
  await expect(lockedCompletion).toBeDisabled();

  await page
    .getByRole("button", { name: /Eine moeglichst kurze Frage ohne Kontext/ })
    .click();
  await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
  await expect(
    page.getByRole("main").getByText("Noch nicht bestanden", { exact: true }),
  ).toBeVisible();
  await expect(lockedCompletion).toBeDisabled();

  await page
    .getByRole("button", { name: /Ein klarer Auftrag mit Kontext und Pruefkriterien/ })
    .click();
  await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
  await expect(
    page.getByRole("main").getByText("Pflichtquiz bestanden", { exact: true }),
  ).toBeVisible();

  const completion = page.getByRole("button", { name: "Lektion abschließen" });
  await expect(completion).toBeEnabled();
  await completion.click();
  await expect(page.getByRole("button", { name: "Lektion abgeschlossen" })).toBeDisabled();

  const attempts = await storedAttempts(target);
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toMatchObject({
    attempt_number: 1,
    passed: false,
    score: 0,
    status: "graded",
    answer_count: 1,
    all_answers_correct: false,
    snapshot_question_count: 1,
  });
  expect(attempts[1]).toMatchObject({
    attempt_number: 2,
    passed: true,
    score: 100,
    status: "graded",
    answer_count: 1,
    all_answers_correct: true,
    snapshot_question_count: 1,
  });
});
