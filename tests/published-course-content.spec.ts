import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
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

async function closeContext(context: BrowserContext | null) {
  if (context) await context.close();
}

test("members stay on the last published course version until republish", async ({
  browser,
}, testInfo) => {
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const slug = `published-content-${suffix}`;
  const originalTitle = `Publizierter Kurs ${suffix}`;
  const draftTitle = `Neuer Entwurf ${suffix}`;
  const originalText = `Sichtbarer Originalinhalt ${suffix}`;
  const draftText = `Noch unveroeffentlichter Inhalt ${suffix}`;
  const moduleTitle = `Versionsmodul ${suffix}`;
  const lessonTitle = `Stabile Lektion ${suffix}`;
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let adminContext: BrowserContext | null = null;
  let memberContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
      { owner_id: string; member_id: string; organization_id: string }[]
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

    const [course] = await client<{ id: string }[]>`
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
        ${originalTitle},
        ${slug},
        'Der veroeffentlichte Stand bleibt bis zur naechsten Publikation stabil.',
        'Ein isolierter Kurs fuer den vollstaendigen Draft-und-Publish-Lebenszyklus.',
        'draft',
        true,
        ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<{ id: string }[]>`
      insert into modules (
        organization_id,
        title,
        description,
        estimated_minutes
      ) values (
        ${fixture.organization_id},
        ${moduleTitle},
        'Modul mit stabilen Inhalts-IDs.',
        15
      )
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (${fixture.organization_id}, ${courseId}, ${moduleId}, 0, true)
    `;
    const [lesson] = await client<{ id: string }[]>`
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
        'stabile-lektion',
        'Diese Lektion behaelt ihre ID ueber alle Kursversionen.',
        'quiz',
        10,
        0,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    await client`
      insert into content_blocks (
        lesson_id,
        type,
        sort_order,
        required,
        data
      ) values
        (
          ${lessonId},
          'text',
          0,
          false,
          ${client.json({ text: originalText })}
        ),
        (
          ${lessonId},
          'multiple_choice',
          1,
          true,
          ${client.json({
            prompt: "Welche Version duerfen Mitglieder sehen?",
            options: ["Den aktuellen Entwurf", "Die letzte Publikation"],
            correctOption: 1,
          })}
        )
    `;
    const [enrollment] = await client<{ id: string }[]>`
      insert into enrollments (user_id, course_id, access_active)
      values (${fixture.member_id}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id,
        user_id,
        course_id,
        source
      ) values (
        ${fixture.organization_id},
        ${fixture.member_id},
        ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    adminContext = await browser.newContext();
    memberContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const memberPage = await memberContext.newPage();
    await login(adminPage, "admin");
    await adminPage.goto(`/admin/courses/${courseId}`);
    await adminPage
      .getByRole("button", { name: "Kurs veröffentlichen" })
      .click();
    await expect(
      adminPage.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();

    const [firstPublication] = await client<
      { version_count: number; published_version_id: string | null }[]
    >`
      select
        (select count(*)::int from course_versions where course_id = c.id) as version_count,
        published_version_id
      from courses c
      where c.id = ${courseId}
    `;
    expect(firstPublication).toMatchObject({
      version_count: 1,
      published_version_id: expect.any(String),
    });

    await login(memberPage, "member");
    await memberPage.goto(`/academy/courses/${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: originalTitle }),
    ).toBeVisible();
    await memberPage.goto(`/academy/courses/${slug}/learn/${lessonId}`);
    await expect(memberPage.getByText(originalText, { exact: true })).toBeVisible();

    await adminPage.getByRole("tab", { name: "Information" }).click();
    const informationForm = adminPage
      .locator("form")
      .filter({ hasText: "Kursinformationen" });
    await informationForm.getByLabel("Titel", { exact: true }).fill(draftTitle);
    await informationForm
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      adminPage.getByText("Kursinformationen gespeichert.", { exact: true }),
    ).toBeVisible();
    await adminPage.getByRole("tab", { name: "Inhalte" }).click();
    await adminPage
      .getByRole("button", {
        name: `text: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();
    const editDialog = adminPage.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    await editDialog.getByLabel("Text").fill(draftText);
    await editDialog
      .getByRole("button", {
        name: courseBuilderCopy.dialogs.saveChanges,
        exact: true,
      })
      .click();
    await expect(editDialog).toBeHidden();

    await adminPage.goto(
      `/admin/courses/${courseId}/preview?lesson=${lessonId}`,
    );
    await expect(adminPage.getByText(draftText, { exact: true })).toBeVisible();

    await memberPage.goto(`/academy/courses/${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: originalTitle }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("heading", { name: draftTitle }),
    ).toBeHidden();
    await memberPage.goto(`/academy/courses/${slug}/learn/${lessonId}`);
    await expect(memberPage.getByText(originalText, { exact: true })).toBeVisible();
    await expect(memberPage.getByText(draftText, { exact: true })).toBeHidden();

    await memberPage
      .getByRole("button", { name: /Die letzte Publikation/ })
      .click();
    await memberPage
      .getByRole("button", { name: "Pflichtquiz abgeben" })
      .click();
    await expect(
      memberPage.getByRole("main").getByText("Pflichtquiz bestanden", {
        exact: true,
      }),
    ).toBeVisible();
    await memberPage
      .getByRole("button", { name: "Lektion abschließen" })
      .click();
    await expect(
      memberPage.getByRole("button", { name: "Lektion abgeschlossen" }),
    ).toBeDisabled();

    const [completion] = await client<
      {
        lesson_status: string;
        enrollment_progress: number;
        certificate_count: number;
        certificate_title: string;
      }[]
    >`
      select
        lp.status as lesson_status,
        e.progress as enrollment_progress,
        (select count(*)::int from course_certificates cc where cc.course_id = e.course_id and cc.user_id = e.user_id and cc.revoked_at is null) as certificate_count,
        (select course_title from course_certificates cc where cc.course_id = e.course_id and cc.user_id = e.user_id and cc.revoked_at is null limit 1) as certificate_title
      from enrollments e
      join lesson_progress lp
        on lp.user_id = e.user_id
       and lp.lesson_id = ${lessonId}
      where e.user_id = ${fixture.member_id}
        and e.course_id = ${courseId}
    `;
    expect(completion).toMatchObject({
      lesson_status: "completed",
      enrollment_progress: 100,
      certificate_count: 1,
      certificate_title: originalTitle,
    });

    await adminPage.goto(`/admin/courses/${courseId}`);
    await adminPage
      .getByRole("button", { name: "Änderungen veröffentlichen" })
      .click();
    await expect(
      adminPage.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<{ count: number }[]>`
          select count(*)::int as count
          from course_versions
          where course_id = ${courseId}
        `;
        return row.count;
      })
      .toBe(2);

    const [secondPublication] = await client<
      {
        version_count: number;
        published_title: string;
        published_text: string;
      }[]
    >`
      select
        (select count(*)::int from course_versions where course_id = c.id) as version_count,
        cv.snapshot -> 'course' ->> 'title' as published_title,
        cv.snapshot -> 'modules' -> 0 -> 'lessons' -> 0 -> 'blocks' -> 0 -> 'data' ->> 'text' as published_text
      from courses c
      join course_versions cv on cv.id = c.published_version_id
      where c.id = ${courseId}
    `;
    expect(secondPublication).toMatchObject({
      version_count: 2,
      published_title: draftTitle,
      published_text: draftText,
    });

    await memberPage.goto(`/academy/courses/${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: draftTitle }),
    ).toBeVisible();
    await memberPage.goto(`/academy/courses/${slug}/learn/${lessonId}`);
    await expect(memberPage.getByText(draftText, { exact: true })).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: "Lektion abgeschlossen" }),
    ).toBeDisabled();

    expect(
      await memberPage.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await memberPage.screenshot({
      path: testInfo.outputPath("published-course-member.png"),
      fullPage: false,
    });
  } finally {
    await closeContext(adminContext);
    await closeContext(memberContext);
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id in (${courseId || null}, ${moduleId || null}, ${lessonId || null})
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`
        delete from notifications
        where body like ${`%${suffix}%`}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    await client.end();
  }
});
