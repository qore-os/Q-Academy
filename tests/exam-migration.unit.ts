import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0040_flippant_magus.sql", import.meta.url),
  "utf8",
);

test("0040 upgrades legacy attempts before enforcing lifecycle uniqueness", () => {
  const legacyBackfill = migration.indexOf('UPDATE "assessment_attempts"');
  const tenantUnique = migration.indexOf(
    'CREATE UNIQUE INDEX "assessment_attempts_id_org_idx"',
  );
  const answerTenantFk = migration.indexOf(
    'ADD CONSTRAINT "assessment_answers_attempt_tenant_fk"',
  );
  const oneActive = migration.indexOf(
    'CREATE UNIQUE INDEX "assessment_attempts_one_active_idx"',
  );
  assert.ok(legacyBackfill >= 0);
  assert.ok(legacyBackfill < oneActive);
  assert.ok(tenantUnique < answerTenantFk);
  assert.match(migration, /"finalization_reason" = 'administrator'/);
  assert.match(migration, /"result_released_at" = coalesce/);
});

test("0040 adds worker-oriented partial deadline indexes", () => {
  assert.match(migration, /assessment_attempts_active_deadline_idx/);
  assert.match(migration, /assessment_attempts_result_release_deadline_idx/);
  assert.match(migration, /"deadline_at","id"/);
  assert.match(migration, /result_release_mode.*after_deadline/);
});
