import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getHubActionMessage,
  hubActionDictionaries,
} from "../src/lib/i18n/hub-actions";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("hub action messages have complete five-locale parity", () => {
  const germanKeys = Object.keys(hubActionDictionaries.de);
  assert.ok(germanKeys.length >= 30);

  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(hubActionDictionaries[locale]), germanKeys);
    for (const code of germanKeys) {
      const message = getHubActionMessage(
        locale,
        code as keyof typeof hubActionDictionaries.de,
      );
      if (code === "idle") assert.equal(message, "");
      else assert.ok(message.trim().length > 0, `${locale}.${code} is empty`);
    }
  }
});

test("hub mutations expose stable codes and the editor resolves failures locally", () => {
  const actions = readFileSync("src/lib/hub-actions.ts", "utf8");
  const editor = readFileSync("src/components/admin/hub-editor.tsx", "utf8");

  assert.match(actions, /code: HubActionCode/);
  assert.doesNotMatch(actions, /return\s*\{[^\n]*message\s*:/);
  assert.doesNotMatch(actions, /return\s+actionResult\([^\n]*[ÄÖÜäöüß]/u);
  assert.match(editor, /getHubActionMessage\(locale, result\.code\)/);
  assert.doesNotMatch(editor, /toast\.error\(result\.message\)/);
});
