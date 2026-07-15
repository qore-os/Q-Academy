import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const migration = readFileSync(
  path.resolve(process.cwd(), "drizzle/0056_local_parity_completion.sql"),
  "utf8",
);

function position(fragment: string) {
  const value = migration.indexOf(fragment);
  assert.ok(value >= 0, `Missing migration fragment: ${fragment}`);
  return value;
}

test("0056 backfills immutable learning snapshots before enforcing them", () => {
  const nullableVersion = position('ADD COLUMN "course_version_id" uuid;');
  const backfill = position('WITH "resolved_learning_sessions" AS');
  const guard = position("0056 cannot bind % legacy learning-time session");
  const versionNotNull = position(
    'ALTER COLUMN "course_version_id" SET NOT NULL',
  );
  const liveLessonDrop = position(
    'DROP CONSTRAINT "lesson_learning_time_sessions_lesson_tenant_fk"',
  );
  const versionForeignKey = position(
    'ADD CONSTRAINT "lesson_learning_time_sessions_version_scope_fk"',
  );

  assert.ok(nullableVersion < backfill);
  assert.ok(backfill < guard);
  assert.ok(guard < versionNotNull);
  assert.ok(versionNotNull < liveLessonDrop);
  assert.ok(liveLessonDrop < versionForeignKey);
  assert.match(migration, /lesson_node\."lesson" ->> 'title'/);
});

test("0056 binds push capabilities to active login-session lifecycle", () => {
  const revokeLegacy = position(
    'DELETE FROM "public"."web_push_subscriptions"',
  );
  const sessionColumn = position('ADD COLUMN "session_id" uuid NOT NULL');
  const sessionKey = position(
    'CREATE UNIQUE INDEX "user_sessions_id_user_org_idx"',
  );
  const sessionForeignKey = position(
    'ADD CONSTRAINT "web_push_subscriptions_session_user_tenant_fk"',
  );
  const revocationTrigger = position(
    'CREATE TRIGGER "user_sessions_purge_web_push_on_revocation_trigger"',
  );

  assert.ok(revokeLegacy < sessionColumn);
  assert.ok(sessionColumn < sessionKey);
  assert.ok(sessionKey < sessionForeignKey);
  assert.ok(sessionForeignKey < revocationTrigger);
  assert.match(migration, /OLD\."revoked_at" IS NULL AND NEW\."revoked_at" IS NOT NULL/);
});

test("0056 migrates announcement dismissals after tenant keys exist", () => {
  const announcementKey = position(
    'CREATE UNIQUE INDEX "announcements_id_organization_idx"',
  );
  const interactionForeignKey = position(
    'ADD CONSTRAINT "announcement_interactions_announcement_tenant_fk"',
  );
  const dismissalBackfill = position(
    'INSERT INTO "public"."announcement_interactions"',
  );

  assert.ok(announcementKey < interactionForeignKey);
  assert.ok(interactionForeignKey < dismissalBackfill);
  assert.match(migration, /'dismiss',[\s\S]*dismissal\."dismissed_at"/);
  assert.match(migration, /announcements_target_rule_set_check/);
});

test("0056 stores bounded immutable web-source snapshots", () => {
  assert.match(
    migration,
    /ALTER TYPE "public"\."ai_agent_source_type" ADD VALUE 'web_url'/,
  );
  assert.match(migration, /ADD COLUMN "source_url" text/);
  assert.match(migration, /ADD COLUMN "content_digest" varchar\(64\)/);
  assert.match(migration, /ADD COLUMN "fetched_at" timestamp with time zone/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX "ai_agent_version_sources_web_url_idx"[\s\S]*\("agent_version_id","source_url"\);/,
  );
  assert.doesNotMatch(
    migration,
    /ai_agent_version_sources_web_url_idx[^;]+WHERE/,
  );
  assert.match(migration, /source_type"::text = 'web_url'/);
  assert.match(migration, /content_digest" ~ '\^\[0-9a-f\]\{64\}\$'/);
});
