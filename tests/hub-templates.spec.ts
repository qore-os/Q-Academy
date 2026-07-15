import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/i })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("hub template creates a published personalized member dashboard", async ({
  browser,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The template workflow runs once in serial Chromium.",
  );
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const title = `Onboarding Hub ${suffix}`;
  let hubId: string | null = null;
  let memberContext: BrowserContext | null = null;

  try {
    await loginAsAdmin(page);
    await page.goto("/admin/hubs");
    await page.getByRole("button", { name: "Neuer Hub" }).click();
    const dialog = page.getByRole("dialog", { name: "Hub erstellen" });
    await dialog.getByLabel("Titel").fill(title);
    await dialog.getByLabel("Vorlage").selectOption("onboarding");
    await dialog.getByLabel("Startstatus").selectOption("published");
    await dialog.getByRole("button", { name: "Erstellen" }).click();
    await expect(dialog.getByText("Hub erstellt.", { exact: true })).toBeVisible();

    const [stored] = await sql<
      Array<{
        id: string;
        slug: string;
        status: string;
        layout: Array<{ columns: Array<{ title: string; href?: string }> }>;
      }>
    >`
      select id, slug, status::text, layout
      from hubs
      where title = ${title}
      limit 1
    `;
    expect(stored?.status).toBe("published");
    expect(stored?.layout[0]?.columns).toHaveLength(3);
    expect(stored?.layout[0]?.columns[0]?.title).toContain(
      "{{member.firstName}}",
    );
    hubId = stored?.id ?? null;
    if (!stored) throw new Error("Created template hub is missing.");

    memberContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const memberPage = await memberContext.newPage();
    await loginAsMember(memberPage);
    await memberPage.goto(
      `/academy/hub?hub=${encodeURIComponent(stored.slug)}`,
    );
    await expect(memberPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(
      memberPage.getByRole("heading", { name: "Willkommen, Lea" }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: /Deine Kurse/ }),
    ).toHaveAttribute("href", "/academy/courses");
    expect(
      await memberPage.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await memberContext?.close().catch(() => undefined);
    if (hubId) {
      await sql`delete from activity_events where entity_id = ${hubId}`;
      await sql`delete from hubs where id = ${hubId}`;
    }
    await sql.end();
  }
});
