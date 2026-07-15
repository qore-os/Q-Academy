import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_PREVIOUS_KEYS = 16;
const AES_GCM_AUTH_TAG_BYTES = 16;

export type LegacyEncryptedPayload = {
  v: 1;
  alg: "A256GCM";
  iv: string;
  tag: string;
  ciphertext: string;
};

export type VersionedEncryptedPayload = {
  v: 2;
  alg: "A256GCM";
  kid: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export type EncryptedPayload =
  | LegacyEncryptedPayload
  | VersionedEncryptedPayload;

export type EncryptionKeyring = Readonly<{
  activeKeyId: string;
  keys: Readonly<Record<string, string>>;
}>;

export class EncryptionKeyringConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyringConfigurationError";
  }
}

function assertKeyId(keyId: string, fieldName: string) {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new EncryptionKeyringConfigurationError(
      `${fieldName} must contain 1 to 64 letters, digits, dots, underscores, or hyphens.`,
    );
  }
}

export function parsePreviousEncryptionKeys(
  rawValue: string | undefined,
  fieldName: string,
) {
  const value = rawValue?.trim();
  if (!value) return {} as Record<string, string>;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new EncryptionKeyringConfigurationError(
      `${fieldName} must be a JSON object that maps key IDs to secrets.`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new EncryptionKeyringConfigurationError(
      `${fieldName} must be a JSON object that maps key IDs to secrets.`,
    );
  }

  const entries = Object.entries(parsed);
  if (entries.length > MAX_PREVIOUS_KEYS) {
    throw new EncryptionKeyringConfigurationError(
      `${fieldName} must contain at most ${MAX_PREVIOUS_KEYS} previous keys.`,
    );
  }

  const result: Record<string, string> = {};
  for (const [keyId, secret] of entries) {
    assertKeyId(keyId, `${fieldName} key ID`);
    if (typeof secret !== "string" || !secret.trim()) {
      throw new EncryptionKeyringConfigurationError(
        `${fieldName}.${keyId} must contain a non-empty secret.`,
      );
    }
    result[keyId] = secret.trim();
  }
  return result;
}

export function createEncryptionKeyring(input: {
  activeKeyId: string;
  activeSecret: string;
  previousKeys?: Readonly<Record<string, string>>;
}): EncryptionKeyring {
  const activeKeyId = input.activeKeyId.trim();
  const activeSecret = input.activeSecret.trim();
  assertKeyId(activeKeyId, "Active encryption key ID");
  if (!activeSecret) {
    throw new EncryptionKeyringConfigurationError(
      "Active encryption secret must not be empty.",
    );
  }

  const previousEntries = Object.entries(input.previousKeys ?? {});
  if (previousEntries.length > MAX_PREVIOUS_KEYS) {
    throw new EncryptionKeyringConfigurationError(
      `Encryption keyrings must contain at most ${MAX_PREVIOUS_KEYS} previous keys.`,
    );
  }

  const keys: Record<string, string> = { [activeKeyId]: activeSecret };
  const seenSecrets = new Set([activeSecret]);
  for (const [rawKeyId, rawSecret] of previousEntries) {
    const keyId = rawKeyId.trim();
    const secret = rawSecret.trim();
    assertKeyId(keyId, "Previous encryption key ID");
    if (keyId === activeKeyId) {
      throw new EncryptionKeyringConfigurationError(
        `Previous encryption key ID '${keyId}' duplicates the active key ID.`,
      );
    }
    if (!secret) {
      throw new EncryptionKeyringConfigurationError(
        `Previous encryption key '${keyId}' must not be empty.`,
      );
    }
    if (seenSecrets.has(secret)) {
      throw new EncryptionKeyringConfigurationError(
        `Encryption key '${keyId}' reuses another key's secret.`,
      );
    }
    keys[keyId] = secret;
    seenSecrets.add(secret);
  }

  return Object.freeze({
    activeKeyId,
    keys: Object.freeze(keys),
  });
}

function derivedKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function decodePart(value: string, expectedBytes: number | null) {
  if (!value || !BASE64URL_PATTERN.test(value)) {
    throw new Error("Invalid encrypted value encoding.");
  }
  const decoded = Buffer.from(value, "base64url");
  if (expectedBytes !== null && decoded.length !== expectedBytes) {
    throw new Error("Invalid encrypted value length.");
  }
  return decoded;
}

function decryptWithSecret(
  payload: LegacyEncryptedPayload | VersionedEncryptedPayload,
  secret: string,
  associatedData: string,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    derivedKey(secret),
    decodePart(payload.iv, 12),
    { authTagLength: AES_GCM_AUTH_TAG_BYTES },
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(decodePart(payload.tag, AES_GCM_AUTH_TAG_BYTES));
  return Buffer.concat([
    decipher.update(decodePart(payload.ciphertext, null)),
    decipher.final(),
  ]).toString("utf8");
}

function isLegacyPayload(payload: unknown): payload is LegacyEncryptedPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<LegacyEncryptedPayload>;
  return (
    candidate.v === 1 &&
    candidate.alg === "A256GCM" &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

function isVersionedPayload(
  payload: unknown,
): payload is VersionedEncryptedPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const candidate = payload as Partial<VersionedEncryptedPayload>;
  return (
    candidate.v === 2 &&
    candidate.alg === "A256GCM" &&
    typeof candidate.kid === "string" &&
    KEY_ID_PATTERN.test(candidate.kid) &&
    typeof candidate.iv === "string" &&
    typeof candidate.tag === "string" &&
    typeof candidate.ciphertext === "string"
  );
}

export function encryptPayloadWithKeyring(
  plaintext: string,
  associatedData: string,
  keyring: EncryptionKeyring,
): VersionedEncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    derivedKey(keyring.keys[keyring.activeKeyId]!),
    iv,
    { authTagLength: AES_GCM_AUTH_TAG_BYTES },
  );
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    v: 2,
    alg: "A256GCM",
    kid: keyring.activeKeyId,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export function decryptPayloadWithKeyring(
  payload: unknown,
  associatedData: string,
  keyring: EncryptionKeyring,
) {
  if (isVersionedPayload(payload)) {
    const secret = keyring.keys[payload.kid];
    if (!secret) throw new Error("Encrypted payload references an unavailable key.");
    try {
      return decryptWithSecret(payload, secret, associatedData);
    } catch {
      throw new Error("Encrypted payload authentication failed.");
    }
  }
  if (!isLegacyPayload(payload)) {
    throw new Error("Encrypted payload is invalid.");
  }

  for (const secret of Object.values(keyring.keys)) {
    try {
      return decryptWithSecret(payload, secret, associatedData);
    } catch {
      // Legacy payloads have no key ID, so every retained key must be tried.
    }
  }
  throw new Error("Encrypted payload authentication failed.");
}

export function encryptedPayloadUsesActiveKey(
  payload: unknown,
  keyring: EncryptionKeyring,
) {
  return isVersionedPayload(payload) && payload.kid === keyring.activeKeyId;
}

const WEBHOOK_ASSOCIATED_DATA = "q-academy:webhook-secret:v2";

export function encryptCompactValueWithKeyring(
  plaintext: string,
  keyring: EncryptionKeyring,
) {
  const payload = encryptPayloadWithKeyring(
    plaintext,
    WEBHOOK_ASSOCIATED_DATA,
    keyring,
  );
  return [
    "v2",
    payload.kid,
    payload.iv,
    payload.tag,
    payload.ciphertext,
  ].join(".");
}

export function decryptCompactValueWithKeyring(
  value: string,
  keyring: EncryptionKeyring,
) {
  const parts = value.split(".");
  if (parts[0] === "v2" && parts.length === 5) {
    return decryptPayloadWithKeyring(
      {
        v: 2,
        alg: "A256GCM",
        kid: parts[1],
        iv: parts[2],
        tag: parts[3],
        ciphertext: parts[4],
      },
      WEBHOOK_ASSOCIATED_DATA,
      keyring,
    );
  }
  if (parts[0] !== "v1" || parts.length !== 4) {
    throw new Error("Encrypted compact value is invalid.");
  }

  const legacyPayload: LegacyEncryptedPayload = {
    v: 1,
    alg: "A256GCM",
    iv: parts[1]!,
    tag: parts[2]!,
    ciphertext: parts[3]!,
  };
  for (const secret of Object.values(keyring.keys)) {
    try {
      return decryptWithSecret(legacyPayload, secret, "");
    } catch {
      // Legacy compact values have no key ID or associated data.
    }
  }
  throw new Error("Encrypted compact value authentication failed.");
}

export function compactValueUsesActiveKey(
  value: string,
  keyring: EncryptionKeyring,
) {
  const [version, keyId] = value.split(".", 2);
  return version === "v2" && keyId === keyring.activeKeyId;
}
