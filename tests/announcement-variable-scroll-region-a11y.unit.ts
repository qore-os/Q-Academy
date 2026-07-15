import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAnnouncementCopy } from "@/lib/i18n/announcements";
import { SUPPORTED_LOCALES } from "@/lib/i18n/model";

test("announcement variables expose one named keyboard-scrollable region", () => {
  const source = readFileSync(
    "src/components/admin/announcement-block-editor.tsx",
    "utf8",
  );
  const regions = source.match(/max-h-24/g) ?? [];
  assert.equal(regions.length, 1);

  const tag = source.match(
    /<div\s+className="focus-ring mt-2 flex max-h-24 flex-wrap gap-1\.5 overflow-y-auto"[\s\S]*?>/,
  )?.[0];
  assert.ok(tag, "announcement variable scroll region is missing");
  assert.match(tag, /role="region"/);
  assert.match(tag, /aria-label=\{copy\.variablesRegion\}/);
  assert.match(tag, /tabIndex=\{0\}/);
});

test("announcement variable scroll region name is localized", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(
      getAnnouncementCopy(locale).blocks.variablesRegion.trim().length > 0,
    );
  }
});
