import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

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
  S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  type S3LifecycleRuleContract,
} from "./s3-privacy-export-lifecycle";

export const S3_PROVIDER_CANARY_ROOT =
  "q-academy-provider-contract-canary/v1";
const S3_PROVIDER_CLEANUP_MAX_PAGES = 16;

type ObjectVersionTarget = Readonly<{ key: string; versionId: string }>;
type MultipartUploadTarget = Readonly<{ key: string; uploadId: string }>;

export type S3ProviderContractAdapter = Readonly<{
  bucket: string;
  getBucketVersioning(): Promise<string | undefined>;
  getBucketLifecycleConfiguration(): Promise<
    readonly S3LifecycleRuleContract[]
  >;
  getBucketCorsConfiguration(): Promise<
    readonly S3BrowserUploadCorsRuleContract[]
  >;
  putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
    metadata: Readonly<Record<string, string>>;
    ifNoneMatch: "*";
  }): Promise<{ VersionId?: string; ETag?: string }>;
  headObject(input: {
    key: string;
    versionId: string;
    checksumMode?: "ENABLED";
  }): Promise<
    S3ObjectIntegrityMetadata & {
      ChecksumSHA256?: string;
      ChecksumType?: string;
    }
  >;
  getObject(input: {
    key: string;
    versionId: string;
    expectedEtag: string;
  }): Promise<
    S3ObjectIntegrityMetadata & {
      body: AsyncIterable<Uint8Array>;
    }
  >;
  copyObject(input: {
    sourceKey: string;
    sourceVersionId: string;
    sourceEtag: string;
    targetKey: string;
    contentType: string;
    metadata: Readonly<Record<string, string>>;
  }): Promise<{ VersionId?: string; ETag?: string }>;
  createMultipartUpload(input: {
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
  uploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    checksumSha256: string;
  }): Promise<{ ETag?: string; ChecksumSHA256?: string }>;
  browserUploadPart(input: {
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array;
    checksumSha256: string;
    expectedOrigin: string;
    contentType: string;
  }): Promise<{ ETag?: string; ChecksumSHA256?: string }>;
  listMultipartParts(input: {
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
  completeMultipartUpload(input: {
    key: string;
    uploadId: string;
    expectedSizeBytes: number;
    parts: readonly Readonly<{
      partNumber: number;
      etag: string;
      checksumSha256: string;
    }>[];
  }): Promise<{
    VersionId?: string;
    ETag?: string;
    ChecksumSHA256?: string;
    ChecksumType?: string;
  }>;
  abortMultipartUpload(input: MultipartUploadTarget): Promise<void>;
  multipartUploadExists(input: MultipartUploadTarget): Promise<boolean>;
  objectExists(input: { key: string }): Promise<boolean>;
  cleanupMultipartUploads(
    targets: readonly MultipartUploadTarget[],
  ): Promise<void>;
  deleteObject(input: {
    key: string;
  }): Promise<{ DeleteMarker?: boolean; VersionId?: string }>;
  listObjectVersions(input: {
    prefix: string;
    keyMarker?: string;
    versionIdMarker?: string;
  }): Promise<{
    isTruncated: boolean;
    nextKeyMarker?: string;
    nextVersionIdMarker?: string;
    versions: ReadonlyArray<Readonly<{ key?: string; versionId?: string }>>;
    deleteMarkers: ReadonlyArray<
      Readonly<{ key?: string; versionId?: string }>
    >;
  }>;
  deleteObjectVersions(
    targets: readonly ObjectVersionTarget[],
  ): Promise<{ errorCount: number }>;
}>;

export type S3ProviderContractResult = Readonly<{
  bucket: string;
  canaryPrefix: string;
  versioningStatus: "Enabled";
  privacyExportExpirationDays: typeof S3_PRIVACY_EXPORT_LIFECYCLE_DAYS;
  privacyExportLifecycleVerified: true;
  incompleteMultipartAbortDays: number;
  incompleteMultipartLifecycleVerified: true;
  browserUploadCorsVerified: true;
  browserUploadOriginCount: number;
  multipartUploadVerified: true;
  multipartAbortVerified: true;
  sourceVersionVerified: true;
  copiedVersionVerified: true;
  cleanupVerified: true;
}>;

export class S3ProviderContractError extends Error {
  readonly code:
    | "bucket_confirmation_mismatch"
    | "invalid_canary"
    | "versioning_not_enabled"
    | "privacy_export_lifecycle_invalid"
    | "multipart_lifecycle_invalid"
    | "browser_upload_cors_invalid"
    | "provider_operation_failed"
    | "integrity_verification_failed"
    | "cleanup_failed"
    | "preflight_and_cleanup_failed";
  readonly canaryPrefix: string | null;

  constructor(
    code: S3ProviderContractError["code"],
    message: string,
    canaryPrefix: string | null = null,
  ) {
    super(message);
    this.name = "S3ProviderContractError";
    this.code = code;
    this.canaryPrefix = canaryPrefix;
  }
}

type Canary = Readonly<{ id: string; body: Uint8Array }>;

function defaultCanary(): Canary {
  return { id: randomUUID(), body: randomBytes(64) };
}

function validateCanary(canary: Canary) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      canary.id,
    ) ||
    !(canary.body instanceof Uint8Array) ||
    canary.body.byteLength < 32 ||
    canary.body.byteLength > 4_096
  ) {
    throw new S3ProviderContractError(
      "invalid_canary",
      "The S3 provider canary identity is invalid.",
    );
  }
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function sameDigest(left: string, right: string) {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return (
    leftBytes.byteLength === 32 &&
    rightBytes.byteLength === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function safeError(error: unknown, canaryPrefix: string) {
  if (error instanceof S3ProviderContractError) {
    return new S3ProviderContractError(
      error.code,
      error.message,
      error.canaryPrefix ?? canaryPrefix,
    );
  }
  return new S3ProviderContractError(
    "provider_operation_failed",
    "The S3 provider rejected a required contract operation.",
    canaryPrefix,
  );
}

async function providerOperation<T>(
  operation: () => Promise<T>,
  canaryPrefix: string,
) {
  try {
    return await operation();
  } catch (error) {
    throw safeError(error, canaryPrefix);
  }
}

function stableObjectIdentity(
  object: { VersionId?: string; ETag?: string },
  canaryPrefix: string,
) {
  try {
    return {
      versionId: requireS3VersionId(object.VersionId),
      etag: normalizeS3Etag(object.ETag),
    };
  } catch {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider did not return an immutable object identity.",
      canaryPrefix,
    );
  }
}

function multipartUploadId(value: string | undefined, canaryPrefix: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 1_024) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned an invalid multipart upload identity.",
      canaryPrefix,
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
  canaryPrefix: string,
) {
  if (
    value.Bucket !== expected.bucket ||
    value.Key !== expected.key ||
    value.ChecksumAlgorithm !== "SHA256" ||
    value.ChecksumType !== "COMPOSITE"
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider did not accept the multipart checksum contract.",
      canaryPrefix,
    );
  }
  return multipartUploadId(value.UploadId, canaryPrefix);
}

function multipartPartIdentity(
  value: { ETag?: string; ChecksumSHA256?: string },
  expectedChecksum: string,
  canaryPrefix: string,
) {
  try {
    const etag = normalizeS3Etag(value.ETag);
    if (value.ChecksumSHA256 !== expectedChecksum) throw new Error("checksum");
    return { etag, checksumSha256: expectedChecksum };
  } catch {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned invalid multipart part integrity evidence.",
      canaryPrefix,
    );
  }
}

function verifyObject(
  object: S3ObjectIntegrityMetadata,
  expected: {
    versionId: string;
    etag: string;
    sizeBytes: number;
    mimeType: string;
    metadata: Readonly<Record<string, string>>;
  },
  canaryPrefix: string,
) {
  try {
    return verifyS3ObjectIntegrity(object, expected);
  } catch (error) {
    if (error instanceof S3ObjectIntegrityError) {
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 provider returned inconsistent object metadata.",
        canaryPrefix,
      );
    }
    throw error;
  }
}

async function verifyBody(
  body: AsyncIterable<Uint8Array>,
  expectedSizeBytes: number,
  expectedSha256: string,
  canaryPrefix: string,
) {
  const iterator = body[Symbol.asyncIterator]();
  const hash = createHash("sha256");
  let received = 0;
  let completed = false;
  try {
    while (true) {
      const chunk = await iterator.next();
      if (chunk.done) {
        completed = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw new Error("invalid_chunk");
      }
      received += chunk.value.byteLength;
      if (received > expectedSizeBytes) {
        throw new Error("oversized_body");
      }
      hash.update(chunk.value);
    }
  } catch {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned inconsistent object content.",
      canaryPrefix,
    );
  } finally {
    if (!completed) await iterator.return?.();
  }
  if (
    received !== expectedSizeBytes ||
    !sameDigest(hash.digest("hex"), expectedSha256)
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned inconsistent object content.",
      canaryPrefix,
    );
  }
}

async function listCanaryVersions(
  adapter: S3ProviderContractAdapter,
  canaryPrefix: string,
  allowedKeys: ReadonlySet<string>,
) {
  const targets = new Map<string, ObjectVersionTarget>();
  const deleteMarkers = new Map<string, ObjectVersionTarget>();
  const seenMarkers = new Set<string>();
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  for (
    let pageNumber = 0;
    pageNumber < S3_PROVIDER_CLEANUP_MAX_PAGES;
    pageNumber += 1
  ) {
    const marker = `${keyMarker ?? ""}\0${versionIdMarker ?? ""}`;
    if (seenMarkers.has(marker)) {
      throw new S3ProviderContractError(
        "cleanup_failed",
        "The S3 provider repeated a version-listing cursor.",
        canaryPrefix,
      );
    }
    seenMarkers.add(marker);
    const page = await providerOperation(
      () =>
        adapter.listObjectVersions({
          prefix: `${canaryPrefix}/`,
          keyMarker,
          versionIdMarker,
        }),
      canaryPrefix,
    );
    for (const [entryType, entries] of [
      ["version", page.versions],
      ["delete_marker", page.deleteMarkers],
    ] as const) {
      for (const entry of entries) {
        if (
          !entry.key ||
          !entry.versionId ||
          !allowedKeys.has(entry.key)
        ) {
          throw new S3ProviderContractError(
            "cleanup_failed",
            "The S3 provider returned an unexpected canary version.",
            canaryPrefix,
          );
        }
        targets.set(`${entry.key}\0${entry.versionId}`, {
          key: entry.key,
          versionId: entry.versionId,
        });
        if (entryType === "delete_marker") {
          deleteMarkers.set(`${entry.key}\0${entry.versionId}`, {
            key: entry.key,
            versionId: entry.versionId,
          });
        }
      }
    }
    if (!page.isTruncated) {
      return {
        targets: [...targets.values()],
        deleteMarkers: [...deleteMarkers.values()],
      };
    }
    if (!page.nextKeyMarker) {
      throw new S3ProviderContractError(
        "cleanup_failed",
        "The S3 provider omitted a required version-listing cursor.",
        canaryPrefix,
      );
    }
    keyMarker = page.nextKeyMarker;
    versionIdMarker = page.nextVersionIdMarker;
  }
  throw new S3ProviderContractError(
    "cleanup_failed",
    "The S3 provider version listing exceeded the safety limit.",
    canaryPrefix,
  );
}

async function cleanupCanary(
  adapter: S3ProviderContractAdapter,
  canaryPrefix: string,
  allowedKeys: ReadonlySet<string>,
) {
  for (const key of allowedKeys) {
    try {
      await adapter.deleteObject({ key });
    } catch {
      // Exact-version cleanup below remains authoritative.
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const listed = await listCanaryVersions(
      adapter,
      canaryPrefix,
      allowedKeys,
    );
    const targets = listed.targets;
    if (!targets.length) return;
    for (let offset = 0; offset < targets.length; offset += 1_000) {
      try {
        await adapter.deleteObjectVersions(targets.slice(offset, offset + 1_000));
      } catch {
        // A later listing verifies the result and retries remaining versions.
      }
    }
  }
  const remaining = await listCanaryVersions(
    adapter,
    canaryPrefix,
    allowedKeys,
  );
  if (remaining.targets.length > 0) {
    throw new S3ProviderContractError(
      "cleanup_failed",
      "The S3 provider did not remove every canary version and delete marker.",
      canaryPrefix,
    );
  }
}

async function executeMultipartContract(
  adapter: S3ProviderContractAdapter,
  canary: Canary,
  canaryPrefix: string,
  completeKey: string,
  abortKey: string,
  expectedOrigins: readonly string[],
  activeUploads: MultipartUploadTarget[],
) {
  const parts = createS3MultipartCanaryParts(canary.body);
  const completeBody = joinS3MultipartCanaryParts(parts);
  const completeMetadata = {
    "contract-version": "1",
    "canary-id": canary.id,
    "object-role": "multipart-complete",
    "content-sha256": sha256(completeBody),
  };
  const create = await providerOperation(
    () =>
      adapter.createMultipartUpload({
        key: completeKey,
        contentType: "application/octet-stream",
        metadata: completeMetadata,
      }),
    canaryPrefix,
  );
  const uploadId = verifyMultipartCreateResponse(
    create,
    { bucket: adapter.bucket, key: completeKey },
    canaryPrefix,
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
        const uploaded = await providerOperation(
          () =>
            adapter.browserUploadPart({
              ...partInput,
              expectedOrigin,
              contentType: "video/mp4",
            }),
          canaryPrefix,
        );
        uploadedIdentity = multipartPartIdentity(
          uploaded,
          part.checksumSha256,
          canaryPrefix,
        );
      }
    } else {
      const uploaded = await providerOperation(
        () => adapter.uploadPart(partInput),
        canaryPrefix,
      );
      uploadedIdentity = multipartPartIdentity(
        uploaded,
        part.checksumSha256,
        canaryPrefix,
      );
    }
    if (!uploadedIdentity) {
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 browser multipart upload returned no part evidence.",
        canaryPrefix,
      );
    }
    completedParts.push({
      partNumber: part.partNumber,
      ...uploadedIdentity,
    });
  }
  const listed = await providerOperation(
    () => adapter.listMultipartParts({ key: completeKey, uploadId }),
    canaryPrefix,
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
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned an incomplete multipart part inventory.",
      canaryPrefix,
    );
  }
  for (const [index, listedPart] of listed.parts.entries()) {
    const expected = parts[index];
    const completed = completedParts[index];
    let etag: string;
    try {
      etag = normalizeS3Etag(listedPart.etag);
    } catch {
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 provider returned invalid listed multipart part evidence.",
        canaryPrefix,
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
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 provider returned inconsistent listed multipart parts.",
        canaryPrefix,
      );
    }
  }
  const expectedCompositeChecksum = compositeS3MultipartSha256(completedParts);
  const completed = await providerOperation(
    () =>
      adapter.completeMultipartUpload({
        key: completeKey,
        uploadId,
        expectedSizeBytes: completeBody.byteLength,
        parts: completedParts,
      }),
    canaryPrefix,
  );
  if (
    completed.ChecksumType !== "COMPOSITE" ||
    completed.ChecksumSHA256 !== expectedCompositeChecksum
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The completed S3 multipart object has invalid checksum evidence.",
      canaryPrefix,
    );
  }
  const completedObject = stableObjectIdentity(completed, canaryPrefix);
  const completeHead = await providerOperation(
    () =>
      adapter.headObject({
        key: completeKey,
        versionId: completedObject.versionId,
        checksumMode: "ENABLED",
      }),
    canaryPrefix,
  );
  verifyObject(
    completeHead,
    {
      ...completedObject,
      sizeBytes: completeBody.byteLength,
      mimeType: "application/octet-stream",
      metadata: completeMetadata,
    },
    canaryPrefix,
  );
  if (
    completeHead.ChecksumType !== "COMPOSITE" ||
    completeHead.ChecksumSHA256 !== expectedCompositeChecksum
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 multipart object checksum changed after completion.",
      canaryPrefix,
    );
  }
  const completeGet = await providerOperation(
    () =>
      adapter.getObject({
        key: completeKey,
        versionId: completedObject.versionId,
        expectedEtag: completedObject.etag,
      }),
    canaryPrefix,
  );
  await verifyBody(
    completeGet.body,
    completeBody.byteLength,
    sha256(completeBody),
    canaryPrefix,
  );

  const abort = await providerOperation(
    () =>
      adapter.createMultipartUpload({
        key: abortKey,
        contentType: "application/octet-stream",
        metadata: {
          "contract-version": "1",
          "canary-id": canary.id,
          "object-role": "multipart-abort",
        },
      }),
    canaryPrefix,
  );
  const abortUploadId = verifyMultipartCreateResponse(
    abort,
    { bucket: adapter.bucket, key: abortKey },
    canaryPrefix,
  );
  activeUploads.push({ key: abortKey, uploadId: abortUploadId });
  await providerOperation(
    () =>
      adapter.uploadPart({
        key: abortKey,
        uploadId: abortUploadId,
        ...parts[0],
      }),
    canaryPrefix,
  );
  await providerOperation(
    () =>
      adapter.abortMultipartUpload({
        key: abortKey,
        uploadId: abortUploadId,
      }),
    canaryPrefix,
  );
  const [uploadExists, objectExists] = await Promise.all([
    providerOperation(
      () =>
        adapter.multipartUploadExists({
          key: abortKey,
          uploadId: abortUploadId,
        }),
      canaryPrefix,
    ),
    providerOperation(
      () => adapter.objectExists({ key: abortKey }),
      canaryPrefix,
    ),
  ]);
  if (uploadExists || objectExists) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The aborted S3 multipart canary is still present.",
      canaryPrefix,
    );
  }
}

async function executeContract(
  adapter: S3ProviderContractAdapter,
  canary: Canary,
  canaryPrefix: string,
  sourceKey: string,
  copyKey: string,
  multipartCompleteKey: string,
  multipartAbortKey: string,
  expectedOrigins: readonly string[],
  multipartUploadTtlSeconds: number,
  activeUploads: MultipartUploadTarget[],
) {
  const versioning = await providerOperation(
    () => adapter.getBucketVersioning(),
    canaryPrefix,
  );
  if (versioning !== "Enabled") {
    throw new S3ProviderContractError(
      "versioning_not_enabled",
      "The S3 bucket versioning status is not exactly Enabled.",
      canaryPrefix,
    );
  }

  const lifecycleRules = await providerOperation(
    () => adapter.getBucketLifecycleConfiguration(),
    canaryPrefix,
  );
  if (!hasRequiredS3PrivacyExportLifecycle(lifecycleRules)) {
    throw new S3ProviderContractError(
      "privacy_export_lifecycle_invalid",
      "The S3 privacy-export lifecycle contract is missing or invalid.",
      canaryPrefix,
    );
  }
  const incompleteMultipartAbortDays =
    resolveS3IncompleteMultipartUploadLifecycleDays(
      lifecycleRules,
      multipartUploadTtlSeconds,
    );
  if (incompleteMultipartAbortDays === null) {
    throw new S3ProviderContractError(
      "multipart_lifecycle_invalid",
      "The incomplete-multipart-upload lifecycle contract is missing or invalid.",
      canaryPrefix,
    );
  }
  const corsRules = await providerOperation(
    () => adapter.getBucketCorsConfiguration(),
    canaryPrefix,
  );
  if (!hasRequiredS3BrowserUploadCorsInventory(corsRules, expectedOrigins)) {
    throw new S3ProviderContractError(
      "browser_upload_cors_invalid",
      "The S3 browser upload CORS contract is missing or invalid.",
      canaryPrefix,
    );
  }

  const mimeType = "application/octet-stream";
  const contentSha256 = sha256(canary.body);
  const sourceMetadata = {
    "contract-version": "1",
    "canary-id": canary.id,
    "object-role": "source",
    "content-sha256": contentSha256,
  };
  const put = await providerOperation(
    () =>
      adapter.putObject({
        key: sourceKey,
        body: canary.body,
        contentType: mimeType,
        metadata: sourceMetadata,
        ifNoneMatch: "*",
      }),
    canaryPrefix,
  );
  const sourceIdentity = stableObjectIdentity(put, canaryPrefix);
  const sourceHead = await providerOperation(
    () =>
      adapter.headObject({
        key: sourceKey,
        versionId: sourceIdentity.versionId,
      }),
    canaryPrefix,
  );
  verifyObject(
    sourceHead,
    {
      ...sourceIdentity,
      sizeBytes: canary.body.byteLength,
      mimeType,
      metadata: sourceMetadata,
    },
    canaryPrefix,
  );
  const sourceGet = await providerOperation(
    () =>
      adapter.getObject({
        key: sourceKey,
        versionId: sourceIdentity.versionId,
        expectedEtag: sourceIdentity.etag,
      }),
    canaryPrefix,
  );
  verifyObject(
    sourceGet,
    {
      ...sourceIdentity,
      sizeBytes: canary.body.byteLength,
      mimeType,
      metadata: sourceMetadata,
    },
    canaryPrefix,
  );
  await verifyBody(
    sourceGet.body,
    canary.body.byteLength,
    contentSha256,
    canaryPrefix,
  );

  const copyMetadata = {
    "contract-version": "1",
    "canary-id": canary.id,
    "object-role": "copy",
    "content-sha256": contentSha256,
    "source-version-sha256": sha256(sourceIdentity.versionId),
  };
  const copied = await providerOperation(
    () =>
      adapter.copyObject({
        sourceKey,
        sourceVersionId: sourceIdentity.versionId,
        sourceEtag: sourceIdentity.etag,
        targetKey: copyKey,
        contentType: mimeType,
        metadata: copyMetadata,
      }),
    canaryPrefix,
  );
  const copyIdentity = stableObjectIdentity(copied, canaryPrefix);
  const copyHead = await providerOperation(
    () =>
      adapter.headObject({
        key: copyKey,
        versionId: copyIdentity.versionId,
      }),
    canaryPrefix,
  );
  verifyObject(
    copyHead,
    {
      ...copyIdentity,
      sizeBytes: canary.body.byteLength,
      mimeType,
      metadata: copyMetadata,
    },
    canaryPrefix,
  );
  const copyGet = await providerOperation(
    () =>
      adapter.getObject({
        key: copyKey,
        versionId: copyIdentity.versionId,
        expectedEtag: copyIdentity.etag,
      }),
    canaryPrefix,
  );
  verifyObject(
    copyGet,
    {
      ...copyIdentity,
      sizeBytes: canary.body.byteLength,
      mimeType,
      metadata: copyMetadata,
    },
    canaryPrefix,
  );
  await verifyBody(
    copyGet.body,
    canary.body.byteLength,
    contentSha256,
    canaryPrefix,
  );

  const deletedCopy = await providerOperation(
    () => adapter.deleteObject({ key: copyKey }),
    canaryPrefix,
  );
  let reportedDeleteMarkerVersion: string | null = null;
  if (
    deletedCopy.DeleteMarker !== undefined &&
    deletedCopy.DeleteMarker !== true
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned an invalid delete-marker response.",
      canaryPrefix,
    );
  }
  if (deletedCopy.VersionId !== undefined) {
    try {
      reportedDeleteMarkerVersion = requireS3VersionId(
        deletedCopy.VersionId,
      );
    } catch {
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 provider returned an invalid delete-marker identity.",
        canaryPrefix,
      );
    }
  }
  const afterDelete = await listCanaryVersions(
    adapter,
    canaryPrefix,
    new Set([sourceKey, copyKey]),
  );
  const copyDeleteMarkers = afterDelete.deleteMarkers.filter(
    (marker) => marker.key === copyKey,
  );
  if (!copyDeleteMarkers.length) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider did not create a versioned delete marker.",
      canaryPrefix,
    );
  }
  for (const marker of copyDeleteMarkers) {
    try {
      requireS3VersionId(marker.versionId);
    } catch {
      throw new S3ProviderContractError(
        "integrity_verification_failed",
        "The S3 provider listed an invalid delete-marker identity.",
        canaryPrefix,
      );
    }
  }
  if (
    reportedDeleteMarkerVersion &&
    !copyDeleteMarkers.some(
      (marker) => marker.versionId === reportedDeleteMarkerVersion,
    )
  ) {
    throw new S3ProviderContractError(
      "integrity_verification_failed",
      "The S3 provider returned inconsistent delete-marker identities.",
      canaryPrefix,
    );
  }

  await executeMultipartContract(
    adapter,
    canary,
    canaryPrefix,
    multipartCompleteKey,
    multipartAbortKey,
    expectedOrigins,
    activeUploads,
  );
  return incompleteMultipartAbortDays;
}

export async function runS3ProviderContractPreflight(input: {
  adapter: S3ProviderContractAdapter;
  confirmBucket: string;
  expectedOrigins: readonly string[];
  multipartUploadTtlSeconds: number;
  createCanary?: () => Canary;
}): Promise<S3ProviderContractResult> {
  if (
    !input.confirmBucket ||
    input.confirmBucket !== input.adapter.bucket
  ) {
    throw new S3ProviderContractError(
      "bucket_confirmation_mismatch",
      "The explicit bucket confirmation does not match the configured bucket.",
    );
  }
  let expectedOrigins: readonly string[];
  try {
    expectedOrigins = normalizeS3BrowserUploadOrigins(input.expectedOrigins);
  } catch (error) {
    if (!(error instanceof S3BrowserUploadOriginInventoryError)) throw error;
    throw new S3ProviderContractError(
      "browser_upload_cors_invalid",
      "The S3 browser upload origin inventory is invalid.",
    );
  }
  const canary = (input.createCanary ?? defaultCanary)();
  validateCanary(canary);
  const canaryPrefix = `${S3_PROVIDER_CANARY_ROOT}/${canary.id}`;
  const sourceKey = `${canaryPrefix}/source.bin`;
  const copyKey = `${canaryPrefix}/copy.bin`;
  const multipartCompleteKey = `${canaryPrefix}/multipart-complete.bin`;
  const multipartAbortKey = `${canaryPrefix}/multipart-abort.bin`;
  const allowedKeys = new Set([
    sourceKey,
    copyKey,
    multipartCompleteKey,
    multipartAbortKey,
  ]);
  const activeUploads: MultipartUploadTarget[] = [];
  let incompleteMultipartAbortDays: number | null = null;
  let primaryError: S3ProviderContractError | null = null;
  try {
    incompleteMultipartAbortDays = await executeContract(
      input.adapter,
      canary,
      canaryPrefix,
      sourceKey,
      copyKey,
      multipartCompleteKey,
      multipartAbortKey,
      expectedOrigins,
      input.multipartUploadTtlSeconds,
      activeUploads,
    );
  } catch (error) {
    primaryError = safeError(error, canaryPrefix);
  }

  let cleanupError: S3ProviderContractError | null = null;
  try {
    await input.adapter.cleanupMultipartUploads(activeUploads);
    await cleanupCanary(input.adapter, canaryPrefix, allowedKeys);
  } catch {
    cleanupError = new S3ProviderContractError(
      "cleanup_failed",
      "The S3 canary cleanup or empty-prefix verification failed.",
      canaryPrefix,
    );
  }
  if (primaryError && cleanupError) {
    throw new S3ProviderContractError(
      "preflight_and_cleanup_failed",
      "The S3 provider contract and mandatory canary cleanup both failed.",
      canaryPrefix,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  if (incompleteMultipartAbortDays === null) {
    throw new S3ProviderContractError(
      "multipart_lifecycle_invalid",
      "The incomplete-multipart-upload lifecycle contract was not verified.",
      canaryPrefix,
    );
  }
  return {
    bucket: input.adapter.bucket,
    canaryPrefix,
    versioningStatus: "Enabled",
    privacyExportExpirationDays: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
    privacyExportLifecycleVerified: true,
    incompleteMultipartAbortDays,
    incompleteMultipartLifecycleVerified: true,
    browserUploadCorsVerified: true,
    browserUploadOriginCount: expectedOrigins.length,
    multipartUploadVerified: true,
    multipartAbortVerified: true,
    sourceVersionVerified: true,
    copiedVersionVerified: true,
    cleanupVerified: true,
  };
}
