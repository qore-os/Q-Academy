import { avatarMediaAssetId, safeAvatarSource } from "@/lib/avatar-policy";

export const COMMUNITY_PROFILE_VALUE_BATCH_SIZE = 500;

export function communityProfileValueBatches<T>(
  values: readonly T[],
  batchSize = COMMUNITY_PROFILE_VALUE_BATCH_SIZE,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("batchSize must be a positive integer");
  }
  const batches: T[][] = [];
  for (let offset = 0; offset < values.length; offset += batchSize) {
    batches.push(values.slice(offset, offset + batchSize));
  }
  return batches;
}

export function sanitizeCommunityPublicProfileValue(value: string) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ""))
    .slice(0, 1_000)
    .join("");
}

export function communityPublicAvatarSource(
  value: unknown,
  downloadContext: "session" | "api" = "session",
) {
  const source = safeAvatarSource(value);
  if (!source || downloadContext === "session") return source;
  const mediaAssetId = avatarMediaAssetId(source);
  return mediaAssetId
    ? `/api/v1/media-assets/${mediaAssetId}/download`
    : source;
}
