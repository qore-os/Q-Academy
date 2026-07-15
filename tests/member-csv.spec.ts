import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import Papa from "papaparse";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("owner imports and exports members as CSV", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "CSV lifecycle runs once on desktop Chromium");

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const email = `csv-smoke-${suffix}@example.com`;
  const invalidEmail = `csv-invalid-${suffix}@example.com`;

  try {
    await loginAsOwner(page);
    await page.goto("/admin/members");
    await expect(
      page.getByRole("heading", { name: "Mitglieder", exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Mitglieder importieren" });
    await expect(dialog).toBeVisible();

    const csv = [
      "email,first_name,last_name,role,status,job_title,department",
      `${email.toUpperCase()},CSV,Smoke,member,invited,QA Engineer,Quality`,
      `${email},CSV,Doppelt,member,invited,QA Engineer,Quality`,
      `${invalidEmail},CSV,Ungueltig,member,active,QA Engineer,Quality`,
    ].join("\r\n");
    await dialog.locator('input[name="file"]').setInputFiles({
      name: "mitglieder-smoke.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await dialog.getByRole("button", { name: "CSV importieren" }).click();

    await expect(
      dialog.getByText("Import abgeschlossen: 1 eingeladen, 1 uebersprungen, 1 fehlerhaft."),
    ).toBeVisible();
    await expect(dialog.getByText("E-Mail ist mehrfach in der CSV-Datei vorhanden.")).toBeVisible();
    await expect(dialog.getByText("Neue Nutzer muessen den Status invited haben.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("member-import-summary.png"), fullPage: false });

    const [member] = await client<{
      id: string;
      email: string;
      role: string;
      status: string;
      password_hash: string;
    }[]>`
      select id, email, role::text, status::text, password_hash
      from users
      where email = ${email}
    `;
    expect(member).toMatchObject({ email, role: "member", status: "invited" });
    expect(member.password_hash).toMatch(/^\$2[aby]\$/);

    const [invitation] = await client<{ token_hash: string; accepted_at: Date | null }[]>`
      select token_hash, accepted_at
      from invitations
      where user_id = ${member.id}
    `;
    expect(invitation.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation.accepted_at).toBeNull();

    await dialog.getByRole("button", { name: "Schliessen", exact: true }).click();
    const search = page.getByPlaceholder(/Mitglieder durchsuchen/);
    await search.fill(email);
    const memberRow = page.getByRole("row").filter({ hasText: email });
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow.getByText("Eingeladen", { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^mitglieder-\d{4}-\d{2}-\d{2}\.csv$/);
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const exportedText = await readFile(downloadPath!, "utf8");
    expect(exportedText.startsWith("\uFEFF")).toBe(true);

    const exported = Papa.parse<Record<string, string>>(exportedText.replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: true,
    });
    expect(exported.meta.fields).toEqual([
      "email",
      "first_name",
      "last_name",
      "role",
      "status",
      "job_title",
      "department",
    ]);
    expect(exported.meta.fields).not.toContain("password_hash");
    expect(exported.meta.fields).not.toContain("token_hash");
    expect(exported.data).toContainEqual({
      email,
      first_name: "CSV",
      last_name: "Smoke",
      role: "member",
      status: "invited",
      job_title: "QA Engineer",
      department: "Quality",
    });

    await memberRow.getByRole("button", { name: "CSV Smoke deaktivieren" }).click();
    await expect(memberRow.getByText("Deaktiviert", { exact: true })).toBeVisible();
    const [disabled] = await client<{ status: string }[]>`
      select status::text from users where id = ${member.id}
    `;
    expect(disabled.status).toBe("disabled");

    const [revokedInvitation] = await client<{ accepted_at: Date | null }[]>`
      select accepted_at from invitations where user_id = ${member.id}
    `;
    expect(revokedInvitation.accepted_at).not.toBeNull();

    await memberRow.getByRole("button", { name: "CSV Smoke aktivieren" }).click();
    await expect(memberRow.getByText("Aktiv", { exact: true })).toBeVisible();
    const [active] = await client<{ status: string }[]>`
      select status::text from users where id = ${member.id}
    `;
    expect(active.status).toBe("active");
  } finally {
    const imported = await client<{ id: string }[]>`
      select id from users where email = ${email}
    `;
    for (const member of imported) {
      await client`delete from activity_events where entity_id = ${member.id}`;
      await client`delete from users where id = ${member.id}`;
    }
    await client.end();
  }
});

test("member CSV controls fit the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only layout assertion");

  await loginAsOwner(page);
  await page.goto("/admin/members");
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Mitglieder importieren" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("CSV-Datei auswaehlen")).toBeVisible();
  await expect(dialog.getByText("Keine Datei ausgewaehlt")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("member-import-mobile.png"), fullPage: false });
});
