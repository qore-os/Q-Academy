import assert from "node:assert/strict";
import test from "node:test";
import { assertUtf8DatabaseEncoding } from "../src/lib/database-encoding";
import { evaluateMigrationReadiness } from "../src/lib/schema-readiness-validation";

test("database readiness accepts only PostgreSQL UTF8 encoding", () => {
  assert.equal(assertUtf8DatabaseEncoding("UTF8"), "UTF8");
  assert.throws(
    () => assertUtf8DatabaseEncoding("WIN1252"),
    /server_encoding must be UTF8.*WIN1252/,
  );
  assert.throws(
    () => assertUtf8DatabaseEncoding(undefined),
    /server_encoding must be UTF8.*unknown/,
  );
});

test("schema readiness accepts the exact expected migration set", () => {
  assert.deepEqual(
    evaluateMigrationReadiness(["a", "b"], ["a", "b"]),
    {
      current: true,
      expectedMigrations: 2,
      appliedMigrations: 2,
      missingMigrations: 0,
    },
  );
});

test("schema readiness accepts a database superset for app-only rollback", () => {
  assert.deepEqual(
    evaluateMigrationReadiness(["a", "b"], ["a", "b", "c"]),
    {
      current: true,
      expectedMigrations: 2,
      appliedMigrations: 3,
      missingMigrations: 0,
    },
  );
});

test("schema readiness rejects missing expected hashes despite extra migrations", () => {
  assert.deepEqual(
    evaluateMigrationReadiness(["a", "b"], ["a", "c", "d"]),
    {
      current: false,
      expectedMigrations: 2,
      appliedMigrations: 3,
      missingMigrations: 1,
    },
  );
});
