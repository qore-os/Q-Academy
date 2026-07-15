import "server-only";

import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { createEncryptionKeyring } from "@/lib/encryption-keyring";
import { getMfaRecoveryPepperKeyringConfiguration } from "@/lib/server-environment";
import {
  hashRecoveryCodeWithKeyring,
  recoveryHashIndexWithKeyring,
} from "@/lib/mfa/recovery-hash";

function associatedData(organizationId: string, userId: string) {
  return `mfa-totp:${organizationId}:${userId}:v1`;
}

export function encryptMfaSecret(
  secret: string,
  organizationId: string,
  userId: string,
) {
  return encryptPayload(secret, associatedData(organizationId, userId));
}

export function decryptMfaSecret(
  payload: unknown,
  organizationId: string,
  userId: string,
) {
  return decryptPayload(payload, associatedData(organizationId, userId));
}

export function hashRecoveryCode(
  code: string,
  organizationId: string,
  userId: string,
) {
  const keyring = createEncryptionKeyring(
    getMfaRecoveryPepperKeyringConfiguration(),
  );
  return hashRecoveryCodeWithKeyring(
    code,
    organizationId,
    userId,
    keyring,
  );
}

export function recoveryHashIndex(
  hashes: readonly string[],
  code: string,
  organizationId: string,
  userId: string,
) {
  const keyring = createEncryptionKeyring(
    getMfaRecoveryPepperKeyringConfiguration(),
  );
  return recoveryHashIndexWithKeyring(
    hashes,
    code,
    organizationId,
    userId,
    keyring,
  );
}
