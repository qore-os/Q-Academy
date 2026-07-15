import assert from "node:assert/strict";
import test from "node:test";

import {
  browserPermissionsPolicy,
  buildDocumentContentSecurityPolicy,
  createContentSecurityPolicyNonce,
  resourceContentSecurityPolicy,
} from "../src/lib/content-security-policy";

test("production document CSP requires nonced scripts without eval", () => {
  const nonce = "a".repeat(32);
  const policy = buildDocumentContentSecurityPolicy({
    nonce,
    development: false,
    upgradeInsecureRequests: true,
  });

  assert.match(policy, new RegExp(`script-src [^;]*'nonce-${nonce}'`));
  assert.match(policy, /script-src [^;]*'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /script-src [^;]*'unsafe-eval'/);
  assert.match(policy, /script-src-attr 'none'/);
  assert.match(policy, /connect-src 'self' https: wss:/);
  assert.doesNotMatch(policy, /connect-src [^;]*http:/);
  assert.match(policy, /upgrade-insecure-requests$/);
});

test("development CSP limits its compatibility exceptions to development", () => {
  const policy = buildDocumentContentSecurityPolicy({
    nonce: "b".repeat(32),
    development: true,
    upgradeInsecureRequests: false,
  });

  assert.match(policy, /script-src [^;]*'unsafe-eval'/);
  assert.match(policy, /connect-src [^;]*http: [^;]*ws:/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("CSP nonces are independent URL-safe 128-bit values", () => {
  const first = createContentSecurityPolicyNonce();
  const second = createContentSecurityPolicyNonce();
  assert.match(first, /^[A-Za-z0-9_-]{32}$/);
  assert.match(second, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first, second);
});

test("CSP builder rejects attacker-controlled nonce syntax", () => {
  assert.throws(
    () =>
      buildDocumentContentSecurityPolicy({
        nonce: "bad'; script-src *",
        development: false,
        upgradeInsecureRequests: false,
      }),
    /CSP nonce/,
  );
});

test("non-document and browser capability policies fail closed", () => {
  assert.match(resourceContentSecurityPolicy, /^default-src 'none'/);
  assert.match(resourceContentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(browserPermissionsPolicy, /camera=\(self\)/);
  assert.match(browserPermissionsPolicy, /microphone=\(self\)/);
  assert.match(browserPermissionsPolicy, /geolocation=\(\)/);
  assert.match(browserPermissionsPolicy, /usb=\(\)/);
});
