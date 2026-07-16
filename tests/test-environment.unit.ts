import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  requiredTestEnvironmentValue,
  testEnvironmentValue,
} from "./helpers/test-environment";

test("test environment values prefer process.env and tolerate a missing .env", () => {
  const originalDirectory = process.cwd();
  const originalValue = process.env.Q_ACADEMY_TEST_ENVIRONMENT_VALUE;
  const directory = mkdtempSync(join(tmpdir(), "q-academy-test-env-"));

  try {
    process.chdir(directory);
    process.env.Q_ACADEMY_TEST_ENVIRONMENT_VALUE = "from-process";
    writeFileSync(
      join(directory, ".env"),
      "Q_ACADEMY_TEST_ENVIRONMENT_VALUE=from-file\n",
      "utf8",
    );
    assert.equal(
      testEnvironmentValue("Q_ACADEMY_TEST_ENVIRONMENT_VALUE"),
      "from-process",
    );
    assert.equal(
      requiredTestEnvironmentValue("Q_ACADEMY_TEST_ENVIRONMENT_VALUE"),
      "from-process",
    );

    delete process.env.Q_ACADEMY_TEST_ENVIRONMENT_VALUE;
    assert.equal(
      testEnvironmentValue("Q_ACADEMY_TEST_ENVIRONMENT_VALUE"),
      "from-file",
    );

    rmSync(join(directory, ".env"));
    assert.equal(
      testEnvironmentValue("Q_ACADEMY_TEST_ENVIRONMENT_VALUE"),
      undefined,
    );
    assert.throws(
      () => requiredTestEnvironmentValue("Q_ACADEMY_TEST_ENVIRONMENT_VALUE"),
      /Q_ACADEMY_TEST_ENVIRONMENT_VALUE is required by this test/,
    );
  } finally {
    process.chdir(originalDirectory);
    if (originalValue === undefined) {
      delete process.env.Q_ACADEMY_TEST_ENVIRONMENT_VALUE;
    } else {
      process.env.Q_ACADEMY_TEST_ENVIRONMENT_VALUE = originalValue;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
