import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getMemberExperienceCopy } from "../src/lib/i18n/member-experience";
import { dropFiles } from "./helpers/media-drop";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const profileCopy = getMemberExperienceCopy("de").customFields;
const documentContents = Buffer.from(
  "Geprueftes Profilmedium fuer den Browser-Lifecycle.\n",
  "utf8",
);

async function login(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/admin");
}

test("profile media drag-and-drop binds to its owner and is inert in read-only mode", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Profile media lifecycle runs once.");
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const fieldLabel = `Profilmedium ${suffix}`;
  let fieldId = "";
  let assetId = "";
  let storageKeys: Array<{
    storage_key: string;
    staging_storage_key: string;
  }> = [];

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        member_id: string;
        profile_id: string;
        definition_id: string;
      }>
    >`
      select
        member.organization_id,
        member.id as member_id,
        profile.id as profile_id,
        profile.definition_id
      from users member
      join member_data_profiles profile
        on profile.organization_id = member.organization_id
       and profile.user_id = member.id
       and profile.is_default = true
       and profile.active = true
      where member.email = 'lea@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    const [field] = await sql<Array<{ id: string }>>`
      insert into custom_field_definitions (
        organization_id, key, label, type, category, visibility, active,
        sort_order
      ) values (
        ${fixture.organization_id},
        ${`profile_media_${suffix.replaceAll("-", "_")}`},
        ${fieldLabel}, 'media', 'E2E Medien', 'member', true, 900
      )
      returning id
    `;
    fieldId = field.id;
    await sql`
      insert into data_profile_fields (
        organization_id, profile_definition_id, field_id, sort_order
      ) values (
        ${fixture.organization_id}, ${fixture.definition_id}, ${fieldId}, 900
      )
    `;

    await login(page, "admin@q-academy.de");
    await page.goto(
      `/admin/members/${fixture.member_id}?profile=${fixture.profile_id}`,
    );
    const fieldControl = page
      .locator(`input[name="field:${fieldId}"]`)
      .locator("..");
    await expect(page.getByText(fieldLabel, { exact: true })).toBeVisible();
    await dropFiles(page, fieldControl, [
      {
        name: "owner-profile-medium.txt",
        mimeType: "text/plain",
        buffer: documentContents,
      },
    ]);
    await expect(
      fieldControl.getByText(profileCopy.ready, { exact: true }),
    ).toBeVisible({ timeout: 45_000 });
    assetId = await fieldControl
      .locator(`input[name="field:${fieldId}"]`)
      .inputValue();
    expect(assetId).toMatch(/^[0-9a-f-]{36}$/i);

    const [ownedAsset] = await sql<
      Array<{
        owner_user_id: string | null;
        purpose: string;
        status: string;
      }>
    >`
      select owner_user_id, purpose, status
      from media_assets
      where id = ${assetId}
    `;
    expect(ownedAsset).toEqual({
      owner_user_id: fixture.member_id,
      purpose: "profile",
      status: "ready",
    });

    await page
      .getByRole("button", { name: profileCopy.save, exact: true })
      .click();
    await expect(
      page.getByText("Profilfelder wurden gespeichert.", { exact: true }),
    ).toBeVisible();
    const [storedValue] = await sql<Array<{ value: unknown }>>`
      select value
      from data_profile_values
      where organization_id = ${fixture.organization_id}
        and user_id = ${fixture.member_id}
        and profile_id = ${fixture.profile_id}
        and field_id = ${fieldId}
    `;
    expect(storedValue.value).toBe(assetId);

    await login(page, "marco@q-academy.de");
    await page.goto(
      `/admin/members/${fixture.member_id}?profile=${fixture.profile_id}`,
    );
    const readOnlyControl = page
      .locator(`input[name="field:${fieldId}"]`)
      .locator("..");
    await expect(
      readOnlyControl.getByRole("link", { name: profileCopy.currentMedia }),
    ).toHaveAttribute("href", `/api/media-assets/${assetId}/download`);
    await expect(readOnlyControl.locator('input[type="file"]')).toHaveCount(0);
    await expect(
      readOnlyControl.getByRole("button", { name: profileCopy.removeMedia }),
    ).toHaveCount(0);

    let readOnlyCreateRequests = 0;
    const countCreateRequest = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/media-assets"
      ) {
        readOnlyCreateRequests += 1;
      }
    };
    page.on("request", countCreateRequest);
    await dropFiles(page, readOnlyControl, [
      {
        name: "must-not-upload.txt",
        mimeType: "text/plain",
        buffer: documentContents,
      },
    ]);
    await page.evaluate(
      () =>
        new Promise<void>((resolveFrame) =>
          requestAnimationFrame(() => resolveFrame()),
        ),
    );
    page.off("request", countCreateRequest);
    expect(readOnlyCreateRequests).toBe(0);
    await expect(
      readOnlyControl.locator(`input[name="field:${fieldId}"]`),
    ).toHaveValue(assetId);
  } finally {
    if (assetId) {
      storageKeys = await sql`
        select storage_key, staging_storage_key
        from media_assets
        where id = ${assetId}
      `;
    }
    if (fieldId) {
      await sql`delete from custom_field_definitions where id = ${fieldId}`;
      await sql`delete from activity_events where entity_id = ${fieldId}`;
    }
    if (assetId) {
      await sql`delete from activity_events where entity_id = ${assetId}`;
      await sql`delete from media_assets where id = ${assetId}`;
    }
    await sql.end();
    for (const key of storageKeys.flatMap((row) => [
      row.storage_key,
      row.staging_storage_key,
    ])) {
      await unlink(
        resolve(process.cwd(), ".data", "media", ...key.split("/")),
      ).catch(() => undefined);
    }
  }
});
