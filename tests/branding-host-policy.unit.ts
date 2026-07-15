import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeConfiguredHostname,
  publicAppUrlHostname,
  resolveCanonicalAppHostname,
} from "../src/lib/branding-host-policy";

test("canonical app hostname requires exact agreement between domain and public URL", () => {
  assert.deepEqual(
    resolveCanonicalAppHostname({
      appDomain: "ACADEMY.q-academy.de.",
      publicAppUrl: "https://academy.q-academy.de",
    }),
    { status: "resolved", hostname: "academy.q-academy.de" },
  );
  assert.deepEqual(
    resolveCanonicalAppHostname({
      appDomain: "academy.q-academy.de",
      publicAppUrl: "https://login.q-academy.de",
    }),
    { status: "invalid", hostname: null },
  );
});

test("canonical app hostname fails closed on malformed configured values", () => {
  for (const appDomain of [
    "https://academy.q-academy.de",
    "academy.q-academy.de:443",
    "*.q-academy.de",
    "academy.q-academy.de/path",
  ]) {
    assert.deepEqual(
      resolveCanonicalAppHostname({
        appDomain,
        publicAppUrl: "https://academy.q-academy.de",
      }),
      { status: "invalid", hostname: null },
      appDomain,
    );
  }
  assert.equal(
    publicAppUrlHostname("https://academy.q-academy.de/login"),
    null,
  );
  assert.equal(normalizeConfiguredHostname("academy..q-academy.de"), null);
});

test("public URL remains the development fallback when APP_DOMAIN is absent", () => {
  assert.deepEqual(
    resolveCanonicalAppHostname({
      publicAppUrl: "http://localhost:3000",
    }),
    { status: "resolved", hostname: "localhost" },
  );
  assert.deepEqual(resolveCanonicalAppHostname({}), {
    status: "unconfigured",
    hostname: null,
  });
});
