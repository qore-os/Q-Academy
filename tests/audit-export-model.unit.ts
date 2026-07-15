import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIT_EXPORT_FORMAT,
  auditExportEventLine,
  canonicalJson,
  decodeAuditExportKey,
  nextAuditChainHmac,
  sha256Hex,
  signAuditExportManifest,
  verifyAuditExportManifest,
} from "../src/lib/audit-export-model";

const key = decodeAuditExportKey(Buffer.alloc(32, 7).toString("base64url"));

test("audit lines are canonical and redact credentials and URL queries", () => {
  const line = auditExportEventLine({
    id: "00000000-0000-4000-8000-000000000001",
    organizationId: "00000000-0000-4000-8000-000000000002",
    userId: null,
    type: "test.event",
    entityType: "test",
    entityId: null,
    metadata: {
      z: "https://example.test/path?token=hidden#fragment",
      apiToken: "never-export",
      nested: { authorization: "Bearer hidden", safe: true },
    },
    createdAt: "2026-07-13T10:00:00.000Z",
  });
  assert.equal(line, canonicalJson(JSON.parse(line)));
  assert.doesNotMatch(line, /hidden|never-export/);
  assert.match(line, /https:\/\/example\.test\/path/);
});

test("chain and signed manifest detect event or manifest tampering", () => {
  const first = nextAuditChainHmac(key, null, '{"id":"one"}');
  const second = nextAuditChainHmac(key, first, '{"id":"two"}');
  assert.notEqual(second, nextAuditChainHmac(key, first, '{"id":"changed"}'));

  const manifest = signAuditExportManifest(
    {
      format: AUDIT_EXPORT_FORMAT,
      organizationId: "00000000-0000-4000-8000-000000000002",
      organizationSlug: "example",
      fromInclusive: "2026-07-01T00:00:00.000Z",
      untilExclusive: "2026-08-01T00:00:00.000Z",
      generatedAt: "2026-08-01T00:01:00.000Z",
      eventCount: 2,
      fileName: "events.jsonl",
      fileSha256: sha256Hex('{"id":"one"}\n{"id":"two"}\n'),
      finalChainHmac: second,
      keyId: "audit-2026-01",
    },
    key,
  );
  assert.equal(verifyAuditExportManifest(manifest, key), true);
  assert.equal(
    verifyAuditExportManifest({ ...manifest, eventCount: 3 }, key),
    false,
  );
});

test("audit export keys fail closed on weak or non-canonical input", () => {
  assert.throws(() => decodeAuditExportKey("short"));
  assert.throws(() => decodeAuditExportKey(`${Buffer.alloc(32).toString("base64url")}=`));
});
