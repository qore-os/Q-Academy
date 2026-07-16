import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  PRIVACY_DATA_INVENTORY,
  PRIVACY_ERASURE_ACTIONS,
  PRIVACY_ERASURE_PREREQUISITES,
  PRIVACY_EXPORT_MODES,
  PRIVACY_LEGAL_HOLD_SCOPES,
  PRIVACY_SUBJECT_RELATION_KINDS,
} from "../src/lib/privacy/data-inventory";

type SnapshotForeignKey = {
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
};

type SnapshotTable = {
  name: string;
  schema: string;
  columns: Record<string, unknown>;
  foreignKeys: Record<string, SnapshotForeignKey>;
};

type DrizzleSnapshot = {
  tables: Record<string, SnapshotTable>;
};

type DrizzleJournal = {
  entries: Array<{ idx: number; tag: string }>;
};

const snapshot = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "drizzle/meta/0072_snapshot.json"),
    "utf8",
  ),
) as DrizzleSnapshot;
const journal = JSON.parse(
  readFileSync(
    path.resolve(process.cwd(), "drizzle/meta/_journal.json"),
    "utf8",
  ),
) as DrizzleJournal;

const publicTables = Object.values(snapshot.tables)
  .filter((table) => table.schema === "" || table.schema === "public")
  .sort((left, right) => left.name.localeCompare(right.name));
const publicTableNames = publicTables.map((table) => table.name);
const publicTableNameSet = new Set(publicTableNames);

function unique(values: readonly string[]) {
  return [...new Set(values)];
}

test("privacy inventory covers the current 170-table schema and 0074 migration history", () => {
  const inventoryNames = Object.keys(PRIVACY_DATA_INVENTORY).sort();
  const missing = publicTableNames.filter(
    (name) => !(name in PRIVACY_DATA_INVENTORY),
  );
  const unknown = inventoryNames.filter(
    (name) => !publicTableNameSet.has(name),
  );

  assert.equal(
    publicTables.length,
    170,
    "Snapshot 0074 table count changed; update the explicit privacy inventory.",
  );
  assert.equal(journal.entries.length, 75, "Expected 75 versioned migrations.");
  assert.equal(journal.entries.at(-1)?.idx, 74);
  assert.equal(
    journal.entries.at(-1)?.tag,
    "0074_runtime_trigger_role_guards",
  );
  assert.deepEqual(
    missing,
    [],
    "Snapshot tables missing from privacy inventory: " + missing.join(", "),
  );
  assert.deepEqual(
    unknown,
    [],
    "Privacy inventory references unknown tables: " + unknown.join(", "),
  );
  assert.deepEqual(inventoryNames, publicTableNames);
});

test("privacy inventory references only known tables, columns, and policy values", () => {
  const relationKinds = new Set<string>(PRIVACY_SUBJECT_RELATION_KINDS);
  const exportModes = new Set<string>(PRIVACY_EXPORT_MODES);
  const erasureActions = new Set<string>(PRIVACY_ERASURE_ACTIONS);
  const erasurePrerequisites = new Set<string>(PRIVACY_ERASURE_PREREQUISITES);
  const legalHoldScopes = new Set<string>(PRIVACY_LEGAL_HOLD_SCOPES);

  for (const [name, entry] of Object.entries(PRIVACY_DATA_INVENTORY)) {
    const snapshotTable = publicTables.find((table) => table.name === name);
    assert.ok(
      snapshotTable,
      "Inventory table " + name + " is absent from snapshot.",
    );
    const columns = new Set(Object.keys(snapshotTable.columns));

    assert.equal(entry.table, name, name + " has a mismatched table property.");
    assert.ok(
      relationKinds.has(entry.subjectRelation.kind),
      name + " has an unknown subject relation kind.",
    );
    assert.ok(
      exportModes.has(entry.exportPolicy.mode),
      name + " has an unknown export mode.",
    );
    assert.ok(
      erasureActions.has(entry.erasurePolicy.action),
      name + " has an unknown erasure action.",
    );

    for (const [label, description] of [
      ["subject relation", entry.subjectRelation.description],
      ["export policy", entry.exportPolicy.description],
      ["erasure policy", entry.erasurePolicy.description],
      ["legal hold", entry.legalHold.description],
    ] as const) {
      assert.ok(
        description.trim().length >= 20,
        name + " " + label + " needs a concrete rationale.",
      );
    }

    assert.deepEqual(
      unique(entry.subjectRelation.columns),
      [...entry.subjectRelation.columns],
      name + " repeats a subject relation column.",
    );
    assert.deepEqual(
      unique(entry.subjectRelation.viaTables),
      [...entry.subjectRelation.viaTables],
      name + " repeats an indirect relation table.",
    );
    for (const column of entry.subjectRelation.columns) {
      assert.ok(
        columns.has(column),
        name + " relation uses unknown " + column + ".",
      );
    }
    for (const viaTable of entry.subjectRelation.viaTables) {
      assert.ok(
        publicTableNameSet.has(viaTable),
        name + " relation uses unknown table " + viaTable + ".",
      );
    }
    if (entry.subjectRelation.kind === "none") {
      assert.equal(
        entry.subjectRelation.columns.length,
        0,
        name + " relation kind none must not declare subject columns.",
      );
    } else {
      assert.ok(
        entry.subjectRelation.columns.length > 0 ||
          entry.subjectRelation.viaTables.length > 0,
        name + " must name how its non-empty subject relation is resolved.",
      );
    }

    const exportColumns = [
      ...entry.exportPolicy.excludedColumns,
      ...entry.exportPolicy.reviewColumns,
    ];
    assert.deepEqual(
      unique(entry.exportPolicy.excludedColumns),
      [...entry.exportPolicy.excludedColumns],
      name + " repeats an excluded export column.",
    );
    assert.deepEqual(
      unique(entry.exportPolicy.reviewColumns),
      [...entry.exportPolicy.reviewColumns],
      name + " repeats a review export column.",
    );
    for (const column of exportColumns) {
      assert.ok(
        columns.has(column),
        name + " export policy uses unknown " + column + ".",
      );
    }
    assert.deepEqual(
      entry.exportPolicy.excludedColumns.filter((column) =>
        entry.exportPolicy.reviewColumns.includes(column),
      ),
      [],
      name + " cannot both exclude and review the same export column.",
    );
    if (entry.exportPolicy.mode === "exclude") {
      assert.ok(
        entry.exportPolicy.excludedColumns.length > 0,
        name + " exclusion must identify protected columns.",
      );
    }
    if (entry.exportPolicy.mode === "manual_review") {
      assert.ok(
        entry.exportPolicy.reviewColumns.length > 0,
        name + " manual review must identify review columns.",
      );
    }

    assert.deepEqual(
      unique(entry.erasurePolicy.prerequisites),
      [...entry.erasurePolicy.prerequisites],
      name + " repeats an erasure prerequisite.",
    );
    for (const prerequisite of entry.erasurePolicy.prerequisites) {
      assert.ok(
        erasurePrerequisites.has(prerequisite),
        name + " has unknown erasure prerequisite " + prerequisite + ".",
      );
    }
    assert.deepEqual(
      unique(entry.legalHold.scopes),
      [...entry.legalHold.scopes],
      name + " repeats a legal hold scope.",
    );
    for (const scope of entry.legalHold.scopes) {
      assert.ok(
        legalHoldScopes.has(scope),
        name + " has unknown legal hold scope " + scope + ".",
      );
    }
  }
});

test("every concrete users foreign key is represented in its subject relation", () => {
  for (const snapshotTable of publicTables) {
    const userIdColumns = new Set<string>();
    for (const foreignKey of Object.values(snapshotTable.foreignKeys ?? {})) {
      if (foreignKey.tableTo !== "users") continue;
      foreignKey.columnsTo.forEach((targetColumn, index) => {
        if (targetColumn === "id") {
          const sourceColumn = foreignKey.columnsFrom[index];
          if (sourceColumn) userIdColumns.add(sourceColumn);
        }
      });
    }

    const entry =
      PRIVACY_DATA_INVENTORY[
        snapshotTable.name as keyof typeof PRIVACY_DATA_INVENTORY
      ];
    for (const column of userIdColumns) {
      assert.ok(
        entry.subjectRelation.columns.includes(column),
        snapshotTable.name +
          "." +
          column +
          " references users but is absent from its subject relation.",
      );
    }
  }
});

test("polymorphic and embedded subject paths are explicitly classified", () => {
  assert.deepEqual(
    PRIVACY_DATA_INVENTORY.hub_access_grants.subjectRelation.columns,
    ["subject_type", "subject_id"],
  );
  assert.ok(
    PRIVACY_DATA_INVENTORY.announcements.subjectRelation.columns.includes(
      "audience_id",
    ),
  );
  assert.ok(
    PRIVACY_DATA_INVENTORY.activity_events.subjectRelation.columns.includes(
      "metadata",
    ),
  );
  assert.ok(
    PRIVACY_DATA_INVENTORY.api_audit_logs.subjectRelation.columns.includes(
      "resource_id",
    ),
  );
  assert.ok(
    PRIVACY_DATA_INVENTORY.webhook_deliveries.subjectRelation.columns.includes(
      "payload",
    ),
  );
  assert.ok(
    PRIVACY_DATA_INVENTORY.webhook_delivery_attempts.subjectRelation.columns.includes(
      "delivery_id",
    ),
  );
});

test("credential and immutable storage identities are excluded from subject payloads", () => {
  const expectedExcludedColumns: Record<string, readonly string[]> = {
    users: ["password_hash"],
    user_sessions: ["jti_hash"],
    invitations: ["token_hash"],
    password_reset_tokens: ["token_hash"],
    api_keys: ["prefix", "key_hash"],
    webhooks: ["url", "signing_secret_encrypted"],
    email_deliveries: ["payload"],
    web_push_subscriptions: ["endpoint_hash", "subscription_encrypted"],
    media_assets: [
      "storage_key",
      "staging_storage_key",
      "staging_storage_version_id",
      "storage_version_id",
    ],
    privacy_export_artifacts: [
      "storage_key",
      "storage_version_id",
      "storage_etag",
    ],
    posts: [
      "moderation_version",
      "moderation_fingerprint",
      "moderated_by_id",
    ],
    comments: [
      "moderation_version",
      "moderation_fingerprint",
      "moderated_by_id",
    ],
    community_reports: [
      "reporter_id",
      "handled_by_id",
      "resolution_note",
    ],
    community_moderation_cases: [
      "claimed_by_id",
      "resolved_by_id",
      "priority",
    ],
    community_moderation_events: ["actor_id", "note"],
    community_moderation_assessments: ["fingerprint", "signals"],
    community_moderation_appeals: ["appellant_id", "resolved_by_id", "resolution_note"],
    ai_agent_versions: [
      "agent_id",
      "draft_revision",
      "description",
      "system_prompt",
      "color",
      "icon",
      "knowledge_mode",
      "access_mode",
      "created_by_id",
    ],
    ai_agent_version_sources: [
      "id",
      "agent_version_id",
      "course_id",
      "course_version_id",
      "media_asset_id",
      "title",
      "content",
      "source_url",
      "content_digest",
      "fetched_at",
    ],
    ai_agent_version_access_grants: [
      "id",
      "subject_role",
      "subject_user_id",
      "subject_group_id",
      "subject_bundle_id",
    ],
    ai_agent_version_actions: [
      "id",
      "agent_version_id",
      "course_id",
      "group_id",
      "bundle_id",
      "label",
      "description",
    ],
    ai_agent_action_requests: [
      "agent_id",
      "agent_version_id",
      "action_configuration_id",
      "conversation_id",
      "requested_by_id",
      "target_course_id",
      "target_group_id",
      "target_bundle_id",
      "payload_digest",
      "decided_by_id",
    ],
    ai_agent_membership_provenance: [
      "agent_id",
      "member_id",
      "target_group_id",
      "target_bundle_id",
      "grant_request_id",
      "revoked_by_request_id",
    ],
    ai_agent_action_events: ["actor_reference", "payload_digest", "metadata"],
    ai_conversations: ["metadata"],
  };

  for (const [tableName, columns] of Object.entries(expectedExcludedColumns)) {
    const entry =
      PRIVACY_DATA_INVENTORY[tableName as keyof typeof PRIVACY_DATA_INVENTORY];
    assert.ok(entry, "Missing protected table " + tableName + ".");
    for (const column of columns) {
      assert.ok(
        entry.exportPolicy.excludedColumns.includes(column),
        tableName + "." + column + " must be excluded from subject payloads.",
      );
    }
  }
});

test("community completion configuration remains shared context", () => {
  for (const tableName of [
    "community_areas",
    "community_profile_settings",
    "community_public_profile_fields",
  ] as const) {
    const entry = PRIVACY_DATA_INVENTORY[tableName];
    assert.equal(entry.subjectRelation.kind, "none", tableName);
    assert.equal(entry.exportPolicy.mode, "context_only", tableName);
    assert.equal(entry.erasurePolicy.action, "not_applicable", tableName);
  }

  for (const tableName of ["posts", "comments"] as const) {
    const entry = PRIVACY_DATA_INVENTORY[tableName];
    assert.ok(entry.subjectRelation.columns.includes("content"), tableName);
    assert.ok(entry.subjectRelation.columns.includes("rich_text"), tableName);
    assert.equal(entry.exportPolicy.mode, "sanitized", tableName);
    assert.equal(entry.erasurePolicy.action, "pseudonymize", tableName);
  }
});

test("Agent Studio tables classify subject paths and immutable retention explicitly", () => {
  const versions = PRIVACY_DATA_INVENTORY.ai_agent_versions;
  assert.equal(versions.subjectRelation.kind, "mixed");
  assert.ok(versions.subjectRelation.columns.includes("created_by_id"));
  assert.equal(versions.exportPolicy.mode, "metadata_only");

  const sources = PRIVACY_DATA_INVENTORY.ai_agent_version_sources;
  assert.equal(sources.subjectRelation.kind, "indirect");
  assert.deepEqual(sources.subjectRelation.viaTables, ["ai_agent_versions"]);
  assert.equal(sources.exportPolicy.mode, "exclude");

  const grants = PRIVACY_DATA_INVENTORY.ai_agent_version_access_grants;
  assert.equal(grants.subjectRelation.kind, "mixed");
  assert.ok(grants.subjectRelation.columns.includes("subject_user_id"));
  assert.ok(grants.subjectRelation.viaTables.includes("group_members"));
  assert.ok(grants.subjectRelation.viaTables.includes("member_bundles"));

  const actions = PRIVACY_DATA_INVENTORY.ai_agent_version_actions;
  assert.equal(actions.subjectRelation.kind, "indirect");
  assert.equal(actions.exportPolicy.mode, "exclude");

  const requests = PRIVACY_DATA_INVENTORY.ai_agent_action_requests;
  assert.equal(requests.subjectRelation.kind, "direct");
  assert.ok(requests.subjectRelation.columns.includes("requested_by_id"));
  assert.equal(requests.exportPolicy.mode, "sanitized");

  const actionEvents = PRIVACY_DATA_INVENTORY.ai_agent_action_events;
  assert.equal(actionEvents.subjectRelation.kind, "indirect");
  assert.ok(actionEvents.subjectRelation.viaTables.includes("ai_agent_action_requests"));

  const provenance = PRIVACY_DATA_INVENTORY.ai_agent_membership_provenance;
  assert.equal(provenance.subjectRelation.kind, "direct");
  assert.ok(provenance.subjectRelation.columns.includes("member_id"));
  assert.equal(provenance.exportPolicy.mode, "include");

  for (const entry of [
    versions,
    sources,
    grants,
    actions,
    requests,
    actionEvents,
    provenance,
  ]) {
    assert.equal(entry.erasurePolicy.action, "retain");
    assert.ok(entry.erasurePolicy.prerequisites.includes("legal_hold_clear"));
    assert.ok(entry.erasurePolicy.prerequisites.includes("retention_decision"));
    assert.ok(entry.legalHold.scopes.includes("ai"));
  }
});

test("moderation history is retained outside generic cleanup and exports only safe projections", () => {
  for (const tableName of [
    "community_moderation_cases",
    "community_moderation_events",
    "community_moderation_assessments",
    "community_moderation_appeals",
  ] as const) {
    const entry = PRIVACY_DATA_INVENTORY[tableName];
    assert.equal(entry.erasurePolicy.action, "retain", tableName);
    assert.ok(
      entry.erasurePolicy.prerequisites.includes("legal_hold_clear"),
      tableName + " must respect active legal holds.",
    );
    assert.ok(
      entry.erasurePolicy.prerequisites.includes("retention_decision"),
      tableName + " requires an approved retention decision.",
    );
    assert.ok(entry.legalHold.scopes.includes("community"), tableName);
    assert.ok(entry.legalHold.scopes.includes("audit"), tableName);
  }

  assert.equal(
    PRIVACY_DATA_INVENTORY.community_moderation_cases.exportPolicy.mode,
    "sanitized",
  );
  assert.equal(
    PRIVACY_DATA_INVENTORY.community_moderation_appeals.exportPolicy.mode,
    "sanitized",
  );
  assert.equal(
    PRIVACY_DATA_INVENTORY.community_moderation_events.exportPolicy.mode,
    "internal_only",
  );
  assert.equal(
    PRIVACY_DATA_INVENTORY.community_moderation_assessments.exportPolicy.mode,
    "internal_only",
  );
});
