import assert from "node:assert/strict";
import test from "node:test";
import {
  openOidcLoginTransactionWithSecret,
  sealOidcLoginTransactionWithSecret,
} from "../src/lib/oidc-transaction-crypto";

const secret = "test-only-oidc-transaction-secret-with-32-characters";

const transaction = {
  state: "state_" + "a".repeat(38),
  nonce: "nonce_" + "b".repeat(38),
  codeVerifier: "verifier_" + "c".repeat(56),
  organizationId: "11111111-1111-4111-8111-111111111111",
  issuer: "https://identity.example.com/tenant",
  configurationVersion: 4,
  redirectUri: "https://academy.example.com/api/v1/auth/oidc/callback",
  returnTo: "/academy/courses?view=grid",
  linkUserId: null,
  linkSessionId: null,
  requireFreshAuthentication: false,
};

test("OIDC transaction is encrypted, authenticated and round-trips", async () => {
  const sealed = await sealOidcLoginTransactionWithSecret(transaction, secret);
  assert.equal(sealed.split(".").length, 5);
  assert.equal(sealed.includes(transaction.state), false);
  assert.deepEqual(
    await openOidcLoginTransactionWithSecret(sealed, secret),
    transaction,
  );
});

test("OIDC transaction fails closed after ciphertext tampering", async () => {
  const sealed = await sealOidcLoginTransactionWithSecret(transaction, secret);
  const segments = sealed.split(".");
  const ciphertext = segments[3] ?? "";
  const offset = Math.floor(ciphertext.length / 2);
  segments[3] = `${ciphertext.slice(0, offset)}${ciphertext[offset] === "a" ? "b" : "a"}${ciphertext.slice(offset + 1)}`;
  assert.equal(
    await openOidcLoginTransactionWithSecret(
      segments.join("."),
      secret,
    ),
    null,
  );
  assert.equal(
    await openOidcLoginTransactionWithSecret("not-a-jwe", secret),
    null,
  );
  assert.equal(
    await openOidcLoginTransactionWithSecret("x".repeat(5001), secret),
    null,
  );
});
