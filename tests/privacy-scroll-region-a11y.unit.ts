import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPrivacyAdminCopy } from "@/lib/i18n/privacy-admin";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

test("privacy table exposes one named keyboard-scrollable region", () => {
  const source = readFileSync(
    "src/components/admin/privacy-request-manager.tsx",
    "utf8",
  );
  const regions = source.match(/overflow-x-auto/g) ?? [];
  assert.equal(regions.length, 1);

  const tag = source.match(
    /<div\s+className="focus-ring overflow-x-auto"[\s\S]*?>/,
  )?.[0];
  assert.ok(tag, "privacy table scroll region is missing");
  assert.match(tag, /role="region"/);
  assert.match(tag, /aria-label=\{copy\.manager\.tableRegion\}/);
  assert.match(tag, /tabIndex=\{0\}/);
});

test("privacy table region name is localized", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(getPrivacyAdminCopy(locale).manager.tableRegion.trim().length > 0);
  }
});
