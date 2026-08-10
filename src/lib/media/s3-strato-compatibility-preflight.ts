import { randomBytes, randomUUID } from "node:crypto";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetBucketCorsCommand,
  type GetBucketCorsOutput,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import {
  normalizeS3Etag,
  s3CopySource,
  stratoEtagRevision,
  verifyS3ObjectIntegrity,
} from "./s3-object-integrity";
import { createS3NodeHttpHandler } from "./s3-operation-timeout";
import { createStratoPresignedPost } from "./s3-presigned-post";
import {
  normalizeS3BrowserUploadOrigins,
  S3BrowserUploadOriginInventoryError,
} from "./s3-browser-upload-origins";
import type { S3MediaStorageConfiguration } from "./storage-configuration";

export const STRATO_COMPATIBILITY_CANARY_ROOT =
  "q-academy-strato-contract-canary/v1";
const COMMAND_TIMEOUT_MS = 60_000;

export class StratoS3CompatibilityError extends Error {
  readonly code:
    | "bucket_confirmation_mismatch"
    | "invalid_configuration"
    | "cors_contract_invalid"
    | "bucket_not_private"
    | "provider_operation_failed"
    | "integrity_verification_failed"
    | "cleanup_failed"
    | "preflight_and_cleanup_failed";
  readonly canaryPrefix: string | null;

  constructor(
    code: StratoS3CompatibilityError["code"],
    message: string,
    canaryPrefix: string | null = null,
  ) {
    super(message);
    this.name = "StratoS3CompatibilityError";
    this.code = code;
    this.canaryPrefix = canaryPrefix;
  }
}

function statusOf(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}

function quotedEtag(etag: string) {
  return `"${normalizeS3Etag(etag)}"`;
}

function objectUrl(configuration: S3MediaStorageConfiguration, key: string) {
  const endpoint = configuration.endpoint.replace(/\/$/, "");
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${endpoint}/${encodeURIComponent(configuration.bucket)}/${encodedKey}`;
}

function bucketUrl(configuration: S3MediaStorageConfiguration) {
  const endpoint = configuration.endpoint.replace(/\/$/, "");
  return `${endpoint}/${encodeURIComponent(configuration.bucket)}`;
}

function listObjectsUrl(
  configuration: S3MediaStorageConfiguration,
  prefix: string,
) {
  const url = new URL(bucketUrl(configuration));
  url.searchParams.set("list-type", "2");
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("max-keys", "1");
  return url.toString();
}

type StratoPresignedPostAuthorization = ReturnType<
  typeof createStratoPresignedPost
>;

async function submitStratoPresignedPost(input: {
  authorization: StratoPresignedPostAuthorization;
  expectedOrigin: string;
  body: Uint8Array;
  filename: string;
  fieldOverrides?: Readonly<Record<string, string>>;
}) {
  const form = new FormData();
  const fields = {
    ...input.authorization.fields,
    ...input.fieldOverrides,
  };
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append(
    "file",
    new Blob([new Uint8Array(input.body)], {
      type: fields["Content-Type"] ?? "application/octet-stream",
    }),
    input.filename,
  );
  const response = await fetch(input.authorization.url, {
    method: input.authorization.method,
    headers: { Origin: input.expectedOrigin },
    body: form,
    redirect: "manual",
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  await response.arrayBuffer();
  return {
    status: response.status,
    allowedOrigin: response.headers.get("access-control-allow-origin"),
  };
}

async function expectPresignedPostRejected(input: {
  authorization: StratoPresignedPostAuthorization;
  expectedOrigin: string;
  body: Uint8Array;
  filename: string;
  fieldOverrides?: Readonly<Record<string, string>>;
  canaryPrefix: string;
}) {
  const response = await submitStratoPresignedPost(input);
  if (response.status < 400 || response.status > 499) {
    throw new StratoS3CompatibilityError(
      "integrity_verification_failed",
      "The STRATO presigned POST policy accepted a manipulated field.",
      input.canaryPrefix,
    );
  }
}

async function expectAnonymousRequestRejected(input: {
  url: string;
  method: "DELETE" | "GET" | "HEAD" | "PUT";
  body?: Uint8Array;
  canaryPrefix: string;
}) {
  const response = await fetch(input.url, {
    method: input.method,
    ...(input.body ? { body: new Uint8Array(input.body) } : {}),
    redirect: "manual",
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  await response.arrayBuffer();
  if (response.status !== 401 && response.status !== 403) {
    throw new StratoS3CompatibilityError(
      "bucket_not_private",
      "The STRATO bucket accepted an anonymous object operation.",
      input.canaryPrefix,
    );
  }
}

function assertCorsContract(
  rules: GetBucketCorsOutput,
  expectedOrigins: readonly string[],
  canaryPrefix: string,
) {
  const corsRules = rules.CORSRules;
  const hasWildcardOrigin = corsRules?.some((rule) =>
    (rule.AllowedOrigins ?? []).some((origin) => origin.includes("*")),
  );
  const matches = !hasWildcardOrigin && expectedOrigins.every((expectedOrigin) =>
    corsRules?.some((rule) => {
      const origins = new Set(rule.AllowedOrigins ?? []);
      const methods = new Set(rule.AllowedMethods ?? []);
      const exposedHeaders = new Set(
        (rule.ExposeHeaders ?? []).map((header) => header.toLowerCase()),
      );
      return (
        origins.has(expectedOrigin) &&
        !origins.has("*") &&
        methods.has("GET") &&
        methods.has("HEAD") &&
        methods.has("POST") &&
        exposedHeaders.has("etag")
      );
    }),
  );
  if (!matches) {
    throw new StratoS3CompatibilityError(
      "cors_contract_invalid",
      "The STRATO bucket does not expose the required browser POST CORS contract.",
      canaryPrefix,
    );
  }
}

function safeError(error: unknown, canaryPrefix: string) {
  if (error instanceof StratoS3CompatibilityError) return error;
  return new StratoS3CompatibilityError(
    "provider_operation_failed",
    "The STRATO provider rejected a required compatibility operation.",
    canaryPrefix,
  );
}

async function expectMissing(client: S3Client, bucket: string, key: string) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
  } catch (error) {
    if (statusOf(error) === 404) return;
    throw error;
  }
  throw new Error("object_remained");
}

export async function runStratoS3CompatibilityPreflight(input: {
  configuration: S3MediaStorageConfiguration;
  confirmBucket: string;
  expectedOrigins: readonly string[];
}) {
  const { configuration } = input;
  if (input.confirmBucket !== configuration.bucket) {
    throw new StratoS3CompatibilityError(
      "bucket_confirmation_mismatch",
      "The explicit bucket confirmation does not match the configured bucket.",
    );
  }
  if (
    configuration.compatibilityMode !== "strato-hidrive" ||
    configuration.endpoint !== "https://s3.hidrive.strato.com" ||
    configuration.region !== "eu-central-1" ||
    configuration.forcePathStyle !== true
  ) {
    throw new StratoS3CompatibilityError(
      "invalid_configuration",
      "The explicit STRATO HiDrive compatibility configuration is invalid.",
    );
  }
  let expectedOrigins: readonly string[];
  try {
    expectedOrigins = normalizeS3BrowserUploadOrigins(input.expectedOrigins);
  } catch (error) {
    if (!(error instanceof S3BrowserUploadOriginInventoryError)) throw error;
    throw new StratoS3CompatibilityError(
      "invalid_configuration",
      "The STRATO browser origin inventory is invalid.",
    );
  }
  const expectedOrigin = expectedOrigins[0]!;

  const client = new S3Client({
    endpoint: configuration.endpoint,
    region: configuration.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: createS3NodeHttpHandler(),
  });
  const canaryPrefix = `${STRATO_COMPATIBILITY_CANARY_ROOT}/${randomUUID()}`;
  const sourceKey = `${canaryPrefix}/source.bin`;
  const browserPostKey = `${canaryPrefix}/browser-post.bin`;
  const browserPostOriginKeys = expectedOrigins.map((_, index) =>
    index === 0
      ? browserPostKey
      : `${canaryPrefix}/browser-post-origin-${index + 1}.bin`,
  );
  const browserPostWrongKeySignedKey = `${canaryPrefix}/browser-post-wrong-key-signed.bin`;
  const browserPostWrongKeyTargetKey = `${canaryPrefix}/browser-post-wrong-key-target.bin`;
  const browserPostWrongSizeKey = `${canaryPrefix}/browser-post-wrong-size.bin`;
  const browserPostWrongMetadataKey = `${canaryPrefix}/browser-post-wrong-metadata.bin`;
  const copyKey = `${canaryPrefix}/copy.bin`;
  const copyConditionMismatchKey = `${canaryPrefix}/copy-wrong-etag.bin`;
  const anonymousPutKey = `${canaryPrefix}/anonymous-put.bin`;
  const anonymousDeleteKey = `${canaryPrefix}/anonymous-delete.bin`;
  const startAfterAKey = `${canaryPrefix}/start-after-a/object.bin`;
  const startAfterBFirstKey = `${canaryPrefix}/start-after-b/a.bin`;
  const startAfterBSecondKey = `${canaryPrefix}/start-after-b/b.bin`;
  const keys = [
    sourceKey,
    ...browserPostOriginKeys,
    browserPostWrongKeySignedKey,
    browserPostWrongKeyTargetKey,
    browserPostWrongSizeKey,
    browserPostWrongMetadataKey,
    copyKey,
    copyConditionMismatchKey,
    anonymousPutKey,
    anonymousDeleteKey,
    startAfterAKey,
    startAfterBFirstKey,
    startAfterBSecondKey,
  ] as const;
  const body = randomBytes(96);
  const contentType = "application/octet-stream";
  const sourceMetadata = {
    "contract-version": "1",
    "object-role": "source",
  };
  let primaryError: StratoS3CompatibilityError | null = null;
  let cleanupError: StratoS3CompatibilityError | null = null;
  let privateBucketVerified = false;
  try {
    await client.send(new HeadBucketCommand({ Bucket: configuration.bucket }), {
      abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const cors = await client.send(
      new GetBucketCorsCommand({ Bucket: configuration.bucket }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    assertCorsContract(cors, expectedOrigins, canaryPrefix);

    const browserPostMetadata = {
      "contract-version": "1",
      "object-role": "browser-post",
    };
    const browserPostAuthorization = createStratoPresignedPost(configuration, {
      key: browserPostKey,
      mimeType: contentType,
      sizeBytes: body.byteLength,
      metadata: browserPostMetadata,
    });
    const browserPostResponse = await submitStratoPresignedPost({
      authorization: browserPostAuthorization,
      expectedOrigin,
      body,
      filename: "browser-post.bin",
    });
    if (
      browserPostResponse.status !== 201 ||
      browserPostResponse.allowedOrigin !== expectedOrigin
    ) {
      throw new StratoS3CompatibilityError(
        "cors_contract_invalid",
        "The STRATO browser-compatible presigned POST contract failed.",
        canaryPrefix,
      );
    }
    for (const [index, origin] of expectedOrigins.entries()) {
      if (index === 0) continue;
      const key = browserPostOriginKeys[index]!;
      const authorization = createStratoPresignedPost(configuration, {
        key,
        mimeType: contentType,
        sizeBytes: body.byteLength,
        metadata: browserPostMetadata,
      });
      const response = await submitStratoPresignedPost({
        authorization,
        expectedOrigin: origin,
        body,
        filename: `browser-post-origin-${index + 1}.bin`,
      });
      if (response.status !== 201 || response.allowedOrigin !== origin) {
        throw new StratoS3CompatibilityError(
          "cors_contract_invalid",
          "The STRATO browser-compatible presigned POST origin inventory failed.",
          canaryPrefix,
        );
      }
    }
    const browserPostHead = await client.send(
      new HeadObjectCommand({
        Bucket: configuration.bucket,
        Key: browserPostKey,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const browserPostIdentity = verifyS3ObjectIntegrity(browserPostHead, {
      compatibilityMode: "strato-hidrive",
      key: browserPostKey,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: browserPostMetadata,
    });
    const browserPostDownloaded = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: browserPostKey,
        IfMatch: quotedEtag(browserPostIdentity.etag),
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    verifyS3ObjectIntegrity(browserPostDownloaded, {
      compatibilityMode: "strato-hidrive",
      key: browserPostKey,
      versionId: browserPostIdentity.versionId,
      etag: browserPostIdentity.etag,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: browserPostMetadata,
    });
    const browserPostBytes =
      await browserPostDownloaded.Body?.transformToByteArray();
    if (
      !browserPostBytes ||
      Buffer.compare(body, Buffer.from(browserPostBytes)) !== 0
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO browser POST changed the canary content.",
        canaryPrefix,
      );
    }

    const wrongKeyAuthorization = createStratoPresignedPost(configuration, {
      key: browserPostWrongKeySignedKey,
      mimeType: contentType,
      sizeBytes: body.byteLength,
      metadata: browserPostMetadata,
    });
    await expectPresignedPostRejected({
      authorization: wrongKeyAuthorization,
      expectedOrigin,
      body,
      filename: "browser-post-wrong-key.bin",
      fieldOverrides: { key: browserPostWrongKeyTargetKey },
      canaryPrefix,
    });
    await expectMissing(
      client,
      configuration.bucket,
      browserPostWrongKeySignedKey,
    );
    await expectMissing(
      client,
      configuration.bucket,
      browserPostWrongKeyTargetKey,
    );

    const wrongSizeAuthorization = createStratoPresignedPost(configuration, {
      key: browserPostWrongSizeKey,
      mimeType: contentType,
      sizeBytes: body.byteLength,
      metadata: browserPostMetadata,
    });
    const oversizedBody = Buffer.concat([body, Buffer.from([0])]);
    await expectPresignedPostRejected({
      authorization: wrongSizeAuthorization,
      expectedOrigin,
      body: oversizedBody,
      filename: "browser-post-wrong-size.bin",
      canaryPrefix,
    });
    await expectMissing(client, configuration.bucket, browserPostWrongSizeKey);

    const wrongMetadataAuthorization = createStratoPresignedPost(
      configuration,
      {
        key: browserPostWrongMetadataKey,
        mimeType: contentType,
        sizeBytes: body.byteLength,
        metadata: browserPostMetadata,
      },
    );
    await expectPresignedPostRejected({
      authorization: wrongMetadataAuthorization,
      expectedOrigin,
      body,
      filename: "browser-post-wrong-metadata.bin",
      fieldOverrides: {
        "x-amz-meta-object-role": "manipulated-browser-post",
      },
      canaryPrefix,
    });
    await expectMissing(
      client,
      configuration.bucket,
      browserPostWrongMetadataKey,
    );

    const uploaded = await client.send(
      new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: sourceKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        IfNoneMatch: "*",
        Metadata: sourceMetadata,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const sourceEtag = normalizeS3Etag(uploaded.ETag);
    const sourceRevision = stratoEtagRevision(sourceKey, sourceEtag);
    const sourceHead = await client.send(
      new HeadObjectCommand({ Bucket: configuration.bucket, Key: sourceKey }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    verifyS3ObjectIntegrity(sourceHead, {
      compatibilityMode: "strato-hidrive",
      key: sourceKey,
      versionId: sourceRevision,
      etag: sourceEtag,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: sourceMetadata,
    });
    const downloaded = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: sourceKey,
        IfMatch: quotedEtag(sourceEtag),
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const downloadedBody = await downloaded.Body?.transformToByteArray();
    if (
      normalizeS3Etag(downloaded.ETag) !== sourceEtag ||
      !downloadedBody ||
      Buffer.compare(body, Buffer.from(downloadedBody)) !== 0
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO conditional read changed the canary content.",
        canaryPrefix,
      );
    }
    try {
      const mismatched = await client.send(
        new GetObjectCommand({
          Bucket: configuration.bucket,
          Key: sourceKey,
          IfMatch: quotedEtag("q-academy-intentionally-wrong-etag"),
        }),
        { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
      );
      await mismatched.Body?.transformToByteArray();
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO provider accepted an incorrect ETag read condition.",
        canaryPrefix,
      );
    } catch (error) {
      if (error instanceof StratoS3CompatibilityError) throw error;
      if (statusOf(error) !== 412) throw error;
    }
    const rangeStart = 7;
    const rangeEnd = 31;
    const ranged = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: sourceKey,
        IfMatch: quotedEtag(sourceEtag),
        Range: `bytes=${rangeStart}-${rangeEnd}`,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const rangedBody = await ranged.Body?.transformToByteArray();
    const expectedRange = body.subarray(rangeStart, rangeEnd + 1);
    if (
      normalizeS3Etag(ranged.ETag) !== sourceEtag ||
      ranged.ContentLength !== expectedRange.byteLength ||
      ranged.ContentType !== contentType ||
      ranged.ContentRange !==
        `bytes ${rangeStart}-${rangeEnd}/${body.byteLength}` ||
      ranged.Metadata?.["contract-version"] !==
        sourceMetadata["contract-version"] ||
      ranged.Metadata?.["object-role"] !== sourceMetadata["object-role"] ||
      !rangedBody ||
      Buffer.compare(expectedRange, Buffer.from(rangedBody)) !== 0
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO ETag-bound range read changed the canary content.",
        canaryPrefix,
      );
    }

    const copyMetadata = {
      "contract-version": "1",
      "object-role": "copy",
      "source-etag": sourceEtag,
    };
    try {
      await client.send(
        new CopyObjectCommand({
          Bucket: configuration.bucket,
          Key: copyConditionMismatchKey,
          CopySource: s3CopySource(
            "strato-hidrive",
            configuration.bucket,
            sourceKey,
            sourceRevision,
            sourceEtag,
          ),
          CopySourceIfMatch: quotedEtag(
            "q-academy-intentionally-wrong-copy-etag",
          ),
          ContentType: contentType,
          MetadataDirective: "REPLACE",
          Metadata: copyMetadata,
        }),
        { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
      );
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO provider accepted an incorrect copy ETag condition.",
        canaryPrefix,
      );
    } catch (error) {
      if (error instanceof StratoS3CompatibilityError) throw error;
      if (statusOf(error) !== 412) throw error;
    }
    await expectMissing(client, configuration.bucket, copyConditionMismatchKey);

    const copied = await client.send(
      new CopyObjectCommand({
        Bucket: configuration.bucket,
        Key: copyKey,
        CopySource: s3CopySource(
          "strato-hidrive",
          configuration.bucket,
          sourceKey,
          sourceRevision,
          sourceEtag,
        ),
        CopySourceIfMatch: quotedEtag(sourceEtag),
        ContentType: contentType,
        MetadataDirective: "REPLACE",
        Metadata: copyMetadata,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const copyEtag = normalizeS3Etag(copied.CopyObjectResult?.ETag);
    const copyHead = await client.send(
      new HeadObjectCommand({ Bucket: configuration.bucket, Key: copyKey }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    verifyS3ObjectIntegrity(copyHead, {
      compatibilityMode: "strato-hidrive",
      key: copyKey,
      versionId: stratoEtagRevision(copyKey, copyEtag),
      etag: copyEtag,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: copyMetadata,
    });
    const copiedBody = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: copyKey,
        IfMatch: quotedEtag(copyEtag),
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const copiedBytes = await copiedBody.Body?.transformToByteArray();
    if (!copiedBytes || Buffer.compare(body, Buffer.from(copiedBytes)) !== 0) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO copy did not preserve the canary content.",
        canaryPrefix,
      );
    }

    for (const key of [
      startAfterAKey,
      startAfterBFirstKey,
      startAfterBSecondKey,
    ]) {
      await client.send(
        new PutObjectCommand({
          Bucket: configuration.bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
          Metadata: {
            "contract-version": "1",
            "object-role": "start-after",
          },
        }),
        { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
      );
    }
    const delimiterPage = await client.send(
      new ListObjectsV2Command({
        Bucket: configuration.bucket,
        Prefix: `${canaryPrefix}/start-after-`,
        Delimiter: "/",
        StartAfter: `${canaryPrefix}/start-after-a/`,
        MaxKeys: 10,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const delimiterPrefixes = (delimiterPage.CommonPrefixes ?? []).map(
      (entry) => entry.Prefix,
    );
    const objectPage = await client.send(
      new ListObjectsV2Command({
        Bucket: configuration.bucket,
        Prefix: `${canaryPrefix}/start-after-b/`,
        StartAfter: startAfterBFirstKey,
        MaxKeys: 10,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const objectKeys = (objectPage.Contents ?? []).map((entry) => entry.Key);
    if (
      delimiterPage.IsTruncated ||
      delimiterPrefixes.length !== 1 ||
      delimiterPrefixes[0] !== `${canaryPrefix}/start-after-b/` ||
      objectPage.IsTruncated ||
      objectKeys.length !== 1 ||
      objectKeys[0] !== startAfterBSecondKey
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "The STRATO StartAfter listing contract did not advance exactly.",
        canaryPrefix,
      );
    }

    const anonymousDeleteMetadata = {
      "contract-version": "1",
      "object-role": "anonymous-delete-guard",
    };
    const anonymousDeleteUploaded = await client.send(
      new PutObjectCommand({
        Bucket: configuration.bucket,
        Key: anonymousDeleteKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        Metadata: anonymousDeleteMetadata,
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    const anonymousDeleteEtag = normalizeS3Etag(anonymousDeleteUploaded.ETag);

    await expectAnonymousRequestRejected({
      url: objectUrl(configuration, sourceKey),
      method: "HEAD",
      canaryPrefix,
    });
    await expectAnonymousRequestRejected({
      url: objectUrl(configuration, sourceKey),
      method: "GET",
      canaryPrefix,
    });
    await expectAnonymousRequestRejected({
      url: listObjectsUrl(configuration, `${canaryPrefix}/`),
      method: "GET",
      canaryPrefix,
    });
    await expectAnonymousRequestRejected({
      url: objectUrl(configuration, anonymousPutKey),
      method: "PUT",
      body,
      canaryPrefix,
    });
    await expectMissing(client, configuration.bucket, anonymousPutKey);
    await expectAnonymousRequestRejected({
      url: objectUrl(configuration, anonymousDeleteKey),
      method: "DELETE",
      canaryPrefix,
    });

    const sourceAfterAnonymousRequests = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: sourceKey,
        IfMatch: quotedEtag(sourceEtag),
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    verifyS3ObjectIntegrity(sourceAfterAnonymousRequests, {
      compatibilityMode: "strato-hidrive",
      key: sourceKey,
      versionId: sourceRevision,
      etag: sourceEtag,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: sourceMetadata,
    });
    const sourceBytesAfterAnonymousRequests =
      await sourceAfterAnonymousRequests.Body?.transformToByteArray();
    if (
      !sourceBytesAfterAnonymousRequests ||
      Buffer.compare(body, Buffer.from(sourceBytesAfterAnonymousRequests)) !== 0
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "An anonymous operation changed the STRATO source canary.",
        canaryPrefix,
      );
    }
    const anonymousDeleteGuard = await client.send(
      new GetObjectCommand({
        Bucket: configuration.bucket,
        Key: anonymousDeleteKey,
        IfMatch: quotedEtag(anonymousDeleteEtag),
      }),
      { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
    );
    verifyS3ObjectIntegrity(anonymousDeleteGuard, {
      compatibilityMode: "strato-hidrive",
      key: anonymousDeleteKey,
      versionId: stratoEtagRevision(anonymousDeleteKey, anonymousDeleteEtag),
      etag: anonymousDeleteEtag,
      sizeBytes: body.byteLength,
      mimeType: contentType,
      metadata: anonymousDeleteMetadata,
    });
    const anonymousDeleteGuardBytes =
      await anonymousDeleteGuard.Body?.transformToByteArray();
    if (
      !anonymousDeleteGuardBytes ||
      Buffer.compare(body, Buffer.from(anonymousDeleteGuardBytes)) !== 0
    ) {
      throw new StratoS3CompatibilityError(
        "integrity_verification_failed",
        "An anonymous delete changed the STRATO delete canary.",
        canaryPrefix,
      );
    }
    privateBucketVerified = true;

    for (const key of keys) {
      await client.send(
        new DeleteObjectCommand({ Bucket: configuration.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
      );
      await expectMissing(client, configuration.bucket, key);
    }
  } catch (error) {
    primaryError = safeError(error, canaryPrefix);
  } finally {
    try {
      for (const key of keys) {
        await client
          .send(
            new DeleteObjectCommand({ Bucket: configuration.bucket, Key: key }),
            { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
          )
          .catch(() => undefined);
      }
      const remaining = await client.send(
        new ListObjectsV2Command({
          Bucket: configuration.bucket,
          Prefix: `${canaryPrefix}/`,
          MaxKeys: 3,
        }),
        { abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS) },
      );
      if ((remaining.Contents?.length ?? 0) !== 0 || remaining.IsTruncated) {
        throw new Error("canary_objects_remain");
      }
    } catch {
      cleanupError = new StratoS3CompatibilityError(
        "cleanup_failed",
        "The STRATO canary cleanup could not be verified.",
        canaryPrefix,
      );
    } finally {
      client.destroy();
    }
  }
  if (primaryError && cleanupError) {
    throw new StratoS3CompatibilityError(
      "preflight_and_cleanup_failed",
      "The STRATO compatibility contract and canary cleanup both failed.",
      canaryPrefix,
    );
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return {
    mode: "strato-hidrive" as const,
    bucket: configuration.bucket,
    canaryPrefix,
    endpointReachable: true as const,
    privateBucketVerified,
    anonymousKnownObjectHeadRejected: true as const,
    anonymousKnownObjectGetRejected: true as const,
    anonymousListObjectsRejected: true as const,
    anonymousObjectPutRejected: true as const,
    anonymousObjectDeleteRejected: true as const,
    browserPostCorsVerified: true as const,
    browserUploadOriginCount: expectedOrigins.length,
    browserPostObjectIntegrityVerified: true as const,
    browserPostExactKeyPolicyVerified: true as const,
    browserPostExactSizePolicyVerified: true as const,
    browserPostRequiredMetadataPolicyVerified: true as const,
    etagIntegrityVerified: true as const,
    conditionalReadVerified: true as const,
    mismatchedConditionalReadRejected: true as const,
    conditionalRangeReadVerified: true as const,
    mismatchedCopySourceConditionRejected: true as const,
    copyAndDigestVerified: true as const,
    startAfterPaginationVerified: true as const,
    unversionedDeleteVerified: true as const,
    cleanupVerified: true as const,
    nativeVersioning: false as const,
    nativeLifecycle: false as const,
    objectTagging: false as const,
    writeOncePrecondition: false as const,
    conditionalDelete: false as const,
    principalIsolationVerified: false as const,
  };
}
