import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExpectedFixtureRecords,
  assertGitHubActionsEnvironment,
  generateProductionSmokePassword,
  productionSmokeFixtures,
} from "../scripts/ci/production-smoke-credentials";

const validRecords = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    email: productionSmokeFixtures[0].email,
    role: productionSmokeFixtures[0].role,
    status: "active",
    organizationSlug: "q-academy",
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    email: productionSmokeFixtures[1].email,
    role: productionSmokeFixtures[1].role,
    status: "active",
    organizationSlug: "q-academy",
  },
];

test("production-smoke credentials require the GitHub Actions environment", () => {
  assert.doesNotThrow(() =>
    assertGitHubActionsEnvironment({
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_ENV: "/tmp/github-env",
    }),
  );
  assert.throws(
    () =>
      assertGitHubActionsEnvironment({
        CI: "true",
        GITHUB_ACTIONS: "false",
        GITHUB_ENV: "/tmp/github-env",
      }),
    /restricted to GitHub Actions CI/,
  );
  assert.throws(
    () =>
      assertGitHubActionsEnvironment({ CI: "true", GITHUB_ACTIONS: "true" }),
    /GITHUB_ENV is required/,
  );
});

test("production-smoke credentials pin exactly both active seed fixtures", () => {
  assert.doesNotThrow(() => assertExpectedFixtureRecords(validRecords));
  assert.throws(
    () => assertExpectedFixtureRecords(validRecords.slice(0, 1)),
    /exactly two/,
  );
  assert.throws(
    () =>
      assertExpectedFixtureRecords([
        validRecords[0],
        { ...validRecords[1], role: "admin" },
      ]),
    /active role and organization contract/,
  );
  assert.throws(
    () =>
      assertExpectedFixtureRecords([
        validRecords[0],
        { ...validRecords[1], status: "disabled" },
      ]),
    /active role and organization contract/,
  );
});

test("production-smoke passwords are strong, URL-safe, and ephemeral", () => {
  const first = generateProductionSmokePassword();
  const second = generateProductionSmokePassword();

  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
  assert.notEqual(first, "Demo123!");
  assert.notEqual(first, second);
});
