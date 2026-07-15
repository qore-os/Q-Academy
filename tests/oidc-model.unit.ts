import assert from "node:assert/strict";
import test from "node:test";
import {
  isFreshOidcAuthenticationTime,
  normalizeOidcEmailDomains,
  normalizeOidcIssuer,
  oidcDestinationForRole,
  oidcEmailIsAllowed,
  oidcIdentityClaimsSchema,
  oidcLoginTransactionSchema,
  oidcNamesFromClaims,
  parseOidcAuthenticationTime,
  sanitizeOidcReturnTo,
} from "../src/lib/oidc-model";

test("OIDC issuer normalization requires HTTPS and rejects URL confusion", () => {
  assert.equal(
    normalizeOidcIssuer(" HTTPS://LOGIN.EXAMPLE.COM/tenant/// "),
    "https://login.example.com/tenant",
  );
  for (const issuer of [
    "http://login.example.com",
    "https://user:secret@login.example.com",
    "https://login.example.com?redirect=https://evil.example",
    "https://login.example.com/#evil",
    "javascript:alert(1)",
  ]) {
    assert.throws(() => normalizeOidcIssuer(issuer), /Issuer-URL/);
  }
  assert.equal(
    normalizeOidcIssuer("http://127.0.0.1:4010/oidc", {
      allowInsecureLocalhost: true,
    }),
    "http://127.0.0.1:4010/oidc",
  );
  assert.throws(
    () =>
      normalizeOidcIssuer("http://192.168.1.5/oidc", {
        allowInsecureLocalhost: true,
      }),
    /Issuer-URL/,
  );
});

test("OIDC email domains are canonical, unique, bounded and exact", () => {
  assert.deepEqual(
    normalizeOidcEmailDomains([
      " @EXAMPLE.COM ",
      "example.com",
      "sub.example.com",
    ]),
    ["example.com", "sub.example.com"],
  );
  assert.equal(oidcEmailIsAllowed("lea@example.com", ["example.com"]), true);
  assert.equal(
    oidcEmailIsAllowed("lea@sub.example.com", ["example.com"]),
    false,
  );
  assert.equal(oidcEmailIsAllowed("lea@evil-example.com", ["example.com"]), false);
  assert.equal(oidcEmailIsAllowed("lea@any.example", []), true);
  for (const domain of ["localhost", "-example.com", "example..com", ".com"])
    assert.throws(() => normalizeOidcEmailDomains([domain]), /Domain/);
});

test("OIDC claims require a verified normalized email and bounded identity", () => {
  const claims = oidcIdentityClaimsSchema.parse({
    sub: "person-123",
    email: " LEA@Example.COM ",
    email_verified: true,
    given_name: "Lea",
    family_name: "Sommer",
  });
  assert.equal(claims.email, "lea@example.com");
  assert.equal(
    oidcIdentityClaimsSchema.parse({
      sub: " person-123 ",
      email: "lea@example.com",
      email_verified: true,
    }).sub,
    " person-123 ",
  );
  assert.deepEqual(oidcNamesFromClaims(claims), {
    firstName: "Lea",
    lastName: "Sommer",
  });
  assert.equal(
    oidcIdentityClaimsSchema.safeParse({
      sub: "person-123",
      email: "lea@example.com",
      email_verified: false,
    }).success,
    false,
  );
  assert.equal(
    oidcIdentityClaimsSchema.safeParse({
      sub: "person\n123",
      email: "lea@example.com",
      email_verified: true,
    }).success,
    false,
  );
});

test("OIDC return targets never leave the role area", () => {
  assert.equal(sanitizeOidcReturnTo("/academy/courses?view=grid"), "/academy/courses?view=grid");
  assert.equal(
    sanitizeOidcReturnTo("/admin/settings#sicherheit"),
    "/admin/settings#sicherheit",
  );
  assert.equal(
    sanitizeOidcReturnTo("/academy/profile#mfa"),
    "/academy/profile#mfa",
  );
  assert.equal(
    sanitizeOidcReturnTo("/admin/settings#%0Aunsafe"),
    "/admin/settings",
  );
  assert.equal(sanitizeOidcReturnTo("https://evil.example"), "/");
  assert.equal(sanitizeOidcReturnTo("//evil.example/admin"), "/");
  assert.equal(sanitizeOidcReturnTo("/admin\\@evil.example"), "/");
  assert.equal(sanitizeOidcReturnTo("/academyevil"), "/");
  assert.equal(sanitizeOidcReturnTo("/administrator"), "/");
  assert.equal(oidcDestinationForRole("member", "/admin"), "/academy");
  assert.equal(oidcDestinationForRole("trainer", "/academy"), "/admin");
  assert.equal(
    oidcDestinationForRole("owner", "/academy/profile#mfa"),
    "/academy/profile#mfa",
  );
  assert.equal(
    oidcDestinationForRole("owner", "/admin/settings#sicherheit"),
    "/admin/settings#sicherheit",
  );
});

test("OIDC fresh authentication time rejects stale, future and invalid claims", () => {
  const now = Date.UTC(2026, 6, 13, 12, 0, 0);
  const at = (milliseconds: number) =>
    parseOidcAuthenticationTime(milliseconds / 1000);

  assert.equal(isFreshOidcAuthenticationTime(at(now - 5 * 60_000), now), true);
  assert.equal(
    isFreshOidcAuthenticationTime(at(now - 5 * 60_000 - 1), now),
    false,
  );
  assert.equal(isFreshOidcAuthenticationTime(at(now + 60_000), now), true);
  assert.equal(
    isFreshOidcAuthenticationTime(at(now + 60_001), now),
    false,
  );
  for (const value of [undefined, "123", Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE]) {
    assert.equal(parseOidcAuthenticationTime(value), null);
  }
  assert.equal(isFreshOidcAuthenticationTime(new Date(Number.NaN), now), false);
});

test("OIDC transaction schema rejects malformed state and cross-tenant data", () => {
  assert.equal(
    oidcLoginTransactionSchema.safeParse({
      state: "a".repeat(43),
      nonce: "b".repeat(43),
      codeVerifier: "c".repeat(64),
      organizationId: "11111111-1111-4111-8111-111111111111",
      issuer: "https://login.example.com",
      configurationVersion: 3,
      redirectUri: "https://academy.example.com/api/v1/auth/oidc/callback",
      returnTo: "/academy",
      linkUserId: null,
      linkSessionId: null,
      requireFreshAuthentication: false,
    }).success,
    true,
  );
  assert.equal(
    oidcLoginTransactionSchema.safeParse({
      state: "short",
      nonce: "b".repeat(43),
      codeVerifier: "c".repeat(64),
      organizationId: "not-a-uuid",
      issuer: "https://login.example.com",
      configurationVersion: 3,
      redirectUri: "https://academy.example.com/api/v1/auth/oidc/callback",
      returnTo: "/academy",
      linkUserId: null,
      linkSessionId: null,
      requireFreshAuthentication: false,
    }).success,
    false,
  );
});
