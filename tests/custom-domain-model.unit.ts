import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";
import {
  checkCustomDomainDns,
  customDomainClaimCreateSchema,
  customDomainMutationGuard,
  hashCustomDomainChallenge,
  issueCustomDomainChallenge,
  normalizeCustomDomainHostname,
} from "../src/lib/custom-domain-model";

test("custom-domain hostnames canonicalize IDN and reject local or ambiguous input", () => {
  assert.equal(
    normalizeCustomDomainHostname("  ACADEMY.BUECHER.DE. "),
    "academy.buecher.de",
  );
  assert.equal(
    normalizeCustomDomainHostname("buecher.de"),
    "buecher.de",
  );
  assert.equal(
    normalizeCustomDomainHostname("bücher.de"),
    "xn--bcher-kva.de",
  );
  for (const value of [
    "localhost",
    "academy.localhost",
    "academy.example",
    "academy.test",
    "https://academy.example.com",
    "academy.example.com:443",
    "*.example.com",
    "-academy.example.com",
    "academy..example.com",
  ]) {
    assert.equal(normalizeCustomDomainHostname(value), null, value);
    assert.equal(customDomainClaimCreateSchema.safeParse({ hostname: value }).success, false);
  }
});

test("issued DNS challenges are random-looking, bounded and represented by hash", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const issued = issueCustomDomainChallenge(now, () => Buffer.alloc(32, 7));
  assert.equal(
    issued.recordValue,
    "qacademy-domain-v1.BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc",
  );
  assert.equal(
    issued.challengeHash,
    hashCustomDomainChallenge(issued.recordValue),
  );
  assert.match(issued.challengeHash, /^[0-9a-f]{64}$/);
  assert.equal(issued.expiresAt.toISOString(), "2026-07-14T12:00:00.000Z");
  assert.notEqual(issued.challengeHash, issued.recordValue);
});

test("DNS verification joins TXT fragments and requires one exact value", async () => {
  const value = "qacademy-domain-v1.exact-value";
  const expectedChallengeHash = hashCustomDomainChallenge(value);
  const match = await checkCustomDomainDns({
    hostname: "academy.customer.com",
    expectedChallengeHash,
    resolveTxt: async (hostname) => {
      assert.equal(hostname, "_q-academy-verification.academy.customer.com");
      return [["unrelated"], ["qacademy-domain-v1.", "exact-value"]];
    },
  });
  assert.deepEqual(match, { code: "verified", recordCount: 2 });

  const noMatch = await checkCustomDomainDns({
    hostname: "academy.customer.com",
    expectedChallengeHash,
    resolveTxt: async () => [[`${value} `]],
  });
  assert.deepEqual(noMatch, { code: "no_match", recordCount: 1 });
});

test("DNS verification has a hard timeout and maps resolver failures", async () => {
  const timeout = await checkCustomDomainDns({
    hostname: "academy.customer.com",
    expectedChallengeHash: "a".repeat(64),
    resolveTxt: () => new Promise(() => undefined),
    timeoutMs: 5,
  });
  assert.deepEqual(timeout, { code: "timeout", recordCount: 0 });
  const failed = await checkCustomDomainDns({
    hostname: "academy.customer.com",
    expectedChallengeHash: "a".repeat(64),
    resolveTxt: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assert.deepEqual(failed, { code: "dns_error", recordCount: 0 });
});

test("tenant, revision, status, expiry and replay guards fail closed", () => {
  const claim = {
    organizationId: "tenant-a",
    status: "pending",
    revision: 4,
    challengeExpiresAt: new Date("2026-07-14T00:00:00.000Z"),
  };
  const base = {
    organizationId: "tenant-a",
    expectedRevision: 4,
    operation: "verify" as const,
    now: new Date("2026-07-13T00:00:00.000Z"),
  };
  assert.equal(customDomainMutationGuard(claim, base), "ok");
  assert.equal(
    customDomainMutationGuard(claim, { ...base, organizationId: "tenant-b" }),
    "tenant_mismatch",
  );
  assert.equal(
    customDomainMutationGuard(claim, { ...base, expectedRevision: 3 }),
    "revision_mismatch",
  );
  assert.equal(
    customDomainMutationGuard(
      { ...claim, status: "verified", revision: 5 },
      { ...base, expectedRevision: 4 },
    ),
    "revision_mismatch",
  );
  assert.equal(
    customDomainMutationGuard(claim, {
      ...base,
      now: new Date("2026-07-14T00:00:00.000Z"),
    }),
    "expired",
  );
  assert.equal(
    customDomainMutationGuard(
      { ...claim, status: "revoked" },
      { ...base, operation: "revoke" },
    ),
    "invalid_status",
  );
});

test("schema and runtime wiring persist no plaintext challenge and trust verified claims only", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  assert.match(schema, /customDomainClaims = pgTable\([\s\S]*challengeHash: varchar/);
  assert.doesNotMatch(schema, /customDomainClaims = pgTable\([\s\S]*challengeValue:/);
  assert.match(schema, /custom_domain_claims_active_hostname_idx[\s\S]*status.*revoked/);
  assert.match(schema, /custom_domain_claims_active_org_idx[\s\S]*status.*revoked/);

  const branding = readFileSync("src/lib/branding.ts", "utf8");
  assert.match(branding, /loginHostname: row\.verifiedLoginHostname \?\? null/);
  assert.match(branding, /eq\(customDomainClaims\.status, "verified"\)/);
  assert.match(branding, /isNull\(customDomainClaims\.revokedAt\)/);

  const actions = readFileSync("src/lib/actions.ts", "utf8");
  assert.match(actions, /loginHostname: null/);
  assert.doesNotMatch(actions, /formData\.get\("loginHostname"\)/);
  const service = readFileSync("src/lib/custom-domains.ts", "utf8");
  assert.match(service, /custom_domain\.expired/);
  assert.match(service, /lte\(customDomainClaims\.challengeExpiresAt, issuedAt\)/);
  const provisioning = readFileSync("scripts/provision-tenant.ts", "utf8");
  assert.match(provisioning, /--login-hostname darf keinen ungeprueften Host aktivieren/);
  assert.match(provisioning, /loginHostname: null/);
});

test("REST contract is owner-bound, revisioned and excludes hashes", () => {
  const list = openApiDocument.paths["/organization/domains"]?.get;
  const create = openApiDocument.paths["/organization/domains"]?.post;
  const rotate = openApiDocument.paths["/organization/domains/{id}/rotate"]?.post;
  const verify = openApiDocument.paths["/organization/domains/{id}/verify"]?.post;
  const revoke = openApiDocument.paths["/organization/domains/{id}/revoke"]?.post;
  assert.ok(list && create && rotate && verify && revoke);
  assert.deepEqual(list["x-required-scopes"], ["authentication:read"]);
  for (const operation of [create, rotate, verify, revoke]) {
    assert.deepEqual(operation["x-required-scopes"], ["authentication:write"]);
  }
  assert.doesNotMatch(JSON.stringify(create.parameters), /IdempotencyKey/);
  assert.doesNotMatch(JSON.stringify(rotate.parameters), /IdempotencyKey/);
  assert.match(JSON.stringify(verify.parameters), /IdempotencyKey/);
  const safeClaim = openApiDocument.components.schemas.CustomDomainClaim;
  assert.doesNotMatch(JSON.stringify(safeClaim), /challengeHash/i);
  assert.match(JSON.stringify(openApiDocument.components.schemas.CustomDomainClaimIssued), /CustomDomainChallenge/);

  const sessionSource = readFileSync("src/lib/auth.ts", "utf8");
  assert.doesNotMatch(sessionSource, /\bdomain\s*:/);
  const apiAuthSource = readFileSync("src/lib/api/auth.ts", "utf8");
  assert.match(apiAuthSource, /organizationId: apiKey\.organizationId/);
});

test("DSAR, erasure and retention handle claim metadata without credential material", () => {
  const exporter = readFileSync("scripts/export-user-data.ts", "utf8");
  assert.match(exporter, /from custom_domain_claims[\s\S]*created_by_id = \$\{userId\}/);
  assert.doesNotMatch(
    exporter.match(/const customDomainClaims = await tx`[\s\S]*?`;/)?.[0] ?? "",
    /challenge_hash/,
  );
  const erasure = readFileSync("src/lib/privacy/erasure-executor.ts", "utf8");
  assert.match(erasure, /update custom_domain_claims set created_by_id = null/);
  const retention = readFileSync("src/lib/custom-domain-retention.ts", "utf8");
  assert.match(retention, /CUSTOM_DOMAIN_REVOKED_RETENTION_DAYS = 90/);
  assert.match(retention, /eq\(customDomainClaims\.status, "revoked"\)/);
  assert.match(retention, /notExists\([\s\S]*privacyLegalHolds/);
});
