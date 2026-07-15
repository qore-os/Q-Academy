import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getLogoCopy, logoDictionaries } from "../src/lib/i18n/logo";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("logo copy has typed DE/EN/IT/ES/FR parity", () => {
  const keys = Object.keys(logoDictionaries.de);
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(logoDictionaries[locale]), keys);
    assert.ok(getLogoCopy(locale).home("Q Academy").length > 8);
    assert.ok(getLogoCopy(locale).logoAlt("Q Academy").length > 8);
    assert.ok(getLogoCopy(locale).tagline.length > 4);
  }
  assert.equal(getLogoCopy("en").home("Q Academy"), "Q Academy home");
  assert.equal(getLogoCopy("fr").tagline, "Espace d'apprentissage");
});

test("logo renders localized accessibility and visible copy", () => {
  const logo = readFileSync("src/components/ui/logo.tsx", "utf8");
  assert.match(logo, /getLogoCopy\(locale\)/);
  assert.match(logo, /aria-label=\{copy\.home\(branding\.platformName\)\}/);
  assert.match(logo, /alt=\{copy\.logoAlt\(branding\.platformName\)\}/);
  assert.match(logo, /\{copy\.tagline\}/);
  assert.match(logo, /locale: AppLocale/);
  assert.doesNotMatch(logo, /locale\?:|DEFAULT_LOCALE/);
  assert.doesNotMatch(logo, /Startseite|Learning Hub/);
});

test("all logo call sites pass the resolved locale", () => {
  for (const file of [
    "src/app/login/page.tsx",
    "src/app/invitations/[token]/page.tsx",
    "src/app/password/forgot/page.tsx",
    "src/app/password/reset/page.tsx",
    "src/app/login/mfa/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<Logo[\s\S]{0,180}?locale=\{/u, file);
  }

  const navigation = readFileSync(
    "src/components/layout/navigation-shell.tsx",
    "utf8",
  );
  assert.equal(
    (navigation.match(/<Logo[\s\S]{0,180}?locale=\{locale\}/gu) ?? []).length,
    2,
  );
});
