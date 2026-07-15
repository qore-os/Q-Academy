import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PRIVACY_DATA_INVENTORY } from "../src/lib/privacy/data-inventory";

test("learning-time sessions have explicit export, erasure and hold policy", () => {
  const policy = PRIVACY_DATA_INVENTORY.lesson_learning_time_sessions;
  assert.equal(policy.subjectRelation.kind, "direct");
  assert.deepEqual(policy.subjectRelation.columns, ["user_id"]);
  assert.equal(policy.exportPolicy.mode, "sanitized");
  assert.deepEqual(policy.exportPolicy.excludedColumns, ["last_sequence"]);
  assert.equal(policy.erasurePolicy.action, "delete_or_pseudonymize");
  assert.ok(policy.legalHold.scopes.includes("learning"));
});

test("member erasure and DSAR explicitly handle measured learning time", () => {
  const erasure = readFileSync(
    "src/lib/privacy/erasure-executor.ts",
    "utf8",
  );
  const exportScript = readFileSync("scripts/export-user-data.ts", "utf8");
  const retention = readFileSync("docs/DATA_RETENTION_AND_DSAR.md", "utf8");
  const learningTimeExport = exportScript.slice(
    exportScript.indexOf("const lessonLearningTime = await tx"),
    exportScript.indexOf("const mediaPlaybackProgress = await tx"),
  );
  assert.match(
    erasure,
    /delete from lesson_learning_time_sessions where organization_id = \$\{organizationId\} and user_id = \$\{subjectUserId\}/,
  );
  assert.match(exportScript, /const lessonLearningTime = await tx/);
  assert.match(learningTimeExport, /course_version_id as "courseVersionId"/);
  assert.match(learningTimeExport, /s\.lesson_title as "lessonTitle"/);
  assert.match(learningTimeExport, /active_seconds as "activeSeconds"/);
  assert.doesNotMatch(learningTimeExport, /join lessons/i);
  assert.match(retention, /serverseitig gemessene aktive Lernzeit/);
  assert.match(retention, /Keine automatische Loeschung ohne Kunden-\/Nachweis-Policy/);
});
