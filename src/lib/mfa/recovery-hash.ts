import { createHmac, timingSafeEqual } from "node:crypto";
import type { EncryptionKeyring } from "@/lib/encryption-keyring";
import { normalizeRecoveryCode } from "@/lib/mfa/totp";

function digest(
  code: string,
  organizationId: string,
  userId: string,
  pepper: string,
) {
  return createHmac("sha256", pepper)
    .update(
      `mfa-recovery\0${organizationId}\0${userId}\0${normalizeRecoveryCode(code)}`,
    )
    .digest("hex");
}

export function hashRecoveryCodeWithKeyring(
  code: string,
  organizationId: string,
  userId: string,
  keyring: EncryptionKeyring,
) {
  return `v1.${keyring.activeKeyId}.${digest(
    code,
    organizationId,
    userId,
    keyring.keys[keyring.activeKeyId]!,
  )}`;
}

export function recoveryHashIndexWithKeyring(
  hashes: readonly string[],
  code: string,
  organizationId: string,
  userId: string,
  keyring: EncryptionKeyring,
) {
  return hashes.findIndex((value) => {
    const match = /^v1\.([A-Za-z0-9][A-Za-z0-9._-]{0,63})\.([a-f0-9]{64})$/.exec(
      value,
    );
    if (!match) return false;
    const pepper = keyring.keys[match[1]!];
    if (!pepper) return false;
    const expected = digest(code, organizationId, userId, pepper);
    const left = Buffer.from(match[2]!, "hex");
    const right = Buffer.from(expected, "hex");
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
