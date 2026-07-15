import assert from "node:assert/strict";
import test from "node:test";

import {
  createEncryptionKeyring,
} from "../src/lib/encryption-keyring";
import {
  createTenantErasureArchiveLine,
  decryptTenantErasureArchiveLine,
  parseTenantErasurePolicyManifest,
  signTenantErasureArchiveManifest,
  TENANT_ERASURE_ARCHIVE_FORMAT,
  TENANT_ERASURE_POLICY_FORMAT,
  verifyTenantErasureArchiveManifest,
  type TenantErasureArchiveLine,
} from "../src/lib/tenant-erasure";

const now = new Date("2026-07-13T12:00:00.000Z");
const policy = {
  format: TENANT_ERASURE_POLICY_FORMAT,
  organizationSlug: "acme-academy",
  requestReference: "ERASURE-2026-0042",
  approvedBy: "privacy-owner@example.test",
  legalBasis: "Customer termination and approved deletion instruction.",
  requestedAt: "2026-06-01T00:00:00.000Z",
  customerExportDeliveredAt: "2026-06-05T00:00:00.000Z",
  executeAfter: "2026-07-01T00:00:00.000Z",
  backupExpiresAt: "2026-08-01T00:00:00.000Z",
  customerExportSha256: "a".repeat(64),
  retentionDecisions: {
    auditEvidence: "Encrypted evidence archive retained for six years.",
    backups: "All backup generations expire on the documented date.",
    billing: "Billing evidence remains in the external accounting system.",
    certificates: "Certificate evidence was included in the customer export.",
    learningRecords: "Learning records were included in the customer export.",
  },
};

test("tenant erasure policy requires exact decisions, exports and waiting periods", () => {
  const parsed = parseTenantErasurePolicyManifest(policy, {
    now,
    minimumWaitMs: 30 * 24 * 60 * 60_000,
  });
  assert.equal(parsed.executable, true);
  assert.equal(parsed.manifest.organizationSlug, "acme-academy");
  assert.throws(
    () =>
      parseTenantErasurePolicyManifest(
        { ...policy, executeAfter: "2026-06-10T00:00:00.000Z" },
        { now, minimumWaitMs: 30 * 24 * 60 * 60_000 },
      ),
    /Wartefrist/,
  );
  assert.throws(
    () =>
      parseTenantErasurePolicyManifest(
        { ...policy, hiddenApproval: true },
        { now, minimumWaitMs: 0 },
      ),
    /unbekannte Felder/,
  );
});

test("tenant erasure archive encrypts each row with bound associated data", () => {
  const keyring = createEncryptionKeyring({
    activeKeyId: "tenant-archive-2026",
    activeSecret: "x".repeat(48),
  });
  const serialized = createTenantErasureArchiveLine({
    organizationId: "11111111-1111-4111-8111-111111111111",
    sequence: 1,
    table: "privacy_request_events",
    row: { id: "event-1", note: "retained evidence" },
    keyring,
  });
  assert.doesNotMatch(serialized, /retained evidence/);
  const line = JSON.parse(serialized) as TenantErasureArchiveLine;
  assert.deepEqual(decryptTenantErasureArchiveLine(line, keyring), {
    id: "event-1",
    note: "retained evidence",
  });
  assert.throws(() =>
    decryptTenantErasureArchiveLine({ ...line, sequence: 2 }, keyring),
  );
});

test("tenant erasure archive manifest is authenticated", () => {
  const key = Buffer.alloc(32, 7);
  const signed = signTenantErasureArchiveManifest(
    {
      format: TENANT_ERASURE_ARCHIVE_FORMAT,
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationSlug: "acme-academy",
      requestReference: "ERASURE-2026-0042",
      generatedAt: now.toISOString(),
      fileName: "archive.jsonl",
      fileSha256: "b".repeat(64),
      finalChainHmac: "chain",
      eventCount: 2,
      rowCounts: { privacy_request_events: 2 },
      keyId: "tenant-archive-2026",
      hmacKeyId: "audit-2026",
    },
    key,
  );
  assert.equal(verifyTenantErasureArchiveManifest(signed, key), true);
  assert.equal(
    verifyTenantErasureArchiveManifest({ ...signed, eventCount: 3 }, key),
    false,
  );
});
