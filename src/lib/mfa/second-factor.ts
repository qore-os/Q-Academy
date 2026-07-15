import type { UserMfaConfiguration } from "@/db/schema";
import {
  decryptMfaSecret,
  recoveryHashIndex,
} from "@/lib/mfa/secrets";
import { verifyTotpCode } from "@/lib/mfa/totp";

export function verifyMfaSecondFactor(
  configuration: UserMfaConfiguration,
  code: string,
) {
  if (configuration.status !== "enabled") return null;
  const secret = decryptMfaSecret(
    configuration.secretEncrypted,
    configuration.organizationId,
    configuration.userId,
  );
  const counter = verifyTotpCode({
    secret,
    code,
    lastUsedCounter: configuration.lastTotpCounter,
  });
  if (counter !== null) {
    return {
      method: "totp" as const,
      counter,
      recoveryCodeHashes: configuration.recoveryCodeHashes,
    };
  }
  const index = recoveryHashIndex(
    configuration.recoveryCodeHashes,
    code,
    configuration.organizationId,
    configuration.userId,
  );
  if (index < 0) return null;
  return {
    method: "recovery" as const,
    counter: configuration.lastTotpCounter,
    recoveryCodeHashes: configuration.recoveryCodeHashes.filter(
      (_, position) => position !== index,
    ),
  };
}
