import assert from "node:assert/strict";
import { test } from "node:test";

import {
  exactS3VersionDeletionTargets,
  immutableS3ObjectLocator,
  requireS3VersionId,
  S3ObjectIntegrityError,
  verifyS3ObjectIntegrity,
  versionedS3CopySource,
} from "../src/lib/media/s3-object-integrity";

const expected = {
  versionId: "scanned-version-1",
  etag: "final-etag",
  sizeBytes: 42,
  mimeType: "application/pdf",
  metadata: {
    "asset-id": "5b9be141-0563-4bf7-8059-47f5612f07bb",
    "organization-id": "87bd24da-c289-48f1-867a-1a6bd4716715",
    sha256: "a".repeat(64),
  },
} as const;

function stored(overrides: Record<string, unknown> = {}) {
  return {
    VersionId: expected.versionId,
    ETag: `"${expected.etag}"`,
    ContentLength: expected.sizeBytes,
    ContentType: expected.mimeType,
    Metadata: { ...expected.metadata },
    ...overrides,
  };
}

test("an overwritten key cannot replace the scanned download version", () => {
  const original = verifyS3ObjectIntegrity(stored(), expected);
  assert.equal(original.versionId, expected.versionId);
  assert.deepEqual(
    immutableS3ObjectLocator("tenants/acme/final.pdf", original.versionId),
    {
      Key: "tenants/acme/final.pdf",
      VersionId: "scanned-version-1",
    },
  );

  assert.throws(
    () =>
      verifyS3ObjectIntegrity(
        stored({ VersionId: "unscanned-newer-version", ETag: '"other"' }),
        expected,
      ),
    S3ObjectIntegrityError,
  );
});

test("unversioned S3 providers fail closed", () => {
  assert.throws(() => requireS3VersionId(undefined), S3ObjectIntegrityError);
  assert.throws(() => requireS3VersionId("null"), S3ObjectIntegrityError);
  assert.throws(
    () => verifyS3ObjectIntegrity(stored({ VersionId: undefined }), expected),
    S3ObjectIntegrityError,
  );
});

test("promotion verification is idempotent and binds digest metadata", () => {
  const first = verifyS3ObjectIntegrity(stored(), expected);
  const retry = verifyS3ObjectIntegrity(stored(), expected);
  assert.deepEqual(retry, first);

  assert.throws(
    () =>
      verifyS3ObjectIntegrity(
        stored({ Metadata: { ...expected.metadata, sha256: "b".repeat(64) } }),
        expected,
      ),
    S3ObjectIntegrityError,
  );
  assert.throws(
    () => verifyS3ObjectIntegrity(stored({ ETag: '"other-etag"' }), expected),
    S3ObjectIntegrityError,
  );
  assert.throws(
    () => verifyS3ObjectIntegrity(stored({ ContentLength: 43 }), expected),
    S3ObjectIntegrityError,
  );
});

test("copy promotion pins the exact staging version", () => {
  assert.equal(
    versionedS3CopySource("private bucket", "incoming/a b.pdf", "v/1+stable"),
    "/private%20bucket/incoming/a%20b.pdf?versionId=v%2F1%2Bstable",
  );
});

test("hard deletion includes every exact-key version and delete marker", () => {
  assert.deepEqual(
    exactS3VersionDeletionTargets(
      "tenants/acme/final.pdf",
      [
        { Key: "tenants/acme/final.pdf", VersionId: "v2" },
        { Key: "tenants/acme/final.pdf", VersionId: "v1" },
        { Key: "tenants/acme/final.pdf.preview", VersionId: "foreign" },
      ],
      [{ Key: "tenants/acme/final.pdf", VersionId: "delete-marker" }],
    ),
    [
      { Key: "tenants/acme/final.pdf", VersionId: "v2" },
      { Key: "tenants/acme/final.pdf", VersionId: "v1" },
      { Key: "tenants/acme/final.pdf", VersionId: "delete-marker" },
    ],
  );
});
