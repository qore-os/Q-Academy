import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const customCodeMaxLength = 20_000;

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

function apiHeaders(idempotencyKey: string) {
  return {
    Authorization: `Bearer ${demoKey}`,
    "Idempotency-Key": idempotencyKey,
    "X-Request-Id": randomUUID(),
  };
}

test("tenant custom code runs inline but cannot escape its sandbox", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const hubSlug = `sandbox-hub-${suffix}`;
  const hubTitle = `Sandbox Hub ${suffix}`;
  const widgetTitle = `Code Widget ${suffix}`;
  const parentCookieName = `hub_parent_${suffix}`;
  const parentCookieValue = `secret_${suffix}`;
  const probeRequests: string[] = [];
  const probeServer = createServer((probeRequest, probeResponse) => {
    probeRequests.push(probeRequest.url ?? "");
    probeResponse.writeHead(204, { "Access-Control-Allow-Origin": "*" });
    probeResponse.end();
  });
  await new Promise<void>((resolve, reject) => {
    const rejectListen = (error: Error) => reject(error);
    probeServer.once("error", rejectListen);
    probeServer.listen(0, "127.0.0.1", () => {
      probeServer.off("error", rejectListen);
      resolve();
    });
  });
  const probeAddress = probeServer.address() as AddressInfo;
  const probeOrigin = `http://127.0.0.1:${probeAddress.port}`;
  const fetchPath = `${probeOrigin}/fetch?hubSandboxFetch=${suffix}`;
  const imagePath = `${probeOrigin}/image?hubSandboxImage=${suffix}`;
  let hubId = "";

  const customCode = `
<div id="sandbox-status">pending</div>
<script>
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
    document.cookie = "sandbox_write=escaped; path=/";
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
    localStorage.setItem("sandbox_write", "escaped");
    root.dataset.storage = localStorage.getItem("sandbox_write") === "escaped"
      ? "exposed"
      : "empty";
  } catch {
    root.dataset.storage = "blocked";
  }

  fetch(${JSON.stringify(fetchPath)})
    .then(() => { root.dataset.fetch = "escaped"; })
    .catch(() => { root.dataset.fetch = "blocked"; });
  const image = document.createElement("img");
  image.alt = "blocked network probe";
  image.src = ${JSON.stringify(imagePath)};
  document.body.append(image);
  document.querySelector("#sandbox-status").textContent = "inline-executed";
})();
</script>
`;

  try {
    const created = await request.post("/api/v1/hubs", {
      headers: apiHeaders(`sandbox-create-${suffix}`),
      data: {
        title: hubTitle,
        slug: hubSlug,
        status: "published",
        layout: [
          {
            id: `sandbox-row-${suffix}`,
            columns: [
              {
                type: "code",
                title: widgetTitle,
                description: customCode,
                color: "#2bb7a9",
              },
            ],
          },
        ],
      },
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };
    hubId = createdBody.data.id;

    const [stored] = await sql<
      Array<{
        organizationSlug: string;
        layout: Array<{
          columns: Array<{ type: string; description?: string }>;
        }>;
      }>
    >`
      select organization.slug as "organizationSlug", hub.layout
      from hubs hub
      join organizations organization on organization.id = hub.organization_id
      where hub.id = ${hubId}
    `;
    expect(stored).toBeTruthy();
    expect(stored.organizationSlug).toBe("q-academy");
    expect(stored.layout[0]?.columns[0]).toMatchObject({
      type: "code",
      description: customCode,
    });

    const oversizedCode = await request.post("/api/v1/hubs", {
      headers: apiHeaders(`sandbox-code-limit-${suffix}`),
      data: {
        title: `Oversized Code ${suffix}`,
        slug: `sandbox-code-limit-${suffix}`,
        layout: [
          {
            id: "main",
            columns: [
              {
                type: "code",
                title: "Too large",
                description: "x".repeat(customCodeMaxLength + 1),
              },
            ],
          },
        ],
      },
    });
    expect(oversizedCode.status()).toBe(422);
    await expect(oversizedCode.json()).resolves.toMatchObject({
      code: "validation_error",
    });

    const oversizedText = await request.post("/api/v1/hubs", {
      headers: apiHeaders(`sandbox-text-limit-${suffix}`),
      data: {
        title: `Oversized Text ${suffix}`,
        slug: `sandbox-text-limit-${suffix}`,
        layout: [
          {
            id: "main",
            columns: [
              {
                type: "text",
                title: "Too large",
                description: "x".repeat(2_001),
              },
            ],
          },
        ],
      },
    });
    expect(oversizedText.status()).toBe(422);
    await expect(oversizedText.json()).resolves.toMatchObject({
      code: "validation_error",
    });
    const [invalidRows] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from hubs
      where slug in (
        ${`sandbox-code-limit-${suffix}`},
        ${`sandbox-text-limit-${suffix}`}
      )
    `;
    expect(invalidRows.count).toBe(0);

    await loginAsMember(page);
    await page.context().addCookies([
      {
        name: parentCookieName,
        value: parentCookieValue,
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    await page.goto(`/academy/hub?hub=${hubSlug}`);

    await expect(page.getByRole("heading", { name: hubTitle })).toBeVisible();
    expect(
      await page.evaluate(
        ({ name, value }) => document.cookie.includes(`${name}=${value}`),
        { name: parentCookieName, value: parentCookieValue },
      ),
    ).toBe(true);
    const iframe = page.locator('iframe[data-hub-code-sandbox="true"]');
    await expect(iframe).toBeVisible();
    expect(await iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect((await iframe.getAttribute("sandbox"))?.split(/\s+/)).not.toContain(
      "allow-same-origin",
    );
    await expect(iframe).toHaveAttribute("allow", "");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");

    const frame = page.frameLocator(
      'iframe[data-hub-code-sandbox="true"]',
    );
    const frameRoot = frame.locator("html");
    await expect(frame.getByText("inline-executed", { exact: true })).toBeVisible();
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

    const csp = await frame
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute("content");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("worker-src 'none'");
    expect(csp).toContain("manifest-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");

    await page.waitForTimeout(250);
    expect(probeRequests).toEqual([]);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    ).toBe(true);
  } finally {
    if (hubId) {
      await sql`delete from activity_events where entity_id = ${hubId}`;
      await sql`delete from hubs where id = ${hubId}`;
    }
    await sql.end();
    await new Promise<void>((resolve, reject) => {
      probeServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
