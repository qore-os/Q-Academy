import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  authRateLimitGuardIdentifiers,
  authRateLimitScopeForOrganization,
  claimGuardFirstBuckets,
  claimPrimaryFirstBuckets,
  UNRESOLVED_AUTH_RATE_LIMIT_SCOPE,
} from "../src/lib/auth-rate-limit-guards";

test("unknown organizations share one constant authentication scope", () => {
  assert.equal(
    authRateLimitScopeForOrganization(undefined),
    UNRESOLVED_AUTH_RATE_LIMIT_SCOPE,
  );
  assert.equal(
    authRateLimitScopeForOrganization(null),
    UNRESOLVED_AUTH_RATE_LIMIT_SCOPE,
  );
  assert.equal(
    authRateLimitScopeForOrganization("   "),
    UNRESOLVED_AUTH_RATE_LIMIT_SCOPE,
  );
  assert.equal(
    authRateLimitScopeForOrganization(" tenant-id "),
    "tenant-id",
  );
});

test("authentication IP and global guards are independent of tenant scope", () => {
  const tenantA = authRateLimitGuardIdentifiers(
    "tenant-a",
    "203.0.113.7",
  );
  const tenantB = authRateLimitGuardIdentifiers(
    "tenant-b",
    "203.0.113.7",
  );

  assert.deepEqual(tenantA, [
    { kind: "ip", identifier: "203.0.113.7" },
    { kind: "scope", identifier: "tenant-a" },
    { kind: "global", identifier: "global" },
  ]);
  assert.equal(tenantA[0]?.identifier, tenantB[0]?.identifier);
  assert.equal(tenantA[2]?.identifier, tenantB[2]?.identifier);
});

test("public auth guards stop a request before its variable primary bucket", async () => {
  const claimed: string[] = [];
  const result = await claimGuardFirstBuckets(
    ["ip", "scope", "global"],
    "variable-account",
    async (bucket) => {
      claimed.push(bucket);
      return { bucket, limited: bucket === "global" };
    },
  );

  assert.deepEqual(claimed, ["ip", "scope", "global"]);
  assert.deepEqual(result, { bucket: "global", limited: true });
});

test("public auth claims IP, scope, global, then the variable primary", async () => {
  const claimed: string[] = [];
  const result = await claimGuardFirstBuckets(
    ["ip", "scope", "global"],
    "variable-account",
    async (bucket) => {
      claimed.push(bucket);
      return { bucket, limited: false };
    },
  );

  assert.deepEqual(claimed, ["ip", "scope", "global", "variable-account"]);
  assert.deepEqual(result, { bucket: "variable-account", limited: false });
});

test("authenticated requests stop at a saturated stable primary", async () => {
  const claimed: string[] = [];
  const outcome = await claimPrimaryFirstBuckets(
    "member",
    ["tenant"],
    async (bucket) => {
      claimed.push(bucket);
      return { bucket, limited: bucket === "member" };
    },
  );

  assert.deepEqual(claimed, ["member"]);
  assert.deepEqual(outcome, {
    result: { bucket: "member", limited: true },
    rollbackRequired: false,
  });
});

test("a saturated authenticated guard requires rollback of the primary", async () => {
  const claimed: string[] = [];
  const outcome = await claimPrimaryFirstBuckets(
    "member",
    ["tenant"],
    async (bucket) => {
      claimed.push(bucket);
      return { bucket, limited: bucket === "tenant" };
    },
  );

  assert.deepEqual(claimed, ["member", "tenant"]);
  assert.deepEqual(outcome, {
    result: { bucket: "tenant", limited: true },
    rollbackRequired: true,
  });
});

test("public auth and authenticated callers bind to separate orders", () => {
  const limiter = readFileSync("src/lib/auth-rate-limit.ts", "utf8");
  const guardedStart = limiter.indexOf(
    "export async function consumeGuardedPersistentRateLimit",
  );
  const guardedEnd = limiter.indexOf(
    "export async function clearPersistentRateLimit",
    guardedStart,
  );
  const authStart = limiter.indexOf("export async function consumeAuthRateLimit");
  const authEnd = limiter.indexOf("export async function clearAuthRateLimit");

  assert.match(limiter.slice(guardedStart, guardedEnd), /"primary-first"/);
  assert.match(limiter.slice(authStart, authEnd), /"guard-first"/);
});

test("login and password recovery never derive limiter scopes from unknown slugs", () => {
  for (const file of [
    "src/app/api/v1/auth/login/route.ts",
    "src/app/api/v1/password/forgot/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(
      source,
      /authRateLimitScopeForOrganization\(organizationId\)/,
      file,
    );
    assert.doesNotMatch(source, /slug:\$\{explicitSlug\}/, file);
  }
});
