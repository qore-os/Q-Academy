import assert from "node:assert/strict";
import test from "node:test";
import { canonicalOidcOrigin } from "../src/lib/oidc-host-policy";

test("production OIDC origin prefers custom tenant login hostname", () => {
  assert.equal(
    canonicalOidcOrigin({
      production: true,
      loginHostname: "login.customer.example",
      organizationSlug: "customer",
      tenantBaseDomain: "academy.example",
      publicAppUrl: "https://app.example",
    }),
    "https://login.customer.example",
  );
});

test("production OIDC origin falls back to tenant subdomain then public origin", () => {
  assert.equal(
    canonicalOidcOrigin({
      production: true,
      organizationSlug: "customer",
      tenantBaseDomain: "academy.example",
      publicAppUrl: "https://app.example",
    }),
    "https://customer.academy.example",
  );
  assert.equal(
    canonicalOidcOrigin({
      production: true,
      publicAppUrl: "https://app.example/path",
    }),
    "https://app.example",
  );
});

test("development OIDC origin stays on the current request host", () => {
  assert.equal(
    canonicalOidcOrigin({
      production: false,
      developmentOrigin: "http://localhost:3000/settings",
      loginHostname: "login.customer.example",
      publicAppUrl: "http://127.0.0.1:3000",
    }),
    "http://localhost:3000",
  );
});
