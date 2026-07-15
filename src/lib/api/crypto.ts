import "server-only";

import {
  createEncryptionKeyring,
  decryptCompactValueWithKeyring,
  decryptPayloadWithKeyring,
  encryptCompactValueWithKeyring,
  encryptPayloadWithKeyring,
  type EncryptedPayload,
} from "@/lib/encryption-keyring";
import {
  getDataEncryptionKeyringConfiguration,
  getWebhookEncryptionKeyringConfiguration,
} from "@/lib/server-environment";

function payloadEncryptionKeyring() {
  return createEncryptionKeyring(getDataEncryptionKeyringConfiguration());
}

function webhookEncryptionKeyring() {
  return createEncryptionKeyring(getWebhookEncryptionKeyringConfiguration());
}

export function encryptPayload(
  plaintext: string,
  associatedData: string,
): EncryptedPayload {
  return encryptPayloadWithKeyring(
    plaintext,
    associatedData,
    payloadEncryptionKeyring(),
  );
}

export function decryptPayload(
  payload: unknown,
  associatedData: string,
) {
  return decryptPayloadWithKeyring(
    payload,
    associatedData,
    payloadEncryptionKeyring(),
  );
}

export function encryptWebhookSecret(secret: string) {
  return encryptCompactValueWithKeyring(secret, webhookEncryptionKeyring());
}

export function decryptWebhookSecret(value: string) {
  return decryptCompactValueWithKeyring(value, webhookEncryptionKeyring());
}

export type { EncryptedPayload } from "@/lib/encryption-keyring";
