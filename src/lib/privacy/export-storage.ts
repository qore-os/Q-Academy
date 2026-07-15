import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createS3NodeHttpHandler } from "@/lib/media/s3-operation-timeout";
import type { S3MediaStorageConfiguration } from "@/lib/media/storage-configuration";
import {
  normalizeS3Etag,
  requireS3VersionId,
  requireStratoEtagRevision,
  s3ObjectLocator,
  stratoEtagRevision,
} from "@/lib/media/s3-object-integrity";
import { S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING } from "@/lib/media/s3-privacy-export-lifecycle";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import {
  beforeDeadline,
  BoundedObjectReadError,
  disposeObjectBody,
  readBoundedFile,
  readBoundedObjectBody,
} from "@/lib/privacy/bounded-object-reader";
import { stringifyBoundedJson } from "@/lib/privacy/bounded-json";
import {
  MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES,
  MAX_PRIVACY_EXPORT_STORED_BYTES,
  MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
  PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS,
} from "@/lib/privacy/export-limits";
const FILESYSTEM_ROOT = path.resolve(".data/privacy-exports");
const STORAGE_KEY_PATTERN =
  /^tenants\/([0-9a-f-]{36})\/privacy-exports\/([0-9a-f-]{36})\/([0-9a-f-]{36})[.]enc$/i;

type StoredEnvelope = {
  format: "q-academy-encrypted-privacy-export";
  encoding?: "utf8" | "base64";
  payload: unknown;
};

export class PrivacyExportStorageError extends Error {
  readonly code:
    | "invalid_export"
    | "invalid_storage_key"
    | "object_exists"
    | "object_missing"
    | "object_mismatch"
    | "storage_unavailable";

  constructor(
    code: PrivacyExportStorageError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PrivacyExportStorageError";
    this.code = code;
  }
}

function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

function associatedData(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
}) {
  return [
    "q-academy:privacy-export:v1",
    input.organizationId,
    input.requestId,
    input.artifactId,
  ].join("\n");
}

export function privacyExportStorageKey(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
}) {
  return `tenants/${input.organizationId}/privacy-exports/${input.requestId}/${input.artifactId}.enc`;
}

function assertStorageKey(
  storageKey: string,
  expected: { organizationId: string; requestId: string; artifactId: string },
) {
  const match = STORAGE_KEY_PATTERN.exec(storageKey);
  if (
    !match ||
    match[1]?.toLowerCase() !== expected.organizationId.toLowerCase() ||
    match[2]?.toLowerCase() !== expected.requestId.toLowerCase() ||
    match[3]?.toLowerCase() !== expected.artifactId.toLowerCase()
  ) {
    throw new PrivacyExportStorageError(
      "invalid_storage_key",
      "The privacy export storage key is invalid.",
    );
  }
}

function filesystemPath(storageKey: string) {
  const target = path.resolve(FILESYSTEM_ROOT, ...storageKey.split("/"));
  const relative = path.relative(FILESYSTEM_ROOT, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new PrivacyExportStorageError(
      "invalid_storage_key",
      "The privacy export path is invalid.",
    );
  }
  return target;
}

function serializedExport(payload: unknown) {
  try {
    const serialized = stringifyBoundedJson(payload, {
      maxBytes: MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
      space: 2,
      trailingNewline: true,
    });
    return Buffer.from(serialized.json, "utf8");
  } catch (error) {
    throw new PrivacyExportStorageError(
      "invalid_export",
      "The JSON export exceeds the supported size limit.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

function encryptedEnvelope(
  plaintext: Buffer,
  input: { organizationId: string; requestId: string; artifactId: string },
  encoding: "utf8" | "base64",
) {
  const envelope: StoredEnvelope = {
    format: "q-academy-encrypted-privacy-export",
    encoding,
    payload: encryptPayload(
      encoding === "utf8"
        ? plaintext.toString("utf8")
        : plaintext.toString("base64"),
      associatedData(input),
    ),
  };
  try {
    const serialized = stringifyBoundedJson(envelope, {
      maxBytes: MAX_PRIVACY_EXPORT_STORED_BYTES,
    });
    return Buffer.from(serialized.json, "utf8");
  } catch (error) {
    throw new PrivacyExportStorageError(
      "invalid_export",
      "The encrypted JSON export exceeds the storage limit.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
}

async function writeFilesystemObject(storageKey: string, bytes: Buffer) {
  const target = filesystemPath(storageKey);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    // A hard link publishes the already-fsynced object atomically and fails if
    // an immutable artifact with the same key already exists.
    await link(temporary, target);
    await rm(temporary).catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
      throw new PrivacyExportStorageError(
        "object_exists",
        "The privacy export object already exists.",
      );
    }
    throw new PrivacyExportStorageError(
      "storage_unavailable",
      "The privacy export could not be stored.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  return {
    driver: "filesystem" as const,
    storageVersionId: null,
    storageEtag: null,
  };
}

function quotedEtag(etag: string) {
  return /^"[^"]+"$/.test(etag) ? etag : `"${etag}"`;
}

const s3Clients = new Map<string, S3Client>();

function s3Client(configuration: Extract<
  ReturnType<typeof getMediaStorageConfiguration>,
  { driver: "s3" }
>) {
  const fingerprint = sha256(
    [
      configuration.endpoint,
      configuration.region,
      configuration.bucket,
      configuration.accessKeyId,
      configuration.secretAccessKey,
      String(configuration.forcePathStyle),
      configuration.compatibilityMode,
    ].join("\0"),
  );
  const cached = s3Clients.get(fingerprint);
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
  s3Clients.set(fingerprint, client);
  return client;
}

function storageFailure(error: unknown): never {
  const status =
    error && typeof error === "object" && "$metadata" in error
      ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
      : undefined;
  if (status === 404) {
    throw new PrivacyExportStorageError(
      "object_missing",
      "The privacy export object is missing.",
    );
  }
  if (status === 412) {
    throw new PrivacyExportStorageError(
      "object_exists",
      "The privacy export object already exists.",
    );
  }
  throw new PrivacyExportStorageError(
    "storage_unavailable",
    "The privacy export storage service is unavailable.",
    error instanceof Error ? { cause: error } : undefined,
  );
}

async function writeS3Object(storageKey: string, bytes: Buffer) {
  const configuration = getMediaStorageConfiguration();
  if (configuration.driver !== "s3") {
    throw new PrivacyExportStorageError(
      "storage_unavailable",
      "S3 privacy export storage is not configured.",
    );
  }
  try {
    const response = await s3Client(configuration).send(
      new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: storageKey,
        Body: bytes,
        ContentLength: bytes.byteLength,
        ContentType: "application/vnd.q-academy.encrypted+json",
        ...(configuration.compatibilityMode === "versioned"
          ? { Tagging: S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING }
          : {}),
        IfNoneMatch: "*",
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
    const etag = normalizeS3Etag(response.ETag);
    return {
      driver: "s3" as const,
      storageVersionId:
        configuration.compatibilityMode === "strato-hidrive"
          ? stratoEtagRevision(storageKey, etag)
          : requireS3VersionId(response.VersionId),
      storageEtag: etag,
    };
  } catch (error) {
    storageFailure(error);
  }
}

export async function storePrivacyExport(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  payload?: unknown;
  bytes?: Uint8Array;
  manifest?: unknown;
}) {
  const storageKey = privacyExportStorageKey(input);
  assertStorageKey(storageKey, input);
  if ((input.payload === undefined) === (input.bytes === undefined)) {
    throw new PrivacyExportStorageError(
      "invalid_export",
      "Exactly one privacy export payload must be supplied.",
    );
  }
  if (
    input.bytes !== undefined &&
    (!Number.isSafeInteger(input.bytes.byteLength) ||
      input.bytes.byteLength <= 0 ||
      input.bytes.byteLength > MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES)
  ) {
    throw new PrivacyExportStorageError(
      "invalid_export",
      "The privacy export exceeds the supported size limit.",
    );
  }
  const plaintext =
    input.bytes === undefined
      ? serializedExport(input.payload)
      : Buffer.isBuffer(input.bytes)
        ? input.bytes
        : Buffer.from(
            input.bytes.buffer,
            input.bytes.byteOffset,
            input.bytes.byteLength,
          );
  const manifest =
    input.manifest ??
    (input.payload &&
    typeof input.payload === "object" &&
    "exportManifest" in input.payload
      ? (input.payload as { exportManifest: unknown }).exportManifest
      : {});
  let serializedManifest: string;
  try {
    serializedManifest = stringifyBoundedJson(manifest, {
      maxBytes: MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
    }).json;
  } catch (error) {
    throw new PrivacyExportStorageError(
      "invalid_export",
      "The privacy export manifest exceeds the supported size limit.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  const mediaFiles =
    manifest &&
    typeof manifest === "object" &&
    "media" in manifest &&
    Array.isArray(manifest.media)
      ? manifest.media.filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            "included" in entry &&
            entry.included === true,
        ).length
      : 0;
  const stored = encryptedEnvelope(
    plaintext,
    input,
    input.bytes === undefined ? "utf8" : "base64",
  );
  const configuration = getMediaStorageConfiguration();
  const identity =
    configuration.driver === "s3"
      ? await writeS3Object(storageKey, stored)
      : await writeFilesystemObject(storageKey, stored);
  return {
    ...identity,
    storageKey,
    artifactSha256: sha256(plaintext),
    manifestSha256: sha256(serializedManifest),
    sizeBytes: plaintext.byteLength,
    fileCount: input.bytes === undefined ? 1 : mediaFiles + 2,
  };
}

async function readStoredBytes(input: {
  storageKey: string;
  storageDriver: "filesystem" | "s3";
  storageVersionId: string | null;
  storageEtag: string | null;
}) {
  if (input.storageDriver === "filesystem") {
    try {
      return await readBoundedFile({
        path: filesystemPath(input.storageKey),
        maxBytes: MAX_PRIVACY_EXPORT_STORED_BYTES,
        deadlineAt: Date.now() + PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS,
      });
    } catch (error) {
      const code =
        error instanceof BoundedObjectReadError && error.code !== "timeout"
          ? "object_mismatch"
          : (error as NodeJS.ErrnoException)?.code === "ENOENT"
            ? "object_missing"
            : "storage_unavailable";
      throw new PrivacyExportStorageError(
        code,
        "The privacy export object could not be read.",
        error instanceof Error ? { cause: error } : undefined,
      );
    }
  }

  const configuration = getMediaStorageConfiguration();
  if (
    configuration.driver !== "s3" ||
    !input.storageVersionId ||
    !input.storageEtag
  ) {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The immutable S3 export identity is incomplete.",
    );
  }
  const deadlineAt = Date.now() + PRIVACY_EXPORT_OBJECT_READ_TIMEOUT_MS;
  const abortController = new AbortController();
  let responseBody: unknown;
  try {
    const response = await beforeDeadline(
      s3Client(configuration).send(
        new GetObjectCommand({
          Bucket: configuration.bucket,
          ...s3ObjectLocator(
            configuration.compatibilityMode,
            input.storageKey,
            input.storageVersionId,
            input.storageEtag,
          ),
          IfMatch: quotedEtag(input.storageEtag),
        }),
        { abortSignal: abortController.signal },
      ),
      deadlineAt,
    );
    responseBody = response.Body;
    if (normalizeS3Etag(response.ETag) !== input.storageEtag) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The privacy export object ETag changed.",
      );
    }
    const contentLength = response.ContentLength;
    if (
      !responseBody ||
      !Number.isSafeInteger(contentLength) ||
      !contentLength ||
      contentLength <= 0 ||
      contentLength > MAX_PRIVACY_EXPORT_STORED_BYTES
    ) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The privacy export object has an invalid size.",
      );
    }
    return await readBoundedObjectBody({
      body: responseBody,
      maxBytes: MAX_PRIVACY_EXPORT_STORED_BYTES,
      expectedBytes: contentLength,
      deadlineAt,
      abortController,
    });
  } catch (error) {
    abortController.abort(error);
    if (responseBody) disposeObjectBody(responseBody, undefined, error);
    if (error instanceof PrivacyExportStorageError) throw error;
    if (
      error instanceof BoundedObjectReadError &&
      error.code !== "timeout"
    ) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The privacy export object has an invalid body.",
        { cause: error },
      );
    }
    storageFailure(error);
  }
}

export async function readPrivacyExport(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  storageKey: string;
  storageDriver: "filesystem" | "s3";
  storageVersionId: string | null;
  storageEtag: string | null;
  expectedSha256: string;
  expectedSizeBytes: number;
}) {
  assertStorageKey(input.storageKey, input);
  if (
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes <= 0 ||
    input.expectedSizeBytes > MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES
  ) {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The privacy export plaintext size is invalid.",
    );
  }
  const stored = await readStoredBytes(input);
  let envelope: StoredEnvelope;
  try {
    envelope = JSON.parse(stored.toString("utf8")) as StoredEnvelope;
  } catch {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The encrypted privacy export envelope is invalid.",
    );
  }
  if (envelope.format !== "q-academy-encrypted-privacy-export") {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The privacy export envelope format is invalid.",
    );
  }
  let plaintext: Buffer;
  try {
    const decrypted = decryptPayload(envelope.payload, associatedData(input));
    plaintext =
      envelope.encoding === "base64"
        ? Buffer.from(decrypted, "base64")
        : Buffer.from(decrypted, "utf8");
  } catch (error) {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The privacy export could not be authenticated.",
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (
    plaintext.byteLength > MAX_PRIVACY_EXPORT_PLAINTEXT_BYTES ||
    plaintext.byteLength !== input.expectedSizeBytes ||
    sha256(plaintext) !== input.expectedSha256
  ) {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The privacy export integrity check failed.",
    );
  }
  return plaintext;
}

async function deleteStratoPrivacyExport(input: {
  configuration: S3MediaStorageConfiguration;
  storageKey: string;
  storageVersionId: string | null;
  storageEtag: string | null;
  timeoutMs: number;
}) {
  if (input.storageVersionId && input.storageEtag) {
    requireStratoEtagRevision(
      input.storageKey,
      input.storageEtag,
      input.storageVersionId,
    );
    const head = await s3Client(input.configuration).send(
      new HeadObjectCommand({
        Bucket: input.configuration.bucket,
        Key: input.storageKey,
        IfMatch: quotedEtag(input.storageEtag),
      }),
      { abortSignal: AbortSignal.timeout(input.timeoutMs) },
    );
    if (normalizeS3Etag(head.ETag) !== input.storageEtag) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The privacy export object changed before deletion.",
      );
    }
  }
  await s3Client(input.configuration).send(
    new DeleteObjectCommand({
      Bucket: input.configuration.bucket,
      Key: input.storageKey,
    }),
    { abortSignal: AbortSignal.timeout(input.timeoutMs) },
  );
  try {
    await s3Client(input.configuration).send(
      new HeadObjectCommand({
        Bucket: input.configuration.bucket,
        Key: input.storageKey,
      }),
      { abortSignal: AbortSignal.timeout(input.timeoutMs) },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status === 404) return;
    throw error;
  }
  throw new PrivacyExportStorageError(
    "object_mismatch",
    "The privacy export object remained after deletion.",
  );
}

export async function deletePrivacyExport(input: {
  organizationId: string;
  requestId: string;
  artifactId: string;
  storageKey: string;
  storageDriver: "filesystem" | "s3";
  storageVersionId: string | null;
  storageEtag: string | null;
  timeoutMs?: number;
}) {
  assertStorageKey(input.storageKey, input);
  const timeoutMs = input.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("The privacy export delete timeout is invalid.");
  }
  if (input.storageDriver === "filesystem") {
    if (input.storageVersionId || input.storageEtag) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The filesystem export identity is invalid.",
      );
    }
    try {
      await rm(filesystemPath(input.storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw new PrivacyExportStorageError(
          "storage_unavailable",
          "The privacy export object could not be deleted.",
          error instanceof Error ? { cause: error } : undefined,
        );
      }
    }
    return;
  }

  const configuration = getMediaStorageConfiguration();
  if (configuration.driver !== "s3") {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The immutable S3 export identity is incomplete.",
    );
  }
  const hasVersionId = input.storageVersionId !== null;
  const hasEtag = input.storageEtag !== null;
  if (
    (configuration.compatibilityMode === "versioned" &&
      (!hasVersionId || !hasEtag)) ||
    (configuration.compatibilityMode === "strato-hidrive" &&
      hasVersionId !== hasEtag)
  ) {
    throw new PrivacyExportStorageError(
      "object_mismatch",
      "The immutable S3 export identity is incomplete.",
    );
  }
  try {
    if (configuration.compatibilityMode === "strato-hidrive") {
      await deleteStratoPrivacyExport({
        configuration,
        storageKey: input.storageKey,
        storageVersionId: input.storageVersionId,
        storageEtag: input.storageEtag,
        timeoutMs,
      });
      return;
    }
    if (!input.storageVersionId || !input.storageEtag) {
      throw new PrivacyExportStorageError(
        "object_mismatch",
        "The immutable S3 export identity is incomplete.",
      );
    }
    await s3Client(configuration).send(
      new DeleteObjectCommand({
        Bucket: configuration.bucket,
        Key: input.storageKey,
        VersionId: input.storageVersionId,
        IfMatch: quotedEtag(input.storageEtag),
      }),
      { abortSignal: AbortSignal.timeout(timeoutMs) },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
        : undefined;
    if (status !== 404) {
      if (status === 412) {
        throw new PrivacyExportStorageError(
          "object_mismatch",
          "The privacy export object changed before deletion.",
        );
      }
      storageFailure(error);
    }
  }
}
