import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Database invariants run once.");
});

test("media and submission database invariants reject cross-tenant and mutable evidence", async () => {
  const sql = postgres(databaseUrl, { max: 1 });
  const [fixture] = await sql<{
    organization_id: string;
    admin_id: string;
    member_id: string;
    course_id: string;
  }[]>`
    select o.id as organization_id,
      (select id from users where organization_id = o.id and role in ('owner', 'admin') limit 1) as admin_id,
      (select id from users where organization_id = o.id and role = 'member' limit 1) as member_id,
      (select id from courses where organization_id = o.id limit 1) as course_id
    from organizations o
    where exists (select 1 from courses where organization_id = o.id)
    limit 1
  `;
  const foreignOrganizationId = randomUUID();
  const foreignUserId = randomUUID();
  const reviewerId = randomUUID();
  const submissionId = randomUUID();
  const assetId = randomUUID();
  const wrongOwnerAssetId = randomUUID();
  const invalidAssetId = randomUUID();
  const s3AssetId = randomUUID();
  const raceSql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${foreignOrganizationId}, 'Invariant Foreign', ${`invariant-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into users (id, organization_id, email, password_hash, first_name, last_name, role)
      values (${foreignUserId}, ${foreignOrganizationId}, ${`foreign-${foreignUserId}@example.test`}, 'unused', 'Foreign', 'User', 'admin')
    `;
    await sql`
      insert into users (id, organization_id, email, password_hash, first_name, last_name, role)
      values (${reviewerId}, ${fixture.organization_id}, ${`reviewer-${reviewerId}@example.test`}, 'unused', 'Review', 'Temp', 'trainer')
    `;

    await assert.rejects(sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at
      ) values (
        ${invalidAssetId}, ${fixture.organization_id}, ${fixture.admin_id},
        'course_content', 'document', 'pending', 'filesystem',
        ${`tenants/${fixture.organization_id}/assets/${invalidAssetId}/ready.txt`},
        ${`incoming/tenants/${fixture.organization_id}/assets/${invalidAssetId}/incoming.txt`},
        'invalid.txt', 'invalidXtxt', 'text/plain', 1, 1, now() + interval '1 hour'
      )
    `);
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at
      ) values (
        ${s3AssetId}, ${fixture.organization_id}, ${fixture.admin_id},
        'course_content', 'document', 'pending', 's3',
        ${`tenants/${fixture.organization_id}/assets/${s3AssetId}/ready.txt`},
        ${`incoming/tenants/${fixture.organization_id}/assets/${s3AssetId}/incoming.txt`},
        'versioned.txt', 'versioned.txt', 'text/plain', 8, 8,
        now() + interval '1 hour'
      )
    `;
    await assert.rejects(sql`
      update media_assets set
        status = 'uploaded', actual_size_bytes = 8, uploaded_at = now()
      where id = ${s3AssetId}
    `);
    await sql`
      update media_assets set
        status = 'uploaded', actual_size_bytes = 8, uploaded_at = now(),
        etag = 'staging-etag', staging_storage_version_id = 'staging-v1'
      where id = ${s3AssetId}
    `;
    await assert.rejects(sql`
      update media_assets set staging_storage_version_id = 'staging-v2'
      where id = ${s3AssetId}
    `);
    await sql`
      update media_assets set
        status = 'ready', etag = 'final-etag', detected_mime_type = 'text/plain',
        storage_version_id = 'final-v1', content_sha256 = ${"a".repeat(64)},
        scan_completed_at = now()
      where id = ${s3AssetId}
    `;
    await assert.rejects(sql`
      update media_assets set storage_version_id = 'final-v2'
      where id = ${s3AssetId}
    `);
    await sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values (
        ${fixture.organization_id}, ${fixture.course_id}, ${s3AssetId},
        ${fixture.admin_id}
      )
    `;
    await assert.rejects(sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values (
        ${foreignOrganizationId}, ${fixture.course_id}, ${s3AssetId},
        ${foreignUserId}
      )
    `);
    await assert.rejects(sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values (
        ${fixture.organization_id}, ${fixture.course_id}, ${s3AssetId},
        ${foreignUserId}
      )
    `);
    await assert.rejects(sql`delete from media_assets where id = ${s3AssetId}`);
    await assert.rejects(sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, declared_size_bytes, quota_bytes,
        upload_expires_at
      ) values (
        ${invalidAssetId}, ${fixture.organization_id}, ${foreignUserId},
        'course_content', 'document', 'pending', 'filesystem',
        ${`tenants/${fixture.organization_id}/assets/${invalidAssetId}/ready.txt`},
        ${`incoming/tenants/${fixture.organization_id}/assets/${invalidAssetId}/incoming.txt`},
        'cross.txt', 'cross.txt', 'text/plain', 1, 1, now() + interval '1 hour'
      )
    `);

    await sql`
      insert into submissions (
        id, organization_id, user_id, course_id, title, type, content
      ) values (
        ${submissionId}, ${fixture.organization_id}, ${fixture.member_id},
        ${fixture.course_id}, 'Invariant submission', 'text', 'Evidence'
      )
    `;
    for (const [id, ownerId] of [
      [assetId, fixture.member_id],
      [wrongOwnerAssetId, fixture.admin_id],
    ] as const) {
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
          status, storage_driver, storage_key, staging_storage_key,
          original_file_name, safe_file_name, declared_mime_type,
          declared_size_bytes, actual_size_bytes, quota_bytes, upload_expires_at,
          uploaded_at, scan_completed_at
        ) values (
          ${id}, ${fixture.organization_id}, ${fixture.admin_id}, ${ownerId},
          'submission', 'document', 'ready', 'filesystem',
          ${`tenants/${fixture.organization_id}/assets/${id}/ready.txt`},
          ${`incoming/tenants/${fixture.organization_id}/assets/${id}/incoming.txt`},
          'evidence.txt', 'evidence.txt', 'text/plain', 8, 8, 8,
          now() - interval '1 hour', now() - interval '1 hour', now()
        )
      `;
    }
    await assert.rejects(sql`
      insert into submission_attachments (organization_id, submission_id, media_asset_id)
      values (${fixture.organization_id}, ${submissionId}, ${wrongOwnerAssetId})
    `);
    let releaseAttachmentLock!: () => void;
    let attachmentLocked!: () => void;
    const holdAttachmentLock = new Promise<void>((resolve) => {
      releaseAttachmentLock = resolve;
    });
    const attachmentHasLock = new Promise<void>((resolve) => {
      attachmentLocked = resolve;
    });
    const attachTransaction = sql.begin(async (tx) => {
      await tx`
        insert into submission_attachments (organization_id, submission_id, media_asset_id)
        values (${fixture.organization_id}, ${submissionId}, ${assetId})
      `;
      attachmentLocked();
      await holdAttachmentLock;
    });
    await attachmentHasLock;
    const concurrentDelete = raceSql`
      update media_assets set status = 'deleted', deleted_at = now()
      where id = ${assetId}
    `.then(
      () => ({ state: "resolved" as const, error: null }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    );
    const beforeCommit = await Promise.race([
      concurrentDelete,
      new Promise<{ state: "blocked"; error: null }>((resolve) =>
        setTimeout(() => resolve({ state: "blocked", error: null }), 200),
      ),
    ]);
    releaseAttachmentLock();
    await attachTransaction;
    assert.equal(beforeCommit.state, "blocked");
    assert.equal((await concurrentDelete).state, "rejected");
    await assert.rejects(sql`
      update media_assets set status = 'deleted', deleted_at = now()
      where id = ${assetId}
    `);

    await sql`
      insert into submission_reviews (
        organization_id, submission_id, reviewer_id, decision, feedback, score
      ) values (
        ${fixture.organization_id}, ${submissionId}, ${reviewerId},
        'approved', 'Immutable review', 90
      )
    `;
    await sql`delete from users where id = ${reviewerId}`;
    const [review] = await sql<{ reviewer_id: string | null }[]>`
      select reviewer_id from submission_reviews where submission_id = ${submissionId}
    `;
    assert.equal(review.reviewer_id, null);
    await assert.rejects(sql`
      update submission_reviews set feedback = 'tampered'
      where submission_id = ${submissionId}
    `);
  } finally {
    await sql`delete from submission_attachments where submission_id = ${submissionId}`;
    await sql`delete from submission_reviews where submission_id = ${submissionId}`;
    await sql`delete from course_media_assets where media_asset_id = ${s3AssetId}`;
    await sql`delete from media_assets where id in (${assetId}, ${wrongOwnerAssetId}, ${invalidAssetId}, ${s3AssetId})`;
    await sql`delete from submissions where id = ${submissionId}`;
    await sql`delete from users where id = ${reviewerId}`;
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await raceSql.end();
    await sql.end();
  }
});
