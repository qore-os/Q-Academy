import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/audit-export-model";
import {
  decryptPayloadWithKeyring,
  encryptPayloadWithKeyring,
  type EncryptionKeyring,
  type VersionedEncryptedPayload,
} from "@/lib/encryption-keyring";

export const TENANT_ERASURE_POLICY_FORMAT = "q-academy-tenant-erasure-policy-v1";
export const TENANT_ERASURE_ARCHIVE_FORMAT = "q-academy-tenant-erasure-archive-v1";

export const TENANT_ERASURE_EVIDENCE_TABLES = [
  "activity_events",
  "api_audit_logs",
  "privacy_request_events",
  "community_moderation_events",
  "ai_agent_action_requests",
  "ai_agent_action_events",
  "ai_agent_membership_provenance",
  "event_lifecycle_history",
  "webhook_delivery_attempts",
] as const;

export type TenantErasureEvidenceTable =
  (typeof TENANT_ERASURE_EVIDENCE_TABLES)[number];

export type TenantErasurePolicyManifest = Readonly<{
  format: typeof TENANT_ERASURE_POLICY_FORMAT;
  organizationSlug: string;
  requestReference: string;
  approvedBy: string;
  legalBasis: string;
  requestedAt: string;
  customerExportDeliveredAt: string;
  executeAfter: string;
  backupExpiresAt: string;
  customerExportSha256: string;
  retentionDecisions: Readonly<{
    auditEvidence: string;
    backups: string;
    billing: string;
    certificates: string;
    learningRecords: string;
  }>;
}>;

export type TenantErasureArchiveLine = Readonly<{
  format: typeof TENANT_ERASURE_ARCHIVE_FORMAT;
  organizationId: string;
  sequence: number;
  table: TenantErasureEvidenceTable;
  encrypted: VersionedEncryptedPayload;
}>;

export type TenantErasureArchiveManifest = Readonly<{
  format: typeof TENANT_ERASURE_ARCHIVE_FORMAT;
  organizationId: string;
  organizationSlug: string;
  requestReference: string;
  generatedAt: string;
  fileName: string;
  fileSha256: string;
  finalChainHmac: string;
  eventCount: number;
  rowCounts: Readonly<Record<string, number>>;
  keyId: string;
  hmacKeyId: string;
  signature: string;
}>;

export class TenantErasurePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantErasurePolicyError";
  }
}

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,179}$/;

function record(value: unknown, label: string) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TenantErasurePolicyError(`${label} muss ein Objekt sein.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TenantErasurePolicyError(`${label} enthaelt fehlende oder unbekannte Felder.`);
  }
}

function textValue(
  value: unknown,
  label: string,
  options: { max: number; pattern?: RegExp },
) {
  if (typeof value !== "string") {
    throw new TenantErasurePolicyError(`${label} muss Text sein.`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > options.max ||
    (options.pattern && !options.pattern.test(normalized))
  ) {
    throw new TenantErasurePolicyError(`${label} ist ungueltig.`);
  }
  return normalized;
}

function instant(value: unknown, label: string) {
  const normalized = textValue(value, label, { max: 40 });
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== normalized) {
    throw new TenantErasurePolicyError(`${label} muss ein normalisierter ISO-Zeitpunkt sein.`);
  }
  return parsed;
}

export function parseTenantErasurePolicyManifest(
  value: unknown,
  options: { now: Date; minimumWaitMs: number },
) {
  if (!Number.isSafeInteger(options.minimumWaitMs) || options.minimumWaitMs < 0) {
    throw new TenantErasurePolicyError("Die minimale Wartefrist ist ungueltig.");
  }
  const input = record(value, "Policy-Manifest");
  exactKeys(
    input,
    [
      "format",
      "organizationSlug",
      "requestReference",
      "approvedBy",
      "legalBasis",
      "requestedAt",
      "customerExportDeliveredAt",
      "executeAfter",
      "backupExpiresAt",
      "customerExportSha256",
      "retentionDecisions",
    ],
    "Policy-Manifest",
  );
  if (input.format !== TENANT_ERASURE_POLICY_FORMAT) {
    throw new TenantErasurePolicyError("Das Policy-Manifest-Format wird nicht unterstuetzt.");
  }
  const requestedAt = instant(input.requestedAt, "requestedAt");
  const customerExportDeliveredAt = instant(
    input.customerExportDeliveredAt,
    "customerExportDeliveredAt",
  );
  const executeAfter = instant(input.executeAfter, "executeAfter");
  const backupExpiresAt = instant(input.backupExpiresAt, "backupExpiresAt");
  if (customerExportDeliveredAt < requestedAt || customerExportDeliveredAt > executeAfter) {
    throw new TenantErasurePolicyError(
      "Der Kundendatenexport muss zwischen Auftrag und Ausfuehrungsfreigabe liegen.",
    );
  }
  if (executeAfter.getTime() - requestedAt.getTime() < options.minimumWaitMs) {
    throw new TenantErasurePolicyError("Die dokumentierte Wartefrist ist zu kurz.");
  }
  if (backupExpiresAt < executeAfter) {
    throw new TenantErasurePolicyError("backupExpiresAt darf nicht vor executeAfter liegen.");
  }
  if (requestedAt > options.now || customerExportDeliveredAt > options.now) {
    throw new TenantErasurePolicyError("Auftrag und Exportuebergabe duerfen nicht in der Zukunft liegen.");
  }

  const decisions = record(input.retentionDecisions, "retentionDecisions");
  exactKeys(
    decisions,
    ["auditEvidence", "backups", "billing", "certificates", "learningRecords"],
    "retentionDecisions",
  );
  const retentionDecisions = {
    auditEvidence: textValue(decisions.auditEvidence, "retentionDecisions.auditEvidence", { max: 500 }),
    backups: textValue(decisions.backups, "retentionDecisions.backups", { max: 500 }),
    billing: textValue(decisions.billing, "retentionDecisions.billing", { max: 500 }),
    certificates: textValue(decisions.certificates, "retentionDecisions.certificates", { max: 500 }),
    learningRecords: textValue(decisions.learningRecords, "retentionDecisions.learningRecords", { max: 500 }),
  };

  const manifest: TenantErasurePolicyManifest = {
    format: TENANT_ERASURE_POLICY_FORMAT,
    organizationSlug: textValue(input.organizationSlug, "organizationSlug", {
      max: 100,
      pattern: SLUG_PATTERN,
    }),
    requestReference: textValue(input.requestReference, "requestReference", {
      max: 180,
      pattern: REFERENCE_PATTERN,
    }),
    approvedBy: textValue(input.approvedBy, "approvedBy", { max: 180 }),
    legalBasis: textValue(input.legalBasis, "legalBasis", { max: 2_000 }),
    requestedAt: requestedAt.toISOString(),
    customerExportDeliveredAt: customerExportDeliveredAt.toISOString(),
    executeAfter: executeAfter.toISOString(),
    backupExpiresAt: backupExpiresAt.toISOString(),
    customerExportSha256: textValue(
      input.customerExportSha256,
      "customerExportSha256",
      { max: 64, pattern: HASH_PATTERN },
    ),
    retentionDecisions,
  };

  return {
    manifest,
    requestedAt,
    customerExportDeliveredAt,
    executeAfter,
    backupExpiresAt,
    executable: options.now >= executeAfter,
  };
}

export function tenantErasureArchiveAssociatedData(input: {
  organizationId: string;
  sequence: number;
  table: TenantErasureEvidenceTable;
}) {
  return `${TENANT_ERASURE_ARCHIVE_FORMAT}:${input.organizationId}:${input.sequence}:${input.table}`;
}

export function createTenantErasureArchiveLine(input: {
  organizationId: string;
  sequence: number;
  table: TenantErasureEvidenceTable;
  row: unknown;
  keyring: EncryptionKeyring;
}) {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    throw new Error("Tenant erasure archive sequence is invalid.");
  }
  const encrypted = encryptPayloadWithKeyring(
    canonicalJson(input.row),
    tenantErasureArchiveAssociatedData(input),
    input.keyring,
  );
  return canonicalJson({
    format: TENANT_ERASURE_ARCHIVE_FORMAT,
    organizationId: input.organizationId,
    sequence: input.sequence,
    table: input.table,
    encrypted,
  } satisfies TenantErasureArchiveLine);
}

export function decryptTenantErasureArchiveLine(
  line: TenantErasureArchiveLine,
  keyring: EncryptionKeyring,
) {
  if (line.format !== TENANT_ERASURE_ARCHIVE_FORMAT) {
    throw new Error("Tenant erasure archive line format is invalid.");
  }
  const plaintext = decryptPayloadWithKeyring(
    line.encrypted,
    tenantErasureArchiveAssociatedData(line),
    keyring,
  );
  return JSON.parse(plaintext) as unknown;
}

function archiveManifestPayload(
  manifest: Omit<TenantErasureArchiveManifest, "signature">,
) {
  return canonicalJson(manifest);
}

export function signTenantErasureArchiveManifest(
  manifest: Omit<TenantErasureArchiveManifest, "signature">,
  hmacKey: Buffer,
): TenantErasureArchiveManifest {
  return {
    ...manifest,
    signature: createHmac("sha256", hmacKey)
      .update(archiveManifestPayload(manifest))
      .digest("base64url"),
  };
}

export function verifyTenantErasureArchiveManifest(
  manifest: TenantErasureArchiveManifest,
  hmacKey: Buffer,
) {
  const { signature, ...unsigned } = manifest;
  const expected = createHmac("sha256", hmacKey)
    .update(archiveManifestPayload(unsigned))
    .digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
