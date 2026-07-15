import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getEmailDeliveryCopy,
  localizeEmailDeliveryFailure,
} from "../src/lib/i18n/email-delivery";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function shape(value: unknown): unknown {
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, shape(entry)]),
    );
  }
  return typeof value;
}

test("email delivery copy has complete DE/EN/IT/ES/FR parity", () => {
  const reference = shape(getEmailDeliveryCopy("de"));
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getEmailDeliveryCopy(locale);
    assert.deepEqual(shape(copy), reference);
    assert.ok(copy.title.length > 0);
    assert.ok(copy.messages["emailDelivery.retryFailed"].length > 0);
  }
});

test("email delivery failures are localized without exposing stored backend copy", () => {
  assert.equal(
    localizeEmailDeliveryFailure("en", {
      responseStatus: 503,
      failureSummary: "Das Mail-Gateway antwortete mit HTTP 503.",
    }),
    "The mail gateway responded with HTTP 503.",
  );
  assert.equal(
    localizeEmailDeliveryFailure("fr", {
      responseStatus: null,
      failureSummary: "unexpected stored value",
    }),
    getEmailDeliveryCopy("fr").failures.generic,
  );
});

test("email delivery page and retry control propagate locale", () => {
  const page = readFileSync("src/app/(admin)/admin/email/[id]/page.tsx", "utf8");
  const retry = readFileSync("src/components/admin/email-delivery-retry.tsx", "utf8");

  assert.match(page, /resolveUserLocale\(actor\)/);
  assert.match(page, /formatDateTime\(detail\.createdAt, locale\)/);
  assert.match(page, /<EmailDeliveryRetry deliveryId=\{detail\.id\} locale=\{locale\}/);
  assert.match(retry, /name="locale" value=\{locale\}/);
  assert.doesNotMatch(page, /EMAIL_EVENT_LABELS/);
  assert.doesNotMatch(page, /\{detail\.failureSummary\}/);
  assert.doesNotMatch(retry, /\{state\.message\}/);
});

test("retry action returns stable message codes and no raw ApiError message", () => {
  const source = readFileSync("src/lib/email-center-actions.ts", "utf8");
  assert.match(source, /messageCode\?: EmailDeliveryMessageCode/);
  assert.match(source, /"emailDelivery\.queued"/);
  assert.match(source, /"emailDelivery\.alreadyQueued"/);
  assert.match(source, /"emailDelivery\.retryFailed"/);
  assert.doesNotMatch(source, /initialFailure\(error\.message\)/);
});
