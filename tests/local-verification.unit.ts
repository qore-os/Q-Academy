import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createLocalVerificationEvidence,
  createLocalVerificationPlan,
  parseLocalVerificationArguments,
} from "../src/lib/operations/local-verification";

test("package scripts expose the dedicated verification contracts", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.equal(packageJson.scripts["test:load"], "tsx scripts/load-test.ts");
  assert.equal(
    packageJson.scripts["test:accessibility"],
    "playwright test tests/accessibility-smoke.spec.ts --project=chromium",
  );
  assert.equal(packageJson.scripts["verify:local"], "tsx scripts/verify-local.ts");
  assert.equal(packageJson.scripts["db:check"], "drizzle-kit check");
});

test("local verification uses a deterministic core order", () => {
  const options = parseLocalVerificationArguments([]);
  const plan = createLocalVerificationPlan(options);
  assert.deepEqual(
    plan.map((step) => step.id),
    [
      "secret-scan",
      "third-party-notices",
      "database-schema-contract",
      "openapi-contract",
      "connector-contract",
      "unit-tests",
      "typecheck",
      "lint",
    ],
  );
  assert.ok(plan.every((step) => step.npmScript && !step.operation));
});

test("long and accessibility gates are explicit and not duplicated", () => {
  const accessibilityOnly = createLocalVerificationPlan(
    parseLocalVerificationArguments(["--accessibility", "true"]),
  );
  assert.equal(
    accessibilityOnly.filter((step) => step.id === "accessibility").length,
    1,
  );
  const long = createLocalVerificationPlan(
    parseLocalVerificationArguments([
      "--long",
      "true",
      "--accessibility",
      "true",
    ]),
  );
  assert.equal(long.filter((step) => step.id === "accessibility").length, 1);
  assert.equal(long.at(-1)?.id, "production-build");
});

test("external verification is allowlisted, acknowledged, and deduplicated", () => {
  assert.throws(
    () =>
      parseLocalVerificationArguments([
        "--external-gate",
        "ai-provider",
      ]),
    /require --ack-external/,
  );
  assert.throws(
    () =>
      parseLocalVerificationArguments([
        "--external-gate",
        "arbitrary-shell",
        "--ack-external",
        "EXTERNAL_GATES",
      ]),
    /must be one of/,
  );
  const options = parseLocalVerificationArguments([
    "--external-gate",
    "dependency-audit",
    "--external-gate",
    "dependency-audit",
    "--ack-external",
    "EXTERNAL_GATES",
    "--dry-run",
    "true",
  ]);
  assert.deepEqual(options.externalGates, ["dependency-audit"]);
  const external = createLocalVerificationPlan(options).at(-1);
  assert.deepEqual(external, {
    id: "external:dependency-audit",
    operation: "dependency-audit",
  });
});

test("local verification rejects unknown, incomplete, positional, and duplicate options", () => {
  assert.throws(
    () => parseLocalVerificationArguments(["--everything", "true"]),
    /Unknown local verification option/,
  );
  assert.throws(
    () => parseLocalVerificationArguments(["--long"]),
    /requires a value/,
  );
  assert.throws(
    () => parseLocalVerificationArguments(["release-now"]),
    /Unexpected positional argument/,
  );
  assert.throws(
    () =>
      parseLocalVerificationArguments([
        "--long",
        "true",
        "--long",
        "false",
      ]),
    /may only be provided once/,
  );
  assert.throws(
    () => parseLocalVerificationArguments(["--long", "yes"]),
    /must be true or false/,
  );
});

test("local verification evidence contains only public plan data", () => {
  const report = createLocalVerificationEvidence({
    startedAt: "2026-07-14T00:00:00.000Z",
    endedAt: "2026-07-14T00:00:01.000Z",
    options: {
      long: false,
      accessibility: false,
      dryRun: false,
      externalGates: ["ai-provider"],
    },
    steps: [
      {
        id: "external:ai-provider",
        status: "failed",
        durationMs: 1,
        exitCode: 1,
        failureCode: "command_failed",
      },
    ],
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /api[_-]?key|password|authorization|cookie|AI_API_KEY/i,
  );
  assert.equal(report.evaluation.passed, false);
  assert.equal(report.evaluation.failedStep, "external:ai-provider");
});
