function unexpectedStorageCall(name) {
  throw new Error(`Unexpected ${name} call in direct-upload claim behavior test.`);
}

export async function createMediaUploadAuthorization() {
  return unexpectedStorageCall("createMediaUploadAuthorization");
}

export async function writeDevelopmentMediaObject() {
  return unexpectedStorageCall("writeDevelopmentMediaObject");
}

export async function deleteStoredMediaObject() {
  return undefined;
}

export async function inspectStoredMediaObject(identity) {
  const expectedAssetId = process.env.TEST_MEDIA_ASSET_ID;
  const expectedOrganizationId = process.env.TEST_MEDIA_ORGANIZATION_ID;
  if (
    !expectedAssetId ||
    !expectedOrganizationId ||
    identity.assetId !== expectedAssetId ||
    identity.organizationId !== expectedOrganizationId
  ) {
    throw new Error("Unexpected media identity in direct-upload completion test.");
  }
  return {
    sizeBytes: Number(process.env.TEST_MEDIA_SIZE_BYTES),
    mimeType: process.env.TEST_MEDIA_MIME_TYPE,
    etag: "direct-upload-claim-test-etag",
    versionId: "direct-upload-claim-test-version",
    lastModified: new Date(),
  };
}
