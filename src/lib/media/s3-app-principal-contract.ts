import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  normalizeS3Etag,
  requireS3VersionId,
  S3ObjectIntegrityError,
  type S3ObjectIntegrityMetadata,
  verifyS3ObjectIntegrity,
} from "./s3-object-integrity";
import {
  hasRequiredS3PrivacyExportLifecycle,
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

export type S3AppPrincipalContractAdapter = Readonly<{
  bucket: string;
  getBucketVersioning(): Promise<string | undefined>;
  getBucketLifecycleConfiguration(): Promise<
    readonly S3LifecycleRuleContract[]
  >;
  seedObject(input: PutInput): Promise<StableObject>;
  appPutObject(input: PutInput): Promise<StableObject>;
  appHeadObject(input: {
    key: string;
    versionId?: string;
  }): Promise<S3ObjectIntegrityMetadata>;
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
  cleanupExactKeys(keys: readonly string[]): Promise<void>;
  isAuthorizationDenied(error: unknown): boolean;
}>;

export type S3AppPrincipalContractResult = Readonly<{
  bucket: string;
  canaryId: string;
  required: Readonly<{
    incomingWriteAndHead: true;
    assetVersionRead: true;
    privacyExportLifecycle: true;
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

async function executeContract(
  adapter: S3AppPrincipalContractAdapter,
  canary: Canary,
  keys: {
    incoming: string;
    ready: string;
    copyTarget: string;
    tenantWriteTarget: string;
    privacy: string;
  },
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
}

export async function runS3AppPrincipalContractPreflight(input: {
  adapter: S3AppPrincipalContractAdapter;
  confirmBucket: string;
  createCanary?: () => Canary;
}): Promise<S3AppPrincipalContractResult> {
  if (!input.confirmBucket || input.confirmBucket !== input.adapter.bucket) {
    throw new S3AppPrincipalContractError(
      "bucket_confirmation_mismatch",
      "The explicit bucket confirmation does not match the configured bucket.",
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
  };
  const exactKeys = Object.values(keys);
  let primaryError: S3AppPrincipalContractError | null = null;
  try {
    await executeContract(input.adapter, canary, keys);
  } catch (error) {
    primaryError = safePrimaryError(error, canary.id);
  }

  let cleanupFailed = false;
  try {
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
  return {
    bucket: input.adapter.bucket,
    canaryId: canary.id,
    required: {
      incomingWriteAndHead: true,
      assetVersionRead: true,
      privacyExportLifecycle: true,
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
