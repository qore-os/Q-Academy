import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { S3MediaStorageConfiguration } from "./storage-configuration";
import { versionedS3CopySource } from "./s3-object-integrity";
import {
  createS3NodeHttpHandler,
  S3_PREFLIGHT_COMMAND_DEADLINE_MS,
  withS3OperationDeadline,
  withS3StreamingOperationDeadline,
} from "./s3-operation-timeout";
import type { S3ProviderContractAdapter } from "./s3-provider-contract";
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
