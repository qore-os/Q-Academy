import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeLoadTestOrigin,
  createLoadTestEvidence,
  evaluateLoadTest,
  normalizeLoadTestOrigin,
  normalizeMemberCoursePath,
  normalizeUuidOption,
  resolveLoadTestScenarios,
  summarizeLoadTestSamples,
  validateLoadTestCliArguments,
  type LoadTestPrerequisites,
} from "../src/lib/operations/load-test";

const noPrerequisites: LoadTestPrerequisites = {
  hasMemberCredentials: false,
  hasAdminCredentials: false,
  hasApiKey: false,
  hasCoursePath: false,
  hasProgressIds: false,
  hasJobSecret: false,
  jobMutationAcknowledged: false,
};

test("load-test CLI is allowlisted and rejects missing or duplicate values", () => {
  assert.throws(
    () => validateLoadTestCliArguments(["--api-key", "secret"]),
    /Unknown load-test option/,
  );
  assert.throws(
    () => validateLoadTestCliArguments(["--origin"]),
    /requires a value/,
  );
  assert.throws(
    () =>
      validateLoadTestCliArguments([
        "--origin",
        "http://localhost:3000",
        "--origin",
        "http://localhost:3001",
      ]),
    /may only be provided once/,
  );
  assert.throws(
    () => validateLoadTestCliArguments(["--scenario", "delete-everything"]),
    /must be one of/,
  );
  assert.doesNotThrow(() =>
    validateLoadTestCliArguments([
      "--origin",
      "http://localhost:3000",
      "--confirm-origin",
      "http://localhost:3000",
      "--scenario",
      "health",
      "--scenario",
      "api",
      "--require",
      "true",
    ]),
  );
});

test("load-test origins allow loopback and explicit remote staging only", () => {
  assert.equal(
    normalizeLoadTestOrigin("http://127.0.0.1:3000", "--origin"),
    "http://127.0.0.1:3000",
  );
  assert.doesNotThrow(() => assertSafeLoadTestOrigin("http://localhost:3000"));
  assert.doesNotThrow(() =>
    assertSafeLoadTestOrigin("https://academy.staging.example.com"),
  );
  assert.throws(
    () => assertSafeLoadTestOrigin("http://academy.staging.example.com"),
    /must use HTTPS/,
  );
  assert.throws(
    () => assertSafeLoadTestOrigin("https://academy.example.com"),
    /explicit staging/,
  );
  assert.throws(
    () => normalizeLoadTestOrigin("https://user:pass@example.test/path", "--origin"),
    /without credentials or a path/,
  );
});

test("dynamic load-test paths are constrained to learner routes and UUIDs", () => {
  assert.equal(
    normalizeMemberCoursePath("/academy/courses/security-basics"),
    "/academy/courses/security-basics",
  );
  assert.equal(
    normalizeMemberCoursePath(
      "/academy/courses/security-basics/learn/123e4567-e89b-42d3-a456-426614174000",
    ),
    "/academy/courses/security-basics/learn/123e4567-e89b-42d3-a456-426614174000",
  );
  assert.throws(
    () => normalizeMemberCoursePath("/admin/courses/delete?all=true"),
    /must be a course or lesson path/,
  );
  assert.equal(
    normalizeUuidOption(
      "123e4567-e89b-42d3-a456-426614174000",
      "--progress-member-id",
    ),
    "123e4567-e89b-42d3-a456-426614174000",
  );
  assert.throws(
    () => normalizeUuidOption("not-an-id", "--progress-member-id"),
    /valid UUID/,
  );
});

test("scenario resolution skips unavailable probes and fails closed with require", () => {
  const optional = resolveLoadTestScenarios({
    requested: ["health", "api", "job"],
    prerequisites: noPrerequisites,
    requireAll: false,
  });
  assert.deepEqual(optional.selected, ["health"]);
  assert.deepEqual(optional.skipped, [
    { scenario: "api", reason: "api_key_file_missing" },
    { scenario: "job", reason: "job_secret_file_missing" },
  ]);
  assert.throws(
    () =>
      resolveLoadTestScenarios({
        requested: ["health", "progress"],
        prerequisites: noPrerequisites,
        requireAll: true,
      }),
    /Required load-test scenarios are not configured/,
  );
});

test("browser scenarios explicitly include their login dependency", () => {
  const resolution = resolveLoadTestScenarios({
    requested: ["admin"],
    prerequisites: { ...noPrerequisites, hasAdminCredentials: true },
    requireAll: true,
  });
  assert.deepEqual(resolution.requested, ["login", "admin"]);
  assert.deepEqual(resolution.selected, ["login", "admin"]);
});

test("load summaries and evidence enforce overall and per-scenario thresholds without secrets", () => {
  const summary = summarizeLoadTestSamples(
    [
      { scenario: "health", latencyMs: 20, ok: true, status: 200 },
      {
        scenario: "api",
        latencyMs: 800,
        ok: false,
        status: 503,
        failureCode: "http_error",
      },
    ],
    1_000,
  );
  const thresholds = { maxErrorRate: 0, maxP95Ms: 500, minRequests: 3 };
  const evaluation = evaluateLoadTest(summary, thresholds, ["health", "api"]);
  assert.equal(evaluation.passed, false);
  assert.ok(evaluation.failures.some((failure) => failure.startsWith("api:")));
  const evidence = createLoadTestEvidence({
    startedAt: "2026-07-14T00:00:00.000Z",
    endedAt: "2026-07-14T00:00:01.000Z",
    origin: "https://academy.staging.example.com",
    vus: 2,
    durationSeconds: 1,
    maxRequests: 10,
    timeoutMs: 1_000,
    requireAll: true,
    resolution: {
      requested: ["health", "api"],
      selected: ["health", "api"],
      skipped: [],
    },
    jobEnabled: false,
    thresholds,
    summary,
    evaluation,
  });
  const serialized = JSON.stringify(evidence);
  assert.doesNotMatch(serialized, /password|apiKey|cookie|authorization/i);
  assert.equal(evidence.kind, "q-academy-load-test-evidence");
});
