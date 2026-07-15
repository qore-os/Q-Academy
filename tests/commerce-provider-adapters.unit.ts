import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import {
  automationMemberUpsertSchema,
  commerceConnectionInputSchema,
  commerceEntitlementSourceKey,
  resolveCommerceLifecycleDecision,
} from "../src/lib/commerce/model";
import {
  CommerceProviderPayloadError,
  normalizeCommerceProviderEvent,
  parseProviderBody,
  verifyCommerceProviderSignature,
} from "../src/lib/commerce/provider-adapters";
import {
  CommerceProviderPreflightError,
  runCommerceProviderAdapterPreflight,
} from "../src/lib/commerce/provider-preflight";

test("provider HMAC verification authenticates the exact raw body", () => {
  const secret = "test-secret-with-at-least-16-characters";
  const rawBody = JSON.stringify({ event: "order_created", order_id: "o-1" });
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const headers = new Headers({ "x-ablefy-signature": `sha256=${signature}` });
  assert.equal(verifyCommerceProviderSignature({
    provider: "ablefy",
    mode: "hmac_sha256",
    secret,
    headers,
    rawBody,
    fields: {},
  }), true);
  assert.equal(verifyCommerceProviderSignature({
    provider: "ablefy",
    mode: "hmac_sha256",
    secret,
    headers,
    rawBody: `${rawBody} `,
    fields: {},
  }), false);
});

test("shared-token verification uses a dedicated header", () => {
  const secret = "shared-token-with-at-least-16-characters";
  assert.equal(verifyCommerceProviderSignature({
    provider: "copecart",
    mode: "shared_token",
    secret,
    headers: new Headers({ "x-commerce-token": secret }),
    rawBody: "",
    fields: {},
  }), true);
  assert.equal(verifyCommerceProviderSignature({
    provider: "copecart",
    mode: "shared_token",
    secret,
    headers: new Headers({ "x-commerce-token": `${secret}-wrong` }),
    rawBody: "",
    fields: {},
  }), false);
});

test("Digistore field signature is canonical and excludes sha_sign", () => {
  const secret = "digistore-test-secret";
  const unsigned = { event: "payment", order_id: "A-9", product_id: "P-4" };
  const canonical = Object.entries(unsigned)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
    .join("");
  const shaSign = createHash("sha512").update(canonical).update(secret).digest("hex");
  assert.equal(verifyCommerceProviderSignature({
    provider: "digistore24",
    mode: "digistore_sha512",
    secret,
    headers: new Headers(),
    rawBody: "",
    fields: { ...unsigned, sha_sign: shaSign },
  }), true);
});

test("provider payload aliases normalize money and remaining term", () => {
  const event = normalizeCommerceProviderEvent("copecart", {
    event_id: "evt-1",
    event: "subscription cancelled",
    order_id: "order-1",
    subscription_id: "sub-1",
    product_id: "product-1",
    buyer_email: " BUYER@EXAMPLE.COM ",
    first_name: "Ada",
    last_name: "Lovelace",
    currency: "eur",
    amount: "49.90",
    timestamp: "2026-07-12T10:00:00.000Z",
    paid_until: "2026-08-12T10:00:00.000Z",
  });
  assert.equal(event.type, "subscription_cancelled");
  assert.equal(event.customerEmail, "buyer@example.com");
  assert.equal(event.totalMinor, 4990);
  assert.equal(event.accessUntil?.toISOString(), "2026-08-12T10:00:00.000Z");
});

test("integer major amounts are converted to minor currency units", () => {
  const event = normalizeCommerceProviderEvent("ablefy", {
    event_id: "evt-2",
    event: "purchase",
    order_id: "order-2",
    product_id: "product-2",
    email: "buyer@example.com",
    currency: "EUR",
    amount: "49",
  });
  assert.equal(event.totalMinor, 4900);
});

test("JSON and form bodies expose only scalar fields", () => {
  assert.deepEqual(parseProviderBody('{"event":"purchase","nested":{"secret":1}}', "application/json"), {
    event: "purchase",
  });
  assert.deepEqual(parseProviderBody("event=purchase&order_id=42", "application/x-www-form-urlencoded"), {
    event: "purchase",
    order_id: "42",
  });
});

test("unknown lifecycle aliases fail closed", () => {
  assert.throws(
    () => normalizeCommerceProviderEvent("digistore24", {
      event_id: "evt-x",
      event: "unknown-event",
      order_id: "order-x",
      product_id: "product-x",
      email: "buyer@example.com",
    }),
    CommerceProviderPayloadError,
  );
});

test("lifecycle decisions preserve only an explicit future remaining term", () => {
  const now = new Date("2026-07-12T00:00:00.000Z");
  const future = new Date("2026-08-12T00:00:00.000Z");
  assert.deepEqual(resolveCommerceLifecycleDecision("subscription_cancelled", future, now), {
    action: "grant",
    endsAt: future,
    terminalStatus: null,
  });
  assert.deepEqual(resolveCommerceLifecycleDecision("payment_failed", future, now), {
    action: "revoke",
    endsAt: null,
    terminalStatus: "revoked",
  });
  assert.deepEqual(resolveCommerceLifecycleDecision("subscription_expired", null, now), {
    action: "revoke",
    endsAt: null,
    terminalStatus: "expired",
  });
});

test("entitlement source keys isolate provider, product and member", () => {
  const base = {
    connectionId: "connection-a",
    sourceReference: "subscription:s-1",
    productId: "product-a",
    userId: "user-a",
  };
  assert.notEqual(
    commerceEntitlementSourceKey(base),
    commerceEntitlementSourceKey({ ...base, userId: "user-b" }),
  );
});

test("provider adapter preflight covers every supported signature contract", () => {
  const cases = [
    ["digistore24", "digistore_sha512"],
    ["digistore24", "hmac_sha256"],
    ["ablefy", "hmac_sha256"],
    ["copecart", "shared_token"],
  ] as const;
  for (const [provider, signatureMode] of cases) {
    const result = runCommerceProviderAdapterPreflight({
      provider,
      signatureMode,
      signingSecret: "provider-preflight-secret-v1",
      providerProductId: `${provider}-product-1`,
    });
    assert.equal(result.provider, provider);
    assert.equal(result.signatureMode, signatureMode);
    assert.equal(result.signatureVerified, true);
    assert.equal(result.eventType, "order_created");
    assert.match(result.payloadSha256, /^[a-f0-9]{64}$/);
  }
});

test("connection validation and preflight reject incompatible signature modes", () => {
  const parsed = commerceConnectionInputSchema.safeParse({
    provider: "ablefy",
    displayName: "Ablefy",
    signatureMode: "digistore_sha512",
    signingSecret: "provider-preflight-secret-v1",
    active: true,
    autoCreateMembers: true,
  });
  assert.equal(parsed.success, false);
  assert.throws(
    () =>
      runCommerceProviderAdapterPreflight({
        provider: "ablefy",
        signatureMode: "digistore_sha512",
        signingSecret: "provider-preflight-secret-v1",
        providerProductId: "ablefy-product-1",
      }),
    CommerceProviderPreflightError,
  );
});

test("automation member action defaults to grant and requires a bundle for revoke", () => {
  const grant = automationMemberUpsertSchema.parse({
    email: "member@example.com",
    firstName: "Member",
  });
  assert.equal(grant.bundleAction, "grant");
  assert.equal(
    automationMemberUpsertSchema.safeParse({
      email: "member@example.com",
      bundleAction: "revoke",
    }).success,
    false,
  );
});
