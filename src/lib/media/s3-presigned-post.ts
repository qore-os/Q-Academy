import { createHmac } from "node:crypto";

import type { S3MediaStorageConfiguration } from "./storage-configuration";

type StratoPresignedPostInput = Readonly<{
  key: string;
  mimeType: string;
  sizeBytes: number;
  metadata: Readonly<Record<string, string>>;
}>;

function hmac(key: Uint8Array | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signatureKey(secret: string, date: string, region: string) {
  const dateKey = hmac(`AWS4${secret}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function amzTimestamp(now: Date) {
  if (!Number.isFinite(now.getTime())) throw new TypeError("Invalid S3 clock.");
  return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function metadataFieldName(name: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) {
    throw new TypeError("Invalid S3 POST metadata name.");
  }
  return `x-amz-meta-${name}`;
}

export function createStratoPresignedPost(
  configuration: S3MediaStorageConfiguration,
  input: StratoPresignedPostInput,
  now = new Date(),
) {
  if (configuration.compatibilityMode !== "strato-hidrive") {
    throw new TypeError("STRATO POST signing requires STRATO compatibility mode.");
  }
  if (
    !input.key ||
    input.key.length > 1024 ||
    !input.mimeType ||
    input.mimeType.length > 255 ||
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0
  ) {
    throw new TypeError("Invalid STRATO POST object identity.");
  }

  const timestamp = amzTimestamp(now);
  const date = timestamp.slice(0, 8);
  const credential = `${configuration.accessKeyId}/${date}/${configuration.region}/s3/aws4_request`;
  const expiration = new Date(
    now.getTime() + configuration.limits.signedUploadTtlSeconds * 1_000,
  ).toISOString();
  const fields: Record<string, string> = {
    key: input.key,
    "Content-Type": input.mimeType,
    "x-amz-algorithm": "AWS4-HMAC-SHA256",
    "x-amz-credential": credential,
    "x-amz-date": timestamp,
    success_action_status: "201",
  };
  const metadataConditions = Object.entries(input.metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => {
      const field = metadataFieldName(name);
      if (!value || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError("Invalid S3 POST metadata value.");
      }
      fields[field] = value;
      return ["eq", `$${field}`, value] as const;
    });
  const policy = Buffer.from(
    JSON.stringify({
      expiration,
      conditions: [
        { bucket: configuration.bucket },
        ["eq", "$key", input.key],
        ["content-length-range", input.sizeBytes, input.sizeBytes],
        ["eq", "$Content-Type", input.mimeType],
        ...metadataConditions,
        { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
        { "x-amz-credential": credential },
        { "x-amz-date": timestamp },
        { success_action_status: "201" },
      ],
    }),
  ).toString("base64");
  fields.policy = policy;
  fields["x-amz-signature"] = createHmac(
    "sha256",
    signatureKey(
      configuration.secretAccessKey,
      date,
      configuration.region,
    ),
  )
    .update(policy)
    .digest("hex");

  return {
    method: "POST" as const,
    url: `${configuration.endpoint}/${encodeURIComponent(configuration.bucket)}`,
    fields,
    expiresInSeconds: configuration.limits.signedUploadTtlSeconds,
  };
}
