import { createHash } from "node:crypto";

export const S3_MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024;
export const S3_MULTIPART_CANARY_PART_COUNT = 3 as const;

export type S3MultipartCanaryPart = Readonly<{
  partNumber: number;
  body: Uint8Array;
  checksumSha256: string;
}>;

function checksumSha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("base64");
}

export function compositeS3MultipartSha256(
  parts: readonly Readonly<{ checksumSha256: string }>[],
) {
  if (parts.length < 1 || parts.some((part) => !part.checksumSha256)) {
    throw new TypeError("The S3 multipart checksum parts are invalid.");
  }
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(Buffer.from(part.checksumSha256, "base64"));
  }
  return `${hash.digest("base64")}-${parts.length}`;
}

export function createS3MultipartCanaryParts(
  seed: Uint8Array,
): readonly S3MultipartCanaryPart[] {
  if (
    !(seed instanceof Uint8Array) ||
    seed.byteLength < 32 ||
    seed.byteLength > 4_096
  ) {
    throw new TypeError("The S3 multipart canary seed is invalid.");
  }
  const first = new Uint8Array(S3_MULTIPART_MIN_PART_BYTES);
  const second = new Uint8Array(S3_MULTIPART_MIN_PART_BYTES);
  for (let index = 0; index < first.byteLength; index += 1) {
    first[index] = seed[index % seed.byteLength] ^ 0x5a;
    second[index] = seed[(index + 17) % seed.byteLength] ^ 0xa5;
  }
  return [first, second, Uint8Array.from(seed)].map((body, index) => ({
    partNumber: index + 1,
    body,
    checksumSha256: checksumSha256(body),
  }));
}

export function joinS3MultipartCanaryParts(
  parts: readonly S3MultipartCanaryPart[],
) {
  if (
    parts.length !== S3_MULTIPART_CANARY_PART_COUNT ||
    parts.some((part, index) => part.partNumber !== index + 1)
  ) {
    throw new TypeError("The S3 multipart canary parts are invalid.");
  }
  return Buffer.concat(parts.map((part) => Buffer.from(part.body)));
}
