import assert from "node:assert/strict";
import {
  createCipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import test from "node:test";
import {
  compactValueUsesActiveKey,
  createEncryptionKeyring,
  decryptCompactValueWithKeyring,
  decryptPayloadWithKeyring,
  encryptedPayloadUsesActiveKey,
  encryptCompactValueWithKeyring,
  encryptPayloadWithKeyring,
  parsePreviousEncryptionKeys,
  type LegacyEncryptedPayload,
} from "../src/lib/encryption-keyring";

const oldSecret = "old-key-4f6a9c2e8b1d7f3a5c0e6b9d2f8a4c1e";
const activeSecret = "new-key-8d2f5a1c7e4b9d3f6a0c2e8b5d1f7a4c";

function legacyPayload(
  plaintext: string,
  associatedData: string,
  secret: string,
): LegacyEncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(secret).digest(),
    iv,
  );
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function legacyCompact(plaintext: string, secret: string) {
  const payload = legacyPayload(plaintext, "", secret);
  return `v1.${payload.iv}.${payload.tag}.${payload.ciphertext}`;
}

test("keyring writes v2 values and reads current and retained legacy keys", () => {
  const keyring = createEncryptionKeyring({
    activeKeyId: "data-2026-07",
    activeSecret,
    previousKeys: { "data-2026-01": oldSecret },
  });
  const context = "record:42";
  const current = encryptPayloadWithKeyring("current", context, keyring);
  const legacy = legacyPayload("legacy", context, oldSecret);

  assert.equal(current.v, 2);
  assert.equal(current.kid, "data-2026-07");
  assert.equal(decryptPayloadWithKeyring(current, context, keyring), "current");
  assert.equal(decryptPayloadWithKeyring(legacy, context, keyring), "legacy");
  assert.equal(encryptedPayloadUsesActiveKey(current, keyring), true);
  assert.equal(encryptedPayloadUsesActiveKey(legacy, keyring), false);
  assert.throws(
    () => decryptPayloadWithKeyring(current, "record:43", keyring),
    /authentication failed/,
  );
});

test("compact webhook values support online rotation from v1 to keyed v2", () => {
  const keyring = createEncryptionKeyring({
    activeKeyId: "webhook-2026-07",
    activeSecret,
    previousKeys: { "webhook-legacy": oldSecret },
  });
  const current = encryptCompactValueWithKeyring("hook-secret", keyring);
  const legacy = legacyCompact("legacy-hook", oldSecret);

  assert.match(current, /^v2\.webhook-2026-07\./);
  assert.equal(decryptCompactValueWithKeyring(current, keyring), "hook-secret");
  assert.equal(decryptCompactValueWithKeyring(legacy, keyring), "legacy-hook");
  assert.equal(compactValueUsesActiveKey(current, keyring), true);
  assert.equal(compactValueUsesActiveKey(legacy, keyring), false);
});

test("keyring parsing rejects ambiguous IDs, duplicate material, and malformed JSON", () => {
  assert.deepEqual(
    parsePreviousEncryptionKeys(
      JSON.stringify({ "data-2026-01": oldSecret }),
      "DATA_ENCRYPTION_PREVIOUS_KEYS",
    ),
    { "data-2026-01": oldSecret },
  );
  assert.throws(
    () => parsePreviousEncryptionKeys("[]", "DATA_ENCRYPTION_PREVIOUS_KEYS"),
    /must be a JSON object/,
  );
  assert.throws(
    () =>
      createEncryptionKeyring({
        activeKeyId: "data active",
        activeSecret,
      }),
    /Active encryption key ID/,
  );
  assert.throws(
    () =>
      createEncryptionKeyring({
        activeKeyId: "data-current",
        activeSecret,
        previousKeys: { "data-old": activeSecret },
      }),
    /reuses another key's secret/,
  );
});

test("unknown key IDs and modified ciphertext fail closed", () => {
  const keyring = createEncryptionKeyring({
    activeKeyId: "data-current",
    activeSecret,
  });
  const encrypted = encryptPayloadWithKeyring("protected", "row:7", keyring);
  assert.throws(
    () =>
      decryptPayloadWithKeyring(
        { ...encrypted, kid: "data-missing" },
        "row:7",
        keyring,
      ),
    /unavailable key/,
  );
  assert.throws(
    () =>
      decryptPayloadWithKeyring(
        { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` },
        "row:7",
        keyring,
      ),
    /authentication failed/,
  );
});
