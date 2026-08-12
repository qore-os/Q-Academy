import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(
  new URL("../src/db/schema.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL("../drizzle/0050_agent_studio_core.sql", import.meta.url),
  "utf8",
);
const cascadeCleanupMigration = readFileSync(
  new URL(
    "../drizzle/0051_ai_agent_tenant_cascade_cleanup.sql",
    import.meta.url,
  ),
  "utf8",
);
const actionApprovalMigration = readFileSync(
  new URL("../drizzle/0052_ai_agent_action_approvals.sql", import.meta.url),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string }> };
const snapshot = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/0050_snapshot.json", import.meta.url),
    "utf8",
  ),
) as {
  tables: Record<
    string,
    {
      columns: Record<string, { notNull: boolean }>;
      indexes: Record<string, unknown>;
      foreignKeys: Record<
        string,
        { columnsFrom: string[]; columnsTo: string[] }
      >;
    }
  >;
};

test("Agent Studio schema exposes version, source, and access contracts", () => {
  for (const enumContract of [
    /ai_agent_type"[\s\S]*"learning_coach"[\s\S]*"knowledge_assistant"[\s\S]*"form_assistant"/,
    /ai_agent_version_state"[\s\S]*"draft"[\s\S]*"published"/,
    /ai_agent_knowledge_mode"[\s\S]*"all_accessible_courses"[\s\S]*"selected_sources"/,
    /ai_agent_access_mode"[\s\S]*"open"[\s\S]*"restricted"/,
    /ai_agent_access_subject"[\s\S]*"role"[\s\S]*"user"[\s\S]*"group"[\s\S]*"bundle"/,
    /ai_agent_source_type"[\s\S]*"course_version"[\s\S]*"manual_text"[\s\S]*"media_asset"/,
  ]) {
    assert.match(schema, enumContract);
  }

  assert.match(schema, /export const aiAgentVersions = pgTable/);
  assert.match(schema, /draftRevision: integer\("draft_revision"\)\.default\(1\)\.notNull\(\)/);
  assert.match(schema, /ai_agent_versions_agent_number_idx/);
  assert.match(schema, /ai_agent_versions_one_draft_idx/);
  assert.match(schema, /ai_agent_versions_publication_check/);
  assert.match(schema, /ai_agents_draft_version_tenant_fk/);
  assert.match(schema, /ai_agents_published_version_tenant_fk/);
  assert.match(schema, /ai_agents_version_pointers_distinct_check/);
  assert.match(schema, /ai_conversations_agent_version_tenant_fk/);

  assert.match(schema, /export const aiAgentVersionSources = pgTable/);
  assert.match(schema, /ai_agent_version_sources_course_version_tenant_fk/);
  assert.match(schema, /ai_agent_version_sources_media_tenant_fk/);
  assert.match(schema, /ai_agent_version_sources_shape_check/);

  assert.match(schema, /export const aiAgentVersionAccessGrants = pgTable/);
  for (const subject of ["role", "user", "group", "bundle"]) {
    assert.match(
      schema,
      new RegExp(`ai_agent_version_access_grants_${subject}_idx`),
    );
  }
  assert.match(schema, /ai_agent_version_access_grants_subject_shape_check/);
});

test("0050 backfills stable published and draft versions before requiring pointers", () => {
  const publishedBackfill = migration.indexOf(
    `agent."id", 1, 1, 'published', 'learning_coach'`,
  );
  const draftBackfill = migration.indexOf(
    `agent."id", 2, 1, 'draft', 'learning_coach'`,
  );
  const pointerBackfill = migration.indexOf(
    'SET\n\t"published_version_id" = published."id"',
  );
  const conversationBackfill = migration.indexOf(
    'SET "agent_version_id" = agent."published_version_id"',
  );
  const pointerNotNull = migration.indexOf(
    'ALTER COLUMN "draft_version_id" SET NOT NULL',
  );
  const conversationNotNull = migration.indexOf(
    'ALTER COLUMN "agent_version_id" SET NOT NULL',
  );

  for (const position of [
    publishedBackfill,
    draftBackfill,
    pointerBackfill,
    conversationBackfill,
    pointerNotNull,
    conversationNotNull,
  ]) {
    assert.ok(position >= 0);
  }
  assert.ok(publishedBackfill < draftBackfill);
  assert.ok(draftBackfill < pointerBackfill);
  assert.ok(pointerBackfill < conversationBackfill);
  assert.ok(conversationBackfill < pointerNotNull);
  assert.ok(conversationBackfill < conversationNotNull);

  assert.match(
    migration,
    /ai_agents_draft_version_tenant_fk[\s\S]*REFERENCES "public"\."ai_agent_versions"\("id", "agent_id", "organization_id"\)[\s\S]*DEFERRABLE INITIALLY DEFERRED/,
  );
  assert.match(
    migration,
    /ai_conversations_agent_version_tenant_fk[\s\S]*\("agent_version_id", "agent_id", "organization_id"\)[\s\S]*\("id", "agent_id", "organization_id"\)/,
  );
});

test("0050 seals publication history while preserving optimistic draft updates", () => {
  assert.match(migration, /protect_ai_agent_version/);
  assert.match(
    migration,
    /Draft AI agent updates must increment draft_revision by exactly one/,
  );
  assert.match(migration, /Published AI agent versions are immutable/);
  assert.match(
    migration,
    /Publishing may only seal the saved draft configuration/,
  );
  assert.match(migration, /protect_ai_agent_version_child/);
  assert.match(
    migration,
    /Published AI agent version sources and grants are immutable/,
  );
  assert.match(migration, /ai_agent_versions_pointer_integrity_trigger/);
  assert.match(migration, /ai_agent_versions_reject_truncate_trigger/);
  assert.match(migration, /ai_agent_version_sources_reject_truncate_trigger/);
  assert.match(
    migration,
    /ai_agent_version_access_grants_reject_truncate_trigger/,
  );
});

test("Agent Studio migrations remain unique in the current history", () => {
  assert.equal(
    new Set(journal.entries.map((entry) => entry.idx)).size,
    journal.entries.length,
    "Migration indexes must remain unique.",
  );
  assert.equal(
    new Set(journal.entries.map((entry) => entry.tag)).size,
    journal.entries.length,
    "Migration tags must remain unique.",
  );

  const matching = journal.entries
    .filter((entry) => entry.idx >= 50)
    .map(({ idx, tag }) => ({ idx, tag }));
  assert.deepEqual(matching, [
    { idx: 50, tag: "0050_agent_studio_core" },
    { idx: 51, tag: "0051_ai_agent_tenant_cascade_cleanup" },
    { idx: 52, tag: "0052_ai_agent_action_approvals" },
    { idx: 53, tag: "0053_security_foundations" },
    { idx: 54, tag: "0054_local_product_completion" },
    { idx: 55, tag: "0055_product_completion_wave" },
    { idx: 56, tag: "0056_local_parity_completion" },
    { idx: 57, tag: "0057_rich_rictor" },
    { idx: 58, tag: "0058_reflective_argent" },
    { idx: 59, tag: "0059_long_avengers" },
    { idx: 60, tag: "0060_member_notification_preferences" },
    { idx: 61, tag: "0061_member_links_bookmarks" },
    { idx: 62, tag: "0062_course_release_links" },
    { idx: 63, tag: "0063_community_completion" },
    { idx: 64, tag: "0064_tenant_erasure_workflow" },
    { idx: 65, tag: "0065_tenant_erasure_fk_alignment" },
    { idx: 66, tag: "0066_webhook_delivery_attempt_history" },
    { idx: 67, tag: "0067_member_sidebar_icon_catalog" },
    { idx: 68, tag: "0068_course_widget_private_assets" },
    { idx: 69, tag: "0069_privacy_processing_claim_invariant" },
    { idx: 70, tag: "0070_event_calendar_timezone_theme" },
    { idx: 71, tag: "0071_orbit_billing_control_plane" },
    { idx: 72, tag: "0072_orbit_billing_price_versions" },
    { idx: 73, tag: "0073_intercom_identity_fail_closed" },
    { idx: 74, tag: "0074_runtime_trigger_role_guards" },
    { idx: 75, tag: "0075_same_chameleon" },
    { idx: 76, tag: "0076_charming_frightful_four" },
    { idx: 77, tag: "0077_overrated_robbie_robertson" },
    { idx: 78, tag: "0078_peaceful_blue_shield" },
    { idx: 79, tag: "0079_mushy_greymalkin" },
    { idx: 80, tag: "0080_closed_catseye" },
    { idx: 81, tag: "0081_great_lila_cheney" },
  ]);
  assert.equal(
    journal.entries.at(-1)?.tag,
    "0081_great_lila_cheney",
  );
});

test("0052 adds typed approval-gated actions and immutable decision audit", () => {
  assert.match(schema, /export const aiAgentVersionActions = pgTable/);
  assert.match(schema, /export const aiAgentActionRequests = pgTable/);
  assert.match(schema, /export const aiAgentActionEvents = pgTable/);
  assert.match(
    actionApprovalMigration,
    /ai_agent_action_type[\s\S]*course_enrollment/,
  );
  assert.match(actionApprovalMigration, /ai_agent_action_requests_configuration_tenant_fk/);
  assert.match(actionApprovalMigration, /protect_ai_agent_action_request_payload/);
  assert.match(actionApprovalMigration, /ai_agent_action_events_append_only_trigger/);
  assert.match(actionApprovalMigration, /ai_agent_version_actions_protect_trigger/);
});

test("0051 permits tenant cascades without weakening direct immutability", () => {
  assert.match(
    cascadeCleanupMigration,
    /OLD\."state" = 'published' AND EXISTS[\s\S]*"public"\."organizations"/,
  );
  assert.match(
    cascadeCleanupMigration,
    /TG_OP = 'DELETE'[\s\S]*NOT EXISTS[\s\S]*"public"\."organizations"[\s\S]*RETURN OLD/,
  );
  assert.match(
    cascadeCleanupMigration,
    /Published AI agent versions are immutable/,
  );
  assert.match(
    cascadeCleanupMigration,
    /Published AI agent version sources and grants are immutable/,
  );
});

test("0050 snapshot is a complete round-trip baseline for future migrations", () => {
  const publicTables = Object.keys(snapshot.tables).filter((name) =>
    name.startsWith("public."),
  );
  assert.equal(publicTables.length, 108);

  for (const tableName of [
    "public.ai_agent_versions",
    "public.ai_agent_version_sources",
    "public.ai_agent_version_access_grants",
  ]) {
    assert.ok(snapshot.tables[tableName], `${tableName} is absent`);
  }

  const agents = snapshot.tables["public.ai_agents"];
  const conversations = snapshot.tables["public.ai_conversations"];
  const versions = snapshot.tables["public.ai_agent_versions"];
  assert.equal(agents.columns.draft_version_id.notNull, true);
  assert.equal(conversations.columns.agent_version_id.notNull, true);
  assert.ok(versions.indexes.ai_agent_versions_one_draft_idx);
  assert.deepEqual(
    agents.foreignKeys.ai_agents_draft_version_tenant_fk.columnsFrom,
    ["draft_version_id", "id", "organization_id"],
  );
  assert.deepEqual(
    conversations.foreignKeys.ai_conversations_agent_version_tenant_fk
      .columnsFrom,
    ["agent_version_id", "agent_id", "organization_id"],
  );
});
