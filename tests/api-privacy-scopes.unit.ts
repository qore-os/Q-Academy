import assert from "node:assert/strict";
import test from "node:test";

import {
  apiScopeIsGranted,
  DELEGABLE_API_SCOPES,
  isEligiblePrivacyApiKeyOwner,
  missingApiScopes,
} from "../src/lib/api/scopes";

test("wildcard scopes never grant privileged privacy access", () => {
  assert.equal(apiScopeIsGranted(["*"], "courses:read"), true);
  assert.equal(apiScopeIsGranted(["*"], "privacy:read"), false);
  assert.equal(apiScopeIsGranted(["*"], "privacy:write"), false);
  assert.equal(apiScopeIsGranted(["*"], "authentication:read"), false);
  assert.equal(apiScopeIsGranted(["*"], "authentication:write"), false);
  assert.deepEqual(
    missingApiScopes(["*"], ["courses:read", "privacy:read"]),
    ["privacy:read"],
  );
  assert.equal(apiScopeIsGranted(["privacy:read"], "privacy:read"), true);
});

test("privacy scopes are excluded from API-key delegation", () => {
  assert.equal(DELEGABLE_API_SCOPES.includes("courses:read"), true);
  assert.equal(
    DELEGABLE_API_SCOPES.some((scope) => scope.startsWith("privacy:")),
    false,
  );
  assert.equal(
    DELEGABLE_API_SCOPES.some((scope) => scope.startsWith("authentication:")),
    false,
  );
});

test("privacy API keys require an active same-tenant owner", () => {
  assert.equal(
    isEligiblePrivacyApiKeyOwner("tenant-a", {
      organizationId: "tenant-a",
      role: "owner",
      status: "active",
    }),
    true,
  );
  for (const owner of [
    { organizationId: "tenant-b", role: "owner", status: "active" },
    { organizationId: "tenant-a", role: "admin", status: "active" },
    { organizationId: "tenant-a", role: "owner", status: "disabled" },
    { organizationId: null, role: null, status: null },
  ]) {
    assert.equal(isEligiblePrivacyApiKeyOwner("tenant-a", owner), false);
  }
});
