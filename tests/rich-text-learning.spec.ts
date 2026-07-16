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

test("rich text is authored structurally and rendered safely for learners", async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused rich-text flow");
  test.setTimeout(90_000);

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const courseTitle = `Rich-Text Kurs ${suffix}`;
  const slug = `rich-text-${suffix}`;
  const moduleTitle = `Rich-Text Modul ${suffix}`;
  const lessonTitle = `Strukturierte Lektion ${suffix}`;
  const heading = `Sicher lernen ${suffix}`;
  const boldText = "Wichtiger Inhalt";
  const italicText = "praxisnah";
  const firstItem = "Erster Lernschritt";
  const secondItem = "Zweiter Lernschritt";
  const linkText = "Mehr erfahren";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let adminContext: BrowserContext | null = null;
  let memberContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
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

    const [course] = await client<Array<{ id: string }>>`
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
        ${slug},
        'Strukturierter Rich-Text fuer den fokussierten Browsertest.',
        'Dieser isolierte Kurs prueft Authoring, Vorschau, Publikation und sichere Lernansicht.',
        'draft',
        false,
        ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (
        organization_id,
        title,
        description,
        estimated_minutes
      ) values (
        ${fixture.organization_id},
        ${moduleTitle},
        'Modul fuer strukturierten Rich-Text.',
        10
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
    const [section] = await client<Array<{ id: string }>>`
      insert into module_sections (
        organization_id, module_id, title, sort_order, status
      )
      values (${fixture.organization_id}, ${moduleId}, 'Start', 0, 'published')
      returning id
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id,
        module_id,
        section_id,
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
        ${section.id},
        ${lessonTitle},
        'strukturierte-lektion',
        'Rich-Text wird als JSON-Dokument publiziert.',
        'lesson',
        10,
        0,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    const [enrollment] = await client<Array<{ id: string }>>`
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
    await adminPage.getByRole("button", { name: "Rich-Text", exact: true }).click();
    await expect(
      adminPage.getByText("Inhaltselement hinzugefuegt.", { exact: true }),
    ).toBeVisible();
    await adminPage
      .getByRole("button", {
        name: `${courseBuilderCopy.palette.rich_text}: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();

    const dialog = adminPage.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    const editor = dialog.getByRole("textbox", { name: "Rich-Text-Inhalt" });
    await editor.fill(heading);
    await editor.focus();
    await dialog.getByLabel("Blockformat").selectOption("h2");
    await editor.press("End");
    await editor.press("Enter");
    await dialog.getByRole("button", { name: "Fett" }).click();
    await editor.pressSequentially(boldText);
    await dialog.getByRole("button", { name: "Fett" }).click();
    await editor.pressSequentially(" und ");
    await dialog.getByRole("button", { name: "Kursiv" }).click();
    await editor.pressSequentially(italicText);
    await dialog.getByRole("button", { name: "Kursiv" }).click();
    await editor.press("Enter");
    await dialog.getByRole("button", { name: "Aufzaehlung" }).click();
    await editor.pressSequentially(firstItem);
    await editor.press("Enter");
    await editor.pressSequentially(secondItem);
    await editor.press("Enter");
    await editor.press("Enter");
    await editor.pressSequentially(linkText);
    await editor.press("Shift+Home");
    await dialog.getByRole("button", { name: "Link bearbeiten" }).click();
    await dialog.getByLabel("Link-URL").fill("https://example.com/lernen");
    await dialog.getByRole("button", { name: "Link anwenden" }).click();
    await dialog
      .getByRole("button", {
        name: courseBuilderCopy.dialogs.saveChanges,
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();

    const [stored] = await client<
      Array<{ type: string; data: { richText?: Record<string, unknown> } }>
    >`
      select type, data
      from content_blocks
      where lesson_id = ${lessonId}
      limit 1
    `;
    expect(stored.type).toBe("rich_text");
    expect(stored.data.richText).toMatchObject({ version: 1 });
    expect(
      JSON.stringify(stored.data.richText),
    ).not.toContain("javascript:");

    await expect(
      adminPage.getByRole("heading", { name: heading, level: 2 }),
    ).toBeVisible();
    await expect(adminPage.locator("strong", { hasText: boldText })).toBeVisible();
    await expect(adminPage.locator("em", { hasText: italicText })).toBeVisible();
    await expect(adminPage.getByRole("listitem").filter({ hasText: firstItem })).toBeVisible();
    const authoringLink = adminPage.getByRole("link", { name: linkText });
    await expect(authoringLink).toHaveAttribute("href", "https://example.com/lernen");

    await adminPage.goto(
      `/admin/courses/${courseId}/preview?lesson=${lessonId}`,
    );
    await expect(
      adminPage.getByRole("heading", { name: heading, level: 2 }),
    ).toBeVisible();
    await expect(adminPage.getByRole("listitem").filter({ hasText: secondItem })).toBeVisible();

    await adminPage.goto(`/admin/courses/${courseId}`);
    await adminPage
      .getByRole("button", { name: "Kurs veröffentlichen" })
      .click();
    await expect(
      adminPage.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ count: number }>>`
          select count(*)::int as count
          from course_versions
          where course_id = ${courseId}
        `;
        return row.count;
      })
      .toBe(1);

    await login(memberPage, "member");
    await memberPage.goto(`/academy/courses/${slug}/learn/${lessonId}`);
    await expect(
      memberPage.getByRole("heading", { name: heading, level: 2 }),
    ).toBeVisible();
    await expect(memberPage.locator("strong", { hasText: boldText })).toBeVisible();
    await expect(memberPage.locator("em", { hasText: italicText })).toBeVisible();
    await expect(memberPage.getByRole("listitem").filter({ hasText: firstItem })).toBeVisible();
    const learnerLink = memberPage.getByRole("link", { name: linkText });
    await expect(learnerLink).toHaveAttribute(
      "href",
      "https://example.com/lernen",
    );
    await expect(learnerLink).toHaveAttribute("target", "_blank");
    await expect(learnerLink).toHaveAttribute(
      "rel",
      "noopener noreferrer nofollow",
    );
  } finally {
    await closeContext(adminContext);
    await closeContext(memberContext);
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id in (${courseId || null}, ${moduleId || null}, ${lessonId || null})
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    await client.end({ timeout: 5 });
  }
});
