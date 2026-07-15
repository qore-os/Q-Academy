import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMfaCopy, localizeMfaMessage } from "../src/lib/i18n/mfa";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (typeof value === "function") result.set(prefix, String(value(2)));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("MFA copy has complete five-locale parity", () => {
  const german = flatten(getMfaCopy("de"));
  assert.ok(german.size >= 70, `expected at least 70 leaves, got ${german.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getMfaCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 65, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("MFA server responses are localized without exposing unknown German errors", () => {
  assert.equal(
    localizeMfaMessage("en", "MFA ist bereits aktiv."),
    "MFA is already enabled.",
  );
  assert.equal(
    localizeMfaMessage(
      "fr",
      "Zu viele Sicherheitsversuche. Bitte versuche es in 42 Sekunden erneut.",
    ),
    "Trop de tentatives de sécurité. Réessayez dans 42 secondes.",
  );
  assert.equal(
    localizeMfaMessage("it", "Unbekannter interner Fehler"),
    getMfaCopy("it").messages.genericFailure,
  );
});

test("MFA account and policy surfaces require an explicit locale and no German JSX copy", () => {
  const account = readFileSync(
    "src/components/academy/mfa-security-panel.tsx",
    "utf8",
  );
  const policy = readFileSync(
    "src/components/admin/mfa-policy-panel.tsx",
    "utf8",
  );
  const profile = readFileSync(
    "src/app/(member)/academy/profile/page.tsx",
    "utf8",
  );
  const settings = readFileSync(
    "src/app/(admin)/admin/settings/page.tsx",
    "utf8",
  );

  for (const source of [account, policy]) {
    assert.match(source, /locale: AppLocale/);
    assert.match(source, /getMfaCopy\(locale\)/);
    assert.doesNotMatch(
      source,
      /Multi-Faktor-Authentifizierung|Privilegierte Konten|MFA deaktivieren|Policy speichern|SSO erneut bestaetigen/,
    );
  }
  assert.match(profile, /<MfaSecurityPanel[\s\S]{0,250}?locale=\{locale\}/);
  assert.match(settings, /<MfaPolicyPanel[\s\S]{0,300}?locale=\{locale\}/);
});
