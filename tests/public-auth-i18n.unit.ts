import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAuthPageCopy } from "../src/lib/i18n/auth-pages";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("public authentication copy is complete for every supported locale", () => {
  const referenceKeys = Object.keys(getAuthPageCopy("de")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getAuthPageCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), referenceKeys);
    assert.ok(copy.forgotTitle.length > 0);
    assert.ok(copy.resetTitle.length > 0);
    assert.ok(copy.invitationTitle.length > 0);
    assert.ok(getCoreDictionary(locale).auth.heroImageAlt.length > 0);
  }
});

test("public authentication routes generate localized metadata", () => {
  const routes = [
    "src/app/login/page.tsx",
    "src/app/login/mfa/page.tsx",
    "src/app/password/forgot/page.tsx",
    "src/app/password/reset/page.tsx",
    "src/app/invitations/[token]/page.tsx",
  ];

  for (const route of routes) {
    const source = readFileSync(route, "utf8");
    assert.match(source, /export async function generateMetadata/);
    assert.doesNotMatch(source, /export const metadata\s*=/);
  }

  const login = readFileSync(routes[0], "utf8");
  assert.match(login, /alt=\{copy\.heroImageAlt\}/);
  assert.doesNotMatch(login, /alt="Modulares KI-Workflow-System"/);
});
