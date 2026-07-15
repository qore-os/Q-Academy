import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, constants, link, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";

import {
  canonicalJson,
  decodeAuditExportKey,
  nextAuditChainHmac,
} from "../src/lib/audit-export-model";
import {
  createEncryptionKeyring,
  parsePreviousEncryptionKeys,
} from "../src/lib/encryption-keyring";
import { deleteFilesystemMediaObject } from "../src/lib/media/filesystem-storage";
import { deleteS3Object } from "../src/lib/media/s3-storage";
import {
  resolveMediaStorageConfiguration,
  type MediaStorageConfiguration,
} from "../src/lib/media/storage-configuration";
import type { MediaObjectIdentity } from "../src/lib/media/storage-key";
import {
  createTenantErasureArchiveLine,
  parseTenantErasurePolicyManifest,
  signTenantErasureArchiveManifest,
  TENANT_ERASURE_ARCHIVE_FORMAT,
  TENANT_ERASURE_EVIDENCE_TABLES,
  type TenantErasureEvidenceTable,
  type TenantErasurePolicyManifest,
} from "../src/lib/tenant-erasure";

const HELP = `Q-Academy Tenant-Loeschung

Vorschau:
  npm run tenant:erase -- --slug <slug> --manifest <policy.json> [--json]

Ausfuehrung (irreversibel):
  npm run tenant:erase -- --slug <slug> --manifest <policy.json> \\
    --customer-export <export.zip> --archive <evidence.jsonl.enc> \\
    --confirm <slug> --execute [--json]

Backup-Abschluss nach nachgewiesenem Backup-Auslauf:
  npm run tenant:erase -- --finalize-receipt <uuid> --confirm <uuid> \\
    --backup-evidence-sha256 <sha256> [--json]

Erforderliche Umgebung:
  DATABASE_URL (getrennter Owner-/Operator-User; der App-User ist gesperrt)
  DATA_ENCRYPTION_KEY_ID / DATA_ENCRYPTION_KEY
  AUDIT_EXPORT_HMAC_KEY_ID / AUDIT_EXPORT_HMAC_KEY

TENANT_ERASURE_MIN_WAIT_DAYS setzt die technische Mindestwartefrist (Standard 30).`;

class TenantErasureCliError extends Error {}

type CliArguments = Record<string, string | boolean>;

type TenantRow = {
  id: string;
  slug: string;
  status: "active" | "suspended" | "offboarding";
  updatedAt: Date;
};

type MediaRow = {
  id: string;
  organizationId: string;
  storageDriver: string;
  storageKey: string;
  stagingStorageKey: string;
  derivativeStorageKeys: string[];
};

type ErasurePlan = {
  organization: TenantRow;
  activeLegalHolds: number;
  userCount: number;
  media: MediaRow[];
  storageObjectCount: number;
  rowCounts: Record<TenantErasureEvidenceTable, number>;
};

type RuntimeEnvironment = {
  databaseUrl: string;
  minimumWaitMs: number;
  dataKeyring: ReturnType<typeof createEncryptionKeyring>;
  hmacKey: Buffer;
  hmacKeyId: string;
};

type QuerySql = Sql | TransactionSql;

const VALUE_FLAGS = new Set([
  "slug",
  "manifest",
  "archive",
  "customer-export",
  "confirm",
  "finalize-receipt",
  "backup-evidence-sha256",
]);

function parseArguments(argv: string[]) {
  const parsed: CliArguments = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--help", "--json", "--execute"].includes(argument)) {
      const key = argument.slice(2);
      if (Object.hasOwn(parsed, key)) {
        throw new TenantErasureCliError(`${argument} darf nur einmal vorkommen.`);
      }
      parsed[key] = true;
      continue;
    }
    if (!argument.startsWith("--") || !VALUE_FLAGS.has(argument.slice(2))) {
      throw new TenantErasureCliError(`Unbekannte Option: ${argument}`);
    }
    const key = argument.slice(2);
    if (Object.hasOwn(parsed, key)) {
      throw new TenantErasureCliError(`${argument} darf nur einmal vorkommen.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new TenantErasureCliError(`Wert fuer ${argument} fehlt.`);
    }
    parsed[key] = value.trim();
    index += 1;
  }
  return parsed;
}

function required(parsed: CliArguments, key: string) {
  const value = parsed[key];
  if (typeof value !== "string" || !value) {
    throw new TenantErasureCliError(`--${key} ist erforderlich.`);
  }
  return value;
}

function sha256(value: string, label: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new TenantErasureCliError(`${label} muss ein kleingeschriebener SHA-256 sein.`);
  }
  return value;
}

function uuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TenantErasureCliError(`${label} ist keine gueltige UUID.`);
  }
  return value.toLowerCase();
}

function environment(): RuntimeEnvironment {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new TenantErasureCliError("DATABASE_URL fehlt.");
  try {
    const value = new URL(databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(value.protocol) || !value.pathname.slice(1)) {
      throw new Error();
    }
  } catch {
    throw new TenantErasureCliError("DATABASE_URL ist ungueltig.");
  }
  const dataKeyId = process.env.DATA_ENCRYPTION_KEY_ID?.trim() ?? "";
  const dataKey = process.env.DATA_ENCRYPTION_KEY?.trim() ?? "";
  if (dataKey.length < 32) {
    throw new TenantErasureCliError("DATA_ENCRYPTION_KEY muss mindestens 32 Zeichen enthalten.");
  }
  const hmacKeyId = process.env.AUDIT_EXPORT_HMAC_KEY_ID?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(hmacKeyId)) {
    throw new TenantErasureCliError("AUDIT_EXPORT_HMAC_KEY_ID ist ungueltig.");
  }
  const minimumWaitDays = Number(process.env.TENANT_ERASURE_MIN_WAIT_DAYS ?? "30");
  if (!Number.isInteger(minimumWaitDays) || minimumWaitDays < 1 || minimumWaitDays > 3650) {
    throw new TenantErasureCliError("TENANT_ERASURE_MIN_WAIT_DAYS muss zwischen 1 und 3650 liegen.");
  }
  try {
    return {
      databaseUrl,
      minimumWaitMs: minimumWaitDays * 24 * 60 * 60_000,
      dataKeyring: createEncryptionKeyring({
        activeKeyId: dataKeyId,
        activeSecret: dataKey,
        previousKeys: parsePreviousEncryptionKeys(
          process.env.DATA_ENCRYPTION_PREVIOUS_KEYS,
          "DATA_ENCRYPTION_PREVIOUS_KEYS",
        ),
      }),
      hmacKey: decodeAuditExportKey(process.env.AUDIT_EXPORT_HMAC_KEY?.trim() ?? ""),
      hmacKeyId,
    };
  } catch (error) {
    throw new TenantErasureCliError(
      error instanceof Error ? error.message : "Encryption-/HMAC-Konfiguration ist ungueltig.",
    );
  }
}

async function loadPolicy(filePath: string, env: RuntimeEnvironment) {
  const absolutePath = path.resolve(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  } catch (error) {
    throw new TenantErasureCliError(
      `Policy-Manifest konnte nicht gelesen werden: ${error instanceof Error ? error.message : "ungueltig"}`,
    );
  }
  return parseTenantErasurePolicyManifest(parsed, {
    now: new Date(),
    minimumWaitMs: env.minimumWaitMs,
  });
}

async function evidenceCounts(sql: QuerySql, organizationId: string) {
  const counts = {} as Record<TenantErasureEvidenceTable, number>;
  for (const table of TENANT_ERASURE_EVIDENCE_TABLES) {
    const [result] = await sql.unsafe<Array<{ count: number }>>(
      `select count(*)::integer as count from "${table}" where organization_id = $1`,
      [organizationId],
    );
    counts[table] = Number(result?.count ?? 0);
  }
  return counts;
}

async function buildPlan(sql: QuerySql, slug: string): Promise<ErasurePlan> {
  const [organization] = await sql<TenantRow[]>`
    select id, slug, status, updated_at as "updatedAt"
    from organizations
    where slug = ${slug}
  `;
  if (!organization) {
    throw new TenantErasureCliError(`Organisation '${slug}' wurde nicht gefunden.`);
  }
  const [[hold], [users], media, rowCounts] = await Promise.all([
    sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from privacy_legal_holds
      where organization_id = ${organization.id}
        and released_at is null
        and (expires_at is null or expires_at > now())
    `,
    sql<Array<{ count: number }>>`
      select count(*)::integer as count
      from users where organization_id = ${organization.id}
    `,
    sql<MediaRow[]>`
      select m.id, m.organization_id as "organizationId",
             m.storage_driver as "storageDriver", m.storage_key as "storageKey",
             m.staging_storage_key as "stagingStorageKey",
             coalesce(array(
               select derivative.storage_key
               from media_asset_derivatives derivative
               where derivative.organization_id = m.organization_id
                 and derivative.source_asset_id = m.id
               order by derivative.id
             ), array[]::text[]) as "derivativeStorageKeys"
      from media_assets m
      where m.organization_id = ${organization.id}
      order by m.id
    `,
    evidenceCounts(sql, organization.id),
  ]);
  const storageObjectCount = media.reduce(
    (count, asset) => count + 2 + asset.derivativeStorageKeys.length,
    0,
  );
  return {
    organization,
    activeLegalHolds: Number(hold?.count ?? 0),
    userCount: Number(users?.count ?? 0),
    media,
    storageObjectCount,
    rowCounts,
  };
}

function publicPlan(
  plan: ErasurePlan,
  policy: ReturnType<typeof parseTenantErasurePolicyManifest>,
) {
  return {
    organizationId: plan.organization.id,
    organizationSlug: plan.organization.slug,
    status: plan.organization.status,
    statusUpdatedAt: plan.organization.updatedAt.toISOString(),
    requestReference: policy.manifest.requestReference,
    executable: policy.executable,
    executeAfter: policy.executeAfter.toISOString(),
    backupExpiresAt: policy.backupExpiresAt.toISOString(),
    activeLegalHolds: plan.activeLegalHolds,
    users: plan.userCount,
    mediaAssets: plan.media.length,
    storageObjects: plan.storageObjectCount,
    evidenceRows: Object.values(plan.rowCounts).reduce((sum, count) => sum + count, 0),
    evidenceRowCounts: plan.rowCounts,
  };
}

async function publishExclusive(temporaryPath: string, outputPath: string) {
  try {
    await link(temporaryPath, outputPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new TenantErasureCliError(`Zieldatei existiert bereits: ${outputPath}`);
    }
    throw error;
  }
  await rm(temporaryPath, { force: true });
}

async function sha256File(filePath: string) {
  const absolutePath = path.resolve(filePath);
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(absolutePath)) {
      hash.update(chunk as Buffer);
    }
  } catch (error) {
    throw new TenantErasureCliError(
      `Kundendatenexport konnte nicht gelesen werden: ${error instanceof Error ? error.message : "ungueltig"}`,
    );
  }
  return { absolutePath, sha256: hash.digest("hex") };
}

async function writeEvidenceArchive(input: {
  sql: QuerySql;
  plan: ErasurePlan;
  policy: TenantErasurePolicyManifest;
  outputPath: string;
  env: RuntimeEnvironment;
}) {
  const outputPath = path.resolve(input.outputPath);
  if (!outputPath.endsWith(".jsonl.enc")) {
    throw new TenantErasureCliError("--archive muss auf .jsonl.enc enden.");
  }
  await access(path.dirname(outputPath), constants.R_OK | constants.W_OK);
  const manifestPath = `${outputPath}.manifest.json`;
  const suffix = `.partial-${process.pid}-${Date.now()}`;
  const temporaryData = `${outputPath}${suffix}`;
  const temporaryManifest = `${manifestPath}${suffix}`;
  const output = await open(temporaryData, "wx", 0o600);
  const fileHash = createHash("sha256");
  const rowCounts = {} as Record<TenantErasureEvidenceTable, number>;
  let chain: string | null = null;
  let sequence = 0;
  let outputClosed = false;
  try {
    for (const table of TENANT_ERASURE_EVIDENCE_TABLES) {
      let cursor: string | null = null;
      let count = 0;
      while (true) {
        const rows: Array<{ id: string; row: unknown }> = await input.sql.unsafe(
          cursor
            ? `select id::text as id, to_jsonb(source) as row from "${table}" source where organization_id = $1 and id > $2::uuid order by id limit 500`
            : `select id::text as id, to_jsonb(source) as row from "${table}" source where organization_id = $1 order by id limit 500`,
          cursor ? [input.plan.organization.id, cursor] : [input.plan.organization.id],
        );
        for (const row of rows) {
          sequence += 1;
          count += 1;
          const serialized = `${createTenantErasureArchiveLine({
            organizationId: input.plan.organization.id,
            sequence,
            table,
            row: row.row,
            keyring: input.env.dataKeyring,
          })}\n`;
          await output.write(serialized, null, "utf8");
          fileHash.update(serialized);
          chain = nextAuditChainHmac(input.env.hmacKey, chain, serialized.trimEnd());
        }
        if (rows.length < 500) break;
        cursor = rows.at(-1)!.id;
      }
      rowCounts[table] = count;
    }
    if (canonicalJson(rowCounts) !== canonicalJson(input.plan.rowCounts)) {
      throw new TenantErasureCliError("Die Evidenzdaten haben sich waehrend der Archivierung veraendert.");
    }
    await output.sync();
    await output.close();
    outputClosed = true;
    const unsigned = {
      format: TENANT_ERASURE_ARCHIVE_FORMAT,
      organizationId: input.plan.organization.id,
      organizationSlug: input.plan.organization.slug,
      requestReference: input.policy.requestReference,
      generatedAt: new Date().toISOString(),
      fileName: path.basename(outputPath),
      fileSha256: fileHash.digest("hex"),
      finalChainHmac: chain ?? nextAuditChainHmac(input.env.hmacKey, null, ""),
      eventCount: sequence,
      rowCounts,
      keyId: input.env.dataKeyring.activeKeyId,
      hmacKeyId: input.env.hmacKeyId,
    } as const;
    const manifest = signTenantErasureArchiveManifest(unsigned, input.env.hmacKey);
    const manifestBytes = `${canonicalJson(manifest)}\n`;
    const manifestFile = await open(temporaryManifest, "wx", 0o600);
    await manifestFile.writeFile(manifestBytes, "utf8");
    await manifestFile.sync();
    await manifestFile.close();
    await publishExclusive(temporaryData, outputPath);
    await publishExclusive(temporaryManifest, manifestPath);
    return {
      manifest,
      archiveSha256: unsigned.fileSha256,
      manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
      outputPath,
      manifestPath,
    };
  } finally {
    if (!outputClosed) await output.close().catch(() => undefined);
    await Promise.all([
      rm(temporaryData, { force: true }),
      rm(temporaryManifest, { force: true }),
    ]);
  }
}

async function deleteTenantMediaObject(
  configuration: MediaStorageConfiguration,
  identity: MediaObjectIdentity,
) {
  return configuration.driver === "s3"
    ? deleteS3Object(configuration, identity)
    : deleteFilesystemMediaObject(configuration, identity);
}

async function purgeTenantMedia(plan: ErasurePlan) {
  // The operator runtime deliberately validates only storage-specific settings;
  // it must not inherit unrelated public-app secrets just to hard-delete media.
  const storageConfiguration = resolveMediaStorageConfiguration(process.env);
  const configuredDriver = storageConfiguration.driver;
  const unavailable = plan.media.find(
    (asset) => asset.storageDriver !== configuredDriver,
  );
  if (unavailable) {
    throw new TenantErasureCliError(
      `Media asset ${unavailable.id} uses the unavailable '${unavailable.storageDriver}' storage driver.`,
    );
  }
  let deleted = 0;
  for (const asset of plan.media) {
    for (const key of asset.derivativeStorageKeys) {
      await deleteTenantMediaObject(storageConfiguration, {
        organizationId: asset.organizationId,
        assetId: asset.id,
        key,
      });
      deleted += 1;
    }
    for (const key of [asset.stagingStorageKey, asset.storageKey]) {
      await deleteTenantMediaObject(storageConfiguration, {
        organizationId: asset.organizationId,
        assetId: asset.id,
        key,
      });
      deleted += 1;
    }
  }
  if (deleted !== plan.storageObjectCount) {
    throw new TenantErasureCliError("Die Anzahl verifizierter Storage-Loeschungen ist inkonsistent.");
  }
  return deleted;
}

function assertExecutable(
  plan: ErasurePlan,
  policy: ReturnType<typeof parseTenantErasurePolicyManifest>,
) {
  if (policy.manifest.organizationSlug !== plan.organization.slug) {
    throw new TenantErasureCliError("Policy-Manifest und Organisations-Slug stimmen nicht ueberein.");
  }
  if (plan.organization.status !== "offboarding") {
    throw new TenantErasureCliError("Die Organisation muss zuerst den Status offboarding erhalten.");
  }
  if (plan.activeLegalHolds > 0) {
    throw new TenantErasureCliError("Aktive Legal Holds blockieren die Tenant-Loeschung.");
  }
  if (!policy.executable) {
    throw new TenantErasureCliError("Die dokumentierte Wartefrist ist noch nicht abgelaufen.");
  }
}

async function deleteTenantRelationalData(input: {
  client: ReturnType<typeof postgres>;
  plan: ErasurePlan;
  policy: TenantErasurePolicyManifest;
  archive: Awaited<ReturnType<typeof writeEvidenceArchive>>;
}) {
  const now = new Date();
  return input.client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`tenant-erasure:${input.plan.organization.slug}`}))`;
    const current = await buildPlan(tx, input.plan.organization.slug);
    if (
      current.organization.id !== input.plan.organization.id ||
      current.organization.status !== "offboarding" ||
      current.activeLegalHolds > 0 ||
      current.media.length !== input.plan.media.length ||
      current.storageObjectCount !== input.plan.storageObjectCount ||
      canonicalJson(current.rowCounts) !== canonicalJson(input.archive.manifest.rowCounts)
    ) {
      throw new TenantErasureCliError("Tenant-Daten oder Freigaben haben sich nach der Evidenzarchivierung veraendert.");
    }
    const [receipt] = await tx<Array<{ id: string }>>`
      insert into tenant_erasure_receipts (
        organization_id, organization_slug, request_reference, approved_by,
        legal_basis, status, requested_at, execute_after, backup_expires_at,
        customer_export_sha256, evidence_archive_sha256,
        evidence_manifest_sha256, archive_key_id, media_asset_count,
        storage_object_count, row_counts, policy_manifest
      ) values (
        ${current.organization.id}, ${current.organization.slug},
        ${input.policy.requestReference}, ${input.policy.approvedBy},
        ${input.policy.legalBasis}, 'erasing', ${new Date(input.policy.requestedAt)},
        ${new Date(input.policy.executeAfter)}, ${new Date(input.policy.backupExpiresAt)},
        ${input.policy.customerExportSha256}, ${input.archive.archiveSha256},
        ${input.archive.manifestSha256}, ${input.archive.manifest.keyId},
        ${current.media.length}, ${current.storageObjectCount},
        ${tx.json(current.rowCounts)}, ${tx.json(input.policy)}
      )
      returning id
    `;
    if (!receipt) throw new TenantErasureCliError("Loeschbeleg konnte nicht erstellt werden.");
    await tx`select set_config('q_academy.tenant_erasure_receipt', ${receipt.id}, true)`;
    await tx`
      insert into tenant_erasure_events (receipt_id, event, metadata)
      values
        (${receipt.id}, 'evidence.archive_verified', ${tx.json({
          archiveSha256: input.archive.archiveSha256,
          manifestSha256: input.archive.manifestSha256,
          rowCounts: current.rowCounts,
        })}),
        (${receipt.id}, 'storage.purge_verified', ${tx.json({
          mediaAssets: current.media.length,
          storageObjects: current.storageObjectCount,
        })})
    `;

    await tx`
      with tenant_accounts as materialized (
        select distinct account_id
        from orbit_account_identities
        where organization_id = ${current.organization.id}
      ), identities_deleted as (
        delete from orbit_account_identities
        where organization_id = ${current.organization.id}
        returning account_id
      ), orphan_accounts as materialized (
        select tenant.account_id
        from tenant_accounts tenant
        where not exists (
          select 1 from orbit_account_identities identity
          where identity.account_id = tenant.account_id
        )
      ), claims_deleted as (
        delete from orbit_instance_claims claim
        using orphan_accounts orphan
        where claim.created_by_account_id = orphan.account_id
          and claim.consumed_at is null
        returning 1
      ), delegations_revoked as (
        update orbit_partner_delegations delegation
        set revoked_at = coalesce(delegation.revoked_at, ${now}), updated_at = ${now}
        from orphan_accounts orphan
        where delegation.partner_account_id = orphan.account_id
        returning 1
      )
      update orbit_accounts account
      set email = 'erased-tenant-' || replace(account.id::text, '-', '') || '@privacy.invalid',
          display_name = 'Deleted tenant account', status = 'suspended', updated_at = ${now}
      from orphan_accounts orphan
      where account.id = orphan.account_id
    `;

    const deleted = await tx<Array<{ id: string }>>`
      delete from organizations
      where id = ${current.organization.id} and status = 'offboarding'
      returning id
    `;
    if (deleted.length !== 1) {
      throw new TenantErasureCliError("Der Tenant-Cascade wurde nicht exakt einmal ausgefuehrt.");
    }
    const backupExpiresAt = new Date(input.policy.backupExpiresAt);
    const completed = backupExpiresAt <= now;
    const status = completed ? "completed" : "backup_retention_pending";
    await tx`
      update tenant_erasure_receipts
      set status = ${status}, primary_erased_at = ${now},
          completed_at = ${completed ? now : null}, updated_at = ${now}
      where id = ${receipt.id} and status = 'erasing'
    `;
    await tx`
      insert into tenant_erasure_events (receipt_id, event, metadata)
      values (
        ${receipt.id}, 'tenant.primary_erased',
        ${tx.json({ status, backupExpiresAt: backupExpiresAt.toISOString() })}
      )
    `;
    if (completed) {
      await tx`
        insert into tenant_erasure_events (receipt_id, event, metadata)
        values (${receipt.id}, 'tenant.erasure_completed', ${tx.json({ completedAt: now.toISOString() })})
      `;
    }
    return { receiptId: receipt.id, status, primaryErasedAt: now.toISOString() };
  });
}

async function finalizeReceipt(
  parsed: CliArguments,
  client: ReturnType<typeof postgres>,
) {
  const receiptId = uuid(required(parsed, "finalize-receipt"), "--finalize-receipt");
  if (required(parsed, "confirm").toLowerCase() !== receiptId) {
    throw new TenantErasureCliError("--confirm muss exakt der Receipt-ID entsprechen.");
  }
  const backupEvidenceSha256 = sha256(
    required(parsed, "backup-evidence-sha256"),
    "--backup-evidence-sha256",
  );
  return client.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`tenant-erasure-receipt:${receiptId}`}))`;
    const [receipt] = await tx<Array<{ status: string; backupExpiresAt: Date }>>`
      select status, backup_expires_at as "backupExpiresAt"
      from tenant_erasure_receipts where id = ${receiptId} for update
    `;
    if (!receipt) throw new TenantErasureCliError("Loeschbeleg wurde nicht gefunden.");
    if (!['primary_erased', 'backup_retention_pending'].includes(receipt.status)) {
      throw new TenantErasureCliError("Loeschbeleg kann in diesem Status nicht abgeschlossen werden.");
    }
    const now = new Date();
    if (receipt.backupExpiresAt > now) {
      throw new TenantErasureCliError("Der dokumentierte Backup-Auslauf ist noch nicht erreicht.");
    }
    await tx`
      update tenant_erasure_receipts
      set status = 'completed', completed_at = ${now}, updated_at = ${now}
      where id = ${receiptId}
    `;
    await tx`
      insert into tenant_erasure_events (receipt_id, event, metadata)
      values (
        ${receiptId}, 'tenant.erasure_completed',
        ${tx.json({ completedAt: now.toISOString(), backupEvidenceSha256 })}
      )
    `;
    return { receiptId, status: "completed", completedAt: now.toISOString() };
  });
}

function print(value: unknown, json: boolean) {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

async function main() {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const env = environment();
  const client = postgres(env.databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 10,
  });
  try {
    if (parsed["finalize-receipt"]) {
      if (parsed.execute || parsed.slug || parsed.manifest || parsed.archive) {
        throw new TenantErasureCliError("Backup-Abschluss und Tenant-Ausfuehrung duerfen nicht kombiniert werden.");
      }
      print(await finalizeReceipt(parsed, client), parsed.json === true);
      return;
    }
    const slug = required(parsed, "slug");
    const policy = await loadPolicy(required(parsed, "manifest"), env);
    if (policy.manifest.organizationSlug !== slug) {
      throw new TenantErasureCliError("--slug und Policy-Manifest stimmen nicht ueberein.");
    }
    const plan = await client.begin(
      "isolation level repeatable read read only",
      (tx) => buildPlan(tx, slug),
    );
    if (!parsed.execute) {
      if (parsed.confirm || parsed.archive || parsed["customer-export"]) {
        throw new TenantErasureCliError(
          "--confirm, --archive und --customer-export sind nur zusammen mit --execute erlaubt.",
        );
      }
      print(publicPlan(plan, policy), parsed.json === true);
      return;
    }
    if (required(parsed, "confirm") !== slug) {
      throw new TenantErasureCliError("--confirm muss exakt dem Organisations-Slug entsprechen.");
    }
    assertExecutable(plan, policy);
    const customerExport = await sha256File(required(parsed, "customer-export"));
    if (customerExport.sha256 !== policy.manifest.customerExportSha256) {
      throw new TenantErasureCliError(
        "Die Kundendatenexport-Datei stimmt nicht mit customerExportSha256 ueberein.",
      );
    }
    const archive = await client.begin(
      "isolation level repeatable read read only",
      (tx) =>
        writeEvidenceArchive({
          sql: tx,
          plan,
          policy: policy.manifest,
          outputPath: required(parsed, "archive"),
          env,
        }),
    );
    await purgeTenantMedia(plan);
    const result = await deleteTenantRelationalData({
      client,
      plan,
      policy: policy.manifest,
      archive,
    });
    print(
      {
        ...result,
        organizationId: plan.organization.id,
        organizationSlug: slug,
        customerExportSha256: customerExport.sha256,
        evidenceArchiveSha256: archive.archiveSha256,
        evidenceManifestSha256: archive.manifestSha256,
        mediaAssets: plan.media.length,
        storageObjects: plan.storageObjectCount,
      },
      parsed.json === true,
    );
  } finally {
    await client.end();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unbekannter Fehler.";
  process.stderr.write(`Tenant-Loeschung fehlgeschlagen:\n${message}\n`);
  process.exitCode = 1;
}
