import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectMobileReleasePreflightErrors } from "../src/lib/mobile/release-preflight";
import {
  parseIosReleaseXcconfig,
  renderIosReleaseXcconfig,
} from "../src/lib/mobile/ios-build-settings";

const fingerprint = Array.from({ length: 32 }, () => "AA").join(":");
const privateKey = `${["-----BEGIN", "PRIVATE KEY-----"].join(" ")}\nYWNhZGVteQ==\n${["-----END", "PRIVATE KEY-----"].join(" ")}`;
const environment = {
  CAPACITOR_SERVER_URL: "https://academy.example.test",
  MOBILE_APP_NAME: "Customer Academy",
  MOBILE_ASSOCIATED_DOMAIN: "academy.example.test",
  MOBILE_APP_BUNDLE_ID: "com.customer.academy",
  MOBILE_APP_URL_SCHEME: "customer-academy",
  MOBILE_BUILD_NUMBER: "17",
  MOBILE_VERSION: "2.3.1",
  APPLE_TEAM_ID: "A1B2C3D4E5",
  ANDROID_APP_SHA256_CERT_FINGERPRINTS: fingerprint,
  FCM_PROJECT_ID: "academy-demo",
  FCM_SERVICE_ACCOUNT_CLIENT_EMAIL:
    "push@academy-demo.iam.gserviceaccount.com",
  FCM_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey,
  ANDROID_KEYSTORE_PATH: "release.keystore",
  ANDROID_KEY_ALIAS: "release",
  ANDROID_KEYSTORE_PASSWORD: "secret",
  ANDROID_KEY_PASSWORD: "secret",
  APNS_TEAM_ID: "A1B2C3D4E5",
  APNS_KEY_ID: "F6G7H8J9K0",
  APNS_PRIVATE_KEY: privateKey,
  APNS_BUNDLE_ID: "com.customer.academy",
  APNS_PRODUCTION: "true",
};
const files = {
  "capacitor.config.ts": readFileSync("capacitor.config.ts", "utf8"),
  "android/app/src/main/AndroidManifest.xml": readFileSync(
    "android/app/src/main/AndroidManifest.xml",
    "utf8",
  ),
  "android/app/build.gradle": readFileSync(
    "android/app/build.gradle",
    "utf8",
  ),
  "android/app/google-services.json": JSON.stringify({
    project_info: { project_id: "academy-demo" },
    client: [
      {
        client_info: {
          android_client_info: { package_name: "com.customer.academy" },
        },
      },
    ],
  }),
  "ios/App/App/App.entitlements": readFileSync(
    "ios/App/App/App.entitlements",
    "utf8",
  ),
  "ios/App/App/Info.plist": readFileSync("ios/App/App/Info.plist", "utf8"),
  "ios/App/App/PrivacyInfo.xcprivacy": readFileSync(
    "ios/App/App/PrivacyInfo.xcprivacy",
    "utf8",
  ),
  "ios/App/App.xcodeproj/project.pbxproj": readFileSync(
    "ios/App/App.xcodeproj/project.pbxproj",
    "utf8",
  ),
  "ios/release.xcconfig": renderIosReleaseXcconfig(environment),
};

test("native release preflight cross-checks both store projects", () => {
  assert.deepEqual(
    parseIosReleaseXcconfig(renderIosReleaseXcconfig(environment)),
    {
      MOBILE_APP_NAME: environment.MOBILE_APP_NAME,
      MOBILE_APP_BUNDLE_ID: environment.MOBILE_APP_BUNDLE_ID,
      MOBILE_APP_URL_SCHEME: environment.MOBILE_APP_URL_SCHEME,
      ACADEMY_ASSOCIATED_DOMAIN: environment.MOBILE_ASSOCIATED_DOMAIN,
      CURRENT_PROJECT_VERSION: environment.MOBILE_BUILD_NUMBER,
      MARKETING_VERSION: environment.MOBILE_VERSION,
      DEVELOPMENT_TEAM: environment.APPLE_TEAM_ID,
      APS_ENVIRONMENT: "production",
    },
  );
  assert.deepEqual(
    collectMobileReleasePreflightErrors(environment, files, "all"),
    [],
  );
});

test("platform release preflights require only their own provider credentials", () => {
  assert.deepEqual(
    collectMobileReleasePreflightErrors(
      {
        ...environment,
        APPLE_TEAM_ID: undefined,
        APNS_TEAM_ID: undefined,
        APNS_KEY_ID: undefined,
        APNS_PRIVATE_KEY: undefined,
        APNS_BUNDLE_ID: undefined,
        APNS_PRODUCTION: undefined,
      },
      files,
      "android",
    ),
    [],
  );
  assert.deepEqual(
    collectMobileReleasePreflightErrors(
      {
        ...environment,
        ANDROID_APP_SHA256_CERT_FINGERPRINTS: undefined,
        FCM_PROJECT_ID: undefined,
        FCM_SERVICE_ACCOUNT_CLIENT_EMAIL: undefined,
        FCM_SERVICE_ACCOUNT_PRIVATE_KEY: undefined,
        ANDROID_KEYSTORE_PATH: undefined,
        ANDROID_KEY_ALIAS: undefined,
        ANDROID_KEYSTORE_PASSWORD: undefined,
        ANDROID_KEY_PASSWORD: undefined,
      },
      { ...files, "android/app/google-services.json": undefined },
      "ios",
    ),
    [],
  );
});

test("native release preflight fails closed on identity drift", () => {
  const errors = collectMobileReleasePreflightErrors(
    {
      ...environment,
      APNS_BUNDLE_ID: "com.foreign.app",
      MOBILE_APP_NAME: "<invalid>",
      MOBILE_ASSOCIATED_DOMAIN: "foreign.example.test",
      APNS_PRODUCTION: "false",
      FCM_SERVICE_ACCOUNT_CLIENT_EMAIL:
        "push@foreign-project.iam.gserviceaccount.com",
    },
    {
      ...files,
      "android/app/google-services.json": JSON.stringify({
        project_info: { project_id: "foreign-project" },
        client: [],
      }),
      "ios/release.xcconfig": renderIosReleaseXcconfig({
        ...environment,
        MOBILE_APP_NAME: "Stale Academy",
      }),
    },
    "all",
  );
  assert.ok(errors.some((error) => error.includes("CAPACITOR_SERVER_URL hostname")));
  assert.ok(errors.some((error) => error.includes("APNS_BUNDLE_ID")));
  assert.ok(errors.some((error) => error.includes("MOBILE_APP_NAME")));
  assert.ok(errors.some((error) => error.includes("APNS_PRODUCTION")));
  assert.ok(errors.some((error) => error.includes("google-services.json project_id")));
  assert.ok(errors.some((error) => error.includes("must belong to FCM_PROJECT_ID")));
  assert.ok(errors.some((error) => error.includes("ios/release.xcconfig MOBILE_APP_NAME")));
});
