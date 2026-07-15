import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getOrbitCopy } from "../src/lib/i18n/orbit";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";
import { ORBIT_TRANSFER_WARNING_CODES } from "../src/lib/orbit/transfer-contract";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (typeof value === "function") result.set(prefix, String(value(2, 5)));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("Orbit UI copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getOrbitCopy("de"));
  assert.ok(german.size >= 80, `expected at least 80 leaves, got ${german.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getOrbitCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 72, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("Orbit page propagates the user locale to onboarding and console", () => {
  const page = readFileSync("src/app/(orbit)/orbit/page.tsx", "utf8");
  assert.match(page, /resolveUserLocale\(user\)/);
  assert.equal((page.match(/locale=\{locale\}/g) ?? []).length, 3);
  assert.match(page, /getOrbitCopy\(locale\)\.common\.controlPlane/);
});

test("Orbit transfer warnings and author mapping are localized and explicit", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const transfer = getOrbitCopy(locale).transfer;
    for (const warning of ORBIT_TRANSFER_WARNING_CODES) {
      assert.ok(transfer.warnings[warning].trim().length > 0, `${locale}:${warning}`);
    }
    assert.ok(transfer.warningsTitle.trim().length > 0);
    assert.ok(transfer.confirmWarnings.trim().length > 0);
    assert.ok(transfer.authorMappingTitle.trim().length > 0);
    assert.ok(transfer.authorMappingDescription.trim().length > 0);
    assert.ok(transfer.selectTargetAuthor.trim().length > 0);
    assert.ok(transfer.automaticMatch.trim().length > 0);
    assert.ok(transfer.confirmAuthorMapping.trim().length > 0);
  }

  const consoleSource = readFileSync(
    "src/components/orbit/orbit-console.tsx",
    "utf8",
  );
  assert.match(consoleSource, /role="alert"/);
  assert.match(consoleSource, /copy\.transfer\.warnings\[warning\]/);
  assert.match(consoleSource, /onChange=\{invalidateTransferPreflight\}/);
  assert.match(consoleSource, /acceptedWarnings:/);
  assert.match(consoleSource, /confirmationToken:/);
  assert.match(consoleSource, /!transferWarningsAccepted/);
  assert.match(consoleSource, /transferAuthorMappingsSelected/);
  assert.match(consoleSource, /updateTransferAuthorMapping/);
  assert.match(consoleSource, /confirmationToken: null/);
  assert.match(consoleSource, /copy\.transfer\.selectTargetAuthor/);
});

test("Orbit surfaces contain no former German fallback UI or raw API detail", () => {
  const consoleSource = readFileSync(
    "src/components/orbit/orbit-console.tsx",
    "utf8",
  );
  const onboarding = readFileSync(
    "src/components/orbit/orbit-onboarding.tsx",
    "utf8",
  );
  const combined = `${consoleSource}\n${onboarding}`;

  for (const pattern of [
    /Kundeninstanzen/,
    /Kurskopie/,
    /Keine publizierten Kurse/,
    /Organisationsrolle/,
    /Partnerdelegation/,
    /Delegation widerrufen/,
    /Orbit-Aktion fehlgeschlagen/,
    /Zur Academy/,
    /Instanz verknuepfen/,
  ]) {
    assert.doesNotMatch(combined, pattern);
  }
  assert.doesNotMatch(combined, /payload\?\.detail/);
  assert.doesNotMatch(combined, /error instanceof Error|error\.message/);
  assert.match(consoleSource, /intlLocale\(locale\)/);
});
