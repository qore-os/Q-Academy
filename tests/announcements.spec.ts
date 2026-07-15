import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function cleanupAnnouncement(title: string) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const rows = await client<Array<{ id: string }>>`
      select id from announcements where title = ${title}
    `;
    for (const row of rows) {
      await client`
        delete from activity_events
        where entity_type = 'announcement' and entity_id = ${row.id}
      `;
      await client`delete from announcements where id = ${row.id}`;
    }
  } finally {
    await client.end();
  }
}

test("admin announcement is delivered and persistently dismissed", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted announcement flow");
  const title = `Release-Hinweis ${randomUUID()}`;
  await cleanupAnnouncement(title);

  try {
    await page.goto("/login");
    await page
      .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
      .click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/announcements");
    await expect(
      page.getByRole("heading", { name: "Ankuendigungen", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Neue Ankuendigung" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Neue Ankuendigung",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Titel").fill(title);
    await dialog
      .getByLabel("Rich-Text Block 1")
      .fill(
        "Dieser Hinweis prueft die vollstaendige Ausspielung an Mitglieder.",
      );
    await dialog.getByRole("button", { name: "Button", exact: true }).click();
    await dialog.getByLabel("Beschriftung").fill("Kurse ansehen");
    await dialog.getByRole("textbox", { name: "Ziel", exact: true }).fill("/academy/courses");
    await dialog.getByRole("button", { name: "Block 2 nach oben" }).click();
    await dialog.getByRole("button", { name: "Block 1 nach unten" }).click();
    await dialog
      .getByRole("button", { name: "Ankuendigung speichern" })
      .click();
    await expect(dialog.getByText("Ankuendigung erstellt.")).toBeVisible();
    await dialog.getByRole("button", { name: "Editor schliessen" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("announcement-admin.png"),
      fullPage: true,
    });

    await page.context().clearCookies();
    await page.goto("/login");
    await page
      .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
      .click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    const announcementRegion = page.getByLabel("Ankuendigungen");
    const delivered = announcementRegion.locator("section").filter({
      hasText: title,
    });
    await expect(delivered).toBeVisible();
    await expect(
      delivered.getByRole("link", { name: "Kurse ansehen" }),
    ).toBeVisible();
    await delivered
      .getByRole("button", { name: "Ankuendigung schliessen" })
      .click();
    await expect(delivered).toBeHidden();

    await page.reload();
    await expect(page.getByRole("heading", { name: title })).toHaveCount(0);
  } finally {
    await cleanupAnnouncement(title);
  }
});

test("announcement block editor stays usable on mobile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only block editor audit");
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
  await page.goto("/admin/announcements");
  await page.getByRole("button", { name: "Neue Ankuendigung" }).click();
  const dialog = page.getByRole("dialog", { name: "Neue Ankuendigung" });
  await dialog.getByRole("button", { name: "Hinweis", exact: true }).click();
  await dialog.getByRole("button", { name: "Linie", exact: true }).click();
  await dialog.getByRole("button", { name: "Button", exact: true }).click();
  await expect(dialog.getByLabel("Inhaltsvorschau")).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
