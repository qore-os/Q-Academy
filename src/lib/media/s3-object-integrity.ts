import { createHash } from "node:crypto";

import type { MediaS3CompatibilityMode } from "./storage-configuration";

export class S3ObjectIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "S3ObjectIntegrityError";
  }
}

export type S3ObjectIntegrityMetadata = Readonly<{
  VersionId?: string;
  ETag?: string;
  ContentLength?: number;
  ContentType?: string;
  Metadata?: Record<string, string>;
}>;

export type S3ObjectIntegrityExpectation = Readonly<{
  compatibilityMode?: MediaS3CompatibilityMode;
  key?: string;
  versionId?: string;
  etag?: string;
  sizeBytes?: number;
  mimeType?: string;
  metadata: Readonly<Record<string, string>>;
}>;

export const STRATO_ETAG_REVISION_PREFIX = "q-academy:strato-etag:v1:";

export function normalizeS3Etag(value: string | undefined) {
  const normalized = value?.replace(/^"|"$/g, "") ?? "";
  if (!normalized || normalized.length > 255) {
    throw new S3ObjectIntegrityError("The S3 object has no valid ETag.");
  }
  return normalized;
}

export function requireS3VersionId(value: string | undefined) {
  const normalized = value?.trim() ?? "";
  if (
    !normalized ||
    normalized === "null" ||
    normalized.length > 1024
  ) {
    throw new S3ObjectIntegrityError(
      "The S3 bucket must return a non-null object VersionId.",
    );
  }
  return normalized;
}

export function stratoEtagRevision(key: string, etag: string) {
  const stableKey = key.trim();
  const stableEtag = normalizeS3Etag(etag);
  if (!stableKey || stableKey.length > 1024) {
    throw new S3ObjectIntegrityError("The S3 object key is invalid.");
  }
  return `${STRATO_ETAG_REVISION_PREFIX}${createHash("sha256")
    .update(stableKey)
    .update("\0")
    .update(stableEtag)
    .digest("hex")}`;
}

export function requireStratoEtagRevision(
  key: string,
  etag: string,
  revision: string,
) {
  const expected = stratoEtagRevision(key, etag);
  if (revision !== expected) {
    throw new S3ObjectIntegrityError(
      "The STRATO object revision does not match its key and ETag.",
    );
  }
  return expected;
}

export function s3ObjectLocator(
  compatibilityMode: MediaS3CompatibilityMode,
  key: string,
  versionId: string,
  etag: string,
) {
  if (compatibilityMode === "strato-hidrive") {
    requireStratoEtagRevision(key, etag, versionId);
    return { Key: key } as const;
  }
  return immutableS3ObjectLocator(key, versionId);
}

export function immutableS3ObjectLocator(key: string, versionId: string) {
  return {
    Key: key,
    VersionId: requireS3VersionId(versionId),
  } as const;
}

export function exactS3VersionDeletionTargets(
  key: string,
  versions: ReadonlyArray<Readonly<{ Key?: string; VersionId?: string }>>,
  deleteMarkers: ReadonlyArray<Readonly<{ Key?: string; VersionId?: string }>>,
) {
  return [...versions, ...deleteMarkers].flatMap((entry) =>
    entry.Key === key && entry.VersionId
      ? [{ Key: key, VersionId: entry.VersionId }]
      : [],
  );
}

export function verifyS3ObjectIntegrity(
  object: S3ObjectIntegrityMetadata,
  expected: S3ObjectIntegrityExpectation,
) {
  const etag = normalizeS3Etag(object.ETag);
  const compatibilityMode = expected.compatibilityMode ?? "versioned";
  const versionId =
    compatibilityMode === "strato-hidrive"
      ? stratoEtagRevision(expected.key ?? "", etag)
      : requireS3VersionId(object.VersionId);
  if (expected.versionId && versionId !== expected.versionId) {
    throw new S3ObjectIntegrityError("The S3 object version changed.");
  }
  if (expected.etag && etag !== expected.etag) {
    throw new S3ObjectIntegrityError("The S3 object ETag changed.");
  }
  if (
    !Number.isSafeInteger(object.ContentLength) ||
    Number(object.ContentLength) <= 0 ||
    (expected.sizeBytes !== undefined &&
      object.ContentLength !== expected.sizeBytes)
  ) {
    throw new S3ObjectIntegrityError("The S3 object size changed.");
  }
  if (
    !object.ContentType ||
    (expected.mimeType !== undefined &&
      object.ContentType !== expected.mimeType)
  ) {
    throw new S3ObjectIntegrityError("The S3 object MIME type changed.");
  }
  const metadata = object.Metadata ?? {};
  for (const [key, value] of Object.entries(expected.metadata)) {
    if (metadata[key] !== value) {
      throw new S3ObjectIntegrityError(
        `The S3 object metadata field ${key} changed.`,
      );
    }
  }
  return {
    versionId,
    etag,
    sizeBytes: Number(object.ContentLength),
    mimeType: object.ContentType,
  };
}

export function versionedS3CopySource(
  bucket: string,
  key: string,
  versionId: string,
) {
  const stableVersionId = requireS3VersionId(versionId);
  const path = `/${encodeURIComponent(bucket)}/${key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  return `${path}?versionId=${encodeURIComponent(stableVersionId)}`;
}

export function s3CopySource(
  compatibilityMode: MediaS3CompatibilityMode,
  bucket: string,
  key: string,
  versionId: string,
  etag: string,
) {
  if (compatibilityMode === "strato-hidrive") {
    requireStratoEtagRevision(key, etag, versionId);
    return `/${encodeURIComponent(bucket)}/${key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
  }
  return versionedS3CopySource(bucket, key, versionId);
}
