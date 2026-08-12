import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import { postgresClient } from "../src/db/index";
import {
  orbitTransferLeaseDeadline,
  renewOrbitTransferLease,
} from "../src/lib/orbit/transfer-lease";
import { reconcileStaleOrbitTransfers } from "../src/lib/orbit/transfer-reconciliation";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const cleanupDatabaseUrl = new URL(
  process.env.POSTGRES_ADMIN_URL ?? databaseUrl,
);
cleanupDatabaseUrl.pathname = new URL(databaseUrl).pathname;
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const cleanupSql = postgres(cleanupDatabaseUrl.toString(), {
  max: 1,
  prepare: false,
});

type Fixture = {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  workspaceId: string;
  jobId: string;
  claimToken: string;
  mediaAssetId: string;
  sourceCourseId: string;
  targetCourseId: string;
};

async function createFixture(input: {
  now: Date;
  leaseExpiresAt: Date;
  uploadExpiresAt: Date;
}) {
  const fixture: Fixture = {
    sourceOrganizationId: randomUUID(),
    targetOrganizationId: randomUUID(),
    workspaceId: randomUUID(),
    jobId: randomUUID(),
    claimToken: randomUUID(),
    mediaAssetId: randomUUID(),
    sourceCourseId: randomUUID(),
    targetCourseId: randomUUID(),
  };
  await sql`
    insert into organizations (id, name, slug) values
      (${fixture.sourceOrganizationId}, 'Orbit lease source', ${`orbit-lease-source-${fixture.sourceOrganizationId.slice(0, 8)}`}),
      (${fixture.targetOrganizationId}, 'Orbit lease target', ${`orbit-lease-target-${fixture.targetOrganizationId.slice(0, 8)}`})
  `;
  await sql`
    insert into orbit_workspaces (id, name, slug, instance_slot_limit)
    values (
      ${fixture.workspaceId}, 'Orbit lease workspace',
      ${`orbit-lease-${fixture.workspaceId.slice(0, 8)}`}, 2
    )
  `;
  await sql`
    insert into orbit_instances (
      workspace_id, organization_id, status, seat_limit, course_limit,
      entitlements
    ) values
      (${fixture.workspaceId}, ${fixture.sourceOrganizationId}, 'active', 100, 100, array['content_transfer']::text[]),
      (${fixture.workspaceId}, ${fixture.targetOrganizationId}, 'active', 100, 100, array['content_transfer']::text[])
  `;
  await sql`
    insert into orbit_transfer_jobs (
      id, workspace_id, source_organization_id, target_organization_id,
      source_course_ids, target_course_ids, idempotency_key, request_hash,
      status, preflight, started_at, claim_token, lease_expires_at,
      created_at, updated_at
    ) values (
      ${fixture.jobId}, ${fixture.workspaceId},
      ${fixture.sourceOrganizationId}, ${fixture.targetOrganizationId},
      array[${fixture.sourceCourseId}]::uuid[], array[]::uuid[],
      ${`lease-${fixture.jobId}`}, ${"a".repeat(64)}, 'processing',
      ${sql.json({
        sourceCourseCount: 1,
        targetCourseCount: 0,
        targetCourseLimit: 100,
        mediaAssetCount: 1,
        mediaBytes: 8,
        warnings: [],
      })},
      ${new Date(input.now.getTime() - 24 * 60 * 60_000)},
      ${fixture.claimToken}, ${input.leaseExpiresAt},
      ${new Date(input.now.getTime() - 24 * 60 * 60_000)}, ${input.now}
    )
  `;
  await sql`
    insert into orbit_transfer_items (
      job_id, kind, source_id, target_id, checksum
    ) values (
      ${fixture.jobId}, 'media_asset', ${randomUUID()},
      ${fixture.mediaAssetId}, ${"b".repeat(64)}
    )
  `;
  await sql`
    insert into media_assets (
      id, organization_id, purpose, kind, status, storage_driver,
      storage_key, staging_storage_key, original_file_name, safe_file_name,
      declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
    ) values (
      ${fixture.mediaAssetId}, ${fixture.targetOrganizationId},
      'course_content', 'video', 'pending', 'filesystem',
      ${`tenants/${fixture.targetOrganizationId}/assets/${fixture.mediaAssetId}/video.mp4`},
      ${`incoming/tenants/${fixture.targetOrganizationId}/assets/${fixture.mediaAssetId}/video.mp4`},
      'video.mp4', 'video.mp4', 'video/mp4', 8, 8, ${input.uploadExpiresAt}
    )
  `;
  return fixture;
}

async function removeFixture(fixture: Fixture) {
  await cleanupSql.begin(async (transaction) => {
    await transaction.unsafe("set local session_replication_role = replica");
    await transaction`
      delete from orbit_audit_events where workspace_id = ${fixture.workspaceId}
    `;
    await transaction.unsafe("set local session_replication_role = origin");
    await transaction`
      delete from orbit_transfer_jobs where id = ${fixture.jobId}
    `;
    await transaction`
      delete from media_assets where id = ${fixture.mediaAssetId}
    `;
    await transaction`
      delete from orbit_workspaces where id = ${fixture.workspaceId}
    `;
    await transaction`
      delete from organizations
      where id in (
        ${fixture.sourceOrganizationId}, ${fixture.targetOrganizationId}
      )
    `;
  });
}

after(async () => {
  await Promise.all([
    sql.end({ timeout: 5 }),
    cleanupSql.end({ timeout: 5 }),
    postgresClient.end({ timeout: 5 }),
  ]);
});

test("Orbit heartbeat renews the job and every reservation atomically", async () => {
  const now = new Date("2026-08-12T12:00:00.000Z");
  const fixture = await createFixture({
    now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
    uploadExpiresAt: new Date(now.getTime() + 60_000),
  });
  try {
    assert.equal(await reconcileStaleOrbitTransfers(10, now), 0);
    const renewedAt = new Date(now.getTime() + 30_000);
    const deadline = await renewOrbitTransferLease({
      jobId: fixture.jobId,
      claimToken: fixture.claimToken,
      targetOrganizationId: fixture.targetOrganizationId,
      targetMediaIds: [fixture.mediaAssetId],
      now: renewedAt,
    });
    assert.equal(deadline?.toISOString(), orbitTransferLeaseDeadline(renewedAt).toISOString());
    const [state] = await sql<
      Array<{ leaseExpiresAt: Date; uploadExpiresAt: Date }>
    >`
      select j.lease_expires_at as "leaseExpiresAt",
             a.upload_expires_at as "uploadExpiresAt"
      from orbit_transfer_jobs j
      join media_assets a on a.id = ${fixture.mediaAssetId}
      where j.id = ${fixture.jobId}
    `;
    assert.equal(state.leaseExpiresAt.toISOString(), deadline?.toISOString());
    assert.equal(state.uploadExpiresAt.toISOString(), deadline?.toISOString());

    const wrongToken = await renewOrbitTransferLease({
      jobId: fixture.jobId,
      claimToken: randomUUID(),
      targetOrganizationId: fixture.targetOrganizationId,
      targetMediaIds: [fixture.mediaAssetId],
      now: new Date(renewedAt.getTime() + 1_000),
    });
    assert.equal(wrongToken, null);
  } finally {
    await removeFixture(fixture);
  }
});

test("expired Orbit claims reconcile, while a concurrent completed commit wins", async () => {
  const now = new Date("2026-08-12T13:00:00.000Z");
  const expired = new Date(now.getTime() - 1_000);
  const dead = await createFixture({
    now,
    leaseExpiresAt: expired,
    uploadExpiresAt: expired,
  });
  try {
    assert.equal(await reconcileStaleOrbitTransfers(10, now), 1);
    const [failed] = await sql<
      Array<{
        status: string;
        claimToken: string | null;
        leaseExpiresAt: Date | null;
        failureCode: string | null;
      }>
    >`
      select status, claim_token as "claimToken",
             lease_expires_at as "leaseExpiresAt",
             failure_code as "failureCode"
      from orbit_transfer_jobs where id = ${dead.jobId}
    `;
    assert.deepEqual(failed, {
      status: "failed",
      claimToken: null,
      leaseExpiresAt: null,
      failureCode: "transfer_reservation_expired",
    });
  } finally {
    await removeFixture(dead);
  }

  const completing = await createFixture({
    now,
    leaseExpiresAt: expired,
    uploadExpiresAt: expired,
  });
  let releaseCommit!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  let blockerReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => {
    blockerReady = resolve;
  });
  try {
    const completion = sql.begin(async (transaction) => {
      const [connection] = await transaction<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      await transaction`
        select id from orbit_transfer_jobs
        where id = ${completing.jobId}
        for update
      `;
      blockerReady(connection.pid);
      await release;
      await transaction`
        update orbit_transfer_jobs
        set status = 'completed',
            target_course_ids = array[${completing.targetCourseId}]::uuid[],
            claim_token = null, lease_expires_at = null,
            completed_at = ${now}, updated_at = ${now}
        where id = ${completing.jobId}
      `;
    });
    await ready;
    const reconciliation = reconcileStaleOrbitTransfers(10, now);
    const reconciled = await Promise.race([
      reconciliation,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("SKIP LOCKED reconciliation blocked.")),
          2_000,
        ),
      ),
    ]);
    assert.equal(reconciled, 0);
    releaseCommit();
    await completion;
    const [completed] = await sql<Array<{ status: string }>>`
      select status from orbit_transfer_jobs where id = ${completing.jobId}
    `;
    assert.equal(completed.status, "completed");
  } finally {
    releaseCommit?.();
    await removeFixture(completing);
  }
});
