const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,114}\.[a-z0-9]{1,8}$/;
const OBJECT_KEY_PATTERN =
  /^(?:incoming\/)?tenants\/[0-9a-f-]{36}\/assets\/[0-9a-f-]{36}\/[a-z0-9][a-z0-9_.-]{1,123}$/;

export type MediaObjectIdentity = Readonly<{
  organizationId: string;
  assetId: string;
  key: string;
}>;

export function isSafeMediaFileName(value: string) {
  return SAFE_FILE_NAME_PATTERN.test(value);
}

export function isValidMediaObjectIdentity(identity: MediaObjectIdentity) {
  return (
    UUID_PATTERN.test(identity.organizationId) &&
    UUID_PATTERN.test(identity.assetId) &&
    OBJECT_KEY_PATTERN.test(identity.key) &&
    (identity.key.startsWith(
      `tenants/${identity.organizationId}/assets/${identity.assetId}/`,
    ) ||
      identity.key.startsWith(
        `incoming/tenants/${identity.organizationId}/assets/${identity.assetId}/`,
      ))
  );
}

export function createMediaObjectKey(input: {
  organizationId: string;
  assetId: string;
  safeFileName: string;
}) {
  if (
    !UUID_PATTERN.test(input.organizationId) ||
    !UUID_PATTERN.test(input.assetId) ||
    !isSafeMediaFileName(input.safeFileName)
  ) {
    return null;
  }
  return `tenants/${input.organizationId}/assets/${input.assetId}/${input.safeFileName}`;
}

export function createMediaStagingObjectKey(input: {
  organizationId: string;
  assetId: string;
  safeFileName: string;
}) {
  const finalKey = createMediaObjectKey(input);
  return finalKey ? `incoming/${finalKey}` : null;
}
