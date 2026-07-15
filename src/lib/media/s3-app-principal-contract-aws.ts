import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
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
import type { S3AppPrincipalContractAdapter } from "./s3-app-principal-contract";
import { normalizeS3LifecycleConfiguration } from "./s3-privacy-export-lifecycle";

export type AwsS3AppPrincipalContractAdapter =
  S3AppPrincipalContractAdapter & Readonly<{ destroy(): void }>;

const APP_PRINCIPAL_CANARY_KEY_COUNT = 5;
const APP_PRINCIPAL_CLEANUP_MAX_PAGES_PER_KEY = 32;
const APP_PRINCIPAL_CLEANUP_VERIFICATION_PASSES = 3;

type CleanupTarget = Readonly<{ key: string; versionId: string }>;
type CleanupPage = Readonly<{
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
  versions: ReadonlyArray<Readonly<{ key?: string; versionId?: string }>>;
  deleteMarkers: ReadonlyArray<Readonly<{ key?: string; versionId?: string }>>;
}>;

async function listExactCleanupTargets(input: {
  key: string;
  listPage(markers: {
    keyMarker?: string;
    versionIdMarker?: string;
  }): Promise<CleanupPage>;
}) {
  const targets = new Map<string, CleanupTarget>();
  const seenCursors = new Set<string>();
  let keyMarker: string | undefined;
  let versionIdMarker: string | undefined;
  for (
    let page = 0;
    page < APP_PRINCIPAL_CLEANUP_MAX_PAGES_PER_KEY;
    page += 1
  ) {
    const cursor = `${keyMarker ?? ""}\0${versionIdMarker ?? ""}`;
    if (seenCursors.has(cursor)) {
      throw new Error("The S3 provider repeated a cleanup cursor.");
    }
    seenCursors.add(cursor);
    const result = await input.listPage({ keyMarker, versionIdMarker });
    for (const entry of [
      ...result.versions,
      ...result.deleteMarkers,
    ]) {
      if (entry.key !== input.key) continue;
      const versionId = entry.versionId?.trim();
      if (!versionId) {
        throw new Error("The S3 provider returned an invalid cleanup version.");
      }
      targets.set(`${input.key}\0${versionId}`, {
        key: input.key,
        versionId,
      });
    }
    if (!result.isTruncated) return [...targets.values()];
    if (!result.nextKeyMarker || !result.nextVersionIdMarker) {
      throw new Error("The S3 provider omitted a cleanup cursor.");
    }
    keyMarker = result.nextKeyMarker;
    versionIdMarker = result.nextVersionIdMarker;
  }
  throw new Error("The S3 cleanup exceeded its page limit.");
}

export async function cleanupExactS3AppPrincipalKeys(input: {
  keys: readonly string[];
  deleteCurrent(key: string): Promise<void>;
  listPage(
    key: string,
    markers: { keyMarker?: string; versionIdMarker?: string },
  ): Promise<CleanupPage>;
  deleteVersions(targets: readonly CleanupTarget[]): Promise<{
    errorCount: number;
  }>;
}) {
  if (
    input.keys.length !== APP_PRINCIPAL_CANARY_KEY_COUNT ||
    new Set(input.keys).size !== input.keys.length ||
    input.keys.some((key) => !key || key.length > 1_024)
  ) {
    throw new Error("The S3 cleanup key set is invalid.");
  }

  await Promise.all(
    input.keys.map(async (key) => {
      try {
        await input.deleteCurrent(key);
      } catch {
        // Version inventory and exact-version deletion below are authoritative.
      }
    }),
  );

  const listAll = async () =>
    (
      await Promise.all(
        input.keys.map((key) =>
          listExactCleanupTargets({
            key,
            listPage: (markers) => input.listPage(key, markers),
          }),
        ),
      )
    ).flat();

  for (
    let pass = 0;
    pass < APP_PRINCIPAL_CLEANUP_VERIFICATION_PASSES;
    pass += 1
  ) {
    const targets = await listAll();
    if (!targets.length) return;
    for (let offset = 0; offset < targets.length; offset += 1_000) {
      try {
        await input.deleteVersions(targets.slice(offset, offset + 1_000));
      } catch {
        // A later exact inventory verifies the result and retries leftovers.
      }
    }
  }

  if ((await listAll()).length) {
    throw new Error("The S3 provider retained app-principal canary versions.");
  }
}

function client(configuration: S3MediaStorageConfiguration) {
  return new S3Client({
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
}

function streamBody(body: unknown): AsyncIterable<Uint8Array> {
  if (body && typeof body === "object" && Symbol.asyncIterator in body) {
    return body as AsyncIterable<Uint8Array>;
  }
  throw new Error("The S3 response body is not streamable.");
}

function httpStatus(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}

function errorName(error: unknown) {
  return error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
}

function quotedEtag(etag: string) {
  return /^"[^"]+"$/.test(etag) ? etag : `"${etag}"`;
}

function sameProvider(
  worker: S3MediaStorageConfiguration,
  app: S3MediaStorageConfiguration,
) {
  return (
    worker.endpoint === app.endpoint &&
    worker.region === app.region &&
    worker.bucket === app.bucket &&
    worker.forcePathStyle === app.forcePathStyle
  );
}

export function createAwsS3AppPrincipalContractAdapter(input: {
  workerConfiguration: S3MediaStorageConfiguration;
  appConfiguration: S3MediaStorageConfiguration;
}): AwsS3AppPrincipalContractAdapter {
  if (!sameProvider(input.workerConfiguration, input.appConfiguration)) {
    throw new Error("The app and worker S3 configurations target different providers.");
  }
  if (
    input.workerConfiguration.accessKeyId ===
    input.appConfiguration.accessKeyId
  ) {
    throw new Error("The app and worker S3 principals are not distinct.");
  }
  const workerClient = client(input.workerConfiguration);
  const appClient = client(input.appConfiguration);
  const bucket = input.workerConfiguration.bucket;

  async function putObject(
    targetClient: S3Client,
    value: Parameters<S3AppPrincipalContractAdapter["appPutObject"]>[0],
  ) {
    const result = await withS3OperationDeadline(
      S3_PREFLIGHT_COMMAND_DEADLINE_MS,
      (abortSignal) =>
        targetClient.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: value.key,
            Body: value.body,
            ContentLength: value.body.byteLength,
            ContentType: value.contentType,
            Metadata: value.metadata,
            Tagging: value.tagging,
            IfNoneMatch: value.ifNoneMatch,
          }),
          { abortSignal },
        ),
    );
    return { VersionId: result.VersionId, ETag: result.ETag };
  }

  async function listExactVersions(key: string) {
    const targets = new Map<string, { Key: string; VersionId: string }>();
    const seenCursors = new Set<string>();
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (
      let page = 0;
      page < APP_PRINCIPAL_CLEANUP_MAX_PAGES_PER_KEY;
      page += 1
    ) {
      const cursor = `${keyMarker ?? ""}\0${versionIdMarker ?? ""}`;
      if (seenCursors.has(cursor)) {
        throw new Error("The S3 provider repeated a cleanup cursor.");
      }
      seenCursors.add(cursor);
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          workerClient.send(
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
      for (const entry of [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])]) {
        if (entry.Key !== key) continue;
        const versionId = entry.VersionId?.trim();
        if (!versionId) {
          throw new Error("The S3 provider returned an invalid cleanup version.");
        }
        targets.set(`${key}\0${versionId}`, { Key: key, VersionId: versionId });
      }
      if (!result.IsTruncated) return [...targets.values()];
      if (!result.NextKeyMarker || !result.NextVersionIdMarker) {
        throw new Error("The S3 provider omitted a cleanup cursor.");
      }
      keyMarker = result.NextKeyMarker;
      versionIdMarker = result.NextVersionIdMarker;
    }
    throw new Error("The S3 cleanup exceeded its page limit.");
  }

  return {
    bucket,
    destroy() {
      appClient.destroy();
      workerClient.destroy();
    },
    async getBucketVersioning() {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          workerClient.send(
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
          workerClient.send(
            new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }),
            { abortSignal },
          ),
      );
      return normalizeS3LifecycleConfiguration(result);
    },
    seedObject(value) {
      return putObject(workerClient, value);
    },
    appPutObject(value) {
      return putObject(appClient, value);
    },
    async appHeadObject(value) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          appClient.send(
            new HeadObjectCommand({
              Bucket: bucket,
              Key: value.key,
              VersionId: value.versionId,
            }),
            { abortSignal },
          ),
      );
    },
    async appGetObject(value) {
      return withS3StreamingOperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        async (abortSignal) => {
          const result = await appClient.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: value.key,
              VersionId: value.versionId,
              IfMatch: quotedEtag(value.expectedEtag),
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
    async appCopyObject(value) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          appClient.send(
            new CopyObjectCommand({
              Bucket: bucket,
              Key: value.targetKey,
              CopySource: versionedS3CopySource(
                bucket,
                value.sourceKey,
                value.sourceVersionId,
              ),
              CopySourceIfMatch: quotedEtag(value.sourceEtag),
              ContentType: value.contentType,
              MetadataDirective: "REPLACE",
              Metadata: value.metadata,
            }),
            { abortSignal },
          ),
      );
    },
    async appListObjects(value) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          appClient.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: value.prefix,
              MaxKeys: 1,
            }),
            { abortSignal },
          ),
      );
    },
    async appListObjectVersions(value) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          appClient.send(
            new ListObjectVersionsCommand({
              Bucket: bucket,
              Prefix: value.prefix,
              MaxKeys: 1,
            }),
            { abortSignal },
          ),
      );
    },
    async appDeleteObject(value) {
      return withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          appClient.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: value.key,
              VersionId: value.versionId,
              IfMatch: value.expectedEtag
                ? quotedEtag(value.expectedEtag)
                : undefined,
            }),
            { abortSignal },
        ),
      );
    },
    async getExactObjectTags(value) {
      const result = await withS3OperationDeadline(
        S3_PREFLIGHT_COMMAND_DEADLINE_MS,
        (abortSignal) =>
          workerClient.send(
            new GetObjectTaggingCommand({
              Bucket: bucket,
              Key: value.key,
              VersionId: value.versionId,
            }),
            { abortSignal },
          ),
      );
      return (result.TagSet ?? []).map((tag) => ({
        key: tag.Key,
        value: tag.Value,
      }));
    },
    async exactVersionExists(value) {
      const versions = await listExactVersions(value.key);
      return versions.some((entry) => entry.VersionId === value.versionId);
    },
    async cleanupExactKeys(keys) {
      await cleanupExactS3AppPrincipalKeys({
        keys,
        deleteCurrent: async (key) => {
          await withS3OperationDeadline(
            S3_PREFLIGHT_COMMAND_DEADLINE_MS,
            (abortSignal) =>
              workerClient.send(
                new DeleteObjectCommand({ Bucket: bucket, Key: key }),
                { abortSignal },
              ),
          );
        },
        listPage: async (key, markers) => {
          const result = await withS3OperationDeadline(
            S3_PREFLIGHT_COMMAND_DEADLINE_MS,
            (abortSignal) =>
              workerClient.send(
                new ListObjectVersionsCommand({
                  Bucket: bucket,
                  Prefix: key,
                  KeyMarker: markers.keyMarker,
                  VersionIdMarker: markers.versionIdMarker,
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
        deleteVersions: async (targets) => {
          const result = await withS3OperationDeadline(
            S3_PREFLIGHT_COMMAND_DEADLINE_MS,
            (abortSignal) =>
              workerClient.send(
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
      });
    },
    isAuthorizationDenied(error) {
      return (
        httpStatus(error) === 403 ||
        ["AccessDenied", "Forbidden"].includes(errorName(error))
      );
    },
  };
}
