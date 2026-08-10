import assert from "node:assert/strict";
import test from "node:test";

import { createStratoPresignedPost } from "../src/lib/media/s3-presigned-post";
import type { S3MediaStorageConfiguration } from "../src/lib/media/storage-configuration";

const configuration: S3MediaStorageConfiguration = {
  driver: "s3",
  runtimeEnvironment: "production",
  endpoint: "https://s3.hidrive.strato.com",
  region: "eu-central-1",
  bucket: "q-academy-production-media",
  accessKeyId: "QACADEMYACCESSKEY",
  secretAccessKey: "q-academy-test-secret-value",
  forcePathStyle: true,
  compatibilityMode: "strato-hidrive",
  limits: {
    maxUploadBytes: 2_000_000_000,
    tenantQuotaBytes: 10_000_000_000,
    signedUploadTtlSeconds: 300,
    multipartUploadTtlSeconds: 24 * 60 * 60,
    signedDownloadTtlSeconds: 300,
  },
  clamAv: { host: "clamav", port: 3310, required: true },
};

const input = {
  key: "incoming/tenant/asset/upload.bin",
  mimeType: "application/octet-stream",
  sizeBytes: 42,
  metadata: {
    "organization-id": "organization-id",
    "asset-id": "asset-id",
  },
} as const;

test("STRATO POST policy binds the exact key, size, type, and metadata", () => {
  const signed = createStratoPresignedPost(
    configuration,
    input,
    new Date("2026-07-15T12:34:56.000Z"),
  );
  const policy = JSON.parse(
    Buffer.from(signed.fields.policy!, "base64").toString("utf8"),
  ) as { expiration: string; conditions: unknown[] };

  assert.equal(signed.method, "POST");
  assert.equal(
    signed.url,
    "https://s3.hidrive.strato.com/q-academy-production-media",
  );
  assert.equal(signed.expiresInSeconds, 300);
  assert.equal(policy.expiration, "2026-07-15T12:39:56.000Z");
  assert.deepEqual(policy.conditions, [
    { bucket: "q-academy-production-media" },
    ["eq", "$key", input.key],
    ["content-length-range", 42, 42],
    ["eq", "$Content-Type", input.mimeType],
    ["eq", "$x-amz-meta-asset-id", "asset-id"],
    ["eq", "$x-amz-meta-organization-id", "organization-id"],
    { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
    {
      "x-amz-credential":
        "QACADEMYACCESSKEY/20260715/eu-central-1/s3/aws4_request",
    },
    { "x-amz-date": "20260715T123456Z" },
    { success_action_status: "201" },
  ]);
  assert.equal(signed.fields.key, input.key);
  assert.equal(signed.fields["Content-Type"], input.mimeType);
  assert.equal(signed.fields["x-amz-meta-asset-id"], "asset-id");
  assert.match(signed.fields["x-amz-signature"]!, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(signed), /q-academy-test-secret-value/);
});

test("STRATO POST signatures are deterministic and reject the strict mode", () => {
  const now = new Date("2026-07-15T12:34:56.000Z");
  const first = createStratoPresignedPost(configuration, input, now);
  const second = createStratoPresignedPost(
    configuration,
    {
      ...input,
      metadata: {
        "asset-id": "asset-id",
        "organization-id": "organization-id",
      },
    },
    now,
  );
  assert.deepEqual(second, first);
  assert.throws(
    () =>
      createStratoPresignedPost(
        { ...configuration, compatibilityMode: "versioned" },
        input,
        now,
      ),
    /STRATO compatibility mode/,
  );
});
