import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  runS3ProviderContractPreflight,
  S3_PROVIDER_CANARY_ROOT,
  S3ProviderContractError,
  type S3ProviderContractAdapter,
} from "../src/lib/media/s3-provider-contract";
import {
  hasRequiredS3PrivacyExportLifecycle,
  normalizeS3LifecycleConfiguration,
  S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
  type S3LifecycleRuleContract,
} from "../src/lib/media/s3-privacy-export-lifecycle";

const BUCKET = "q-academy-provider-contract-test";
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
  deleteMarker?: boolean;
};

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
  ];
}

class FakeS3Provider implements S3ProviderContractAdapter {
  readonly bucket = BUCKET;
  readonly calls: string[] = [];
  readonly versions = new Map<string, StoredVersion[]>();
  readonly putInputs: Parameters<S3ProviderContractAdapter["putObject"]>[0][] = [];
  readonly copyInputs: Parameters<S3ProviderContractAdapter["copyObject"]>[0][] = [];
  readonly getInputs: Parameters<S3ProviderContractAdapter["getObject"]>[0][] = [];
  readonly deleteInputs: Array<
    Parameters<S3ProviderContractAdapter["deleteObjectVersions"]>[0]
  > = [];
  readonly deleteCurrentInputs: Array<
    Parameters<S3ProviderContractAdapter["deleteObject"]>[0]
  > = [];
  versioning: string | undefined = "Enabled";
  lifecycleRules: S3LifecycleRuleContract[] = requiredLifecycleRules();
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

function preflight(adapter: FakeS3Provider, confirmBucket = BUCKET) {
  return runS3ProviderContractPreflight({
    adapter,
    confirmBucket,
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
  const result = await preflight(adapter);

  assert.equal(result.versioningStatus, "Enabled");
  assert.equal(
    result.privacyExportExpirationDays,
    S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  );
  assert.equal(result.privacyExportLifecycleVerified, true);
  assert.equal(result.cleanupVerified, true);
  assert.match(
    result.canaryPrefix,
    new RegExp(`^${S3_PROVIDER_CANARY_ROOT.replaceAll("/", "\\/")}/`),
  );
  assert.equal(result.canaryPrefix.startsWith("incoming/"), false);
  assert.equal(result.canaryPrefix.startsWith("tenants/"), false);
  assert.equal(adapter.putInputs[0]?.ifNoneMatch, "*");
  assert.equal(adapter.copyInputs[0]?.sourceVersionId, "version-1");
  assert.deepEqual(
    adapter.getInputs.map((input) => input.versionId),
    ["version-1", "version-2"],
  );
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
