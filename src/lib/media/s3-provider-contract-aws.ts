import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketCorsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { S3MediaStorageConfiguration } from "./storage-configuration";
import { uploadS3MultipartPartLikeBrowser } from "./s3-browser-upload-part-preflight";
import { versionedS3CopySource } from "./s3-object-integrity";
import {
  createS3NodeHttpHandler,
  S3_PREFLIGHT_COMMAND_DEADLINE_MS,
  withS3OperationDeadline,
  withS3StreamingOperationDeadline,
} from "./s3-operation-timeout";
import type { S3ProviderContractAdapter } from "./s3-provider-contract";
import { normalizeS3BrowserUploadCorsConfiguration } from "./s3-browser-upload-cors";
import { normalizeS3LifecycleConfiguration } from "./s3-privacy-export-lifecycle";

export type AwsS3ProviderContractAdapter = S3ProviderContractAdapter &
  Readonly<{ destroy(): void }>;

function streamBody(body: unknown): AsyncIterable<Uint8Array> {
  if (
    body &&
    typeof body === "object" &&
    Symbol.asyncIterator in body
  ) {
    return body as AsyncIterable<Uint8Array>;
  }
  throw new Error("The S3 provider response body is not streamable.");
}

function errorStatus(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}

function errorName(error: unknown) {
  return error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
}

function isMissingMultipartUpload(error: unknown) {
  return errorStatus(error) === 404 || errorName(error) === "NoSuchUpload";
}

export function createAwsS3ProviderContractAdapter(
  configuration: S3MediaStorageConfiguration,
): AwsS3ProviderContractAdapter {
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
  const bucket = configuration.bucket;
  async function exactObjectVersionExists(key: string) {
    const seenCursors = new Set<string>();
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (let page = 0; page < 16; page += 1) {
      const cursor = `${keyMarker ?? ""}\0${versionIdMarker ?? ""}`;
      if (seenCursors.has(cursor)) {
        throw new Error("The S3 provider repeated an object-version cursor.");
      }
      seenCursors.add(cursor);
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: key,
              KeyMarker: keyMarker,
              VersionIdMarker: versionIdMarker,
              MaxKeys: 32,
            }),
            { abortSignal },
          ),
      );
      if (
        [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])].some(
          (entry) => entry.Key === key,
        )
      ) {
        return true;
      }
      if (!result.IsTruncated) return false;
      if (!result.NextKeyMarker || !result.NextVersionIdMarker) {
        throw new Error("The S3 provider omitted an object-version cursor.");
      }
      keyMarker = result.NextKeyMarker;
      versionIdMarker = result.NextVersionIdMarker;
    }
    throw new Error("The S3 object-version check exceeded its page limit.");
  }
  return {
    bucket,
    destroy() {
      client.destroy();
    },
    async getBucketVersioning() {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new GetBucketVersioningCommand({ Bucket: bucket }),
            { abortSignal },
          ),
      );
      return result.Status;
    },
    async getBucketLifecycleConfiguration() {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
            { abortSignal },
          ),
      );
      return normalizeS3LifecycleConfiguration(result);
    },
    async getBucketCorsConfiguration() {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new GetBucketCorsCommand({ Bucket: bucket }),
            { abortSignal },
          ),
      );
      return normalizeS3BrowserUploadCorsConfiguration(result);
    },
    async putObject(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: input.key,
              Body: input.body,
              ContentLength: input.body.byteLength,
              ContentType: input.contentType,
              Metadata: input.metadata,
              IfNoneMatch: input.ifNoneMatch,
            }),
            { abortSignal },
          ),
      );
      return { VersionId: result.VersionId, ETag: result.ETag };
    },
    async headObject(input) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: input.key,
              VersionId: input.versionId,
              ChecksumMode: input.checksumMode,
            }),
            { abortSignal },
          ),
      );
    },
    async getObject(input) {
      return withS3StreamingOperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        async (abortSignal) => {
          const result = await client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: input.key,
              VersionId: input.versionId,
              IfMatch: `"${input.expectedEtag}"`,
            }),
            { abortSignal },
          );
          return {
            VersionId: result.VersionId,
            ETag: result.ETag,
            ContentLength: result.ContentLength,
            ContentType: result.ContentType,
            Metadata: result.Metadata,
            body: streamBody(result.Body),
          };
        },
      );
    },
    async copyObject(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new CopyObjectCommand({
              Bucket: bucket,
              Key: input.targetKey,
              CopySource: versionedS3CopySource(
                bucket,
                input.sourceKey,
                input.sourceVersionId,
              ),
              CopySourceIfMatch: `"${input.sourceEtag}"`,
              ContentType: input.contentType,
              CacheControl: "private, no-store",
              MetadataDirective: "REPLACE",
              Metadata: input.metadata,
            }),
            { abortSignal },
          ),
      );
      return {
        VersionId: result.VersionId,
        ETag: result.CopyObjectResult?.ETag,
      };
    },
    async createMultipartUpload(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new CreateMultipartUploadCommand({
              Bucket: bucket,
              Key: input.key,
              ContentType: input.contentType,
              Metadata: input.metadata,
              ChecksumAlgorithm: "SHA256",
              ChecksumType: "COMPOSITE",
            }),
            { abortSignal },
          ),
      );
      return {
        Bucket: result.Bucket,
        Key: result.Key,
        UploadId: result.UploadId,
        ChecksumAlgorithm: result.ChecksumAlgorithm,
        ChecksumType: result.ChecksumType,
      };
    },
    async uploadPart(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new UploadPartCommand({
              Bucket: bucket,
              Key: input.key,
              UploadId: input.uploadId,
              PartNumber: input.partNumber,
              Body: input.body,
              ContentLength: input.body.byteLength,
              ChecksumSHA256: input.checksumSha256,
            }),
            { abortSignal },
          ),
      );
      return { ETag: result.ETag, ChecksumSHA256: result.ChecksumSHA256 };
    },
    async browserUploadPart(input) {
      const url = await getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: input.partNumber,
          ContentLength: input.body.byteLength,
          ChecksumSHA256: input.checksumSha256,
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
      return uploadS3MultipartPartLikeBrowser({
        url,
        expectedOrigin: input.expectedOrigin,
        body: input.body,
        checksumSha256: input.checksumSha256,
        contentType: input.contentType,
      });
    },
    async listMultipartParts(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new ListPartsCommand({
              Bucket: bucket,
              Key: input.key,
              UploadId: input.uploadId,
              MaxParts: 1_000,
            }),
            { abortSignal },
          ),
      );
      return {
        isTruncated: result.IsTruncated === true,
        bucket: result.Bucket,
        key: result.Key,
        uploadId: result.UploadId,
        checksumAlgorithm: result.ChecksumAlgorithm,
        checksumType: result.ChecksumType,
        parts: (result.Parts ?? []).map((part) => ({
          partNumber: part.PartNumber,
          sizeBytes: part.Size,
          etag: part.ETag,
          checksumSha256: part.ChecksumSHA256,
        })),
      };
    },
    async completeMultipartUpload(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new CompleteMultipartUploadCommand({
              Bucket: bucket,
              Key: input.key,
              UploadId: input.uploadId,
              MultipartUpload: {
                Parts: input.parts.map((part) => ({
                  PartNumber: part.partNumber,
                  ETag: `"${part.etag}"`,
                  ChecksumSHA256: part.checksumSha256,
                })),
              },
              ChecksumType: "COMPOSITE",
              MpuObjectSize: input.expectedSizeBytes,
            }),
            { abortSignal },
          ),
      );
      return {
        VersionId: result.VersionId,
        ETag: result.ETag,
        ChecksumSHA256: result.ChecksumSHA256,
        ChecksumType: result.ChecksumType,
      };
    },
    async abortMultipartUpload(input) {
      await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new AbortMultipartUploadCommand({
              Bucket: bucket,
              Key: input.key,
              UploadId: input.uploadId,
            }),
            { abortSignal },
          ),
      );
    },
    async multipartUploadExists(input) {
      try {
        await withS3OperationDeadline(
          S3_PREFLIGHT_COMMAND_DEADLINE_MS,
          (abortSignal) =>
            client.send(
              new ListPartsCommand({
                Bucket: bucket,
                Key: input.key,
                UploadId: input.uploadId,
                MaxParts: 1,
              }),
              { abortSignal },
            ),
        );
        return true;
      } catch (error) {
        if (isMissingMultipartUpload(error)) return false;
        throw error;
      }
    },
    async objectExists(input) {
      return exactObjectVersionExists(input.key);
    },
    async cleanupMultipartUploads(targets) {
      for (const target of targets) {
        try {
          await withS3OperationDeadline(
            S3_PREFLIGHT_COMMAND_DEADLINE_MS,
            (abortSignal) =>
              client.send(
                new AbortMultipartUploadCommand({
                  Bucket: bucket,
                  Key: target.key,
                  UploadId: target.uploadId,
                }),
                { abortSignal },
              ),
          );
        } catch (error) {
          if (!isMissingMultipartUpload(error)) throw error;
        }
      }
    },
    async deleteObject(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: input.key,
            }),
            { abortSignal },
          ),
      );
      return {
        DeleteMarker: result.DeleteMarker,
        VersionId: result.VersionId,
      };
    },
    async listObjectVersions(input) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: input.prefix,
              KeyMarker: input.keyMarker,
              VersionIdMarker: input.versionIdMarker,
              MaxKeys: 32,
            }),
            { abortSignal },
          ),
      );
      return {
        isTruncated: result.IsTruncated === true,
        nextKeyMarker: result.NextKeyMarker,
        nextVersionIdMarker: result.NextVersionIdMarker,
        versions: (result.Versions ?? []).map((entry) => ({
          key: entry.Key,
          versionId: entry.VersionId,
        })),
        deleteMarkers: (result.DeleteMarkers ?? []).map((entry) => ({
          key: entry.Key,
          versionId: entry.VersionId,
        })),
      };
    },
    async deleteObjectVersions(targets) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          client.send(
            new DeleteObjectsCommand({
              Bucket: bucket,
              Delete: {
                Objects: targets.map((target) => ({
                  Key: target.key,
                  VersionId: target.versionId,
                })),
                Quiet: true,
              },
            }),
            { abortSignal },
          ),
      );
      return { errorCount: result.Errors?.length ?? 0 };
    },
  };
}
