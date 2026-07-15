import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getPlatformCustomCodeCopy } from "../src/lib/i18n/platform-custom-code";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

async function loginWithCredentials(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/admin");
}

test("owner code slots are revisioned, isolated and available on every platform page", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Shared settings lifecycle runs once");
  test.setTimeout(150_000);

  const copy = getPlatformCustomCodeCopy("de");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const parentCookieName = `platform_parent_${suffix}`;
  const parentCookieValue = `secret_${suffix}`;
  const receivedProbeRequests: string[] = [];
  const probeServer = createServer((request, response) => {
    receivedProbeRequests.push(request.url ?? "unknown");
    response.writeHead(204).end();
  });
  await new Promise<void>((resolve, reject) => {
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", resolve);
  });
  const probeAddress = probeServer.address();
  if (!probeAddress || typeof probeAddress === "string") {
    throw new Error("Sandbox probe server did not expose a TCP port.");
  }
  const fetchPath = `http://127.0.0.1:${probeAddress.port}/fetch-${suffix}`;
  const imagePath = `http://127.0.0.1:${probeAddress.port}/image-${suffix}`;
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  let organizationId = "";
  let originalExists = false;
  let originalValue: postgres.JSONValue = null;
  let originalAuditIds: string[] = [];
  let createdAuditIds: string[] = [];

  const headerCode = `
<div id="platform-sandbox-status">pending</div>
<script nonce="forged">
(() => {
  const root = document.documentElement;
  const violations = [];
  document.addEventListener("securitypolicyviolation", (event) => {
    violations.push(event.violatedDirective);
    root.dataset.violations = violations.join(",");
  });
  root.dataset.inline = "executed";
  root.dataset.origin = self.origin;
  try {
    document.cookie = "platform_sandbox_write=escaped; path=/";
    const cookies = document.cookie;
    root.dataset.cookie = cookies ? "exposed:" + cookies : "empty";
  } catch {
    root.dataset.cookie = "blocked";
  }
  try {
    void parent.document.body;
    root.dataset.parent = "exposed";
  } catch {
    root.dataset.parent = "blocked";
  }
  try {
    localStorage.setItem("platform_sandbox_write", "escaped");
    root.dataset.storage = localStorage.getItem("platform_sandbox_write") === "escaped"
      ? "exposed"
      : "empty";
  } catch {
    root.dataset.storage = "blocked";
  }
  fetch(${JSON.stringify(fetchPath)})
    .then(() => { root.dataset.fetch = "escaped"; })
    .catch(() => { root.dataset.fetch = "blocked"; });
  const image = document.createElement("img");
  image.alt = "blocked platform network probe";
  image.src = ${JSON.stringify(imagePath)};
  document.body.append(image);
  document.querySelector("#platform-sandbox-status").textContent = "inline-executed";
})();
</script>`;
  const footerCode = `<strong id="platform-footer-${suffix}">Footer ${suffix}</strong>`;

  try {
    const [organization] = await sql<Array<{ id: string }>>`
      select id from organizations where slug = 'q-academy' limit 1
    `;
    if (!organization) throw new Error("Seeded organization is unavailable.");
    organizationId = organization.id;
    const [stored] = await sql<Array<{ value: postgres.JSONValue }>>`
      select value from platform_settings
      where organization_id = ${organizationId} and key = 'custom_code'
    `;
    originalExists = Boolean(stored);
    originalValue = stored?.value ?? null;
    const auditRows = await sql<Array<{ id: string }>>`
      select id from activity_events
      where organization_id = ${organizationId}
        and type = 'platform.custom_code.updated'
    `;
    originalAuditIds = auditRows.map((row) => row.id);

    await loginAsOwner(page);
    await page.goto("/admin/settings#custom-code");

    const form = page.locator("form#custom-code");
    await expect(form).toBeVisible();
    const save = form.getByRole("button", { name: copy.save });
    await expect(save).toBeDisabled();
    await form.getByRole("checkbox", { name: copy.enabled }).check();
    await form.locator('textarea[name="headerCode"]').fill(headerCode);
    await form.locator('input[name="headerHeight"]').fill("96");
    await form.locator('textarea[name="footerCode"]').fill(footerCode);
    await form.locator('input[name="footerHeight"]').fill("48");
    await form.locator('textarea[name="allowedNetworkOrigins"]').fill("");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(form.getByText(copy.messages.saved, { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();

    const [saved] = await sql<
      Array<{
        revision: number;
        enabled: boolean;
        headerCode: string;
        footerCode: string;
        origins: postgres.JSONValue;
      }>
    >`
      select
        (value->>'revision')::int as revision,
        (value->>'enabled')::boolean as enabled,
        value->>'headerCode' as "headerCode",
        value->>'footerCode' as "footerCode",
        value->'allowedNetworkOrigins' as origins
      from platform_settings
      where organization_id = ${organizationId} and key = 'custom_code'
    `;
    expect(saved).toMatchObject({
      enabled: true,
      headerCode,
      footerCode,
      origins: [],
    });

    await form.locator('input[name="footerHeight"]').fill("49");
    await form.locator('input[name="revision"]').evaluate(
      (input, revision) => {
        (input as HTMLInputElement).value = String(revision);
      },
      saved.revision - 1,
    );
    await save.click();
    await expect(form.getByText(copy.messages.changed, { exact: true })).toBeVisible();
    const [afterConflict] = await sql<Array<{ revision: number; footerHeight: number }>>`
      select
        (value->>'revision')::int as revision,
        (value->>'footerHeight')::int as "footerHeight"
      from platform_settings
      where organization_id = ${organizationId} and key = 'custom_code'
    `;
    expect(afterConflict).toEqual({ revision: saved.revision, footerHeight: 48 });

    const newAudits = await sql<
      Array<{ id: string; metadataText: string }>
    >`
      select id, metadata::text as "metadataText"
      from activity_events
      where organization_id = ${organizationId}
        and type = 'platform.custom_code.updated'
        and not (id = any(${originalAuditIds}::uuid[]))
    `;
    createdAuditIds = newAudits.map((row) => row.id);
    expect(newAudits).toHaveLength(1);
    expect(newAudits[0]?.metadataText).toContain("contentSha256");
    expect(newAudits[0]?.metadataText).not.toContain(headerCode);
    expect(newAudits[0]?.metadataText).not.toContain(footerCode);

    await page.context().clearCookies();
    await page.context().addCookies([
      {
        name: parentCookieName,
        value: parentCookieValue,
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.goto("/login");

    const headerFrame = page.locator(
      'iframe[data-platform-custom-code-slot="header"]',
    );
    const footerFrame = page.locator(
      'iframe[data-platform-custom-code-slot="footer"]',
    );
    await expect(headerFrame).toBeVisible();
    await expect(footerFrame).toBeVisible();
    await expect(headerFrame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(headerFrame).toHaveAttribute("allow", "");
    await expect(headerFrame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(headerFrame).toHaveAttribute("loading", "eager");
    expect(await headerFrame.evaluate((element) => element.getBoundingClientRect().height)).toBe(96);

    const header = page.frameLocator(
      'iframe[data-platform-custom-code-slot="header"]',
    );
    const frameRoot = header.locator("html");
    await expect(header.getByText("inline-executed", { exact: true })).toBeVisible();
    await expect(frameRoot).toHaveAttribute("data-inline", "executed");
    await expect(frameRoot).toHaveAttribute("data-origin", "null");
    await expect(frameRoot).toHaveAttribute("data-parent", "blocked");
    await expect(frameRoot).toHaveAttribute("data-storage", "blocked");
    await expect(frameRoot).toHaveAttribute("data-fetch", "blocked");
    const cookieState = await frameRoot.getAttribute("data-cookie");
    expect(cookieState).toMatch(/^(blocked|empty)$/);
    expect(cookieState).not.toContain(parentCookieName);
    expect(cookieState).not.toContain(parentCookieValue);
    await expect
      .poll(async () => {
        const directives =
          (await frameRoot.getAttribute("data-violations"))?.split(",") ?? [];
        return new Set(directives);
      })
      .toEqual(new Set(["connect-src", "img-src"]));
    const csp = await header
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("worker-src 'none'");
    await expect(
      page
        .frameLocator('iframe[data-platform-custom-code-slot="footer"]')
        .getByText(`Footer ${suffix}`, { exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(250);
    expect(receivedProbeRequests).toEqual([]);

    await page.setViewportSize({ width: 412, height: 915 });
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("platform-custom-code-mobile.png"),
      fullPage: true,
    });

    await loginWithCredentials(page, "sarah@q-academy.de");
    await page.goto("/admin/settings#custom-code");
    const adminForm = page.locator("form#custom-code");
    await expect(adminForm.getByText(copy.ownerOnly, { exact: true })).toBeVisible();
    await expect(adminForm.getByRole("checkbox", { name: copy.enabled })).toBeDisabled();
    await expect(adminForm.getByRole("button", { name: copy.save })).toBeDisabled();
  } finally {
    if (organizationId) {
      if (originalExists) {
        await sql`
          insert into platform_settings (organization_id, key, value)
          values (${organizationId}, 'custom_code', ${sql.json(originalValue)})
          on conflict (organization_id, key)
          do update set value = excluded.value, updated_at = now()
        `;
      } else {
        await sql`
          delete from platform_settings
          where organization_id = ${organizationId} and key = 'custom_code'
        `;
      }
      if (createdAuditIds.length > 0) {
        await sql`
          delete from activity_events where id = any(${createdAuditIds}::uuid[])
        `;
      }
    }
    await sql.end();
    await new Promise<void>((resolve, reject) => {
      probeServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
