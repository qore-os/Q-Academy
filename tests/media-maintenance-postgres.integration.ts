import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "@/db";
import { processMediaMaintenanceQueues } from "@/lib/media/scan-worker";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function insertReleasableTenant(sequence: number) {
  const organizationId = randomUUID();
  const assetId = randomUUID();
  const slug = `maintenance-fairness-${sequence}-${organizationId.slice(0, 8)}`;
  await sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${`Maintenance fairness ${sequence}`}, ${slug})
  `;
  await sql`
    insert into media_assets (
      id, organization_id, purpose, kind, status, storage_driver,
      storage_key, staging_storage_key, original_file_name, safe_file_name,
      declared_mime_type, declared_size_bytes, quota_bytes,
      upload_expires_at, deleted_at, staging_deleted_at, storage_deleted_at
    ) values (
      ${assetId}, ${organizationId}, 'submission', 'document', 'deleted',
      'filesystem',
      ${`tenants/${organizationId}/assets/${assetId}/maintenance.txt`},
      ${`incoming/tenants/${organizationId}/assets/${assetId}/maintenance.txt`},
      'maintenance.txt', 'maintenance.txt', 'text/plain', 1, 1,
      now() - interval '2 hours', now(), now(), now()
    )
  `;
  await sql`
    insert into media_processing_jobs (
      organization_id, source_asset_id, type, status, request_key,
      source_content_sha256, provider
    ) values (
      ${organizationId}, ${assetId}, 'transcript', 'queued',
      ${digest(`request-${assetId}`)}, ${digest(`source-${assetId}`)},
      'maintenance-postgres-test'
    )
  `;
  return { organizationId, assetId };
}

test("maintenance tenant rotation is valid PostgreSQL with and without cursors", async () => {
  const records = [];
  try {
    records.push(
      await insertReleasableTenant(1),
      await insertReleasableTenant(2),
    );
    const first = await processMediaMaintenanceQueues(5);
    assert.equal(first.skipped, false);
    assert.equal(first.timedOut, false);
    assert.ok(first.releasedQuotaAssets >= 2);
    assert.ok(first.cancelledProcessingJobs >= 2);

    records.push(await insertReleasableTenant(3));
    const second = await processMediaMaintenanceQueues(5);
    assert.equal(second.skipped, false);
    assert.equal(second.timedOut, false);
    assert.ok(second.releasedQuotaAssets >= 1);
    assert.ok(second.cancelledProcessingJobs >= 1);

    const persisted = await sql<Array<{ quota_bytes: number; status: string }>>`
      select a.quota_bytes, j.status
      from media_assets a
      inner join media_processing_jobs j
        on j.source_asset_id = a.id
       and j.organization_id = a.organization_id
      where a.id = any(${records.map(({ assetId }) => assetId)}::uuid[])
      order by a.id
    `;
    assert.equal(persisted.length, 3);
    assert.deepEqual(
      persisted.map((row) => ({
        quotaBytes: Number(row.quota_bytes),
        status: row.status,
      })),
      [
        { quotaBytes: 0, status: "cancelled" },
        { quotaBytes: 0, status: "cancelled" },
        { quotaBytes: 0, status: "cancelled" },
      ],
    );
  } finally {
    if (records.length) {
      await sql`
        delete from organizations
        where id = any(${records.map(({ organizationId }) => organizationId)}::uuid[])
      `;
    }
  }
});

test("maintenance expires a full database-only upload batch with PostgreSQL timestamp precision", async () => {
  const organizationId = randomUUID();
  const assetIds = Array.from({ length: 3 }, () => randomUUID());
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (
        ${organizationId},
        'Expired upload maintenance',
        ${`expired-upload-${organizationId.slice(0, 8)}`}
      )
    `;
    for (const assetId of assetIds) {
      await sql`
        insert into media_assets (
          id, organization_id, purpose, kind, status, storage_driver,
          storage_key, staging_storage_key, original_file_name, safe_file_name,
          declared_mime_type, declared_size_bytes, quota_bytes,
          upload_expires_at
        ) values (
          ${assetId}, ${organizationId}, 'course_content', 'document',
          'pending', 'filesystem',
          ${`tenants/${organizationId}/assets/${assetId}/ready.txt`},
          ${`incoming/tenants/${organizationId}/assets/${assetId}/incoming.txt`},
          'expiry.txt', 'expiry.txt', 'text/plain', 3, 3,
          date_trunc('second', now()) - interval '30 minutes'
            + interval '0.000456 seconds'
        )
      `;
    }

    const result = await processMediaMaintenanceQueues(5);
    assert.equal(result.skipped, false);
    assert.equal(result.timedOut, false);
    assert.ok(result.expired >= assetIds.length);

    const assets = await sql<Array<{ id: string; status: string }>>`
      select id, status
      from media_assets
      where id = any(${assetIds}::uuid[])
      order by id
    `;
    assert.equal(assets.length, assetIds.length);
    assert.deepEqual(
      assets.map(({ status }) => status),
      assetIds.map(() => "deleted"),
    );
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
