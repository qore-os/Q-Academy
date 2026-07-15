import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getEmailSuppressionCopy } from "../src/lib/email-suppression-copy";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("email suppression copy has complete DE/EN/IT/ES/FR parity", () => {
  const reference = Object.keys(getEmailSuppressionCopy("de")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getEmailSuppressionCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), reference);
    assert.ok(Object.values(copy).every((value) => value.trim().length > 0));
  }
});

test("email suppression page localizes metadata, dates, and pagination", () => {
  const page = readFileSync(
    "src/app/(admin)/admin/email/suppressions/page.tsx",
    "utf8",
  );

  assert.match(page, /export async function generateMetadata/);
  assert.match(page, /getEmailSuppressionCopy\(locale\)\.title/);
  assert.match(page, /new Intl\.DateTimeFormat\(intlLocale\(locale\)/);
  assert.match(page, /timeZone: PLATFORM_TIME_ZONE/);
  assert.match(page, /aria-label=\{copy\.pagination\}/);
  assert.match(page, /aria-label=\{copy\.previousPage\}/);
  assert.match(page, /aria-label=\{copy\.nextPage\}/);
  assert.doesNotMatch(page, /aria-label="Pagination"/);
});

test("email suppression release uses stable server action codes", () => {
  const action = readFileSync(
    "src/lib/admin/email-suppression-actions.ts",
    "utf8",
  );
  const control = readFileSync(
    "src/components/admin/email-suppression-release.tsx",
    "utf8",
  );

  assert.match(action, /code\?: "invalid" \| "released" \| "release_failed"/);
  assert.match(action, /code: "invalid"/);
  assert.match(action, /code: "released"/);
  assert.match(action, /code: "release_failed"/);
  assert.doesNotMatch(action, /message: "Empfaenger/);
  assert.doesNotMatch(control, /\{state\.message\}/);
});
