import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("owner edits hub layout and access with member visibility", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    testInfo.project.name !== "chromium",
    "hub lifecycle runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const slug = `e2e-hub-${suffix}`;
  const initialTitle = `E2E Hub ${suffix}`;
  const updatedTitle = `E2E Hub Aktiv ${suffix}`;
  const widgetTitle = `E2E Werkzeug ${suffix}`;
  const movedWidgetTitle = `E2E Fokus ${suffix}`;
  let hubId: string | null = null;
  let memberContext: Awaited<ReturnType<typeof browser.newContext>> | null =
    null;

  try {
    const [organization] = await client<Array<{ id: string }>>`
      select id from organizations where slug = 'q-academy' limit 1
    `;
    const [member] = await client<
      Array<{
        id: string;
        first_name: string;
        last_name: string;
        email: string;
      }>
    >`
      select id, first_name, last_name, email from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    const [otherMember] = await client<
      Array<{
        id: string;
        first_name: string;
        last_name: string;
        email: string;
      }>
    >`
      select id, first_name, last_name, email from users
      where organization_id = ${organization.id}
        and role = 'member'
        and id <> ${member.id}
      order by created_at
      limit 1
    `;
    const [hub] = await client<Array<{ id: string }>>`
      insert into hubs (organization_id, title, slug, description, status, layout)
      values (
        ${organization.id},
        ${initialTitle},
        ${slug},
        'E2E Hub fuer den Editor-Test.',
        'draft',
        '[]'::jsonb
      )
      returning id
    `;
    hubId = hub.id;

    await loginAsAdmin(page);
    await page.goto(`/admin/hubs/${hub.id}`);
    await expect(
      page.getByRole("heading", { name: initialTitle }),
    ).toBeVisible();

    await page.getByLabel("Titel", { exact: true }).fill(updatedTitle);
    await page.locator('select[name="status"]').selectOption("published");
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(
      page.getByText("Hub-Einstellungen gespeichert."),
    ).toBeVisible();

    let [storedHub] = await client<
      Array<{ title: string; status: string; layout: unknown[] }>
    >`
      select title, status::text, layout from hubs where id = ${hub.id}
    `;
    expect(storedHub).toMatchObject({
      title: updatedTitle,
      status: "published",
      layout: [],
    });

    await page.getByRole("button", { name: "Zeile hinzufuegen" }).click();
    await expect(
      page.getByRole("region", { name: "Layout-Zeile 1" }),
    ).toBeVisible();
    [storedHub] = await client`
      select title, status::text, layout from hubs where id = ${hub.id}
    `;
    expect(storedHub.layout).toHaveLength(1);

    await page.getByRole("button", { name: "Widget hinzufuegen" }).click();
    let widgetDialog = page.getByRole("dialog", { name: "Widget hinzufuegen" });
    await widgetDialog.getByLabel("Typ").selectOption("link");
    await widgetDialog.getByLabel("Titel").fill(widgetTitle);
    await widgetDialog
      .getByLabel("Beschreibung")
      .fill("E2E Beschreibung vor der Bearbeitung.");
    await widgetDialog.getByLabel("Linkziel").fill("/academy/courses");
    await widgetDialog.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(widgetDialog).not.toBeVisible();
    await expect(page.getByText(widgetTitle, { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: `${widgetTitle} bearbeiten` })
      .click();
    widgetDialog = page.getByRole("dialog", { name: "Widget bearbeiten" });
    await widgetDialog
      .getByLabel("Beschreibung")
      .fill("E2E Beschreibung nach der Bearbeitung.");
    await widgetDialog
      .getByRole("button", { name: "Widget speichern" })
      .click();
    await expect(widgetDialog).not.toBeVisible();

    await page.getByRole("button", { name: "Widget hinzufuegen" }).click();
    widgetDialog = page.getByRole("dialog", { name: "Widget hinzufuegen" });
    await widgetDialog.getByLabel("Typ").selectOption("stat");
    await widgetDialog.getByLabel("Titel").fill(movedWidgetTitle);
    await widgetDialog
      .getByLabel("Beschreibung")
      .fill("Wird fuer den Reihenfolge-Test verschoben.");
    await widgetDialog.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(widgetDialog).not.toBeVisible();

    await page
      .getByRole("button", { name: `${movedWidgetTitle} nach links` })
      .click();
    await expect(
      page.getByText("Widget verschoben.", { exact: true }),
    ).toBeVisible();
    [storedHub] = await client`
      select title, status::text, layout from hubs where id = ${hub.id}
    `;
    const layoutAfterMove = storedHub.layout as Array<{
      id: string;
      columns: Array<{ title: string; description?: string; href?: string }>;
    }>;
    expect(layoutAfterMove[0].columns.map((widget) => widget.title)).toEqual([
      movedWidgetTitle,
      widgetTitle,
    ]);
    expect(layoutAfterMove[0].columns[1]).toMatchObject({
      description: "E2E Beschreibung nach der Bearbeitung.",
      href: "/academy/courses",
    });

    await page
      .getByRole("button", { name: `${movedWidgetTitle} loeschen` })
      .click();
    const deleteDialog = page.getByRole("alertdialog", {
      name: "Widget loeschen?",
    });
    await deleteDialog
      .getByRole("button", { name: "Endgueltig loeschen" })
      .click();
    await expect(deleteDialog).not.toBeVisible();

    const otherLabel = `${otherMember.first_name} ${otherMember.last_name} (${otherMember.email})`;
    const memberLabel = `${member.first_name} ${member.last_name} (${member.email})`;
    await page.getByLabel("Zugriffsziel").selectOption(otherMember.id);
    await page.getByRole("button", { name: "Regel hinzufuegen" }).click();
    await expect(page.getByText(otherLabel, { exact: true })).toBeVisible();

    memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await loginAsMember(memberPage);
    await memberPage.goto(`/academy/hub?hub=${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: updatedTitle }),
    ).toHaveCount(0);

    await page.getByLabel("Zugriffsziel").selectOption(member.id);
    await page.getByRole("button", { name: "Regel hinzufuegen" }).click();
    await expect(page.getByText(memberLabel, { exact: true })).toBeVisible();
    await memberPage.goto(`/academy/hub?hub=${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: updatedTitle }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("link", { name: new RegExp(widgetTitle) }),
    ).toBeVisible();
    await expect(
      memberPage
        .getByRole("navigation", { name: "Verfuegbare Hubs" })
        .getByRole("link", { name: updatedTitle }),
    ).toHaveAttribute("aria-current", "page");

    await page
      .getByRole("button", { name: `Zugriff fuer ${memberLabel} entfernen` })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Zugriff fuer ${memberLabel} entfernen`,
      }),
    ).toHaveCount(0);
    let [grantCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count from hub_access_grants
      where hub_id = ${hub.id} and subject_type = 'user' and subject_id = ${member.id}
    `;
    expect(grantCount.count).toBe(0);
    await memberPage.goto(`/academy/hub?hub=${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: updatedTitle }),
    ).toHaveCount(0);

    await page
      .getByRole("button", { name: `Zugriff fuer ${otherLabel} entfernen` })
      .click();
    await expect(
      page.getByRole("button", {
        name: `Zugriff fuer ${otherLabel} entfernen`,
      }),
    ).toHaveCount(0);
    [grantCount] = await client`
      select count(*)::int as count from hub_access_grants where hub_id = ${hub.id}
    `;
    expect(grantCount.count).toBe(0);
    await memberPage.goto(`/academy/hub?hub=${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: updatedTitle }),
    ).toBeVisible();
  } finally {
    await memberContext?.close();
    if (hubId) {
      await client`delete from activity_events where entity_id = ${hubId}`;
      await client`delete from hubs where id = ${hubId}`;
    }
    await client.end();
  }
});

test("hub editor fits the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout assertion");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [hub] = await client<Array<{ id: string }>>`
      select id from hubs order by created_at limit 1
    `;
    await loginAsAdmin(page);
    await page.goto(`/admin/hubs/${hub.id}`);
    await expect(
      page.getByText("Hub-Einstellungen", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await client.end();
  }
});
