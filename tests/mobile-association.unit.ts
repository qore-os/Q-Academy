import assert from "node:assert/strict";
import test from "node:test";

import {
  androidAssetLinks,
  appleAppSiteAssociation,
  mobileAssociationConfiguration,
} from "../src/lib/mobile/association";

test("mobile association files fail closed and bind the native application", () => {
  assert.deepEqual(mobileAssociationConfiguration({}), {
    appleAppId: null,
    androidPackageName: "com.qacademy.mobile",
    androidCertificateFingerprints: [],
    urlScheme: "qacademy",
  });
  const fingerprint = Array.from({ length: 32 }, () => "AA").join(":");
  const configuration = mobileAssociationConfiguration({
    APPLE_TEAM_ID: "a1b2c3d4e5",
    MOBILE_APP_BUNDLE_ID: "com.qacademy.mobile",
    ANDROID_APP_SHA256_CERT_FINGERPRINTS: `${fingerprint},invalid`,
    MOBILE_APP_URL_SCHEME: "customer-academy",
  });
  assert.equal(configuration.appleAppId, "A1B2C3D4E5.com.qacademy.mobile");
  assert.deepEqual(configuration.androidCertificateFingerprints, [fingerprint]);
  assert.equal(configuration.urlScheme, "customer-academy");
  assert.deepEqual(
    androidAssetLinks("com.qacademy.mobile", [fingerprint])[0]?.target,
    {
      namespace: "android_app",
      package_name: "com.qacademy.mobile",
      sha256_cert_fingerprints: [fingerprint],
    },
  );
  assert.deepEqual(
    appleAppSiteAssociation(configuration.appleAppId!).applinks.details[0]
      ?.components.map((entry) => entry["/"]),
    ["/academy", "/academy/*", "/login", "/login/*"],
  );
});
