import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("src/lib/media/session-service.ts", "utf8");
const browser = readFileSync("src/lib/media/browser-session-upload.ts", "utf8");
const maintenance = readFileSync("src/lib/media/scan-worker.ts", "utf8");
const processing = readFileSync("src/lib/media/processing-worker.ts", "utf8");
const maintenanceRoute = readFileSync(
  "src/app/api/internal/jobs/media/maintenance/route.ts",
  "utf8",
);
const schema = readFileSync("src/db/schema.ts", "utf8");
const compose = readFileSync("compose.production.yml", "utf8");
const multipartRoute = readFileSync(
  "src/app/api/media-assets/[id]/multipart/route.ts",
  "utf8",
);
const courseUpload = readFileSync(
  "src/components/admin/course-media-source-field.tsx",
  "utf8",
);
const profileUpload = readFileSync(
  "src/components/media/profile-media-asset-field.tsx",
  "utf8",
);

test("large versioned S3 browser uploads use persisted multipart sessions", () => {
  assert.match(service, /SESSION_MULTIPART_THRESHOLD_BYTES/);
  assert.match(service, /compatibilityMode\s*!==\s*"versioned"/);
  assert.match(service, /createS3MultipartUpload\(/);
  assert.match(service, /mediaUploadSessions\.assetId/);
  assert.match(service, /multipartUploadTtlSeconds/);
  assert.match(service, /transport:\s*"s3-multipart"/);
});

test("part authorization and completion remain tenant and object bound", () => {
  assert.match(
    service,
    /eq\(mediaUploadSessions\.organizationId, user\.organizationId\)/,
  );
  assert.match(service, /expectedS3MultipartPartSize\(/);
  assert.match(service, /createS3MultipartPartUploadAuthorization\(/);
  assert.match(service, /listS3MultipartUploadParts\(/);
  assert.match(service, /completeS3MultipartUpload\(/);
  assert.match(service, /stagingStorageVersionId:\s*stored\.versionId/);
});

test("browser multipart upload hashes, slices, retries, and limits concurrency", () => {
  assert.match(browser, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(browser, /file\.slice\(start, end, file\.type\)/);
  assert.match(browser, /attempt\s*<\s*5/);
  assert.match(browser, /authorization\.concurrency/);
  assert.match(browser, /MAX_ACTIVE_MULTIPART_PARTS\s*=\s*3/);
  assert.match(browser, /acquireMultipartSlot\(transferSignal\)/);
  assert.match(browser, /new AbortController\(\)/);
  assert.match(browser, /Promise\.allSettled\(workers\)/);
  assert.match(browser, /firstError \?\?= error/);
  assert.match(browser, /MULTIPART_PART_STALL_TIMEOUT_MS/);
  assert.match(browser, /armStallTimeout\(\)/);
  assert.match(browser, /xhr\.upload\.onprogress/);
  assert.match(browser, /transport === "s3-multipart"/);
  assert.match(browser, /2 \* 60 \* 60_000/);
});

test("multipart completion claims outlive the bounded provider operation", () => {
  assert.match(service, /SESSION_MULTIPART_STALE_CLAIM_MS\s*=\s*15 \* 60_000/);
  assert.match(service, /lt\(mediaUploadSessions\.updatedAt, staleBefore\)/);
  assert.match(service, /S3_MULTIPART_COMPLETION_RECOVERY_MS/);
  assert.match(service, /absoluteUploadDeadline/);
  assert.match(service, /completion_claim_lost/);
  assert.match(
    service,
    /releaseNow\.getTime\(\) - SESSION_MULTIPART_STALE_CLAIM_MS - 1/,
  );
  assert.match(service, /await releaseMultipartCompletionClaim\?\.\(\)/);
  assert.match(
    service,
    /eq\(mediaUploadSessions\.updatedAt, claimed\.updatedAt\)/,
  );
  assert.match(browser, /completeMultipartUploadWithRecovery/);
  assert.match(browser, /completion_in_progress/);
  assert.match(browser, /intent\.completionPending/);
});

test("expired and explicitly deleted multipart uploads are aborted", () => {
  assert.match(service, /abortS3MultipartUpload\(/);
  assert.match(service, /state:\s*"aborting"/);
  assert.match(service, /media\.multipart\.delete_cleanup/);
  assert.match(maintenance, /"media\.multipart\.expire"/);
  assert.match(maintenance, /cleanupDetachedMultipartUploads\(/);
  assert.match(maintenance, /MULTIPART_STALE_CLAIM_MS/);
  assert.match(maintenance, /abortS3MultipartUpload\(/);
  assert.match(maintenance, /budget\.tryClaimIoAsset\(\)/);
  assert.match(maintenance, /budget\.runAbortable/);
  assert.match(maintenance, /delete\(mediaUploadSessions\)/);
});

test("maintenance revalidates the exact multipart identity before claiming I/O", () => {
  assert.match(maintenance, /claimMultipartSessionForCleanup\(/);
  assert.match(maintenance, /\.for\("update"\)/);
  assert.match(maintenance, /multipartSessionMatchesSnapshot\(/);
  assert.match(maintenance, /initializationToken/);
  assert.match(maintenance, /providerUploadCondition/);
  assert.match(maintenance, /mediaUploadSessions\.uploadDeadlineAt/);
  assert.match(maintenance, /mediaUploadSessions\.updatedAt/);

  const cleanup = maintenance
    .split("async function cleanupMultipartSession")[1]
    ?.split("async function cleanupDetachedMultipartUploads")[0];
  assert.ok(cleanup);
  assert.ok(
    cleanup.indexOf("claimMultipartSessionForCleanup") <
      cleanup.indexOf("budget.tryClaimIoAsset"),
  );
  assert.match(cleanup, /restoreMultipartCleanupClaim\(claimed\)/);
});

test("all maintenance storage deletion shares one lock and hard budget", () => {
  assert.doesNotMatch(maintenanceRoute, /cleanupMediaProcessingArtifacts/);
  assert.match(
    maintenance,
    /cleanupMediaProcessingArtifacts\([\s\S]{0,160}budget/,
  );
  assert.match(
    processing,
    /cleanupMediaProcessingArtifacts\([\s\S]*budget: MediaMaintenanceBudget/,
  );
  assert.match(processing, /budget\.runAbortable\(\(signal\) =>/);
  assert.match(processing, /deleteStoredMediaObject\([\s\S]*signal,[\s\S]*\)/);
});

test("database quota release precedes provider cleanup and tombstone purge", () => {
  const work = maintenance.split("work: async (budget) =>")[1];
  assert.ok(work);
  const firstQuotaRelease = work.indexOf("releaseVerifiedDeletedQuota");
  const firstMultipartCleanup = work.indexOf("expirePendingUploads");
  const tombstonePurge = work.indexOf("purgeVerifiedTombstones");
  assert.ok(firstQuotaRelease >= 0);
  assert.ok(firstQuotaRelease < firstMultipartCleanup);
  assert.ok(tombstonePurge > firstMultipartCleanup);
  assert.match(maintenance, /multipartAbortVerifiedAt/);
});

test("maintenance rotates reserved I/O opportunities without raising the limit", () => {
  assert.match(maintenance, /FAIR_IO_PHASE_ASSET_LIMIT\s*=\s*1/);
  assert.match(maintenance, /const fairIoPhases = \[/);
  assert.match(maintenance, /mediaMaintenanceIoPhaseCursor/);
  assert.match(
    maintenance,
    /\(mediaMaintenanceIoPhaseCursor \+ 1\) % fairIoPhases\.length/,
  );
  for (const phase of [
    "cleanupStoredObjects",
    "cleanupMediaProcessingArtifacts",
    "expirePendingUploads",
    "cleanupDetachedMultipartUploads",
    "purgeVerifiedTombstones",
  ]) {
    assert.match(
      maintenance,
      new RegExp(`${phase}\\([\\s\\S]{0,120}FAIR_IO_PHASE_ASSET_LIMIT`),
    );
  }
  assert.match(maintenance, /ioLimit: limit/);
});

test("maintenance rotates candidates across tenants inside every phase", () => {
  assert.doesNotMatch(maintenance, /:\s*sql<number>`0`/);
  assert.doesNotMatch(processing, /:\s*sql<number>`0`/);
  assert.match(maintenance, /\.\.\.\(tenantCursor/);
  assert.match(processing, /\.\.\.\(tenantCursor/);
  assert.match(maintenance, /mediaMaintenanceTenantCursors/);
  for (const cursor of [
    "expiredUploadWithoutSession",
    "expiredUpload",
    "detachedMultipart",
    "storedObject",
    "quotaRelease",
    "tombstone",
    "unattachedSubmission",
    "unattachedCourse",
    "unattachedCommunity",
    "unattachedProfile",
    "unattachedProfileField",
    "unattachedBranding",
  ]) {
    assert.match(maintenance, new RegExp(`TenantCursors\\.${cursor}`));
  }
  assert.match(
    maintenance,
    /row_number\(\) over \(partition by \$\{mediaAssets\.organizationId\}/,
  );
  assert.match(processing, /mediaProcessingArtifactTenantCursor/);
  assert.match(processing, /mediaProcessingCancellationTenantCursor/);
  assert.match(
    processing,
    /row_number\(\) over \(partition by \$\{mediaProcessingJobs\.organizationId\}/,
  );
  assert.match(maintenance, /organizationId}::text > \$\{tenantCursor}/);
  assert.match(processing, /organizationId}::text > \$\{tenantCursor}/);
});

test("multipart initialization is serialized and only then extends its expiry", () => {
  assert.match(
    service,
    /select\(\)[\s\S]*from\(mediaAssets\)[\s\S]*for\("update"\)/,
  );
  assert.match(service, /createS3MultipartUpload\(configuration/);
  assert.match(service, /multipartUploadTtlSeconds \* 1000/);
  assert.match(service, /set\(\{ uploadExpiresAt: multipartExpiresAt/);
  assert.match(service, /media\.multipart\.create_reconcile/);
  const invalidCreateRollback = service.indexOf(
    'action: "media.multipart.invalid_create_rollback"',
  );
  const initializationCleanup = service.indexOf(
    'action: "media.multipart.initialization_cleanup"',
  );
  assert.ok(invalidCreateRollback >= 0);
  assert.ok(invalidCreateRollback < initializationCleanup);
  assert.match(
    service,
    /state:\s*effectiveRecoveryDeadline \? "recovering" : "initializing"/,
  );
  assert.match(service, /initializationToken/);
  assert.match(service, /upload_session_initializing/);
  assert.match(service, /ownedInitializationToken/);
  assert.match(service, /state:\s*"recovering"/);
});

test("multipart status GET is read-only and recovery is a protected POST", () => {
  const getHandler =
    multipartRoute
      .split("export async function GET")[1]
      ?.split("export async function POST")[0] ?? "";
  assert.match(getHandler, /getSessionMultipartUploadStatus/);
  assert.doesNotMatch(getHandler, /recoverSessionMultipartUploadStatus/);
  assert.match(multipartRoute, /export async function POST/);
  assert.match(multipartRoute, /mutation:\s*true/);
  assert.match(multipartRoute, /recoverSessionMultipartUploadStatus/);
  assert.match(
    browser,
    /authorization\.statusUrl,[\s\S]{0,100}method:\s*"POST"/,
  );
});

test("all large browser upload surfaces retain retry identity and progress", () => {
  for (const source of [courseUpload, profileUpload]) {
    assert.match(source, /retryUploadRef/);
    assert.match(source, /clientUploadId/);
    assert.match(source, /onProgress/);
    assert.match(source, /onStage/);
    assert.match(source, /RefreshCw/);
  }
});

test("session uploads enforce owner-bound tenant membership", () => {
  assert.match(service, /OWNER_BOUND_SESSION_PURPOSES/);
  assert.match(service, /ownerUserId !== user\.id/);
  assert.match(service, /eq\(users\.organizationId, user\.organizationId\)/);
  assert.match(service, /eq\(users\.status, "active"\)/);
});

test("database and production config persist bounded upload sessions", () => {
  assert.match(schema, /export const mediaUploadSessions = pgTable\(/);
  assert.match(schema, /media_upload_sessions_asset_tenant_fk/);
  assert.match(schema, /expectedPartCount/);
  assert.match(schema, /expiresAt/);
  assert.match(
    schema,
    /state} not in \('initializing', 'recovering', 'aborting'\) and \$\{table\.providerUploadId} is not null/,
  );
  assert.match(schema, /media_upload_sessions_state_check/);
  assert.match(compose, /MEDIA_MULTIPART_UPLOAD_TTL_SECONDS/);
});
