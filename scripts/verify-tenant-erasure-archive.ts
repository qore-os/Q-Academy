import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

import {
  canonicalJson,
  decodeAuditExportKey,
  nextAuditChainHmac,
} from "../src/lib/audit-export-model";
import {
  createEncryptionKeyring,
  parsePreviousEncryptionKeys,
} from "../src/lib/encryption-keyring";
import {
  decryptTenantErasureArchiveLine,
  TENANT_ERASURE_ARCHIVE_FORMAT,
  TENANT_ERASURE_EVIDENCE_TABLES,
  verifyTenantErasureArchiveManifest,
  type TenantErasureArchiveLine,
  type TenantErasureArchiveManifest,
  type TenantErasureEvidenceTable,
} from "../src/lib/tenant-erasure";

const HELP = `Q-Academy Tenant-Loescharchiv pruefen

  npm run tenant:erase:verify -- --archive <evidence.jsonl.enc> [--json]

Erforderliche Umgebung:
  DATA_ENCRYPTION_KEY_ID / DATA_ENCRYPTION_KEY
  DATA_ENCRYPTION_PREVIOUS_KEYS (bei Rotation)
  AUDIT_EXPORT_HMAC_KEY_ID / AUDIT_EXPORT_HMAC_KEY`;

class ArchiveVerificationError extends Error {}

function argumentsFrom(argv: string[]) {
  const result: { archive?: string; json: boolean; help: boolean } = {
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--help") {
      const key = argument.slice(2) as "json" | "help";
      if (result[key]) throw new ArchiveVerificationError(`${argument} darf nur einmal vorkommen.`);
      result[key] = true;
      continue;
    }
    if (argument !== "--archive" || result.archive) {
      throw new ArchiveVerificationError(`Unbekannte oder doppelte Option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new ArchiveVerificationError("Wert fuer --archive fehlt.");
    }
    result.archive = value;
    index += 1;
  }
  return result;
}

function environment() {
  const dataKeyId = process.env.DATA_ENCRYPTION_KEY_ID?.trim() ?? "";
  const dataKey = process.env.DATA_ENCRYPTION_KEY?.trim() ?? "";
  const hmacKeyId = process.env.AUDIT_EXPORT_HMAC_KEY_ID?.trim() ?? "";
  if (dataKey.length < 32) {
    throw new ArchiveVerificationError("DATA_ENCRYPTION_KEY muss mindestens 32 Zeichen enthalten.");
  }
  try {
    return {
      keyring: createEncryptionKeyring({
        activeKeyId: dataKeyId,
        activeSecret: dataKey,
        previousKeys: parsePreviousEncryptionKeys(
          process.env.DATA_ENCRYPTION_PREVIOUS_KEYS,
          "DATA_ENCRYPTION_PREVIOUS_KEYS",
        ),
      }),
      hmacKeyId,
      hmacKey: decodeAuditExportKey(process.env.AUDIT_EXPORT_HMAC_KEY?.trim() ?? ""),
    };
  } catch (error) {
    throw new ArchiveVerificationError(
      error instanceof Error ? error.message : "Schluesselkonfiguration ist ungueltig.",
    );
  }
}

function archiveManifest(value: unknown): TenantErasureArchiveManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArchiveVerificationError("Archivmanifest ist ungueltig.");
  }
  const candidate = value as Partial<TenantErasureArchiveManifest>;
  if (
    candidate.format !== TENANT_ERASURE_ARCHIVE_FORMAT ||
    typeof candidate.organizationId !== "string" ||
    typeof candidate.organizationSlug !== "string" ||
    typeof candidate.requestReference !== "string" ||
    typeof candidate.generatedAt !== "string" ||
    typeof candidate.fileName !== "string" ||
    typeof candidate.fileSha256 !== "string" ||
    typeof candidate.finalChainHmac !== "string" ||
    typeof candidate.eventCount !== "number" ||
    typeof candidate.rowCounts !== "object" ||
    candidate.rowCounts === null ||
    typeof candidate.keyId !== "string" ||
    typeof candidate.hmacKeyId !== "string" ||
    typeof candidate.signature !== "string"
  ) {
    throw new ArchiveVerificationError("Archivmanifest ist unvollstaendig.");
  }
  return candidate as TenantErasureArchiveManifest;
}

function archiveLine(value: unknown): TenantErasureArchiveLine {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArchiveVerificationError("Archivzeile ist ungueltig.");
  }
  const candidate = value as Partial<TenantErasureArchiveLine>;
  if (
    candidate.format !== TENANT_ERASURE_ARCHIVE_FORMAT ||
    typeof candidate.organizationId !== "string" ||
    typeof candidate.sequence !== "number" ||
    !TENANT_ERASURE_EVIDENCE_TABLES.some((table) => table === candidate.table) ||
    typeof candidate.encrypted !== "object" ||
    candidate.encrypted === null
  ) {
    throw new ArchiveVerificationError("Archivzeile ist unvollstaendig.");
  }
  return candidate as TenantErasureArchiveLine;
}

async function verifyArchive(archivePath: string) {
  const absolutePath = path.resolve(archivePath);
  if (!absolutePath.endsWith(".jsonl.enc")) {
    throw new ArchiveVerificationError("--archive muss auf .jsonl.enc enden.");
  }
  const env = environment();
  let manifest: TenantErasureArchiveManifest;
  try {
    manifest = archiveManifest(
      JSON.parse(await readFile(`${absolutePath}.manifest.json`, "utf8")),
    );
  } catch (error) {
    throw new ArchiveVerificationError(
      `Archivmanifest konnte nicht gelesen werden: ${error instanceof Error ? error.message : "ungueltig"}`,
    );
  }
  if (manifest.fileName !== path.basename(absolutePath)) {
    throw new ArchiveVerificationError("Archivdateiname und Manifest stimmen nicht ueberein.");
  }
  if (manifest.hmacKeyId !== env.hmacKeyId) {
    throw new ArchiveVerificationError("Das Manifest referenziert einen anderen HMAC-Key.");
  }
  if (!env.keyring.keys[manifest.keyId]) {
    throw new ArchiveVerificationError("Der Archivschluessel ist im Keyring nicht verfuegbar.");
  }
  if (!verifyTenantErasureArchiveManifest(manifest, env.hmacKey)) {
    throw new ArchiveVerificationError("Die Archivmanifest-Signatur ist ungueltig.");
  }

  const rowCounts = Object.fromEntries(
    TENANT_ERASURE_EVIDENCE_TABLES.map((table) => [table, 0]),
  ) as Record<TenantErasureEvidenceTable, number>;
  const fileHash = createHash("sha256");
  let chain: string | null = null;
  let sequence = 0;
  const lines = createInterface({
    input: createReadStream(absolutePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  try {
    for await (const serialized of lines) {
      if (!serialized) throw new ArchiveVerificationError("Das Archiv enthaelt eine leere Zeile.");
      const bytes = `${serialized}\n`;
      fileHash.update(bytes);
      const line = archiveLine(JSON.parse(serialized));
      sequence += 1;
      if (
        line.sequence !== sequence ||
        line.organizationId !== manifest.organizationId
      ) {
        throw new ArchiveVerificationError("Archivsequenz oder Tenant-Bindung ist ungueltig.");
      }
      decryptTenantErasureArchiveLine(line, env.keyring);
      rowCounts[line.table] += 1;
      chain = nextAuditChainHmac(env.hmacKey, chain, serialized);
    }
  } catch (error) {
    if (error instanceof ArchiveVerificationError) throw error;
    throw new ArchiveVerificationError(
      `Archivzeile konnte nicht verifiziert werden: ${error instanceof Error ? error.message : "ungueltig"}`,
    );
  }
  const fileSha256 = fileHash.digest("hex");
  const finalChainHmac = chain ?? nextAuditChainHmac(env.hmacKey, null, "");
  if (
    sequence !== manifest.eventCount ||
    fileSha256 !== manifest.fileSha256 ||
    finalChainHmac !== manifest.finalChainHmac ||
    canonicalJson(rowCounts) !== canonicalJson(manifest.rowCounts)
  ) {
    throw new ArchiveVerificationError("Archivinhalt und Manifest stimmen nicht ueberein.");
  }
  return {
    valid: true,
    organizationId: manifest.organizationId,
    organizationSlug: manifest.organizationSlug,
    requestReference: manifest.requestReference,
    eventCount: sequence,
    rowCounts,
    fileSha256,
    keyId: manifest.keyId,
    hmacKeyId: manifest.hmacKeyId,
  };
}

async function main() {
  const parsed = argumentsFrom(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (!parsed.archive) throw new ArchiveVerificationError("--archive ist erforderlich.");
  const result = await verifyArchive(parsed.archive);
  process.stdout.write(`${JSON.stringify(result, null, parsed.json ? 0 : 2)}\n`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler.";
  process.stderr.write(`Tenant-Loescharchiv ist ungueltig:\n${message}\n`);
  process.exitCode = 1;
}
