import "server-only";

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  normalizeS3Etag,
  requireS3VersionId,
  s3CopySource,
  s3ObjectLocator,
  S3ObjectIntegrityError,
  stratoEtagRevision,
  verifyS3ObjectIntegrity,
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
import { createStratoPresignedPost } from "@/lib/media/s3-presigned-post";
import {
  createS3MultipartUploadPlan,
  expectedS3MultipartPartSize,
  requireS3MultipartSha256,
  requireS3MultipartUploadId,
  S3_MULTIPART_MAX_PARTS,
  S3MultipartPolicyError,
  verifyS3MultipartParts,
} from "@/lib/media/s3-multipart-policy";
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

export type S3MultipartUploadSessionInput = MediaObjectIdentity &
  Readonly<{
    uploadId: string;
    expectedSizeBytes: number;
    partSizeBytes: number;
  }>;

export type S3MultipartPartAuthorizationInput =
  S3MultipartUploadSessionInput &
    Readonly<{
      partNumber: number;
      sizeBytes: number;
      checksumSha256: string;
    }>;

export type S3MultipartCompletionInput = S3MultipartUploadSessionInput &
  Readonly<{ mimeType: string }>;

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
        configuration.compatibilityMode,
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

function assertVersionedMultipartConfiguration(
  configuration: S3MediaStorageConfiguration,
) {
  if (configuration.compatibilityMode !== "versioned") {
    throw new MediaStorageError(
      "object_mismatch",
      "Native S3 multipart uploads require versioned compatibility mode.",
    );
  }
}

function multipartStorageFailure(error: unknown): never {
  if (error instanceof MediaStorageError) throw error;
  if (error instanceof S3MultipartPolicyError) {
    throw new MediaStorageError("object_mismatch", error.message, {
      cause: error,
    });
  }
  safeStorageFailure(error);
}

function multipartPlan(input: {
  expectedSizeBytes: number;
  partSizeBytes?: number;
}) {
  try {
    return createS3MultipartUploadPlan(
      input.expectedSizeBytes,
      input.partSizeBytes,
    );
  } catch (error) {
    multipartStorageFailure(error);
  }
}

function multipartUploadId(value: unknown) {
  try {
    return requireS3MultipartUploadId(value);
  } catch (error) {
    multipartStorageFailure(error);
  }
}

function multipartChecksum(value: unknown) {
  try {
    return requireS3MultipartSha256(value);
  } catch (error) {
    multipartStorageFailure(error);
  }
}

function assertMultipartMimeType(value: string) {
  if (
    !value ||
    value.length > 255 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new MediaStorageError(
      "object_mismatch",
      "The S3 multipart MIME type is invalid.",
    );
  }
}

function assertMultipartResponseIdentity(
  response: { Bucket?: string; Key?: string; UploadId?: string },
  configuration: S3MediaStorageConfiguration,
  key: string,
  expectedUploadId?: string,
) {
  if (
    response.Bucket !== configuration.bucket ||
    response.Key !== key ||
    (expectedUploadId !== undefined && response.UploadId !== expectedUploadId)
  ) {
    throw new MediaStorageError(
      "object_mismatch",
      "The S3 multipart response identity does not match the upload.",
    );
  }
}

function providerStatus(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}

function noSuchMultipartUpload(error: unknown) {
  return (
    providerStatus(error) === 404 ||
    (error instanceof Error && error.name === "NoSuchUpload")
  );
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

function objectRevision(
  configuration: S3MediaStorageConfiguration,
  key: string,
  etag: string,
  providerVersionId: string | undefined,
) {
  return configuration.compatibilityMode === "strato-hidrive"
    ? stratoEtagRevision(key, etag)
    : requireS3VersionId(providerVersionId);
}

async function verifiedExistingStratoTarget(
  configuration: S3MediaStorageConfiguration,
  input: {
    key: string;
    sizeBytes: number;
    mimeType: string;
    sha256: string;
    metadata: Readonly<Record<string, string>>;
  },
  signal: AbortSignal,
) {
  if (configuration.compatibilityMode !== "strato-hidrive") return null;
  let head;
  try {
    head = await s3Client(configuration).send(
      new HeadObjectCommand({
        Bucket: configuration.bucket,
        Key: input.key,
      }),
      { abortSignal: signal },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 404) return null;
    throw error;
  }
  try {
    const verified = verifyS3ObjectIntegrity(head, {
      compatibilityMode: "strato-hidrive",
      key: input.key,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      metadata: input.metadata,
    });
    await verifyStratoObjectContent(
      configuration,
      {
        key: input.key,
        etag: verified.etag,
        sizeBytes: verified.sizeBytes,
        sha256: input.sha256,
      },
      signal,
    );
    return verified;
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The existing STRATO target does not match the idempotent operation.",
    );
    if (error instanceof MediaStorageError) throw error;
    throw error;
  }
}

async function verifyStratoObjectContent(
  configuration: S3MediaStorageConfiguration,
  input: {
    key: string;
    etag: string;
    sizeBytes: number;
    sha256: string;
  },
  signal: AbortSignal,
) {
  if (configuration.compatibilityMode !== "strato-hidrive") return;
  const result = await s3Client(configuration).send(
    new GetObjectCommand({
      Bucket: configuration.bucket,
      Key: input.key,
      IfMatch: quotedEtag(input.etag),
    }),
    { abortSignal: signal },
  );
  const body = s3StreamBody(result.Body);
  let received = 0;
  let complete = false;
  const hash = createHash("sha256");
  try {
    if (
      normalizeS3Etag(result.ETag) !== input.etag ||
      result.ContentLength !== input.sizeBytes
    ) {
      throw new MediaStorageError(
        "object_mismatch",
        "The copied STRATO object identity changed during verification.",
      );
    }
    for await (const chunk of body) {
      received += chunk.byteLength;
      if (received > input.sizeBytes) {
        throw new MediaStorageError(
          "object_mismatch",
          "The copied STRATO object exceeded its verified size.",
        );
      }
      hash.update(chunk);
    }
    complete = true;
  } finally {
    if (!complete) destroyS3Stream(body);
  }
  if (
    received !== input.sizeBytes ||
    hash.digest("hex") !== input.sha256
  ) {
    throw new MediaStorageError(
      "object_mismatch",
      "The copied STRATO object does not match the scanned content digest.",
    );
  }
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
  if (configuration.compatibilityMode === "strato-hidrive") {
    try {
      return createStratoPresignedPost(configuration, {
        key: input.key,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        metadata: {
          "asset-id": input.assetId,
          "organization-id": input.organizationId,
        },
      });
    } catch (error) {
      safeStorageFailure(error);
    }
  }
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

export async function createS3MultipartUpload(
  configuration: S3MediaStorageConfiguration,
  input: UploadAuthorizationInput,
) {
  assertVersionedMultipartConfiguration(configuration);
  assertObjectIdentity(input);
  assertMultipartMimeType(input.mimeType);
  const plan = multipartPlan({ expectedSizeBytes: input.sizeBytes });
  try {
    const created = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new CreateMultipartUploadCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            ContentType: input.mimeType,
            CacheControl: "private, no-store",
            Metadata: {
              "asset-id": input.assetId,
              "organization-id": input.organizationId,
            },
            ChecksumAlgorithm: "SHA256",
            ChecksumType: "COMPOSITE",
          }),
          { abortSignal },
        ),
    );
    try {
      assertMultipartResponseIdentity(created, configuration, input.key);
      if (
        created.ChecksumAlgorithm !== "SHA256" ||
        created.ChecksumType !== "COMPOSITE"
      ) {
        throw new MediaStorageError(
          "object_mismatch",
          "The S3 provider did not accept the multipart checksum contract.",
        );
      }
      return {
        uploadId: multipartUploadId(created.UploadId),
        plan,
        checksumAlgorithm: "SHA256" as const,
        checksumType: "COMPOSITE" as const,
      };
    } catch (error) {
      if (typeof created.UploadId === "string" && created.UploadId.length > 0) {
        await withS3OperationDeadline(
          S3_CLEANUP_COMMAND_DEADLINE_MS,
          (abortSignal) =>
            s3Client(configuration).send(
              new AbortMultipartUploadCommand({
                Bucket: configuration.bucket,
                Key: input.key,
                UploadId: created.UploadId,
              }),
              { abortSignal },
            ),
        ).catch(() => undefined);
      }
      throw error;
    }
  } catch (error) {
    multipartStorageFailure(error);
  }
}

export async function createS3MultipartPartUploadAuthorization(
  configuration: S3MediaStorageConfiguration,
  input: S3MultipartPartAuthorizationInput,
) {
  assertVersionedMultipartConfiguration(configuration);
  assertObjectIdentity(input);
  const uploadId = multipartUploadId(input.uploadId);
  const plan = multipartPlan({
    expectedSizeBytes: input.expectedSizeBytes,
    partSizeBytes: input.partSizeBytes,
  });
  let expectedSizeBytes: number;
  try {
    expectedSizeBytes = expectedS3MultipartPartSize(plan, input.partNumber);
  } catch (error) {
    multipartStorageFailure(error);
  }
  if (input.sizeBytes !== expectedSizeBytes) {
    throw new MediaStorageError(
      "object_mismatch",
      "The multipart part size does not match the upload plan.",
    );
  }
  const checksumSha256 = multipartChecksum(input.checksumSha256);
  try {
    const url = await getSignedUrl(
      s3Client(configuration),
      new UploadPartCommand({
        Bucket: configuration.bucket,
        Key: input.key,
        UploadId: uploadId,
        PartNumber: input.partNumber,
        ContentLength: expectedSizeBytes,
        ChecksumSHA256: checksumSha256,
      }),
      {
        expiresIn: configuration.limits.signedUploadTtlSeconds,
        signableHeaders: new Set([
          "content-length",
          "x-amz-checksum-sha256",
        ]),
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      },
    );
    return {
      method: "PUT" as const,
      url,
      headers: {
        "Content-Length": String(expectedSizeBytes),
        "X-Amz-Checksum-Sha256": checksumSha256,
      },
      partNumber: input.partNumber,
      sizeBytes: expectedSizeBytes,
      expiresInSeconds: configuration.limits.signedUploadTtlSeconds,
    };
  } catch (error) {
    multipartStorageFailure(error);
  }
}

export async function listS3MultipartUploadParts(
  configuration: S3MediaStorageConfiguration,
  input: S3MultipartUploadSessionInput,
) {
  assertVersionedMultipartConfiguration(configuration);
  assertObjectIdentity(input);
  const uploadId = multipartUploadId(input.uploadId);
  const plan = multipartPlan({
    expectedSizeBytes: input.expectedSizeBytes,
    partSizeBytes: input.partSizeBytes,
  });
  try {
    const providerParts = await withS3OperationDeadline(
      S3_CLEANUP_COMMAND_DEADLINE_MS,
      async (abortSignal) => {
        const parts = [];
        const maxPageSize = 1_000;
        const maxPages = Math.ceil(S3_MULTIPART_MAX_PARTS / maxPageSize);
        let partNumberMarker: string | undefined;
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const page = await s3Client(configuration).send(
            new ListPartsCommand({
              Bucket: configuration.bucket,
              Key: input.key,
              UploadId: uploadId,
              MaxParts: maxPageSize,
              ...(partNumberMarker
                ? { PartNumberMarker: partNumberMarker }
                : {}),
            }),
            { abortSignal },
          );
          assertMultipartResponseIdentity(
            page,
            configuration,
            input.key,
            uploadId,
          );
          if (
            page.ChecksumAlgorithm !== "SHA256" ||
            page.ChecksumType !== "COMPOSITE" ||
            (page.Parts?.length ?? 0) > maxPageSize
          ) {
            throw new MediaStorageError(
              "object_mismatch",
              "The S3 provider returned an invalid multipart parts page.",
            );
          }
          parts.push(...(page.Parts ?? []));
          if (parts.length > S3_MULTIPART_MAX_PARTS) {
            throw new MediaStorageError(
              "object_mismatch",
              "The S3 provider returned too many multipart parts.",
            );
          }
          if (page.IsTruncated !== true) {
            if (page.NextPartNumberMarker !== undefined) {
              throw new MediaStorageError(
                "object_mismatch",
                "The final S3 multipart parts page has an invalid cursor.",
              );
            }
            break;
          }
          const nextMarker = page.NextPartNumberMarker ?? "";
          const nextPartNumber = /^\d+$/.test(nextMarker)
            ? Number(nextMarker)
            : Number.NaN;
          const lastPartNumber = page.Parts?.at(-1)?.PartNumber;
          if (
            !Number.isSafeInteger(nextPartNumber) ||
            nextPartNumber < 1 ||
            nextPartNumber > S3_MULTIPART_MAX_PARTS ||
            nextPartNumber <= Number(partNumberMarker ?? 0) ||
            nextPartNumber !== lastPartNumber ||
            pageNumber === maxPages
          ) {
            throw new MediaStorageError(
              "object_mismatch",
              "The S3 provider returned an invalid multipart pagination cursor.",
            );
          }
          partNumberMarker = nextMarker;
        }
        return parts;
      },
    );
    const verified = verifyS3MultipartParts({ plan, parts: providerParts });
    return {
      uploadId,
      ...verified,
    };
  } catch (error) {
    multipartStorageFailure(error);
  }
}

function compositeMultipartSha256(
  parts: readonly Readonly<{ checksumSha256: string }>[],
) {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(Buffer.from(part.checksumSha256, "base64"));
  }
  return `${hash.digest("base64")}-${parts.length}`;
}

export async function completeS3MultipartUpload(
  configuration: S3MediaStorageConfiguration,
  input: S3MultipartCompletionInput,
) {
  assertVersionedMultipartConfiguration(configuration);
  assertObjectIdentity(input);
  assertMultipartMimeType(input.mimeType);
  const listed = await listS3MultipartUploadParts(configuration, input);
  let completedParts: ReturnType<typeof verifyS3MultipartParts>;
  try {
    completedParts = verifyS3MultipartParts({
      plan: listed.plan,
      parts: listed.parts.map((part) => ({
        PartNumber: part.partNumber,
        Size: part.sizeBytes,
        ETag: part.etag,
        ChecksumSHA256: part.checksumSha256,
      })),
      requireComplete: true,
    });
  } catch (error) {
    multipartStorageFailure(error);
  }
  const expectedCompositeChecksum = compositeMultipartSha256(
    completedParts.parts,
  );
  try {
    return await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      async (abortSignal) => {
        const completed = await s3Client(configuration).send(
          new CompleteMultipartUploadCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            UploadId: listed.uploadId,
            MultipartUpload: {
              Parts: completedParts.parts.map((part) => ({
                PartNumber: part.partNumber,
                ETag: part.etag,
                ChecksumSHA256: part.checksumSha256,
              })),
            },
            ChecksumType: "COMPOSITE",
            MpuObjectSize: completedParts.plan.expectedSizeBytes,
          }),
          { abortSignal },
        );
        assertMultipartResponseIdentity(completed, configuration, input.key);
        const etag = normalizeS3Etag(completed.ETag);
        const versionId = requireS3VersionId(completed.VersionId);
        if (
          completed.ChecksumType !== "COMPOSITE" ||
          completed.ChecksumSHA256 !== expectedCompositeChecksum
        ) {
          throw new MediaStorageError(
            "object_mismatch",
            "The completed S3 object has an invalid composite checksum.",
          );
        }
        const head = await withS3OperationDeadline(
          S3_METADATA_DEADLINE_MS,
          (metadataAbortSignal) =>
            s3Client(configuration).send(
              new HeadObjectCommand({
                Bucket: configuration.bucket,
                Key: input.key,
                VersionId: versionId,
                ChecksumMode: "ENABLED",
              }),
              {
                abortSignal: combinedAbortSignal(
                  abortSignal,
                  metadataAbortSignal,
                ),
              },
            ),
        );
        const verified = verifyS3ObjectIntegrity(head, {
          compatibilityMode: "versioned",
          key: input.key,
          versionId,
          etag,
          sizeBytes: completedParts.plan.expectedSizeBytes,
          mimeType: input.mimeType,
          metadata: {
            "asset-id": input.assetId,
            "organization-id": input.organizationId,
          },
        });
        if (
          head.ChecksumType !== "COMPOSITE" ||
          head.ChecksumSHA256 !== expectedCompositeChecksum
        ) {
          throw new MediaStorageError(
            "object_mismatch",
            "The completed S3 object checksum changed after completion.",
          );
        }
        return {
          ...verified,
          partCount: completedParts.plan.partCount,
          checksumSha256: expectedCompositeChecksum,
          checksumType: "COMPOSITE" as const,
          lastModified: head.LastModified ?? null,
        };
      },
    );
  } catch (error) {
    multipartStorageFailure(error);
  }
}

export async function abortS3MultipartUpload(
  configuration: S3MediaStorageConfiguration,
  input: MediaObjectIdentity & Readonly<{ uploadId: string }>,
  signal?: AbortSignal,
) {
  assertVersionedMultipartConfiguration(configuration);
  assertObjectIdentity(input);
  signal?.throwIfAborted();
  const uploadId = multipartUploadId(input.uploadId);
  try {
    return await withS3OperationDeadline(
      S3_CLEANUP_COMMAND_DEADLINE_MS,
      async (abortSignal) => {
        const operationSignal = signal
          ? combinedAbortSignal(abortSignal, signal)
          : abortSignal;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await s3Client(configuration).send(
              new AbortMultipartUploadCommand({
                Bucket: configuration.bucket,
                Key: input.key,
                UploadId: uploadId,
              }),
              { abortSignal: operationSignal },
            );
          } catch (error) {
            if (noSuchMultipartUpload(error)) {
              return { uploadId, aborted: true as const, attempts: attempt };
            }
            throw error;
          }
          try {
            await s3Client(configuration).send(
              new ListPartsCommand({
                Bucket: configuration.bucket,
                Key: input.key,
                UploadId: uploadId,
                MaxParts: 1,
              }),
              { abortSignal: operationSignal },
            );
          } catch (error) {
            if (noSuchMultipartUpload(error)) {
              return { uploadId, aborted: true as const, attempts: attempt };
            }
            throw error;
          }
        }
        throw new MediaStorageError(
          "object_mismatch",
          "The S3 multipart upload still exists after repeated aborts.",
        );
      },
    );
  } catch (error) {
    multipartStorageFailure(error);
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
      compatibilityMode: configuration.compatibilityMode,
      key: identity.key,
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
  if (configuration.compatibilityMode === "strato-hidrive") {
    throw new MediaStorageError(
      "object_mismatch",
      "STRATO downloads must use the ETag-bound application proxy.",
    );
  }
  if (!isSafeMediaFileName(identity.safeFileName)) {
    throw new MediaStorageError(
      "invalid_storage_key",
      "The media download filename is invalid.",
    );
  }
  try {
    const versionId = identity.versionId;
    const head = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new HeadObjectCommand({
            Bucket: configuration.bucket,
            ...s3ObjectLocator(
              configuration.compatibilityMode,
              identity.key,
              versionId,
              identity.expectedEtag,
            ),
          }),
          { abortSignal },
        ),
    );
    verifyS3ObjectIntegrity(head, {
      compatibilityMode: configuration.compatibilityMode,
      key: identity.key,
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
        ...s3ObjectLocator(
          configuration.compatibilityMode,
          identity.key,
          versionId,
          identity.expectedEtag,
        ),
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

export async function getS3ObjectForDownload(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity &
    Readonly<{
      versionId: string;
      expectedEtag: string;
      expectedSha256: string;
      expectedSizeBytes: number;
      expectedMimeType: string;
      range?: Readonly<{ start: number; end: number }>;
    }>,
) {
  assertObjectIdentity(identity);
  if (
    configuration.compatibilityMode !== "strato-hidrive" ||
    !/^[0-9a-f]{64}$/.test(identity.expectedSha256) ||
    !Number.isSafeInteger(identity.expectedSizeBytes) ||
    identity.expectedSizeBytes <= 0 ||
    (identity.range !== undefined &&
      (!Number.isSafeInteger(identity.range.start) ||
        !Number.isSafeInteger(identity.range.end) ||
        identity.range.start < 0 ||
        identity.range.end < identity.range.start ||
        identity.range.end >= identity.expectedSizeBytes))
  ) {
    throw new MediaStorageError(
      "object_mismatch",
      "The STRATO download identity is invalid.",
    );
  }
  try {
    return await withS3StreamingOperationDeadline(
      S3_SCAN_STREAM_DEADLINE_MS,
      async (abortSignal) => {
        const result = await s3Client(configuration).send(
          new GetObjectCommand({
            Bucket: configuration.bucket,
            ...s3ObjectLocator(
              configuration.compatibilityMode,
              identity.key,
              identity.versionId,
              identity.expectedEtag,
            ),
            IfMatch: quotedEtag(identity.expectedEtag),
            ...(identity.range
              ? { Range: `bytes=${identity.range.start}-${identity.range.end}` }
              : {}),
          }),
          { abortSignal },
        );
        if (!result.Body) {
          throw new MediaStorageError(
            "object_mismatch",
            "The STRATO download body is missing.",
          );
        }
        const body = s3StreamBody(result.Body);
        const responseSize = identity.range
          ? identity.range.end - identity.range.start + 1
          : identity.expectedSizeBytes;
        const expectedContentRange = identity.range
          ? `bytes ${identity.range.start}-${identity.range.end}/${identity.expectedSizeBytes}`
          : undefined;
        const metadata = result.Metadata ?? {};
        if (
          normalizeS3Etag(result.ETag) !== identity.expectedEtag ||
          result.ContentLength !== responseSize ||
          result.ContentType !== identity.expectedMimeType ||
          result.ContentRange !== expectedContentRange ||
          metadata["asset-id"] !== identity.assetId ||
          metadata["organization-id"] !== identity.organizationId ||
          metadata.sha256 !== identity.expectedSha256
        ) {
          destroyS3Stream(body);
          throw new MediaStorageError(
            "object_mismatch",
            "The STRATO download object changed after it was verified.",
          );
        }
        return {
          body,
          sizeBytes: identity.expectedSizeBytes,
          responseSize,
        };
      },
    );
  } catch (error) {
    throwIfIntegrityMismatch(
      error,
      "The STRATO download identity does not match the stored object.",
    );
    if (error instanceof MediaStorageError) throw error;
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 412) {
      throw new MediaStorageError(
        "object_mismatch",
        "The STRATO download object changed before it was opened.",
      );
    }
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
            ...s3ObjectLocator(
              configuration.compatibilityMode,
              identity.key,
              identity.expectedVersionId,
              identity.expectedEtag,
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
            compatibilityMode: configuration.compatibilityMode,
            key: identity.key,
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
        const targetMetadata = {
          "asset-id": input.target.assetId,
          "organization-id": input.target.organizationId,
          "scanned-source-etag": input.expectedEtag,
          "scanned-source-version-id": input.expectedSourceVersionId,
          sha256: input.expectedSha256,
        };
        const existing = await verifiedExistingStratoTarget(
          configuration,
          {
            key: input.target.key,
            sizeBytes: input.expectedSizeBytes,
            mimeType: input.mimeType,
            sha256: input.expectedSha256,
            metadata: targetMetadata,
          },
          abortSignal,
        );
        if (existing) {
          return {
            etag: existing.etag,
            versionId: existing.versionId,
            sha256: input.expectedSha256,
            sizeBytes: existing.sizeBytes,
            stagingDeleted: false,
          };
        }
        const copied = await s3Client(configuration).send(
          new CopyObjectCommand({
            Bucket: configuration.bucket,
            Key: input.target.key,
            CopySource: s3CopySource(
              configuration.compatibilityMode,
              configuration.bucket,
              input.source.key,
              input.expectedSourceVersionId,
              input.expectedEtag,
            ),
            CopySourceIfMatch: quotedEtag(input.expectedEtag),
            ContentType: input.mimeType,
            CacheControl: "private, no-store",
            MetadataDirective: "REPLACE",
            Metadata: targetMetadata,
          }),
          { abortSignal },
        );
        const etag = normalizeS3Etag(copied.CopyObjectResult?.ETag);
        const versionId = objectRevision(
          configuration,
          input.target.key,
          etag,
          copied.VersionId,
        );
        const finalObject = await withS3OperationDeadline(
          S3_METADATA_DEADLINE_MS,
          (metadataAbortSignal) =>
            s3Client(configuration).send(
              new HeadObjectCommand({
                Bucket: configuration.bucket,
                ...s3ObjectLocator(
                  configuration.compatibilityMode,
                  input.target.key,
                  versionId,
                  etag,
                ),
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
          compatibilityMode: configuration.compatibilityMode,
          key: input.target.key,
          versionId,
          etag,
          sizeBytes: input.expectedSizeBytes,
          mimeType: input.mimeType,
          metadata: targetMetadata,
        });
        await verifyStratoObjectContent(
          configuration,
          {
            key: input.target.key,
            etag: verified.etag,
            sizeBytes: verified.sizeBytes,
            sha256: input.expectedSha256,
          },
          abortSignal,
        );

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
        const targetMetadata = {
          "asset-id": input.target.assetId,
          "organization-id": input.target.organizationId,
          sha256: input.expectedSha256,
        };
        const existing = await verifiedExistingStratoTarget(
          configuration,
          {
            key: input.target.key,
            sizeBytes: input.expectedSizeBytes,
            mimeType: input.mimeType,
            sha256: input.expectedSha256,
            metadata: targetMetadata,
          },
          abortSignal,
        );
        if (existing) {
          return {
            etag: existing.etag,
            versionId: existing.versionId,
            sha256: input.expectedSha256,
            sizeBytes: existing.sizeBytes,
          };
        }
        const copied = await s3Client(configuration).send(
          new CopyObjectCommand({
            Bucket: configuration.bucket,
            Key: input.target.key,
            CopySource: s3CopySource(
              configuration.compatibilityMode,
              configuration.bucket,
              input.source.key,
              input.expectedSourceVersionId,
              input.expectedEtag,
            ),
            CopySourceIfMatch: quotedEtag(input.expectedEtag),
            ContentType: input.mimeType,
            CacheControl: "private, no-store",
            MetadataDirective: "REPLACE",
            Metadata: targetMetadata,
          }),
          { abortSignal },
        );
        const etag = normalizeS3Etag(copied.CopyObjectResult?.ETag);
        const versionId = objectRevision(
          configuration,
          input.target.key,
          etag,
          copied.VersionId,
        );
        const finalObject = await withS3OperationDeadline(
          S3_METADATA_DEADLINE_MS,
          (metadataAbortSignal) =>
            s3Client(configuration).send(
              new HeadObjectCommand({
                Bucket: configuration.bucket,
                ...s3ObjectLocator(
                  configuration.compatibilityMode,
                  input.target.key,
                  versionId,
                  etag,
                ),
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
          compatibilityMode: configuration.compatibilityMode,
          key: input.target.key,
          versionId,
          etag,
          sizeBytes: input.expectedSizeBytes,
          mimeType: input.mimeType,
          metadata: targetMetadata,
        });
        await verifyStratoObjectContent(
          configuration,
          {
            key: input.target.key,
            etag: verified.etag,
            sizeBytes: verified.sizeBytes,
            sha256: input.expectedSha256,
          },
          abortSignal,
        );
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

type S3ProcessedObjectInput = MediaObjectIdentity & {
  body: Readable;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  sourceSha256: string;
  processingJobId: string;
};

async function putS3ProcessedObjectOnce(
  configuration: S3MediaStorageConfiguration,
  input: S3ProcessedObjectInput,
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
    const targetMetadata = {
      "asset-id": input.assetId,
      "organization-id": input.organizationId,
      "processing-job-id": input.processingJobId,
      "source-sha256": input.sourceSha256,
      sha256: input.contentSha256,
    };
    const writeResult = await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      async (abortSignal) => {
        const existing = await verifiedExistingStratoTarget(
          configuration,
          {
            key: input.key,
            sizeBytes: input.sizeBytes,
            mimeType: input.mimeType,
            sha256: input.contentSha256,
            metadata: targetMetadata,
          },
          abortSignal,
        );
        if (existing) {
          return { kind: "existing" as const, verified: existing };
        }
        const uploaded = await s3Client(configuration).send(
          new PutObjectCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            Body: input.body,
            ContentType: input.mimeType,
            ContentLength: input.sizeBytes,
            CacheControl: "private, no-store",
            IfNoneMatch: "*",
            Metadata: targetMetadata,
          }),
          { abortSignal },
        );
        return { kind: "uploaded" as const, uploaded };
      },
    );
    if (writeResult.kind === "existing") {
      return {
        etag: writeResult.verified.etag,
        versionId: writeResult.verified.versionId,
        sizeBytes: writeResult.verified.sizeBytes,
        sha256: input.contentSha256,
      };
    }
    const uploaded = writeResult.uploaded;
    const etag = normalizeS3Etag(uploaded.ETag);
    uploadedVersionId = objectRevision(
      configuration,
      input.key,
      etag,
      uploaded.VersionId,
    );
    const head = await withS3OperationDeadline(
      S3_METADATA_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new HeadObjectCommand({
            Bucket: configuration.bucket,
            ...s3ObjectLocator(
              configuration.compatibilityMode,
              input.key,
              uploadedVersionId!,
              etag,
            ),
          }),
          { abortSignal },
        ),
    );
    const verified = verifyS3ObjectIntegrity(head, {
      compatibilityMode: configuration.compatibilityMode,
      key: input.key,
      versionId: uploadedVersionId,
      etag,
      sizeBytes: input.sizeBytes,
      mimeType: input.mimeType,
      metadata: targetMetadata,
    });
    await withS3OperationDeadline(
      S3_COPY_DEADLINE_MS,
      (abortSignal) =>
        verifyStratoObjectContent(
          configuration,
          {
            key: input.key,
            etag: verified.etag,
            sizeBytes: verified.sizeBytes,
            sha256: input.contentSha256,
          },
          abortSignal,
        ),
    );
    return {
      etag: verified.etag,
      versionId: verified.versionId,
      sizeBytes: verified.sizeBytes,
      sha256: input.contentSha256,
    };
  } catch (error) {
    if (
      uploadedVersionId &&
      configuration.compatibilityMode === "versioned"
    ) {
      await s3Client(configuration)
        .send(
          new DeleteObjectCommand({
            Bucket: configuration.bucket,
            Key: input.key,
            ...(configuration.compatibilityMode === "versioned"
              ? { VersionId: uploadedVersionId }
              : {}),
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

export async function putS3ProcessedObject(
  configuration: S3MediaStorageConfiguration,
  input: S3ProcessedObjectInput,
) {
  try {
    return await putS3ProcessedObjectOnce(configuration, input);
  } finally {
    // The caller transfers ownership of the file stream. In particular, the
    // STRATO idempotency HEAD path may return without ever consuming the body.
    input.body.destroy();
  }
}

export async function deleteS3ObjectRevision(
  configuration: S3MediaStorageConfiguration,
  identity: MediaObjectIdentity,
  versionId: string,
) {
  assertObjectIdentity(identity);
  if (configuration.compatibilityMode !== "versioned") {
    throw new MediaStorageError(
      "object_mismatch",
      "Exact provider-version deletion requires versioned S3 mode.",
    );
  }
  const stableVersionId = requireS3VersionId(versionId);
  try {
    await withS3OperationDeadline(
      S3_CLEANUP_COMMAND_DEADLINE_MS,
      (abortSignal) =>
        s3Client(configuration).send(
          new DeleteObjectCommand({
            Bucket: configuration.bucket,
            Key: identity.key,
            VersionId: stableVersionId,
          }),
          { abortSignal },
        ),
    );
    try {
      await withS3OperationDeadline(
        S3_CLEANUP_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          s3Client(configuration).send(
            new HeadObjectCommand({
              Bucket: configuration.bucket,
              Key: identity.key,
              VersionId: stableVersionId,
            }),
            { abortSignal },
          ),
      );
    } catch (error) {
      const status =
        error && typeof error === "object" && "$metadata" in error
          ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
          : undefined;
      if (status === 404) return;
      throw error;
    }
    throw new MediaStorageError(
      "object_mismatch",
      "The exact S3 object version remained after deletion.",
    );
  } catch (error) {
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
        if (configuration.compatibilityMode === "strato-hidrive") {
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
          try {
            await withS3OperationDeadline(
              S3_CLEANUP_COMMAND_DEADLINE_MS,
              (commandAbortSignal) =>
                s3Client(configuration).send(
                  new HeadObjectCommand({
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
          } catch (error) {
            const status =
              error && typeof error === "object" && "$metadata" in error
                ? (error.$metadata as { httpStatusCode?: number })
                    .httpStatusCode
                : undefined;
            if (status === 404) return;
            throw error;
          }
          throw new MediaStorageError(
            "object_mismatch",
            "The STRATO media object remained after deletion.",
          );
        }
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
