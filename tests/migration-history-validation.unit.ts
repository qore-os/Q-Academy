import assert from "node:assert/strict";
import test from "node:test";
import { assertCompatibleMigrationHistory } from "../src/lib/migration-history-validation";

const expected = [
  { tag: "0000_first", hash: "a".repeat(64), createdAt: 1000 },
  { tag: "0001_second", hash: "b".repeat(64), createdAt: 2000 },
  { tag: "0002_pending", hash: "c".repeat(64), createdAt: 3000 },
] as const;

test("migration history accepts a valid applied prefix and pending migrations", () => {
  assert.doesNotThrow(() =>
    assertCompatibleMigrationHistory(expected, [
      { hash: "a".repeat(64), createdAt: "1000" },
      { hash: "b".repeat(64), createdAt: BigInt(2000) },
    ]),
  );
});

test("migration history accepts newer database entries for app rollback", () => {
  assert.doesNotThrow(() =>
    assertCompatibleMigrationHistory(expected.slice(0, 2), [
      { hash: "a".repeat(64), createdAt: 1000 },
      { hash: "b".repeat(64), createdAt: 2000 },
      { hash: "future".padEnd(64, "f"), createdAt: 4000 },
    ]),
  );
});

test("migration history rejects changed bytes for an applied migration", () => {
  assert.throws(
    () =>
      assertCompatibleMigrationHistory(expected, [
        { hash: "a".repeat(64), createdAt: 1000 },
        { hash: "changed".padEnd(64, "0"), createdAt: 2000 },
      ]),
    /0001_second[\s\S]*expects SHA-256[\s\S]*database records[\s\S]*Do not edit drizzle\.__drizzle_migrations/,
  );
});

test("migration history rejects gaps below the latest applied migration", () => {
  assert.throws(
    () =>
      assertCompatibleMigrationHistory(expected, [
        { hash: "a".repeat(64), createdAt: 1000 },
        { hash: "c".repeat(64), createdAt: 3000 },
      ]),
    /missing 0001_second[\s\S]*below its latest applied migration/,
  );
});

test("migration history rejects divergent and duplicate timestamps", () => {
  assert.throws(
    () =>
      assertCompatibleMigrationHistory(expected, [
        { hash: "a".repeat(64), createdAt: 1500 },
      ]),
    /1500 is not in the release journal/,
  );
  assert.throws(
    () =>
      assertCompatibleMigrationHistory(expected, [
        { hash: "a".repeat(64), createdAt: 1000 },
        { hash: "a".repeat(64), createdAt: "1000" },
      ]),
    /repeats migration timestamp 1000/,
  );
});
