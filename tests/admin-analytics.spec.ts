import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

type AnalyticsFixture = {
  organizationId: string;
  adminId: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  formulaUserId: string;
  formulaName: string;
  targetCourseId: string;
  targetCourseTitle: string;
  relatedCourseId: string;
  relatedCourseTitle: string;
  enrollmentId: string;
  exclusiveModuleId: string;
  sharedModuleId: string;
  exclusiveLessonId: string;
  sharedLessonId: string;
  attemptId: string;
  certificateId: string | null;
};

type ForeignFixture = {
  organizationId: string;
  email: string;
};

async function login(page: Page, role: "admin" | "trainer" | "member") {
  await page.context().clearCookies();
  await page.goto("/login");
  if (role === "admin" || role === "member") {
    await page
      .getByRole("button", {
        name:
          role === "admin"
            ? /Admin-Demo|Als Admin testen/
            : /Lernenden-Demo|Als Mitglied testen/,
      })
      .click();
  } else {
    await page.getByLabel("E-Mail-Adresse").fill("marco@q-academy.de");
    await page.locator('input[name="password"]').fill("Demo123!");
    await page.getByRole("button", { name: /anmelden$/ }).click();
  }
  await page.waitForURL(role === "member" ? "**/academy" : "**/admin");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

async function createAnalyticsFixture({
  progressOnSharedModule,
  activeCertificate,
}: {
  progressOnSharedModule: boolean;
  activeCertificate: boolean;
}): Promise<AnalyticsFixture> {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [identity] = await client<
      Array<{
        organization_id: string;
        admin_id: string;
        organization_name: string;
      }>
    >`
      select u.organization_id, u.id as admin_id, o.name as organization_name
      from users u
      inner join organizations o on o.id = u.organization_id
      where u.email = 'admin@q-academy.de'
      limit 1
    `;
    if (!identity) throw new Error("Analytics test admin was not found.");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const memberName = `Analytics Mitglied ${suffix}`;
    const memberEmail = `analytics-${suffix}@example.test`;
    const targetCourseTitle = `Analytics Reset ${suffix}`;
    const relatedCourseTitle = `Analytics Parallel ${suffix}`;
    const formulaName = '=HYPERLINK("https://example.test","Analytics")';
    const questionId = randomUUID();

    return await client.begin(async (tx) => {
      const [member] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status, department, last_login_at
        ) values (
          ${identity.organization_id}, ${memberEmail}, 'unused-test-hash',
          'Analytics', ${`Mitglied ${suffix}`}, 'member', 'active', 'Tests',
          now() - interval '2 hours'
        ) returning id
      `;
      const [formulaUser] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${identity.organization_id}, ${`formula-${suffix}@example.test`},
          'unused-test-hash', ${formulaName}, 'CSV', 'member', 'active'
        ) returning id
      `;
      const [targetCourse] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description,
          status, certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${targetCourseTitle},
          ${`analytics-reset-${suffix}`}, 'Analytics Testkurs',
          'Isolierter Kurs fuer den Analytics-Reset.', 'published', true,
          ${identity.admin_id}
        ) returning id
      `;
      const [relatedCourse] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description,
          status, certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${relatedCourseTitle},
          ${`analytics-parallel-${suffix}`}, 'Analytics Parallelkurs',
          'Kurs fuer den Test gemeinsam genutzter Module.', 'published', false,
          ${identity.admin_id}
        ) returning id
      `;
      const [exclusiveModule] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, folder, is_reusable, estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Exklusiv ${suffix}`}, 'Tests', false, 7
        ) returning id
      `;
      const [sharedModule] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, folder, is_reusable, estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Geteilt ${suffix}`}, 'Tests', true, 5
        ) returning id
      `;
      await tx`
        insert into course_modules (
          organization_id, course_id, module_id, sort_order, is_required
        )
        values
          (${identity.organization_id}, ${targetCourse.id}, ${exclusiveModule.id}, 0, true),
          (${identity.organization_id}, ${targetCourse.id}, ${sharedModule.id}, 1, true),
          (${identity.organization_id}, ${relatedCourse.id}, ${sharedModule.id}, 0, true)
      `;
      const [exclusiveLesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, summary, type,
          duration_minutes, sort_order, status
        ) values (
          ${identity.organization_id}, ${exclusiveModule.id},
          'Exklusive Analytics Lektion', 'exklusive-analytics-lesson',
          'Nur im Zielkurs.', 'lesson', 7, 0, 'published'
        ) returning id
      `;
      const [sharedLesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, summary, type,
          duration_minutes, sort_order, status
        ) values (
          ${identity.organization_id}, ${sharedModule.id},
          'Geteilte Analytics Lektion', 'geteilte-analytics-lesson',
          'In beiden Kursen.', 'lesson', 5, 0, 'published'
        ) returning id
      `;
      const [enrollment] = await tx<Array<{ id: string }>>`
        insert into enrollments (
          user_id, course_id, status, access_active, progress,
          last_accessed_at, completed_at
        ) values (
          ${member.id}, ${targetCourse.id}, 'completed', true, 100,
          now() - interval '30 minutes', now() - interval '30 minutes'
        ) returning id
      `;
      await tx`
        insert into enrollments (user_id, course_id, status, access_active, progress)
        values (${member.id}, ${relatedCourse.id}, 'not_started', true, 0)
      `;
      await tx`
        insert into lesson_progress (
          user_id, lesson_id, status, percent, started_at, completed_at
        ) values (
          ${member.id}, ${exclusiveLesson.id}, 'completed', 100,
          now() - interval '1 hour', now() - interval '45 minutes'
        )
      `;
      if (progressOnSharedModule) {
        await tx`
          insert into lesson_progress (
            user_id, lesson_id, status, percent, started_at, completed_at
          ) values (
            ${member.id}, ${sharedLesson.id}, 'completed', 100,
            now() - interval '50 minutes', now() - interval '40 minutes'
          )
        `;
      }
      const [attempt] = await tx<Array<{ id: string }>>`
        insert into assessment_attempts (
          organization_id, user_id, course_id, lesson_id, attempt_number,
          status, score, passed, question_count, correct_count,
          assessment_snapshot, submitted_at, graded_at
        ) values (
          ${identity.organization_id}, ${member.id}, ${targetCourse.id},
          ${exclusiveLesson.id}, 1, 'graded', 100, true, 1, 1,
          ${tx.json({
            schemaVersion: 1,
            questions: [
              {
                blockId: questionId,
                title: "Testfrage",
                prompt: "Test?",
                options: ["Ja", "Nein"],
                correctOption: 0,
                required: true,
              },
            ],
          })}, now(), now()
        ) returning id
      `;
      await tx`
        insert into assessment_answers (
          organization_id, attempt_id, block_id, question_snapshot,
          selected_option, answer_snapshot, correct
        ) values (
          ${identity.organization_id}, ${attempt.id}, ${questionId},
          ${tx.json({
            blockId: questionId,
            title: "Testfrage",
            prompt: "Test?",
            options: ["Ja", "Nein"],
            correctOption: 0,
            required: true,
          })}, 0, ${tx.json({ selectedOption: 0, optionText: "Ja" })}, true
        )
      `;
      await tx`
        insert into submissions (
          organization_id, user_id, course_id, lesson_id, title, content, status
        ) values (
          ${identity.organization_id}, ${member.id}, ${targetCourse.id},
          ${exclusiveLesson.id}, 'Analytics Einreichung',
          'Diese Einreichung wird nur nach expliziter Auswahl geloescht.', 'approved'
        )
      `;
      let certificateId: string | null = null;
      if (activeCertificate) {
        const [certificate] = await tx<Array<{ id: string }>>`
          insert into course_certificates (
            organization_id, user_id, course_id, certificate_number,
            recipient_name, course_title, organization_name, completed_at,
            issued_by_id
          ) values (
            ${identity.organization_id}, ${member.id}, ${targetCourse.id},
            ${`QA-ANALYTICS-${suffix}`}, ${memberName}, ${targetCourseTitle},
            ${identity.organization_name}, now() - interval '30 minutes',
            ${identity.admin_id}
          ) returning id
        `;
        certificateId = certificate.id;
      }
      await tx`
        insert into activity_events (
          organization_id, user_id, type, entity_type, entity_id, metadata
        ) values (
          ${identity.organization_id}, ${member.id}, 'lesson.completed',
          'lesson', ${exclusiveLesson.id}, ${tx.json({ courseId: targetCourse.id })}
        )
      `;

      return {
        organizationId: identity.organization_id,
        adminId: identity.admin_id,
        memberId: member.id,
        memberName,
        memberEmail,
        formulaUserId: formulaUser.id,
        formulaName,
        targetCourseId: targetCourse.id,
        targetCourseTitle,
        relatedCourseId: relatedCourse.id,
        relatedCourseTitle,
        enrollmentId: enrollment.id,
        exclusiveModuleId: exclusiveModule.id,
        sharedModuleId: sharedModule.id,
        exclusiveLessonId: exclusiveLesson.id,
        sharedLessonId: sharedLesson.id,
        attemptId: attempt.id,
        certificateId,
      };
    });
  } finally {
    await client.end();
  }
}

async function createForeignFixture(): Promise<ForeignFixture> {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return await client.begin(async (tx) => {
      const [organization] = await tx<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Foreign Analytics ${suffix}`}, ${`foreign-analytics-${suffix}`})
        returning id
      `;
      const email = `foreign-analytics-${suffix}@example.test`;
      const [member] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${organization.id}, ${email}, 'unused-test-hash', 'Foreign', 'Analytics',
          'member', 'active'
        ) returning id
      `;
      const [course] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description, status
        ) values (
          ${organization.id}, ${`Foreign Course ${suffix}`}, ${`foreign-${suffix}`},
          'Foreign', 'Tenant-Isolationstest', 'published'
        ) returning id
      `;
      await tx`
        insert into enrollments (user_id, course_id, status, progress)
        values (${member.id}, ${course.id}, 'in_progress', 77)
      `;
      return { organizationId: organization.id, email };
    });
  } finally {
    await client.end();
  }
}

async function cleanupAnalyticsFixture(fixture: AnalyticsFixture) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const entityIds = [
      fixture.targetCourseId,
      fixture.relatedCourseId,
      fixture.enrollmentId,
      fixture.exclusiveLessonId,
      fixture.sharedLessonId,
      fixture.attemptId,
      ...(fixture.certificateId ? [fixture.certificateId] : []),
    ];
    await client.begin(async (tx) => {
      await tx`
        delete from activity_events
        where user_id = ${fixture.memberId}
           or entity_id = any(${entityIds}::uuid[])
           or metadata ->> 'memberId' = ${fixture.memberId}
           or metadata ->> 'recipientUserId' = ${fixture.memberId}
      `;
      await tx`
        delete from courses
        where id in (${fixture.targetCourseId}, ${fixture.relatedCourseId})
      `;
      await tx`
        delete from modules
        where id in (${fixture.exclusiveModuleId}, ${fixture.sharedModuleId})
      `;
      await tx`
        delete from users
        where id in (${fixture.memberId}, ${fixture.formulaUserId})
      `;
    });
  } finally {
    await client.end();
  }
}

async function cleanupForeignFixture(fixture: ForeignFixture) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client`delete from organizations where id = ${fixture.organizationId}`;
  } finally {
    await client.end();
  }
}

test("admin exports tenant data and resets one member course transactionally", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop reset lifecycle");
  const fixture = await createAnalyticsFixture({
    progressOnSharedModule: false,
    activeCertificate: true,
  });
  const foreign = await createForeignFixture();
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await login(page, "admin");
    await page.goto("/admin/analytics");
    await page
      .getByLabel("Mitgliederstatistiken durchsuchen")
      .fill(fixture.memberEmail);
    await expect(
      page.locator("table").getByText(fixture.memberEmail),
    ).toBeVisible();
    await expect(page.getByText(foreign.email)).toHaveCount(0);

    const exportResponse = await page.request.get("/admin/analytics/export");
    expect(exportResponse.status()).toBe(200);
    expect(exportResponse.headers()["content-type"]).toContain("text/csv");
    expect(exportResponse.headers()["content-disposition"]).toContain(
      "attachment",
    );
    const csv = await exportResponse.text();
    expect(csv).toContain(fixture.memberEmail);
    expect(csv).not.toContain(foreign.email);
    expect(csv).toContain(
      `"'${fixture.formulaName.replaceAll('"', '""')} CSV"`,
    );

    const table = page.locator("table");
    await table
      .getByLabel(`Kursdetails fuer ${fixture.memberName} anzeigen`)
      .click();
    await table
      .getByRole("button", {
        name: `Fortschritt von ${fixture.memberName} in ${fixture.targetCourseTitle} zuruecksetzen`,
      })
      .click();

    const dialog = page.getByRole("alertdialog", {
      name: "Lernfortschritt zuruecksetzen",
    });
    const submit = dialog.getByRole("button", {
      name: "Lernfortschritt zuruecksetzen",
      exact: true,
    });
    await expect(submit).toBeDisabled();
    await dialog
      .getByLabel("Mitgliedsname zur Bestaetigung")
      .fill(fixture.memberName);
    await dialog
      .getByLabel("Kurstitel zur Bestaetigung")
      .fill(fixture.targetCourseTitle);
    await dialog.getByLabel("Einreichungen ebenfalls loeschen").check();
    await expect(submit).toBeDisabled();
    await dialog
      .getByLabel("Aktives Zertifikat ausdruecklich widerrufen")
      .check();
    await submit.click();
    await expect(dialog).toHaveCount(0);

    const [state] = await client<
      Array<{
        status: string;
        progress: number;
        completed_at: Date | null;
        last_accessed_at: Date | null;
        lesson_progress_count: number;
        attempt_count: number;
        answer_count: number;
        submission_count: number;
        revoked_at: Date | null;
        revoked_by_id: string | null;
        reset_event_count: number;
        notification_count: number;
      }>
    >`
      select
        e.status,
        e.progress,
        e.completed_at,
        e.last_accessed_at,
        (select count(*)::int from lesson_progress lp
          where lp.user_id = ${fixture.memberId}
            and lp.lesson_id = ${fixture.exclusiveLessonId}) as lesson_progress_count,
        (select count(*)::int from assessment_attempts aa
          where aa.user_id = ${fixture.memberId}
            and aa.course_id = ${fixture.targetCourseId}) as attempt_count,
        (select count(*)::int from assessment_answers ans
          where ans.attempt_id = ${fixture.attemptId}) as answer_count,
        (select count(*)::int from submissions s
          where s.user_id = ${fixture.memberId}
            and s.course_id = ${fixture.targetCourseId}) as submission_count,
        cc.revoked_at,
        cc.revoked_by_id,
        (select count(*)::int from activity_events ae
          where ae.type = 'learning.progress_reset'
            and ae.entity_id = ${fixture.enrollmentId}) as reset_event_count,
        (select count(*)::int from notifications n
          where n.user_id = ${fixture.memberId}
            and n.category = 'learning'
            and n.type = 'warning') as notification_count
      from enrollments e
      left join course_certificates cc on cc.id = ${fixture.certificateId}
      where e.id = ${fixture.enrollmentId}
    `;
    expect(state).toMatchObject({
      status: "not_started",
      progress: 0,
      completed_at: null,
      last_accessed_at: null,
      lesson_progress_count: 0,
      attempt_count: 0,
      answer_count: 0,
      submission_count: 0,
      revoked_by_id: fixture.adminId,
      reset_event_count: 1,
      notification_count: 1,
    });
    expect(state.revoked_at).not.toBeNull();

    const [relatedState] = await client<
      Array<{ status: string; progress: number }>
    >`
      select status, progress from enrollments
      where user_id = ${fixture.memberId}
        and course_id = ${fixture.relatedCourseId}
    `;
    expect(relatedState).toEqual({ status: "not_started", progress: 0 });
  } finally {
    await client.end();
    await cleanupForeignFixture(foreign);
    await cleanupAnalyticsFixture(fixture);
  }
});

test("trainer is read-only and shared progressed modules block a course reset", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop authorization flow");
  const fixture = await createAnalyticsFixture({
    progressOnSharedModule: true,
    activeCertificate: false,
  });
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await login(page, "trainer");
    await page.goto("/admin/analytics");
    await page
      .getByLabel("Mitgliederstatistiken durchsuchen")
      .fill(fixture.memberEmail);
    const trainerTable = page.locator("table");
    await trainerTable
      .getByLabel(`Kursdetails fuer ${fixture.memberName} anzeigen`)
      .click();
    await expect(
      trainerTable.getByText("Nur Lesezugriff").first(),
    ).toBeVisible();
    await expect(
      trainerTable.getByRole("button", { name: /zuruecksetzen/ }),
    ).toHaveCount(0);

    await login(page, "admin");
    await page.goto("/admin/analytics");
    await page
      .getByLabel("Mitgliederstatistiken durchsuchen")
      .fill(fixture.memberEmail);
    const adminTable = page.locator("table");
    await adminTable
      .getByLabel(`Kursdetails fuer ${fixture.memberName} anzeigen`)
      .click();
    await adminTable
      .getByRole("button", {
        name: `Fortschritt von ${fixture.memberName} in ${fixture.targetCourseTitle} zuruecksetzen`,
      })
      .click();
    const dialog = page.getByRole("alertdialog", {
      name: "Lernfortschritt zuruecksetzen",
    });
    await dialog
      .getByLabel("Mitgliedsname zur Bestaetigung")
      .fill(fixture.memberName);
    await dialog
      .getByLabel("Kurstitel zur Bestaetigung")
      .fill(fixture.targetCourseTitle);
    await dialog
      .getByRole("button", {
        name: "Lernfortschritt zuruecksetzen",
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Der Reset ist blockiert",
    );
    await expect(dialog.getByRole("alert")).toContainText(
      fixture.relatedCourseTitle,
    );

    const [state] = await client<
      Array<{ status: string; progress: number; progress_count: number }>
    >`
      select e.status, e.progress,
        (select count(*)::int from lesson_progress lp
          where lp.user_id = ${fixture.memberId}
            and lp.lesson_id in (
              ${fixture.exclusiveLessonId}, ${fixture.sharedLessonId}
            )) as progress_count
      from enrollments e
      where e.id = ${fixture.enrollmentId}
    `;
    expect(state).toEqual({
      status: "completed",
      progress: 100,
      progress_count: 2,
    });
  } finally {
    await client.end();
    await cleanupAnalyticsFixture(fixture);
  }
});

test("member cannot download analytics and mobile analytics has no page overflow", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "chromium") {
    await login(page, "member");
    const response = await page.request.get("/admin/analytics/export");
    expect(response.status()).toBe(403);
    return;
  }

  await login(page, "admin");
  await page.goto("/admin/analytics");
  await page
    .getByLabel("Mitgliederstatistiken durchsuchen")
    .fill("lea@q-academy.de");
  const analytics = page.locator(
    'section[aria-labelledby="member-analytics-title"]',
  );
  const mobileCard = analytics
    .locator("article")
    .filter({ hasText: "lea@q-academy.de" });
  await expect(mobileCard.getByText("lea@q-academy.de")).toBeVisible();
  await mobileCard.getByLabel(/Kursdetails fuer Lea .* anzeigen/).click();
  await expect(
    mobileCard.getByRole("button", { name: /Fortschritt von Lea / }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
