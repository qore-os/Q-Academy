import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function createSidebarLink(
  page: Page,
  input: { label: string; description: string; href: string; icon: string },
) {
  const manager = page.locator("#mitglieder-links");
  const createForm = manager.locator("form").first();
  await createForm.getByLabel("Name").fill(input.label);
  await createForm.getByLabel("Beschreibung").fill(input.description);
  await createForm.getByLabel("Interner Pfad oder HTTPS-Link").fill(input.href);
  await createForm.locator(`input[name="icon"][value="${input.icon}"]`).check();
  await createForm.getByRole("button", { name: "Link hinzufügen" }).click();
  await expect(
    manager.locator(`input[name="label"][value="${input.label}"]`),
  ).toBeVisible();
}

test("member links and lesson bookmarks persist, reorder, and stay tenant-bound", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused member navigation flow runs once.");
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const firstLabel = `E2E Lernlinks ${suffix}`;
  const secondLabel = `E2E Favoriten ${suffix}`;
  const foreignLabel = `Fremder Link ${suffix}`;
  let organizationId = "";
  let memberId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let courseSlug = "";
  let lessonTitle = "";
  let moduleTitle = "";
  let foreignOrganizationId = "";
  let memberContext: BrowserContext | null = null;
  try {
    const [fixture] = await sql<Array<{
      organization_id: string;
      member_id: string;
      course_id: string;
      course_slug: string;
      module_id: string;
      module_title: string;
      lesson_id: string;
      lesson_title: string;
    }>>`
      select u.organization_id, u.id as member_id,
             c.id as course_id, c.slug as course_slug,
             m.id as module_id, m.title as module_title,
             l.id as lesson_id, l.title as lesson_title
      from users u
      join enrollments e on e.user_id = u.id and e.access_active = true
      join courses c on c.id = e.course_id and c.status = 'published'
      join course_modules cm on cm.course_id = c.id and cm.organization_id = u.organization_id
      join modules m on m.id = cm.module_id and m.organization_id = u.organization_id
      join lessons l on l.module_id = m.id and l.organization_id = u.organization_id
      where u.email = 'lea@q-academy.de'
        and c.slug = 'ki-grundlagen'
        and l.status = 'published'
      order by cm.sort_order, l.sort_order
      limit 1
    `;
    expect(fixture).toBeTruthy();
    ({
      organization_id: organizationId,
      member_id: memberId,
      course_id: courseId,
      course_slug: courseSlug,
      module_id: moduleId,
      module_title: moduleTitle,
      lesson_id: lessonId,
      lesson_title: lessonTitle,
    } = fixture);
    await sql`
      delete from lesson_bookmarks
      where organization_id = ${organizationId}
        and user_id = ${memberId}
        and course_id = ${courseId}
        and lesson_id = ${lessonId}
    `;
    const [foreign] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign member links ${suffix}`}, ${`foreign-member-links-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreign.id;
    await sql`
      insert into member_sidebar_links (
        organization_id, label, description, href, icon, sort_order
      ) values (
        ${foreignOrganizationId}, ${foreignLabel}, 'Mandantenfremd',
        '/academy/bookmarks', 'link', 0
      )
    `;

    await loginAsAdmin(page);
    await page.goto("/admin/settings#mitglieder-links");
    await expect(page.getByRole("heading", { name: "Mitglieder-Links" })).toBeVisible();
    const manager = page.locator("#mitglieder-links");
    const createForm = manager.locator("form").first();
    await createForm.getByLabel("Name").fill(`Unsicher ${suffix}`);
    await createForm.getByLabel("Interner Pfad oder HTTPS-Link").fill("javascript:alert(1)");
    await createForm.getByRole("button", { name: "Link hinzufügen" }).click();
    await expect(manager.getByText("Nur interne Pfade oder HTTPS-Links sind erlaubt.")).toBeVisible();

    await createSidebarLink(page, {
      label: firstLabel,
      description: "Direkter Einstieg in die Lernsammlung",
      href: "/academy/bookmarks",
      icon: "book-open",
    });
    await createSidebarLink(page, {
      label: secondLabel,
      description: "Externe Dokumentation",
      href: "https://docs.example.com/start",
      icon: "globe",
    });
    await manager.getByRole("button", { name: `${secondLabel} nach oben` }).click();
    await expect.poll(async () => {
      const rows = await sql<Array<{ label: string }>>`
        select label from member_sidebar_links
        where organization_id = ${organizationId}
          and label in (${firstLabel}, ${secondLabel})
        order by sort_order, id
      `;
      return rows.map((row) => row.label).join("|");
    }).toBe(`${secondLabel}|${firstLabel}`);

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAsMember(memberPage);
    await expect(memberPage.getByRole("link", { name: new RegExp(firstLabel) })).toBeVisible();
    await expect(memberPage.getByText(foreignLabel)).toHaveCount(0);
    const external = memberPage.getByRole("link", { name: new RegExp(secondLabel) });
    await expect(external).toHaveAttribute("target", "_blank");
    await expect(external).toHaveAttribute("rel", /noopener/);

    await memberPage.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    const bookmarkButton = memberPage.getByRole("button", { name: "Lesezeichen setzen" });
    await expect(bookmarkButton).toBeVisible();
    await bookmarkButton.click();
    await expect(memberPage.getByRole("button", { name: "Lesezeichen entfernen" })).toBeVisible();
    await expect.poll(async () => {
      const [count] = await sql<Array<{ value: number }>>`
        select count(*)::int as value from lesson_bookmarks
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and course_id = ${courseId}
          and module_id = ${moduleId}
          and lesson_id = ${lessonId}
      `;
      return count.value;
    }).toBe(1);

    await memberPage.goto("/academy/bookmarks");
    await expect(memberPage.getByRole("heading", { name: "Lesezeichen" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: moduleTitle })).toBeVisible();
    await expect(memberPage.getByRole("link", { name: new RegExp(lessonTitle) })).toBeVisible();
    await memberPage.getByRole("link", { name: new RegExp(lessonTitle) }).click();
    await memberPage.getByRole("button", { name: "Lesezeichen entfernen" }).click();
    await expect(memberPage.getByRole("button", { name: "Lesezeichen setzen" })).toBeVisible();
  } finally {
    await memberContext?.close().catch(() => undefined);
    if (organizationId) {
      await sql`
        delete from lesson_bookmarks
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and course_id = ${courseId}
          and lesson_id = ${lessonId}
      `;
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and (
            (type like 'platform.member_sidebar_link.%' and entity_id in (
              select id from member_sidebar_links
              where organization_id = ${organizationId}
                and label in (${firstLabel}, ${secondLabel})
            ))
            or (
              type = 'platform.member_sidebar_links.reordered'
              and metadata -> 'orderedIds' ?| array(
                select id::text from member_sidebar_links
                where organization_id = ${organizationId}
                  and label in (${firstLabel}, ${secondLabel})
              )
            )
            or (type like 'learning.lesson_bookmark.%' and entity_id = ${lessonId})
          )
      `;
      await sql`
        delete from member_sidebar_links
        where organization_id = ${organizationId}
          and label in (${firstLabel}, ${secondLabel})
      `;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});
