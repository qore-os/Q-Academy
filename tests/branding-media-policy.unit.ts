import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BRANDING_MEDIA_ASSET_FIELDS,
  brandingMediaAssetField,
  brandingMediaPath,
  isBrandingMediaMimeAllowed,
  isBrandingMediaSlot,
} from "@/lib/branding-media-policy";

test("branding media slots expose stable same-origin routes", () => {
  assert.equal(brandingMediaPath("logo-light"), "/api/tenant-branding/assets/logo-light");
  assert.equal(brandingMediaAssetField("favicon"), "faviconAssetId");
  assert.equal(BRANDING_MEDIA_ASSET_FIELDS.loginBackgroundAssetId, "login-background");
  assert.equal(isBrandingMediaSlot("social-preview"), true);
  assert.equal(isBrandingMediaSlot("../foreign"), false);
});

test("only renderable raster branding media is accepted outside the favicon slot", () => {
  for (const mimeType of ["image/jpeg", "image/png", "image/webp", "image/avif"]) {
    assert.equal(isBrandingMediaMimeAllowed("logo", mimeType), true);
    assert.equal(isBrandingMediaMimeAllowed("login-background", mimeType), true);
  }
  assert.equal(isBrandingMediaMimeAllowed("logo", "image/vnd.microsoft.icon"), false);
  assert.equal(isBrandingMediaMimeAllowed("favicon", "image/vnd.microsoft.icon"), true);
  assert.equal(isBrandingMediaMimeAllowed("social-preview", "image/svg+xml"), false);
  assert.equal(isBrandingMediaMimeAllowed("logo-dark", "text/html"), false);
});

test("profile and branding binding paths enforce ready tenant media", () => {
  const profile = readFileSync("src/lib/profile-actions.ts", "utf8");
  const design = readFileSync("src/lib/actions.ts", "utf8");
  const publicRoute = readFileSync(
    "src/app/api/tenant-branding/assets/[slot]/route.ts",
    "utf8",
  );
  const organizationRoute = readFileSync(
    "src/app/api/v1/organization/route.ts",
    "utf8",
  );
  const session = readFileSync("src/lib/media/session-service.ts", "utf8");

  assert.match(profile, /eq\(mediaAssets\.organizationId, actor\.organizationId\)/);
  assert.match(profile, /eq\(mediaAssets\.ownerUserId, actor\.id\)/);
  assert.match(profile, /eq\(mediaAssets\.status, "ready"\)/);
  assert.match(design, /assertReadyBrandingMediaAssets/);
  assert.match(publicRoute, /getPublicBrandingMediaAsset\(request\.headers, slot\)/);
  assert.match(organizationRoute, /managedImageSources/);
  assert.match(organizationRoute, /assertReadyBrandingMediaAssets/);
  assert.match(session, /Ein verwendetes Profilbild kann nicht entfernt werden/);
  assert.match(session, /Ein verwendetes Branding-Bild kann nicht entfernt werden/);
});
