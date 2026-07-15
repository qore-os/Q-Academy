import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { nativePushDeviceInputSchema } from "../src/lib/push/native-devices";
import { resolveNativePushProviderConfiguration } from "../src/lib/push/native-provider-config";

test("native push provider configuration is all-or-nothing", () => {
  assert.deepEqual(resolveNativePushProviderConfiguration({}), {
    android: null,
    ios: null,
  });
  assert.throws(
    () => resolveNativePushProviderConfiguration({ FCM_PROJECT_ID: "academy-demo" }),
    /incomplete/i,
  );
  const configured = resolveNativePushProviderConfiguration({
    FCM_PROJECT_ID: "academy-demo",
    FCM_SERVICE_ACCOUNT_CLIENT_EMAIL: "push@academy-demo.iam.gserviceaccount.com",
    FCM_SERVICE_ACCOUNT_PRIVATE_KEY: "private-key",
    APNS_TEAM_ID: "A1B2C3D4E5",
    APNS_KEY_ID: "F6G7H8J9K0",
    APNS_PRIVATE_KEY: "line-one\\nline-two",
    APNS_BUNDLE_ID: "com.qacademy.mobile",
    APNS_PRODUCTION: "true",
  });
  assert.equal(configured.android?.projectId, "academy-demo");
  assert.equal(configured.ios?.privateKey, "line-one\nline-two");
  assert.equal(configured.ios?.production, true);
});

test("native device tokens are platform-specific and bounded", () => {
  assert.equal(
    nativePushDeviceInputSchema.safeParse({
      platform: "ios",
      appId: "com.qacademy.mobile",
      token: "a".repeat(64),
    }).success,
    true,
  );
  assert.equal(
    nativePushDeviceInputSchema.safeParse({
      platform: "android",
      appId: "com.qacademy.mobile",
      token: `fcm:${"A".repeat(120)}`,
    }).success,
    true,
  );
  assert.equal(
    nativePushDeviceInputSchema.safeParse({
      platform: "ios",
      appId: "com.qacademy.mobile",
      token: "not-an-apns-token",
    }).success,
    false,
  );
  assert.equal(
    nativePushDeviceInputSchema.safeParse({
      platform: "android",
      appId: "com.qacademy.mobile",
      token: "token with spaces and secrets",
    }).success,
    false,
  );
});

test("FCM expires tokens only for an explicit unregistered response", () => {
  const provider = readFileSync(
    path.resolve(process.cwd(), "src/lib/push/native-provider.ts"),
    "utf8",
  );
  assert.match(
    provider,
    /UNREGISTERED\|registration-token-not-registered/,
  );
  assert.match(provider, /unregistered \? 410 : response\.status/);
  assert.doesNotMatch(provider, /\[404,\s*410\]/);
});
