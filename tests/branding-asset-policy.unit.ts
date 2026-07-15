import assert from "node:assert/strict";
import test from "node:test";

import {
  brandLogoSource,
  safeBrandFaviconSource,
  safeLegacyBrandAssetSource,
  safePublicBrandImageSource,
  safePublicBrandPreviewSource,
} from "@/lib/branding-asset-policy";

test("new branding images stay on strict public same-origin paths", () => {
  assert.equal(
    safePublicBrandImageSource(" /images/branding/logo-light.svg "),
    "/images/branding/logo-light.svg",
  );
  assert.equal(
    safePublicBrandPreviewSource("/images/branding/link-preview.webp"),
    "/images/branding/link-preview.webp",
  );
  assert.equal(safeBrandFaviconSource("/favicon.ico"), "/favicon.ico");

  for (const source of [
    "https://cdn.example.test/logo.svg",
    "https://user:secret@example.test/logo.svg",
    "//cdn.example.test/logo.svg",
    "/images/../private/logo.svg",
    "/images/%2e%2e/private/logo.svg",
    "/images/branding/logo.svg?version=2",
    "/api/media-assets/10000000-0000-4000-8000-000000000001/download",
  ]) {
    assert.equal(safePublicBrandImageSource(source), null, source);
  }
  assert.equal(
    safePublicBrandPreviewSource("/images/branding/link-preview.svg"),
    null,
  );
});

test("legacy branding remains compatible without accepting credentials", () => {
  assert.equal(
    safeLegacyBrandAssetSource("https://cdn.example.test/logo.png"),
    "https://cdn.example.test/logo.png",
  );
  assert.equal(
    safeLegacyBrandAssetSource(
      "https://user:secret@cdn.example.test/logo.png",
    ),
    null,
  );
  assert.equal(
    safeLegacyBrandAssetSource("javascript:alert(1)"),
    null,
  );
});

test("logo variants resolve per surface with stable legacy fallback", () => {
  const variants = {
    logoUrl: "https://cdn.example.test/legacy.png",
    logoLightUrl: "/images/branding/light.svg",
    logoDarkUrl: "/images/branding/dark.svg",
  };
  assert.equal(
    brandLogoSource(variants, "light"),
    "/images/branding/light.svg",
  );
  assert.equal(
    brandLogoSource(variants, "dark"),
    "/images/branding/dark.svg",
  );
  assert.equal(
    brandLogoSource(
      { logoUrl: variants.logoUrl, logoLightUrl: null, logoDarkUrl: null },
      "light",
    ),
    variants.logoUrl,
  );
});
