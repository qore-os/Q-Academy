import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { db, postgresClient } from "@/db";
import { enqueueReadyVideoThumbnailInTransaction } from "@/lib/media/processing-worker";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false });

after(async () => {
  await Promise.all([sql.end(), postgresClient.end()]);
});

test("an Orbit target video and its automatic poster job commit atomically and idempotently", async () => {
  const organizationId = randomUUID();
  const assetId = randomUUID();
  const digest = createHash("sha256").update(assetId).digest("hex");
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, 'Orbit thumbnail integration', ${`orbit-thumbnail-${organizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into media_assets (
        id, organization_id, purpose, kind, status, storage_driver,
        storage_key, staging_storage_key, original_file_name, safe_file_name,
        declared_mime_type, detected_mime_type, declared_size_bytes,
        actual_size_bytes, duration_milliseconds, quota_bytes,
        content_sha256, upload_expires_at, uploaded_at, scan_completed_at
      ) values (
        ${assetId}, ${organizationId}, 'course_content', 'video', 'ready',
        'filesystem', ${`tenants/${organizationId}/assets/${assetId}/video.mp4`},
        ${`incoming/tenants/${organizationId}/assets/${assetId}/video.mp4`},
        'video.mp4', 'video.mp4', 'video/mp4', 'video/mp4', 8, 8, 1000, 8,
        ${digest}, now(), now(), now()
      )
    `;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await db.transaction((tx) =>
        enqueueReadyVideoThumbnailInTransaction(tx, {
          organizationId,
          sourceAssetId: assetId,
          sourceContentSha256: digest,
          atMilliseconds: 0,
        }),
      );
    }

    const jobs = await sql<Array<{ options: { atMilliseconds?: number } }>>`
      select options
      from media_processing_jobs
      where organization_id = ${organizationId}
        and source_asset_id = ${assetId}
        and type = 'thumbnail'
    `;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.options.atMilliseconds, 0);

    await assert.rejects(
      db.transaction(async (tx) => {
        const rollbackAssetId = randomUUID();
        await tx.insert((await import("@/db/schema")).mediaAssets).values({
          id: rollbackAssetId,
          organizationId,
          purpose: "course_content",
          kind: "video",
          status: "ready",
          storageDriver: "filesystem",
          storageKey: `tenants/${organizationId}/assets/${rollbackAssetId}/video.mp4`,
          stagingStorageKey: `incoming/tenants/${organizationId}/assets/${rollbackAssetId}/video.mp4`,
          originalFileName: "video.mp4",
          safeFileName: "video.mp4",
          declaredMimeType: "video/mp4",
          detectedMimeType: "video/mp4",
          declaredSizeBytes: 8,
          actualSizeBytes: 8,
          durationMilliseconds: 1000,
          quotaBytes: 8,
          contentSha256: digest,
          uploadExpiresAt: new Date(),
          uploadedAt: new Date(),
          scanCompletedAt: new Date(),
        });
        await enqueueReadyVideoThumbnailInTransaction(tx, {
          organizationId,
          sourceAssetId: rollbackAssetId,
          sourceContentSha256: digest,
          atMilliseconds: 0,
        });
        throw new Error("rollback probe");
      }),
      /rollback probe/,
    );
    const [count] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from media_processing_jobs
      where organization_id = ${organizationId}
    `;
    assert.equal(count?.count, 1);
  } finally {
    await sql`delete from organizations where id = ${organizationId}`;
  }
});
