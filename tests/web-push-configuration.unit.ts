import assert from "node:assert/strict";
import test from "node:test";
import webPush from "web-push";

import {
  resolveWebPushConfiguration,
  WebPushConfigurationError,
} from "../src/lib/push/configuration";

function configuredEnvironment() {
  const keys = webPush.generateVAPIDKeys();
  return {
    WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
    WEB_PUSH_VAPID_SUBJECT: "mailto:push@q-academy.de",
  };
}

test("web push stays disabled when an optional environment is empty", () => {
  assert.equal(
    resolveWebPushConfiguration({}, { required: false, production: false }),
    null,
  );
});

test("web push accepts a matching P-256 VAPID pair", () => {
  const environment = configuredEnvironment();
  assert.deepEqual(
    resolveWebPushConfiguration(environment, {
      required: true,
      production: true,
    }),
    {
      publicKey: environment.WEB_PUSH_VAPID_PUBLIC_KEY,
      privateKey: environment.WEB_PUSH_VAPID_PRIVATE_KEY,
      subject: environment.WEB_PUSH_VAPID_SUBJECT,
    },
  );
});

test("web push rejects partial or mismatched VAPID credentials", () => {
  assert.throws(
    () =>
      resolveWebPushConfiguration(
        { WEB_PUSH_VAPID_SUBJECT: "mailto:push@q-academy.de" },
        { required: false, production: false },
      ),
    WebPushConfigurationError,
  );

  const environment = configuredEnvironment();
  const other = webPush.generateVAPIDKeys();
  assert.throws(
    () =>
      resolveWebPushConfiguration(
        { ...environment, WEB_PUSH_VAPID_PUBLIC_KEY: other.publicKey },
        { required: true, production: true },
      ),
    /does not match the private key/,
  );
});

test("web push rejects non-canonical and invalid P-256 key material", () => {
  const environment = configuredEnvironment();

  assert.throws(
    () =>
      resolveWebPushConfiguration(
        {
          ...environment,
          WEB_PUSH_VAPID_PUBLIC_KEY: `${environment.WEB_PUSH_VAPID_PUBLIC_KEY}=`,
        },
        { required: true, production: true },
      ),
    /must be unpadded URL-safe base64/,
  );

  assert.throws(
    () =>
      resolveWebPushConfiguration(
        {
          ...environment,
          WEB_PUSH_VAPID_PRIVATE_KEY: Buffer.alloc(32).toString("base64url"),
        },
        { required: true, production: true },
      ),
    /not a valid P-256 private key/,
  );
});

test("production web push rejects reserved VAPID contacts", () => {
  assert.throws(
    () =>
      resolveWebPushConfiguration(
        {
          ...configuredEnvironment(),
          WEB_PUSH_VAPID_SUBJECT: "mailto:push@example.com",
        },
        { required: true, production: true },
      ),
    /must not use a local or reserved domain/,
  );

  assert.throws(
    () =>
      resolveWebPushConfiguration(
        {
          ...configuredEnvironment(),
          WEB_PUSH_VAPID_SUBJECT: "https://user:secret@push.q-academy.de/contact",
        },
        { required: true, production: true },
      ),
    /must be an HTTPS or mailto URI/,
  );
});
