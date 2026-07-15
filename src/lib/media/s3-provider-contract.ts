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
  hasRequiredS3PrivacyExportLifecycle,
  S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  type S3LifecycleRuleContract,
} from "./s3-privacy-export-lifecycle";

export const S3_PROVIDER_CANARY_ROOT =
  "q-academy-provider-contract-canary/v1";
const S3_PROVIDER_CLEANUP_MAX_PAGES = 16;

type ObjectVersionTarget = Readonly<{ key: string; versionId: string }>;

export type S3ProviderContractAdapter = Readonly<{
  bucket: string;
  getBucketVersioning(): Promise<string | undefined>;
  getBucketLifecycleConfiguration(): Promise<
    readonly S3LifecycleRuleContract[]
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
  }): Promise<S3ObjectIntegrityMetadata>;
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

async function executeContract(
  adapter: S3ProviderContractAdapter,
  canary: Canary,
  canaryPrefix: string,
  sourceKey: string,
  copyKey: string,
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
}

export async function runS3ProviderContractPreflight(input: {
  adapter: S3ProviderContractAdapter;
  confirmBucket: string;
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
  const canary = (input.createCanary ?? defaultCanary)();
  validateCanary(canary);
  const canaryPrefix = `${S3_PROVIDER_CANARY_ROOT}/${canary.id}`;
  const sourceKey = `${canaryPrefix}/source.bin`;
  const copyKey = `${canaryPrefix}/copy.bin`;
  const allowedKeys = new Set([sourceKey, copyKey]);
  let primaryError: S3ProviderContractError | null = null;
  try {
    await executeContract(
      input.adapter,
      canary,
      canaryPrefix,
      sourceKey,
      copyKey,
    );
  } catch (error) {
    primaryError = safeError(error, canaryPrefix);
  }

  let cleanupError: S3ProviderContractError | null = null;
  try {
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
  return {
    bucket: input.adapter.bucket,
    canaryPrefix,
    versioningStatus: "Enabled",
    privacyExportExpirationDays: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
    privacyExportLifecycleVerified: true,
    sourceVersionVerified: true,
    copiedVersionVerified: true,
    cleanupVerified: true,
  };
}
