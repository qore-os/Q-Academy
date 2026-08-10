import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("src/lib/media/api-multipart-service.ts", "utf8");
const createRoute = readFileSync(
  "src/app/api/v1/media-assets/route.ts",
  "utf8",
);
const multipartRoute = readFileSync(
  "src/app/api/v1/media-assets/[id]/multipart/route.ts",
  "utf8",
);
const partRoute = readFileSync(
  "src/app/api/v1/media-assets/[id]/multipart/parts/route.ts",
  "utf8",
);
const completeRoute = readFileSync(
  "src/app/api/v1/media-assets/[id]/complete/route.ts",
  "utf8",
);
const storageConfiguration = readFileSync(
  "src/lib/media/storage-configuration.ts",
  "utf8",
);
const databaseSchema = readFileSync("src/db/schema.ts", "utf8");

test("v1 media creation selects multipart only for capable versioned S3", () => {
  assert.match(
    service,
    /configuration\.driver === "s3"[\s\S]*configuration\.compatibilityMode === "versioned"[\s\S]*sizeBytes >= API_MULTIPART_THRESHOLD_BYTES/,
  );
  assert.match(createRoute, /reserveApiMediaUploadIntent/);
  assert.match(createRoute, /initializeApiMultipartUpload/);
  assert.match(service, /multipartUploadTtlSeconds/);
  assert.match(createRoute, /createMediaUploadAuthorization/);
  assert.match(
    storageConfiguration,
    /MAX_SCANNABLE_MEDIA_BYTES = 2_000_000_000/,
  );
  assert.match(
    storageConfiguration,
    /const MAX_UPLOAD_BYTES = MAX_SCANNABLE_MEDIA_BYTES/,
  );
});

test("v1 multipart creation persists its claim before provider I/O", () => {
  assert.match(createRoute, /handleApi\(/);
  assert.doesNotMatch(createRoute, /handleTransactionalApiCommand/);
  assert.match(createRoute, /idempotency-key/);
  assert.ok(
    createRoute.indexOf("reserveApiMediaUploadIntent({") <
      createRoute.indexOf("initializeApiMultipartUpload("),
  );

  const reserve = service.slice(
    service.indexOf("export async function reserveApiMediaUploadIntent"),
    service.indexOf("function multipartUploadAuthorization"),
  );
  assert.match(reserve, /db\.transaction/);
  assert.match(reserve, /state: "initializing"/);
  assert.doesNotMatch(reserve, /createS3MultipartUpload\(/);
  assert.match(service, /apiMediaUploadIntentId/);
  assert.match(service, /q-academy:api-media-upload:v1/);

  const initialize = service.slice(
    service.indexOf("export async function initializeApiMultipartUpload"),
    service.indexOf("async function listMultipartStatus"),
  );
  assert.ok(
    initialize.indexOf("db.transaction") <
      initialize.indexOf("createS3MultipartUpload(configuration"),
  );
  assert.match(initialize, /isNull\(mediaUploadSessions\.providerUploadId\)/);
  assert.match(initialize, /eq\(mediaUploadSessions\.updatedAt,/);
  assert.match(initialize, /create_claim_release/);
  assert.doesNotMatch(initialize, /delete\(mediaUploadSessions\)/);
});

test("v1 multipart routes retain API auth, idempotency, and explicit recovery", () => {
  assert.match(multipartRoute, /handleApi\(/);
  assert.match(multipartRoute, /getApiMultipartUploadStatus/);
  assert.match(multipartRoute, /recoverApiMultipartUploadStatus/);
  assert.match(multipartRoute, /abortApiMultipartUpload/);
  assert.match(multipartRoute, /idempotent:\s*true/);
  assert.match(partRoute, /handleApi\(/);
  assert.match(partRoute, /parseJson\(/);
  assert.match(partRoute, /idempotent:\s*true/);
  assert.match(completeRoute, /completeApiMediaAsset/);
  assert.match(completeRoute, /idempotent:\s*true/);
});

test("v1 multipart lifecycle fences every asset and session by tenant", () => {
  assert.match(service, /mediaAssetForTenant\([\s\S]*context\.organizationId/);
  assert.match(service, /assertApiMediaManageVisibility\(context, asset\)/);
  assert.match(
    service,
    /assertMediaPurposeAccess\(context, asset\.purpose, "write"\)/,
  );
  assert.match(
    service,
    /eq\(mediaUploadSessions\.organizationId, apiContext\.organizationId\)/,
  );
  assert.match(service, /apiMediaManageVisibility\(actor\)/);
  assert.match(service, /initializationToken/);
  assert.match(service, /eq\(mediaUploadSessions\.updatedAt,/);
});

test("missing provider uploads verify completion before recreation", () => {
  const recover = service.slice(
    service.indexOf("export async function recoverApiMultipartUploadStatus"),
    service.indexOf("export async function authorizeApiMultipartUploadPart"),
  );
  assert.ok(recover.indexOf("completedStagingObject") >= 0);
  assert.ok(recover.indexOf("activateRecoveredMultipartUpload") >= 0);
  assert.ok(
    recover.indexOf("completedStagingObject") <
      recover.lastIndexOf("activateRecoveredMultipartUpload"),
  );
  assert.match(service, /upload_session_expiring/);

  const activate = service.slice(
    service.indexOf("async function activateRecoveredMultipartUpload"),
    service.indexOf("export async function recoverApiMultipartUploadStatus"),
  );
  assert.match(activate, /state: "recovering"/);
  assert.match(activate, /eq\(mediaUploadSessions\.state, "recovering"\)/);
  assert.match(
    recover,
    /session\?\.state === "initializing" \|\| session\?\.state === "recovering"/,
  );

  const completion = service.slice(
    service.indexOf("async function completeMultipartAsset"),
    service.indexOf("async function completeLegacyS3Asset"),
  );
  assert.match(completion, /error\.code === "object_missing"/);
  assert.match(completion, /completedStagingObject\(claimed\.asset\)/);
  assert.match(completion, /completion_claim_lost|resetCompletionClaim/);
  assert.match(completion, /claimed\.recoveredCompletion/);
  assert.match(
    completion,
    /try \{\s+if \(claimed\.recoveredCompletion\) \{\s+stored = await completedStagingObject\(claimed\.asset\);/,
  );
  assert.ok(
    completion.indexOf("completedStagingObject(claimed.asset)") <
      completion.indexOf("completeS3MultipartUpload(configuration"),
  );
  assert.match(
    service,
    /API_MULTIPART_STALE_CLAIM_MS \+[\s\S]*API_MULTIPART_COMPLETION_RESERVE_MS/,
  );
});

test("abort is provider-backed and releases quota only after cleanup", () => {
  const abort = service.slice(
    service.indexOf("export async function abortApiMultipartUpload"),
  );
  assert.match(abort, /state: "aborting"/);
  assert.match(abort, /abortS3MultipartUpload/);
  assert.match(abort, /deleteStoredMediaObject/);
  assert.match(
    abort,
    /providerUploadId\s+\?\s+eq\(mediaUploadSessions\.providerUploadId, providerUploadId\)\s+: isNull\(mediaUploadSessions\.providerUploadId\)/,
  );
  assert.match(
    abort,
    /if \(claimed\.session\.providerUploadId\) \{[\s\S]*abortS3MultipartUpload/,
  );
  assert.doesNotMatch(
    abort,
    /!providerUploadId \|\|\s+session\.state === "initializing"/,
  );
  assert.ok(
    abort.indexOf("deleteStoredMediaObject") < abort.indexOf("quotaBytes: 0"),
  );
  assert.match(abort, /multipartAbortVerifiedAt:\s*cleanedAt/);
  assert.match(databaseSchema, /media_assets_multipart_abort_proof_check/);
  assert.match(
    databaseSchema,
    /multipartAbortVerifiedAt}[\s\S]*stagingDeletedAt} >= \$\{table\.multipartAbortVerifiedAt}/,
  );
});
