import assert from "node:assert/strict";
import test from "node:test";
import {
  oidcRateClientCookiePolicy,
  oidcTransactionCookiePolicy,
} from "../src/lib/oidc-cookie-policy";

test("production OIDC cookies satisfy __Host invariants", () => {
  for (const policy of [
    oidcTransactionCookiePolicy(true),
    oidcRateClientCookiePolicy(true),
  ]) {
    assert.match(policy.name, /^__Host-/);
    assert.equal(policy.options.path, "/");
    assert.equal(policy.options.secure, true);
    assert.equal(policy.options.httpOnly, true);
    assert.equal(policy.options.sameSite, "lax");
    assert.equal(Object.hasOwn(policy.options, "domain"), false);
  }
  assert.equal(oidcTransactionCookiePolicy(true).options.maxAge, 10 * 60);
  assert.equal(oidcRateClientCookiePolicy(true).options.maxAge, 15 * 60);
});

test("development OIDC cookies remain host-only without Secure", () => {
  assert.equal(
    oidcTransactionCookiePolicy(false).name,
    "q_academy_oidc_transaction",
  );
  assert.equal(oidcRateClientCookiePolicy(false).name, "q_academy_oidc_client");
  assert.equal(oidcTransactionCookiePolicy(false).options.secure, false);
});
