import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";
import {
  oidcLoginTransactionSchema,
  type OidcLoginTransaction,
} from "@/lib/oidc-model";

const TRANSACTION_ISSUER = "q-academy";
const TRANSACTION_AUDIENCE = "q-academy-oidc-callback";

function encryptionKey(secret: string) {
  return createHash("sha256")
    .update("q-academy:oidc-transaction:v1\0")
    .update(secret)
    .digest();
}

export async function sealOidcLoginTransactionWithSecret(
  input: OidcLoginTransaction,
  secret: string,
) {
  const transaction = oidcLoginTransactionSchema.parse(input);
  return new EncryptJWT(transaction)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM", typ: "JWT" })
    .setIssuer(TRANSACTION_ISSUER)
    .setAudience(TRANSACTION_AUDIENCE)
    .setJti(transaction.state)
    .setIssuedAt()
    .setExpirationTime("10m")
    .encrypt(encryptionKey(secret));
}

export async function openOidcLoginTransactionWithSecret(
  value: string | undefined,
  secret: string,
) {
  if (!value || value.length > 5000) return null;
  try {
    const { payload, protectedHeader } = await jwtDecrypt(
      value,
      encryptionKey(secret),
      {
        issuer: TRANSACTION_ISSUER,
        audience: TRANSACTION_AUDIENCE,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
        clockTolerance: 5,
      },
    );
    if (protectedHeader.typ !== "JWT") return null;
    const parsed = oidcLoginTransactionSchema.safeParse({
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
      organizationId: payload.organizationId,
      issuer: payload.issuer,
      configurationVersion: payload.configurationVersion,
      redirectUri: payload.redirectUri,
      returnTo: payload.returnTo,
      linkUserId: payload.linkUserId ?? null,
      linkSessionId: payload.linkSessionId ?? null,
      requireFreshAuthentication:
        payload.requireFreshAuthentication === true,
    });
    if (!parsed.success || payload.jti !== parsed.data.state) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
