import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiAuthorization = {
  Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
};

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function resetSession(page: Page) {
  await page.context().clearCookies();
}

test("required submission review, revision and approval form one immutable attempt chain", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Submission lifecycle runs once on desktop Chromium",
  );
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const memberEmail = `submission-${suffix}@example.test`;
  const courseTitle = `Submission Workflow ${suffix}`;
  const courseSlug = `submission-workflow-${suffix}`;
  const lessonTitle = `Praxispruefung ${suffix}`;
  const firstTitle = `Erster Versuch ${suffix}`;
  const secondTitle = `Ueberarbeiteter Versuch ${suffix}`;
  const revisionFeedback = `Bitte ergaenze den Kontrollschritt ${suffix}.`;
  const revisionAnnotation = `Diese Kontrolle bitte nachvollziehbar belegen ${suffix}.`;
  const approvalFeedback = `Kontrollschritt ist jetzt vollstaendig ${suffix}.`;
  const approvalAnnotation = `Der Abbruchpfad ist jetzt klar beschrieben ${suffix}.`;
  const firstAnswer =
    "Ich pruefe die Eingaben, dokumentiere das Ergebnis und kontrolliere die Ausgabe manuell.";
  const secondAnswer =
    "Ich pruefe Eingaben und Ergebnis und habe nun einen dokumentierten Kontrollschritt mit Abbruchpfad ergaenzt.";
  const answerPlaceholder = "Dein Entwurf, Vorgehen und Prüfschritte...";
  const hydrationErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (error.message.includes("Hydration failed")) {
      hydrationErrors.push(error.message);
    }
  });
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Hydration failed")
    ) {
      hydrationErrors.push(message.text());
    }
  });
  let memberId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let blockId = "";
  let reviewerId = "";
  const requestIds: string[] = [];

  try {
    const [fixture] = await sql<
      {
        organization_id: string;
        owner_id: string;
        password_hash: string;
      }[]
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
    expect(fixture).toBeTruthy();
    reviewerId = fixture.owner_id;

    const [member] = await sql<{ id: string }[]>`
      insert into users (
        organization_id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        status
      ) values (
        ${fixture.organization_id},
        ${memberEmail},
        ${fixture.password_hash},
        'Sina',
        ${`Submission ${suffix}`},
        'member',
        'active'
      )
      returning id
    `;
    memberId = member.id;

    const [course] = await sql<{ id: string }[]>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        certificate_enabled,
        created_by_id
      ) values (
        ${fixture.organization_id},
        ${courseTitle},
        ${courseSlug},
        'Pflichtabgabe mit Review-Gate.',
        'Isolierter E2E-Kurs fuer den vollstaendigen Submission-Workflow.',
        'draft',
        true,
        ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;

    const [learningModule] = await sql<{ id: string }[]>`
      insert into modules (
        organization_id,
        title,
        description,
        folder,
        is_reusable,
        estimated_minutes
      ) values (
        ${fixture.organization_id},
        ${`Submission Modul ${suffix}`},
        'Ein Modul mit einer verpflichtenden Praxisabgabe.',
        'E2E',
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
      values (${fixture.organization_id}, ${courseId}, ${moduleId}, 0, true)
    `;

    const [lesson] = await sql<{ id: string }[]>`
      insert into lessons (
        organization_id,
        module_id,
        title,
        slug,
        summary,
        type,
        duration_minutes,
        sort_order,
        status
      ) values (
        ${fixture.organization_id},
        ${moduleId},
        ${lessonTitle},
        ${`praxispruefung-${suffix}`},
        'Reiche die Loesung ein und warte auf die Freigabe.',
        'assignment',
        15,
        0,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    const [block] = await sql<{ id: string }[]>`
      insert into content_blocks (
        lesson_id,
        type,
        title,
        sort_order,
        required,
        data
      ) values (
        ${lessonId},
        'submission',
        'Praxisloesung',
        0,
        true,
        ${sql.json({ prompt: "Dokumentiere Vorgehen, Ergebnis und Kontrollschritt." })}
      )
      returning id
    `;
    blockId = block.id;
    await sql`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
    `;
    await sql`
      insert into course_access_grants (
        organization_id,
        user_id,
        course_id,
        source
      ) values (
        ${fixture.organization_id},
        ${memberId},
        ${courseId},
        ${`direct:${courseId}`}
      )
    `;

    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();

    await resetSession(page);
    await loginAsMember(page, memberEmail);
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    await page.getByLabel("Titel", { exact: true }).fill(firstTitle);
    const firstAnswerEditor = page.getByLabel("Antwort", { exact: true });
    await expect(firstAnswerEditor).toHaveAttribute(
      "aria-placeholder",
      answerPlaceholder,
    );
    await expect(
      page.getByText(answerPlaceholder, { exact: true }),
    ).toBeVisible();
    await firstAnswerEditor.fill(firstAnswer);
    await expect(
      page.getByText(answerPlaceholder, { exact: true }),
    ).toHaveCount(0);
    await firstAnswerEditor.press("Control+A");
    await page.getByRole("button", { name: "Fett" }).click();
    await page.getByRole("button", { name: "Abgabe einreichen" }).click();
    await expect(
      page.getByText("Deine Abgabe wurde zur Bewertung eingereicht.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Wartet auf Bewertung", { exact: true })).toBeVisible();
    await expect(page.locator("strong", { hasText: firstAnswer })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pflichtabgabe zuerst freigeben" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Abgabe einreichen" })).toHaveCount(0);

    const duplicate = await request.post("/api/v1/submissions", {
      headers: apiAuthorization,
      data: {
        userId: memberId,
        courseId,
        lessonId,
        blockId,
        title: `API Duplikat ${suffix}`,
        content: "Dieser parallele Versuch muss abgewiesen werden.",
      },
    });
    requestIds.push(duplicate.headers()["x-request-id"]);
    expect(duplicate.status()).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      code: "conflict",
    });

    const [beforeReview] = await sql<
      { progress_count: number; certificate_count: number; attempt_count: number }[]
    >`
      select
        (select count(*)::int from lesson_progress where user_id = ${memberId} and lesson_id = ${lessonId}) as progress_count,
        (select count(*)::int from course_certificates where user_id = ${memberId} and course_id = ${courseId}) as certificate_count,
        (select count(*)::int from submissions where user_id = ${memberId} and course_id = ${courseId}) as attempt_count
    `;
    expect(beforeReview).toEqual({
      progress_count: 0,
      certificate_count: 0,
      attempt_count: 1,
    });

    await resetSession(page);
    await loginAsAdmin(page);
    await page.goto("/admin/tasks");
    await page.getByPlaceholder("Abgaben durchsuchen").fill(firstTitle);
    await page.locator("button").filter({ hasText: firstTitle }).click();
    const markedText = "kontrolliere die Ausgabe";
    await page
      .getByRole("textbox", { name: "Eingereichte Antwort" })
      .evaluate((element, selectedText) => {
        const textarea = element as HTMLTextAreaElement;
        const content = textarea.value;
        const startOffset = content.indexOf(selectedText);
        if (startOffset < 0) throw new Error("Test text not found.");
        textarea.focus();
        textarea.setSelectionRange(
          startOffset,
          startOffset + selectedText.length,
        );
      }, markedText);
    await page
      .getByRole("button", { name: "Textstelle kommentieren" })
      .click();
    await page.getByLabel("Kommentar", { exact: true }).fill(revisionAnnotation);
    await page
      .getByRole("button", { name: "Kommentar uebernehmen" })
      .click();
    await expect(page.getByText("Kommentare (1)", { exact: true })).toBeVisible();
    await page.getByLabel("Ergebnis").selectOption("revision");
    await page.getByLabel("Punkte").fill("62");
    await page.getByLabel("Feedback", { exact: true }).fill(revisionFeedback);
    await page.getByRole("button", { name: "Bewertung speichern" }).click();
    await expect(
      page.getByText("Ueberarbeitung angefordert.", { exact: true }),
    ).toBeVisible();

    await resetSession(page);
    await loginAsMember(page, memberEmail);
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    await expect(page.getByText(revisionFeedback, { exact: true })).toBeVisible();
    expect(hydrationErrors).toEqual([]);
    await expect(
      page.getByText(answerPlaceholder, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(markedText, { exact: true })).toBeVisible();
    await expect(page.getByText(revisionAnnotation, { exact: true })).toBeVisible();
    await expect(page.getByText("Ergebnis: 62 %", { exact: true })).toBeVisible();
    await page.getByLabel("Titel", { exact: true }).fill(secondTitle);
    await page
      .getByLabel("Antwort", { exact: true })
      .fill(secondAnswer);
    await page
      .getByRole("button", { name: "Überarbeitung einreichen" })
      .click();
    await expect(
      page.getByText("Deine Abgabe wurde zur Bewertung eingereicht.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/Versuch 2 \|/)).toBeVisible();

    const attempts = await sql<
      {
        id: string;
        attempt_number: number;
        supersedes_id: string | null;
        status: string;
        content_format: string;
        has_rich_text: boolean;
        content_projection_version: number;
      }[]
    >`
      select id, attempt_number, supersedes_id, status::text, content_format,
             rich_text is not null as has_rich_text, content_projection_version
      from submissions
      where user_id = ${memberId}
        and course_id = ${courseId}
      order by attempt_number
    `;
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      attempt_number: 1,
      supersedes_id: null,
      status: "revision",
      content_format: "rich_text",
      has_rich_text: true,
      content_projection_version: 1,
    });
    expect(attempts[1]).toMatchObject({
      attempt_number: 2,
      supersedes_id: attempts[0]?.id,
      status: "in_review",
      content_format: "rich_text",
      has_rich_text: true,
      content_projection_version: 1,
    });

    await resetSession(page);
    await loginAsAdmin(page);
    await page.goto("/admin/tasks");
    await page.getByPlaceholder("Abgaben durchsuchen").fill(secondTitle);
    await page.locator("button").filter({ hasText: secondTitle }).click();
    await expect(
      page.getByRole("heading", { name: "Versuchshistorie (2)" }),
    ).toBeVisible();
    await expect(page.getByText(revisionFeedback, { exact: true })).toBeVisible();
    const invalidTextRange = await request.post(
      `/api/v1/submissions/${attempts[1]!.id}/review`,
      {
        headers: apiAuthorization,
        data: {
          reviewerId,
          decision: "approved",
          feedback: approvalFeedback,
          score: 94,
          annotations: [
            {
              type: "text_range",
              body: "Dieser Bereich liegt ausserhalb der Antwort.",
              startOffset: secondAnswer.length,
              endOffset: secondAnswer.length + 10,
            },
          ],
        },
      },
    );
    requestIds.push(invalidTextRange.headers()["x-request-id"]);
    expect(invalidTextRange.status()).toBe(422);
    const [afterInvalidTextRange] = await sql<
      Array<{ review_count: number; annotation_count: number; status: string }>
    >`
      select
        (select count(*)::int from submission_reviews where submission_id = ${attempts[1]!.id}) as review_count,
        (select count(*)::int from submission_review_annotations where submission_id = ${attempts[1]!.id}) as annotation_count,
        (select status::text from submissions where id = ${attempts[1]!.id}) as status
    `;
    expect(afterInvalidTextRange).toEqual({
      review_count: 0,
      annotation_count: 0,
      status: "in_review",
    });
    const approved = await request.post(
      `/api/v1/submissions/${attempts[1]!.id}/review`,
      {
        headers: apiAuthorization,
        data: {
          reviewerId,
          decision: "approved",
          feedback: approvalFeedback,
          score: 94,
          annotations: [
            {
              type: "text_range",
              body: approvalAnnotation,
              startOffset: secondAnswer.indexOf("Abbruchpfad"),
              endOffset:
                secondAnswer.indexOf("Abbruchpfad") + "Abbruchpfad".length,
            },
          ],
        },
      },
    );
    requestIds.push(approved.headers()["x-request-id"]);
    expect(approved.status()).toBe(200);
    await expect(approved.json()).resolves.toMatchObject({
      data: {
        submission: { id: attempts[1]!.id, status: "approved", attemptNumber: 2 },
        review: {
          decision: "approved",
          score: 94,
          annotations: [
            {
              type: "text_range",
              body: approvalAnnotation,
            },
          ],
        },
      },
    });
    await page.reload();
    await expect(page.getByText(approvalFeedback, { exact: true })).toBeVisible();

    await resetSession(page);
    await loginAsMember(page, memberEmail);
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    await expect(page.getByText("Freigegeben", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(approvalFeedback, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(approvalAnnotation, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Ergebnis: 94 %", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Lektion abschließen" }).click();
    await expect(
      page.getByRole("button", { name: "Lektion abgeschlossen" }),
    ).toBeDisabled();

    const [completed] = await sql<
      {
        progress_status: string;
        certificate_count: number;
        review_count: number;
        notification_count: number;
        annotation_count: number;
      }[]
    >`
      select
        (select status::text from lesson_progress where user_id = ${memberId} and lesson_id = ${lessonId}) as progress_status,
        (select count(*)::int from course_certificates where user_id = ${memberId} and course_id = ${courseId} and revoked_at is null) as certificate_count,
        (select count(*)::int from submission_reviews sr join submissions s on s.id = sr.submission_id where s.user_id = ${memberId} and s.course_id = ${courseId}) as review_count,
        (select count(*)::int from notifications where user_id = ${memberId} and type = 'submission') as notification_count,
        (select count(*)::int from submission_review_annotations sra join submissions s on s.id = sra.submission_id where s.user_id = ${memberId} and s.course_id = ${courseId}) as annotation_count
    `;
    expect(completed).toEqual({
      progress_status: "completed",
      certificate_count: 1,
      review_count: 2,
      notification_count: 2,
      annotation_count: 2,
    });

    await expect(
      sql`
        update submission_reviews
        set feedback = 'nachtraeglich veraendert'
        where submission_id = ${attempts[0]!.id}
      `,
    ).rejects.toMatchObject({ code: "55000" });
  } finally {
    for (const requestId of requestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (courseId) {
      await sql`delete from submissions where course_id = ${courseId} and supersedes_id is not null`;
      await sql`delete from submissions where course_id = ${courseId}`;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (memberId) await sql`delete from users where id = ${memberId}`;
    await sql.end();
  }
});
