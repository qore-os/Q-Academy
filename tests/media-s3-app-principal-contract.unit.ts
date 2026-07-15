import assert from "node:assert/strict";
import test from "node:test";

import {
  runS3AppPrincipalContractPreflight,
  S3AppPrincipalContractError,
  type S3AppPrincipalContractAdapter,
} from "../src/lib/media/s3-app-principal-contract";
import { cleanupExactS3AppPrincipalKeys } from "../src/lib/media/s3-app-principal-contract-aws";
import {
  S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
  S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY,
  S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE,
  type S3LifecycleRuleContract,
} from "../src/lib/media/s3-privacy-export-lifecycle";

const BUCKET = "q-academy-contract-test";
const CANARY = {
  id: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000002",
  assetId: "30000000-0000-4000-8000-000000000003",
  privacyRequestId: "40000000-0000-4000-8000-000000000004",
  privacyArtifactId: "50000000-0000-4000-8000-000000000005",
  body: Uint8Array.from({ length: 64 }, (_value, index) => index + 1),
} as const;

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

type Entry = Readonly<{
  versionId: string;
  etag: string;
  body: Uint8Array;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
  tagging?: string;
}>;

class AuthorizationDenied extends Error {
  readonly $metadata = { httpStatusCode: 403 };
}

class MissingObject extends Error {
  readonly $metadata = { httpStatusCode: 404 };
}

class FakeAdapter implements S3AppPrincipalContractAdapter {
  readonly bucket = BUCKET;
  readonly calls: string[] = [];
  readonly cleanedKeySets: string[][] = [];
  readonly appPutInputs: Array<
    Parameters<S3AppPrincipalContractAdapter["appPutObject"]>[0]
  > = [];
  readonly objects = new Map<string, Entry[]>();
  version = 0;
  allowedForbidden: string | null = null;
  indeterminateForbidden: string | null = null;
  denyPrivacyDelete = false;
  retainPrivacyVersion = false;
  cleanupFails = false;
  versioning: string | undefined = "Enabled";
  omitSeedVersion = false;
  omitIncomingVersion = false;
  omitPrivacyVersion = false;
  omitPrivacyTag = false;
  lifecycleRules = requiredLifecycleRules();

  private store(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata: Readonly<Record<string, string>>,
    tagging?: string,
  ) {
    this.version += 1;
    const entry: Entry = {
      versionId: `version-${this.version}`,
      etag: `etag-${this.version}`,
      body: Uint8Array.from(body),
      contentType,
      metadata: { ...metadata },
      tagging,
    };
    this.objects.set(key, [...(this.objects.get(key) ?? []), entry]);
    return { VersionId: entry.versionId, ETag: `"${entry.etag}"` };
  }

  private entry(key: string, versionId?: string) {
    const versions = this.objects.get(key) ?? [];
    const entry = versionId
      ? versions.find((candidate) => candidate.versionId === versionId)
      : versions.at(-1);
    if (!entry) throw new MissingObject("missing");
    return entry;
  }

  private metadata(entry: Entry) {
    return {
      VersionId: entry.versionId,
      ETag: `"${entry.etag}"`,
      ContentLength: entry.body.byteLength,
      ContentType: entry.contentType,
      Metadata: { ...entry.metadata },
    };
  }

  private rejectForbidden(operation: string) {
    this.calls.push(operation);
    if (this.allowedForbidden === operation) return false;
    if (this.indeterminateForbidden === operation) {
      throw new Error("VERY_SECRET_VALUE provider timeout https://secret.invalid");
    }
    throw new AuthorizationDenied("denied");
  }

  async getBucketVersioning() {
    this.calls.push("versioning");
    return this.versioning;
  }

  async getBucketLifecycleConfiguration() {
    this.calls.push("lifecycle");
    return this.lifecycleRules;
  }

  async seedObject(input: Parameters<S3AppPrincipalContractAdapter["seedObject"]>[0]) {
    this.calls.push("operator_seed_ready");
    const stored = this.store(
      input.key,
      input.body,
      input.contentType,
      input.metadata,
      input.tagging,
    );
    return this.omitSeedVersion ? { ...stored, VersionId: undefined } : stored;
  }

  async appPutObject(input: Parameters<S3AppPrincipalContractAdapter["appPutObject"]>[0]) {
    this.appPutInputs.push(input);
    if (input.key.includes("/write-q-academy-app-principal-canary-")) {
      if (this.rejectForbidden("tenant_asset_put") !== false) {
        throw new Error("unreachable");
      }
    } else {
      this.calls.push(input.key.startsWith("incoming/") ? "incoming_put" : "privacy_put");
    }
    const stored = this.store(
      input.key,
      input.body,
      input.contentType,
      input.metadata,
      input.tagging,
    );
    if (input.key.startsWith("incoming/") && this.omitIncomingVersion) {
      return { ...stored, VersionId: undefined };
    }
    if (input.key.includes("/privacy-exports/") && this.omitPrivacyVersion) {
      return { ...stored, VersionId: undefined };
    }
    return stored;
  }

  async appHeadObject(input: Parameters<S3AppPrincipalContractAdapter["appHeadObject"]>[0]) {
    this.calls.push("head");
    return this.metadata(this.entry(input.key, input.versionId));
  }

  async appGetObject(input: Parameters<S3AppPrincipalContractAdapter["appGetObject"]>[0]) {
    this.calls.push("get");
    const entry = this.entry(input.key, input.versionId);
    const body = entry.body;
    return {
      ...this.metadata(entry),
      body: (async function* () {
        yield body.subarray(0, 17);
        yield body.subarray(17);
      })(),
    };
  }

  async appCopyObject(input: Parameters<S3AppPrincipalContractAdapter["appCopyObject"]>[0]) {
    if (this.rejectForbidden("copy_object") !== false) return;
    const source = this.entry(input.sourceKey, input.sourceVersionId);
    return this.store(
      input.targetKey,
      source.body,
      input.contentType,
      input.metadata,
    );
  }

  async appListObjects() {
    this.rejectForbidden("list_objects");
  }

  async appListObjectVersions() {
    this.rejectForbidden("list_object_versions");
  }

  async appDeleteObject(input: Parameters<S3AppPrincipalContractAdapter["appDeleteObject"]>[0]) {
    const privacy = input.key.includes("/privacy-exports/");
    if (privacy && input.versionId && !this.denyPrivacyDelete) {
      this.calls.push("privacy_version_delete");
      if (!this.retainPrivacyVersion) {
        this.objects.set(
          input.key,
          (this.objects.get(input.key) ?? []).filter(
            (entry) => entry.versionId !== input.versionId,
          ),
        );
      }
      return;
    }
    const operation = privacy
      ? "privacy_unversioned_delete"
      : input.key.startsWith("incoming/")
        ? "incoming_version_delete"
        : input.versionId
          ? "asset_version_delete"
          : "asset_delete";
    this.rejectForbidden(operation);
  }

  async cleanupExactKeys(keys: readonly string[]) {
    this.calls.push("cleanup");
    this.cleanedKeySets.push([...keys]);
    if (this.cleanupFails) throw new Error("cleanup failed");
    for (const key of keys) this.objects.delete(key);
  }

  async exactVersionExists(input: { key: string; versionId: string }) {
    return (this.objects.get(input.key) ?? []).some(
      (entry) => entry.versionId === input.versionId,
    );
  }

  async getExactObjectTags(input: { key: string; versionId: string }) {
    const entry = this.entry(input.key, input.versionId);
    if (this.omitPrivacyTag || !entry.tagging) return [];
    return entry.tagging.split("&").map((pair) => {
      const [key, value] = pair.split("=", 2);
      return {
        key: decodeURIComponent(key ?? ""),
        value: decodeURIComponent(value ?? ""),
      };
    });
  }

  isAuthorizationDenied(error: unknown) {
    return error instanceof AuthorizationDenied;
  }

}

function preflight(adapter: FakeAdapter, confirmBucket = BUCKET) {
  return runS3AppPrincipalContractPreflight({
    adapter,
    confirmBucket,
    createCanary: () => CANARY,
  });
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: S3AppPrincipalContractError["code"],
  operation?: string,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof S3AppPrincipalContractError);
    assert.equal(error.code, code);
    if (operation) assert.equal(error.operation, operation);
    assert.doesNotMatch(
      error.message,
      /VERY_SECRET_VALUE|secret\.invalid|access[-_ ]?key/i,
    );
    return true;
  });
}

test("app-principal contract proves required paths, denied powers, and exact cleanup", async () => {
  const adapter = new FakeAdapter();
  const result = await preflight(adapter);

  assert.equal(result.cleanupVerified, true);
  assert.deepEqual(result.required, {
    incomingWriteAndHead: true,
    assetVersionRead: true,
    privacyExportLifecycle: true,
  });
  assert.equal(Object.values(result.denied).every(Boolean), true);
  for (const operation of [
    "list_objects",
    "list_object_versions",
    "copy_object",
    "tenant_asset_put",
    "asset_delete",
    "asset_version_delete",
    "incoming_version_delete",
    "privacy_unversioned_delete",
  ]) {
    assert.ok(adapter.calls.includes(operation), operation);
  }
  const keys = adapter.cleanedKeySets[0] ?? [];
  assert.equal(keys.length, 5);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.some((key) => key.startsWith("incoming/tenants/")));
  assert.ok(keys.some((key) => key.includes("/privacy-exports/")));
  const privacyPut = adapter.appPutInputs.find((input) =>
    input.key.includes("/privacy-exports/"),
  );
  assert.equal(
    privacyPut?.tagging,
    S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING,
  );
  assert.equal(
    adapter.appPutInputs.find((input) => input.key.startsWith("incoming/"))
      ?.tagging,
    undefined,
  );
  assert.equal(adapter.objects.size, 0);
  assert.equal(adapter.calls.filter((call) => call === "versioning").length, 10);
  for (const mutation of [
    "operator_seed_ready",
    "incoming_put",
    "privacy_put",
    "privacy_version_delete",
    "copy_object",
    "tenant_asset_put",
    "asset_delete",
    "asset_version_delete",
    "incoming_version_delete",
    "privacy_unversioned_delete",
  ]) {
    const mutationIndex = adapter.calls.indexOf(mutation);
    assert.ok(mutationIndex > 0, mutation);
    assert.equal(adapter.calls[mutationIndex - 1], "versioning", mutation);
  }
});

test("exact bucket confirmation prevents all provider access", async () => {
  const adapter = new FakeAdapter();
  await rejectsWithCode(
    preflight(adapter, `${BUCKET}-wrong`),
    "bucket_confirmation_mismatch",
  );
  assert.deepEqual(adapter.calls, []);
});

test("release app-principal preflight fails before mutation without the bucket lifecycle", async () => {
  const adapter = new FakeAdapter();
  adapter.lifecycleRules = [];
  await rejectsWithCode(
    preflight(adapter),
    "privacy_export_lifecycle_invalid",
    "privacy_lifecycle_configuration",
  );
  assert.equal(adapter.calls.includes("operator_seed_ready"), false);
  assert.equal(adapter.cleanedKeySets.length, 1);
});

test("disabled or suspended versioning prevents the first product mutation and still cleans exact keys", async () => {
  for (const status of [undefined, "Suspended"] as const) {
    const adapter = new FakeAdapter();
    adapter.versioning = status;
    await rejectsWithCode(
      preflight(adapter),
      "versioning_not_enabled",
      "operator_seed_ready_versioning",
    );
    assert.deepEqual(adapter.calls, ["lifecycle", "versioning", "cleanup"]);
    assert.equal(adapter.cleanedKeySets[0]?.length, 5);
    assert.equal(adapter.objects.size, 0);
  }
});

test("a partial put without VersionId fails closed and exact cleanup removes the object", async () => {
  for (const failure of ["seed", "incoming", "privacy"] as const) {
    const adapter = new FakeAdapter();
    if (failure === "seed") adapter.omitSeedVersion = true;
    if (failure === "incoming") adapter.omitIncomingVersion = true;
    if (failure === "privacy") adapter.omitPrivacyVersion = true;
    await rejectsWithCode(preflight(adapter), "integrity_verification_failed");
    assert.ok(adapter.calls.includes("cleanup"));
    assert.equal(adapter.objects.size, 0);
  }
});

test("an allowed or indeterminate copy fails closed and still cleans canaries", async () => {
  for (const mode of ["allowed", "indeterminate"] as const) {
    const adapter = new FakeAdapter();
    if (mode === "allowed") adapter.allowedForbidden = "copy_object";
    else adapter.indeterminateForbidden = "copy_object";
    await rejectsWithCode(
      preflight(adapter),
      mode === "allowed"
        ? "forbidden_operation_allowed"
        : "forbidden_operation_not_denied",
      "copy_object",
    );
    assert.ok(adapter.calls.includes("cleanup"));
    assert.equal(adapter.objects.size, 0);
  }
});

test("an unexpectedly allowed unversioned asset delete remains a violation and cleanup is authoritative", async () => {
  const adapter = new FakeAdapter();
  adapter.allowedForbidden = "asset_delete";
  await rejectsWithCode(
    preflight(adapter),
    "forbidden_operation_allowed",
    "asset_delete",
  );
  assert.ok(adapter.calls.includes("cleanup"));
  assert.equal(adapter.objects.size, 0);
});

test("the tightly scoped privacy version delete remains a required operation", async () => {
  const adapter = new FakeAdapter();
  adapter.denyPrivacyDelete = true;
  await rejectsWithCode(
    preflight(adapter),
    "required_operation_failed",
    "privacy_version_delete",
  );
  assert.ok(adapter.calls.includes("cleanup"));
});

test("the worker verifies the mandatory privacy lifecycle tag", async () => {
  const adapter = new FakeAdapter();
  adapter.omitPrivacyTag = true;
  await rejectsWithCode(
    preflight(adapter),
    "integrity_verification_failed",
    "operator_verify_privacy_tags",
  );
  assert.equal(adapter.objects.size, 0);
});

test("the worker independently verifies physical privacy-version deletion", async () => {
  const adapter = new FakeAdapter();
  adapter.retainPrivacyVersion = true;
  await rejectsWithCode(
    preflight(adapter),
    "integrity_verification_failed",
    "privacy_version_delete",
  );
  assert.ok(adapter.calls.includes("cleanup"));
});

test("cleanup failure is authoritative and combines with a principal violation", async () => {
  const cleanupOnly = new FakeAdapter();
  cleanupOnly.cleanupFails = true;
  await rejectsWithCode(preflight(cleanupOnly), "cleanup_failed");

  const combined = new FakeAdapter();
  combined.allowedForbidden = "copy_object";
  combined.cleanupFails = true;
  await rejectsWithCode(
    preflight(combined),
    "preflight_and_cleanup_failed",
    "copy_object",
  );
});

test("AWS cleanup deletes only five exact keys, accepts null versions, and paginates without HEAD", async () => {
  const keys = Array.from({ length: 5 }, (_, index) => `exact/key-${index}`);
  const versions = new Map(
    keys.map((key, index) => [
      key,
      index === 0 ? ["null", "version-a", "delete-marker-a"] : ["version-a"],
    ]),
  );
  const foreignKey = `${keys[0]}-foreign`;
  versions.set(foreignKey, ["foreign-version"]);
  const currentDeletes: string[] = [];
  const exactDeletes: Array<{ key: string; versionId: string }> = [];
  let listCalls = 0;

  await cleanupExactS3AppPrincipalKeys({
    keys,
    async deleteCurrent(key) {
      currentDeletes.push(key);
      versions.set(key, [...(versions.get(key) ?? []), "delete-marker-current"]);
    },
    async listPage(key, markers) {
      listCalls += 1;
      const offset = markers.keyMarker
        ? Number(markers.keyMarker.slice("cursor-".length))
        : 0;
      const entries = [...(versions.get(key) ?? []), ...(versions.get(`${key}-foreign`) ?? [])];
      const page = entries.slice(offset, offset + 1);
      const nextOffset = offset + page.length;
      const truncated = nextOffset < entries.length;
      return {
        isTruncated: truncated,
        nextKeyMarker: truncated ? `cursor-${nextOffset}` : undefined,
        nextVersionIdMarker: truncated ? `version-cursor-${nextOffset}` : undefined,
        versions: page.map((versionId, index) => ({
          key: offset + index < (versions.get(key)?.length ?? 0) ? key : `${key}-foreign`,
          versionId,
        })),
        deleteMarkers: [],
      };
    },
    async deleteVersions(targets) {
      exactDeletes.push(...targets);
      for (const target of targets) {
        versions.set(
          target.key,
          (versions.get(target.key) ?? []).filter(
            (versionId) => versionId !== target.versionId,
          ),
        );
      }
      return { errorCount: 0 };
    },
  });

  assert.deepEqual(currentDeletes, keys);
  assert.ok(exactDeletes.some((target) => target.versionId === "null"));
  assert.equal(listCalls > keys.length, true);
  for (const key of keys) assert.deepEqual(versions.get(key), []);
  assert.deepEqual(versions.get(foreignKey), ["foreign-version"]);
});

test("AWS cleanup fails closed on incomplete pagination and retained exact versions", async () => {
  const keys = Array.from({ length: 5 }, (_, index) => `exact/failure-${index}`);
  await assert.rejects(
    cleanupExactS3AppPrincipalKeys({
      keys,
      async deleteCurrent() {},
      async listPage() {
        return {
          isTruncated: true,
          versions: [{ key: keys[0], versionId: "null" }],
          deleteMarkers: [],
        };
      },
      async deleteVersions() {
        return { errorCount: 1 };
      },
    }),
    /cursor/,
  );

  await assert.rejects(
    cleanupExactS3AppPrincipalKeys({
      keys,
      async deleteCurrent() {},
      async listPage(key) {
        return {
          isTruncated: false,
          versions: [{ key, versionId: "undeletable" }],
          deleteMarkers: [],
        };
      },
      async deleteVersions() {
        throw new Error("denied");
      },
    }),
    /retained/,
  );
});
