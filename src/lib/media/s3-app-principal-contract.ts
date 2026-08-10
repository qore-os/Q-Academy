import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  normalizeS3Etag,
  requireS3VersionId,
  S3ObjectIntegrityError,
  type S3ObjectIntegrityMetadata,
  verifyS3ObjectIntegrity,
} from "./s3-object-integrity";
import {
  hasRequiredS3BrowserUploadCorsInventory,
  type S3BrowserUploadCorsRuleContract,
} from "./s3-browser-upload-cors";
import {
  normalizeS3BrowserUploadOrigins,
  S3BrowserUploadOriginInventoryError,
} from "./s3-browser-upload-origins";
import {
  compositeS3MultipartSha256,
  createS3MultipartCanaryParts,
  joinS3MultipartCanaryParts,
} from "./s3-multipart-preflight";
import {
  hasRequiredS3PrivacyExportLifecycle,
  resolveS3IncompleteMultipartUploadLifecycleDays,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
  type S3LifecycleRuleContract,
} from "./s3-privacy-export-lifecycle";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ASSET_MIME_TYPE = "application/octet-stream";
const PRIVACY_MIME_TYPE = "application/vnd.q-academy.encrypted+json";

type Canary = Readonly<{
  id: string;
  organizationId: string;
  assetId: string;
  privacyRequestId: string;
  privacyArtifactId: string;
  body: Uint8Array;
}>;

type PutInput = Readonly<{
  key: string;
  body: Uint8Array;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  tagging?: string;
  ifNoneMatch: "*";
}>;

type StableObject = Readonly<{ VersionId?: string; ETag?: string }>;
type MultipartUploadTarget = Readonly<{ key: string; uploadId: string }>;

export type S3AppPrincipalContractAdapter = Readonly<{
  bucket: string;
  getBucketVersioning(): Promise<string | undefined>;
  getBucketLifecycleConfiguration(): Promise<
    readonly S3LifecycleRuleContract[]
  >;
  getBucketCorsConfiguration(): Promise<
    readonly S3BrowserUploadCorsRuleContract[]
  >;
  seedObject(input: PutInput): Promise<StableObject>;
  appPutObject(input: PutInput): Promise<StableObject>;
  appHeadObject(input: {
    key: string;
    versionId?: string;
    checksumMode?: "ENABLED";
  }): Promise<
    S3ObjectIntegrityMetadata & {
      ChecksumSHA256?: string;
      ChecksumType?: string;
    }
  >;
  appGetObject(input: {
    key: string;
    versionId: string;
    expectedEtag: string;
  }): Promise<
    S3ObjectIntegrityMetadata & { body: AsyncIterable<Uint8Array> }
  >;
  appCopyObject(input: {
    sourceKey: string;
    sourceVersionId: string;
    sourceEtag: string;
    targetKey: string;
    contentType: string;
    metadata: Readonly<Record<string, string>>;
  }): Promise<unknown>;
  appCreateMultipartUpload(input: {
    key: string;
    contentType: string;
    metadata: Readonly<Record<string, string>>;
  }): Promise<{
    Bucket?: string;
    Key?: string;
    UploadId?: string;
    ChecksumAlgorithm?: string;
    ChecksumType?: string;
  }>;
  appUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    checksumSha256: string;
  }): Promise<{ ETag?: string; ChecksumSHA256?: string }>;
  appBrowserUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    checksumSha256: string;
    expectedOrigin: string;
    contentType: string;
  }): Promise<{ ETag?: string; ChecksumSHA256?: string }>;
  appListMultipartParts(input: {
    key: string;
    uploadId: string;
  }): Promise<{
    isTruncated: boolean;
    bucket?: string;
    key?: string;
    uploadId?: string;
    checksumAlgorithm?: string;
    checksumType?: string;
    parts: ReadonlyArray<
      Readonly<{
        partNumber?: number;
        sizeBytes?: number;
        etag?: string;
        checksumSha256?: string;
      }>
    >;
  }>;
  appCompleteMultipartUpload(input: {
    key: string;
    uploadId: string;
    expectedSizeBytes: number;
    parts: readonly Readonly<{
      partNumber: number;
      etag: string;
      checksumSha256: string;
    }>[];
  }): Promise<
    StableObject & { ChecksumSHA256?: string; ChecksumType?: string }
  >;
  appAbortMultipartUpload(input: MultipartUploadTarget): Promise<void>;
  appListObjects(input: { prefix: string }): Promise<unknown>;
  appListObjectVersions(input: { prefix: string }): Promise<unknown>;
  appDeleteObject(input: {
    key: string;
    versionId?: string;
    expectedEtag?: string;
  }): Promise<unknown>;
  getExactObjectTags(input: {
    key: string;
    versionId: string;
  }): Promise<
    readonly Readonly<{ key?: string; value?: string }>[]
  >;
  exactVersionExists(input: {
    key: string;
    versionId: string;
  }): Promise<boolean>;
  operatorGetObject(input: {
    key: string;
    versionId: string;
    expectedEtag: string;
  }): Promise<
    S3ObjectIntegrityMetadata & { body: AsyncIterable<Uint8Array> }
  >;
  operatorMultipartUploadExists(input: MultipartUploadTarget): Promise<boolean>;
  operatorObjectExists(input: { key: string }): Promise<boolean>;
  cleanupMultipartUploads(
    targets: readonly MultipartUploadTarget[],
  ): Promise<void>;
  cleanupExactKeys(keys: readonly string[]): Promise<void>;
  isAuthorizationDenied(error: unknown): boolean;
}>;

export type S3AppPrincipalContractResult = Readonly<{
  bucket: string;
  canaryId: string;
  incompleteMultipartAbortDays: number;
  browserUploadOriginCount: number;
  required: Readonly<{
    incomingWriteAndHead: true;
    assetVersionRead: true;
    privacyExportLifecycle: true;
    incompleteMultipartLifecycle: true;
    browserUploadCors: true;
    multipartWriteListComplete: true;
    multipartAbort: true;
  }>;
  denied: Readonly<{
    objectListing: true;
    versionListing: true;
    objectCopy: true;
    tenantAssetWrite: true;
    unversionedAssetDelete: true;
    assetVersionDelete: true;
    incomingVersionDelete: true;
    unversionedPrivacyDelete: true;
  }>;
  cleanupVerified: true;
}>;

export class S3AppPrincipalContractError extends Error {
  readonly code:
    | "bucket_confirmation_mismatch"
    | "invalid_canary"
    | "versioning_not_enabled"
    | "privacy_export_lifecycle_invalid"
    | "multipart_lifecycle_invalid"
    | "browser_upload_cors_invalid"
    | "required_operation_failed"
    | "integrity_verification_failed"
    | "forbidden_operation_allowed"
    | "forbidden_operation_not_denied"
    | "cleanup_failed"
    | "preflight_and_cleanup_failed";
  readonly operation: string | null;
  readonly canaryId: string | null;

  constructor(
    code: S3AppPrincipalContractError["code"],
    message: string,
    options: { operation?: string; canaryId?: string } = {},
  ) {
    super(message);
    this.name = "S3AppPrincipalContractError";
    this.code = code;
    this.operation = options.operation ?? null;
    this.canaryId = options.canaryId ?? null;
  }
}

function defaultCanary(): Canary {
  return {
    id: randomUUID(),
    organizationId: randomUUID(),
    assetId: randomUUID(),
    privacyRequestId: randomUUID(),
    privacyArtifactId: randomUUID(),
    body: randomBytes(64),
  };
}

function validateCanary(canary: Canary) {
  if (
    ![
      canary.id,
      canary.organizationId,
      canary.assetId,
      canary.privacyRequestId,
      canary.privacyArtifactId,
    ].every((value) => UUID_PATTERN.test(value)) ||
    !(canary.body instanceof Uint8Array) ||
    canary.body.byteLength < 32 ||
    canary.body.byteLength > 4_096
  ) {
    throw new S3AppPrincipalContractError(
      "invalid_canary",
      "The app-principal S3 canary is invalid.",
    );
  }
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function safePrimaryError(error: unknown, canaryId: string) {
  if (error instanceof S3AppPrincipalContractError) return error;
  return new S3AppPrincipalContractError(
    "required_operation_failed",
    "A required app-principal S3 operation failed.",
    { canaryId },
  );
}

async function requiredOperation<T>(
  operation: string,
  canaryId: string,
  callback: () => Promise<T>,
) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof S3AppPrincipalContractError) throw error;
    throw new S3AppPrincipalContractError(
      "required_operation_failed",
      "A required app-principal S3 operation failed.",
      { operation, canaryId },
    );
  }
}

async function requireEnabledVersioning(
  adapter: S3AppPrincipalContractAdapter,
  operation: string,
  canaryId: string,
) {
  const status = await requiredOperation(
    `${operation}_versioning`,
    canaryId,
    () => adapter.getBucketVersioning(),
  );
  if (status !== "Enabled") {
    throw new S3AppPrincipalContractError(
      "versioning_not_enabled",
      "The S3 bucket versioning status is not exactly Enabled.",
      { operation: `${operation}_versioning`, canaryId },
    );
  }
}

function stableObject(
  value: StableObject,
  operation: string,
  canaryId: string,
) {
  try {
    return {
      versionId: requireS3VersionId(value.VersionId),
      etag: normalizeS3Etag(value.ETag),
    };
  } catch {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "A required S3 object has no immutable identity.",
      { operation, canaryId },
    );
  }
}

function multipartUploadId(
  value: string | undefined,
  operation: string,
  canaryId: string,
) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 1_024) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "A required S3 multipart upload has no valid identity.",
      { operation, canaryId },
    );
  }
  return normalized;
}

function verifyMultipartCreateResponse(
  value: {
    Bucket?: string;
    Key?: string;
    UploadId?: string;
    ChecksumAlgorithm?: string;
    ChecksumType?: string;
  },
  expected: { bucket: string; key: string },
  operation: string,
  canaryId: string,
) {
  if (
    value.Bucket !== expected.bucket ||
    value.Key !== expected.key ||
    value.ChecksumAlgorithm !== "SHA256" ||
    value.ChecksumType !== "COMPOSITE"
  ) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The S3 provider did not accept the multipart checksum contract.",
      { operation, canaryId },
    );
  }
  return multipartUploadId(value.UploadId, operation, canaryId);
}

function multipartPartIdentity(
  value: { ETag?: string; ChecksumSHA256?: string },
  expectedChecksum: string,
  operation: string,
  canaryId: string,
) {
  try {
    const etag = normalizeS3Etag(value.ETag);
    if (value.ChecksumSHA256 !== expectedChecksum) throw new Error("checksum");
    return { etag, checksumSha256: expectedChecksum };
  } catch {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "A required S3 multipart part has invalid integrity evidence.",
      { operation, canaryId },
    );
  }
}

function verifyObject(
  value: S3ObjectIntegrityMetadata,
  expected: {
    versionId: string;
    etag: string;
    sizeBytes: number;
    mimeType: string;
    metadata: Readonly<Record<string, string>>;
  },
  operation: string,
  canaryId: string,
) {
  try {
    verifyS3ObjectIntegrity(value, expected);
  } catch (error) {
    if (error instanceof S3ObjectIntegrityError) {
      throw new S3AppPrincipalContractError(
        "integrity_verification_failed",
        "A required S3 object failed immutable integrity verification.",
        { operation, canaryId },
      );
    }
    throw error;
  }
}

async function verifyBody(
  body: AsyncIterable<Uint8Array>,
  expected: Uint8Array,
  operation: string,
  canaryId: string,
) {
  const iterator = body[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let completed = false;
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        completed = true;
        break;
      }
      if (!(next.value instanceof Uint8Array)) throw new Error("invalid_chunk");
      length += next.value.byteLength;
      if (length > expected.byteLength) throw new Error("oversized_body");
      chunks.push(next.value);
    }
    const received = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    if (
      received.byteLength !== expected.byteLength ||
      sha256(received) !== sha256(expected)
    ) {
      throw new Error("body_mismatch");
    }
  } catch {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "A required S3 object body failed integrity verification.",
      { operation, canaryId },
    );
  } finally {
    if (!completed) await iterator.return?.();
  }
}

async function forbiddenOperation(
  adapter: S3AppPrincipalContractAdapter,
  operation: string,
  canaryId: string,
  callback: () => Promise<unknown>,
) {
  try {
    await callback();
  } catch (error) {
    if (adapter.isAuthorizationDenied(error)) return;
    throw new S3AppPrincipalContractError(
      "forbidden_operation_not_denied",
      "A forbidden app-principal S3 operation did not fail with an authorization denial.",
      { operation, canaryId },
    );
  }
  throw new S3AppPrincipalContractError(
    "forbidden_operation_allowed",
    "The app-principal can perform a forbidden S3 operation.",
    { operation, canaryId },
  );
}

async function executeMultipartContract(
  adapter: S3AppPrincipalContractAdapter,
  canary: Canary,
  completeKey: string,
  abortKey: string,
  expectedOrigins: readonly string[],
  activeUploads: MultipartUploadTarget[],
) {
  const parts = createS3MultipartCanaryParts(canary.body);
  const completeBody = joinS3MultipartCanaryParts(parts);
  const metadata = {
    "asset-id": canary.assetId,
    "organization-id": canary.organizationId,
  };

  await requireEnabledVersioning(adapter, "multipart_create", canary.id);
  const created = await requiredOperation("multipart_create", canary.id, () =>
    adapter.appCreateMultipartUpload({
      key: completeKey,
      contentType: ASSET_MIME_TYPE,
      metadata,
    }),
  );
  const uploadId = verifyMultipartCreateResponse(
    created,
    { bucket: adapter.bucket, key: completeKey },
    "multipart_create",
    canary.id,
  );
  activeUploads.push({ key: completeKey, uploadId });
  const completedParts = [] as Array<{
    partNumber: number;
    etag: string;
    checksumSha256: string;
  }>;
  for (const part of parts) {
    const partInput = { key: completeKey, uploadId, ...part };
    let uploadedIdentity:
      | { etag: string; checksumSha256: string }
      | undefined;
    if (part.partNumber === parts.length) {
      for (const expectedOrigin of expectedOrigins) {
        await requireEnabledVersioning(
          adapter,
          `multipart_browser_upload_part_${part.partNumber}`,
          canary.id,
        );
        const uploaded = await requiredOperation(
          `multipart_browser_upload_part_${part.partNumber}`,
          canary.id,
          () =>
            adapter.appBrowserUploadPart({
              ...partInput,
              expectedOrigin,
              contentType: "video/mp4",
            }),
        );
        uploadedIdentity = multipartPartIdentity(
          uploaded,
          part.checksumSha256,
          `multipart_browser_upload_part_${part.partNumber}`,
          canary.id,
        );
      }
    } else {
      await requireEnabledVersioning(
        adapter,
        `multipart_upload_part_${part.partNumber}`,
        canary.id,
      );
      const uploaded = await requiredOperation(
        `multipart_upload_part_${part.partNumber}`,
        canary.id,
        () => adapter.appUploadPart(partInput),
      );
      uploadedIdentity = multipartPartIdentity(
        uploaded,
        part.checksumSha256,
        `multipart_upload_part_${part.partNumber}`,
        canary.id,
      );
    }
    if (!uploadedIdentity) {
      throw new S3AppPrincipalContractError(
        "integrity_verification_failed",
        "The S3 browser multipart upload returned no part evidence.",
        { operation: "multipart_browser_upload", canaryId: canary.id },
      );
    }
    completedParts.push({
      partNumber: part.partNumber,
      ...uploadedIdentity,
    });
  }
  const listed = await requiredOperation("multipart_list_parts", canary.id, () =>
    adapter.appListMultipartParts({ key: completeKey, uploadId }),
  );
  if (
    listed.isTruncated ||
    listed.bucket !== adapter.bucket ||
    listed.key !== completeKey ||
    listed.uploadId !== uploadId ||
    listed.checksumAlgorithm !== "SHA256" ||
    listed.checksumType !== "COMPOSITE" ||
    listed.parts.length !== parts.length
  ) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The S3 multipart part inventory is incomplete.",
      { operation: "multipart_list_parts", canaryId: canary.id },
    );
  }
  for (const [index, listedPart] of listed.parts.entries()) {
    const expected = parts[index];
    const completed = completedParts[index];
    let etag: string;
    try {
      etag = normalizeS3Etag(listedPart.etag);
    } catch {
      throw new S3AppPrincipalContractError(
        "integrity_verification_failed",
        "The S3 multipart part inventory contains an invalid ETag.",
        { operation: "multipart_list_parts", canaryId: canary.id },
      );
    }
    if (
      !expected ||
      !completed ||
      listedPart.partNumber !== expected.partNumber ||
      listedPart.sizeBytes !== expected.body.byteLength ||
      listedPart.checksumSha256 !== expected.checksumSha256 ||
      etag !== completed.etag
    ) {
      throw new S3AppPrincipalContractError(
        "integrity_verification_failed",
        "The S3 multipart part inventory failed integrity verification.",
        { operation: "multipart_list_parts", canaryId: canary.id },
      );
    }
  }
  await requireEnabledVersioning(adapter, "multipart_complete", canary.id);
  const expectedCompositeChecksum = compositeS3MultipartSha256(completedParts);
  const completed = await requiredOperation(
    "multipart_complete",
    canary.id,
    () =>
      adapter.appCompleteMultipartUpload({
        key: completeKey,
        uploadId,
        expectedSizeBytes: completeBody.byteLength,
        parts: completedParts,
      }),
  );
  if (
    completed.ChecksumType !== "COMPOSITE" ||
    completed.ChecksumSHA256 !== expectedCompositeChecksum
  ) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The completed S3 multipart object has invalid checksum evidence.",
      { operation: "multipart_complete", canaryId: canary.id },
    );
  }
  const completedObject = stableObject(
    completed,
    "multipart_complete",
    canary.id,
  );
  const completeHead = await requiredOperation(
    "multipart_complete_head",
    canary.id,
    () =>
      adapter.appHeadObject({
        key: completeKey,
        versionId: completedObject.versionId,
        checksumMode: "ENABLED",
      }),
  );
  verifyObject(
    completeHead,
    {
      ...completedObject,
      sizeBytes: completeBody.byteLength,
      mimeType: ASSET_MIME_TYPE,
      metadata,
    },
    "multipart_complete_head",
    canary.id,
  );
  if (
    completeHead.ChecksumType !== "COMPOSITE" ||
    completeHead.ChecksumSHA256 !== expectedCompositeChecksum
  ) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The S3 multipart object checksum changed after completion.",
      { operation: "multipart_complete_head", canaryId: canary.id },
    );
  }
  const completeGet = await requiredOperation(
    "operator_verify_multipart_sha256",
    canary.id,
    () =>
      adapter.operatorGetObject({
        key: completeKey,
        versionId: completedObject.versionId,
        expectedEtag: completedObject.etag,
      }),
  );
  await verifyBody(
    completeGet.body,
    completeBody,
    "operator_verify_multipart_sha256",
    canary.id,
  );

  await requireEnabledVersioning(adapter, "multipart_abort_create", canary.id);
  const abortCreated = await requiredOperation(
    "multipart_abort_create",
    canary.id,
    () =>
      adapter.appCreateMultipartUpload({
        key: abortKey,
        contentType: ASSET_MIME_TYPE,
        metadata,
      }),
  );
  const abortUploadId = verifyMultipartCreateResponse(
    abortCreated,
    { bucket: adapter.bucket, key: abortKey },
    "multipart_abort_create",
    canary.id,
  );
  activeUploads.push({ key: abortKey, uploadId: abortUploadId });
  await requireEnabledVersioning(adapter, "multipart_abort_part", canary.id);
  await requiredOperation("multipart_abort_part", canary.id, () =>
    adapter.appUploadPart({
      key: abortKey,
      uploadId: abortUploadId,
      ...parts[0],
    }),
  );
  await requireEnabledVersioning(adapter, "multipart_abort", canary.id);
  await requiredOperation("multipart_abort", canary.id, () =>
    adapter.appAbortMultipartUpload({ key: abortKey, uploadId: abortUploadId }),
  );
  const [uploadExists, objectExists] = await Promise.all([
    requiredOperation("operator_verify_multipart_abort", canary.id, () =>
      adapter.operatorMultipartUploadExists({
        key: abortKey,
        uploadId: abortUploadId,
      }),
    ),
    requiredOperation("operator_verify_multipart_abort_object", canary.id, () =>
      adapter.operatorObjectExists({ key: abortKey }),
    ),
  ]);
  if (uploadExists || objectExists) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The aborted S3 multipart canary is still present.",
      { operation: "operator_verify_multipart_abort", canaryId: canary.id },
    );
  }
}

async function executeContract(
  adapter: S3AppPrincipalContractAdapter,
  canary: Canary,
  keys: {
    incoming: string;
    ready: string;
    copyTarget: string;
    tenantWriteTarget: string;
    privacy: string;
    multipartComplete: string;
    multipartAbort: string;
  },
  expectedOrigins: readonly string[],
  multipartUploadTtlSeconds: number,
  activeUploads: MultipartUploadTarget[],
) {
  const lifecycleRules = await requiredOperation(
    "privacy_lifecycle_configuration",
    canary.id,
    () => adapter.getBucketLifecycleConfiguration(),
  );
  if (!hasRequiredS3PrivacyExportLifecycle(lifecycleRules)) {
    throw new S3AppPrincipalContractError(
      "privacy_export_lifecycle_invalid",
      "The S3 privacy-export lifecycle contract is missing or invalid.",
      { operation: "privacy_lifecycle_configuration", canaryId: canary.id },
    );
  }
  const incompleteMultipartAbortDays =
    resolveS3IncompleteMultipartUploadLifecycleDays(
      lifecycleRules,
      multipartUploadTtlSeconds,
    );
  if (incompleteMultipartAbortDays === null) {
    throw new S3AppPrincipalContractError(
      "multipart_lifecycle_invalid",
      "The incomplete-multipart-upload lifecycle contract is missing or invalid.",
      { operation: "multipart_lifecycle_configuration", canaryId: canary.id },
    );
  }
  const corsRules = await requiredOperation(
    "browser_upload_cors_configuration",
    canary.id,
    () => adapter.getBucketCorsConfiguration(),
  );
  if (!hasRequiredS3BrowserUploadCorsInventory(corsRules, expectedOrigins)) {
    throw new S3AppPrincipalContractError(
      "browser_upload_cors_invalid",
      "The S3 browser upload CORS contract is missing or invalid.",
      { operation: "browser_upload_cors_configuration", canaryId: canary.id },
    );
  }

  await executeMultipartContract(
    adapter,
    canary,
    keys.multipartComplete,
    keys.multipartAbort,
    expectedOrigins,
    activeUploads,
  );

  const digest = sha256(canary.body);
  const assetMetadata = {
    "asset-id": canary.assetId,
    "organization-id": canary.organizationId,
  };
  const readyMetadata = { ...assetMetadata, sha256: digest };

  await requireEnabledVersioning(adapter, "operator_seed_ready", canary.id);
  const seededReady = stableObject(
    await requiredOperation("operator_seed_ready", canary.id, () =>
      adapter.seedObject({
        key: keys.ready,
        body: canary.body,
        contentType: ASSET_MIME_TYPE,
        metadata: readyMetadata,
        ifNoneMatch: "*",
      }),
    ),
    "operator_seed_ready",
    canary.id,
  );

  await requireEnabledVersioning(adapter, "incoming_put", canary.id);
  const incoming = stableObject(
    await requiredOperation("incoming_put", canary.id, () =>
      adapter.appPutObject({
        key: keys.incoming,
        body: canary.body,
        contentType: ASSET_MIME_TYPE,
        metadata: assetMetadata,
        ifNoneMatch: "*",
      }),
    ),
    "incoming_put",
    canary.id,
  );
  const incomingHead = await requiredOperation(
    "incoming_head",
    canary.id,
    () => adapter.appHeadObject({ key: keys.incoming }),
  );
  verifyObject(
    incomingHead,
    {
      ...incoming,
      sizeBytes: canary.body.byteLength,
      mimeType: ASSET_MIME_TYPE,
      metadata: assetMetadata,
    },
    "incoming_head",
    canary.id,
  );

  const readyHead = await requiredOperation("asset_version_head", canary.id, () =>
    adapter.appHeadObject({
      key: keys.ready,
      versionId: seededReady.versionId,
    }),
  );
  verifyObject(
    readyHead,
    {
      ...seededReady,
      sizeBytes: canary.body.byteLength,
      mimeType: ASSET_MIME_TYPE,
      metadata: readyMetadata,
    },
    "asset_version_head",
    canary.id,
  );
  const readyGet = await requiredOperation("asset_version_get", canary.id, () =>
    adapter.appGetObject({
      key: keys.ready,
      versionId: seededReady.versionId,
      expectedEtag: seededReady.etag,
    }),
  );
  verifyObject(
    readyGet,
    {
      ...seededReady,
      sizeBytes: canary.body.byteLength,
      mimeType: ASSET_MIME_TYPE,
      metadata: readyMetadata,
    },
    "asset_version_get",
    canary.id,
  );
  await verifyBody(
    readyGet.body,
    canary.body,
    "asset_version_get",
    canary.id,
  );

  await requireEnabledVersioning(adapter, "privacy_put", canary.id);
  const privacy = stableObject(
    await requiredOperation("privacy_put", canary.id, () =>
      adapter.appPutObject({
        key: keys.privacy,
        body: canary.body,
        contentType: PRIVACY_MIME_TYPE,
        metadata: {},
        tagging: S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING,
        ifNoneMatch: "*",
      }),
    ),
    "privacy_put",
    canary.id,
  );
  const privacyTags = await requiredOperation(
    "operator_verify_privacy_tags",
    canary.id,
    () =>
      adapter.getExactObjectTags({
        key: keys.privacy,
        versionId: privacy.versionId,
      }),
  );
  if (
    !privacyTags.some(
      (tag) =>
        tag.key === S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY &&
        tag.value === S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
    )
  ) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The privacy-export version is missing its mandatory lifecycle tag.",
      { operation: "operator_verify_privacy_tags", canaryId: canary.id },
    );
  }
  const privacyHead = await requiredOperation("privacy_version_head", canary.id, () =>
    adapter.appHeadObject({ key: keys.privacy, versionId: privacy.versionId }),
  );
  verifyObject(
    privacyHead,
    {
      ...privacy,
      sizeBytes: canary.body.byteLength,
      mimeType: PRIVACY_MIME_TYPE,
      metadata: {},
    },
    "privacy_version_head",
    canary.id,
  );
  const privacyGet = await requiredOperation("privacy_version_get", canary.id, () =>
    adapter.appGetObject({
      key: keys.privacy,
      versionId: privacy.versionId,
      expectedEtag: privacy.etag,
    }),
  );
  verifyObject(
    privacyGet,
    {
      ...privacy,
      sizeBytes: canary.body.byteLength,
      mimeType: PRIVACY_MIME_TYPE,
      metadata: {},
    },
    "privacy_version_get",
    canary.id,
  );
  await verifyBody(
    privacyGet.body,
    canary.body,
    "privacy_version_get",
    canary.id,
  );
  await requireEnabledVersioning(adapter, "privacy_version_delete", canary.id);
  await requiredOperation("privacy_version_delete", canary.id, () =>
    adapter.appDeleteObject({
      key: keys.privacy,
      versionId: privacy.versionId,
      expectedEtag: privacy.etag,
    }),
  );
  const deletedPrivacyVersionExists = await requiredOperation(
    "operator_verify_privacy_delete",
    canary.id,
    () => adapter.exactVersionExists({
      key: keys.privacy,
      versionId: privacy.versionId,
    }),
  );
  if (deletedPrivacyVersionExists) {
    throw new S3AppPrincipalContractError(
      "integrity_verification_failed",
      "The deleted privacy-export version is still present.",
      { operation: "privacy_version_delete", canaryId: canary.id },
    );
  }

  await forbiddenOperation(adapter, "list_objects", canary.id, () =>
    adapter.appListObjects({ prefix: `tenants/${canary.organizationId}/` }),
  );
  await forbiddenOperation(adapter, "list_object_versions", canary.id, () =>
    adapter.appListObjectVersions({
      prefix: `tenants/${canary.organizationId}/`,
    }),
  );
  await requireEnabledVersioning(adapter, "copy_object", canary.id);
  await forbiddenOperation(adapter, "copy_object", canary.id, () =>
    adapter.appCopyObject({
      sourceKey: keys.ready,
      sourceVersionId: seededReady.versionId,
      sourceEtag: seededReady.etag,
      targetKey: keys.copyTarget,
      contentType: ASSET_MIME_TYPE,
      metadata: assetMetadata,
    }),
  );
  await requireEnabledVersioning(adapter, "tenant_asset_put", canary.id);
  await forbiddenOperation(adapter, "tenant_asset_put", canary.id, () =>
    adapter.appPutObject({
      key: keys.tenantWriteTarget,
      body: canary.body,
      contentType: ASSET_MIME_TYPE,
      metadata: assetMetadata,
      ifNoneMatch: "*",
    }),
  );
  await requireEnabledVersioning(adapter, "asset_delete", canary.id);
  await forbiddenOperation(adapter, "asset_delete", canary.id, () =>
    adapter.appDeleteObject({ key: keys.ready }),
  );
  await requireEnabledVersioning(adapter, "asset_version_delete", canary.id);
  await forbiddenOperation(adapter, "asset_version_delete", canary.id, () =>
    adapter.appDeleteObject({
      key: keys.ready,
      versionId: seededReady.versionId,
      expectedEtag: seededReady.etag,
    }),
  );
  await requireEnabledVersioning(adapter, "incoming_version_delete", canary.id);
  await forbiddenOperation(adapter, "incoming_version_delete", canary.id, () =>
    adapter.appDeleteObject({
      key: keys.incoming,
      versionId: incoming.versionId,
      expectedEtag: incoming.etag,
    }),
  );
  await requireEnabledVersioning(adapter, "privacy_unversioned_delete", canary.id);
  await forbiddenOperation(adapter, "privacy_unversioned_delete", canary.id, () =>
    adapter.appDeleteObject({ key: keys.privacy }),
  );
  return incompleteMultipartAbortDays;
}

export async function runS3AppPrincipalContractPreflight(input: {
  adapter: S3AppPrincipalContractAdapter;
  confirmBucket: string;
  expectedOrigins: readonly string[];
  multipartUploadTtlSeconds: number;
  createCanary?: () => Canary;
}): Promise<S3AppPrincipalContractResult> {
  if (!input.confirmBucket || input.confirmBucket !== input.adapter.bucket) {
    throw new S3AppPrincipalContractError(
      "bucket_confirmation_mismatch",
      "The explicit bucket confirmation does not match the configured bucket.",
    );
  }
  let expectedOrigins: readonly string[];
  try {
    expectedOrigins = normalizeS3BrowserUploadOrigins(input.expectedOrigins);
  } catch (error) {
    if (!(error instanceof S3BrowserUploadOriginInventoryError)) throw error;
    throw new S3AppPrincipalContractError(
      "browser_upload_cors_invalid",
      "The S3 browser upload origin inventory is invalid.",
    );
  }
  const canary = (input.createCanary ?? defaultCanary)();
  validateCanary(canary);
  const fileName = `q-academy-app-principal-canary-${canary.id}.bin`;
  const assetRoot = `tenants/${canary.organizationId}/assets/${canary.assetId}`;
  const keys = {
    incoming: `incoming/${assetRoot}/${fileName}`,
    ready: `${assetRoot}/${fileName}`,
    copyTarget: `incoming/${assetRoot}/copy-${fileName}`,
    tenantWriteTarget: `${assetRoot}/write-${fileName}`,
    privacy:
      `tenants/${canary.organizationId}/privacy-exports/` +
      `${canary.privacyRequestId}/${canary.privacyArtifactId}.enc`,
    multipartComplete: `incoming/${assetRoot}/multipart-${fileName}`,
    multipartAbort: `incoming/${assetRoot}/abort-${fileName}`,
  };
  const exactKeys = Object.values(keys);
  const activeUploads: MultipartUploadTarget[] = [];
  let incompleteMultipartAbortDays: number | null = null;
  let primaryError: S3AppPrincipalContractError | null = null;
  try {
    incompleteMultipartAbortDays = await executeContract(
      input.adapter,
      canary,
      keys,
      expectedOrigins,
      input.multipartUploadTtlSeconds,
      activeUploads,
    );
  } catch (error) {
    primaryError = safePrimaryError(error, canary.id);
  }

  let cleanupFailed = false;
  try {
    await input.adapter.cleanupMultipartUploads(activeUploads);
    await input.adapter.cleanupExactKeys(exactKeys);
  } catch {
    cleanupFailed = true;
  }
  if (primaryError && cleanupFailed) {
    throw new S3AppPrincipalContractError(
      "preflight_and_cleanup_failed",
      "The app-principal S3 contract and mandatory canary cleanup both failed.",
      { operation: primaryError.operation ?? undefined, canaryId: canary.id },
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupFailed) {
    throw new S3AppPrincipalContractError(
      "cleanup_failed",
      "The app-principal S3 canary cleanup could not be verified.",
      { canaryId: canary.id },
    );
  }
  if (incompleteMultipartAbortDays === null) {
    throw new S3AppPrincipalContractError(
      "multipart_lifecycle_invalid",
      "The incomplete-multipart-upload lifecycle contract was not verified.",
      { canaryId: canary.id },
    );
  }
  return {
    bucket: input.adapter.bucket,
    canaryId: canary.id,
    incompleteMultipartAbortDays,
    browserUploadOriginCount: expectedOrigins.length,
    required: {
      incomingWriteAndHead: true,
      assetVersionRead: true,
      privacyExportLifecycle: true,
      incompleteMultipartLifecycle: true,
      browserUploadCors: true,
      multipartWriteListComplete: true,
      multipartAbort: true,
    },
    denied: {
      objectListing: true,
      versionListing: true,
      objectCopy: true,
      tenantAssetWrite: true,
      unversionedAssetDelete: true,
      assetVersionDelete: true,
      incomingVersionDelete: true,
      unversionedPrivacyDelete: true,
    },
    cleanupVerified: true,
  };
}
