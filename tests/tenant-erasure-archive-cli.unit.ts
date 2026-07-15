import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  canonicalJson,
  nextAuditChainHmac,
} from "../src/lib/audit-export-model";
import { createEncryptionKeyring } from "../src/lib/encryption-keyring";
import {
  createTenantErasureArchiveLine,
  signTenantErasureArchiveManifest,
  TENANT_ERASURE_ARCHIVE_FORMAT,
  TENANT_ERASURE_EVIDENCE_TABLES,
} from "../src/lib/tenant-erasure";

test("tenant erasure archive CLI verifies and rejects tampered evidence", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "q-academy-erasure-"));
  const archivePath = path.join(directory, "evidence.jsonl.enc");
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const dataKey = "archive-secret-".repeat(4);
  const hmacKey = Buffer.alloc(32, 9);
  const keyring = createEncryptionKeyring({
    activeKeyId: "archive-test",
    activeSecret: dataKey,
  });
  try {
    const serialized = `${createTenantErasureArchiveLine({
      organizationId,
      sequence: 1,
      table: "activity_events",
      row: { id: "event-1", metadata: { private: true } },
      keyring,
    })}\n`;
    const rowCounts = Object.fromEntries(
      TENANT_ERASURE_EVIDENCE_TABLES.map((table) => [
        table,
        table === "activity_events" ? 1 : 0,
      ]),
    );
    const manifest = signTenantErasureArchiveManifest(
      {
        format: TENANT_ERASURE_ARCHIVE_FORMAT,
        organizationId,
        organizationSlug: "archive-test",
        requestReference: "ERASURE-TEST-1",
        generatedAt: "2026-07-13T12:00:00.000Z",
        fileName: path.basename(archivePath),
        fileSha256: createHash("sha256").update(serialized).digest("hex"),
        finalChainHmac: nextAuditChainHmac(
          hmacKey,
          null,
          serialized.trimEnd(),
        ),
        eventCount: 1,
        rowCounts,
        keyId: keyring.activeKeyId,
        hmacKeyId: "audit-test",
      },
      hmacKey,
    );
    await writeFile(archivePath, serialized, { mode: 0o600 });
    await writeFile(
      `${archivePath}.manifest.json`,
      `${canonicalJson(manifest)}\n`,
      { mode: 0o600 },
    );
    const environment = {
      ...process.env,
      DATA_ENCRYPTION_KEY_ID: keyring.activeKeyId,
      DATA_ENCRYPTION_KEY: dataKey,
      AUDIT_EXPORT_HMAC_KEY_ID: "audit-test",
      AUDIT_EXPORT_HMAC_KEY: hmacKey.toString("base64url"),
    };
    const verified = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/verify-tenant-erasure-archive.ts",
        "--archive",
        archivePath,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: environment },
    );
    assert.equal(verified.status, 0, verified.stderr);
    assert.deepEqual(JSON.parse(verified.stdout), {
      valid: true,
      organizationId,
      organizationSlug: "archive-test",
      requestReference: "ERASURE-TEST-1",
      eventCount: 1,
      rowCounts,
      fileSha256: manifest.fileSha256,
      keyId: "archive-test",
      hmacKeyId: "audit-test",
    });

    await writeFile(archivePath, `${serialized.slice(0, -1)}x`, {
      mode: 0o600,
    });
    const tampered = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/verify-tenant-erasure-archive.ts",
        "--archive",
        archivePath,
        "--json",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: environment },
    );
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /ungueltig|stimmen nicht ueberein/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
