import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { getLearningUiCopy } from "../src/lib/i18n/learning";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const learningCopy = getLearningUiCopy("de");
const courseBuilderCopy = getCourseBuilderCopy("de");

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

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

test("published learning access enforces drip, sequence and status on every path", async ({
  browser,
  page,
  request,
}, testInfo) => {
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const slug = `learning-access-${suffix}`;
  const secondarySlug = `learning-access-shared-${suffix}`;
  const courseTitle = `Access Kurs ${suffix}`;
  const moduleTitle = `Access Modul ${suffix}`;
  const firstSectionTitle = `Start ${suffix}`;
  const secondSectionTitle = `Sequenz ${suffix}`;
  const firstLessonTitle = `Offene Lektion ${suffix}`;
  const secondLessonTitle = `Sequenzlektion ${suffix}`;
  const afterEmptyTitle = `Nach leerer Sektion ${suffix}`;
  const scheduledTitle = `Terminlektion ${suffix}`;
  const draftLessonTitle = `Entwurfslektion ${suffix}`;
  const hiddenSectionLessonTitle = `Versteckte Sektionslektion ${suffix}`;
  const visibleText = `Publizierter Reader-Inhalt ${suffix}`;
  const visiblePageText = `Publizierte Seite ${suffix}`;
  const draftPageText = `Versteckte Entwurfsseite ${suffix}`;
  const apiSecret = `qak_learning_${randomBytes(28).toString("base64url")}`;
  const requestIds: string[] = [];
  let courseId = "";
  let secondaryCourseId = "";
  let moduleId = "";
  let apiKeyId = "";
  let firstLessonId = "";
  let secondLessonId = "";
  let afterEmptyLessonId = "";
  let scheduledLessonId = "";
  let draftLessonId = "";
  let quizBlockId = "";
  let memberId = "";
  let bundleId = "";
  let adminContext: BrowserContext | null = null;

  try {
    const [fixture] = await sql<
      Array<{ owner_id: string; member_id: string; organization_id: string }>
    >`
      select
        owner.id as owner_id,
        member.id as member_id,
        owner.organization_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    memberId = fixture.member_id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${fixture.organization_id}, ${courseTitle}, ${slug},
        'Zeit- und sequenzgesteuerter Testkurs.',
        'Isolierte Zugriffstests fuer den publizierten Snapshot.',
        'draft', true, ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${fixture.organization_id}, ${moduleTitle},
        'Modul mit zeitversetzter Freigabe.', 50
      )
      returning id
    `;
    moduleId = learningModule.id;
    const [secondaryCourse] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${fixture.organization_id}, ${`Shared Access ${suffix}`},
        ${secondarySlug}, 'Kurs mit demselben wiederverwendbaren Modul.',
        'Synchronisiert globalen Lektionsfortschritt.', 'draft', false,
        ${fixture.owner_id}
      )
      returning id
    `;
    secondaryCourseId = secondaryCourse.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, access_mode,
        drip_days, is_required
      ) values
        (${fixture.organization_id}, ${courseId}, ${moduleId}, 0,
          'delay_days', 1, true),
        (${fixture.organization_id}, ${secondaryCourseId}, ${moduleId}, 0,
          'delay_days', 10, true)
    `;

    const sections = await sql<Array<{ id: string; title: string }>>`
      insert into module_sections (
        organization_id, module_id, title, sort_order, status,
        unlock_after_previous, drip_days
      ) values
        (${fixture.organization_id}, ${moduleId}, ${firstSectionTitle}, 0, 'published', true, 0),
        (${fixture.organization_id}, ${moduleId}, ${secondSectionTitle}, 1, 'published', true, 0),
        (${fixture.organization_id}, ${moduleId}, ${`Leer ${suffix}`}, 2, 'published', false, 0),
        (${fixture.organization_id}, ${moduleId}, ${`Nach Leer ${suffix}`}, 3, 'published', true, 0),
        (${fixture.organization_id}, ${moduleId}, ${`Entwurfssektion ${suffix}`}, 4, 'draft', false, 0)
      returning id, title
    `;
    const sectionId = (title: string) => {
      const section = sections.find((row) => row.title === title);
      if (!section) throw new Error(`Section fixture missing: ${title}`);
      return section.id;
    };

    const insertedLessons = await sql<
      Array<{ id: string; title: string }>
    >`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, type, duration_minutes,
        sort_order, status, available_at
      ) values
        (${fixture.organization_id}, ${moduleId}, ${sectionId(firstSectionTitle)}, ${firstLessonTitle},
          ${`open-${suffix}`}, 'lesson', 10, 0, 'published', null),
        (${fixture.organization_id}, ${moduleId}, ${sectionId(firstSectionTitle)}, ${draftLessonTitle},
          ${`draft-${suffix}`}, 'lesson', 10, 5, 'draft', null),
        (${fixture.organization_id}, ${moduleId}, ${sectionId(firstSectionTitle)}, ${secondLessonTitle},
          ${`sequence-${suffix}`}, 'lesson', 10, 1, 'published', null),
        (${fixture.organization_id}, ${moduleId}, ${sectionId(`Nach Leer ${suffix}`)}, ${afterEmptyTitle},
          ${`empty-${suffix}`}, 'lesson', 10, 2, 'published', null),
        (${fixture.organization_id}, ${moduleId}, ${sectionId(`Entwurfssektion ${suffix}`)}, ${hiddenSectionLessonTitle},
          ${`hidden-section-${suffix}`}, 'lesson', 10, 6, 'published', null),
        (${fixture.organization_id}, ${moduleId}, null, ${scheduledTitle}, ${`scheduled-${suffix}`},
          'quiz', 10, 3, 'published', now() + interval '5 days')
      returning id, title
    `;
    const lessonId = (title: string) => {
      const lesson = insertedLessons.find((row) => row.title === title);
      if (!lesson) throw new Error(`Lesson fixture missing: ${title}`);
      return lesson.id;
    };
    firstLessonId = lessonId(firstLessonTitle);
    secondLessonId = lessonId(secondLessonTitle);
    afterEmptyLessonId = lessonId(afterEmptyTitle);
    scheduledLessonId = lessonId(scheduledTitle);
    draftLessonId = lessonId(draftLessonTitle);

    const pages = await sql<Array<{ id: string; status: string }>>`
      insert into lesson_pages (lesson_id, title, slug, sort_order, status)
      values
        (${firstLessonId}, 'Sichtbare Seite', ${`visible-${suffix}`}, 0, 'published'),
        (${firstLessonId}, 'Entwurfsseite', ${`draft-page-${suffix}`}, 1, 'draft')
      returning id, status
    `;
    await sql`
      insert into content_blocks (lesson_id, page_id, type, sort_order, required, data)
      values
        (${firstLessonId}, null, 'text', 0, false, ${sql.json({ text: visibleText })}),
        (${firstLessonId}, ${pages.find((row) => row.status === "published")!.id},
          'text', 0, false, ${sql.json({ text: visiblePageText })}),
        (${firstLessonId}, ${pages.find((row) => row.status === "draft")!.id},
          'text', 0, false, ${sql.json({ text: draftPageText })})
    `;
    const [quizBlock] = await sql<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, type, sort_order, required, data
      ) values (
        ${scheduledLessonId}, 'multiple_choice', 0, true,
        ${sql.json({
          prompt: "Wann ist diese Lektion zugaenglich?",
          options: ["Vor der Freigabe", "Nach der Freigabe"],
          correctOption: 1,
        })}
      )
      returning id
    `;
    quizBlockId = quizBlock.id;

    await sql`
      insert into enrollments (
        user_id, course_id, access_active, enrolled_at
      ) values (
        ${memberId}, ${courseId}, true, now() - interval '10 days'
      )
    `;
    const [secondaryEnrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (
        user_id, course_id, access_active, enrolled_at
      ) values (
        ${memberId}, ${secondaryCourseId}, true, now() - interval '10 days'
      )
      returning id
    `;
    const [accessBundle] = await sql<Array<{ id: string }>>`
      insert into bundles (organization_id, name, description, active)
      values (
        ${fixture.organization_id}, ${`Learning access ${suffix}`},
        'Bundle-Policy-Fixture fuer den Lernzugriff.', true
      )
      returning id
    `;
    bundleId = accessBundle.id;
    await sql`
      insert into bundle_courses (bundle_id, course_id)
      values (${bundleId}, ${courseId})
    `;
    await sql`
      insert into member_bundles (user_id, bundle_id)
      values (${memberId}, ${bundleId})
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values
        (${fixture.organization_id}, ${memberId}, ${courseId},
          ${`member:${memberId}:bundle:${bundleId}`}),
        (${fixture.organization_id}, ${memberId}, ${secondaryCourseId},
          ${`direct:${secondaryEnrollment.id}`})
    `;
    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${fixture.organization_id}, ${`Learning access ${suffix}`},
        ${apiSecret.slice(0, 20)}, ${hashSecret(apiSecret)},
        array['courses:read', 'courses:write', 'members:read', 'members:write'],
        ${fixture.owner_id}
      )
      returning id
    `;
    apiKeyId = apiKey.id;
    const headers = {
      Authorization: `Bearer ${apiSecret}`,
      "Content-Type": "application/json",
    };
    const published = await request.post(`/api/v1/courses/${courseId}/publish`, {
      headers: { ...headers, "Idempotency-Key": `publish-${suffix}` },
      data: { changelog: "Learning access fixture" },
    });
    requestIds.push(published.headers()["x-request-id"]);
    expect(published.status()).toBe(201);
    const secondaryPublished = await request.post(
      `/api/v1/courses/${secondaryCourseId}/publish`,
      {
        headers: {
          ...headers,
          "Idempotency-Key": `publish-shared-${suffix}`,
        },
        data: { changelog: "Shared module progress fixture" },
      },
    );
    requestIds.push(secondaryPublished.headers()["x-request-id"]);
    expect(secondaryPublished.status()).toBe(201);

    await sql`
      update bundle_courses
      set delay_days = 5
      where bundle_id = ${bundleId} and course_id = ${courseId}
    `;
    await login(page, "member");
    await page.goto("/academy/courses");
    await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
    await expect(
      page.getByText("Noch nicht verfuegbar", { exact: true }),
    ).toBeVisible();
    const delayedDetail = await page.goto(`/academy/courses/${slug}`);
    expect(delayedDetail?.status()).toBe(404);

    await sql`
      update bundle_courses
      set delay_days = 0, available_until = now() - interval '1 minute'
      where bundle_id = ${bundleId} and course_id = ${courseId}
    `;
    await page.goto("/academy/courses");
    await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
    await expect(page.getByText("Abgelaufen", { exact: true })).toBeVisible();
    const expiredDetail = await page.goto(`/academy/courses/${slug}`);
    expect(expiredDetail?.status()).toBe(404);

    await sql`
      update bundle_courses
      set available_until = null, visible = false
      where bundle_id = ${bundleId} and course_id = ${courseId}
    `;
    await page.goto("/academy/courses");
    await expect(page.getByRole("heading", { name: courseTitle })).toHaveCount(0);

    await sql`
      update bundle_courses
      set visible = true
      where bundle_id = ${bundleId} and course_id = ${courseId}
    `;
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
    await expect(page.getByText(firstLessonTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(draftLessonTitle, { exact: true })).toBeHidden();
    await expect(
      page.getByText(hiddenSectionLessonTitle, { exact: true }),
    ).toBeHidden();
    await expect(page.locator(`[data-locked-lesson="${firstLessonId}"]`)).toBeVisible();
    await expect(page.getByText(/Verfuegbar ab/).first()).toBeVisible();

    const lockedReader = await page.goto(
      `/academy/courses/${slug}/learn/${firstLessonId}`,
    );
    expect(lockedReader?.status()).toBe(404);
    const lockedProgress = await request.put(
      `/api/v1/members/${memberId}/progress/${firstLessonId}`,
      {
        headers: { ...headers, "Idempotency-Key": `locked-progress-${suffix}` },
        data: { status: "completed", percent: 100 },
      },
    );
    requestIds.push(lockedProgress.headers()["x-request-id"]);
    expect(lockedProgress.status()).toBe(404);
    const lockedAssessment = await request.post("/api/v1/assessment-attempts", {
      headers: { ...headers, "Idempotency-Key": `locked-quiz-${suffix}` },
      data: {
        userId: memberId,
        courseId,
        lessonId: scheduledLessonId,
        answers: [{ blockId: quizBlockId, selectedOption: 1 }],
      },
    });
    requestIds.push(lockedAssessment.headers()["x-request-id"]);
    expect(lockedAssessment.status()).toBe(404);
    const [stillLocked] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from lesson_progress
      where user_id = ${memberId}
        and lesson_id in (${firstLessonId}, ${scheduledLessonId})
    `;
    expect(stillLocked.count).toBe(0);

    await sql`
      update course_versions
      set published_at = now() - interval '2 days'
      where course_id = ${courseId}
        and id = (select published_version_id from courses where id = ${courseId})
    `;
    await sql`
      update courses
      set first_published_at = now() - interval '2 days'
      where id = ${courseId}
    `;
    await sql`
      update course_access_grants
      set created_at = now() - interval '2 days'
      where user_id = ${memberId} and course_id = ${courseId}
    `;
    await page.goto(`/academy/courses/${slug}`);
    await expect(
      page.getByRole("link", { name: new RegExp(firstLessonTitle) }),
    ).toBeVisible();
    await expect(page.locator(`[data-locked-lesson="${secondLessonId}"]`)).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(afterEmptyTitle) }),
    ).toBeVisible();
    await expect(
      page.locator(`[data-locked-lesson="${scheduledLessonId}"]`),
    ).toBeVisible();
    const sequenceReader = await page.goto(
      `/academy/courses/${slug}/learn/${secondLessonId}`,
    );
    expect(sequenceReader?.status()).toBe(404);
    const sequenceProgress = await request.put(
      `/api/v1/members/${memberId}/progress/${secondLessonId}`,
      {
        headers: { ...headers, "Idempotency-Key": `sequence-progress-${suffix}` },
        data: { status: "completed", percent: 100 },
      },
    );
    requestIds.push(sequenceProgress.headers()["x-request-id"]);
    expect(sequenceProgress.status()).toBe(404);

    await page.goto(`/academy/courses/${slug}/learn/${firstLessonId}`);
    await expect(page.getByText(visibleText, { exact: true })).toBeVisible();
    await expect(page.getByText(visiblePageText, { exact: true })).toBeVisible();
    await expect(page.getByText(draftPageText, { exact: true })).toBeHidden();
    const nextLink = page
      .locator(
        `a[href="/academy/courses/${slug}/learn/${afterEmptyLessonId}"]`,
      )
      .last();
    await expect(nextLink).toHaveAttribute(
      "href",
      `/academy/courses/${slug}/learn/${afterEmptyLessonId}`,
    );

    await sql`
      update course_versions
      set published_at = now()
      where course_id = ${courseId}
        and id = (select published_version_id from courses where id = ${courseId})
    `;
    await sql`
      update courses set first_published_at = now() where id = ${courseId}
    `;
    await sql`
      update course_access_grants set created_at = now()
      where user_id = ${memberId} and course_id = ${courseId}
    `;
    await page.getByRole("button", { name: "Lektion abschliessen" }).click();
    await expect(
      page.getByText(learningCopy("lesson.completeError"), { exact: true }),
    ).toBeVisible();
    const [blockedServerAction] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from lesson_progress
      where user_id = ${memberId} and lesson_id = ${firstLessonId}
    `;
    expect(blockedServerAction.count).toBe(0);

    await sql`
      update course_versions
      set published_at = now() - interval '2 days'
      where course_id = ${courseId}
        and id = (select published_version_id from courses where id = ${courseId})
    `;
    await sql`
      update courses
      set first_published_at = now() - interval '2 days'
      where id = ${courseId}
    `;
    await sql`
      update course_access_grants
      set created_at = now() - interval '2 days'
      where user_id = ${memberId} and course_id = ${courseId}
    `;
    await page.reload();
    await page.getByRole("button", { name: "Lektion abschliessen" }).click();
    await expect(
      page.getByRole("button", { name: "Lektion abgeschlossen" }),
    ).toBeDisabled();
    await page.goto(`/academy/courses/${slug}`);
    await expect(
      page.getByRole("link", { name: new RegExp(secondLessonTitle) }),
    ).toBeVisible();
    const [courseProgress] = await sql<
      Array<{ progress: number; status: string; completed_count: number }>
    >`
      select
        e.progress,
        e.status,
        (
          select count(*)::int from lesson_progress lp
          where lp.user_id = e.user_id and lp.status = 'completed'
            and lp.lesson_id = ${firstLessonId}
        ) as completed_count
      from enrollments e
      where e.user_id = ${memberId} and e.course_id = ${courseId}
    `;
    expect(courseProgress).toMatchObject({
      progress: 25,
      status: "in_progress",
      completed_count: 1,
    });
    const [sharedCourseProgress] = await sql<
      Array<{ progress: number; status: string }>
    >`
      select progress, status
      from enrollments
      where user_id = ${memberId} and course_id = ${secondaryCourseId}
    `;
    expect(sharedCourseProgress).toMatchObject({
      progress: 25,
      status: "in_progress",
    });

    const [publishedVersion] = await sql<
      Array<{
        id: string;
        snapshot: {
          modules: Array<{
            lessons: Array<{ id: string; availableAt: string | null }>;
          }>;
        };
      }>
    >`
      select id, snapshot
      from course_versions
      where course_id = ${courseId}
        and id = (select published_version_id from courses where id = ${courseId})
    `;
    const scheduledSnapshotLesson = publishedVersion.snapshot.modules
      .flatMap((learningModule) => learningModule.lessons)
      .find((lesson) => lesson.id === scheduledLessonId);
    expect(scheduledSnapshotLesson).toBeTruthy();
    scheduledSnapshotLesson!.availableAt = new Date(
      Date.now() - 60_000,
    ).toISOString();
    await sql`
      update course_versions
      set snapshot = ${sql.json(publishedVersion.snapshot)}
      where id = ${publishedVersion.id}
    `;
    await page.reload();
    await expect(
      page.getByRole("link", { name: new RegExp(scheduledTitle) }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: new RegExp(draftLessonTitle) }),
    ).toHaveCount(0);

    if (testInfo.project.name === "chromium") {
      adminContext = await browser.newContext();
      const adminPage = await adminContext.newPage();
      await login(adminPage, "admin");
      await adminPage.goto(`/admin/courses/${courseId}`);
      await adminPage
        .getByRole("tab", { name: courseBuilderCopy.tabs.access, exact: true })
        .click();
      const sectionForm = adminPage
        .locator("form")
        .filter({ hasText: secondSectionTitle });
      await sectionForm.getByLabel("Status").selectOption("draft");
      await sectionForm.getByLabel("Freigabe nach Tagen").fill("4");
      await sectionForm.getByRole("button", { name: "Speichern" }).click();
      await expect(
        adminPage.getByText("Sektionseinstellungen gespeichert.", {
          exact: true,
        }),
      ).toBeVisible();
      await adminPage.getByRole("tab", { name: "Inhalte" }).click();
      await adminPage
        .getByRole("button", { name: new RegExp(firstLessonTitle) })
        .click();
      const lessonForm = adminPage
        .locator("form")
        .filter({ has: adminPage.getByLabel("Lektionsstatus") });
      await lessonForm.getByLabel("Lektionsstatus").selectOption("archived");
      await lessonForm.getByLabel("Verfuegbar ab").fill("2030-01-02T09:30");
      await lessonForm.getByRole("button", { name: "Speichern" }).click();
      await expect(
        adminPage.getByText("Lektionseinstellungen gespeichert.", {
          exact: true,
        }),
      ).toBeVisible();
      const [builderState] = await sql<
        Array<{
          section_status: string;
          section_drip: number;
          lesson_status: string;
          lesson_available: Date | null;
        }>
      >`
        select
          s.status as section_status,
          s.drip_days as section_drip,
          l.status as lesson_status,
          l.available_at as lesson_available
        from module_sections s
        join lessons l on l.id = ${firstLessonId}
        where s.id = ${sectionId(secondSectionTitle)}
      `;
      expect(builderState).toMatchObject({
        section_status: "draft",
        section_drip: 4,
        lesson_status: "archived",
      });
      expect(builderState.lesson_available?.toISOString()).toBe(
        new Date("2030-01-02T09:30").toISOString(),
      );
      await page.reload();
      await expect(page.getByText(firstLessonTitle, { exact: true })).toBeVisible();
    }

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("learning-access-course.png"),
      fullPage: false,
    });
  } finally {
    if (adminContext) await adminContext.close();
    if (apiKeyId) {
      await sql`delete from api_audit_logs where api_key_id = ${apiKeyId}`;
      await sql`delete from api_keys where id = ${apiKeyId}`;
    } else if (requestIds.length) {
      await sql`
        delete from api_audit_logs
        where request_id = any(${requestIds.filter(Boolean)}::uuid[])
      `;
    }
    if (courseId) {
      await sql`
        delete from activity_events
        where entity_id in (
          ${courseId}, ${moduleId || null}, ${firstLessonId || null},
          ${secondLessonId || null}, ${afterEmptyLessonId || null},
          ${scheduledLessonId || null}, ${draftLessonId || null}
        ) or metadata ->> 'courseId' = ${courseId}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (secondaryCourseId) {
      await sql`
        delete from activity_events
        where entity_id = ${secondaryCourseId}
           or metadata ->> 'courseId' = ${secondaryCourseId}
      `;
      await sql`delete from courses where id = ${secondaryCourseId}`;
    }
    if (bundleId) await sql`delete from bundles where id = ${bundleId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end();
  }
});
