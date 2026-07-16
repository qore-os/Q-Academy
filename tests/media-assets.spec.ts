import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

import { fetchMediaDownload } from "./helpers/media-download";
import { testEnvironmentValue as environmentValue } from "./helpers/test-environment";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

async function dispatch(request: APIRequestContext) {
  const secret = environmentValue("CRON_SECRET");
  return request.post("/api/internal/jobs/media/dispatch?limit=1", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

async function maintain(request: APIRequestContext) {
  const secret = environmentValue("CRON_SECRET");
  return request.post("/api/internal/jobs/media/maintenance?limit=5", {
    headers: secret ? { Authorization: `Bearer ${secret}` } : undefined,
  });
}

async function scanUntilTerminal(request: APIRequestContext, assetId: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const worked = await dispatch(request);
    expect(worked.status()).toBe(200);
    const detail = await request.get(`/api/v1/media-assets/${assetId}`, {
      headers: authorization,
    });
    expect(detail.status()).toBe(200);
    const status = ((await detail.json()) as { data: { status: string } }).data
      .status;
    if (["ready", "quarantined", "failed"].includes(status)) return status;
  }
  throw new Error("Media asset did not reach a terminal scan state.");
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Database lifecycle runs once.");
});

test("media identifiers authenticate before returning stable validation errors", async ({
  request,
}) => {
  for (const path of [
    "/api/v1/media-assets/not-a-uuid",
    "/api/v1/media-assets/not-a-uuid/content",
    "/api/v1/media-assets/not-a-uuid/download",
  ]) {
    expect((await request.get(path, { maxRedirects: 0 })).status()).toBe(401);
    const response = await request.get(path, {
      headers: authorization,
      maxRedirects: 0,
    });
    expect(response.status()).toBe(400);
    expect(response.headers()["content-type"]).toContain(
      "application/problem+json",
    );
  }
});

test("media lifecycle is write-once, scanned, and document-safe", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const content = Buffer.from("Q-Academy media lifecycle\n", "utf8");
  const idempotencyPrefix = `media-lifecycle-${randomUUID()}`;
  let assetId: string | null = null;
  try {
    const created = await request.post("/api/v1/media-assets", {
      headers: { ...authorization, "Idempotency-Key": `${idempotencyPrefix}-create` },
      data: {
        purpose: "course_content",
        originalFileName: "notes.txt",
        declaredMimeType: "text/plain",
        sizeBytes: content.length,
      },
    });
    expect(created.status()).toBe(201);
    const body = (await created.json()) as {
      data: {
        id: string;
        upload: { headers: Record<string, string>; transport: string };
      };
    };
    assetId = body.data.id;
    expect(body.data).not.toHaveProperty("storageKey");
    expect(body.data).not.toHaveProperty("stagingStorageKey");
    expect(body.data).not.toHaveProperty("storageVersionId");
    expect(body.data).not.toHaveProperty("stagingStorageVersionId");
    expect(body.data).not.toHaveProperty("contentSha256");
    expect(body.data.upload.transport).toBe("application");
    expect(body.data.upload.headers["Content-Length"]).toBe(String(content.length));
    expect(body.data.upload.headers["If-None-Match"]).toBe("*");

    const uploads = await Promise.all([
      request.put(`/api/v1/media-assets/${assetId}/content`, {
        headers: { ...authorization, "Content-Type": "text/plain" },
        data: content,
      }),
      request.put(`/api/v1/media-assets/${assetId}/content`, {
        headers: { ...authorization, "Content-Type": "text/plain" },
        data: content,
      }),
    ]);
    expect(uploads.map((response) => response.status()).sort()).toEqual([
      204,
      409,
    ]);

    expect(await scanUntilTerminal(request, assetId)).toBe("ready");

    const replay = await request.put(`/api/v1/media-assets/${assetId}/content`, {
      headers: { ...authorization, "Content-Type": "text/plain" },
      data: content,
    });
    expect(replay.status()).toBe(409);

    const direct = await request.get(
      `/api/v1/media-assets/${assetId}/content?disposition=inline`,
      { headers: authorization },
    );
    expect(direct.status()).toBe(200);
    expect(direct.headers()["content-disposition"]).toContain("attachment");
    expect(direct.headers()["cache-control"]).toContain("private");
    expect(direct.headers()["cache-control"]).toContain("no-store");
    expect(direct.headers()["x-content-type-options"]).toBe("nosniff");
    expect(await direct.body()).toEqual(content);

    const partial = await request.get(
      `/api/v1/media-assets/${assetId}/content?disposition=inline`,
      {
        headers: { ...authorization, Range: "bytes=2-10" },
      },
    );
    expect(partial.status()).toBe(206);
    expect(partial.headers()["accept-ranges"]).toBe("bytes");
    expect(partial.headers()["content-range"]).toBe(
      `bytes 2-10/${content.length}`,
    );
    expect(partial.headers()["content-length"]).toBe("9");
    expect(await partial.body()).toEqual(content.subarray(2, 11));

    const unsatisfiable = await request.get(
      `/api/v1/media-assets/${assetId}/content`,
      {
        headers: { ...authorization, Range: `bytes=${content.length}-` },
      },
    );
    expect(unsatisfiable.status()).toBe(416);
    expect(unsatisfiable.headers()["content-range"]).toBe(
      `bytes */${content.length}`,
    );

    const download = await fetchMediaDownload(
      request,
      `/api/v1/media-assets/${assetId}/download?disposition=inline`,
      { headers: authorization },
    );
    if (download.redirectLocation) {
      expect(download.redirectLocation).toContain("disposition=attachment");
    } else {
      expect(download.response.headers()["content-disposition"]).toContain(
        "attachment",
      );
    }
  } finally {
    if (assetId) {
      await request.delete(`/api/v1/media-assets/${assetId}`, {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-delete`,
        },
      });
      await sql`update media_assets set upload_expires_at = now() - interval '2 hours', deleted_at = now() - interval '2 hours' where id = ${assetId}`;
      await maintain(request);
      await sql`delete from media_assets where id = ${assetId}`;
    }
    await sql`
      delete from api_idempotency_keys
      where key like ${`${idempotencyPrefix}%`}
    `;
    await sql.end();
  }
});

test("spoofed media is quarantined and tenant isolation is opaque", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const spoofed = Buffer.from("not a png", "utf8");
  const foreignOrganizationId = randomUUID();
  const foreignUserId = randomUUID();
  const foreignSecret = `qak_media_foreign_${randomUUID().replace(/-/g, "")}`;
  let assetId: string | null = null;
  try {
    const created = await request.post("/api/v1/media-assets", {
      headers: authorization,
      data: {
        purpose: "course_content",
        originalFileName: "spoof.png",
        declaredMimeType: "image/png",
        sizeBytes: spoofed.length,
      },
    });
    expect(created.status()).toBe(201);
    assetId = ((await created.json()) as { data: { id: string } }).data.id;
    expect(
      (
        await request.put(`/api/v1/media-assets/${assetId}/content`, {
          headers: { ...authorization, "Content-Type": "image/png" },
          data: spoofed,
        })
      ).status(),
    ).toBe(204);
    expect(await scanUntilTerminal(request, assetId)).toBe("quarantined");
    expect(
      (
        await request.get(`/api/v1/media-assets/${assetId}/download`, {
          headers: authorization,
          maxRedirects: 0,
        })
      ).status(),
    ).toBe(404);

    await sql`
      insert into organizations (id, name, slug)
      values (${foreignOrganizationId}, 'Foreign Media', ${`foreign-media-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (id, organization_id, email, password_hash, first_name, last_name, role)
      values (${foreignUserId}, ${foreignOrganizationId}, ${`foreign-${foreignUserId}@example.test`}, 'unused', 'Foreign', 'Admin', 'admin')
    `;
    await sql`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes, created_by_id)
      values (
        ${foreignOrganizationId}, 'Foreign media', ${foreignSecret.slice(0, 17)},
        ${createHash("sha256").update(foreignSecret).digest("hex")},
        array['courses:read'], ${foreignUserId}
      )
    `;
    const crossTenant = await request.get(`/api/v1/media-assets/${assetId}`, {
      headers: { Authorization: `Bearer ${foreignSecret}` },
    });
    expect(crossTenant.status()).toBe(404);

    await sql`
      update media_assets set
        upload_expires_at = now() - interval '2 hours',
        scan_completed_at = now() - interval '2 hours'
      where id = ${assetId}
    `;
    await maintain(request);
    const [released] = await sql<
      Array<{
        status: string;
        quota_bytes: string;
        staging_deleted_at: Date | null;
        storage_deleted_at: Date | null;
      }>
    >`
      select status, quota_bytes, staging_deleted_at, storage_deleted_at
      from media_assets where id = ${assetId}
    `;
    expect(released.status).toBe("quarantined");
    expect(Number(released.quota_bytes), JSON.stringify(released)).toBe(0);
    expect(released.staging_deleted_at).not.toBeNull();
    expect(released.storage_deleted_at).not.toBeNull();

    await sql`
      update media_assets set scan_completed_at = now() - interval '31 days'
      where id = ${assetId}
    `;
    await maintain(request);
    const [purged] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from media_assets where id = ${assetId}
    `;
    expect(purged.count).toBe(0);
  } finally {
    if (assetId) {
      await request.delete(`/api/v1/media-assets/${assetId}`, {
        headers: authorization,
      });
      await sql`update media_assets set upload_expires_at = now() - interval '2 hours', deleted_at = now() - interval '2 hours' where id = ${assetId}`;
      await maintain(request);
      await sql`delete from media_assets where id = ${assetId}`;
    }
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql.end();
  }
});

test("intent caps, byte quota, and expiry cleanup release reservations safely", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 1 });
  const [fixture] = await sql<{ organization_id: string; user_id: string }[]>`
    select k.organization_id, k.created_by_id as user_id
    from api_keys k
    where k.key_hash = ${createHash("sha256").update(demoKey).digest("hex")}
    limit 1
  `;
  const ids: string[] = [];
  let expiryAssetId: string | null = null;
  try {
    for (let index = 0; index < 25; index += 1) {
      const id = randomUUID();
      ids.push(id);
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, purpose, kind, status,
          storage_driver, storage_key, staging_storage_key, original_file_name,
          safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
          upload_expires_at
        ) values (
          ${id}, ${fixture.organization_id}, ${fixture.user_id}, 'course_content',
          'document', 'pending', 'filesystem',
          ${`tenants/${fixture.organization_id}/assets/${id}/ready.txt`},
          ${`incoming/tenants/${fixture.organization_id}/assets/${id}/incoming.txt`},
          'cap.txt', 'cap.txt', 'text/plain', 1, 1, now() + interval '1 hour'
        )
      `;
    }
    const capped = await request.post("/api/v1/media-assets", {
      headers: authorization,
      data: {
        purpose: "course_content",
        originalFileName: "blocked.txt",
        declaredMimeType: "text/plain",
        sizeBytes: 1,
      },
    });
    expect(capped.status()).toBe(409);

    await sql`
      update media_assets set
        status = 'ready', actual_size_bytes = declared_size_bytes,
        uploaded_at = now(), scan_completed_at = now()
      where id in ${sql(ids)}
    `;
    const afterReady = await request.post("/api/v1/media-assets", {
      headers: authorization,
      data: {
        purpose: "course_content",
        originalFileName: "allowed.txt",
        declaredMimeType: "text/plain",
        sizeBytes: 1,
      },
    });
    expect(afterReady.status()).toBe(201);
    const allowedId = ((await afterReady.json()) as { data: { id: string } }).data.id;
    ids.push(allowedId);

    const quotaId = randomUUID();
    ids.push(quotaId);
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at
      ) values (
        ${quotaId}, ${fixture.organization_id}, ${fixture.user_id}, 'course_content',
        'video', 'pending', 'filesystem',
        ${`tenants/${fixture.organization_id}/assets/${quotaId}/ready.mp4`},
        ${`incoming/tenants/${fixture.organization_id}/assets/${quotaId}/incoming.mp4`},
        'quota.mp4', 'quota.mp4', 'video/mp4', 536870911999, 536870911999,
        now() + interval '1 hour'
      )
    `;
    const quota = await request.post("/api/v1/media-assets", {
      headers: authorization,
      data: {
        purpose: "course_content",
        originalFileName: "over.txt",
        declaredMimeType: "text/plain",
        sizeBytes: 2,
      },
    });
    expect(quota.status()).toBe(409);
    await sql`delete from media_assets where id = ${quotaId}`;

    const expiry = await request.post("/api/v1/media-assets", {
      headers: authorization,
      data: {
        purpose: "course_content",
        originalFileName: "expiry.txt",
        declaredMimeType: "text/plain",
        sizeBytes: 3,
      },
    });
    expect(expiry.status()).toBe(201);
    expiryAssetId = ((await expiry.json()) as { data: { id: string } }).data.id;
    await sql`update media_assets set upload_expires_at = now() - interval '30 minutes' where id = ${expiryAssetId}`;
    await maintain(request);
    let [expired] = await sql<{ status: string; quota_bytes: string }[]>`
      select status, quota_bytes from media_assets where id = ${expiryAssetId}
    `;
    expect(expired.status).toBe("deleted");
    expect(Number(expired.quota_bytes)).toBe(3);
    await sql`update media_assets set upload_expires_at = now() - interval '2 hours', deleted_at = now() - interval '2 hours' where id = ${expiryAssetId}`;
    await maintain(request);
    [expired] = await sql<{ status: string; quota_bytes: string }[]>`
      select status, quota_bytes from media_assets where id = ${expiryAssetId}
    `;
    expect(Number(expired.quota_bytes)).toBe(0);
  } finally {
    await sql`delete from media_assets where id in ${sql(ids)} or id = ${expiryAssetId}`;
    await sql.end();
  }
});
