import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { z } from "zod";

import {
  AUDIT_EXPORT_FORMAT,
  canonicalJson,
  decodeAuditExportKey,
  nextAuditChainHmac,
  verifyAuditExportManifest,
} from "../src/lib/audit-export-model";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    format: z.literal(AUDIT_EXPORT_FORMAT),
    organizationId: z.string().uuid(),
    organizationSlug: z.string().min(1).max(100),
    fromInclusive: z.string().datetime(),
    untilExclusive: z.string().datetime(),
    generatedAt: z.string().datetime(),
    eventCount: z.number().int().min(0),
    fileName: z.string().min(1).max(255),
    fileSha256: sha256,
    finalChainHmac: sha256,
    keyId: z.string().min(3).max(80),
    manifestHmac: sha256,
  })
  .strict();

async function main() {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : "";
  if (!inputPath.endsWith(".jsonl") || process.argv.length !== 3) {
    throw new Error("Aufruf: npm run audit:verify -- /absoluter/pfad/export.jsonl");
  }
  const key = decodeAuditExportKey(
    process.env.AUDIT_EXPORT_HMAC_KEY?.trim() ?? "",
  );
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(`${inputPath}.manifest.json`, "utf8")),
  );
  if (manifest.fileName !== path.basename(inputPath)) {
    throw new Error("Manifest-Dateiname stimmt nicht mit dem Export ueberein.");
  }
  const configuredKeyId = process.env.AUDIT_EXPORT_HMAC_KEY_ID?.trim();
  if (configuredKeyId && configuredKeyId !== manifest.keyId) {
    throw new Error("Der konfigurierte Audit-Key-Identifier stimmt nicht ueberein.");
  }
  if (!verifyAuditExportManifest(manifest, key)) {
    throw new Error("Manifest-HMAC ist ungueltig.");
  }

  const hash = createHash("sha256");
  const stream = createReadStream(inputPath);
  stream.on("data", (chunk) => hash.update(chunk));
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  let chain: string | null = null;
  for await (const line of lines) {
    if (!line) throw new Error("Audit-Export enthaelt eine leere Zeile.");
    const parsed = JSON.parse(line) as unknown;
    if (canonicalJson(parsed) !== line) {
      throw new Error(`Audit-Zeile ${count + 1} ist nicht kanonisch.`);
    }
    chain = nextAuditChainHmac(key, chain, line);
    count += 1;
  }
  const finalChain = chain ?? nextAuditChainHmac(key, null, "");
  if (
    count !== manifest.eventCount ||
    hash.digest("hex") !== manifest.fileSha256 ||
    finalChain !== manifest.finalChainHmac
  ) {
    throw new Error("Audit-Export-Inhalt stimmt nicht mit dem Manifest ueberein.");
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, eventCount: count, keyId: manifest.keyId })}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Audit-Verifikation fehlgeschlagen."}\n`,
  );
  process.exitCode = 1;
});
