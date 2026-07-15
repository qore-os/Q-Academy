import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAIL_GATEWAY_SIGNATURE_HEADER,
  MAIL_GATEWAY_TIMESTAMP_HEADER,
  mailGatewayFeedbackEventSchema,
  signMailGatewayFeedback,
  suppressionReasonForEvent,
  verifyMailGatewayFeedbackSignature,
} from "../src/lib/email-feedback-model";

const secret = "Inbound-test-secret-with-at-least-32-bytes";
const now = new Date("2026-07-13T12:00:00.000Z");
const timestamp = Math.floor(now.getTime() / 1_000);
const rawBody = JSON.stringify({ eventId: "evt-12345678" });

function signedHeaders(options: { at?: number; signature?: string } = {}) {
  const at = options.at ?? timestamp;
  return new Headers({
    [MAIL_GATEWAY_TIMESTAMP_HEADER]: String(at),
    [MAIL_GATEWAY_SIGNATURE_HEADER]: `v1=${
      options.signature ?? signMailGatewayFeedback({ secret, timestamp: at, rawBody })
    }`,
  });
}

test("mail gateway HMAC accepts the exact fresh raw body", () => {
  assert.deepEqual(
    verifyMailGatewayFeedbackSignature({
      secret,
      headers: signedHeaders(),
      rawBody,
      now,
    }),
    { ok: true, timestamp },
  );
});

test("mail gateway HMAC rejects tampering, malformed signatures, and stale timestamps", () => {
  assert.equal(
    verifyMailGatewayFeedbackSignature({
      secret,
      headers: signedHeaders(),
      rawBody: `${rawBody} `,
      now,
    }).ok,
    false,
  );
  assert.deepEqual(
    verifyMailGatewayFeedbackSignature({
      secret,
      headers: signedHeaders({ signature: "invalid" }),
      rawBody,
      now,
    }),
    { ok: false, code: "signature_invalid" },
  );
  assert.deepEqual(
    verifyMailGatewayFeedbackSignature({
      secret,
      headers: signedHeaders({ at: timestamp - 301 }),
      rawBody,
      now,
    }),
    { ok: false, code: "timestamp_expired" },
  );
});

test("feedback schema is strict and enforces bounce/complaint shape", () => {
  const base = {
    eventId: "evt-12345678",
    organizationId: "00000000-0000-4000-8000-000000000001",
    deliveryId: "00000000-0000-4000-8000-000000000002",
    reasonCode: "mailbox_not_found",
    occurredAt: "2026-07-13T11:59:00.000Z",
  };
  const hard = mailGatewayFeedbackEventSchema.parse({
    ...base,
    type: "bounce",
    bounceKind: "hard",
  });
  assert.equal(suppressionReasonForEvent(hard), "hard_bounce");
  assert.equal(
    mailGatewayFeedbackEventSchema.safeParse({ ...base, type: "bounce" }).success,
    false,
  );
  assert.equal(
    mailGatewayFeedbackEventSchema.safeParse({
      ...base,
      type: "complaint",
      bounceKind: "soft",
    }).success,
    false,
  );
  assert.equal(
    mailGatewayFeedbackEventSchema.safeParse({
      ...base,
      type: "complaint",
      rawProviderPayload: "must-not-be-accepted",
    }).success,
    false,
  );
});

test("mail worker checks suppressions before payload decryption and network delivery", () => {
  const source = readFileSync(
    new URL("../src/lib/email-delivery.ts", import.meta.url),
    "utf8",
  );
  const suppression = source.indexOf("await activeEmailSuppression");
  assert.ok(suppression > 0);
  assert.ok(suppression < source.indexOf("decryptPayload("));
  assert.ok(suppression < source.indexOf("await fetch("));
});
