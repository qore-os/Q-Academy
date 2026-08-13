import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(
    process.cwd(),
    "drizzle/0069_privacy_processing_claim_invariant.sql",
  ),
  "utf8",
);
const schema = readFileSync(
  path.resolve(process.cwd(), "src/db/schema.ts"),
  "utf8",
);
const snapshot = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "drizzle/meta/0069_snapshot.json"),
    "utf8",
  ),
) as {
  tables: Record<
    string,
    { checkConstraints: Record<string, { value: string }> }
  >;
};
const journal = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string }> };

function position(fragment: string) {
  const value = migration.indexOf(fragment);
  assert.ok(value >= 0, `Missing migration fragment: ${fragment}`);
  return value;
}

test("0069 repairs incomplete processing claims before enforcing the invariant", () => {
  const lockTable = position(
    'LOCK TABLE "privacy_requests" IN SHARE ROW EXCLUSIVE MODE',
  );
  const dropConstraint = position(
    'DROP CONSTRAINT "privacy_requests_processing_claim_check"',
  );
  const failBuildingArtifacts = position(
    'UPDATE "privacy_export_artifacts" AS "artifact"',
  );
  const failInvalidProcessing = position('UPDATE "privacy_requests"\nSET\n\t"status" = \'failed\'');
  const clearNonProcessingClaims = position(
    'WHERE "status" <> \'processing\'',
  );
  const addConstraint = position(
    'ADD CONSTRAINT "privacy_requests_processing_claim_check"',
  );
  const validateConstraint = position(
    'VALIDATE CONSTRAINT "privacy_requests_processing_claim_check"',
  );

  assert.ok(lockTable < failBuildingArtifacts);
  assert.ok(failBuildingArtifacts < failInvalidProcessing);
  assert.ok(failInvalidProcessing < clearNonProcessingClaims);
  assert.ok(clearNonProcessingClaims < dropConstraint);
  assert.ok(dropConstraint < addConstraint);
  assert.ok(addConstraint < validateConstraint);
  assert.match(migration, /processing_claim_invariant_migration/);
  assert.match(migration, /"updated_at" = clock_timestamp\(\)/);
  assert.match(migration, /\) NOT VALID;/);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});

test("schema and generated snapshot require claim fields exactly for processing", () => {
  const invariant =
    snapshot.tables["public.privacy_requests"].checkConstraints[
      "privacy_requests_processing_claim_check"
    ].value;

  for (const source of [schema, invariant]) {
    assert.match(source, /status[^\n]+processing/);
    assert.match(source, /processing_claim_token|processingClaimToken/);
    assert.match(source, /processing_claimed_at|processingClaimedAt/);
    assert.match(source, /processing_lease_expires_at|processingLeaseExpiresAt/);
    assert.match(source, /status[^\n]+<>[^\n]+processing/);
  }
  assert.match(
    invariant,
    /processing_lease_expires_at" > "privacy_requests"\."processing_claimed_at/,
  );
});

test("0069 remains immutable while later migrations append to the journal", () => {
  assert.deepEqual(journal.entries[69], {
    idx: 69,
    version: "7",
    when: 1783993824500,
    tag: "0069_privacy_processing_claim_invariant",
    breakpoints: true,
  });
  assert.deepEqual(journal.entries.at(-1), {
    idx: 82,
    version: "7",
    when: 1786632153991,
    tag: "0082_flatten_course_sections",
    breakpoints: true,
  });
});
