import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const apiAuthorization = { Authorization: `Bearer ${demoKey}` };
const maintenanceLockKey = "q-academy:media-maintenance:v1";

function workerAuthorization() {
  const secret = environmentValue("CRON_SECRET");
  if (!secret) throw new Error("CRON_SECRET is required by this test.");
  return { Authorization: `Bearer ${secret}` };
}

async function maintain(request: APIRequestContext, path = "?limit=5") {
  return request.post(`/api/internal/jobs/media/maintenance${path}`, {
    headers: workerAuthorization(),
  });
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Database maintenance runs once.",
  );
});

test("media maintenance authenticates before enforcing bounded queries", async ({
  request,
}) => {
  const unauthorized = await request.post(
    "/api/internal/jobs/media/maintenance?limit=99",
  );
  expect(unauthorized.status()).toBe(401);

  for (const query of [
    "?limit=0",
    "?limit=6",
    "?limit=1.5",
    "?limit=01",
    "?limit=1&limit=2",
    "?other=1",
  ]) {
    const response = await maintain(request, query);
    expect(response.status(), query).toBe(400);
    expect(response.headers()["content-type"], query).toContain(
      "application/problem+json",
    );
  }

  const defaultLimit = await maintain(request, "");
  expect(defaultLimit.status()).toBe(200);
  expect((await defaultLimit.json()).data.skipped).toBe(false);
});

test("maintenance expires claimed direct uploads without blocking the next batch", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const claimedAssetId = randomUUID();
  const nextAssetId = randomUUID();
  const directClaimToken = randomUUID();
  try {
    const [organization] = await sql<Array<{ id: string }>>`
      select id from organizations order by created_at limit 1
    `;
    expect(organization?.id).toBeTruthy();
    await sql`
      insert into media_assets (
        id, organization_id, purpose, kind, status, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at, direct_upload_claim_token,
        direct_upload_claimed_at, created_at
      ) values
      (
        ${claimedAssetId}, ${organization.id}, 'course_content', 'video',
        'pending', 's3',
        ${`tenants/${organization.id}/assets/${claimedAssetId}/ready.mp4`},
        ${`incoming/tenants/${organization.id}/assets/${claimedAssetId}/incoming.mp4`},
        'claimed.mp4', 'claimed.mp4', 'video/mp4', 8, 8,
        '2000-01-01T00:00:00Z', ${directClaimToken}, now(), now()
      ),
      (
        ${nextAssetId}, ${organization.id}, 'course_content', 'video',
        'pending', 's3',
        ${`tenants/${organization.id}/assets/${nextAssetId}/ready.mp4`},
        ${`incoming/tenants/${organization.id}/assets/${nextAssetId}/incoming.mp4`},
        'next.mp4', 'next.mp4', 'video/mp4', 8, 8,
        '2000-01-02T00:00:00Z', null, null, now()
      )
    `;

    const first = await maintain(request, "?limit=1");
    expect(first.status()).toBe(200);
    expect((await first.json()).data.expiredUploads).toBeGreaterThanOrEqual(1);
    const [claimed] = await sql<
      Array<{
        status: string;
        directUploadClaimToken: string | null;
        directUploadClaimedAt: Date | null;
        scanFailureCode: string | null;
      }>
    >`
      select status,
        direct_upload_claim_token as "directUploadClaimToken",
        direct_upload_claimed_at as "directUploadClaimedAt",
        scan_failure_code as "scanFailureCode"
      from media_assets where id = ${claimedAssetId}
    `;
    expect(claimed).toMatchObject({
      status: "deleted",
      directUploadClaimToken: null,
      directUploadClaimedAt: null,
      scanFailureCode: "upload_expired",
    });

    const second = await maintain(request, "?limit=1");
    expect(second.status()).toBe(200);
    const [next] = await sql<Array<{ status: string }>>`
      select status from media_assets where id = ${nextAssetId}
    `;
    expect(next?.status).toBe("deleted");
  } finally {
    await sql`
      delete from media_assets
      where id in (${claimedAssetId}, ${nextAssetId})
    `.catch(() => undefined);
    await sql.end();
  }
});

test("media dispatch serializes a non-empty PostgreSQL backlog timestamp", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const assetId = randomUUID();
  const claimToken = randomUUID();
  try {
    const [organization] = await sql<Array<{ id: string }>>`
      select id from organizations order by created_at limit 1
    `;
    expect(organization?.id).toBeTruthy();
    await sql`
      insert into media_assets (
        id, organization_id, purpose, kind, status, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
        upload_expires_at, uploaded_at, scan_attempt, scan_claim_token,
        scan_claimed_at, scan_lease_expires_at, created_at
      ) values (
        ${assetId}, ${organization.id}, 'course_content', 'document', 'scanning',
        'filesystem',
        ${`tenants/${organization.id}/assets/${assetId}/ready.txt`},
        ${`incoming/tenants/${organization.id}/assets/${assetId}/incoming.txt`},
        'backlog.txt', 'backlog.txt', 'text/plain', 1, 1, 1,
        now() + interval '1 hour', now(), 1, ${claimToken}, now(),
        now() + interval '1 hour', now() - interval '2 minutes'
      )
    `;

    const response = await request.post(
      "/api/internal/jobs/media/dispatch?limit=1",
      { headers: workerAuthorization() },
    );
    expect(response.status()).toBe(200);
    const body = (await response.json()) as {
      data: {
        backlog: {
          depth: number;
          failed: number;
          oldestQueuedAt: string | null;
          oldestAgeSeconds: number;
          overloaded: boolean;
        };
      };
    };
    expect(body.data.backlog.depth).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(body.data.backlog.failed)).toBe(true);
    expect(body.data.backlog.failed).toBeGreaterThanOrEqual(0);
    expect(body.data.backlog.oldestQueuedAt).not.toBeNull();
    expect(
      Number.isFinite(Date.parse(body.data.backlog.oldestQueuedAt!)),
    ).toBe(true);
    expect(Number.isInteger(body.data.backlog.oldestAgeSeconds)).toBe(true);
    expect(body.data.backlog.oldestAgeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof body.data.backlog.overloaded).toBe("boolean");
  } finally {
    await sql`delete from media_assets where id = ${assetId}`;
    await sql.end();
  }
});

test("a held maintenance lock skips cleanup without blocking media scans", async ({
  request,
}) => {
  const lockClient = postgres(databaseUrl, { max: 1, prepare: false });
  const dataClient = postgres(databaseUrl, { max: 1, prepare: false });
  const content = Buffer.from("maintenance lock scan isolation\n", "utf8");
  const idempotencyPrefix = `maintenance-media-${randomUUID()}`;
  let assetId: string | null = null;
  let locked = false;
  try {
    const created = await request.post("/api/v1/media-assets", {
      headers: {
        ...apiAuthorization,
        "Idempotency-Key": `${idempotencyPrefix}-scan`,
      },
      data: {
        purpose: "course_content",
        originalFileName: "maintenance-lock.txt",
        declaredMimeType: "text/plain",
        sizeBytes: content.length,
      },
    });
    expect(created.status()).toBe(201);
    assetId = ((await created.json()) as { data: { id: string } }).data.id;
    const uploaded = await request.put(
      `/api/v1/media-assets/${assetId}/content`,
      {
        headers: { ...apiAuthorization, "Content-Type": "text/plain" },
        data: content,
      },
    );
    expect(uploaded.status()).toBe(204);

    await lockClient`
      select pg_advisory_lock(hashtextextended(${maintenanceLockKey}, 0))
    `;
    locked = true;

    const skipped = await maintain(request);
    expect(skipped.status()).toBe(200);
    expect((await skipped.json()).data).toMatchObject({
      processed: 0,
      skipped: true,
    });

    let status = "uploaded";
    for (let attempt = 0; attempt < 10 && status === "uploaded"; attempt += 1) {
      const scan = await request.post(
        "/api/internal/jobs/media/dispatch?limit=1",
        { headers: workerAuthorization() },
      );
      expect(scan.status()).toBe(200);
      const [asset] = await dataClient<Array<{ status: string }>>`
        select status from media_assets where id = ${assetId}
      `;
      status = asset?.status ?? "missing";
    }
    expect(status).toBe("ready");
  } finally {
    if (locked) {
      await lockClient`
        select pg_advisory_unlock(hashtextextended(${maintenanceLockKey}, 0))
      `.catch(() => undefined);
    }
    if (assetId) {
      await request.delete(`/api/v1/media-assets/${assetId}`, {
        headers: {
          ...apiAuthorization,
          "Idempotency-Key": `${idempotencyPrefix}-delete`,
        },
      });
      await dataClient`
        update media_assets
        set upload_expires_at = now() - interval '2 hours',
          deleted_at = now() - interval '2 hours'
        where id = ${assetId}
      `;
      await maintain(request).catch(() => undefined);
      await dataClient`delete from media_assets where id = ${assetId}`;
    }
    await dataClient`
      delete from api_idempotency_keys
      where key like ${`${idempotencyPrefix}%`}
    `;
    await lockClient.end();
    await dataClient.end();
  }
});
