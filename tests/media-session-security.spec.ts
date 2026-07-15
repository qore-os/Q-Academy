import { randomUUID } from "node:crypto";
import http from "node:http";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsDemo(page: Page, role: "member" | "admin") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "member" ? /Lernenden-Demo|Member-Demo|Als Mitglied testen/ : /Admin-Demo|Als Admin testen/,
    })
    .click();
  await page.waitForURL(role === "member" ? "**/academy" : "**/admin");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

async function browserJson(
  page: Page,
  url: string,
  init: { method?: string; body?: unknown } = {},
) {
  return page.evaluate(
    async ({ target, request }) => {
      const response = await fetch(target, {
        method: request.method ?? "GET",
        credentials: "same-origin",
        headers:
          request.body === undefined ? undefined : { "Content-Type": "application/json" },
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });
      return { status: response.status, body: await response.json() };
    },
    { target: url, request: init },
  );
}

async function chunkedOversizeRequest(cookie: string) {
  return new Promise<number>((resolve, reject) => {
    const request = http.request(
      "http://127.0.0.1:3000/api/media-assets",
      {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: "http://127.0.0.1:3000",
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("error", reject);
    request.write(`{"clientUploadId":"${randomUUID()}","padding":"`);
    for (let index = 0; index < 40; index += 1) request.write("x".repeat(512));
    request.end('"}');
  });
}

test("session media intents enforce origin, bounds, idempotency and ownership", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Security workflow runs once");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const clientUploadId = randomUUID();
  const scanningUploadId = randomUUID();
  const payload = {
    clientUploadId,
    originalFileName: "session-security.txt",
    declaredMimeType: "text/plain",
    sizeBytes: 48,
  };

  try {
    await loginAsDemo(page, "member");
    const forbiddenCourseUploadId = randomUUID();
    const forbiddenCourseUpload = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: {
        ...payload,
        purpose: "course_content",
        clientUploadId: forbiddenCourseUploadId,
      },
    });
    expect(forbiddenCourseUpload.status).toBe(403);
    const [forbiddenReservation] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from media_assets where id = ${forbiddenCourseUploadId}
    `;
    expect(forbiddenReservation.count).toBe(0);

    const created = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: payload,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({
      data: {
        id: clientUploadId,
        status: "pending",
        upload: {
          method: "PUT",
          headers: {
            "Content-Length": "48",
            "Content-Type": "text/plain",
            "If-None-Match": "*",
          },
        },
      },
    });
    expect(created.body.data).not.toHaveProperty("storageKey");
    expect(created.body.data).not.toHaveProperty("stagingStorageKey");

    const replay = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: payload,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(clientUploadId);
    const [reservation] = await sql<
      Array<{ asset_count: number; quota_bytes: number }>
    >`
      select count(*)::int as asset_count, coalesce(sum(quota_bytes), 0)::int as quota_bytes
      from media_assets where id = ${clientUploadId}
    `;
    expect(reservation).toEqual({ asset_count: 1, quota_bytes: 48 });

    const conflict = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: { ...payload, sizeBytes: 49 },
    });
    expect(conflict.status).toBe(409);

    const scanningIntent = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: { ...payload, clientUploadId: scanningUploadId },
    });
    expect(scanningIntent.status).toBe(201);
    await sql`
      update media_assets set
        status = 'scanning', actual_size_bytes = declared_size_bytes,
        uploaded_at = now(), scan_attempt = 1,
        scan_claim_token = ${randomUUID()}, scan_claimed_at = now(),
        scan_lease_expires_at = now() + interval '15 minutes',
        scan_next_retry_at = null
      where id = ${scanningUploadId}
    `;
    const ownerScanningDelete = await page.evaluate(async (id) => {
      const response = await fetch(`/api/media-assets/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, scanningUploadId);
    expect(ownerScanningDelete).toBe(409);

    const crossOrigin = await page.request.post("/api/media-assets", {
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
      },
      data: { ...payload, clientUploadId: randomUUID() },
    });
    expect(crossOrigin.status()).toBe(403);

    const missingBrowserMetadata = await page.request.post("/api/media-assets", {
      headers: { "Content-Type": "application/json" },
      data: { ...payload, clientUploadId: randomUUID() },
    });
    expect(missingBrowserMetadata.status()).toBe(403);

    const oversized = await page.evaluate(async () => {
      const response = await fetch("/api/media-assets", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
      });
      return response.status;
    });
    expect(oversized).toBe(413);

    const sessionCookie = (await page.context().cookies())
      .filter((cookie) => cookie.name.includes("q_academy_session"))
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join("; ");
    expect(sessionCookie).toBeTruthy();
    await expect(chunkedOversizeRequest(sessionCookie)).resolves.toBe(413);

    await loginAsDemo(page, "admin");
    const staffStatus = await browserJson(
      page,
      `/api/media-assets/${clientUploadId}`,
    );
    expect(staffStatus.status).toBe(200);

    const staffUpload = await page.evaluate(async (id) => {
      const response = await fetch(`/api/media-assets/${id}/content`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "text/plain", "If-None-Match": "*" },
        body: "x".repeat(48),
      });
      return response.status;
    }, clientUploadId);
    expect(staffUpload).toBe(404);
    const staffDelete = await page.evaluate(async (id) => {
      const response = await fetch(`/api/media-assets/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      return response.status;
    }, clientUploadId);
    expect(staffDelete).toBe(404);

    await sql`
      update media_assets set upload_expires_at = now() - interval '1 minute'
      where id = ${clientUploadId}
    `;
    await loginAsDemo(page, "member");
    const expiredReplay = await browserJson(page, "/api/media-assets", {
      method: "POST",
      body: payload,
    });
    expect(expiredReplay.status).toBe(409);
    expect(expiredReplay.body.errors).toEqual({ reason: "upload_expired" });
  } finally {
    await sql`
      delete from activity_events
      where entity_id in (${clientUploadId}, ${scanningUploadId})
    `;
    await sql`
      delete from media_assets where id in (${clientUploadId}, ${scanningUploadId})
    `;
    await sql.end();
  }
});
