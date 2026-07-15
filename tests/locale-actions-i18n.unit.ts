import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("language action messages exist in every supported locale", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getCoreDictionary(locale).language;
    for (const key of [
      "profileSaved",
      "organizationSaved",
      "invalidLocale",
      "profileUnavailable",
      "organizationUnavailable",
    ] as const) {
      assert.ok(copy[key].length > 0, `${locale}.${key} must not be empty`);
    }
  }
});

test("locale actions return codes and the client maps them through copy", () => {
  const actions = readFileSync("src/lib/locale-actions.ts", "utf8");
  const panel = readFileSync(
    "src/components/shared/locale-settings-panel.tsx",
    "utf8",
  );

  for (const code of [
    "profileSaved",
    "organizationSaved",
    "invalidLocale",
    "profileUnavailable",
    "organizationUnavailable",
  ]) {
    assert.match(actions, new RegExp(`code: "${code}"`));
  }
  assert.match(panel, /\{copy\[state\.code\]\}/);
  assert.doesNotMatch(panel, /\{state\.message\}/);
  assert.doesNotMatch(actions, /return \{ ok: false, message:/);
});
