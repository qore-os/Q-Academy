import assert from "node:assert/strict";
import test from "node:test";

import {
  brandingCssVariables,
  colorContrast,
  DEFAULT_TENANT_BRANDING,
} from "../src/lib/branding-model";

test("tenant brand controls choose the higher-contrast foreground", () => {
  const teal = brandingCssVariables(DEFAULT_TENANT_BRANDING) as Record<
    string,
    string
  >;
  assert.equal(teal["--brand-accent-foreground"], "#0f263c");
  assert.ok(
    colorContrast(
      DEFAULT_TENANT_BRANDING.accentColor,
      teal["--brand-accent-foreground"],
    ) >= 4.5,
  );

  const dark = brandingCssVariables({
    ...DEFAULT_TENANT_BRANDING,
    accentColor: "#102030",
  }) as Record<string, string>;
  assert.equal(dark["--brand-accent-foreground"], "#ffffff");
  assert.ok(colorContrast("#102030", dark["--brand-accent-foreground"]) >= 4.5);
});

test("contrast calculation follows WCAG luminance examples", () => {
  assert.equal(colorContrast("#000000", "#ffffff"), 21);
  assert.ok(colorContrast("#777777", "#ffffff") >= 4.47);
});
