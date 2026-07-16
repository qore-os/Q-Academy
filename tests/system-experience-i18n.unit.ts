import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getSystemExperienceCopy,
  resolveDataFormMessage,
  resolveOidcSettingsMessage,
} from "../src/lib/i18n/system-experience";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") {
    result.set(prefix, value);
  } else if (typeof value === "function") {
    result.set(prefix, String(value("Test field", true)));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("system experience copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getSystemExperienceCopy("de"));
  assert.ok(german.size >= 45, `expected at least 45 leaves, got ${german.size}`);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getSystemExperienceCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 39, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("structured action codes resolve without exposing raw server messages", () => {
  assert.equal(
    resolveDataFormMessage("en", { messageCode: "saved" }),
    "Your details were saved.",
  );
  assert.equal(
    resolveDataFormMessage("fr", {
      messageCode: "invalid_field",
      fieldLabel: "Department",
      required: true,
    }),
    'Verifiez la valeur de "Department" (obligatoire).',
  );
  assert.equal(
    resolveOidcSettingsMessage("it", "saved"),
    "L'accesso aziendale e stato verificato e salvato.",
  );
});

test("embedded forms propagate locale and render only catalogued system copy", () => {
  const form = readFileSync(
    "src/components/academy/embedded-data-form.tsx",
    "utf8",
  );
  const lesson = readFileSync(
    "src/components/academy/lesson-content.tsx",
    "utf8",
  );
  const hub = readFileSync(
    "src/app/(member)/academy/hub/page.tsx",
    "utf8",
  );

  assert.match(lesson, /<EmbeddedDataForm[\s\S]{0,250}?locale=\{locale\}/);
  assert.match(hub, /<EmbeddedDataForm[\s\S]{0,250}?locale=\{locale\}/);
  assert.doesNotMatch(form, />Ja</);
  assert.doesNotMatch(form, /Bitte auswaehlen/);
  assert.doesNotMatch(form, /Kein passendes Datenprofil/);
  assert.doesNotMatch(form, />\{result\.message\}</);
  assert.doesNotMatch(form, />\{state\.message\}</);
  assert.match(
    form,
    /role="status"[\s\S]{0,250}?aria-live="polite"[\s\S]{0,250}?aria-busy="true"[\s\S]{0,250}?aria-hidden="true"[\s\S]{0,250}?\{copy\.loading\}/,
  );
  assert.doesNotMatch(form, /aria-label=\{copy\.loading\}/);
});

test("OIDC settings use message codes and localized UI feedback", () => {
  const form = readFileSync(
    "src/components/admin/oidc-settings-form.tsx",
    "utf8",
  );
  const actions = readFileSync("src/lib/oidc-actions.ts", "utf8");

  assert.match(form, /locale: AppLocale/);
  assert.match(form, /resolveOidcSettingsMessage\(locale, state\.messageCode\)/);
  assert.doesNotMatch(form, />\{state\.error\}</);
  assert.doesNotMatch(form, />\{state\.success\}</);
  for (const code of [
    "invalid_version",
    "invalid_configuration",
    "configuration_changed",
    "provider_changes_require_password_login",
    "owner_sso_required",
    "step_up_invalid_password",
    "step_up_rate_limited",
    "step_up_reauthentication_required",
    "step_up_mfa_required",
    "step_up_mfa_invalid",
    "provider_rejected",
    "saved",
    "disabled",
    "unchanged",
    "save_failed",
  ]) {
    assert.ok(actions.includes(`"${code}"`), `missing OIDC message code ${code}`);
  }
  assert.ok((actions.match(/messageCode:/g) ?? []).length >= 6);
});

test("navigation no longer overrides localized labels", () => {
  const shell = readFileSync(
    "src/components/layout/navigation-shell.tsx",
    "utf8",
  );
  assert.doesNotMatch(shell, /\? "Rollen & Rechte"/);
  assert.doesNotMatch(shell, />Links</);
  assert.doesNotMatch(shell, /\? "AI Tools" : label/);
});
