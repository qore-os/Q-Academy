import "server-only";

import type { Readable } from "node:stream";

import {
  copyFilesystemMediaObject,
  deleteFilesystemMediaObject,
  inspectFilesystemMediaObject,
  promoteFilesystemMediaObject,
  readFilesystemMediaObject,
  writeFilesystemMediaObject,
} from "@/lib/media/filesystem-storage";
import {
  copyS3MediaObject,
  createS3DownloadAuthorization,
  createS3UploadAuthorization,
  deleteS3Object,
  deleteS3ObjectRevision,
  getS3ObjectForDownload,
  getS3ObjectForScanning,
  inspectS3Object,
  promoteS3Object,
  putS3ProcessedObject,
} from "@/lib/media/s3-storage";
import type { MediaObjectIdentity } from "@/lib/media/storage-key";
import {
  getMediaStorageConfiguration,
  getPublicAppUrl,
} from "@/lib/server-environment";

type UploadAuthorizationInput = MediaObjectIdentity &
  Readonly<{ mimeType: string; sizeBytes: number }>;

function assetContentUrl(assetId: string) {
  return new URL(
    `/api/v1/media-assets/${assetId}/content`,
    getPublicAppUrl(),
  ).toString();
}

export function mediaStorageLimits() {
  return getMediaStorageConfiguration().limits;
}

export function mediaMalwareScannerConfiguration() {
  return getMediaStorageConfiguration().clamAv;
}

export async function createMediaUploadAuthorization(
  input: UploadAuthorizationInput,
) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    const authorization = await createS3UploadAuthorization(
      configuration,
      input,
    );
    return { ...authorization, transport: "s3" as const };
  }
  return {
    transport: "application" as const,
    method: "PUT" as const,
    url: assetContentUrl(input.assetId),
    headers: {
      "Content-Length": String(input.sizeBytes),
      "Content-Type": input.mimeType,
      "If-None-Match": "*",
    },
    expiresInSeconds: null,
  };
}

export async function writeDevelopmentMediaObject(input: {
  identity: MediaObjectIdentity;
  body: AsyncIterable<Uint8Array>;
  expectedSizeBytes: number;
}) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver !== "filesystem") {
    throw new Error("Application-streamed uploads are disabled for S3 storage.");
  }
  return writeFilesystemMediaObject(
    configuration,
    input.identity,
    input.body,
    input.expectedSizeBytes,
  );
}

export async function writeProcessedMediaObject(input: {
  identity: MediaObjectIdentity;
  body: Readable;
  mimeType: string;
  expectedSizeBytes: number;
  contentSha256: string;
  sourceSha256: string;
  processingJobId: string;
}) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    return putS3ProcessedObject(configuration, {
      ...input.identity,
      body: input.body,
      mimeType: input.mimeType,
      sizeBytes: input.expectedSizeBytes,
      contentSha256: input.contentSha256,
      sourceSha256: input.sourceSha256,
      processingJobId: input.processingJobId,
    });
  }
  await writeFilesystemMediaObject(
    configuration,
    input.identity,
    input.body,
    input.expectedSizeBytes,
  );
  return {
    etag: null,
    versionId: null,
    sizeBytes: input.expectedSizeBytes,
    sha256: input.contentSha256,
  };
}

export async function inspectStoredMediaObject(identity: MediaObjectIdentity) {
  const configuration = getMediaStorageConfiguration();
  return configuration.driver === "s3"
    ? inspectS3Object(configuration, identity)
    : inspectFilesystemMediaObject(configuration, identity);
}

function asyncBody(body: object): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in body) {
    return body as AsyncIterable<Uint8Array>;
  }
  throw new Error("The stored media body is not streamable.");
}

export async function getStoredMediaObjectForScanning(
  identity: MediaObjectIdentity,
  expectedEtag: string | null,
  expectedVersionId: string | null,
) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    if (!expectedEtag || !expectedVersionId) {
      throw new Error(
        "An S3 media scan requires a stable object ETag and VersionId.",
      );
    }
    const object = await getS3ObjectForScanning(configuration, {
      ...identity,
      expectedEtag,
      expectedVersionId,
    });
    return {
      body: asyncBody(object.body),
      sizeBytes: object.sizeBytes,
      mimeType: object.mimeType,
    };
  }
  const body: Readable = readFilesystemMediaObject(configuration, identity);
  const metadata = await inspectFilesystemMediaObject(configuration, identity);
  return {
    body: asyncBody(body),
    sizeBytes: metadata.sizeBytes,
    mimeType: null,
  };
}

export async function getFilesystemMediaObjectForDownload(
  identity: MediaObjectIdentity,
  range?: Readonly<{ start: number; end: number }>,
) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver !== "filesystem") {
    throw new Error("Application-streamed downloads require filesystem storage.");
  }
  const metadata = await inspectFilesystemMediaObject(configuration, identity);
  return {
    body: asyncBody(readFilesystemMediaObject(configuration, identity, range)),
    sizeBytes: metadata.sizeBytes,
  };
}

export function mediaS3DownloadsRequireProxy() {
  const configuration = getMediaStorageConfiguration();
  return (
    configuration.driver === "s3" &&
    configuration.compatibilityMode === "strato-hidrive"
  );
}

export async function getS3MediaObjectForDownload(input: {
  identity: MediaObjectIdentity;
  versionId: string;
  expectedEtag: string;
  expectedSha256: string;
  expectedSizeBytes: number;
  expectedMimeType: string;
  range?: Readonly<{ start: number; end: number }>;
}) {
  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    configuration.compatibilityMode !== "strato-hidrive"
  ) {
    throw new Error("Application-proxied S3 downloads require STRATO mode.");
  }
  return getS3ObjectForDownload(configuration, {
    ...input.identity,
    versionId: input.versionId,
    expectedEtag: input.expectedEtag,
    expectedSha256: input.expectedSha256,
    expectedSizeBytes: input.expectedSizeBytes,
    expectedMimeType: input.expectedMimeType,
    range: input.range,
  });
}

export async function promoteStoredMediaObject(input: {
  source: MediaObjectIdentity;
  target: MediaObjectIdentity;
  expectedEtag: string | null;
  expectedSourceVersionId: string | null;
  expectedSha256: string;
  expectedSizeBytes: number;
  mimeType: string;
  signal?: AbortSignal;
}) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    if (!input.expectedEtag || !input.expectedSourceVersionId) {
      throw new Error(
        "An S3 media promotion requires a stable source ETag and VersionId.",
      );
    }
    return promoteS3Object(configuration, {
      source: input.source,
      target: input.target,
      expectedEtag: input.expectedEtag,
      expectedSourceVersionId: input.expectedSourceVersionId,
      expectedSha256: input.expectedSha256,
      expectedSizeBytes: input.expectedSizeBytes,
      mimeType: input.mimeType,
      signal: input.signal,
    });
  }
  const promoted = await promoteFilesystemMediaObject(configuration, {
    source: input.source,
    target: input.target,
    expectedSha256: input.expectedSha256,
    signal: input.signal,
  });
  return {
    ...promoted,
    etag: null,
    versionId: null,
    sha256: input.expectedSha256,
  };
}

export async function copyStoredMediaObject(input: {
  source: MediaObjectIdentity;
  target: MediaObjectIdentity;
  expectedEtag: string | null;
  expectedSourceVersionId: string | null;
  expectedSha256: string;
  expectedSizeBytes: number;
  mimeType: string;
  signal?: AbortSignal;
}) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    if (!input.expectedEtag || !input.expectedSourceVersionId) {
      throw new Error(
        "An S3 cross-tenant copy requires a stable ETag and VersionId.",
      );
    }
    return copyS3MediaObject(configuration, {
      ...input,
      expectedEtag: input.expectedEtag,
      expectedSourceVersionId: input.expectedSourceVersionId,
    });
  }
  const copied = await copyFilesystemMediaObject(configuration, input);
  return {
    ...copied,
    etag: null,
    versionId: null,
    sha256: input.expectedSha256,
  };
}

export async function createMediaDownloadAuthorization(input: {
  identity: MediaObjectIdentity;
  safeFileName: string;
  disposition: "inline" | "attachment";
  storageVersionId: string | null;
  expectedEtag: string | null;
  expectedSha256: string | null;
  expectedSizeBytes: number | null;
  expectedMimeType: string;
}) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver === "s3") {
    if (
      !input.storageVersionId ||
      !input.expectedEtag ||
      !input.expectedSha256 ||
      !Number.isSafeInteger(input.expectedSizeBytes) ||
      (input.expectedSizeBytes ?? 0) <= 0
    ) {
      throw new Error(
        "An S3 media download requires an immutable scan identity.",
      );
    }
    const authorization = await createS3DownloadAuthorization(configuration, {
      ...input.identity,
      safeFileName: input.safeFileName,
      disposition: input.disposition,
      versionId: input.storageVersionId,
      expectedEtag: input.expectedEtag,
      expectedSha256: input.expectedSha256,
      expectedSizeBytes: input.expectedSizeBytes!,
      expectedMimeType: input.expectedMimeType,
    });
    return { ...authorization, transport: "s3" as const };
  }
  const url = new URL(assetContentUrl(input.identity.assetId));
  url.searchParams.set("disposition", input.disposition);
  return {
    transport: "application" as const,
    url: url.toString(),
    expiresInSeconds: null,
  };
}

export async function deleteStoredMediaObject(
  identity: MediaObjectIdentity,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const configuration = getMediaStorageConfiguration();
  return configuration.driver === "s3"
    ? deleteS3Object(configuration, identity, signal)
    : deleteFilesystemMediaObject(configuration, identity, signal);
}

export async function deleteStoredMediaObjectRevision(
  identity: MediaObjectIdentity,
  versionId: string,
) {
  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    configuration.compatibilityMode !== "versioned"
  ) {
    throw new Error("Exact media revision deletion requires versioned S3.");
  }
  return deleteS3ObjectRevision(configuration, identity, versionId);
}
