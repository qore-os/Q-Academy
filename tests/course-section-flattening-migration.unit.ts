import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0082_flatten_course_sections.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);

test("section flattening migration preserves restrictive access semantics", () => {
  assert.match(
    migration,
    /CREATE TEMPORARY TABLE "q_academy_section_flatten_snapshot_backup"/,
  );
  assert.match(
    migration,
    /CREATE TEMPORARY TABLE "q_academy_section_flatten_lesson_backup"/,
  );
  assert.match(
    migration,
    /WHEN "lesson"\."status" = 'archived' OR "section_lesson"\."section_status" = 'archived' THEN 'archived'/,
  );
  assert.match(
    migration,
    /WHEN "lesson"\."visibility" = 'draft' OR "section_lesson"\."section_visibility" = 'draft' THEN 'draft'/,
  );
  assert.match(
    migration,
    /greatest\("lesson"\."drip_days", "section_lesson"\."section_drip_days"\)/,
  );
  assert.match(
    migration,
    /"section_lesson"\."published_section_lesson_order" > 1/,
  );
  assert.match(
    migration,
    /PARTITION BY "lesson"\."module_id"\s+ORDER BY "lesson"\."sort_order", "lesson"\."id"/,
  );
  assert.doesNotMatch(
    migration,
    /CASE WHEN "lesson"\."section_id" IS NULL THEN 1 ELSE 0 END/,
  );
  assert.match(
    migration,
    /count\(\*\) FILTER \([\s\S]*"lesson"\."visibility" <> 'draft'[\s\S]*ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/,
  );
});

test("section flattening migration fails closed and rewrites stored snapshots", () => {
  const destructiveAlter = migration.indexOf(
    'ALTER TABLE "lessons" ADD COLUMN "unlock_after_previous"',
  );
  const liveInterleavingGuard = migration.indexOf(
    "cannot flatten course sections losslessly",
  );
  const snapshotInterleavingGuard = migration.indexOf(
    "cannot flatten course version % module % losslessly",
  );
  assert.ok(liveInterleavingGuard >= 0);
  assert.ok(snapshotInterleavingGuard >= 0);
  assert.ok(destructiveAlter > liveInterleavingGuard);
  assert.ok(destructiveAlter > snapshotInterleavingGuard);
  assert.match(
    migration,
    /HAVING count\(\*\) > 1\s+AND max\("lesson"\."visible_order"\) - min\("lesson"\."visible_order"\) \+ 1 <> count\(\*\)/,
  );
  assert.match(migration, /snapshot must be an object/);
  assert.match(migration, /unsupported snapshot schema version/);
  assert.match(migration, /snapshot has an invalid course owner/);
  assert.ok(
    migration.includes(
      'SELECT "id", "course_id", "organization_id", "snapshot", "published_at"',
    ),
  );
  assert.ok(migration.includes('"version_row"."published_at" IS NULL'));
  assert.ok(
    migration.includes(
      `jsonb_typeof("version_row"."snapshot" #> '{course,firstPublishedAt}') IS NOT DISTINCT FROM 'null'`,
    ),
  );
  assert.match(migration, /duplicate lesson id/);
  assert.match(migration, /'schemaVersion', 6/);
  assert.match(migration, /'accessPolicyVersion', 2/);
  assert.match(migration, /'moduleKindVersion', 1/);
  assert.match(migration, /'courseOutlineVersion', 1/);
  assert.match(migration, /'widgets', CASE/);
  assert.match(migration, /ELSE 'learning'/);
  assert.match(migration, /ELSE 'locked'/);
  assert.match(migration, /ELSE 'available'/);
  assert.match(
    migration,
    /ORDER BY "raw_lesson"\."lesson_sort_order", "raw_lesson"\."lesson_id"/,
  );
  assert.doesNotMatch(migration, /"raw_lesson"\."collection_order"/);
  assert.match(
    migration,
    /"module_entry"\."item"[\s\S]*- 'sections'[\s\S]*- 'lessons'/,
  );
  assert.match(
    migration,
    /"ordered_lesson"\."item"[\s\S]*- 'sectionId'[\s\S]*- 'organizationId'/,
  );
  assert.match(migration, /flattening changed the lesson identity set/);
  assert.match(migration, /DROP TABLE "module_sections"/);
  assert.match(migration, /ALTER TABLE "lessons" DROP COLUMN "section_id"/);
});

test("canonical schema exposes lesson-native release fields without sections", () => {
  assert.doesNotMatch(schema, /export const moduleSections = pgTable/);
  assert.doesNotMatch(schema, /sectionId: uuid\("section_id"\)/);
  assert.match(
    schema,
    /unlockAfterPrevious: boolean\("unlock_after_previous"\)/,
  );
  assert.match(
    schema,
    /dripDays: integer\("drip_days"\)\.default\(0\)\.notNull\(\)/,
  );
  assert.match(schema, /"lessons_drip_days_check"/);
  assert.match(schema, /schemaVersion: 6/);
  assert.match(schema, /accessPolicyVersion: 2/);
});
