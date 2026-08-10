import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  hasRequiredS3BrowserUploadCors,
  hasRequiredS3BrowserUploadCorsInventory,
  type S3BrowserUploadCorsRuleContract,
} from "../src/lib/media/s3-browser-upload-cors";
import {
  compositeS3MultipartSha256,
  S3_MULTIPART_CANARY_PART_COUNT,
  S3_MULTIPART_MIN_PART_BYTES,
} from "../src/lib/media/s3-multipart-preflight";
import {
  runS3ProviderContractPreflight,
  S3_PROVIDER_CANARY_ROOT,
  S3ProviderContractError,
  type S3ProviderContractAdapter,
} from "../src/lib/media/s3-provider-contract";
import {
  hasRequiredS3IncompleteMultipartUploadLifecycle,
  hasRequiredS3PrivacyExportLifecycle,
  normalizeS3LifecycleConfiguration,
  S3_INCOMPLETE_MULTIPART_LIFECYCLE_PREFIX,
  S3_INCOMPLETE_MULTIPART_MAX_DAYS,
  S3_MULTIPART_UPLOAD_PREFIX,
  S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
  type S3LifecycleRuleContract,
} from "../src/lib/media/s3-privacy-export-lifecycle";

const BUCKET = "q-academy-provider-contract-test";
const EXPECTED_ORIGIN = "https://academy.example.com";
const TENANT_ORIGIN = "https://tenant.example.com";
const EXPECTED_ORIGINS = [EXPECTED_ORIGIN, TENANT_ORIGIN] as const;
const MULTIPART_UPLOAD_TTL_SECONDS = 24 * 60 * 60;
const CANARY_ID = "c4a1b87f-78ba-4cc4-93d1-e15b866db7bf";
const CANARY_BODY = new Uint8Array(
  Array.from({ length: 64 }, (_, index) => index),
);

type StoredVersion = {
  key: string;
  versionId: string;
  etag: string;
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
  checksumSha256?: string;
  checksumType?: "COMPOSITE";
  deleteMarker?: boolean;
};

type StoredMultipartPart = {
  partNumber: number;
  body: Uint8Array;
  etag: string;
  checksumSha256: string;
};

type StoredMultipartUpload = {
  key: string;
  contentType: string;
  metadata: Record<string, string>;
  parts: Map<number, StoredMultipartPart>;
};

function requiredCorsRules(): S3BrowserUploadCorsRuleContract[] {
  return [
    {
      allowedOrigins: [...EXPECTED_ORIGINS],
      allowedMethods: ["PUT"],
      allowedHeaders: [
        "Content-Type",
        "If-None-Match",
        "X-Amz-Checksum-Sha256",
      ],
      exposeHeaders: ["ETag"],
    },
  ];
}

test("browser upload CORS accepts one exact production origin", () => {
  const singleOriginRules: S3BrowserUploadCorsRuleContract[] = [
    {
      ...requiredCorsRules()[0],
      allowedOrigins: [EXPECTED_ORIGIN],
    },
  ];
  assert.equal(
    hasRequiredS3BrowserUploadCorsInventory(singleOriginRules, [
      EXPECTED_ORIGIN,
    ]),
    true,
  );
  assert.equal(hasRequiredS3BrowserUploadCorsInventory(singleOriginRules, []), false);
});

function requiredLifecycleRules(): S3LifecycleRuleContract[] {
  return [
    {
      status: "Enabled",
      filter: {
        and: {
          prefix: S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX,
          tags: [
            {
              key: S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
              value: S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
            },
          ],
        },
      },
      expiration: { days: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS },
      noncurrentVersionExpiration: {
        noncurrentDays: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
      },
    },
    {
      status: "Enabled",
      filter: { prefix: S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX },
      expiration: { expiredObjectDeleteMarker: true },
    },
    {
      status: "Enabled",
      filter: { prefix: S3_INCOMPLETE_MULTIPART_LIFECYCLE_PREFIX },
      abortIncompleteMultipartUpload: {
        daysAfterInitiation: S3_INCOMPLETE_MULTIPART_MAX_DAYS,
      },
    },
  ];
}

class FakeS3Provider implements S3ProviderContractAdapter {
  readonly bucket = BUCKET;
  readonly calls: string[] = [];
  readonly versions = new Map<string, StoredVersion[]>();
  readonly multipartUploads = new Map<string, StoredMultipartUpload>();
  readonly putInputs: Parameters<S3ProviderContractAdapter["putObject"]>[0][] = [];
  readonly copyInputs: Parameters<S3ProviderContractAdapter["copyObject"]>[0][] = [];
  readonly headInputs: Parameters<S3ProviderContractAdapter["headObject"]>[0][] = [];
  readonly getInputs: Parameters<S3ProviderContractAdapter["getObject"]>[0][] = [];
  readonly multipartCreateInputs: Array<
    Parameters<S3ProviderContractAdapter["createMultipartUpload"]>[0]
  > = [];
  readonly browserMultipartPartInputs: Array<
    Parameters<S3ProviderContractAdapter["browserUploadPart"]>[0]
  > = [];
  readonly multipartCompleteInputs: Array<
    Parameters<S3ProviderContractAdapter["completeMultipartUpload"]>[0]
  > = [];
  readonly multipartAbortInputs: Array<
    Parameters<S3ProviderContractAdapter["abortMultipartUpload"]>[0]
  > = [];
  readonly multipartAbsenceChecks: Array<
    Parameters<S3ProviderContractAdapter["multipartUploadExists"]>[0]
  > = [];
  readonly deleteInputs: Array<
    Parameters<S3ProviderContractAdapter["deleteObjectVersions"]>[0]
  > = [];
  readonly deleteCurrentInputs: Array<
    Parameters<S3ProviderContractAdapter["deleteObject"]>[0]
  > = [];
  versioning: string | undefined = "Enabled";
  lifecycleRules: S3LifecycleRuleContract[] = requiredLifecycleRules();
  corsRules: S3BrowserUploadCorsRuleContract[] = requiredCorsRules();
  omitPutVersion = false;
  omitCopyVersion = false;
  corruptCopyBody = false;
  corruptCopyMetadata = false;
  corruptHeadVersion = false;
  cleanupBlocked = false;
  markerDeletionBlocked = false;
  invalidDeleteMarkerResponse: "false_flag" | "null_version" | null = null;
  suppressDeleteMarker = false;
  addDeleteMarker = false;
  unexpectedListEntry = false;
  failAt: string | null = null;
  pageSize = Number.POSITIVE_INFINITY;
  private version = 0;
  private multipartUpload = 0;

  private fail(step: string) {
    this.calls.push(step);
    if (this.failAt === step) {
      throw new Error(
        "https://access-key:VERY_SECRET_VALUE@objects.invalid/private",
      );
    }
  }

  private stored(key: string, versionId: string) {
    const stored = this.versions
      .get(key)
      ?.find((candidate) => candidate.versionId === versionId);
    if (!stored) throw new Error("missing fake object");
    return stored;
  }

  private append(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata: Readonly<Record<string, string>>,
  ) {
    const versionId = `version-${++this.version}`;
    const stored: StoredVersion = {
      key,
      versionId,
      etag: `etag-${this.version}`,
      body: new Uint8Array(body),
      contentType,
      metadata: { ...metadata },
    };
    this.versions.set(key, [...(this.versions.get(key) ?? []), stored]);
    return stored;
  }

  private metadata(stored: StoredVersion) {
    return {
      VersionId: this.corruptHeadVersion
        ? "unrelated-version"
        : stored.versionId,
      ETag: `"${stored.etag}"`,
      ContentLength: stored.body.byteLength,
      ContentType: stored.contentType,
      Metadata:
        this.corruptCopyMetadata && stored.key.endsWith("/copy.bin")
          ? { ...stored.metadata, "content-sha256": "0".repeat(64) }
          : { ...stored.metadata },
      ChecksumSHA256: stored.checksumSha256,
      ChecksumType: stored.checksumType,
    };
  }

  async getBucketVersioning() {
    this.fail("versioning");
    return this.versioning;
  }

  async getBucketLifecycleConfiguration() {
    this.fail("lifecycle");
    return this.lifecycleRules;
  }

  async getBucketCorsConfiguration() {
    this.fail("cors");
    return this.corsRules;
  }

  async putObject(input: Parameters<S3ProviderContractAdapter["putObject"]>[0]) {
    this.fail("put");
    this.putInputs.push(input);
    const stored = this.append(
      input.key,
      input.body,
      input.contentType,
      input.metadata,
    );
    return {
      VersionId: this.omitPutVersion ? undefined : stored.versionId,
      ETag: `"${stored.etag}"`,
    };
  }

  async headObject(input: Parameters<S3ProviderContractAdapter["headObject"]>[0]) {
    this.fail("head");
    this.headInputs.push(input);
    return this.metadata(this.stored(input.key, input.versionId));
  }

  async getObject(input: Parameters<S3ProviderContractAdapter["getObject"]>[0]) {
    this.fail("get");
    this.getInputs.push(input);
    const stored = this.stored(input.key, input.versionId);
    const body =
      this.corruptCopyBody && input.key.endsWith("/copy.bin")
        ? new Uint8Array([...stored.body.slice(0, -1), 255])
        : new Uint8Array(stored.body);
    return {
      ...this.metadata(stored),
      body: (async function* () {
        yield body;
      })(),
    };
  }

  async copyObject(input: Parameters<S3ProviderContractAdapter["copyObject"]>[0]) {
    this.fail("copy");
    this.copyInputs.push(input);
    const source = this.stored(input.sourceKey, input.sourceVersionId);
    if (source.etag !== input.sourceEtag) throw new Error("etag mismatch");
    const copied = this.append(
      input.targetKey,
      source.body,
      input.contentType,
      input.metadata,
    );
    if (this.addDeleteMarker) {
      const marker: StoredVersion = {
        ...copied,
        key: input.sourceKey,
        versionId: `delete-marker-${++this.version}`,
        deleteMarker: true,
      };
      this.versions.set(input.sourceKey, [
        ...(this.versions.get(input.sourceKey) ?? []),
        marker,
      ]);
    }
    return {
      VersionId: this.omitCopyVersion ? undefined : copied.versionId,
      ETag: `"${copied.etag}"`,
    };
  }

  async createMultipartUpload(
    input: Parameters<S3ProviderContractAdapter["createMultipartUpload"]>[0],
  ) {
    this.fail("multipart-create");
    this.multipartCreateInputs.push(input);
    const uploadId = `multipart-upload-${++this.multipartUpload}`;
    this.multipartUploads.set(uploadId, {
      key: input.key,
      contentType: input.contentType,
      metadata: { ...input.metadata },
      parts: new Map(),
    });
    return {
      Bucket: this.bucket,
      Key: input.key,
      UploadId: uploadId,
      ChecksumAlgorithm: "SHA256",
      ChecksumType: "COMPOSITE",
    };
  }

  async uploadPart(
    input: Parameters<S3ProviderContractAdapter["uploadPart"]>[0],
  ) {
    this.fail("multipart-upload-part");
    const upload = this.multipartUploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) {
      throw new Error("missing fake multipart upload");
    }
    const checksumSha256 = createHash("sha256")
      .update(input.body)
      .digest("base64");
    if (checksumSha256 !== input.checksumSha256) {
      throw new Error("multipart checksum mismatch");
    }
    const etag = `multipart-etag-${input.uploadId}-${input.partNumber}`;
    upload.parts.set(input.partNumber, {
      partNumber: input.partNumber,
      body: Uint8Array.from(input.body),
      etag,
      checksumSha256,
    });
    return { ETag: `"${etag}"`, ChecksumSHA256: checksumSha256 };
  }

  async browserUploadPart(
    input: Parameters<S3ProviderContractAdapter["browserUploadPart"]>[0],
  ) {
    this.browserMultipartPartInputs.push(input);
    return this.uploadPart(input);
  }

  async listMultipartParts(
    input: Parameters<S3ProviderContractAdapter["listMultipartParts"]>[0],
  ) {
    this.fail("multipart-list-parts");
    const upload = this.multipartUploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) {
      throw new Error("missing fake multipart upload");
    }
    return {
      isTruncated: false,
      bucket: this.bucket,
      key: input.key,
      uploadId: input.uploadId,
      checksumAlgorithm: "SHA256",
      checksumType: "COMPOSITE",
      parts: [...upload.parts.values()]
        .sort((left, right) => left.partNumber - right.partNumber)
        .map((part) => ({
          partNumber: part.partNumber,
          sizeBytes: part.body.byteLength,
          etag: `"${part.etag}"`,
          checksumSha256: part.checksumSha256,
        })),
    };
  }

  async completeMultipartUpload(
    input: Parameters<S3ProviderContractAdapter["completeMultipartUpload"]>[0],
  ) {
    this.fail("multipart-complete");
    this.multipartCompleteInputs.push(input);
    const upload = this.multipartUploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) {
      throw new Error("missing fake multipart upload");
    }
    const parts = input.parts.map((part) => {
      const stored = upload.parts.get(part.partNumber);
      if (
        !stored ||
        stored.etag !== part.etag ||
        stored.checksumSha256 !== part.checksumSha256
      ) {
        throw new Error("invalid fake multipart completion");
      }
      return stored;
    });
    const body = Buffer.concat(parts.map((part) => Buffer.from(part.body)));
    if (body.byteLength !== input.expectedSizeBytes) {
      throw new Error("multipart completion size mismatch");
    }
    const checksumSha256 = compositeS3MultipartSha256(parts);
    const completed = this.append(
      upload.key,
      body,
      upload.contentType,
      upload.metadata,
    );
    completed.checksumSha256 = checksumSha256;
    completed.checksumType = "COMPOSITE";
    this.multipartUploads.delete(input.uploadId);
    return {
      VersionId: completed.versionId,
      ETag: `"${completed.etag}"`,
      ChecksumSHA256: checksumSha256,
      ChecksumType: "COMPOSITE",
    };
  }

  async abortMultipartUpload(
    input: Parameters<S3ProviderContractAdapter["abortMultipartUpload"]>[0],
  ) {
    this.fail("multipart-abort");
    this.multipartAbortInputs.push(input);
    const upload = this.multipartUploads.get(input.uploadId);
    if (!upload || upload.key !== input.key) {
      throw new Error("missing fake multipart upload");
    }
    this.multipartUploads.delete(input.uploadId);
  }

  async multipartUploadExists(
    input: Parameters<S3ProviderContractAdapter["multipartUploadExists"]>[0],
  ) {
    this.fail("multipart-exists");
    this.multipartAbsenceChecks.push(input);
    const upload = this.multipartUploads.get(input.uploadId);
    return upload?.key === input.key;
  }

  async objectExists(
    input: Parameters<S3ProviderContractAdapter["objectExists"]>[0],
  ) {
    this.fail("object-exists");
    return (this.versions.get(input.key) ?? []).some(
      (entry) => entry.deleteMarker !== true,
    );
  }

  async cleanupMultipartUploads(
    targets: Parameters<
      S3ProviderContractAdapter["cleanupMultipartUploads"]
    >[0],
  ) {
    this.fail("multipart-cleanup");
    if (this.cleanupBlocked) throw new Error("cleanup blocked");
    for (const target of targets) {
      const upload = this.multipartUploads.get(target.uploadId);
      if (upload?.key === target.key) {
        this.multipartUploads.delete(target.uploadId);
      }
    }
  }

  async deleteObject(
    input: Parameters<S3ProviderContractAdapter["deleteObject"]>[0],
  ) {
    this.fail("delete-current");
    this.deleteCurrentInputs.push(input);
    if (this.suppressDeleteMarker) return {};
    const marker: StoredVersion = {
      key: input.key,
      versionId: `delete-marker-${++this.version}`,
      etag: `delete-marker-etag-${this.version}`,
      body: new Uint8Array(),
      contentType: "application/octet-stream",
      metadata: {},
      deleteMarker: true,
    };
    this.versions.set(input.key, [
      ...(this.versions.get(input.key) ?? []),
      marker,
    ]);
    return {
      DeleteMarker:
        this.invalidDeleteMarkerResponse === "false_flag" ? false : true,
      VersionId:
        this.invalidDeleteMarkerResponse === "null_version"
          ? "null"
          : marker.versionId,
    };
  }

  async listObjectVersions(
    input: Parameters<S3ProviderContractAdapter["listObjectVersions"]>[0],
  ) {
    this.fail("list");
    const entries = [...this.versions.values()]
      .flat()
      .filter((entry) => entry.key.startsWith(input.prefix));
    if (this.unexpectedListEntry) {
      entries.push({
        key: `${input.prefix}unexpected.bin`,
        versionId: "unexpected-version",
        etag: "unexpected",
        body: new Uint8Array([1]),
        contentType: "application/octet-stream",
        metadata: {},
      });
    }
    const offset = input.keyMarker?.startsWith("offset-")
      ? Number(input.keyMarker.slice("offset-".length))
      : 0;
    const page = entries.slice(offset, offset + this.pageSize);
    const nextOffset = offset + page.length;
    const isTruncated = nextOffset < entries.length;
    return {
      isTruncated,
      nextKeyMarker: isTruncated ? `offset-${nextOffset}` : undefined,
      versions: page
        .filter((entry) => !entry.deleteMarker)
        .map((entry) => ({ key: entry.key, versionId: entry.versionId })),
      deleteMarkers: page
        .filter((entry) => entry.deleteMarker)
        .map((entry) => ({ key: entry.key, versionId: entry.versionId })),
    };
  }

  async deleteObjectVersions(
    targets: Parameters<
      S3ProviderContractAdapter["deleteObjectVersions"]
    >[0],
  ) {
    this.fail("delete");
    this.deleteInputs.push(targets);
    if (this.cleanupBlocked) return { errorCount: targets.length };
    let errorCount = 0;
    for (const target of targets) {
      const targetVersion = this.versions
        .get(target.key)
        ?.find((entry) => entry.versionId === target.versionId);
      if (this.markerDeletionBlocked && targetVersion?.deleteMarker) {
        errorCount += 1;
        continue;
      }
      this.versions.set(
        target.key,
        (this.versions.get(target.key) ?? []).filter(
          (entry) => entry.versionId !== target.versionId,
        ),
      );
    }
    return { errorCount };
  }
}

function preflight(
  adapter: FakeS3Provider,
  confirmBucket = BUCKET,
  expectedOrigins: readonly string[] = EXPECTED_ORIGINS,
  multipartUploadTtlSeconds = MULTIPART_UPLOAD_TTL_SECONDS,
) {
  return runS3ProviderContractPreflight({
    adapter,
    confirmBucket,
    expectedOrigins,
    multipartUploadTtlSeconds,
    createCanary: () => ({ id: CANARY_ID, body: CANARY_BODY }),
  });
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: S3ProviderContractError["code"],
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof S3ProviderContractError);
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /VERY_SECRET_VALUE|access-key|https?:/);
    return true;
  });
}

test("provider contract pins versions, verifies copy integrity, and cleans every version", async () => {
  const adapter = new FakeS3Provider();
  adapter.addDeleteMarker = true;
  adapter.pageSize = 1;
  adapter.lifecycleRules = adapter.lifecycleRules.map((rule, index) =>
    index === 2
      ? {
          ...rule,
          abortIncompleteMultipartUpload: { daysAfterInitiation: 3 },
        }
      : rule,
  );
  const result = await preflight(adapter);

  assert.equal(result.versioningStatus, "Enabled");
  assert.equal(
    result.privacyExportExpirationDays,
    S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  );
  assert.equal(result.privacyExportLifecycleVerified, true);
  assert.equal(
    result.incompleteMultipartAbortDays,
    3,
  );
  assert.equal(result.incompleteMultipartLifecycleVerified, true);
  assert.equal(result.browserUploadCorsVerified, true);
  assert.equal(result.browserUploadOriginCount, EXPECTED_ORIGINS.length);
  assert.equal(result.multipartUploadVerified, true);
  assert.equal(result.multipartAbortVerified, true);
  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(adapter.calls.slice(0, 3), [
    "versioning",
    "lifecycle",
    "cors",
  ]);
  assert.deepEqual(adapter.corsRules, requiredCorsRules());
  assert.match(
    result.canaryPrefix,
    new RegExp(`^${S3_PROVIDER_CANARY_ROOT.replaceAll("/", "\\/")}/`),
  );
  assert.equal(result.canaryPrefix.startsWith("incoming/"), false);
  assert.equal(result.canaryPrefix.startsWith("tenants/"), false);
  assert.equal(adapter.putInputs[0]?.ifNoneMatch, "*");
  assert.equal(adapter.copyInputs[0]?.sourceVersionId, "version-1");
  assert.deepEqual(
    adapter.getInputs.slice(0, 2).map((input) => input.versionId),
    ["version-1", "version-2"],
  );
  assert.equal(adapter.getInputs.length, 3);
  assert.match(adapter.getInputs[2]?.key ?? "", /\/multipart-complete\.bin$/);
  assert.equal(adapter.multipartCreateInputs.length, 2);
  assert.equal(
    adapter.browserMultipartPartInputs.length,
    EXPECTED_ORIGINS.length,
  );
  assert.deepEqual(
    adapter.browserMultipartPartInputs.map((input) => input.expectedOrigin),
    EXPECTED_ORIGINS,
  );
  assert.equal(adapter.browserMultipartPartInputs[0]?.partNumber, 3);
  assert.equal(
    adapter.browserMultipartPartInputs[0]?.contentType,
    "video/mp4",
  );
  assert.deepEqual(
    adapter.multipartCreateInputs.map(
      (input) => input.metadata["object-role"],
    ),
    ["multipart-complete", "multipart-abort"],
  );
  assert.equal(adapter.multipartCompleteInputs.length, 1);
  assert.equal(
    adapter.multipartCompleteInputs[0]?.parts.length,
    S3_MULTIPART_CANARY_PART_COUNT,
  );
  assert.deepEqual(
    adapter.multipartCompleteInputs[0]?.parts.map((part) => part.partNumber),
    [1, 2, 3],
  );
  assert.equal(
    adapter.multipartCompleteInputs[0]?.expectedSizeBytes,
    S3_MULTIPART_MIN_PART_BYTES * 2 + CANARY_BODY.byteLength,
  );
  const multipartHead = adapter.headInputs.find((input) =>
    input.key.endsWith("/multipart-complete.bin"),
  );
  assert.equal(multipartHead?.checksumMode, "ENABLED");
  assert.equal(
    adapter.calls.filter((call) => call === "multipart-upload-part").length,
    S3_MULTIPART_CANARY_PART_COUNT + EXPECTED_ORIGINS.length,
  );
  assert.equal(adapter.multipartAbortInputs.length, 1);
  assert.deepEqual(
    adapter.multipartAbsenceChecks,
    adapter.multipartAbortInputs,
  );
  assert.equal(adapter.multipartUploads.size, 0);
  assert.ok(adapter.deleteInputs.flat().length >= 3);
  assert.ok(
    adapter.deleteCurrentInputs.some((input) => input.key.endsWith("/copy.bin")),
  );
  assert.equal(
    [...adapter.versions.values()].flat().length,
    0,
  );
});

test("production lifecycle example satisfies the live provider contract", () => {
  const configuration = JSON.parse(
    readFileSync(
      new URL(
        "../deploy/s3-privacy-export-lifecycle.production.example.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Parameters<typeof normalizeS3LifecycleConfiguration>[0];

  assert.equal(
    hasRequiredS3PrivacyExportLifecycle(
      normalizeS3LifecycleConfiguration(configuration),
    ),
    true,
  );
  assert.equal(
    hasRequiredS3IncompleteMultipartUploadLifecycle(
      normalizeS3LifecycleConfiguration(configuration),
    ),
    true,
  );
});

test("privacy-export lifecycle requires the exact prefix/tag filter and eight-day expiry", async () => {
  const invalidRules: S3LifecycleRuleContract[][] = [
    [],
    requiredLifecycleRules().map((rule, index) =>
      index === 0
        ? {
            ...rule,
            filter: {
              and: {
                prefix: "tenants/*/privacy-exports/",
                tags: [
                  {
                    key: S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
                    value: S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
                  },
                ],
              },
            },
          }
        : rule,
    ),
    requiredLifecycleRules().map((rule, index) =>
      index === 0 ? { ...rule, expiration: { days: 9 } } : rule,
    ),
    requiredLifecycleRules().map((rule, index) =>
      index === 0
        ? {
            ...rule,
            noncurrentVersionExpiration: { noncurrentDays: 9 },
          }
        : rule,
    ),
    requiredLifecycleRules().slice(0, 1),
  ];

  for (const lifecycleRules of invalidRules) {
    const adapter = new FakeS3Provider();
    adapter.lifecycleRules = lifecycleRules;
    await rejectsWithCode(
      preflight(adapter),
      "privacy_export_lifecycle_invalid",
    );
    assert.equal(adapter.putInputs.length, 0);
    assert.ok(adapter.calls.includes("list"));
  }
});

test("incomplete multipart lifecycle covers upload and completion recovery", async () => {
  const replaceMultipartRule = (
    transform: (rule: S3LifecycleRuleContract) => S3LifecycleRuleContract,
  ) =>
    requiredLifecycleRules().map((rule, index) =>
      index === 2 ? transform(rule) : rule,
    );

  for (const daysAfterInitiation of [2, S3_INCOMPLETE_MULTIPART_MAX_DAYS]) {
    assert.equal(
      hasRequiredS3IncompleteMultipartUploadLifecycle(
        replaceMultipartRule((rule) => ({
          ...rule,
          abortIncompleteMultipartUpload: { daysAfterInitiation },
        })),
      ),
      true,
    );
  }
  assert.equal(
    hasRequiredS3IncompleteMultipartUploadLifecycle(
      replaceMultipartRule((rule) => ({
        ...rule,
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
      })),
    ),
    false,
    "a 24-hour upload TTL needs another lifecycle day for completion recovery",
  );
  assert.equal(
    hasRequiredS3IncompleteMultipartUploadLifecycle(
      replaceMultipartRule((rule) => ({
        ...rule,
        abortIncompleteMultipartUpload: {
          daysAfterInitiation: S3_INCOMPLETE_MULTIPART_MAX_DAYS,
        },
      })),
      7 * 86_400,
    ),
    true,
    "the maximum upload TTL remains covered by the eight-day lifecycle",
  );

  const invalidRules: Array<{
    name: string;
    rules: S3LifecycleRuleContract[];
    multipartUploadTtlSeconds?: number;
  }> = [
    {
      name: "missing abort rule",
      rules: requiredLifecycleRules().slice(0, 2),
    },
    {
      name: "disabled abort rule",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        status: "Disabled",
      })),
    },
    {
      name: "missing bucket-wide filter",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        filter: undefined,
      })),
    },
    {
      name: "prefix-scoped abort rule",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        filter: { prefix: S3_MULTIPART_UPLOAD_PREFIX },
      })),
    },
    {
      name: "tag-scoped abort rule",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        filter: {
          prefix: S3_INCOMPLETE_MULTIPART_LIFECYCLE_PREFIX,
          tag: { key: "scope", value: "incoming" },
        },
      })),
    },
    {
      name: "zero-day abort rule",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        abortIncompleteMultipartUpload: { daysAfterInitiation: 0 },
      })),
    },
    {
      name: "abort rule later than eight days",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        abortIncompleteMultipartUpload: {
          daysAfterInitiation: S3_INCOMPLETE_MULTIPART_MAX_DAYS + 1,
        },
      })),
    },
    {
      name: "fractional abort days",
      rules: replaceMultipartRule((rule) => ({
        ...rule,
        abortIncompleteMultipartUpload: { daysAfterInitiation: 1.5 },
      })),
    },
    {
      name: "incoming abort rule earlier than the upload TTL",
      rules: [
        ...requiredLifecycleRules(),
        {
          status: "Enabled",
          filter: { prefix: S3_MULTIPART_UPLOAD_PREFIX },
          abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        },
      ],
      multipartUploadTtlSeconds: 2 * 86_400,
    },
    {
      name: "global abort rule earlier than the upload TTL",
      rules: [
        ...requiredLifecycleRules(),
        {
          status: "Enabled",
          filter: { prefix: S3_INCOMPLETE_MULTIPART_LIFECYCLE_PREFIX },
          abortIncompleteMultipartUpload: { daysAfterInitiation: 1 },
        },
      ],
      multipartUploadTtlSeconds: 2 * 86_400,
    },
    {
      name: "upload TTL exceeds the lifecycle maximum",
      rules: requiredLifecycleRules(),
      multipartUploadTtlSeconds:
        S3_INCOMPLETE_MULTIPART_MAX_DAYS * 86_400 + 1,
    },
  ];

  for (const invalid of invalidRules) {
    const multipartUploadTtlSeconds =
      invalid.multipartUploadTtlSeconds ?? MULTIPART_UPLOAD_TTL_SECONDS;
    assert.equal(
      hasRequiredS3IncompleteMultipartUploadLifecycle(
        invalid.rules,
        multipartUploadTtlSeconds,
      ),
      false,
      invalid.name,
    );
    const adapter = new FakeS3Provider();
    adapter.lifecycleRules = invalid.rules;
    await rejectsWithCode(
      preflight(
        adapter,
        BUCKET,
        EXPECTED_ORIGINS,
        multipartUploadTtlSeconds,
      ),
      "multipart_lifecycle_invalid",
    );
    assert.equal(adapter.calls.includes("cors"), false, invalid.name);
    assert.equal(adapter.putInputs.length, 0, invalid.name);
    assert.equal(adapter.multipartCreateInputs.length, 0, invalid.name);
    assert.ok(adapter.calls.includes("list"), invalid.name);
  }
});

test("browser upload CORS requires the exact HTTPS origin and upload headers", async () => {
  const rules = requiredCorsRules();
  const rule = rules[0];
  assert.ok(rule);
  assert.equal(hasRequiredS3BrowserUploadCors(rules, EXPECTED_ORIGIN), true);

  for (const incompleteInventoryRules of [
    [{ ...rule, allowedOrigins: [EXPECTED_ORIGIN] }],
    [rule, { ...rule, allowedOrigins: ["*"] }],
  ]) {
    const adapter = new FakeS3Provider();
    adapter.corsRules = incompleteInventoryRules;
    await rejectsWithCode(
      preflight(adapter),
      "browser_upload_cors_invalid",
    );
    assert.equal(adapter.multipartCreateInputs.length, 0);
  }

  const invalidConfigurations: Array<{
    name: string;
    rules: S3BrowserUploadCorsRuleContract[];
    expectedOrigin?: string;
  }> = [
    { name: "missing CORS rule", rules: [] },
    {
      name: "wildcard origin",
      rules: [{ ...rule, allowedOrigins: [EXPECTED_ORIGIN, "*"] }],
    },
    {
      name: "different origin",
      rules: [
        { ...rule, allowedOrigins: ["https://uploads.example.com"] },
      ],
    },
    {
      name: "missing PUT",
      rules: [{ ...rule, allowedMethods: ["POST"] }],
    },
    ...rule.allowedHeaders.map((requiredHeader) => ({
      name: `missing ${requiredHeader}`,
      rules: [
        {
          ...rule,
          allowedHeaders: rule.allowedHeaders.filter(
            (header) => header !== requiredHeader,
          ),
        },
      ],
    })),
    {
      name: "wildcard request header",
      rules: [{ ...rule, allowedHeaders: [...rule.allowedHeaders, "*"] }],
    },
    {
      name: "missing exposed ETag",
      rules: [{ ...rule, exposeHeaders: [] }],
    },
    {
      name: "expectedOrigin includes a path",
      rules,
      expectedOrigin: `${EXPECTED_ORIGIN}/upload`,
    },
    {
      name: "expectedOrigin is not HTTPS",
      rules,
      expectedOrigin: "http://academy.example.com",
    },
  ];

  for (const invalid of invalidConfigurations) {
    assert.equal(
      hasRequiredS3BrowserUploadCors(
        invalid.rules,
        invalid.expectedOrigin ?? EXPECTED_ORIGIN,
      ),
      false,
      invalid.name,
    );
    const adapter = new FakeS3Provider();
    adapter.corsRules = invalid.rules;
    await rejectsWithCode(
      preflight(
        adapter,
        BUCKET,
        invalid.expectedOrigin
          ? [invalid.expectedOrigin, TENANT_ORIGIN]
          : EXPECTED_ORIGINS,
      ),
      "browser_upload_cors_invalid",
    );
    assert.equal(
      adapter.calls.includes("cors"),
      invalid.expectedOrigin === undefined,
      invalid.name,
    );
    assert.equal(adapter.putInputs.length, 0, invalid.name);
    assert.equal(adapter.copyInputs.length, 0, invalid.name);
    assert.equal(adapter.multipartCreateInputs.length, 0, invalid.name);
    assert.equal(
      adapter.calls.includes("list"),
      invalid.expectedOrigin === undefined,
      invalid.name,
    );
  }
});

test("bucket confirmation is exact and prevents every provider operation", async () => {
  const adapter = new FakeS3Provider();
  await rejectsWithCode(
    preflight(adapter, `${BUCKET}-wrong`),
    "bucket_confirmation_mismatch",
  );
  assert.deepEqual(adapter.calls, []);
});

test("empty and suspended versioning fail closed and still verify cleanup", async () => {
  for (const versioning of [undefined, "Suspended"] as const) {
    const adapter = new FakeS3Provider();
    adapter.versioning = versioning;
    await rejectsWithCode(preflight(adapter), "versioning_not_enabled");
    assert.ok(adapter.calls.includes("list"));
    assert.equal(adapter.putInputs.length, 0);
    assert.equal(adapter.copyInputs.length, 0);
  }
});

test("missing put VersionId fails closed and removes the written source", async () => {
  const adapter = new FakeS3Provider();
  adapter.omitPutVersion = true;
  await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
  assert.equal([...adapter.versions.values()].flat().length, 0);
});

test("missing copy VersionId fails closed and removes both objects", async () => {
  const adapter = new FakeS3Provider();
  adapter.omitCopyVersion = true;
  await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
  assert.equal([...adapter.versions.values()].flat().length, 0);
});

test("a provider returning a different version on HEAD fails closed", async () => {
  const adapter = new FakeS3Provider();
  adapter.corruptHeadVersion = true;
  await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
  assert.equal([...adapter.versions.values()].flat().length, 0);
});

test("copy metadata or body corruption fails final integrity and cleans up", async () => {
  for (const corruption of ["metadata", "body"] as const) {
    const adapter = new FakeS3Provider();
    if (corruption === "metadata") adapter.corruptCopyMetadata = true;
    else adapter.corruptCopyBody = true;
    await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
    assert.equal([...adapter.versions.values()].flat().length, 0);
  }
});

test("provider errors are sanitized while cleanup remains mandatory", async () => {
  const adapter = new FakeS3Provider();
  adapter.failAt = "copy";
  await rejectsWithCode(preflight(adapter), "provider_operation_failed");
  assert.equal([...adapter.versions.values()].flat().length, 0);
});

test("missing unversioned DeleteObject permission fails closed but still cleans versions", async () => {
  const adapter = new FakeS3Provider();
  adapter.failAt = "delete-current";
  await rejectsWithCode(preflight(adapter), "provider_operation_failed");
  assert.equal([...adapter.versions.values()].flat().length, 0);
});

test("a delete marker that cannot be removed fails mandatory cleanup", async () => {
  const adapter = new FakeS3Provider();
  adapter.markerDeletionBlocked = true;
  await rejectsWithCode(preflight(adapter), "cleanup_failed");
  assert.ok(
    [...adapter.versions.values()]
      .flat()
      .some((entry) => entry.deleteMarker),
  );
});

test("invalid or missing delete-marker evidence fails closed", async () => {
  for (const failure of [
    "false_flag",
    "null_version",
    "missing_marker",
  ] as const) {
    const adapter = new FakeS3Provider();
    if (failure === "missing_marker") adapter.suppressDeleteMarker = true;
    else adapter.invalidDeleteMarkerResponse = failure;
    await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
    assert.equal([...adapter.versions.values()].flat().length, 0);
  }
});

test("cleanup failure makes an otherwise valid contract fail closed", async () => {
  const adapter = new FakeS3Provider();
  adapter.cleanupBlocked = true;
  await rejectsWithCode(preflight(adapter), "cleanup_failed");
  assert.ok([...adapter.versions.values()].flat().length > 0);
});

test("primary and cleanup failures are reported as a combined safe failure", async () => {
  const adapter = new FakeS3Provider();
  adapter.omitCopyVersion = true;
  adapter.cleanupBlocked = true;
  await rejectsWithCode(preflight(adapter), "preflight_and_cleanup_failed");
});

test("unexpected objects under the dedicated prefix stop bounded cleanup", async () => {
  const adapter = new FakeS3Provider();
  adapter.unexpectedListEntry = true;
  await rejectsWithCode(preflight(adapter), "preflight_and_cleanup_failed");
});
