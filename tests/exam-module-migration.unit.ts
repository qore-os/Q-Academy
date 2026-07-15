import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(process.cwd(), "drizzle/0029_icy_thunderball.sql"),
  "utf8",
);
const shapeGuardMigration = readFileSync(
  path.resolve(process.cwd(), "drizzle/0030_exam_module_shape_guards.sql"),
  "utf8",
);

test("0029 uses the conservative deterministic pure-exam backfill", () => {
  assert.match(migration, /UPDATE "modules" SET "kind" = 'learning'/);
  assert.match(migration, /"lesson"\."type" = 'exam'/);
  assert.match(migration, /"lesson"\."section_id" IS NULL/);
  assert.match(migration, /NOT EXISTS \([\s\S]*FROM "lessons" AS "other_lesson"/);
  assert.match(migration, /NOT EXISTS \([\s\S]*FROM "module_sections" AS "section"/);
  assert.match(migration, /"block"\."type" IN/);
});

test("0030 enforces the exam shape at deferred transaction commit", () => {
  assert.match(shapeGuardMigration, /q_academy_assert_exam_module_shape/);
  assert.match(
    shapeGuardMigration,
    /count\(\*\) FILTER \([\s\S]*"type" = 'exam'/,
  );
  assert.match(shapeGuardMigration, /DEFERRABLE INITIALLY DEFERRED/g);
  assert.match(shapeGuardMigration, /modules_exam_shape_check/);
  assert.match(shapeGuardMigration, /lessons_exam_shape_check/);
  assert.match(shapeGuardMigration, /module_sections_exam_shape_check/);
});
