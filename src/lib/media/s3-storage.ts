import "server-only";

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  immutableS3ObjectLocator,
  normalizeS3Etag,
  requireS3VersionId,
  S3ObjectIntegrityError,
  verifyS3ObjectIntegrity,
  versionedS3CopySource,
} from "@/lib/media/s3-object-integrity";
import {
  createS3NodeHttpHandler,
  S3_CLEANUP_COMMAND_DEADLINE_MS,
  S3_COPY_DEADLINE_MS,
  S3_HARD_DELETE_DEADLINE_MS,
  S3_METADATA_DEADLINE_MS,
  S3_SCAN_STREAM_DEADLINE_MS,
  withS3OperationDeadline,
  withS3StreamingOperationDeadline,
} from "@/lib/media/s3-operation-timeout";
import { deleteS3ObjectVersionsPagewise } from "@/lib/media/s3-version-cleanup";
import type { S3MediaStorageConfiguration } from "@/lib/media/storage-configuration";
import {
  isSafeMediaFileName,
  isValidMediaObjectIdentity,
  type MediaObjectIdentity,
} from "@/lib/media/storage-key";

export class MediaStorageError extends Error {
  readonly code:
    | "invalid_storage_key"
    | "object_missing"
    | "object_mismatch"
    | "storage_unavailable";

  constructor(
    code: MediaStorageError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MediaStorageError";
    this.code = code;
  }
}

type UploadAuthorizationInput = MediaObjectIdentity &
  Readonly<{
    mimeType: string;
    sizeBytes: number;
  }>;

type ObjectMetadata = Readonly<{
  sizeBytes: number;
  mimeType: string;
  etag: string;
  versionId: string;
  lastModified: Date | null;
}>;

const clients = new Map<string, S3Client>();

function configurationFingerprint(configuration: S3MediaStorageConfiguration) {
  return createHash("sha256")
    .update(
      [
        configuration.endpoint,
        configuration.region,
        configuration.bucket,
        configuration.accessKeyId,
        configuration.secretAccessKey,
        String(configuration.forcePathStyle),
      ].join("\0"),
    )
    .digest("hex");
}

function s3Client(configuration: S3MediaStorageConfiguration) {
  const fingerprint = configurationFingerprint(configuration);
  const cached = clients.get(fingerprint);
  if (cached) return cached;

  const client = new S3Client({
    endpoint: configuration.endpoint,
    region: configuration.region,
    forcePathStyle: configuration.forcePathStyle,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: createS3NodeHttpHandler(),
  });
  clients.set(fingerprint, client);
  return client;
}

function assertObjectIdentity(identity: MediaObjectIdentity) {
  if (!isValidMediaObjectIdentity(identity)) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The media object identity is invalid.",
    );
  }
}

function safeStorageFailure(error: unknown): never {
  const status =
    error && typeof error === "object" && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  if (status === 404) {
    throw new MediaStorageError("object_missing", "The media object is missing.");
  }
  throw new MediaStorageError(
    "storage_unavailable",
    "The media storage service is unavailable.",
    error instanceof Error ? { cause: error } : undefined,
  );
}

function quotedEtag(etag: string) {
  return /^"[^"]+"$/.test(etag) ? etag : `"${etag}"`;
}

function throwIfIntegrityMismatch(error: unknown, message: string) {
  if (error instanceof S3ObjectIntegrityError) {
    throw new MediaStorageError("object_mismatch", message, {
      cause: error,
    });
  }
}

function s3StreamBody(body: unknown): AsyncIterable<Uint8Array> {
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    return body as AsyncIterable<Uint8Array>;
  }
  throw new MediaStorageError(
    "object_mismatch",
    "The S3 media object body is not streamable.",
  );
}

function destroyS3Stream(body: AsyncIterable<Uint8Array>) {
  if ("destroy" in body && typeof body.destroy === "function") {
    try {
      body.destroy();
    } catch {
      // The AbortSignal remains the primary cancellation path.
    }
  }
}

function combinedAbortSignal(...signals: AbortSignal[]) {
  return AbortSignal.any(signals);
}

export async function createS3UploadAuthorization(
  configuration: S3MediaStorageConfiguration,
  input: UploadAuthorizationInput,
) {
  assertObjectIdentity(input);
  try {
    const url = await getSignedUrl(
      s3Client(configuration),
      new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: input.key,
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
        IfNoneMatch: "*",
        Metadata: {
          "asset-id": input.assetId,
          "organization-id": input.organizationId,
        },
      }),
      {
        expiresIn: configuration.limits.signedUploadTtlSeconds,
        signableHeaders: new Set([
          "content-length",
          "content-type",
          "if-none-match",
        ]),
      },
    );
    return {
      method: "PUT" as const,
      url,
      headers: {
        "Content-Length": String(input.sizeBytes),
        "Content-Type": input.mimeType,
        "If-None-Match": "*",
      },
      expiresInSeconds: configuration.limits.signedUploadTtlSeconds,
    };
  } catch (error) {
    safeStorageFailure(error);
  }
}

export async function inspectS3Object(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity,
): Promise<ObjectMetadata> {
  assertObjectIdentity(identity);
  try {
    const result = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new HeadObjectCommand({
            Bucket: configuration.bucket,
            Key: identity.key,
          }),
          { abortSignal },
        ),
    );
    const verified = verifyS3ObjectIntegrity(result, {
      metadata: {
        "asset-id": identity.assetId,
        "organization-id": identity.organizationId,
      },
    });
    return {
      sizeBytes: verified.sizeBytes,
      mimeType: verified.mimeType,
      etag: verified.etag,
      versionId: verified.versionId,
      lastModified: result.LastModified ?? null,
    };
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The uploaded media object has no immutable version identity.",
    );
    if (error instanceof MediaStorageError) throw error;
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 412) {
      throw new MediaStorageError(
        "object_mismatch",
        "The uploaded media object changed before scanning.",
      );
    }
    safeStorageFailure(error);
  }
}

export async function createS3DownloadAuthorization(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity &
    Readonly<{
      safeFileName: string;
      disposition: "inline" | "attachment";
      versionId: string;
      expectedEtag: string;
      expectedSha256: string;
      expectedSizeBytes: number;
      expectedMimeType: string;
    }>,
) {
  assertObjectIdentity(identity);
  if (!isSafeMediaFileName(identity.safeFileName)) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The media download filename is invalid.",
    );
  }
  try {
    const versionId = requireS3VersionId(identity.versionId);
    const head = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new HeadObjectCommand({
            Bucket: configuration.bucket,
            ...immutableS3ObjectLocator(identity.key, versionId),
          }),
          { abortSignal },
        ),
    );
    verifyS3ObjectIntegrity(head, {
      versionId,
      etag: identity.expectedEtag,
      sizeBytes: identity.expectedSizeBytes,
      mimeType: identity.expectedMimeType,
      metadata: {
        "asset-id": identity.assetId,
        "organization-id": identity.organizationId,
        sha256: identity.expectedSha256,
      },
    });
    const url = await getSignedUrl(
      s3Client(configuration),
      new GetObjectCommand({
        Bucket: configuration.bucket,
        ...immutableS3ObjectLocator(identity.key, versionId),
        ResponseContentDisposition: `${identity.disposition}; filename="${identity.safeFileName}"`,
        ResponseCacheControl: "private, no-store",
      }),
      { expiresIn: configuration.limits.signedDownloadTtlSeconds },
    );
    return {
      url,
      expiresInSeconds: configuration.limits.signedDownloadTtlSeconds,
    };
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The final media object does not match its immutable scan identity.",
    );
    safeStorageFailure(error);
  }
}

export async function getS3ObjectForScanning(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity &
    Readonly<{ expectedEtag: string; expectedVersionId: string }>,
) {
  assertObjectIdentity(identity);
  try {
    return await withS3StreamingOperationDeadline(
      S3_SCAN_STREAM_DEADLINE_MS,
      async (abortSignal) => {
        const result = await s3Client(configuration).send(
          new GetObjectCommand({
            Bucket: configuration.bucket,
            ...immutableS3ObjectLocator(
              identity.key,
              identity.expectedVersionId,
            ),
            IfMatch: quotedEtag(identity.expectedEtag),
          }),
          { abortSignal },
        );
        if (!result.Body) {
          throw new MediaStorageError(
            "object_mismatch",
            "The uploaded media object changed before scanning.",
          );
        }
        const body = s3StreamBody(result.Body);
        try {
          const verified = verifyS3ObjectIntegrity(result, {
            versionId: identity.expectedVersionId,
            etag: identity.expectedEtag,
            metadata: {
              "asset-id": identity.assetId,
              "organization-id": identity.organizationId,
            },
          });
          return {
            body,
            sizeBytes: verified.sizeBytes,
            mimeType: verified.mimeType,
          };
        } catch (error) {
          destroyS3Stream(body);
          throw error;
        }
      },
    );
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The uploaded media object changed before scanning.",
    );
    if (error instanceof MediaStorageError) throw error;
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 412) {
      throw new MediaStorageError(
        "object_mismatch",
        "The uploaded media object changed before scanning.",
      );
    }
    safeStorageFailure(error);
  }
}

export async function promoteS3Object(
  configuration: S3MediaStorageConfiguration,
  input: {
    source: MediaObjectIdentity;
    target: MediaObjectIdentity;
    expectedEtag: string;
    expectedSourceVersionId: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    mimeType: string;
  },
) {
  assertObjectIdentity(input.source);
  assertObjectIdentity(input.target);
  if (
    input.source.organizationId !== input.target.organizationId ||
    input.source.assetId !== input.target.assetId ||
    input.source.key === input.target.key
  ) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The media promotion identity is invalid.",
    );
  }

  try {
    return await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      async (abortSignal) => {
        const copied = await s3Client(configuration).send(
          new CopyObjectCommand({
            Bucket: configuration.bucket,
            Key: input.target.key,
            CopySource: versionedS3CopySource(
              configuration.bucket,
              input.source.key,
              input.expectedSourceVersionId,
            ),
            CopySourceIfMatch: quotedEtag(input.expectedEtag),
            ContentType: input.mimeType,
            CacheControl: "private, no-store",
            MetadataDirective: "REPLACE",
            Metadata: {
              "asset-id": input.target.assetId,
              "organization-id": input.target.organizationId,
              "scanned-source-etag": input.expectedEtag,
              "scanned-source-version-id": input.expectedSourceVersionId,
              sha256: input.expectedSha256,
            },
          }),
          { abortSignal },
        );
        const etag = normalizeS3Etag(copied.CopyObjectResult?.ETag);
        const versionId = requireS3VersionId(copied.VersionId);
        const finalObject = await withS3OperationDeadline(
          S3_METADATA_DEADLINE_MS,
          (metadataAbortSignal) =>
            s3Client(configuration).send(
              new HeadObjectCommand({
                Bucket: configuration.bucket,
                ...immutableS3ObjectLocator(input.target.key, versionId),
              }),
              {
                abortSignal: combinedAbortSignal(
                  abortSignal,
                  metadataAbortSignal,
                ),
              },
            ),
        );
        const verified = verifyS3ObjectIntegrity(finalObject, {
          versionId,
          etag,
          sizeBytes: input.expectedSizeBytes,
          mimeType: input.mimeType,
          metadata: {
            "asset-id": input.target.assetId,
            "organization-id": input.target.organizationId,
            "scanned-source-etag": input.expectedEtag,
            "scanned-source-version-id": input.expectedSourceVersionId,
            sha256: input.expectedSha256,
          },
        });

        return {
          etag: verified.etag,
          versionId: verified.versionId,
          sha256: input.expectedSha256,
          sizeBytes: verified.sizeBytes,
          stagingDeleted: false,
        };
      },
    );
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The promoted media object has no immutable scan identity.",
    );
    if (error instanceof MediaStorageError) throw error;
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 412) {
      throw new MediaStorageError(
        "object_mismatch",
        "The uploaded media object changed before promotion.",
      );
    }
    safeStorageFailure(error);
  }
}

export async function copyS3MediaObject(
  configuration: S3MediaStorageConfiguration,
  input: {
    source: MediaObjectIdentity;
    target: MediaObjectIdentity;
    expectedEtag: string;
    expectedSourceVersionId: string;
    expectedSha256: string;
    expectedSizeBytes: number;
    mimeType: string;
  },
) {
  assertObjectIdentity(input.source);
  assertObjectIdentity(input.target);
  if (
    input.source.organizationId === input.target.organizationId ||
    input.source.assetId === input.target.assetId ||
    input.source.key === input.target.key
  ) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The cross-tenant media copy identity is invalid.",
    );
  }
  try {
    return await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      async (abortSignal) => {
        const copied = await s3Client(configuration).send(
          new CopyObjectCommand({
            Bucket: configuration.bucket,
            Key: input.target.key,
            CopySource: versionedS3CopySource(
              configuration.bucket,
              input.source.key,
              input.expectedSourceVersionId,
            ),
            CopySourceIfMatch: quotedEtag(input.expectedEtag),
            ContentType: input.mimeType,
            CacheControl: "private, no-store",
            MetadataDirective: "REPLACE",
            Metadata: {
              "asset-id": input.target.assetId,
              "organization-id": input.target.organizationId,
              sha256: input.expectedSha256,
            },
          }),
          { abortSignal },
        );
        const etag = normalizeS3Etag(copied.CopyObjectResult?.ETag);
        const versionId = requireS3VersionId(copied.VersionId);
        const finalObject = await withS3OperationDeadline(
          S3_METADATA_DEADLINE_MS,
          (metadataAbortSignal) =>
            s3Client(configuration).send(
              new HeadObjectCommand({
                Bucket: configuration.bucket,
                ...immutableS3ObjectLocator(input.target.key, versionId),
              }),
              {
                abortSignal: combinedAbortSignal(
                  abortSignal,
                  metadataAbortSignal,
                ),
              },
            ),
        );
        const verified = verifyS3ObjectIntegrity(finalObject, {
          versionId,
          etag,
          sizeBytes: input.expectedSizeBytes,
          mimeType: input.mimeType,
          metadata: {
            "asset-id": input.target.assetId,
            "organization-id": input.target.organizationId,
            sha256: input.expectedSha256,
          },
        });
        return {
          etag: verified.etag,
          versionId: verified.versionId,
          sha256: input.expectedSha256,
          sizeBytes: verified.sizeBytes,
        };
      },
    );
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The copied media object has no immutable identity.",
    );
    if (error instanceof MediaStorageError) throw error;
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 412) {
      throw new MediaStorageError(
        "object_mismatch",
        "The source media object changed before it was copied.",
      );
    }
    safeStorageFailure(error);
  }
}

export async function putS3ProcessedObject(
  configuration: S3MediaStorageConfiguration,
  input: MediaObjectIdentity & {
    body: Readable;
    mimeType: string;
    sizeBytes: number;
    contentSha256: string;
    sourceSha256: string;
    processingJobId: string;
  },
) {
  assertObjectIdentity(input);
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    !/^[0-9a-f]{64}$/.test(input.contentSha256) ||
    !/^[0-9a-f]{64}$/.test(input.sourceSha256)
  ) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The processed media identity is invalid.",
    );
  }
  let uploadedVersionId: string | null = null;
  try {
    const uploaded = await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new PutObjectCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.mimeType,
            ContentLength: input.sizeBytes,
            CacheControl: "private, no-store",
            IfNoneMatch: "*",
            Metadata: {
              "asset-id": input.assetId,
              "organization-id": input.organizationId,
              "processing-job-id": input.processingJobId,
              "source-sha256": input.sourceSha256,
              sha256: input.contentSha256,
            },
          }),
          { abortSignal },
        ),
    );
    const etag = normalizeS3Etag(uploaded.ETag);
    uploadedVersionId = requireS3VersionId(uploaded.VersionId);
    const head = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new HeadObjectCommand({
            Bucket: configuration.bucket,
            ...immutableS3ObjectLocator(input.key, uploadedVersionId!),
          }),
          { abortSignal },
        ),
    );
    const verified = verifyS3ObjectIntegrity(head, {
      versionId: uploadedVersionId,
      etag,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      metadata: {
        "asset-id": input.assetId,
        "organization-id": input.organizationId,
        "processing-job-id": input.processingJobId,
        "source-sha256": input.sourceSha256,
        sha256: input.contentSha256,
      },
    });
    return {
      etag: verified.etag,
      versionId: verified.versionId,
      sizeBytes: verified.sizeBytes,
      sha256: input.contentSha256,
    };
  } catch (error) {
    if (uploadedVersionId) {
      await s3Client(configuration)
        .send(
          new DeleteObjectCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            VersionId: uploadedVersionId,
          }),
        )
        .catch(() => undefined);
    }
    throwIfIntegrityMismatch(
      error,
      "The processed media upload could not be verified.",
    );
    if (error instanceof MediaStorageError) throw error;
    safeStorageFailure(error);
  }
}

export async function deleteS3Object(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  assertObjectIdentity(identity);
  try {
    return await withS3OperationDeadline(
      S3_HARD_DELETE_DEADLINE_MS,
      async (deadlineAbortSignal) => {
        const abortSignal = signal
          ? combinedAbortSignal(deadlineAbortSignal, signal)
          : deadlineAbortSignal;
        await withS3OperationDeadline(
          S3_CLEANUP_COMMAND_DEADLINE_MS,
          (commandAbortSignal) =>
            s3Client(configuration).send(
              new DeleteObjectCommand({
                Bucket: configuration.bucket,
                Key: identity.key,
              }),
              {
                abortSignal: combinedAbortSignal(
                  abortSignal,
                  commandAbortSignal,
                ),
              },
            ),
        );
        await deleteS3ObjectVersionsPagewise({
          key: identity.key,
          async listPage(cursor) {
            const page = await withS3OperationDeadline(
              S3_CLEANUP_COMMAND_DEADLINE_MS,
              (commandAbortSignal) =>
                s3Client(configuration).send(
                  new ListObjectVersionsCommand({
                    Bucket: configuration.bucket,
                    Prefix: identity.key,
                    KeyMarker: cursor.keyMarker,
                    VersionIdMarker: cursor.versionIdMarker,
                  }),
                  {
                    abortSignal: combinedAbortSignal(
                      abortSignal,
                      commandAbortSignal,
                    ),
                  },
                ),
            );
            return {
              isTruncated: page.IsTruncated === true,
              nextKeyMarker: page.NextKeyMarker,
              nextVersionIdMarker: page.NextVersionIdMarker,
              versions: page.Versions ?? [],
              deleteMarkers: page.DeleteMarkers ?? [],
            };
          },
          async deletePage(targets) {
            const deleted = await withS3OperationDeadline(
              S3_CLEANUP_COMMAND_DEADLINE_MS,
              (commandAbortSignal) =>
                s3Client(configuration).send(
                  new DeleteObjectsCommand({
                    Bucket: configuration.bucket,
                    Delete: {
                      Objects: [...targets],
                      Quiet: true,
                    },
                  }),
                  {
                    abortSignal: combinedAbortSignal(
                      abortSignal,
                      commandAbortSignal,
                    ),
                  },
                ),
            );
            if (deleted.Errors?.length) {
              throw new MediaStorageError(
                "storage_unavailable",
                "The media object versions could not be deleted.",
              );
            }
          },
        });
      },
    );
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    safeStorageFailure(error);
  }
}
