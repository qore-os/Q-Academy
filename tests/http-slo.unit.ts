import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateHttpSlo,
  summarizeHttpSloSamples,
} from "../src/lib/operations/http-slo";
import { validateHttpSloCliArguments } from "../src/lib/operations/http-slo-cli";

test("HTTP SLO CLI rejects unknown, incomplete, positional, and duplicate options", () => {
  assert.throws(
    () => validateHttpSloCliArguments(["--min-request", "200"]),
    /Unknown HTTP SLO option/,
  );
  assert.throws(
    () => validateHttpSloCliArguments(["--origin"]),
    /requires a value/,
  );
  assert.throws(
    () => validateHttpSloCliArguments(["localhost"]),
    /Unexpected positional argument/,
  );
  assert.throws(
    () =>
      validateHttpSloCliArguments([
        "--origin",
        "http://127.0.0.1:3000",
        "--origin",
        "http://127.0.0.1:3001",
      ]),
    /may only be provided once/,
  );
  assert.doesNotThrow(() =>
    validateHttpSloCliArguments([
      "--origin",
      "http://127.0.0.1:3000",
      "--confirm-origin",
      "http://127.0.0.1:3000",
      "--path",
      "/api/v1/health/live",
      "--path",
      "/api/v1/health/ready",
      "--api-probe",
      "true",
    ]),
  );
  assert.throws(
    () => validateHttpSloCliArguments(["--api-key", "secret"]),
    /Unknown HTTP SLO option/,
  );
});

test("HTTP SLO summaries use nearest-rank percentiles and endpoint splits", () => {
  const samples = Array.from({ length: 20 }, (_, index) => ({
    path: index % 2 ? "/ready" : "/live",
    latencyMs: index + 1,
    ok: index !== 19,
    status: index === 19 ? 503 : 200,
  }));
  const summary = summarizeHttpSloSamples(samples, 2_000);
  assert.equal(summary.requests, 20);
  assert.equal(summary.failed, 1);
  assert.equal(summary.errorRate, 0.05);
  assert.equal(summary.requestsPerSecond, 10);
  assert.equal(summary.p50Ms, 10);
  assert.equal(summary.p95Ms, 19);
  assert.equal(summary.p99Ms, 20);
  assert.equal(summary.byPath["/live"]?.requests, 10);
  assert.equal(summary.statusCounts["503"], 1);
});

test("HTTP SLO evaluation reports every violated release threshold", () => {
  const summary = summarizeHttpSloSamples(
    [{ path: "/ready", latencyMs: 800, ok: false, status: null }],
    1_000,
  );
  const result = evaluateHttpSlo(summary, {
    maxErrorRate: 0,
    maxP95Ms: 500,
    minRequests: 20,
  });
  assert.equal(result.passed, false);
  assert.equal(result.failures.length, 3);
});
