const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const TEBIBYTE = 1024 * GIBIBYTE;

export const S3_MULTIPART_DEFAULT_PART_BYTES = 32 * MEBIBYTE;
export const S3_MULTIPART_COMPLETION_RECOVERY_MS = 30 * 60_000;
export const S3_MULTIPART_LIFECYCLE_CLOCK_MARGIN_MS = 15 * 60_000;
export const S3_MULTIPART_MIN_PART_BYTES = 5 * MEBIBYTE;
export const S3_MULTIPART_MAX_PART_BYTES = 5 * GIBIBYTE;
export const S3_MULTIPART_MAX_PARTS = 10_000;
export const S3_MULTIPART_MAX_OBJECT_BYTES = 5 * TEBIBYTE;

const PART_ALIGNMENT_BYTES = MEBIBYTE;
const SHA256_BASE64_PATTERN = /^[a-z0-9+/]{42}[aeimquycgkosw048]=$/i;

export type S3MultipartUploadPlan = Readonly<{
  expectedSizeBytes: number;
  partSizeBytes: number;
  partCount: number;
}>;

export type S3MultipartProviderPart = Readonly<{
  PartNumber?: number;
  Size?: number;
  ETag?: string;
  ChecksumSHA256?: string;
}>;

export type S3MultipartVerifiedPart = Readonly<{
  partNumber: number;
  sizeBytes: number;
  etag: string;
  checksumSha256: string;
}>;

export class S3MultipartPolicyError extends Error {
  readonly code:
    | "invalid_size"
    | "invalid_part"
    | "invalid_checksum"
    | "invalid_upload_id"
    | "incomplete_upload";

  constructor(code: S3MultipartPolicyError["code"], message: string) {
    super(message);
    this.name = "S3MultipartPolicyError";
    this.code = code;
  }
}

function positiveSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      `${name} must be a positive safe integer.`,
    );
  }
}

function alignedPartSize(value: number) {
  const aligned = Math.ceil(value / PART_ALIGNMENT_BYTES) * PART_ALIGNMENT_BYTES;
  if (!Number.isSafeInteger(aligned) || aligned > S3_MULTIPART_MAX_PART_BYTES) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The multipart upload requires parts larger than the S3 limit.",
    );
  }
  return aligned;
}

export function createS3MultipartUploadPlan(
  expectedSizeBytes: number,
  preferredPartSizeBytes = S3_MULTIPART_DEFAULT_PART_BYTES,
): S3MultipartUploadPlan {
  positiveSafeInteger(expectedSizeBytes, "expectedSizeBytes");
  positiveSafeInteger(preferredPartSizeBytes, "preferredPartSizeBytes");
  if (expectedSizeBytes > S3_MULTIPART_MAX_OBJECT_BYTES) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The object exceeds the S3 multipart object limit.",
    );
  }
  if (
    preferredPartSizeBytes < S3_MULTIPART_MIN_PART_BYTES ||
    preferredPartSizeBytes > S3_MULTIPART_MAX_PART_BYTES
  ) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The preferred multipart part size is outside the S3 limits.",
    );
  }

  const minimumForPartLimit = Math.ceil(
    expectedSizeBytes / S3_MULTIPART_MAX_PARTS,
  );
  const partSizeBytes = alignedPartSize(
    Math.max(preferredPartSizeBytes, minimumForPartLimit),
  );
  const partCount = Math.ceil(expectedSizeBytes / partSizeBytes);
  if (
    !Number.isSafeInteger(partCount) ||
    partCount < 1 ||
    partCount > S3_MULTIPART_MAX_PARTS
  ) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The multipart upload exceeds the S3 part-count limit.",
    );
  }

  return Object.freeze({ expectedSizeBytes, partSizeBytes, partCount });
}

export function expectedS3MultipartPartSize(
  plan: S3MultipartUploadPlan,
  partNumber: number,
) {
  const canonical = createS3MultipartUploadPlan(
    plan.expectedSizeBytes,
    plan.partSizeBytes,
  );
  if (canonical.partCount !== plan.partCount) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The multipart upload plan is inconsistent.",
    );
  }
  if (
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > canonical.partCount
  ) {
    throw new S3MultipartPolicyError(
      "invalid_part",
      "The multipart part number is outside the upload plan.",
    );
  }
  return partNumber === canonical.partCount
    ? canonical.expectedSizeBytes -
        canonical.partSizeBytes * (canonical.partCount - 1)
    : canonical.partSizeBytes;
}

export function requireS3MultipartSha256(value: unknown) {
  if (typeof value !== "string" || !SHA256_BASE64_PATTERN.test(value)) {
    throw new S3MultipartPolicyError(
      "invalid_checksum",
      "The multipart part has no canonical SHA-256 checksum.",
    );
  }
  return value;
}

export function requireS3MultipartUploadId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new S3MultipartPolicyError(
      "invalid_upload_id",
      "The S3 multipart upload ID is invalid.",
    );
  }
  return value;
}

function requirePartEtag(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new S3MultipartPolicyError(
      "invalid_part",
      "The multipart part has no valid ETag.",
    );
  }
  return value;
}

export function verifyS3MultipartParts(input: {
  plan: S3MultipartUploadPlan;
  parts: readonly S3MultipartProviderPart[];
  requireComplete?: boolean;
}) {
  const plan = createS3MultipartUploadPlan(
    input.plan.expectedSizeBytes,
    input.plan.partSizeBytes,
  );
  if (plan.partCount !== input.plan.partCount) {
    throw new S3MultipartPolicyError(
      "invalid_size",
      "The multipart upload plan is inconsistent.",
    );
  }
  if (input.parts.length > plan.partCount) {
    throw new S3MultipartPolicyError(
      "invalid_part",
      "The provider returned more multipart parts than expected.",
    );
  }

  let previousPartNumber = 0;
  let uploadedBytes = 0;
  const parts: S3MultipartVerifiedPart[] = input.parts.map((part) => {
    const partNumber = Number(part.PartNumber);
    if (
      !Number.isSafeInteger(partNumber) ||
      partNumber <= previousPartNumber
    ) {
      throw new S3MultipartPolicyError(
        "invalid_part",
        "The provider returned unordered or duplicate multipart parts.",
      );
    }
    const expectedSizeBytes = expectedS3MultipartPartSize(plan, partNumber);
    if (part.Size !== expectedSizeBytes) {
      throw new S3MultipartPolicyError(
        "invalid_size",
        "A multipart part does not match its expected size.",
      );
    }
    previousPartNumber = partNumber;
    uploadedBytes += expectedSizeBytes;
    if (
      !Number.isSafeInteger(uploadedBytes) ||
      uploadedBytes > plan.expectedSizeBytes
    ) {
      throw new S3MultipartPolicyError(
        "invalid_size",
        "The uploaded multipart data exceeds the expected object size.",
      );
    }
    return Object.freeze({
      partNumber,
      sizeBytes: expectedSizeBytes,
      etag: requirePartEtag(part.ETag),
      checksumSha256: requireS3MultipartSha256(part.ChecksumSHA256),
    });
  });

  const complete =
    parts.length === plan.partCount &&
    parts.every((part, index) => part.partNumber === index + 1) &&
    uploadedBytes === plan.expectedSizeBytes;
  if (input.requireComplete && !complete) {
    throw new S3MultipartPolicyError(
      "incomplete_upload",
      "The multipart upload does not contain every expected byte.",
    );
  }

  return Object.freeze({
    plan,
    parts: Object.freeze(parts),
    uploadedBytes,
    complete,
  });
}
