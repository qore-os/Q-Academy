import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL(email === "admin@q-academy.de" ? "**/admin" : "**/academy");
  if (email !== "admin@q-academy.de") await completeMemberWelcomeIfVisible(page);
}

test("a scanned avatar binds only to its owner and renders on mobile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Avatar lifecycle runs once");
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  let assetId = "";
  let organizationId = "";
  let memberId = "";
  let originalAvatarUrl: string | null = null;

  try {
    const [member] = await sql<
      { id: string; organization_id: string; avatar_url: string | null }[]
    >`
      select id, organization_id, avatar_url
      from users where email = 'lea@q-academy.de' limit 1
    `;
    memberId = member.id;
    organizationId = member.organization_id;
    originalAvatarUrl = member.avatar_url;

    await login(page, "lea@q-academy.de");
    await page.goto("/academy/profile");
    const field = page.locator('input[name="avatarAssetId"]').locator("..");
    await field.locator('input[type="file"]').setInputFiles({
      name: "lea-avatar.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(page.getByText("Geprueft und bereit", { exact: true })).toBeVisible({
      timeout: 45_000,
    });
    assetId = await page.locator('input[name="avatarAssetId"]').inputValue();
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/i);
    await page.getByRole("button", { name: "Profil speichern" }).click();
    await expect(page.getByText("Profil gespeichert.", { exact: true })).toBeVisible();

    const [stored] = await sql<
      { avatar_url: string | null; purpose: string; status: string; owner_user_id: string | null }[]
    >`
      select u.avatar_url, ma.purpose, ma.status, ma.owner_user_id
      from users u
      join media_assets ma on ma.id = ${assetId}
      where u.id = ${memberId}
    `;
    expect(stored).toMatchObject({
      avatar_url: `/api/media-assets/${assetId}/download`,
      purpose: "avatar",
      status: "ready",
      owner_user_id: memberId,
    });

    const ownDownload = await page.request.get(
      `/api/media-assets/${assetId}/download?disposition=inline`,
    );
    expect(ownDownload.status()).toBe(200);
    expect(ownDownload.headers()["content-type"]).toBe("image/png");
    const boundDelete = await page.evaluate(async (id) => {
      const response = await fetch(`/api/media-assets/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, assetId);
    expect(boundDelete).toBe(409);

    await login(page, "admin@q-academy.de");
    const tenantMemberDownload = await page.request.get(
      `/api/media-assets/${assetId}/download`,
    );
    expect(tenantMemberDownload.status()).toBe(200);

    await login(page, "lea@q-academy.de");
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto("/academy/profile");
    await expect(page.getByText("Profilbild", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("profile-avatar-mobile.png"),
      fullPage: true,
    });
  } finally {
    let storageKeys: { storage_key: string; staging_storage_key: string }[] = [];
    if (assetId) {
      storageKeys = await sql`
        select storage_key, staging_storage_key from media_assets where id = ${assetId}
      `;
    }
    if (memberId) {
      await sql`
        update users set avatar_url = ${originalAvatarUrl} where id = ${memberId}
      `;
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and type = 'profile.updated'
          and entity_id = ${memberId}
      `;
    }
    if (assetId) {
      await sql`delete from media_assets where id = ${assetId}`;
      for (const key of storageKeys.flatMap((row) => [row.storage_key, row.staging_storage_key])) {
        await unlink(resolve(process.cwd(), ".data", "media", ...key.split("/"))).catch(
          () => undefined,
        );
      }
    }
    await sql.end();
  }
});
