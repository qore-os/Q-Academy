import assert from "node:assert/strict";
import test from "node:test";

import { resolvePlaywrightDatabaseResetTarget } from "../scripts/ci/reset-playwright-database";

const validEnvironment = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  POSTGRES_ADMIN_URL:
    "postgresql://postgres:admin-password@127.0.0.1:54329/postgres",
  DATABASE_URL:
    "postgresql://q_academy_ci:owner-password@127.0.0.1:54329/q_academy",
  PLAYWRIGHT_RESET_EXPECTED_DATABASE: "q_academy",
  PLAYWRIGHT_RESET_EXPECTED_OWNER: "q_academy_ci",
};

test("Playwright database reset accepts only an exact loopback CI target", () => {
  const resolved = resolvePlaywrightDatabaseResetTarget(validEnvironment);
  assert.equal(resolved.databaseName, "q_academy");
  assert.equal(resolved.ownerRole, "q_academy_ci");

  for (const environment of [
    { ...validEnvironment, CI: "false" },
    { ...validEnvironment, GITHUB_ACTIONS: "false" },
    {
      ...validEnvironment,
      DATABASE_URL:
        "postgresql://q_academy_ci:owner-password@db.example.test:54329/q_academy",
    },
    {
      ...validEnvironment,
      DATABASE_URL:
        "postgresql://q_academy_ci:owner-password@127.0.0.1:54329/q_academy_other",
    },
    {
      ...validEnvironment,
      DATABASE_URL:
        "postgresql://wrong_owner:owner-password@127.0.0.1:54329/q_academy",
    },
    {
      ...validEnvironment,
      POSTGRES_ADMIN_URL:
        "postgresql://postgres:admin-password@127.0.0.1:54329/q_academy",
    },
  ]) {
    assert.throws(() => resolvePlaywrightDatabaseResetTarget(environment));
  }
});
