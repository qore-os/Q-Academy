import assert from "node:assert/strict";
import test from "node:test";

import {
  isQAcademyHealthPayload,
  isQAcademyReadyPayload,
  normalizeTestBaseUrl,
  selectIntegrationTestFiles,
} from "../scripts/run-integration-tests";

test("integration runner accepts only credential-free HTTP origins", () => {
  assert.equal(normalizeTestBaseUrl("http://127.0.0.1:3000/"), "http://127.0.0.1:3000");
  assert.equal(normalizeTestBaseUrl("https://academy.example.test"), "https://academy.example.test");
  assert.throws(() => normalizeTestBaseUrl("file:///tmp/server"), /http or https/);
  assert.throws(() => normalizeTestBaseUrl("https://user:secret@example.test"), /credentials/);
  assert.throws(() => normalizeTestBaseUrl("https://example.test/api"), /without a path/);
  assert.throws(() => normalizeTestBaseUrl("https://example.test/?tenant=a"), /without a path/);
});

test("integration runner recognizes only Q-Academy health envelopes", () => {
  assert.equal(
    isQAcademyHealthPayload({ data: { service: "q-academy-api", status: "ok" } }),
    true,
  );
  assert.equal(
    isQAcademyHealthPayload({ data: { service: "q-academy-api", status: "ready" } }),
    false,
  );
  assert.equal(isQAcademyHealthPayload({ data: { service: "other", status: "ok" } }), false);
  assert.equal(isQAcademyHealthPayload({ data: { service: "q-academy-api", status: "degraded" } }), false);
  assert.equal(isQAcademyHealthPayload(null), false);

  assert.equal(
    isQAcademyReadyPayload({
      data: { status: "ready", database: "connected", schema: "current" },
    }),
    true,
  );
  assert.equal(
    isQAcademyReadyPayload({
      data: { status: "ready", database: "connected", schema: "outdated" },
    }),
    false,
  );
});

test("integration runner selects deterministic integration test files", () => {
  assert.deepEqual(
    selectIntegrationTestFiles([
      "z.integration.ts",
      "helper.ts",
      "a.integration.ts",
      "ignored.integration.ts.bak",
    ]),
    ["a.integration.ts", "z.integration.ts"],
  );
});
