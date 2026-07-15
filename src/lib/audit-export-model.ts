import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const AUDIT_EXPORT_FORMAT = "q-academy-activity-events-v1";

export type AuditExportEvent = Readonly<{
  id: string;
  organizationId: string;
  userId: string | null;
  type: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
}>;

export type UnsignedAuditExportManifest = Readonly<{
  format: typeof AUDIT_EXPORT_FORMAT;
  organizationId: string;
  organizationSlug: string;
  fromInclusive: string;
  untilExclusive: string;
  generatedAt: string;
  eventCount: number;
  fileName: string;
  fileSha256: string;
  finalChainHmac: string;
  keyId: string;
}>;

export type AuditExportManifest = UnsignedAuditExportManifest &
  Readonly<{ manifestHmac: string }>;

function normalizedKey(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sensitiveKey(value: string) {
  const key = normalizedKey(value);
  return [
    "authorization",
    "cookie",
    "credential",
    "password",
    "privatekey",
    "recoverycode",
    "secret",
    "signature",
    "token",
  ].some((fragment) => key.includes(fragment));
}

function sanitizedString(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > 10_000) return `${trimmed.slice(0, 10_000)}[truncated]`;
  if (
    /^\s*(?:basic|bearer|digest)\s+\S+/i.test(trimmed) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(trimmed) ||
    /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/.test(
      trimmed,
    )
  ) {
    return "[redacted]";
  }
  if (/^(?:https?:\/\/|\/?[^\s?#]+[?#])/i.test(trimmed)) {
    try {
      const absolute = /^https?:\/\//i.test(trimmed);
      const url = new URL(trimmed, absolute ? undefined : "https://audit.invalid");
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return absolute ? url.toString() : url.pathname;
    } catch {
      return value;
    }
  }
  return value;
}

export function sanitizeAuditMetadata(
  value: unknown,
  depth = 0,
): unknown {
  if (depth > 12) return "[redacted-depth]";
  if (Array.isArray(value)) {
    return value
      .slice(0, 500)
      .map((entry) => sanitizeAuditMetadata(entry, depth + 1));
  }
  if (typeof value === "string") return sanitizedString(value);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, 500)
      .map(([key, nested]) => [
        key,
        sensitiveKey(key)
          ? "[redacted]"
          : sanitizeAuditMetadata(nested, depth + 1),
      ]),
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("Value is not JSON serializable.");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}

export function auditExportEventLine(event: AuditExportEvent) {
  return canonicalJson({
    ...event,
    metadata: sanitizeAuditMetadata(event.metadata),
  });
}

export function decodeAuditExportKey(value: string) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) {
    throw new Error("Audit export key must be an unpadded base64url value.");
  }
  const key = Buffer.from(value, "base64url");
  if (key.length < 32 || key.length > 96) {
    throw new Error("Audit export key must decode to 32 through 96 bytes.");
  }
  if (key.toString("base64url") !== value) {
    throw new Error("Audit export key is not canonical base64url.");
  }
  return key;
}

export function nextAuditChainHmac(
  key: Uint8Array,
  previousHmac: string | null,
  line: string,
) {
  const hmac = createHmac("sha256", key);
  hmac.update(previousHmac ? Buffer.from(previousHmac, "hex") : Buffer.alloc(32));
  hmac.update(Buffer.from(line, "utf8"));
  return hmac.digest("hex");
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function manifestSignature(
  manifest: UnsignedAuditExportManifest,
  key: Uint8Array,
) {
  return createHmac("sha256", key)
    .update(canonicalJson(manifest))
    .digest("hex");
}

export function signAuditExportManifest(
  manifest: UnsignedAuditExportManifest,
  key: Uint8Array,
): AuditExportManifest {
  return { ...manifest, manifestHmac: manifestSignature(manifest, key) };
}

export function verifyAuditExportManifest(
  manifest: AuditExportManifest,
  key: Uint8Array,
) {
  const { manifestHmac, ...unsigned } = manifest;
  if (!/^[a-f0-9]{64}$/.test(manifestHmac)) return false;
  const expected = Buffer.from(manifestSignature(unsigned, key), "hex");
  return timingSafeEqual(expected, Buffer.from(manifestHmac, "hex"));
}
