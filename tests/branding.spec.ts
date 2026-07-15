import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getLogoCopy } from "@/lib/i18n/logo";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";

const settingsCopy = getSettingsAdminCopy("de");
const mediaCopy = getMemberExperienceCopy("de").media;
const logoCopy = getLogoCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoApiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

async function waitForSettingsHydration(page: Page) {
  const loginPreview = page.getByRole("button", { name: "Login", exact: true });
  const dashboardPreview = page.getByRole("button", {
    name: "Dashboard",
    exact: true,
  });
  await loginPreview.click();
  await expect(loginPreview).toHaveAttribute("aria-pressed", "true");
  await dashboardPreview.click();
  await expect(dashboardPreview).toHaveAttribute("aria-pressed", "true");
}

async function uploadBrandImage(page: Page, label: string, name: string) {
  const field = page.getByText(label, { exact: true }).locator("..");
  await field.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "image/png",
    buffer: png,
  });
  await expect(field.getByText(mediaCopy.ready, { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  return field.locator('input[type="hidden"]').first().inputValue();
}

async function submitTamperedBrandingAsset(
  page: Page,
  name: string,
  assetId: string,
) {
  await page.locator(`input[name="${name}"]`).evaluate(
    (input, { fieldName, id }) => {
      const form = input.closest("form");
      const submit = form?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (!form || !submit) throw new Error("Branding form is unavailable.");
      (input as HTMLInputElement).disabled = true;
      const tampered = document.createElement("input");
      tampered.type = "hidden";
      tampered.name = fieldName;
      tampered.value = id;
      form.append(tampered);
      form.requestSubmit(submit);
    },
    { fieldName: name, id: assetId },
  );
}

test("scanned tenant branding is bound, public by active host and responsive", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Branding lifecycle runs once");
  test.setTimeout(150_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const platformName = `Nordstern ${suffix}`;
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydrated but some attributes|hydration failed/i.test(message.text())) {
      hydrationWarnings.push(message.text());
    }
  });
  const uploadedIds: string[] = [];
  let organizationId = "";
  let originalDesign: Record<string, unknown> = {};
  let foreignOrganizationId = "";
  let pendingId = "";

  try {
    const [fixture] = await sql<
      { id: string; design: Record<string, unknown> | null }[]
    >`
      select o.id, ps.value as design
      from organizations o
      left join platform_settings ps
        on ps.organization_id = o.id and ps.key = 'design'
      where o.slug = 'q-academy'
      limit 1
    `;
    organizationId = fixture.id;
    originalDesign = fixture.design ?? {};

    await loginAsAdmin(page);
    await page.goto("/admin/settings");
    await waitForSettingsHydration(page);

    pendingId = randomUUID();
    await sql`
      insert into media_assets (
        id, organization_id, purpose, kind, status, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
      ) values (
        ${pendingId}, ${organizationId}, 'branding', 'image', 'pending', 'filesystem',
        ${`tenants/${organizationId}/assets/${pendingId}/pending.png`},
        ${`incoming/tenants/${organizationId}/assets/${pendingId}/pending.png`},
        'pending.png', 'pending.png', 'image/png', 68, 68, now() + interval '1 hour'
      )
    `;
    await submitTamperedBrandingAsset(page, "logoLightAssetId", pendingId);
    await expect(
      page.getByText(
        settingsCopy.messages.designAssetUnavailable,
        { exact: true },
      ),
    ).toBeVisible();
    await page.reload();
    await waitForSettingsHydration(page);

    const foreignId = randomUUID();
    const [foreignOrganization] = await sql<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Foreign ${suffix}`}, ${`foreign-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    await sql`
      insert into media_assets (
        id, organization_id, purpose, kind, status, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, detected_mime_type, declared_size_bytes,
        actual_size_bytes, quota_bytes, upload_expires_at, uploaded_at,
        scan_completed_at
      ) values (
        ${foreignId}, ${foreignOrganizationId}, 'branding', 'image', 'ready', 'filesystem',
        ${`tenants/${foreignOrganizationId}/assets/${foreignId}/foreign.png`},
        ${`incoming/tenants/${foreignOrganizationId}/assets/${foreignId}/foreign.png`},
        'foreign.png', 'foreign.png', 'image/png', 'image/png', 68, 68, 68,
        now() + interval '1 hour', now(), now()
      )
    `;
    await submitTamperedBrandingAsset(page, "logoLightAssetId", foreignId);
    await expect(
      page.getByText(
        settingsCopy.messages.designAssetUnavailable,
        { exact: true },
      ),
    ).toBeVisible();

    await page.reload();
    uploadedIds.push(
      await uploadBrandImage(page, settingsCopy.design.lightLogo, "logo-light.png"),
      await uploadBrandImage(page, settingsCopy.design.darkLogo, "logo-dark.png"),
      await uploadBrandImage(page, settingsCopy.design.favicon, "favicon.png"),
      await uploadBrandImage(
        page,
        settingsCopy.design.socialPreview,
        "preview.png",
      ),
      await uploadBrandImage(
        page,
        settingsCopy.design.loginBackground,
        "login.png",
      ),
    );

    await page.getByLabel(settingsCopy.design.platformName).fill(platformName);
    await page.getByLabel(settingsCopy.design.primaryColor).fill("#253b78");
    await page.getByLabel(settingsCopy.design.accentColor).fill("#d4553f");
    await page
      .getByRole("button", { name: settingsCopy.design.loginMode, exact: true })
      .click();
    await expect(
      page.getByAltText(settingsCopy.design.backgroundPreview),
    ).toBeVisible();
    await page
      .getByRole("button", { name: settingsCopy.design.save })
      .click();
    await expect(
      page.getByText(settingsCopy.messages.designSaved, { exact: true }),
    ).toBeVisible();

    const [stored] = await sql<{ value: Record<string, unknown> }[]>`
      select value from platform_settings
      where organization_id = ${organizationId} and key = 'design'
    `;
    expect(stored.value).toMatchObject({
      platformName,
      logoLightAssetId: uploadedIds[0],
      logoDarkAssetId: uploadedIds[1],
      faviconAssetId: uploadedIds[2],
      socialPreviewImageAssetId: uploadedIds[3],
      loginBackgroundAssetId: uploadedIds[4],
    });
    for (const legacyField of [
      "logoLightUrl",
      "logoDarkUrl",
      "faviconUrl",
      "socialPreviewImageUrl",
      "loginBackgroundUrl",
    ]) {
      expect(stored.value[legacyField]).toBeNull();
    }

    const publicPaths = [
      "/api/tenant-branding/assets/logo-light",
      "/api/tenant-branding/assets/logo-dark",
      "/api/tenant-branding/assets/favicon",
      "/api/tenant-branding/assets/social-preview",
      "/api/tenant-branding/assets/login-background",
    ];
    await page.context().clearCookies();
    for (const path of publicPaths) {
      const response = await request.get(path);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toContain("public");
    }
    const unknownHost = await request.get(publicPaths[0], {
      headers: { Host: "unknown.invalid" },
    });
    expect(unknownHost.status()).toBe(404);

    await page.goto("/login");
    await expect(page.getByAltText(logoCopy.logoAlt(platformName))).toHaveAttribute(
      "src",
      publicPaths[0],
    );
    await expect(page.getByAltText(platformName, { exact: true })).toHaveAttribute(
      "src",
      publicPaths[4],
    );
    await page.setViewportSize({ width: 412, height: 915 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("branding-media-mobile.png"),
      fullPage: true,
    });
    expect(hydrationWarnings, hydrationWarnings.join("\n\n")).toEqual([]);
  } finally {
    if (organizationId) {
      await request.patch("/api/v1/organization", {
        headers: { Authorization: `Bearer ${demoApiKey}` },
        data: { settings: { design: originalDesign } },
      });
    }
    const storageKeys = uploadedIds.length
      ? await sql<{ storage_key: string; staging_storage_key: string }[]>`
          select storage_key, staging_storage_key
          from media_assets where id = any(${uploadedIds})
        `
      : [];
    if (pendingId) await sql`delete from media_assets where id = ${pendingId}`;
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    if (uploadedIds.length) {
      await sql`delete from media_assets where id = any(${uploadedIds})`;
      for (const key of storageKeys.flatMap((row) => [row.storage_key, row.staging_storage_key])) {
        await unlink(resolve(process.cwd(), ".data", "media", ...key.split("/"))).catch(
          () => undefined,
        );
      }
    }
    await sql.end();
  }
});

test("trainer cannot open organization branding settings", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Authorization check runs once");
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill("marco@q-academy.de");
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/admin");
  await page.goto("/admin/settings");
  await expect(page).toHaveURL(/\/admin\/courses$/);
});
