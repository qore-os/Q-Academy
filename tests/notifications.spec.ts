import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("member manages only their own notifications", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "notification mutation flow runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const linkedTitle = `E2E Termin ${suffix}`;
  const plainTitle = `E2E Hinweis ${suffix}`;
  const readTitle = `E2E Gelesen ${suffix}`;
  const foreignTitle = `E2E Fremd ${suffix}`;
  const fixtureIds: string[] = [];
  let originalStates: Array<{ id: string; read: boolean }> = [];

  try {
    const [member] = await client<
      Array<{ id: string; organization_id: string }>
    >`
      select id, organization_id from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    const [admin] = await client<Array<{ id: string }>>`
      select id from users
      where organization_id = ${member.organization_id}
        and role = 'owner'
      limit 1
    `;
    expect(member).toBeTruthy();
    expect(admin).toBeTruthy();

    originalStates = await client<Array<{ id: string; read: boolean }>>`
      select id, read from notifications where user_id = ${member.id}
    `;
    const initialUnread = originalStates.filter(
      (notification) => !notification.read,
    ).length;

    const inserted = await client<Array<{ id: string }>>`
      insert into notifications (user_id, title, body, type, href, read)
      values
        (${member.id}, ${linkedTitle}, 'Dieser Termin fuehrt zum Event-Plan.', 'event', '/academy/events', false),
        (${member.id}, ${plainTitle}, 'Dieser Hinweis hat bewusst kein Linkziel.', 'info', null, false),
        (${member.id}, ${readTitle}, 'Diese Nachricht ist bereits gelesen.', 'course', '/academy/courses', true),
        (${admin.id}, ${foreignTitle}, 'Diese Nachricht gehoert einem anderen Nutzer.', 'info', null, false)
      returning id
    `;
    fixtureIds.push(...inserted.map((notification) => notification.id));

    await loginAsMember(page);
    const trigger = page.getByRole("button", {
      name: `Benachrichtigungen, ${initialUnread + 2} ungelesen`,
    });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Benachrichtigungen" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(linkedTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText(plainTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText(readTitle, { exact: true })).toBeVisible();
    await expect(dialog.getByText(foreignTitle, { exact: true })).toHaveCount(
      0,
    );

    await dialog
      .getByRole("button", {
        name: `${linkedTitle} als gelesen markieren`,
      })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: `${linkedTitle} als gelesen markieren`,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: `Benachrichtigungen, ${initialUnread + 1} ungelesen`,
      }),
    ).toBeVisible();

    await dialog
      .getByRole("button", { name: `${plainTitle} loeschen` })
      .click();
    await expect(dialog.getByText(plainTitle, { exact: true })).toHaveCount(0);
    const unreadAfterDelete = initialUnread;
    await expect(
      page.getByRole("button", {
        name:
          unreadAfterDelete > 0
            ? `Benachrichtigungen, ${unreadAfterDelete} ungelesen`
            : "Benachrichtigungen",
      }),
    ).toBeVisible();

    if (unreadAfterDelete > 0) {
      await dialog.getByRole("button", { name: "Alle gelesen" }).click();
      await expect(
        page.getByRole("button", { name: "Benachrichtigungen", exact: true }),
      ).toBeVisible();
      await expect(
        dialog.getByText("Alles auf dem neuesten Stand", { exact: true }),
      ).toBeVisible();
    }

    await dialog.getByRole("link", { name: new RegExp(linkedTitle) }).click();
    await page.waitForURL("**/academy/events");

    const [linked] = await client<Array<{ read: boolean }>>`
      select read from notifications
      where user_id = ${member.id} and title = ${linkedTitle}
    `;
    const [plain] = await client<Array<{ count: number }>>`
      select count(*)::int as count from notifications
      where user_id = ${member.id} and title = ${plainTitle}
    `;
    const [foreign] = await client<Array<{ read: boolean }>>`
      select read from notifications
      where user_id = ${admin.id} and title = ${foreignTitle}
    `;
    expect(linked.read).toBe(true);
    expect(plain.count).toBe(0);
    expect(foreign.read).toBe(false);
  } finally {
    for (const notificationId of fixtureIds) {
      await client`delete from notifications where id = ${notificationId}`;
    }
    for (const notification of originalStates) {
      await client`
        update notifications set read = ${notification.read}
        where id = ${notification.id}
      `;
    }
    await client.end();
  }
});

test("notification drawer fits the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only drawer check");
  await loginAsMember(page);

  const trigger = page.getByRole("button", { name: /Benachrichtigungen/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Benachrichtigungen" });
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await dialog
    .getByRole("button", { name: "Benachrichtigungen schliessen" })
    .click();
  await expect(dialog).not.toBeVisible();
});
