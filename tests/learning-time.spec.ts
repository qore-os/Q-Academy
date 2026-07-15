import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const appOrigin =
  process.env.LEARNING_TIME_TEST_BASE_URL ?? "http://127.0.0.1:3000";

test.use({ baseURL: appOrigin });

async function login(page: Page, role: "admin" | "member") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name:
        role === "admin"
          ? /^(Admin-Demo|Als Admin testen)$/
          : /^(Lernenden-Demo|Als Mitglied testen)$/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

async function openFirstAccessibleLesson(page: Page) {
  await page.goto("/academy");
  const courseHref = await page
    .locator('a[href^="/academy/courses/"]')
    .first()
    .getAttribute("href");
  if (!courseHref) throw new Error("No accessible course link was found.");
  await page.goto(courseHref);
  const lessonHref = await page
    .locator('a[href*="/learn/"]')
    .first()
    .getAttribute("href");
  if (!lessonHref) throw new Error("No accessible lesson link was found.");
  return lessonHref;
}

function sessionMutationHeaders() {
  return {
    "Content-Type": "application/json",
    Origin: appOrigin,
    "Sec-Fetch-Site": "same-origin",
  };
}

function formattedLearningTime(seconds: number) {
  if (seconds < 60) return `${seconds} Sek.`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder ? `${minutes} Min. ${remainder} Sek.` : `${minutes} Min.`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? `${hours} Std. ${remainingMinutes} Min.`
    : `${hours} Std.`;
}

test("visible lesson tracking is idle in background and reaches admin analytics", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop heartbeat lifecycle");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const startedAt = new Date();
  let memberId = "";
  let courseId = "";
  let lessonId = "";
  try {
    await login(page, "member");
    const lessonHref = await openFirstAccessibleLesson(page);
    const heartbeatResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/learning-time/heartbeat") &&
        response.request().method() === "POST",
    );
    await page.bringToFront();
    await page.goto(lessonHref);
    const initialResponse = await heartbeatResponse;
    expect(initialResponse.status()).toBe(200);
    expect(initialResponse.request().postDataJSON()).toEqual({
      courseId: expect.any(String),
      lessonId: expect.any(String),
      trackingSessionId: expect.any(String),
      sequence: 0,
    });

    const [identity] = await sql<
      Array<{ id: string; organization_id: string }>
    >`
      select id, organization_id from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    if (!identity) throw new Error("Seeded learner is missing.");
    memberId = identity.id;
    const [tracked] = await sql<
      Array<{
        id: string;
        course_id: string;
        course_version_id: string;
        lesson_id: string;
        lesson_title: string;
        last_sequence: number;
      }>
    >`
      select id, course_id, course_version_id, lesson_id, lesson_title,
             last_sequence
      from lesson_learning_time_sessions
      where organization_id = ${identity.organization_id}
        and user_id = ${identity.id}
        and started_at >= ${startedAt}
      order by last_heartbeat_at desc, started_at desc
      limit 1
    `;
    if (!tracked) throw new Error("Client tracker did not persist a session.");
    courseId = tracked.course_id;
    lessonId = tracked.lesson_id;
    expect(tracked.course_version_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tracked.lesson_title.trim().length).toBeGreaterThan(0);
    expect(tracked.last_sequence).toBe(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      Object.defineProperty(document, "hasFocus", {
        configurable: true,
        value: () => false,
      });
      window.dispatchEvent(new Event("blur"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(16_500);
    const [backgroundState] = await sql<Array<{ last_sequence: number }>>`
      select last_sequence from lesson_learning_time_sessions
      where id = ${tracked.id}
    `;
    expect(backgroundState.last_sequence).toBe(0);

    await sql`
      update lesson_learning_time_sessions
      set last_heartbeat_at = now() - interval '15 seconds',
          updated_at = now() - interval '15 seconds'
      where id = ${tracked.id}
    `;
    const nextBody = {
      courseId,
      lessonId,
      trackingSessionId: tracked.id,
      sequence: 1,
    };
    const credited = await page.request.post("/api/learning-time/heartbeat", {
      headers: sessionMutationHeaders(),
      data: nextBody,
    });
    expect(credited.status()).toBe(200);
    expect((await credited.json()).data.creditedSeconds).toBeGreaterThanOrEqual(14);

    const duplicate = await page.request.post("/api/learning-time/heartbeat", {
      headers: sessionMutationHeaders(),
      data: nextBody,
    });
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).data.duplicate).toBe(true);

    await sql`
      update lesson_learning_time_sessions
      set last_heartbeat_at = now() - interval '15 seconds',
          updated_at = now() - interval '15 seconds'
      where id = ${tracked.id}
    `;
    const parallelResults = await Promise.all(
      [1, 2].map(() =>
        page.request.post("/api/learning-time/heartbeat", {
          headers: sessionMutationHeaders(),
          data: { ...nextBody, sequence: 2 },
        }),
      ),
    );
    expect(parallelResults.every((response) => response.status() === 200)).toBe(
      true,
    );
    const parallelBodies = await Promise.all(
      parallelResults.map((response) => response.json()),
    );
    expect(parallelBodies.filter((body) => body.data.duplicate).length).toBe(1);

    const crossOrigin = await page.request.post(
      "/api/learning-time/heartbeat",
      {
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          "Sec-Fetch-Site": "cross-site",
        },
        data: { ...nextBody, sequence: 3 },
      },
    );
    expect(crossOrigin.status()).toBe(403);

    await login(page, "admin");
    await page.goto("/admin/analytics");
    await page
      .getByLabel("Mitgliederstatistiken durchsuchen")
      .fill("lea@q-academy.de");
    const memberRow = page.locator("tbody tr").filter({
      hasText: "lea@q-academy.de",
    });
    await expect(memberRow.getByText(/Sek\.|Min\.|Std\./)).toBeVisible();
    await memberRow.getByRole("button", { name: /Kursdetails fuer Lea/ }).click();
    await expect(
      page.getByText("Aktive Lernzeit:", { exact: false }).first(),
    ).toBeVisible();
  } finally {
    if (memberId) {
      await sql`
        delete from lesson_learning_time_sessions
        where user_id = ${memberId}
          and started_at >= ${startedAt}
      `;
    }
    await sql.end();
  }
});

test("mobile member analytics shows measured learning time without overflow", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile analytics layout");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const trackingSessionId = randomUUID();
  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        user_id: string;
        course_id: string;
        course_version_id: string;
        lesson_id: string;
        lesson_title: string;
      }>
    >`
      select u.organization_id, u.id as user_id, e.course_id,
             c.published_version_id as course_version_id,
             l.id as lesson_id, l.title as lesson_title
      from users u
      join enrollments e on e.user_id = u.id
      join courses c
        on c.id = e.course_id
       and c.organization_id = u.organization_id
      join course_modules cm on cm.course_id = e.course_id
      join lessons l
        on l.module_id = cm.module_id
       and l.organization_id = u.organization_id
      where u.email = 'lea@q-academy.de'
      order by l.sort_order, l.id
      limit 1
    `;
    if (!fixture) throw new Error("Mobile learning-time fixture is missing.");
    await sql`
      insert into lesson_learning_time_sessions (
        id, organization_id, user_id, course_id, course_version_id, lesson_id,
        lesson_title, last_sequence, active_seconds, started_at,
        last_heartbeat_at, updated_at
      ) values (
        ${trackingSessionId}, ${fixture.organization_id}, ${fixture.user_id},
        ${fixture.course_id}, ${fixture.course_version_id},
        ${fixture.lesson_id}, ${fixture.lesson_title}, 5, 75,
        now() - interval '75 seconds', now(), now()
      )
    `;
    const [total] = await sql<Array<{ value: number }>>`
      select coalesce(sum(active_seconds), 0)::int as value
      from lesson_learning_time_sessions
      where organization_id = ${fixture.organization_id}
        and user_id = ${fixture.user_id}
    `;

    await login(page, "admin");
    await page.goto("/admin/analytics");
    await page
      .getByLabel("Mitgliederstatistiken durchsuchen")
      .fill("lea@q-academy.de");
    const analytics = page.locator(
      'section[aria-labelledby="member-analytics-title"]',
    );
    const card = analytics.locator("article").filter({
      hasText: "lea@q-academy.de",
    });
    await expect(card.getByText("Aktive Lernzeit", { exact: true })).toBeVisible();
    await expect(card.getByText(formattedLearningTime(total.value))).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await sql`delete from lesson_learning_time_sessions where id = ${trackingSessionId}`;
    await sql.end();
  }
});
