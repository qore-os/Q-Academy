import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedPrivacyTransitions,
  canTransitionPrivacyRequest,
  privacyPolicySnapshot,
} from "../src/lib/privacy/policy";
import { boundedPrivacyRetentionBatchSize } from "../src/lib/privacy/retention-policy";

test("privacy workflow permits only documented transitions", () => {
  assert.deepEqual(allowedPrivacyTransitions("received"), [
    "identity_verified",
    "rejected",
    "cancelled",
  ]);
  assert.equal(canTransitionPrivacyRequest("identity_verified", "approved"), true);
  assert.equal(canTransitionPrivacyRequest("approved", "processing"), true);
  assert.equal(canTransitionPrivacyRequest("processing", "blocked"), true);
  assert.equal(canTransitionPrivacyRequest("blocked", "approved"), true);
  assert.equal(canTransitionPrivacyRequest("completed", "approved"), false);
  assert.equal(canTransitionPrivacyRequest("received", "completed"), false);
});

test("privacy policy requires complete binary export and reviewed erasure", () => {
  const access = privacyPolicySnapshot("access_export");
  const erasure = privacyPolicySnapshot("erasure");

  assert.equal(access.completionCapabilities.structuredJsonExport, true);
  assert.equal(access.completionCapabilities.binaryMediaExport, true);
  assert.equal(erasure.completionCapabilities.erasureExecutor, true);
  assert.match(access.completionRule, /integrity-checked/);
  assert.match(erasure.completionRule, /legal holds/);
});

test("privacy artifact retention uses a bounded batch", () => {
  assert.equal(boundedPrivacyRetentionBatchSize(), 25);
  assert.equal(boundedPrivacyRetentionBatchSize(1), 1);
  assert.equal(boundedPrivacyRetentionBatchSize(500), 100);
  for (const value of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => boundedPrivacyRetentionBatchSize(value), TypeError);
  }
});
