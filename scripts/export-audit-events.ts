import { createHash } from "node:crypto";
import { access, constants, link, open, rm } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

import {
  AUDIT_EXPORT_FORMAT,
  auditExportEventLine,
  canonicalJson,
  decodeAuditExportKey,
  nextAuditChainHmac,
  signAuditExportManifest,
} from "../src/lib/audit-export-model";

const HELP = `Q-Academy Audit-Export

Erforderlich:
  --slug <slug>          Exakter Organisations-Slug
  --confirm <slug>       Muss exakt dem Slug entsprechen
  --from <ISO-Zeit>      Inklusiver UTC-Beginn
  --until <ISO-Zeit>     Exklusives UTC-Ende, maximal 366 Tage spaeter
  --output <datei>       Neue .jsonl-Datei; darf noch nicht existieren

Umgebung:
  DATABASE_URL
  AUDIT_EXPORT_HMAC_KEY      Base64url, mindestens 32 Zufallsbytes
  AUDIT_EXPORT_HMAC_KEY_ID   Nicht-geheimer Rotationsbezeichner`;

class AuditExportCliError extends Error {}

function parseArguments(argv: string[]) {
  const parsed: Record<string, string | boolean> = {};
  const valued = new Set(["slug", "confirm", "from", "until", "output"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (!argument?.startsWith("--") || !valued.has(argument.slice(2))) {
      throw new AuditExportCliError("Unbekanntes Audit-Export-Argument.");
    }
    const key = argument.slice(2);
    if (Object.hasOwn(parsed, key)) {
      throw new AuditExportCliError(`--${key} darf nur einmal vorkommen.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new AuditExportCliError(`Wert fuer --${key} fehlt.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function required(parsed: Record<string, string | boolean>, key: string) {
  const value = parsed[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AuditExportCliError(`--${key} ist erforderlich.`);
  }
  return value.trim();
}

function instant(value: string, label: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new AuditExportCliError(`${label} ist kein gueltiger ISO-Zeitpunkt.`);
  }
  return date;
}

function inputFrom(parsed: Record<string, string | boolean>) {
  const slug = required(parsed, "slug");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(slug)) {
    throw new AuditExportCliError("Der Organisations-Slug ist ungueltig.");
  }
  if (required(parsed, "confirm") !== slug) {
    throw new AuditExportCliError("--confirm muss exakt dem Slug entsprechen.");
  }
  const from = instant(required(parsed, "from"), "--from");
  const until = instant(required(parsed, "until"), "--until");
  const range = until.getTime() - from.getTime();
  if (range <= 0 || range > 366 * 24 * 60 * 60 * 1000) {
    throw new AuditExportCliError(
      "Der Exportzeitraum muss positiv und hoechstens 366 Tage lang sein.",
    );
  }
  const outputPath = path.resolve(required(parsed, "output"));
  if (!outputPath.endsWith(".jsonl")) {
    throw new AuditExportCliError("--output muss auf .jsonl enden.");
  }
  return { slug, from, until, outputPath };
}

function environment() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new AuditExportCliError("DATABASE_URL fehlt.");
  try {
    const url = new URL(databaseUrl);
    if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
  } catch {
    throw new AuditExportCliError("DATABASE_URL ist ungueltig.");
  }
  const keyId = process.env.AUDIT_EXPORT_HMAC_KEY_ID?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(keyId)) {
    throw new AuditExportCliError("AUDIT_EXPORT_HMAC_KEY_ID ist ungueltig.");
  }
  try {
    return {
      databaseUrl,
      keyId,
      key: decodeAuditExportKey(process.env.AUDIT_EXPORT_HMAC_KEY?.trim() ?? ""),
    };
  } catch {
    throw new AuditExportCliError("AUDIT_EXPORT_HMAC_KEY ist ungueltig.");
  }
}

async function publishExclusive(temporaryPath: string, outputPath: string) {
  try {
    await link(temporaryPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new AuditExportCliError(`Zieldatei existiert bereits: ${outputPath}`);
    }
    throw error;
  }
  await rm(temporaryPath, { force: true });
}

type AuditRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  type: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: Date;
};

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const input = inputFrom(parsed);
  const env = environment();
  const manifestPath = `${input.outputPath}.manifest.json`;
  await access(path.dirname(input.outputPath), constants.R_OK | constants.W_OK);

  const suffix = `.partial-${process.pid}-${Date.now()}`;
  const temporaryData = `${input.outputPath}${suffix}`;
  const temporaryManifest = `${manifestPath}${suffix}`;
  const output = await open(temporaryData, "wx", 0o600);
  const client = postgres(env.databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  let publishedData = false;
  try {
    const fileHash = createHash("sha256");
    let chain: string | null = null;
    let count = 0;
    const organization = await client.begin(
      "isolation level repeatable read read only",
      async (tx) => {
        const [tenant] = await tx<Array<{ id: string; slug: string }>>`
          select id, slug from organizations where slug = ${input.slug}
        `;
        if (!tenant) {
          throw new AuditExportCliError("Organisation wurde nicht gefunden.");
        }
        let cursorCreatedAt: Date | null = null;
        let cursorId: string | null = null;
        while (true) {
          const rows: AuditRow[] = cursorCreatedAt
            ? await tx<AuditRow[]>`
                select id, organization_id as "organizationId", user_id as "userId",
                       type, entity_type as "entityType", entity_id as "entityId",
                       metadata, created_at as "createdAt"
                from activity_events
                where organization_id = ${tenant.id}
                  and created_at >= ${input.from}
                  and created_at < ${input.until}
                  and (created_at, id) > (${cursorCreatedAt}, ${cursorId!}::uuid)
                order by created_at, id
                limit 1000
              `
            : await tx<AuditRow[]>`
                select id, organization_id as "organizationId", user_id as "userId",
                       type, entity_type as "entityType", entity_id as "entityId",
                       metadata, created_at as "createdAt"
                from activity_events
                where organization_id = ${tenant.id}
                  and created_at >= ${input.from}
                  and created_at < ${input.until}
                order by created_at, id
                limit 1000
              `;
          for (const row of rows) {
            const eventLine = auditExportEventLine({
              ...row,
              createdAt: row.createdAt.toISOString(),
            });
            const serialized = `${eventLine}\n`;
            await output.write(serialized, null, "utf8");
            fileHash.update(serialized);
            chain = nextAuditChainHmac(env.key, chain, eventLine);
            count += 1;
          }
          if (rows.length < 1000) break;
          cursorCreatedAt = rows.at(-1)!.createdAt;
          cursorId = rows.at(-1)!.id;
        }
        return tenant;
      },
    );
    await output.sync();
    await output.close();

    const manifest = signAuditExportManifest(
      {
        format: AUDIT_EXPORT_FORMAT,
        organizationId: organization.id,
        organizationSlug: organization.slug,
        fromInclusive: input.from.toISOString(),
        untilExclusive: input.until.toISOString(),
        generatedAt: new Date().toISOString(),
        eventCount: count,
        fileName: path.basename(input.outputPath),
        fileSha256: fileHash.digest("hex"),
        finalChainHmac: chain ?? nextAuditChainHmac(env.key, null, ""),
        keyId: env.keyId,
      },
      env.key,
    );
    const manifestFile = await open(temporaryManifest, "wx", 0o600);
    await manifestFile.writeFile(`${canonicalJson(manifest)}\n`, "utf8");
    await manifestFile.sync();
    await manifestFile.close();

    await publishExclusive(temporaryData, input.outputPath);
    publishedData = true;
    await publishExclusive(temporaryManifest, manifestPath);
    await client`
      insert into activity_events (
        organization_id, user_id, type, entity_type, entity_id, metadata
      ) values (
        ${organization.id}, null, 'audit.exported', 'organization',
        ${organization.id},
        ${client.json({
          fromInclusive: input.from.toISOString(),
          untilExclusive: input.until.toISOString(),
          eventCount: count,
          fileSha256: manifest.fileSha256,
          keyId: env.keyId,
        })}
      )
    `;
    process.stdout.write(
      `${JSON.stringify({ ok: true, eventCount: count, output: input.outputPath, manifest: manifestPath })}\n`,
    );
  } finally {
    await output.close().catch(() => undefined);
    await client.end({ timeout: 5 }).catch(() => undefined);
    await rm(temporaryData, { force: true }).catch(() => undefined);
    await rm(temporaryManifest, { force: true }).catch(() => undefined);
    if (publishedData) {
      const manifestExists = await access(manifestPath).then(() => true).catch(() => false);
      if (!manifestExists) await rm(input.outputPath, { force: true }).catch(() => undefined);
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof AuditExportCliError ? error.message : "Audit-Export fehlgeschlagen."}\n`,
  );
  process.exitCode = 1;
});
