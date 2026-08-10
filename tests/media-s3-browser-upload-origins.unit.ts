import assert from "node:assert/strict";
import test from "node:test";

import {
  assertS3BrowserUploadOriginAllowed,
  normalizeS3BrowserUploadOrigins,
  resolveS3BrowserUploadOriginInventory,
  S3BrowserUploadOriginInventoryError,
} from "../src/lib/media/s3-browser-upload-origins";

const PLATFORM_ORIGIN = "https://academy.example.test";
const TENANT_ORIGIN = "https://tenant.tenants.example.test";
const CUSTOM_ORIGIN = "https://lernen.customer.test";

test("browser upload origin inventory includes platform and default tenant origins", () => {
  const origins = resolveS3BrowserUploadOriginInventory({
    NEXT_PUBLIC_APP_URL: PLATFORM_ORIGIN,
    DEFAULT_ORGANIZATION_SLUG: "tenant",
    TENANT_BASE_DOMAIN: "tenants.example.test",
    MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON: JSON.stringify([
      PLATFORM_ORIGIN,
      TENANT_ORIGIN,
      CUSTOM_ORIGIN,
    ]),
  });
  assert.deepEqual(origins, [PLATFORM_ORIGIN, TENANT_ORIGIN, CUSTOM_ORIGIN]);
  assert.doesNotThrow(() =>
    assertS3BrowserUploadOriginAllowed(
      {
        NEXT_PUBLIC_APP_URL: PLATFORM_ORIGIN,
        MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON: JSON.stringify([
          PLATFORM_ORIGIN,
          CUSTOM_ORIGIN,
        ]),
      },
      CUSTOM_ORIGIN,
    ),
  );
});

test("browser upload origin inventory supports a single-domain deployment", () => {
  assert.deepEqual(normalizeS3BrowserUploadOrigins([PLATFORM_ORIGIN]), [
    PLATFORM_ORIGIN,
  ]);
});

test("browser upload origin inventory rejects missing derived and custom origins", () => {
  assert.throws(
    () =>
      resolveS3BrowserUploadOriginInventory({
        NEXT_PUBLIC_APP_URL: PLATFORM_ORIGIN,
        DEFAULT_ORGANIZATION_SLUG: "tenant",
        TENANT_BASE_DOMAIN: "tenants.example.test",
        MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON: JSON.stringify([
          PLATFORM_ORIGIN,
          CUSTOM_ORIGIN,
        ]),
      }),
    /tenant\.tenants\.example\.test/,
  );
  assert.throws(
    () =>
      assertS3BrowserUploadOriginAllowed(
        {
          NEXT_PUBLIC_APP_URL: PLATFORM_ORIGIN,
          MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON: JSON.stringify([
            PLATFORM_ORIGIN,
            TENANT_ORIGIN,
          ]),
        },
        CUSTOM_ORIGIN,
      ),
    /not present/,
  );
});

test("browser upload origins must be canonical wildcard-free HTTPS origins", () => {
  for (const invalid of [
    "http://academy.example.test",
    "https://*.example.test",
    "https://academy.example.test/",
    "https://academy.example.test:8443",
  ]) {
    assert.throws(
      () => normalizeS3BrowserUploadOrigins([invalid, TENANT_ORIGIN]),
      S3BrowserUploadOriginInventoryError,
      invalid,
    );
  }
  assert.throws(
    () =>
      normalizeS3BrowserUploadOrigins([PLATFORM_ORIGIN, PLATFORM_ORIGIN]),
    /duplicates/,
  );
});
