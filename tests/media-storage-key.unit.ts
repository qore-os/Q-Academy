import assert from "node:assert/strict";
import test from "node:test";

import {
  createMediaObjectKey,
  isSafeMediaFileName,
  isValidMediaObjectIdentity,
} from "../src/lib/media/storage-key";

const organizationId = "11111111-1111-4111-8111-111111111111";
const assetId = "22222222-2222-4222-8222-222222222222";

test("media object keys are tenant and asset namespaced", () => {
  const key = createMediaObjectKey({
    organizationId,
    assetId,
    safeFileName: "quarterly-report.pdf",
  });
  assert.equal(
    key,
    `tenants/${organizationId}/assets/${assetId}/quarterly-report.pdf`,
  );
  assert.equal(
    isValidMediaObjectIdentity({ organizationId, assetId, key: key! }),
    true,
  );
});

test("media object keys reject traversal, mismatched tenants and unsafe names", () => {
  assert.equal(isSafeMediaFileName("lesson-video.mp4"), true);
  for (const fileName of [
    "../lesson.mp4",
    "Lesson Video.mp4",
    ".env",
    "lesson.mp4.exe?x=1",
  ]) {
    assert.equal(isSafeMediaFileName(fileName), false);
    assert.equal(
      createMediaObjectKey({ organizationId, assetId, safeFileName: fileName }),
      null,
    );
  }

  const key = `tenants/${organizationId}/assets/${assetId}/lesson-video.mp4`;
  assert.equal(
    isValidMediaObjectIdentity({
      organizationId: "33333333-3333-4333-8333-333333333333",
      assetId,
      key,
    }),
    false,
  );
});
