import assert from "node:assert/strict";
import test from "node:test";

import {
  createS3MultipartUploadPlan,
  expectedS3MultipartPartSize,
  requireS3MultipartSha256,
  requireS3MultipartUploadId,
  S3_MULTIPART_DEFAULT_PART_BYTES,
  S3_MULTIPART_MAX_OBJECT_BYTES,
  S3_MULTIPART_MAX_PARTS,
  S3_MULTIPART_MIN_PART_BYTES,
  S3MultipartPolicyError,
  verifyS3MultipartParts,
} from "../src/lib/media/s3-multipart-policy";

function checksum(byte: number) {
  return Buffer.alloc(32, byte).toString("base64");
}

function providerParts(plan: ReturnType<typeof createS3MultipartUploadPlan>) {
  return Array.from({ length: plan.partCount }, (_, index) => ({
    PartNumber: index + 1,
    Size: expectedS3MultipartPartSize(plan, index + 1),
    ETag: `"part-${index + 1}"`,
    ChecksumSHA256: checksum(index + 1),
  }));
}

test("multipart planning uses 32 MiB parts and an exact final part", () => {
  const expectedSizeBytes = S3_MULTIPART_DEFAULT_PART_BYTES * 2 + 123;
  const plan = createS3MultipartUploadPlan(expectedSizeBytes);

  assert.deepEqual(plan, {
    expectedSizeBytes,
    partSizeBytes: S3_MULTIPART_DEFAULT_PART_BYTES,
    partCount: 3,
  });
  assert.equal(
    expectedS3MultipartPartSize(plan, 1),
    S3_MULTIPART_DEFAULT_PART_BYTES,
  );
  assert.equal(expectedS3MultipartPartSize(plan, 3), 123);
});

test("multipart planning grows aligned parts before exceeding 10,000 parts", () => {
  const expectedSizeBytes =
    S3_MULTIPART_DEFAULT_PART_BYTES * S3_MULTIPART_MAX_PARTS + 1;
  const plan = createS3MultipartUploadPlan(expectedSizeBytes);

  assert.ok(plan.partSizeBytes > S3_MULTIPART_DEFAULT_PART_BYTES);
  assert.equal(plan.partSizeBytes % (1024 * 1024), 0);
  assert.ok(plan.partCount <= S3_MULTIPART_MAX_PARTS);
  assert.equal(
    Array.from({ length: plan.partCount }, (_, index) =>
      expectedS3MultipartPartSize(plan, index + 1),
    ).reduce((total, value) => total + value, 0),
    expectedSizeBytes,
  );
});

test("multipart planning enforces S3 size limits", () => {
  assert.throws(
    () =>
      createS3MultipartUploadPlan(
        10 * 1024 * 1024,
        S3_MULTIPART_MIN_PART_BYTES - 1,
      ),
    S3MultipartPolicyError,
  );
  assert.throws(
    () => createS3MultipartUploadPlan(S3_MULTIPART_MAX_OBJECT_BYTES + 1),
    S3MultipartPolicyError,
  );
  assert.throws(
    () => createS3MultipartUploadPlan(0),
    S3MultipartPolicyError,
  );
});

test("provider parts are verified against every expected byte", () => {
  const plan = createS3MultipartUploadPlan(
    S3_MULTIPART_DEFAULT_PART_BYTES * 2 + 123,
  );
  const verified = verifyS3MultipartParts({
    plan,
    parts: providerParts(plan),
    requireComplete: true,
  });

  assert.equal(verified.complete, true);
  assert.equal(verified.uploadedBytes, plan.expectedSizeBytes);
  assert.deepEqual(
    verified.parts.map(({ partNumber, sizeBytes }) => ({
      partNumber,
      sizeBytes,
    })),
    [
      { partNumber: 1, sizeBytes: S3_MULTIPART_DEFAULT_PART_BYTES },
      { partNumber: 2, sizeBytes: S3_MULTIPART_DEFAULT_PART_BYTES },
      { partNumber: 3, sizeBytes: 123 },
    ],
  );
});

test("sparse provider listings are valid for resume but not completion", () => {
  const plan = createS3MultipartUploadPlan(
    S3_MULTIPART_DEFAULT_PART_BYTES * 3,
  );
  const sparse = [providerParts(plan)[1]!];

  const verified = verifyS3MultipartParts({ plan, parts: sparse });
  assert.equal(verified.complete, false);
  assert.equal(verified.uploadedBytes, S3_MULTIPART_DEFAULT_PART_BYTES);
  assert.throws(
    () => verifyS3MultipartParts({ plan, parts: sparse, requireComplete: true }),
    (error: unknown) => {
      assert.ok(error instanceof S3MultipartPolicyError);
      assert.equal(error.code, "incomplete_upload");
      return true;
    },
  );
});

test("provider listings reject wrong sizes, order, and checksums", () => {
  const plan = createS3MultipartUploadPlan(
    S3_MULTIPART_DEFAULT_PART_BYTES * 2,
  );
  const valid = providerParts(plan);

  for (const parts of [
    [{ ...valid[0]!, Size: valid[0]!.Size + 1 }],
    [valid[1]!, valid[0]!],
    [valid[0]!, { ...valid[1]!, PartNumber: 1 }],
    [{ ...valid[0]!, ChecksumSHA256: "not-a-checksum" }],
    [{ ...valid[0]!, ETag: "" }],
  ]) {
    assert.throws(
      () => verifyS3MultipartParts({ plan, parts }),
      S3MultipartPolicyError,
    );
  }
});

test("multipart opaque identifiers and SHA-256 checksums are canonical", () => {
  const validChecksum = checksum(7);
  assert.equal(requireS3MultipartSha256(validChecksum), validChecksum);
  assert.equal(requireS3MultipartUploadId("provider-upload+/=id"), "provider-upload+/=id");

  for (const value of [
    validChecksum.slice(0, -1),
    `${validChecksum.slice(0, -1)}!`,
    `${validChecksum}suffix`,
    `${validChecksum.slice(0, -2)}B=`,
  ]) {
    assert.throws(() => requireS3MultipartSha256(value), S3MultipartPolicyError);
  }
  for (const value of ["", " upload-id", "upload-id\n", "x".repeat(2049)]) {
    assert.throws(() => requireS3MultipartUploadId(value), S3MultipartPolicyError);
  }
});
