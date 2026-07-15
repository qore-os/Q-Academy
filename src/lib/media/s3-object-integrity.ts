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
  versionId?: string;
  etag?: string;
  sizeBytes?: number;
  mimeType?: string;
  metadata: Readonly<Record<string, string>>;
}>;

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
  const versionId = requireS3VersionId(object.VersionId);
  const etag = normalizeS3Etag(object.ETag);
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
