import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getSettingsAdminCopy } from "../src/lib/i18n/settings-admin";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("branding binding failures expose a specific localized action code", () => {
  const actions = readFileSync("src/lib/actions.ts", "utf8");
  const updateDesign = actions.slice(
    actions.indexOf("export async function updateDesignAction"),
  );

  assert.match(
    updateDesign,
    /error instanceof BrandingMediaBindingError[\s\S]*settingsMessageCode: "designAssetUnavailable"/,
  );
  assert.match(
    updateDesign,
    /error instanceof ApiError[\s\S]*settingsMessageCode: "designAssetInvalid"/,
  );

  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(
      getSettingsAdminCopy(locale).messages.designAssetUnavailable.trim().length > 0,
      `${locale} must localize unavailable branding media`,
    );
  }
  assert.equal(
    getSettingsAdminCopy("de").messages.designAssetUnavailable,
    "Das Branding-Bild ist nicht geprueft oder gehoert zu einer anderen Academy.",
  );
});
