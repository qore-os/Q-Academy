import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import postgres from "postgres";
import { postgresClient } from "../src/db/index";
import { createMediaObjectKey, createMediaStagingObjectKey } from "../src/lib/media/storage-key";
import { writeDevelopmentMediaObject } from "../src/lib/media/storage";
import {
  persistPrivacyExportStorageIdentity,
  processPrivacyRequest,
  recordStoredPrivacyExportCleanup,
  renewPrivacyProcessingLease,
} from "../src/lib/privacy/request-service";
import {
  cleanupExpiredPrivacyExports,
  PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS,
  PRIVACY_RETENTION_ADVISORY_LOCK_KEY,
  recoverExpiredPrivacyProcessing,
} from "../src/lib/privacy/retention";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const cleanupDatabaseUrl = new URL(
  process.env.POSTGRES_ADMIN_URL ?? databaseUrl,
);
cleanupDatabaseUrl.pathname = new URL(databaseUrl).pathname;
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const blocker = postgres(databaseUrl, { max: 1, prepare: false });
const cleanupSql = postgres(cleanupDatabaseUrl.toString(), {
  max: 1,
  prepare: false,
});

after(async () => {
  const results = await Promise.allSettled([
    sql.end({ timeout: 5 }),
    blocker.end({ timeout: 5 }),
    cleanupSql.end({ timeout: 5 }),
    postgresClient.end({ timeout: 5 }),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Failed to close privacy test clients.");
  }
});

before(async () => {
  const leaked = await sql<Array<{ id: string }>>`
    select id from organizations
    where name like 'Privacy recovery %'
       or name in ('Privacy snapshot race', 'Privacy lease loss race')
  `;
  if (leaked.length) {
    await removeFixtureOrganizations(leaked.map(({ id }) => id));
  }
});

async function createTenant(label: string) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const slug = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${organizationId.slice(0, 8)}`;
  const email = `${label}-${userId}@example.test`;
  await sql`
    insert into organizations (id, name, slug)
    values (${organizationId}, ${label}, ${slug})
  `;
  await sql`
    insert into users (
      id, organization_id, email, password_hash, first_name, last_name,
      role, status
    ) values (
      ${userId}, ${organizationId}, ${email}, 'credential', 'Privacy',
      'Subject', 'member', 'active'
    )
  `;
  return { organizationId, userId, slug, email };
}

async function removeFixtureOrganizations(organizationIds: string[]) {
  await cleanupSql.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`
      delete from privacy_request_events
      where organization_id = any(${organizationIds}::uuid[])
    `;
    await tx.unsafe("set local session_replication_role = origin");
    await tx`
      delete from organizations
      where id = any(${organizationIds}::uuid[])
    `;
  });
}

async function insertProcessingRequest(input: {
  organizationId: string;
  userId: string;
  requestId: string;
  claimToken: string;
  leaseExpiresAt: Date;
  artifactId?: string;
  artifactStorage?: {
    driver: "filesystem" | "s3";
    versionId: string | null;
    etag: string | null;
  };
}) {
  const createdAt = new Date(input.leaseExpiresAt.getTime() - 30 * 60_000);
  const verifiedAt = new Date(createdAt.getTime() + 60_000);
  const approvedAt = new Date(verifiedAt.getTime() + 60_000);
  const processingAt = new Date(approvedAt.getTime() + 60_000);
  await sql`
    insert into privacy_requests (
      id, organization_id, subject_user_id, subject_reference,
      client_request_id, type, status, due_at, identity_verified_at,
      approved_at, processing_started_at, processing_attempt,
      processing_claim_token, processing_claimed_at,
      processing_lease_expires_at, created_at, updated_at
    ) values (
      ${input.requestId}, ${input.organizationId}, ${input.userId},
      ${"a".repeat(64)}, ${`processing-${input.requestId}`},
      'access_export', 'processing', ${new Date(createdAt.getTime() + 86_400_000)},
      ${verifiedAt}, ${approvedAt}, ${processingAt}, 1, ${input.claimToken},
      ${processingAt}, ${input.leaseExpiresAt}, ${createdAt}, ${processingAt}
    )
  `;
  if (!input.artifactId) return;
  const artifactStorage = input.artifactStorage ?? {
    driver: "filesystem" as const,
    versionId: null,
    etag: null,
  };
  await sql`
    insert into privacy_export_artifacts (
      id, organization_id, request_id, status, format, storage_driver,
      storage_key, storage_version_id, storage_etag, safe_file_name,
      content_type, expires_at, created_at, updated_at
    ) values (
      ${input.artifactId}, ${input.organizationId}, ${input.requestId},
      'building', 'zip', ${artifactStorage.driver},
      ${`tenants/${input.organizationId}/privacy-exports/${input.requestId}/${input.artifactId}.enc`},
      ${artifactStorage.versionId}, ${artifactStorage.etag},
      ${`privacy-export-${input.requestId.slice(0, 8)}.zip`},
      'application/zip', ${new Date(createdAt.getTime() + 7 * 86_400_000)},
      ${createdAt}, ${processingAt}
    )
  `;
}

test("expired privacy processing is recovered atomically and old claims stay fenced", async () => {
  const now = new Date();
  const first = await createTenant("Privacy recovery first");
  const second = await createTenant("Privacy recovery second");
  const active = await createTenant("Privacy recovery active");
  const organizationIds = [
    first.organizationId,
    second.organizationId,
    active.organizationId,
  ];
  const firstRequestId = randomUUID();
  const secondRequestId = randomUUID();
  const activeRequestId = randomUUID();
  const firstArtifactId = randomUUID();
  const secondArtifactId = randomUUID();
  const firstToken = randomUUID();
  const secondToken = randomUUID();
  const activeToken = randomUUID();
  const firstStorageVersionId = `version-${randomUUID()}`;

  try {
    await insertProcessingRequest({
      ...first,
      requestId: firstRequestId,
      claimToken: firstToken,
      leaseExpiresAt: new Date(now.getTime() - 120_000),
      artifactId: firstArtifactId,
      artifactStorage: {
        driver: "s3",
        versionId: firstStorageVersionId,
        etag: "a".repeat(32),
      },
    });
    await insertProcessingRequest({
      ...second,
      requestId: secondRequestId,
      claimToken: secondToken,
      leaseExpiresAt: new Date(now.getTime() - 60_000),
      artifactId: secondArtifactId,
      artifactStorage: { driver: "s3", versionId: null, etag: null },
    });
    await insertProcessingRequest({
      ...active,
      requestId: activeRequestId,
      claimToken: activeToken,
      leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
    });

    const dryRun = await recoverExpiredPrivacyProcessing({
      now,
      batchSize: 1,
      dryRun: true,
    });
    assert.deepEqual(
      {
        mode: dryRun.mode,
        candidates: dryRun.candidates,
        recovered: dryRun.recovered,
        mayHaveMore: dryRun.mayHaveMore,
      },
      { mode: "dry-run", candidates: 1, recovered: 0, mayHaveMore: true },
    );
    const beforeRecovery = await sql<Array<{ status: string }>>`
      select status from privacy_requests
      where id in (${firstRequestId}, ${secondRequestId})
      order by id
    `;
    assert.ok(beforeRecovery.every(({ status }) => status === "processing"));

    const renewed = await renewPrivacyProcessingLease(
      {
        organizationId: active.organizationId,
        requestId: activeRequestId,
        claimToken: activeToken,
      },
      { leaseMs: 20 * 60_000 },
    );
    assert.ok(renewed?.processingLeaseExpiresAt);
    assert.equal(
      await renewPrivacyProcessingLease(
        {
          organizationId: first.organizationId,
          requestId: activeRequestId,
          claimToken: activeToken,
        },
      ),
      null,
    );

    const recoveredFirst = await recoverExpiredPrivacyProcessing({
      now,
      batchSize: 1,
    });
    assert.equal(recoveredFirst.candidates, 1);
    assert.equal(recoveredFirst.recovered, 1);
    assert.equal(recoveredFirst.artifactsFailed, 1);
    assert.equal(recoveredFirst.mayHaveMore, true);

    const [failedRequest] = await sql<
      Array<{
        status: string;
        status_reason: string | null;
        processing_claim_token: string | null;
        processing_lease_expires_at: Date | null;
      }>
    >`
      select status, status_reason, processing_claim_token,
             processing_lease_expires_at
      from privacy_requests where id = ${firstRequestId}
    `;
    assert.deepEqual(failedRequest, {
      status: "failed",
      status_reason: "processing_lease_expired",
      processing_claim_token: null,
      processing_lease_expires_at: null,
    });
    const [failedArtifact] = await sql<
      Array<{
        status: string;
        failure_code: string | null;
        storage_version_id: string | null;
        storage_etag: string | null;
      }>
    >`
      select status, failure_code, storage_version_id, storage_etag
      from privacy_export_artifacts
      where id = ${firstArtifactId}
    `;
    assert.equal(failedArtifact?.status, "failed");
    assert.equal(failedArtifact?.failure_code, "processing_lease_expired");
    assert.equal(failedArtifact?.storage_version_id, firstStorageVersionId);
    assert.equal(failedArtifact?.storage_etag, "a".repeat(32));

    assert.equal(
      await renewPrivacyProcessingLease(
        {
          organizationId: first.organizationId,
          requestId: firstRequestId,
          claimToken: firstToken,
        },
      ),
      null,
    );
    const staleIdentityCommit = await persistPrivacyExportStorageIdentity({
      organizationId: first.organizationId,
      requestId: firstRequestId,
      artifactId: firstArtifactId,
      claimToken: firstToken,
      stored: {
        driver: "s3",
        storageVersionId: firstStorageVersionId,
        storageEtag: "a".repeat(32),
        storageKey: `tenants/${first.organizationId}/privacy-exports/${firstRequestId}/${firstArtifactId}.enc`,
        artifactSha256: "b".repeat(64),
        manifestSha256: "c".repeat(64),
        sizeBytes: 1,
        fileCount: 1,
      },
    });
    assert.deepEqual(staleIdentityCommit, { state: "claim_lost" });

    const [activeAfterForeignRecovery] = await sql<
      Array<{ status: string; processing_claim_token: string | null }>
    >`
      select status, processing_claim_token from privacy_requests
      where id = ${activeRequestId} and organization_id = ${active.organizationId}
    `;
    assert.deepEqual(activeAfterForeignRecovery, {
      status: "processing",
      processing_claim_token: activeToken,
    });

    const recoveredSecond = await recoverExpiredPrivacyProcessing({
      now,
      batchSize: 1,
    });
    assert.equal(recoveredSecond.recovered, 1);
    const [secondFailedArtifact] = await sql<
      Array<{
        status: string;
        storage_version_id: string | null;
        storage_etag: string | null;
      }>
    >`
      select status, storage_version_id, storage_etag
      from privacy_export_artifacts where id = ${secondArtifactId}
    `;
    assert.deepEqual(secondFailedArtifact, {
      status: "failed",
      storage_version_id: null,
      storage_etag: null,
    });
    const [audit] = await sql<Array<{ events: number; activities: number }>>`
      select
        (select count(*)::int from privacy_request_events
         where request_id in (${firstRequestId}, ${secondRequestId})
           and event = 'request.processing_lease_expired') as events,
        (select count(*)::int from activity_events
         where entity_id in (${firstRequestId}, ${secondRequestId})
           and type = 'privacy_request.processing_lease_expired') as activities
    `;
    assert.deepEqual(audit, { events: 2, activities: 2 });
  } finally {
    await removeFixtureOrganizations(organizationIds);
  }
});

test("lease renewal rechecks database time after waiting for a row lock", async () => {
  const tenant = await createTenant("Privacy recovery renewal wait");
  const requestId = randomUUID();
  const claimToken = randomUUID();
  let releaseLock: () => void = () => undefined;
  const lockGate = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  let confirmLock: () => void = () => undefined;
  const lockReady = new Promise<void>((resolve) => {
    confirmLock = resolve;
  });

  try {
    await insertProcessingRequest({
      ...tenant,
      requestId,
      claimToken,
      leaseExpiresAt: new Date(Date.now() + 500),
    });
    const lockTask = blocker.begin(async (tx) => {
      await tx`
        select id from privacy_requests
        where id = ${requestId} and organization_id = ${tenant.organizationId}
        for update
      `;
      confirmLock();
      await lockGate;
    });
    await lockReady;

    const renewal = renewPrivacyProcessingLease(
      {
        organizationId: tenant.organizationId,
        requestId,
        claimToken,
      },
      { leaseMs: 60_000 },
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    releaseLock();
    await lockTask;

    const renewalResult = await renewal;
    assert.equal(renewalResult.error, null);
    assert.equal(renewalResult.value, null);
    const recovered = await recoverExpiredPrivacyProcessing({
      now: new Date(),
      batchSize: 10,
    });
    assert.equal(recovered.recovered, 1);
    const [request] = await sql<
      Array<{
        status: string;
        status_reason: string | null;
        processing_claim_token: string | null;
      }>
    >`
      select status, status_reason, processing_claim_token
      from privacy_requests
      where id = ${requestId} and organization_id = ${tenant.organizationId}
    `;
    assert.deepEqual(request, {
      status: "failed",
      status_reason: "processing_lease_expired",
      processing_claim_token: null,
    });
  } finally {
    releaseLock();
    await removeFixtureOrganizations([tenant.organizationId]);
  }
});

test("privacy retention reports a concurrent global cleanup as busy", async () => {
  await blocker`
    select pg_advisory_lock(
      hashtextextended(${PRIVACY_RETENTION_ADVISORY_LOCK_KEY}, 0)
    )
  `;
  try {
    const result = await cleanupExpiredPrivacyExports({ batchSize: 1 });
    assert.deepEqual(
      {
        mode: result.mode,
        deleted: result.deleted,
        cleanupFailures: result.cleanupFailures,
        budgetExhausted: result.budgetExhausted,
        mayHaveMore: result.mayHaveMore,
      },
      {
        mode: "busy",
        deleted: 0,
        cleanupFailures: 0,
        budgetExhausted: false,
        mayHaveMore: true,
      },
    );
  } finally {
    await blocker`
      select pg_advisory_unlock(
        hashtextextended(${PRIVACY_RETENTION_ADVISORY_LOCK_KEY}, 0)
      )
    `;
  }
});

test("a poisoned export rotates out so a later artifact drains on the next run", async () => {
  const tenant = await createTenant("Privacy recovery poison batch");
  const poisonRequestId = randomUUID();
  const validRequestId = randomUUID();
  const poisonArtifactId = randomUUID();
  const validArtifactId = randomUUID();
  const root = path.resolve(
    ".data/privacy-exports/tenants",
    tenant.organizationId,
  );
  const poisonStorageKey = `tenants/${tenant.organizationId}/privacy-exports/${poisonRequestId}/${poisonArtifactId}.enc`;
  const validStorageKey = `tenants/${tenant.organizationId}/privacy-exports/${validRequestId}/${validArtifactId}.enc`;
  const poisonPath = path.resolve(".data/privacy-exports", ...poisonStorageKey.split("/"));
  const validPath = path.resolve(".data/privacy-exports", ...validStorageKey.split("/"));
  const now = new Date();
  const createdAt = new Date(now.getTime() - 14 * 86_400_000);
  const readyAt = new Date(createdAt.getTime() + 60_000);
  const oldUpdatedAt = new Date(now.getTime() - 10 * 60_000);

  try {
    await sql`
      insert into privacy_requests (
        id, organization_id, subject_user_id, subject_reference,
        client_request_id, type, status, status_reason, due_at,
        created_at, updated_at
      ) values
        (
          ${poisonRequestId}, ${tenant.organizationId}, ${tenant.userId},
          ${"b".repeat(64)}, ${`poison-${poisonRequestId}`}, 'access_export',
          'failed', 'fixture_cleanup_pending',
          ${new Date(createdAt.getTime() + 30 * 86_400_000)},
          ${createdAt}, ${oldUpdatedAt}
        ),
        (
          ${validRequestId}, ${tenant.organizationId}, ${tenant.userId},
          ${"c".repeat(64)}, ${`valid-${validRequestId}`}, 'access_export',
          'failed', 'fixture_cleanup_pending',
          ${new Date(createdAt.getTime() + 30 * 86_400_000)},
          ${createdAt}, ${oldUpdatedAt}
        )
    `;
    await sql`
      insert into privacy_export_artifacts (
        id, organization_id, request_id, status, format, storage_driver,
        storage_key, safe_file_name, content_type, manifest_sha256,
        artifact_sha256, size_bytes, file_count, expires_at, ready_at,
        created_at, updated_at
      ) values
        (
          ${poisonArtifactId}, ${tenant.organizationId}, ${poisonRequestId},
          'ready', 'zip', 'filesystem', ${poisonStorageKey},
          'poison-export.zip', 'application/zip', ${"d".repeat(64)},
          ${"e".repeat(64)}, 1, 1, ${new Date(now.getTime() - 2 * 86_400_000)},
          ${readyAt}, ${createdAt}, ${oldUpdatedAt}
        ),
        (
          ${validArtifactId}, ${tenant.organizationId}, ${validRequestId},
          'ready', 'zip', 'filesystem', ${validStorageKey},
          'valid-export.zip', 'application/zip', ${"f".repeat(64)},
          ${"1".repeat(64)}, 1, 1, ${new Date(now.getTime() - 86_400_000)},
          ${readyAt}, ${createdAt}, ${oldUpdatedAt}
        )
    `;
    await mkdir(poisonPath, { recursive: true });
    await writeFile(path.join(poisonPath, "blocks-delete"), "busy\n");
    await mkdir(path.dirname(validPath), { recursive: true });
    await writeFile(validPath, "valid\n");

    const bounded = await cleanupExpiredPrivacyExports({
      now: new Date(),
      batchSize: 1,
      timeBudgetMs: 500,
      deleteTimeoutMs: 100,
    });
    assert.equal(bounded.mode, "delete");
    assert.equal(bounded.candidates, 1);
    assert.equal(bounded.deleted, 0);
    assert.equal(bounded.cleanupFailures, 0);
    assert.equal(bounded.budgetExhausted, true);
    assert.equal(bounded.mayHaveMore, true);

    const first = await cleanupExpiredPrivacyExports({
      now: new Date(),
      batchSize: 1,
    });
    assert.equal(first.mode, "delete");
    assert.equal(first.candidates, 1);
    assert.equal(first.deleted, 0);
    assert.equal(first.cleanupFailures, 1);
    assert.equal(first.mayHaveMore, true);
    const [rotated] = await sql<
      Array<{
        status: string;
        updated_at: Date;
        events: number;
        activities: number;
      }>
    >`
      select a.status, a.updated_at,
             (select count(*)::int from privacy_request_events e
              where e.request_id = a.request_id
                and e.organization_id = a.organization_id
                and e.event = 'export.cleanup_failed') as events,
             (select count(*)::int from activity_events e
              where e.entity_id = a.request_id
                and e.organization_id = a.organization_id
                and e.type = 'privacy_request.export_cleanup_failed') as activities
      from privacy_export_artifacts a where a.id = ${poisonArtifactId}
    `;
    assert.ok(rotated);
    assert.equal(rotated.status, "ready");
    assert.ok(rotated.updated_at.getTime() > oldUpdatedAt.getTime());
    assert.equal(rotated.events, 1);
    assert.equal(rotated.activities, 1);

    const second = await cleanupExpiredPrivacyExports({
      now: new Date(),
      batchSize: 1,
    });
    assert.equal(second.mode, "delete");
    assert.equal(second.candidates, 1);
    assert.equal(second.deleted, 1);
    assert.equal(second.cleanupFailures, 0);
    const [states] = await sql<
      Array<{ poison_status: string; valid_status: string }>
    >`
      select
        (select status::text from privacy_export_artifacts where id = ${poisonArtifactId}) as poison_status,
        (select status::text from privacy_export_artifacts where id = ${validArtifactId}) as valid_status
    `;
    assert.deepEqual(states, {
      poison_status: "ready",
      valid_status: "deleted",
    });
    await assert.rejects(stat(validPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await removeFixtureOrganizations([tenant.organizationId]);
  }
});

test("an orphaned filesystem publish is recovered and cleanup audit retries are idempotent", async () => {
  const tenant = await createTenant("Privacy recovery filesystem orphan");
  const requestId = randomUUID();
  const artifactId = randomUUID();
  const claimToken = randomUUID();
  const storageKey = `tenants/${tenant.organizationId}/privacy-exports/${requestId}/${artifactId}.enc`;
  const exportPath = path.resolve(
    ".data/privacy-exports",
    ...storageKey.split("/"),
  );
  const root = path.resolve(
    ".data/privacy-exports/tenants",
    tenant.organizationId,
  );
  const stored = {
    driver: "filesystem" as const,
    storageVersionId: null,
    storageEtag: null,
    storageKey,
    manifestSha256: "2".repeat(64),
    artifactSha256: "3".repeat(64),
    sizeBytes: 1,
    fileCount: 1,
  };

  try {
    await insertProcessingRequest({
      ...tenant,
      requestId,
      claimToken,
      leaseExpiresAt: new Date(Date.now() - 60_000),
      artifactId,
    });
    await mkdir(path.dirname(exportPath), { recursive: true });
    await writeFile(exportPath, "published-before-worker-loss\n");
    const recovery = await recoverExpiredPrivacyProcessing({
      now: new Date(),
      batchSize: 10,
    });
    assert.equal(recovery.recovered, 1);
    assert.equal(recovery.artifactsFailed, 1);

    const cleanupInput = {
      organizationId: tenant.organizationId,
      requestId,
      artifactId,
      stored,
      deleted: false,
      actor: { kind: "system" as const, id: "privacy-recovery-test" },
    };
    assert.equal(await recordStoredPrivacyExportCleanup(cleanupInput), true);
    assert.equal(await recordStoredPrivacyExportCleanup(cleanupInput), true);
    const [audit] = await sql<Array<{ events: number; activities: number }>>`
      select
        (select count(*)::int from privacy_request_events
         where request_id = ${requestId}
           and organization_id = ${tenant.organizationId}
           and event = 'export.cleanup_failed'
           and metadata->>'artifactId' = ${artifactId}) as events,
        (select count(*)::int from activity_events
         where entity_id = ${requestId}
           and organization_id = ${tenant.organizationId}
           and type = 'privacy_request.export_cleanup_failed'
           and metadata->>'artifactId' = ${artifactId}) as activities
    `;
    assert.deepEqual(audit, { events: 1, activities: 1 });

    const retention = await cleanupExpiredPrivacyExports({
      now: new Date(Date.now() + PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS + 1_000),
      batchSize: 10,
    });
    assert.equal(retention.cleanupFailures, 0);
    assert.equal(retention.deleted, 1);
    const [artifact] = await sql<Array<{ status: string }>>`
      select status from privacy_export_artifacts where id = ${artifactId}
    `;
    assert.equal(artifact?.status, "deleted");
    await assert.rejects(stat(exportPath), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
    await removeFixtureOrganizations([tenant.organizationId]);
  }
});

async function waitForExportArtifact(requestId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [artifact] = await sql<
      Array<{ id: string; organization_id: string; storage_key: string }>
    >`
      select id, organization_id, storage_key
      from privacy_export_artifacts
      where request_id = ${requestId}
      limit 1
    `;
    if (artifact) return artifact;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The privacy export artifact was not created in time.");
}

async function waitForFile(filePath: string) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      const current = await stat(filePath);
      if (current.isFile()) return;
    } catch {
      // The immutable export is published after its temporary file is synced.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The privacy export object was not stored in time.");
}

async function waitForExportIdentityCommit(artifactId: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [artifact] = await sql<
      Array<{ created_at: Date; updated_at: Date; status: string }>
    >`
      select created_at, updated_at, status
      from privacy_export_artifacts where id = ${artifactId}
    `;
    if (
      artifact?.status === "building" &&
      artifact.updated_at.getTime() > artifact.created_at.getTime()
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The privacy export identity was not committed in time.");
}

test("a post-store snapshot race retains failed cleanup identity for retention retry", async () => {
  const tenant = await createTenant("Privacy snapshot race");
  const requestId = randomUUID();
  const assetId = randomUUID();
  const mediaBytes = Buffer.from("privacy snapshot race media\n", "utf8");
  const mediaSha256 = createHash("sha256").update(mediaBytes).digest("hex");
  const storageKey = createMediaObjectKey({
    organizationId: tenant.organizationId,
    assetId,
    safeFileName: "snapshot.txt",
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId: tenant.organizationId,
    assetId,
    safeFileName: "snapshot.txt",
  });
  if (!storageKey || !stagingStorageKey) {
    throw new Error("The privacy media fixture keys are invalid.");
  }
  const exportTenantRoot = path.resolve(
    ".data/privacy-exports/tenants",
    tenant.organizationId,
  );
  const mediaTenantRoot = path.resolve(
    ".data/media/tenants",
    tenant.organizationId,
  );
  let releaseMediaLock: () => void = () => undefined;
  let exportPath: string | null = null;
  let backupPath: string | null = null;

  try {
    await writeDevelopmentMediaObject({
      identity: { organizationId: tenant.organizationId, assetId, key: storageKey },
      body: (async function* () {
        yield mediaBytes;
      })(),
      expectedSizeBytes: mediaBytes.byteLength,
    });
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at, created_at
      ) values (
        ${assetId}, ${tenant.organizationId}, ${tenant.userId}, ${tenant.userId},
        'avatar', 'document', 'ready', 'filesystem', ${storageKey},
        ${stagingStorageKey}, 'snapshot.txt', 'snapshot.txt', 'text/plain',
        'text/plain', ${mediaBytes.byteLength}, ${mediaBytes.byteLength},
        ${mediaBytes.byteLength}, ${mediaSha256}, now() + interval '1 hour',
        now(), now(), now() - interval '1 minute'
      )
    `;
    await sql`
      insert into privacy_requests (
        id, organization_id, subject_user_id, subject_reference,
        client_request_id, type, status, due_at, identity_verified_at,
        approved_at, policy_version, policy_snapshot, created_at, updated_at
      ) values (
        ${requestId}, ${tenant.organizationId}, ${tenant.userId},
        ${"d".repeat(64)}, ${`snapshot-race-${requestId}`}, 'access_export',
        'approved', now() + interval '30 days', now() - interval '2 minutes',
        now() - interval '1 minute', 'privacy-dsar-v2',
        ${sql.json({ fixture: true })}, now() - interval '3 minutes', now()
      )
    `;

    let lockReadyResolve: () => void = () => undefined;
    const lockReady = new Promise<void>((resolve) => {
      lockReadyResolve = resolve;
    });
    const releaseLock = new Promise<void>((resolve) => {
      releaseMediaLock = resolve;
    });
    const lockTask = blocker.begin(async (tx) => {
      await tx`
        select id from media_assets
        where id = ${assetId} and organization_id = ${tenant.organizationId}
        for update
      `;
      lockReadyResolve();
      await releaseLock;
      await tx`
        update media_assets set status = 'deleted', deleted_at = now()
        where id = ${assetId} and organization_id = ${tenant.organizationId}
      `;
    });
    await lockReady;

    const processing = processPrivacyRequest(
      tenant.organizationId,
      requestId,
      { kind: "system", id: "privacy-race-test" },
    );
    const processingResult = processing.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    const artifact = await waitForExportArtifact(requestId);
    exportPath = path.resolve(
      ".data/privacy-exports",
      ...artifact.storage_key.split("/"),
    );
    backupPath = `${exportPath}.retry-source`;
    await Promise.race([
      waitForFile(exportPath),
      processingResult.then(({ error }) => {
        if (error instanceof Error && error.cause) throw error.cause;
        throw error ?? new Error("The privacy export completed before the race.");
      }),
    ]);
    await rename(exportPath, backupPath);
    await mkdir(exportPath, { recursive: false });
    await writeFile(path.join(exportPath, "blocks-delete"), "busy\n", {
      flag: "wx",
    });
    releaseMediaLock();
    await lockTask;

    const { value, error } = await processingResult;
    assert.equal(value, null);
    assert.equal((error as { code?: string }).code, "processing_failed");
    const [failed] = await sql<
      Array<{
        request_status: string;
        status_reason: string | null;
        artifact_status: string;
        failure_code: string | null;
      }>
    >`
      select r.status as request_status, r.status_reason,
             a.status as artifact_status, a.failure_code
      from privacy_requests r
      join privacy_export_artifacts a
        on a.request_id = r.id and a.organization_id = r.organization_id
      where r.id = ${requestId} and r.organization_id = ${tenant.organizationId}
    `;
    assert.deepEqual(failed, {
      request_status: "failed",
      status_reason: "export_package_failed",
      artifact_status: "failed",
      failure_code: "export_object_cleanup_failed",
    });

    await rm(exportPath, { recursive: true, force: true });
    await rename(backupPath, exportPath);
    backupPath = null;
    const retention = await cleanupExpiredPrivacyExports({
      now: new Date(Date.now() + PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS + 1_000),
      batchSize: 50,
    });
    assert.equal(retention.cleanupFailures, 0);
    assert.ok(retention.deleted >= 1);
    const [deleted] = await sql<
      Array<{ status: string; deleted_at: Date | null; reason_code: string }>
    >`
      select a.status, a.deleted_at,
             e.metadata->>'reasonCode' as reason_code
      from privacy_export_artifacts a
      join privacy_request_events e
        on e.request_id = a.request_id
       and e.organization_id = a.organization_id
       and e.event = 'export.deleted'
      where a.id = ${artifact.id}
      order by e.created_at desc
      limit 1
    `;
    assert.equal(deleted?.status, "deleted");
    assert.ok(deleted?.deleted_at);
    assert.equal(deleted?.reason_code, "failed_artifact_cleanup");
    await assert.rejects(stat(exportPath), { code: "ENOENT" });
  } finally {
    releaseMediaLock();
    if (backupPath && exportPath) {
      await rm(backupPath, { force: true }).catch(() => undefined);
    }
    await rm(exportTenantRoot, { recursive: true, force: true });
    await rm(mediaTenantRoot, { recursive: true, force: true });
    await removeFixtureOrganizations([tenant.organizationId]);
  }
});

test("recovery wins after identity commit and the old worker cannot finalize", async () => {
  const tenant = await createTenant("Privacy lease loss race");
  const requestId = randomUUID();
  const assetId = randomUUID();
  const mediaBytes = Buffer.from("privacy lease loss media\n", "utf8");
  const mediaSha256 = createHash("sha256").update(mediaBytes).digest("hex");
  const storageKey = createMediaObjectKey({
    organizationId: tenant.organizationId,
    assetId,
    safeFileName: "lease-loss.txt",
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId: tenant.organizationId,
    assetId,
    safeFileName: "lease-loss.txt",
  });
  if (!storageKey || !stagingStorageKey) {
    throw new Error("The privacy media fixture keys are invalid.");
  }
  const exportTenantRoot = path.resolve(
    ".data/privacy-exports/tenants",
    tenant.organizationId,
  );
  const mediaTenantRoot = path.resolve(
    ".data/media/tenants",
    tenant.organizationId,
  );
  let releaseMediaLock: () => void = () => undefined;
  let exportPath: string | null = null;

  try {
    await writeDevelopmentMediaObject({
      identity: { organizationId: tenant.organizationId, assetId, key: storageKey },
      body: (async function* () {
        yield mediaBytes;
      })(),
      expectedSizeBytes: mediaBytes.byteLength,
    });
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
        status, storage_driver, storage_key, staging_storage_key,
        original_file_name, safe_file_name, declared_mime_type,
        detected_mime_type, declared_size_bytes, actual_size_bytes,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at, created_at
      ) values (
        ${assetId}, ${tenant.organizationId}, ${tenant.userId}, ${tenant.userId},
        'avatar', 'document', 'ready', 'filesystem', ${storageKey},
        ${stagingStorageKey}, 'lease-loss.txt', 'lease-loss.txt', 'text/plain',
        'text/plain', ${mediaBytes.byteLength}, ${mediaBytes.byteLength},
        ${mediaBytes.byteLength}, ${mediaSha256}, now() + interval '1 hour',
        now(), now(), now() - interval '1 minute'
      )
    `;
    await sql`
      insert into privacy_requests (
        id, organization_id, subject_user_id, subject_reference,
        client_request_id, type, status, due_at, identity_verified_at,
        approved_at, policy_version, policy_snapshot, created_at, updated_at
      ) values (
        ${requestId}, ${tenant.organizationId}, ${tenant.userId},
        ${"f".repeat(64)}, ${`lease-loss-${requestId}`}, 'access_export',
        'approved', now() + interval '30 days', now() - interval '2 minutes',
        now() - interval '1 minute', 'privacy-dsar-v2',
        ${sql.json({ fixture: true })}, now() - interval '3 minutes', now()
      )
    `;

    let lockReadyResolve: () => void = () => undefined;
    const lockReady = new Promise<void>((resolve) => {
      lockReadyResolve = resolve;
    });
    const releaseLock = new Promise<void>((resolve) => {
      releaseMediaLock = resolve;
    });
    const lockTask = blocker.begin(async (tx) => {
      await tx`
        select id from media_assets
        where id = ${assetId} and organization_id = ${tenant.organizationId}
        for update
      `;
      lockReadyResolve();
      await releaseLock;
    });
    await lockReady;

    const processing = processPrivacyRequest(
      tenant.organizationId,
      requestId,
      { kind: "system", id: "privacy-lease-loss-test" },
    );
    const processingResult = processing.then(
      (value) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error }),
    );
    const artifact = await waitForExportArtifact(requestId);
    exportPath = path.resolve(
      ".data/privacy-exports",
      ...artifact.storage_key.split("/"),
    );
    await Promise.race([
      Promise.all([
        waitForFile(exportPath),
        waitForExportIdentityCommit(artifact.id),
      ]),
      processingResult.then(({ error }) => {
        if (error instanceof Error && error.cause) throw error.cause;
        throw error ?? new Error("The privacy export completed before recovery.");
      }),
    ]);
    const [claim] = await sql<
      Array<{ processing_claim_token: string; processing_claimed_at: Date }>
    >`
      select processing_claim_token, processing_claimed_at
      from privacy_requests
      where id = ${requestId} and organization_id = ${tenant.organizationId}
    `;
    assert.ok(claim?.processing_claim_token);
    const recoveryNow = new Date();
    const expiredAt = new Date(recoveryNow.getTime() - 1_000);
    const claimedAt = new Date(expiredAt.getTime() - 60_000);
    const [expired] = await sql<Array<{ id: string }>>`
      update privacy_requests
      set processing_claimed_at = ${claimedAt},
          processing_lease_expires_at = ${expiredAt},
          updated_at = ${recoveryNow}
      where id = ${requestId}
        and organization_id = ${tenant.organizationId}
        and status = 'processing'
        and processing_claim_token = ${claim.processing_claim_token}
      returning id
    `;
    assert.equal(expired?.id, requestId);

    const recovery = await recoverExpiredPrivacyProcessing({
      now: recoveryNow,
      batchSize: 50,
    });
    assert.ok(recovery.recovered >= 1);
    releaseMediaLock();
    await lockTask;

    const { value, error } = await processingResult;
    assert.equal(value, null);
    assert.equal((error as { code?: string }).code, "invalid_transition");
    const [result] = await sql<
      Array<{
        request_status: string;
        status_reason: string | null;
        processing_claim_token: string | null;
        artifact_status: string;
        failure_code: string | null;
        lease_events: number;
        ready_events: number;
        worker_failure_events: number;
      }>
    >`
      select r.status as request_status, r.status_reason,
             r.processing_claim_token, a.status as artifact_status,
             a.failure_code,
             count(e.id) filter (
               where e.event = 'request.processing_lease_expired'
             )::int as lease_events,
             count(e.id) filter (where e.event = 'export.zip_ready')::int
               as ready_events,
             count(e.id) filter (where e.event = 'export.failed')::int
               as worker_failure_events
      from privacy_requests r
      join privacy_export_artifacts a
        on a.request_id = r.id and a.organization_id = r.organization_id
      left join privacy_request_events e
        on e.request_id = r.id and e.organization_id = r.organization_id
      where r.id = ${requestId} and r.organization_id = ${tenant.organizationId}
      group by r.status, r.status_reason, r.processing_claim_token,
               a.status, a.failure_code
    `;
    assert.deepEqual(result, {
      request_status: "failed",
      status_reason: "processing_lease_expired",
      processing_claim_token: null,
      artifact_status: "deleted",
      failure_code: "processing_lease_expired",
      lease_events: 1,
      ready_events: 0,
      worker_failure_events: 0,
    });
    assert.equal(
      await renewPrivacyProcessingLease(
        {
          organizationId: tenant.organizationId,
          requestId,
          claimToken: claim.processing_claim_token,
        },
      ),
      null,
    );
    await assert.rejects(stat(exportPath), { code: "ENOENT" });
  } finally {
    releaseMediaLock();
    await rm(exportTenantRoot, { recursive: true, force: true });
    await rm(mediaTenantRoot, { recursive: true, force: true });
    await removeFixtureOrganizations([tenant.organizationId]);
  }
});
