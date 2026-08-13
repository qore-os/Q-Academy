import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /Bei .* anmelden/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("lesson feedback is private, searchable, actionable, and responsive", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.setTimeout(150_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const memberEmail = `lesson-feedback-${suffix}@example.test`;
  const memberFirstName = `Feedback${suffix}`;
  const memberLastName = "Tester";
  const content =
    testInfo.project.name === "mobile"
      ? ""
      : `Der Praxisbezug ist besonders klar ${suffix}.`;
  const foreignSecret = `FREMDES_FEEDBACK_${suffix}`;
  let memberId = "";
  let noAccessMemberId = "";
  let feedbackId = "";
  const apiFeedbackIds: string[] = [];
  const idempotencyKeys: string[] = [];
  let foreignOrganizationId = "";
  let foreignFeedbackId = "";
  let adminContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        owner_id: string;
        password_hash: string;
        course_id: string;
        course_slug: string;
        course_title: string;
        snapshot: {
          modules: Array<{
            id: string;
            lessons: Array<{ id: string; title: string }>;
          }>;
        };
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        owner.password_hash,
        c.id as course_id,
        c.slug as course_slug,
        c.title as course_title,
        cv.snapshot
      from users owner
      join courses c
        on c.organization_id = owner.organization_id
       and c.slug = 'ki-grundlagen'
       and c.status = 'published'
      join course_versions cv on cv.id = c.published_version_id
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    const learningModule = fixture.snapshot.modules[0]!;
    const lesson = learningModule.lessons[0]!;
    expect(lesson).toBeTruthy();

    const [member] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${fixture.organization_id}, ${memberEmail}, ${fixture.password_hash},
        ${memberFirstName}, ${memberLastName}, 'member', 'active'
      )
      returning id
    `;
    memberId = member.id;
    const [noAccessMember] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${fixture.organization_id}, ${`no-feedback-access-${suffix}@example.test`},
        ${fixture.password_hash}, 'No Access', 'Feedback', 'member', 'active'
      )
      returning id
    `;
    noAccessMemberId = noAccessMember.id;
    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${fixture.course_id}, true)
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${fixture.organization_id}, ${memberId}, ${fixture.course_id},
        ${`direct:${enrollment.id}`}
      )
    `;
    await sql`
      insert into course_module_access_overrides (
        organization_id, course_id, module_id, user_id, state,
        reason, created_by_id
      ) values (
        ${fixture.organization_id}, ${fixture.course_id}, ${learningModule.id},
        ${memberId}, 'read_only', 'Feedback E2E read-only policy',
        ${fixture.owner_id}
      )
    `;

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign feedback ${suffix}`}, ${`foreign-feedback-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignMember] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${foreignOrganizationId}, ${`foreign-feedback-${suffix}@example.test`},
        ${fixture.password_hash}, 'Foreign', 'Member', 'member', 'active'
      )
      returning id
    `;
    const [foreignFeedback] = await sql<Array<{ id: string }>>`
      insert into feedback_entries (
        organization_id, user_id, type, rating, content
      ) values (
        ${foreignOrganizationId}, ${foreignMember.id}, 'platform', 1,
        ${foreignSecret}
      )
      returning id
    `;
    foreignFeedbackId = foreignFeedback.id;

    await login(page, memberEmail);
    await page.goto(
      `/academy/courses/${fixture.course_slug}/learn/${lesson.id}`,
    );
    await expect(page.getByText("Nur lesen", { exact: true }).first()).toBeVisible();
    const feedbackSection = page
      .getByRole("heading", { name: "Feedback zu dieser Lektion" })
      .locator("..");
    await expect(feedbackSection).toBeVisible();
    await feedbackSection
      .getByRole("radio", { name: "4 von 5 Sternen" })
      .click();
    if (content) {
      await feedbackSection.getByLabel(/Kommentar/).fill(content);
    }
    await feedbackSection
      .getByRole("button", { name: "Feedback senden" })
      .click();
    await expect(
      feedbackSection.getByText(
        "Danke, dein Lektionsfeedback wurde gesendet.",
      ),
    ).toBeVisible();
    await expect(
      feedbackSection.getByRole("button", { name: "Gesendet" }),
    ).toBeDisabled();
    await expect(page.locator("body")).not.toContainText(foreignSecret);

    const feedbackRows = await sql<
      Array<{
        id: string;
        user_id: string;
        course_id: string;
        lesson_id: string;
        type: string;
        rating: number;
        content: string;
      }>
    >`
      select id, user_id, course_id, lesson_id, type, rating, content
      from feedback_entries
      where organization_id = ${fixture.organization_id}
        and user_id = ${memberId}
        and lesson_id = ${lesson.id}
      order by created_at desc
    `;
    expect(feedbackRows).toHaveLength(1);
    expect(feedbackRows[0]).toMatchObject({
      user_id: memberId,
      course_id: fixture.course_id,
      lesson_id: lesson.id,
      type: "lesson",
      rating: 4,
      content,
    });
    feedbackId = feedbackRows[0]!.id;

    adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto("/admin/tasks");
    await adminPage
      .getByPlaceholder("Feedback oder Person suchen")
      .fill(memberFirstName);
    const feedbackArticle = adminPage
      .getByRole("article")
      .filter({ hasText: `${memberFirstName} ${memberLastName}` });
    await expect(feedbackArticle).toBeVisible();
    await expect(feedbackArticle).toContainText(lesson.title);
    await adminPage.getByLabel("Kurs filtern").selectOption(fixture.course_id);
    await adminPage.getByLabel("Mitglied filtern").selectOption(memberId);
    await adminPage.getByLabel("Status filtern").selectOption("open");
    await adminPage.getByLabel("Feedback sortieren").selectOption("rating_asc");
    await expect(adminPage.getByText("1 Treffer", { exact: true })).toBeVisible();

    if (testInfo.project.name === "chromium") {
      await adminPage.getByLabel("Status filtern").selectOption("all");
      await adminPage
        .getByRole("button", {
          name: `Nachricht an ${memberFirstName} ${memberLastName}`,
        })
        .click();
      await adminPage
        .getByLabel("Nachricht", { exact: true })
        .fill(`Danke fuer den konkreten Hinweis ${suffix}.`);
      await adminPage.getByRole("button", { name: "E-Mail vormerken" }).click();
      await expect(
        adminPage.getByText(
          "Die Nachricht wurde für den E-Mail-Versand vorgemerkt.",
        ),
      ).toBeVisible();

      const [queued] = await sql<
        Array<{
          id: string;
          event: string;
          recipient_email: string;
          status: string;
          payload: Record<string, unknown>;
          feedback_status: string;
          activity_count: number;
        }>
      >`
        select
          d.id, d.event, d.recipient_email, d.status, d.payload,
          f.status as feedback_status,
          (
            select count(*)::int from activity_events a
            where a.entity_id = f.id and a.type = 'feedback.reply.queued'
          ) as activity_count
        from feedback_entries f
        join email_deliveries d on d.user_id = f.user_id
        where f.id = ${feedbackId} and d.event = 'feedback.reply'
        order by d.created_at desc
        limit 1
      `;
      expect(queued).toMatchObject({
        event: "feedback.reply",
        recipient_email: memberEmail,
        status: "pending",
        feedback_status: "reviewed",
        activity_count: 1,
      });
      expect(queued.payload).toMatchObject({ v: 2, alg: "A256GCM" });
      expect(JSON.stringify(queued.payload)).not.toContain(suffix);

      const foreignReply = await request.post(
        `/api/v1/feedback/${foreignFeedbackId}/reply`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": `foreign-feedback-reply-${suffix}`,
          },
          data: {
            subject: "Tenant safety check",
            message: "This must not be queued.",
          },
        },
      );
      expect(foreignReply.status()).toBe(404);
      const [foreignDeliveryCount] = await sql<Array<{ count: number }>>`
        select count(*)::int as count from email_deliveries
        where user_id = ${foreignMember.id} and event = 'feedback.reply'
      `;
      expect(foreignDeliveryCount.count).toBe(0);

      await adminPage.getByRole("button", { name: "Wieder öffnen" }).click();
      await expect(adminPage.getByText("Feedback wieder geöffnet.")).toBeVisible();
      await adminPage.getByRole("button", { name: "Erledigt" }).click();
      await expect(adminPage.getByText("Als erledigt markiert.")).toBeVisible();
      const [completedFeedback] = await sql<Array<{ status: string }>>`
        select status from feedback_entries where id = ${feedbackId}
      `;
      expect(completedFeedback.status).toBe("reviewed");
      await adminPage.getByLabel("Status filtern").selectOption("completed");
      await expect(
        adminPage.getByRole("button", { name: "Wieder öffnen" }),
      ).toBeVisible();

      const lessonKey = `lesson-feedback-api-${suffix}`;
      idempotencyKeys.push(lessonKey);
      const lessonApiResponse = await request.post("/api/v1/feedback", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": lessonKey,
        },
        data: {
          userId: memberId,
          courseId: fixture.course_id,
          lessonId: lesson.id,
          type: "lesson",
          rating: 5,
          content: "",
        },
      });
      expect(lessonApiResponse.status()).toBe(201);
      const lessonApiBody = (await lessonApiResponse.json()) as {
        data: { id: string; content: string };
      };
      apiFeedbackIds.push(lessonApiBody.data.id);
      expect(lessonApiBody.data.content).toBe("");

      const courseKey = `course-feedback-api-${suffix}`;
      idempotencyKeys.push(courseKey);
      const courseApiResponse = await request.post("/api/v1/feedback", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": courseKey,
        },
        data: {
          userId: memberId,
          courseId: fixture.course_id,
          type: "course",
          rating: 5,
          content: `API-Kursfeedback ${suffix}`,
        },
      });
      expect(courseApiResponse.status()).toBe(201);
      const courseApiBody = (await courseApiResponse.json()) as {
        data: { id: string; courseId: string };
      };
      apiFeedbackIds.push(courseApiBody.data.id);
      expect(courseApiBody.data.courseId).toBe(fixture.course_id);

      const deniedKey = `course-feedback-denied-${suffix}`;
      idempotencyKeys.push(deniedKey);
      const deniedCourseFeedback = await request.post("/api/v1/feedback", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": deniedKey,
        },
        data: {
          userId: noAccessMemberId,
          courseId: fixture.course_id,
          type: "course",
          rating: 2,
          content: "Darf ohne Lernzugriff nicht gespeichert werden.",
        },
      });
      expect(deniedCourseFeedback.status()).toBe(403);
      const [deniedCount] = await sql<Array<{ count: number }>>`
        select count(*)::int as count from feedback_entries
        where user_id = ${noAccessMemberId}
      `;
      expect(deniedCount.count).toBe(0);
    } else {
      await expect(
        adminPage.getByRole("button", {
          name: `Nachricht an ${memberFirstName} ${memberLastName}`,
        }),
      ).toBeVisible();
      await adminPage.screenshot({
        path: testInfo.outputPath("lesson-feedback-mobile.png"),
        fullPage: true,
      });
    }
  } finally {
    await adminContext?.close().catch(() => undefined);
    if (feedbackId) {
      await sql`delete from webhook_deliveries where payload->'data'->>'feedbackId' = ${feedbackId}`;
      await sql`delete from webhook_deliveries where payload->'data'->>'id' = ${feedbackId}`;
      await sql`delete from activity_events where entity_id = ${feedbackId}`;
      await sql`delete from api_audit_logs where resource_id = ${feedbackId}`;
    }
    for (const apiFeedbackId of apiFeedbackIds) {
      await sql`delete from webhook_deliveries where payload->'data'->>'id' = ${apiFeedbackId}`;
      await sql`delete from activity_events where entity_id = ${apiFeedbackId}`;
      await sql`delete from api_audit_logs where resource_id = ${apiFeedbackId}`;
    }
    if (idempotencyKeys.length) {
      await sql`delete from api_idempotency_keys where key = any(${idempotencyKeys})`;
    }
    if (memberId) {
      await sql`delete from users where id = ${memberId}`;
    }
    if (noAccessMemberId) {
      await sql`delete from users where id = ${noAccessMemberId}`;
    }
    if (foreignFeedbackId) {
      await sql`delete from api_audit_logs where resource_id = ${foreignFeedbackId}`;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});
