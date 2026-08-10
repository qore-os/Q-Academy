export const PRIVACY_LEGAL_HOLD_SCOPES = [
  "all",
  "profile",
  "authentication",
  "learning",
  "certificates",
  "community",
  "feedback",
  "events",
  "gamification",
  "ai",
  "media",
  "audit",
  "integrations",
  "communications",
] as const;

export type PrivacyLegalHoldScope =
  (typeof PRIVACY_LEGAL_HOLD_SCOPES)[number];

export const PRIVACY_SUBJECT_RELATION_KINDS = [
  "none",
  "direct",
  "actor",
  "mixed",
  "indirect",
  "polymorphic",
  "embedded",
  "hashed",
  "privacy_case",
] as const;

export type PrivacySubjectRelationKind =
  (typeof PRIVACY_SUBJECT_RELATION_KINDS)[number];

export const PRIVACY_EXPORT_MODES = [
  "include",
  "sanitized",
  "metadata_only",
  "context_only",
  "manual_review",
  "internal_only",
  "exclude",
] as const;

export type PrivacyExportMode = (typeof PRIVACY_EXPORT_MODES)[number];

export const PRIVACY_ERASURE_ACTIONS = [
  "not_applicable",
  "delete",
  "cascade_delete",
  "unlink",
  "pseudonymize",
  "delete_or_pseudonymize",
  "retain",
  "expire",
  "revoke_and_unlink",
  "storage_purge_then_delete",
  "review_and_redact",
] as const;

export type PrivacyErasureAction =
  (typeof PRIVACY_ERASURE_ACTIONS)[number];

export const PRIVACY_ERASURE_PREREQUISITES = [
  "legal_hold_clear",
  "retention_decision",
  "parent_erasure",
  "storage_purge_verified",
  "revoke_credentials",
  "shared_resource_review",
] as const;

export type PrivacyErasurePrerequisite =
  (typeof PRIVACY_ERASURE_PREREQUISITES)[number];

export type PrivacySubjectRelation = Readonly<{
  kind: PrivacySubjectRelationKind;
  columns: readonly string[];
  viaTables: readonly string[];
  description: string;
}>;

export type PrivacyExportPolicy = Readonly<{
  mode: PrivacyExportMode;
  excludedColumns: readonly string[];
  reviewColumns: readonly string[];
  description: string;
}>;

export type PrivacyErasurePolicy = Readonly<{
  action: PrivacyErasureAction;
  prerequisites: readonly PrivacyErasurePrerequisite[];
  description: string;
}>;

export type PrivacyLegalHoldPolicy = Readonly<{
  scopes: readonly PrivacyLegalHoldScope[];
  description: string;
}>;

export type PrivacyDataInventoryEntry = Readonly<{
  table: string;
  subjectRelation: PrivacySubjectRelation;
  exportPolicy: PrivacyExportPolicy;
  erasurePolicy: PrivacyErasurePolicy;
  legalHold: PrivacyLegalHoldPolicy;
}>;

function relation(
  kind: PrivacySubjectRelationKind,
  columns: readonly string[],
  viaTables: readonly string[],
  description: string,
): PrivacySubjectRelation {
  return { kind, columns, viaTables, description };
}

function exportPolicy(
  mode: PrivacyExportMode,
  description: string,
  options: {
    excludedColumns?: readonly string[];
    reviewColumns?: readonly string[];
  } = {},
): PrivacyExportPolicy {
  return {
    mode,
    excludedColumns: options.excludedColumns ?? [],
    reviewColumns: options.reviewColumns ?? [],
    description,
  };
}

function erasurePolicy(
  action: PrivacyErasureAction,
  prerequisites: readonly PrivacyErasurePrerequisite[],
  description: string,
): PrivacyErasurePolicy {
  return { action, prerequisites, description };
}

function legalHold(
  scopes: readonly PrivacyLegalHoldScope[],
  description: string,
): PrivacyLegalHoldPolicy {
  return { scopes, description };
}

function table(
  name: string,
  subjectRelation: PrivacySubjectRelation,
  tableExportPolicy: PrivacyExportPolicy,
  tableErasurePolicy: PrivacyErasurePolicy,
  tableLegalHold: PrivacyLegalHoldPolicy,
): PrivacyDataInventoryEntry {
  return {
    table: name,
    subjectRelation,
    exportPolicy: tableExportPolicy,
    erasurePolicy: tableErasurePolicy,
    legalHold: tableLegalHold,
  };
}

export const PRIVACY_DATA_INVENTORY = {
  ...PENDING_SCHEMA_PRIVACY_DATA_INVENTORY,
  activity_events: table(
    "activity_events",
    relation(
      "embedded",
      ["user_id", "entity_type", "entity_id", "metadata"],
      [],
      "The user_id may be actor or subject, while target identities can also occur in entity_id and structured metadata.",
    ),
    exportPolicy(
      "sanitized",
      "Include subject and actor activity with event-specific metadata sanitizing; never expose unclassified metadata verbatim.",
      { reviewColumns: ["metadata"] },
    ),
    erasurePolicy(
      "pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Retain the security event only when policy requires it and replace subject identifiers or free-text excerpts.",
    ),
    legalHold(["audit"], "Security and accountability events belong to the audit hold scope."),
  ),
  ai_agent_action_events: table(
    "ai_agent_action_events",
    relation(
      "indirect",
      ["request_id", "actor_reference", "metadata"],
      ["ai_agent_action_requests"],
      "The subject is resolved through the parent action request; the actor is deliberately pseudonymized and metadata is operational audit context.",
    ),
    exportPolicy(
      "sanitized",
      "Export only event name, status transition, revision and timestamp for the subject's own request; never expose actor references, payload digests or unclassified metadata.",
      {
        excludedColumns: ["actor_reference", "payload_digest", "metadata"],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Action decision events are strictly append-only accountability evidence and require an approved archival or pseudonymization process.",
    ),
    legalHold(
      ["ai", "audit"],
      "Approval transitions are covered by AI and accountability holds.",
    ),
  ),
  ai_agent_action_requests: table(
    "ai_agent_action_requests",
    relation(
      "direct",
      [
        "requested_by_id",
        "decided_by_id",
        "conversation_id",
        "decision_note",
      ],
      ["ai_conversations"],
      "requested_by_id directly identifies the member; decision attribution and notes can contain staff or subject context.",
    ),
    exportPolicy(
      "sanitized",
      "Export the member's safe request, typed target label, decision result and timestamps with resolved agent and target names; hide internal bindings, digests and staff identifiers.",
      {
        excludedColumns: [
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
        reviewColumns: ["decision_note"],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision"],
      "Requests that changed learning access remain accountability evidence; approved retention processing must pseudonymize direct member references before erasure.",
    ),
    legalHold(
      ["ai", "audit", "learning"],
      "Requests connect AI decisions with learning-access evidence.",
    ),
  ),
  ai_agent_membership_provenance: table(
    "ai_agent_membership_provenance",
    relation(
      "direct",
      [
        "member_id",
        "agent_id",
        "target_group_id",
        "target_bundle_id",
        "grant_request_id",
        "revoked_by_request_id",
      ],
      ["ai_agent_action_requests", "groups", "bundles"],
      "The row proves which AI agent created a member assignment and whether an approved action or a manual takeover ended that provenance.",
    ),
    exportPolicy(
      "include",
      "Include typed target label, grant and revocation timestamps, and revocation reason without internal request or agent identifiers.",
      {
        excludedColumns: [
          "agent_id",
          "grant_request_id",
          "revoked_by_request_id",
          "member_id",
          "target_group_id",
          "target_bundle_id",
        ],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Assignment provenance is access-decision evidence and follows the retained parent action requests.",
    ),
    legalHold(
      ["ai", "audit", "learning"],
      "The provenance prevents AI removal of manual or commerce assignments.",
    ),
  ),
  ai_external_use_acknowledgements: table(
    "ai_external_use_acknowledgements",
    relation(
      "direct",
      [
        "user_id",
        "notice_version",
        "notice_digest",
        "privacy_policy_url",
        "transparency_policy_url",
      ],
      ["users"],
      "user_id identifies the member who acknowledged the versioned external-AI notice and its legal-link snapshot.",
    ),
    exportPolicy(
      "include",
      "Include the notice version, digest, legal-link snapshots and acknowledgement timestamp.",
      { excludedColumns: ["organization_id", "user_id"] },
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the member acknowledgement after the privacy workflow has recorded the governing policy snapshot.",
    ),
    legalHold(
      ["ai", "audit"],
      "The acknowledgement can be held as proof of the version shown before external AI use.",
    ),
  ),
  ai_agent_version_access_grants: table(
    "ai_agent_version_access_grants",
    relation(
      "mixed",
      [
        "agent_version_id",
        "subject_type",
        "subject_role",
        "subject_user_id",
        "subject_group_id",
        "subject_bundle_id",
      ],
      [
        "ai_agent_versions",
        "group_members",
        "member_bundles",
        "group_bundles",
      ],
      "A user grant identifies the subject directly, while role, group, and bundle grants relate to members indirectly and the parent version can identify its creator.",
    ),
    exportPolicy(
      "sanitized",
      "Export only a derived relationship kind and safe published-version metadata for grants effective for the subject; never expose grant IDs, target IDs, roles, other members, or draft administration.",
      {
        excludedColumns: [
          "id",
          "subject_role",
          "subject_user_id",
          "subject_group_id",
          "subject_bundle_id",
        ],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "shared_resource_review"],
      "Draft grants can be revoked through the shared agent workflow, while immutable published grants require an approved retention or archival decision before subject unlinking can be implemented.",
    ),
    legalHold(
      ["ai", "audit"],
      "Published access evidence is covered by AI and accountability holds.",
    ),
  ),
  ai_agent_version_actions: table(
    "ai_agent_version_actions",
    relation(
      "indirect",
      [
        "agent_version_id",
        "target_type",
        "course_id",
        "group_id",
        "bundle_id",
        "label",
        "description",
      ],
      ["ai_agent_versions"],
      "Action configuration belongs to a shared agent version; labels and descriptions can embed personal data entered by staff.",
    ),
    exportPolicy(
      "exclude",
      "Do not export internal action-configuration rows; a subject receives only the safe snapshot attached to their own action request.",
      {
        excludedColumns: [
          "id",
          "agent_version_id",
          "target_type",
          "course_id",
          "group_id",
          "bundle_id",
          "label",
          "description",
        ],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "shared_resource_review"],
      "Published action configuration is immutable shared history and must be handled through the agent-version archival process.",
    ),
    legalHold(
      ["ai", "audit"],
      "Published action configuration defines the approved execution boundary.",
    ),
  ),
  ai_agent_version_sources: table(
    "ai_agent_version_sources",
    relation(
      "indirect",
      ["agent_version_id", "title", "content", "source_url"],
      ["ai_agent_versions"],
      "Source ownership is resolved through the version creator, while titles, content, and fetched URLs can embed additional personal data.",
    ),
    exportPolicy(
      "exclude",
      "Do not export source rows: internal source IDs, foreign course or media targets, titles, and manual or extracted content are protected configuration rather than a safe subject projection.",
      {
        excludedColumns: [
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
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "shared_resource_review"],
      "Draft sources can be removed through their shared agent workflow; published sources are immutable history and need an approved archival or redaction design before subject erasure.",
    ),
    legalHold(
      ["ai"],
      "Version-bound knowledge sources are governed by the AI hold scope.",
    ),
  ),
  ai_agent_versions: table(
    "ai_agent_versions",
    relation(
      "mixed",
      ["agent_id", "created_by_id", "name", "description", "system_prompt"],
      ["ai_agents"],
      "created_by_id directly identifies the author, agent_id supplies shared configuration context, and version text can embed additional subjects.",
    ),
    exportPolicy(
      "metadata_only",
      "Export versions authored by the subject only as safe identity, name, type, number, and publication timestamps; never expose prompts, descriptions, mutable draft controls, or creator and agent target IDs.",
      {
        excludedColumns: [
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
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision", "shared_resource_review"],
      "Published versions and their creator attribution are immutable conversation evidence; drafts may be removed only through the shared agent lifecycle and published attribution needs an approved archival or pseudonymization migration.",
    ),
    legalHold(
      ["ai", "audit"],
      "Version authorship and published conversation configuration are covered by AI and accountability holds.",
    ),
  ),
  ai_agents: table(
    "ai_agents",
    relation(
      "embedded",
      ["name", "description", "system_prompt"],
      [],
      "Agent configuration has no subject key but free text can contain staff or customer personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Agent configuration is exported only after a reviewer confirms that text relates to the subject and does not reveal protected prompts.",
      {
        excludedColumns: ["system_prompt"],
        reviewColumns: ["name", "description"],
      },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Shared agents remain operational; subject-specific text must be redacted instead of deleting the shared agent.",
    ),
    legalHold(["ai"], "AI configuration evidence is governed by the AI hold scope."),
  ),
  ai_conversations: table(
    "ai_conversations",
    relation(
      "direct",
      ["user_id", "metadata"],
      [],
      "Each conversation belongs directly to one tenant user; metadata may add subject-specific context.",
    ),
    exportPolicy(
      "sanitized",
      "Include conversation titles, lifecycle timestamps, and the bound safe version projection for the subject; exclude free-form metadata because it can contain internal grounding and administration data.",
      { excludedColumns: ["metadata"] },
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the subject conversation and cascade its messages when no AI legal hold applies.",
    ),
    legalHold(["ai"], "Conversation histories are covered by the AI hold scope."),
  ),
  ai_messages: table(
    "ai_messages",
    relation(
      "indirect",
      ["conversation_id", "content", "citations", "tool_calls", "metadata"],
      ["ai_conversations"],
      "Message ownership is resolved through the parent conversation; content and tool metadata may contain additional subjects.",
    ),
    exportPolicy(
      "sanitized",
      "Include user and assistant content for subject conversations, sanitize citations, and exclude internal tool or system material.",
      { reviewColumns: ["citations", "tool_calls", "metadata"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear", "parent_erasure"],
      "Messages are removed through conversation erasure after any AI hold has been cleared.",
    ),
    legalHold(["ai"], "Message content is covered by the AI hold scope."),
  ),
  announcement_interactions: table(
    "announcement_interactions",
    relation(
      "direct",
      ["user_id"],
      [],
      "The row records a unique impression, click, or dismissal by a specific user.",
    ),
    exportPolicy(
      "include",
      "Include announcement identity, interaction kind, and first occurrence timestamp.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the subject's announcement interaction history.",
    ),
    legalHold(
      ["communications"],
      "Announcement interaction evidence belongs to the communications hold scope.",
    ),
  ),
  announcement_dismissals: table(
    "announcement_dismissals",
    relation(
      "direct",
      ["user_id"],
      [],
      "The row records a specific user's dismissal of an announcement.",
    ),
    exportPolicy("include", "Include announcement identity and dismissal timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete the subject's dismissal state."),
    legalHold(["communications"], "Dismissal evidence belongs to the communications hold scope."),
  ),
  announcements: table(
    "announcements",
    relation(
      "mixed",
      [
        "audience",
        "audience_id",
        "target_rule_set",
        "created_by_id",
        "title",
        "body",
        "content_document",
      ],
      [],
      "created_by_id identifies an actor, while audience=user makes audience_id a polymorphic subject identifier; free text can mention others.",
    ),
    exportPolicy(
      "sanitized",
      "Include announcements directly targeted to the subject and authorship metadata, with free-text and link review.",
      {
        reviewColumns: [
          "title",
          "body",
          "href",
          "action_label",
          "target_rule_set",
          "content_document",
        ],
      },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Remove direct user targeting and redact subject text; shared announcements are not deleted solely with their creator.",
    ),
    legalHold(["communications"], "Announcement records are covered by communications holds."),
  ),
  api_audit_logs: table(
    "api_audit_logs",
    relation(
      "embedded",
      [
        "actor_user_id",
        "api_key_id",
        "path",
        "resource_type",
        "resource_id",
        "ip_address",
        "user_agent",
        "metadata",
      ],
      ["api_keys"],
      "The actor may be direct or inferred through an API key; resource identifiers, network data, paths, and metadata may identify subjects.",
    ),
    exportPolicy(
      "sanitized",
      "Include subject-related audit metadata after removing credentials and unrelated tenant information.",
      { reviewColumns: ["path", "resource_id", "metadata"] },
    ),
    erasurePolicy(
      "pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Keep the minimum audit record required by policy and pseudonymize actor, resource, network, and metadata identifiers.",
    ),
    legalHold(["audit"], "API audit records are governed by the audit hold scope."),
  ),
  api_idempotency_keys: table(
    "api_idempotency_keys",
    relation(
      "indirect",
      ["api_key_id", "path", "response_body"],
      ["api_keys"],
      "The API key links the operational record to its creator; path and encrypted response may contain subject data.",
    ),
    exportPolicy(
      "exclude",
      "Operational idempotency secrets and encrypted response bodies are excluded from subject exports.",
      {
        excludedColumns: [
          "key",
          "request_hash",
          "claim_token",
          "response_body",
        ],
      },
    ),
    erasurePolicy(
      "expire",
      ["revoke_credentials"],
      "Revoke the parent credential and let the bounded idempotency retention remove the row.",
    ),
    legalHold([], "Idempotency secrets expire operationally and are not placed under subject legal holds."),
  ),
  api_keys: table(
    "api_keys",
    relation(
      "actor",
      ["created_by_id"],
      [],
      "created_by_id identifies the administrator who created the integration credential.",
    ),
    exportPolicy(
      "metadata_only",
      "Include credential name, scopes, status, and lifecycle timestamps without credential material.",
      { excludedColumns: ["prefix", "key_hash"] },
    ),
    erasurePolicy(
      "revoke_and_unlink",
      ["legal_hold_clear", "revoke_credentials"],
      "Revoke active credentials before unlinking creator attribution; do not delete integration evidence blindly.",
    ),
    legalHold(["integrations"], "Credential administration is covered by integration holds."),
  ),
  assessment_answers: table(
    "assessment_answers",
    relation(
      "indirect",
      ["attempt_id", "question_snapshot", "answer_snapshot"],
      ["assessment_attempts"],
      "The parent attempt identifies the subject; answer and question snapshots contain the response context.",
    ),
    exportPolicy("include", "Include selected answers, grading result, snapshots, and answer timestamps."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Delete with the attempt unless an approved learning-evidence policy requires pseudonymous retention.",
    ),
    legalHold(["learning"], "Assessment answers are learning evidence."),
  ),
  assessment_attempts: table(
    "assessment_attempts",
    relation(
      "direct",
      [
        "user_id",
        "assessment_snapshot",
        "question_order",
        "question_pools",
        "question_presentation",
        "draft_answers",
      ],
      [],
      "user_id directly identifies the learner and the assessment snapshot records their evaluated context.",
    ),
    exportPolicy(
      "include",
      "Include the frozen exam definition, selected questions, draft answers, revisions, deadlines, release policy, scores, and lifecycle timestamps.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete attempts by default or pseudonymize only when the approved learning-evidence policy requires retention.",
    ),
    legalHold(["learning"], "Assessment attempts are governed by learning holds."),
  ),
  auth_rate_limits: table(
    "auth_rate_limits",
    relation(
      "hashed",
      ["action", "key_hash"],
      [],
      "key_hash can be derived from an email, IP address, or other authentication identifier but is intentionally irreversible.",
    ),
    exportPolicy(
      "exclude",
      "Do not export abuse-prevention hashes or counters because they are security controls rather than portable subject data.",
      { excludedColumns: ["key_hash"] },
    ),
    erasurePolicy("expire", [], "Remove the record automatically after its short reset window."),
    legalHold([], "Short-lived abuse-prevention hashes are never extended by legal holds."),
  ),
  badge_definitions: table(
    "badge_definitions",
    relation(
      "none",
      [],
      [],
      "Badge definitions are shared tenant configuration and do not identify a subject.",
    ),
    exportPolicy("context_only", "Use badge labels as context for exported user_badges."),
    erasurePolicy("not_applicable", [], "Do not change shared badge definitions for a subject request."),
    legalHold(["gamification"], "Definitions may be retained as context for held gamification evidence."),
  ),
  bundle_courses: table(
    "bundle_courses",
    relation(
      "none",
      [],
      ["bundles", "courses"],
      "This shared mapping contains no user identifier and only explains access context.",
    ),
    exportPolicy("context_only", "Use the mapping only to explain a subject's bundle-derived course access."),
    erasurePolicy("not_applicable", [], "Subject erasure does not change shared bundle composition."),
    legalHold(["learning"], "Bundle composition may be required to interpret held learning-access evidence."),
  ),
  bundles: table(
    "bundles",
    relation(
      "none",
      [],
      [],
      "Bundles are shared access configuration without a direct subject identifier.",
    ),
    exportPolicy("context_only", "Include bundle labels only where they explain a subject assignment."),
    erasurePolicy("not_applicable", [], "Do not delete shared bundles for an individual request."),
    legalHold(["learning"], "Bundle metadata may contextualize held learning access."),
  ),
  comments: table(
    "comments",
    relation(
      "mixed",
      ["author_id", "moderated_by_id", "content", "rich_text"],
      ["posts"],
      "author_id identifies the subject as content author, moderated_by_id is an internal moderator attribution, and the plain projection or rich-text document can mention additional subjects.",
    ),
    exportPolicy(
      "sanitized",
      "Include authored comment content and safe publication state while excluding moderator identity and internal moderation fingerprints or versions.",
      {
        excludedColumns: [
          "moderation_version",
          "moderation_fingerprint",
          "moderated_by_id",
        ],
      },
    ),
    erasurePolicy(
      "pseudonymize",
      ["legal_hold_clear"],
      "Replace authored comment content with a plain removal marker and discard its rich-text document while preserving thread integrity.",
    ),
    legalHold(["community"], "Authored comments are covered by community holds."),
  ),
  comment_reactions: table(
    "comment_reactions",
    relation(
      "mixed",
      ["user_id", "comment_id", "post_id"],
      ["users", "comments", "posts"],
      "user_id identifies the reacting subject while the authored comment can identify the recipient of the interaction.",
    ),
    exportPolicy(
      "sanitized",
      "Include reactions created by the subject and aggregate reactions received on authored comments without disclosing other member identities.",
      { excludedColumns: ["user_id"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear"],
      "Delete reactions through subject or source-content erasure.",
    ),
    legalHold(
      ["community", "gamification"],
      "Comment reactions can explain held community-score evidence.",
    ),
  ),
  community_areas: table(
    "community_areas",
    relation(
      "none",
      [],
      [],
      "Community areas are shared tenant navigation configuration and do not contain a member identifier or resolved profile value.",
    ),
    exportPolicy(
      "context_only",
      "Use area title and identity only to contextualize the subject's exported community spaces and authored content.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "Do not alter shared community area configuration for an individual subject request.",
    ),
    legalHold(
      ["community"],
      "Area metadata can contextualize community content protected by an active hold.",
    ),
  ),
  community_comment_attachments: table(
    "community_comment_attachments",
    relation(
      "indirect",
      ["comment_id", "post_id", "media_asset_id"],
      ["comments", "posts", "media_assets"],
      "The authored comment identifies the subject and media_asset_id identifies the attached binary object.",
    ),
    exportPolicy(
      "metadata_only",
      "Include safe attachment metadata with the authored comment and verified binary export manifest.",
    ),
    erasurePolicy(
      "storage_purge_then_delete",
      ["legal_hold_clear", "storage_purge_verified", "parent_erasure"],
      "Delete through parent-comment erasure and verify the atomically soft-deleted binary object is purged.",
    ),
    legalHold(["community", "media"], "Comment attachments are community content and media."),
  ),
  community_asset_bindings: table(
    "community_asset_bindings",
    relation(
      "indirect",
      ["media_asset_id"],
      ["media_assets"],
      "The trigger-managed registry serializes a community asset's single post-or-comment binding.",
    ),
    exportPolicy(
      "context_only",
      "Do not duplicate this internal registry row; export the typed attachment binding instead.",
    ),
    erasurePolicy(
      "cascade_delete",
      ["parent_erasure"],
      "Remove only through the attachment trigger in the same transaction as parent-content erasure.",
    ),
    legalHold(["community", "media"], "The registry preserves binding integrity for held community media."),
  ),
  community_author_boosts: table(
    "community_author_boosts",
    relation(
      "mixed",
      ["author_id", "created_by_id", "reason"],
      ["users"],
      "author_id identifies the ranked subject, created_by_id identifies the administrator, and the reason can contain subject-related free text.",
    ),
    exportPolicy(
      "sanitized",
      "Include boosts applied to or administered by the subject, with credential-like content removed from the reason and without exposing unrelated administrator identity.",
      { excludedColumns: ["created_by_id"], reviewColumns: ["reason"] },
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear", "retention_decision"],
      "Delete subject-linked boosts; expired boosts are operationally purged after the documented retention window.",
    ),
    legalHold(["community", "audit"], "Boost decisions may be held as community-ranking accountability evidence."),
  ),
  community_feed_revisions: table(
    "community_feed_revisions",
    relation(
      "none",
      [],
      ["organizations"],
      "The tenant-wide monotonic invalidation counter has no user identifier or behavioral payload.",
    ),
    exportPolicy("internal_only", "Do not export the operational cache-invalidation counter."),
    erasurePolicy("not_applicable", [], "Subject erasure does not alter the shared monotonic counter."),
    legalHold([], "The counter is not personal-data evidence."),
  ),
  community_follows: table(
    "community_follows",
    relation(
      "mixed",
      ["follower_id", "target_author_id", "target_space_id"],
      ["users", "community_spaces"],
      "follower_id identifies the acting subject and target_author_id can identify another subject.",
    ),
    exportPolicy(
      "include",
      "Include follows created by the subject; provide only an aggregate count for other members following the subject.",
      { excludedColumns: ["id"] },
    ),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete follow edges created by or targeting the erased subject."),
    legalHold(["community"], "Follow relationships may be covered by a community hold."),
  ),
  community_level_settings: table(
    "community_level_settings",
    relation(
      "actor",
      ["updated_by_id"],
      ["users"],
      "updated_by_id records the administrator who last changed the tenant-wide level configuration.",
    ),
    exportPolicy(
      "context_only",
      "Use the enabled state and revision only as tenant context without disclosing the administrator identity.",
      { excludedColumns: ["updated_by_id"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Review and unlink updater attribution without changing shared tenant configuration.",
    ),
    legalHold(
      ["gamification", "audit"],
      "Level configuration and updater attribution can explain held gamification decisions.",
    ),
  ),
  community_levels: table(
    "community_levels",
    relation(
      "none",
      [],
      [],
      "Community levels are shared tenant configuration and do not identify an individual subject.",
    ),
    exportPolicy(
      "context_only",
      "Use active level labels and thresholds only where they explain the subject's gamification state.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "An individual subject request does not alter shared community level definitions.",
    ),
    legalHold(
      ["gamification"],
      "Level definitions may contextualize held point and achievement evidence.",
    ),
  ),
  community_mentions: table(
    "community_mentions",
    relation(
      "mixed",
      ["mentioned_user_id", "mentioned_by_id", "handle"],
      ["posts", "comments"],
      "Mentioned and mentioning users are explicit subjects while the post or comment identifies the source context.",
    ),
    exportPolicy(
      "include",
      "Include mention records created by or directed at the subject with source identity, resolved handle, and timestamp.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete mention edges involving the subject when community content is erased.",
    ),
    legalHold(["community"], "Community mentions are covered by community-content holds."),
  ),
  community_moderation_appeals: table(
    "community_moderation_appeals",
    relation(
      "mixed",
      ["appellant_id", "resolved_by_id"],
      ["community_moderation_cases"],
      "appellant_id identifies the appealing subject while resolved_by_id is confidential moderator attribution.",
    ),
    exportPolicy(
      "sanitized",
      "Include only the subject's own appeal statement, public result, and lifecycle timestamps without moderator identity or internal resolution notes.",
      {
        excludedColumns: [
          "appellant_id",
          "decision_version",
          "resolved_by_id",
          "resolution_note",
        ],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision"],
      "Keep the appeal history out of generic retention and move or pseudonymize it only through an approved audited retention process.",
    ),
    legalHold(
      ["community", "audit"],
      "Appeal statements and outcomes are protected community accountability evidence.",
    ),
  ),
  community_moderation_assessments: table(
    "community_moderation_assessments",
    relation(
      "indirect",
      ["case_id"],
      ["community_moderation_cases"],
      "The moderation case links an assessment to the content author while signals may contain confidential abuse-detection evidence.",
    ),
    exportPolicy(
      "internal_only",
      "Never export fingerprints or assessment signals; expose only the separately projected author-facing case outcome.",
      { excludedColumns: ["fingerprint", "signals"] },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision"],
      "Exclude assessments from generic retention and handle them only through an approved audited moderation-retention process.",
    ),
    legalHold(
      ["community", "audit"],
      "Assessment evidence can be required to defend held moderation decisions.",
    ),
  ),
  community_moderation_cases: table(
    "community_moderation_cases",
    relation(
      "mixed",
      [
        "target_author_id",
        "claimed_by_id",
        "resolved_by_id",
        "target_type",
        "target_id",
      ],
      ["posts", "comments"],
      "target_author_id identifies the affected author while claimant and resolver columns contain confidential moderator attribution.",
    ),
    exportPolicy(
      "sanitized",
      "Provide an author-facing case summary with content state, reason code, status, and decision timestamps without queue or moderator internals.",
      {
        excludedColumns: [
          "target_author_id",
          "content_version",
          "policy_version",
          "priority",
          "claimed_by_id",
          "claimed_at",
          "resolved_by_id",
          "decision_version",
        ],
      },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision"],
      "Keep case history out of generic retention and move or pseudonymize it only through an approved audited retention process.",
    ),
    legalHold(
      ["community", "audit"],
      "Moderation cases are community and accountability evidence subject to active holds.",
    ),
  ),
  community_moderation_events: table(
    "community_moderation_events",
    relation(
      "mixed",
      ["actor_id", "case_id"],
      ["community_moderation_cases"],
      "actor_id is confidential moderator attribution and case_id indirectly links the event to the affected content author.",
    ),
    exportPolicy(
      "internal_only",
      "Do not export the raw append-only timeline, actor identity, or internal note; derive safe decision timestamps from the case projection.",
      { excludedColumns: ["actor_id", "note"] },
    ),
    erasurePolicy(
      "retain",
      ["legal_hold_clear", "retention_decision"],
      "Append-only moderation events are never deleted by generic retention and require an approved audited archive or pseudonymization process.",
    ),
    legalHold(
      ["community", "audit"],
      "The immutable moderation timeline is protected accountability evidence under active holds.",
    ),
  ),
  community_post_attachments: table(
    "community_post_attachments",
    relation(
      "indirect",
      ["post_id", "media_asset_id"],
      ["posts", "media_assets"],
      "The authored post identifies the subject and media_asset_id identifies the attached binary object.",
    ),
    exportPolicy(
      "metadata_only",
      "Include safe attachment metadata with the authored post and verified binary export manifest.",
    ),
    erasurePolicy(
      "storage_purge_then_delete",
      ["legal_hold_clear", "storage_purge_verified", "parent_erasure"],
      "Delete through parent-post erasure and verify the atomically soft-deleted binary object is purged.",
    ),
    legalHold(["community", "media"], "Post attachments are community content and media."),
  ),
  community_profile_settings: table(
    "community_profile_settings",
    relation(
      "none",
      [],
      [],
      "The completion-gate switch and revision are shared tenant configuration and contain no resolved member profile value.",
    ),
    exportPolicy(
      "context_only",
      "Use the active gate state only to explain which public profile requirements applied to a subject's community participation.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "Do not alter tenant-wide community profile settings for an individual subject request.",
    ),
    legalHold(
      ["profile", "community"],
      "The gate revision can contextualize held profile and community authorization evidence.",
    ),
  ),
  community_public_profile_fields: table(
    "community_public_profile_fields",
    relation(
      "none",
      [],
      ["custom_field_definitions"],
      "This shared mapping selects public standard or custom profile definitions but stores no member-specific field value.",
    ),
    exportPolicy(
      "context_only",
      "Use configured labels, order, and posting requirements only to interpret the subject's separately exported profile values.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "Do not change shared public-profile field configuration for an individual subject request.",
    ),
    legalHold(
      ["profile", "community"],
      "Field configuration can explain public profile and posting requirements under an active hold.",
    ),
  ),
  community_reports: table(
    "community_reports",
    relation(
      "mixed",
      [
        "reporter_id",
        "target_author_id",
        "handled_by_id",
        "target_type",
        "target_id",
        "case_id",
        "content_excerpt",
        "details",
        "resolution_note",
      ],
      ["posts", "comments", "community_moderation_cases"],
      "Reporter, target author, and moderator are explicit subjects; target and case identity or reviewed text can identify additional people.",
    ),
    exportPolicy(
      "sanitized",
      "Export a reporter's own case details and a target author's moderation outcome through role-specific projections without disclosing another reporter or internal moderator identity.",
      {
        excludedColumns: [
          "reporter_id",
          "target_author_id",
          "handled_by_id",
          "case_id",
          "resolution_note",
        ],
        reviewColumns: ["content_excerpt", "details"],
      },
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete subject-only reports after policy review or unlink identities while retaining the minimum abuse-prevention decision record.",
    ),
    legalHold(
      ["community", "audit"],
      "Reports and moderation outcomes are governed by community and accountability holds.",
    ),
  ),
  community_score_contributions: table(
    "community_score_contributions",
    relation(
      "mixed",
      [
        "recipient_id",
        "actor_id",
        "post_id",
        "comment_id",
        "reaction_comment_id",
      ],
      ["users", "posts", "comments", "post_likes", "comment_reactions"],
      "recipient_id identifies the score recipient and actor_id the member whose interaction generated the contribution.",
    ),
    exportPolicy(
      "sanitized",
      "Include direction, contribution kind, points, source identity, and timestamp for the subject without exposing another member identifier.",
      { excludedColumns: ["recipient_id", "actor_id"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear", "parent_erasure"],
      "Delete trigger-maintained contributions with the subject or source interaction and recalculate the aggregate score.",
    ),
    legalHold(
      ["community", "gamification"],
      "The contribution ledger can be required to explain held community-point totals.",
    ),
  ),
  community_space_access_rules: table(
    "community_space_access_rules",
    relation(
      "mixed",
      ["subject_role", "subject_user_id", "subject_group_id", "subject_bundle_id"],
      ["community_spaces", "users", "groups", "bundles"],
      "User rules identify a subject directly; role, group, and bundle rules are shared access configuration.",
    ),
    exportPolicy(
      "include",
      "Include only the subject's direct user rules; derived role, group, and bundle access is exported through its source assignments.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete direct user rules for the subject while preserving shared role, group, and bundle policy.",
    ),
    legalHold(["community", "audit"], "Access policy can explain held community authorization decisions."),
  ),
  community_space_moderation_policies: table(
    "community_space_moderation_policies",
    relation(
      "actor",
      ["updated_by_id"],
      ["community_spaces", "users"],
      "updated_by_id records the administrator who last changed the shared moderation policy for a space.",
    ),
    exportPolicy(
      "context_only",
      "Use policy modes and version only to explain an affected case without disclosing the administrator identity.",
      { excludedColumns: ["updated_by_id"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Review and unlink updater attribution without changing the shared moderation policy.",
    ),
    legalHold(
      ["community", "audit"],
      "Policy versions may be needed to interpret held moderation decisions.",
    ),
  ),
  community_spaces: table(
    "community_spaces",
    relation(
      "none",
      [],
      [],
      "Community spaces are shared tenant configuration without a subject identifier.",
    ),
    exportPolicy("context_only", "Use space title and identity to contextualize exported posts."),
    erasurePolicy("not_applicable", [], "Do not alter shared community spaces for a subject request."),
    legalHold(["community"], "Space context may be retained for held community content."),
  ),
  content_blocks: table(
    "content_blocks",
    relation(
      "embedded",
      ["title", "data"],
      ["lessons", "lesson_pages"],
      "Course block JSON and free text have no subject key but can contain incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Course content is not automatically exported; review structured block data only when a request identifies embedded subject data.",
      { reviewColumns: ["title", "data"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal data without deleting shared instructional content.",
    ),
    legalHold(["learning"], "Course content can contextualize held learning evidence."),
  ),
  course_access_grants: table(
    "course_access_grants",
    relation(
      "direct",
      ["user_id"],
      [],
      "user_id directly identifies the member receiving course access.",
    ),
    exportPolicy("include", "Include granted course, source, and grant timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete direct access grants for the subject."),
    legalHold(["learning"], "Direct course access is governed by learning holds."),
  ),
  course_categories: table(
    "course_categories",
    relation(
      "none",
      [],
      [],
      "Course categories are shared catalog configuration.",
    ),
    exportPolicy("context_only", "Use category labels only as context for a subject's courses."),
    erasurePolicy("not_applicable", [], "Individual erasure does not affect shared course categories."),
    legalHold(["learning"], "Category context may accompany held learning records."),
  ),
  course_certificates: table(
    "course_certificates",
    relation(
      "mixed",
      ["user_id", "recipient_name", "issued_by_id", "revoked_by_id"],
      [],
      "user_id and recipient_name identify the learner; issuer and revoker columns identify administrative actors.",
    ),
    exportPolicy("include", "Include certificate identity, recipient snapshot, issue, completion, and revocation details."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Apply the approved certificate-evidence policy before deleting or pseudonymizing recipient and actor data.",
    ),
    legalHold(["certificates"], "Certificates have a dedicated evidence hold scope."),
  ),
  course_authors: table(
    "course_authors",
    relation(
      "actor",
      ["user_id"],
      ["courses"],
      "user_id identifies an ordered tenant team author whose public profile is captured with published course information.",
    ),
    exportPolicy(
      "metadata_only",
      "Include course-author attribution and ordering when the subject is the linked team member.",
    ),
    erasurePolicy(
      "unlink",
      ["legal_hold_clear", "shared_resource_review"],
      "Remove author attribution only after reviewing published course evidence and selecting a replacement where required.",
    ),
    legalHold(
      ["learning", "audit"],
      "Author attribution can be part of held publication and learning evidence.",
    ),
  ),
  course_collaborators: table(
    "course_collaborators",
    relation(
      "mixed",
      ["user_id", "granted_by_id"],
      ["courses"],
      "user_id identifies the assigned trainer and granted_by_id records the administrative actor who granted the course permission.",
    ),
    exportPolicy(
      "include",
      "Include the course permission, granting actor, and grant timestamps for the linked team member.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete assignments where the subject is the trainer; unlink or pseudonymize grantor attribution according to the approved audit-retention decision.",
    ),
    legalHold(
      ["learning", "audit"],
      "Course permission history can be relevant to held publication and accountability evidence.",
    ),
  ),
  course_learning_goals: table(
    "course_learning_goals",
    relation(
      "embedded",
      ["text"],
      ["courses"],
      "Shared learning-goal text has no direct subject key but can contain incidental personal information.",
    ),
    exportPolicy(
      "manual_review",
      "Review shared learning-goal text before including confirmed subject-related content.",
      { reviewColumns: ["text"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal information without deleting unrelated shared course goals.",
    ),
    legalHold(
      ["learning"],
      "Published learning goals can contextualize held course progress and completion evidence.",
    ),
  ),
  course_media_assets: table(
    "course_media_assets",
    relation(
      "mixed",
      ["media_asset_id", "attached_by_id"],
      ["media_assets", "courses"],
      "attached_by_id identifies an actor and the media relation inherits uploader or owner subjects from media_assets.",
    ),
    exportPolicy("metadata_only", "Include course binding metadata only for subject-related media assets."),
    erasurePolicy(
      "unlink",
      ["legal_hold_clear", "shared_resource_review"],
      "Remove actor attribution or the binding only after confirming the shared course asset is no longer required.",
    ),
    legalHold(["media", "learning"], "Bindings connect held media with learning content."),
  ),
  course_module_access_overrides: table(
    "course_module_access_overrides",
    relation(
      "mixed",
      ["user_id", "created_by_id", "reason"],
      ["users", "courses", "modules"],
      "user_id identifies the affected learner, created_by_id the deciding actor, and reason can contain subject-related access context.",
    ),
    exportPolicy(
      "include",
      "Include module override state, reason, expiry, timestamps, and responsible actor for the affected subject.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete expired or obsolete overrides and pseudonymize retained decision evidence after the learning and audit retention review.",
    ),
    legalHold(
      ["learning", "audit"],
      "Overrides determine effective learning access and can be retained as administrative decision evidence.",
    ),
  ),
  course_module_access_requests: table(
    "course_module_access_requests",
    relation(
      "mixed",
      ["user_id", "decided_by_id", "message", "decision_note"],
      ["users", "courses", "modules"],
      "user_id identifies the requesting learner, decided_by_id the reviewer, and request text can contain personal access context.",
    ),
    exportPolicy(
      "include",
      "Include request message, lifecycle status, decision note, timestamps, target module, and reviewer attribution for the subject.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete withdrawn or obsolete requests and pseudonymize retained approval evidence after the approved retention decision.",
    ),
    legalHold(
      ["learning", "audit"],
      "Access requests document learner access decisions and can be covered by learning or audit holds.",
    ),
  ),
  course_modules: table(
    "course_modules",
    relation(
      "none",
      [],
      ["courses", "modules"],
      "This is shared course structure without a subject identifier.",
    ),
    exportPolicy("context_only", "Use module order and requirements to explain learning evidence."),
    erasurePolicy("not_applicable", [], "Do not change shared course structure for a subject request."),
    legalHold(["learning"], "Course structure may contextualize held progress."),
  ),
  course_widgets: table(
    "course_widgets",
    relation(
      "mixed",
      [
        "author_user_id",
        "author_role",
        "author_description",
        "title",
        "text",
        "link_url",
        "image_url",
        "media_asset_id",
        "alt_text",
      ],
      ["courses", "media_assets"],
      "author_user_id identifies a tenant team author while configurable card text, links, and private image metadata can contain incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Export author attribution only when subject-related and review configurable card text, links, and image metadata before disclosure.",
      {
        reviewColumns: [
          "author_role",
          "author_description",
          "title",
          "text",
          "link_url",
          "image_url",
          "alt_text",
        ],
      },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Unlink or replace author attribution and redact confirmed personal card content while preserving shared course structure where required.",
    ),
    legalHold(
      ["learning"],
      "Published widget snapshots and their source configuration can contextualize held learning content.",
    ),
  ),
  course_versions: table(
    "course_versions",
    relation(
      "actor",
      ["created_by_id", "snapshot", "changelog"],
      [],
      "created_by_id identifies the publisher while snapshot and changelog may contain authored or incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Export authorship metadata when relevant; review immutable snapshots and changelogs before including text.",
      { reviewColumns: ["snapshot", "changelog"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Unlink creator attribution where allowed; retained published snapshots require targeted review rather than blanket deletion.",
    ),
    legalHold(["learning", "audit"], "Published versions can be learning context and publication audit evidence."),
  ),
  published_course_link_edges: table(
    "published_course_link_edges",
    relation(
      "none",
      [],
      ["courses", "course_versions"],
      "This projection preserves tenant-local published course navigation and contains no data-subject identifier.",
    ),
    exportPolicy(
      "context_only",
      "Use published source and target references only when they are needed to explain an exported learning path.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "Do not alter published course-link projections for an individual subject request.",
    ),
    legalHold(
      ["learning", "audit"],
      "The projection preserves the effective navigation graph of an immutable published version.",
    ),
  ),
  courses: table(
    "courses",
    relation(
      "actor",
      ["created_by_id", "title", "short_description", "description"],
      [],
      "created_by_id identifies an author; descriptive fields can contain incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Include creator attribution when relevant and review course text instead of exporting shared content by default.",
      { reviewColumns: ["title", "short_description", "description"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Unlink the creator and redact confirmed personal data while preserving shared courses.",
    ),
    legalHold(["learning"], "Courses provide context for held learning evidence."),
  ),
  custom_field_definitions: table(
    "custom_field_definitions",
    relation(
      "none",
      [],
      [],
      "Definitions describe tenant profile fields but contain no subject value. The personalization flag is shared opt-in configuration and never stores a resolved member value.",
    ),
    exportPolicy("context_only", "Include labels, types and personalization opt-in needed to interpret a subject's custom field values; resolved template output is not persisted here."),
    erasurePolicy("not_applicable", [], "Do not delete shared definitions for a subject request."),
    legalHold(["profile"], "Definitions contextualize held profile values."),
  ),
  custom_field_values: table(
    "custom_field_values",
    relation(
      "direct",
      ["user_id", "value"],
      ["custom_field_definitions"],
      "user_id directly identifies the profile owner and value contains the custom personal attribute.",
    ),
    exportPolicy("include", "Include the value with its field definition and update timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete every custom field value owned by the subject."),
    legalHold(["profile"], "Custom attributes are covered by profile holds."),
  ),
  data_form_fields: table(
    "data_form_fields",
    relation(
      "none",
      [],
      ["data_forms", "custom_field_definitions"],
      "The mapping is shared tenant configuration and contains no subject value.",
    ),
    exportPolicy("context_only", "Use form-field mappings to label a subject's submitted responses."),
    erasurePolicy("not_applicable", [], "Do not change shared form composition for a subject request."),
    legalHold(["profile"], "Form composition contextualizes held profile submissions."),
  ),
  data_form_submissions: table(
    "data_form_submissions",
    relation(
      "mixed",
      [
        "user_id",
        "submitted_by_id",
        "profile_id",
        "response_snapshot",
      ],
      ["data_forms", "member_data_profiles"],
      "user_id identifies the profile owner, submitted_by_id the actor, and the immutable response snapshot contains personal attributes.",
    ),
    exportPolicy("include", "Include form, profile, source context, response snapshot, and submission timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete form submissions made for or by the subject."),
    legalHold(["profile", "learning"], "Embedded form submissions can be profile and learning evidence."),
  ),
  data_forms: table(
    "data_forms",
    relation(
      "none",
      [],
      ["data_profile_definitions"],
      "Forms are shared tenant configuration without a subject identifier.",
    ),
    exportPolicy("context_only", "Use form labels to contextualize subject submissions."),
    erasurePolicy("not_applicable", [], "Do not delete shared forms for an individual request."),
    legalHold(["profile", "learning"], "Form definitions contextualize held submissions."),
  ),
  data_profile_definitions: table(
    "data_profile_definitions",
    relation(
      "none",
      [],
      [],
      "Profile definitions are shared tenant configuration without a subject value.",
    ),
    exportPolicy("context_only", "Use definition names to describe a subject's named data profiles."),
    erasurePolicy("not_applicable", [], "Do not alter shared profile definitions for a subject request."),
    legalHold(["profile"], "Definitions contextualize held profile data."),
  ),
  data_profile_fields: table(
    "data_profile_fields",
    relation(
      "none",
      [],
      ["data_profile_definitions", "custom_field_definitions"],
      "The mapping is shared profile configuration and contains no subject value.",
    ),
    exportPolicy("context_only", "Use mappings to interpret fields present in a subject's profile."),
    erasurePolicy("not_applicable", [], "Do not alter shared field mappings for a subject request."),
    legalHold(["profile"], "Field mappings contextualize held profile values."),
  ),
  data_profile_values: table(
    "data_profile_values",
    relation(
      "direct",
      ["user_id", "profile_id", "value"],
      ["member_data_profiles", "custom_field_definitions"],
      "user_id identifies the owner, profile_id identifies the named profile, and value contains the personal attribute used by profile reports and explicitly enabled personalization.",
    ),
    exportPolicy("include", "Include named profile context, field definition, value, and update timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete every named-profile value owned by the subject."),
    legalHold(["profile"], "Named-profile values are governed by profile holds."),
  ),
  email_deliveries: table(
    "email_deliveries",
    relation(
      "direct",
      ["user_id", "recipient_email", "payload", "response_body"],
      [],
      "The user and recipient email identify the subject; encrypted payload and provider response can contain additional personal data.",
    ),
    exportPolicy(
      "metadata_only",
      "Include delivery event, recipient, status, attempt, and timestamps without encrypted links or provider response bodies.",
      { excludedColumns: ["payload", "response_body"] },
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Cancel or terminalize queued mail before deleting subject delivery records.",
    ),
    legalHold(["communications", "authentication"], "Mail history can be communication or authentication evidence."),
  ),
  enrollments: table(
    "enrollments",
    relation(
      "direct",
      ["user_id"],
      ["courses"],
      "user_id directly identifies the learner enrolled in a course.",
    ),
    exportPolicy("include", "Include course, access state, progress, and enrollment lifecycle timestamps."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete enrollment data unless an approved learning-evidence policy requires pseudonymous retention.",
    ),
    legalHold(["learning"], "Enrollments are governed by learning holds."),
  ),
  event_attendees: table(
    "event_attendees",
    relation(
      "direct",
      ["user_id"],
      ["events"],
      "user_id directly identifies an attendee and their response.",
    ),
    exportPolicy("include", "Include event identity, attendance status, and response timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete the subject's attendance response."),
    legalHold(["events"], "Attendance records belong to the events hold scope."),
  ),
  event_audience_grants: table(
    "event_audience_grants",
    relation(
      "polymorphic",
      ["user_id", "group_id", "bundle_id"],
      ["events", "groups", "bundles"],
      "Exactly one optional target column is set; user_id is direct while group or bundle targets relate through membership.",
    ),
    exportPolicy("include", "Include direct user grants and resolved group or bundle grants that apply to the subject."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete direct subject grants; shared group and bundle grants remain."),
    legalHold(["events"], "Audience grants explain event eligibility."),
  ),
  event_lifecycle_history: table(
    "event_lifecycle_history",
    relation(
      "actor",
      ["actor_reference", "reason"],
      ["events"],
      "The pseudonymous actor reference identifies the administrative source; a lifecycle reason can contain personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Include revision, transition, event window and timestamps; review free-text reasons before exporting organizer data.",
      { reviewColumns: ["reason"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Retain the immutable transition while redacting confirmed personal data from the reason and actor reference.",
    ),
    legalHold(["events"], "Lifecycle history is operational evidence for event changes."),
  ),
  events: table(
    "events",
    relation(
      "actor",
      ["created_by_id", "title", "description", "meeting_url", "location"],
      [],
      "created_by_id identifies the organizer and event text can contain participant or presenter personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Use event details as context for subject attendance and review links or free text before exporting organizer data.",
      { reviewColumns: ["title", "description", "meeting_url", "location"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Unlink the creator and redact confirmed personal data without deleting shared events.",
    ),
    legalHold(["events"], "Event definitions contextualize held attendance."),
  ),
  feedback_entries: table(
    "feedback_entries",
    relation(
      "mixed",
      ["user_id", "content", "reviewed_by_id"],
      [],
      "user_id identifies the feedback author, content is their statement, and reviewed_by_id identifies an administrative actor.",
    ),
    exportPolicy("include", "Include rating, content, consent, status, and review lifecycle metadata."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete subject feedback and its testimonial consent state."),
    legalHold(["feedback"], "Feedback records have a dedicated hold scope."),
  ),
  group_bundles: table(
    "group_bundles",
    relation(
      "indirect",
      ["group_id", "bundle_id"],
      ["group_members", "groups", "bundles"],
      "The mapping applies indirectly to subjects through group membership.",
    ),
    exportPolicy("context_only", "Use the mapping to explain bundle access inherited by the subject."),
    erasurePolicy("not_applicable", [], "Do not change shared group assignments for one subject."),
    legalHold(["learning"], "The mapping can explain held access decisions."),
  ),
  group_courses: table(
    "group_courses",
    relation(
      "indirect",
      ["group_id", "course_id"],
      ["group_members", "groups", "courses"],
      "The mapping applies indirectly to subjects through group membership.",
    ),
    exportPolicy("context_only", "Use the mapping to explain course access inherited by the subject."),
    erasurePolicy("not_applicable", [], "Do not change shared group course assignments for one subject."),
    legalHold(["learning"], "The mapping can explain held course access."),
  ),
  group_members: table(
    "group_members",
    relation(
      "direct",
      ["user_id"],
      ["groups"],
      "user_id directly identifies a member of the group.",
    ),
    exportPolicy("include", "Include group identity and membership start timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Remove the subject from every group."),
    legalHold(["profile", "learning"], "Membership can be profile data and evidence for inherited access."),
  ),
  groups: table(
    "groups",
    relation(
      "none",
      [],
      [],
      "Groups are shared tenant configuration without a subject identifier.",
    ),
    exportPolicy("context_only", "Include group labels only to explain a subject membership or access path."),
    erasurePolicy("not_applicable", [], "Do not delete shared groups for a subject request."),
    legalHold(["profile", "learning"], "Group context may be required for held membership or access evidence."),
  ),
  hub_access_grants: table(
    "hub_access_grants",
    relation(
      "polymorphic",
      ["subject_type", "subject_id"],
      ["hubs", "users", "groups"],
      "subject_id identifies a user only when subject_type=user; group targets relate indirectly through membership.",
    ),
    exportPolicy("include", "Include direct user grants and resolved group grants applying to the subject."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete rows with subject_type=user for the subject; shared group grants remain."),
    legalHold(["profile", "learning"], "Hub eligibility can be profile and learning-access evidence."),
  ),
  hubs: table(
    "hubs",
    relation(
      "embedded",
      ["title", "description", "layout"],
      [],
      "Hub layout JSON and descriptive text have no subject key but may embed personal labels or links.",
    ),
    exportPolicy(
      "manual_review",
      "Use hub identity as access context and review layout JSON only when embedded subject data is reported.",
      { reviewColumns: ["title", "description", "layout"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal content while preserving the shared hub.",
    ),
    legalHold(["learning"], "Hub context may explain held access."),
  ),
  invitations: table(
    "invitations",
    relation(
      "mixed",
      ["user_id", "email", "created_by_id"],
      [],
      "user_id and email identify the invited subject while created_by_id identifies the inviter.",
    ),
    exportPolicy(
      "metadata_only",
      "Include email and invitation lifecycle timestamps without the bearer token hash.",
      { excludedColumns: ["token_hash"] },
    ),
    erasurePolicy("delete", ["legal_hold_clear"], "Invalidate and delete subject invitations."),
    legalHold(["authentication"], "Invitation history is authentication evidence."),
  ),
  lesson_availability_subscriptions: table(
    "lesson_availability_subscriptions",
    relation(
      "direct",
      ["user_id"],
      ["courses", "lessons", "course_versions", "notifications", "email_deliveries"],
      "user_id identifies the member who subscribed to a lesson availability transition.",
    ),
    exportPolicy(
      "include",
      "Include course, lesson, subscribed and fulfilled versions, lifecycle state, and timestamps.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the subject's lesson availability subscription history.",
    ),
    legalHold(
      ["learning", "communications"],
      "Subscription and fulfillment history can evidence learning communications.",
    ),
  ),
  lesson_bookmarks: table(
    "lesson_bookmarks",
    relation(
      "direct",
      ["user_id"],
      ["courses", "modules", "lessons"],
      "user_id directly identifies the member while the course, module, and lesson references describe the saved learning location.",
    ),
    exportPolicy(
      "include",
      "Include the bookmarked course, module, lesson, and creation timestamp.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete all personal lesson bookmarks for the subject.",
    ),
    legalHold(
      ["learning"],
      "A saved learning location can be retained only with held learning evidence.",
    ),
  ),
  lesson_pages: table(
    "lesson_pages",
    relation(
      "none",
      [],
      ["lessons"],
      "Lesson pages are shared course structure without a subject identifier.",
    ),
    exportPolicy("context_only", "Use page identity to explain subject progress or responses."),
    erasurePolicy("not_applicable", [], "Do not change shared lesson pages for a subject request."),
    legalHold(["learning"], "Page structure can contextualize held learning records."),
  ),
  lesson_learning_time_sessions: table(
    "lesson_learning_time_sessions",
    relation(
      "direct",
      ["user_id"],
      ["courses", "course_versions"],
      "user_id directly identifies the learner whose visible and focused lesson time was measured.",
    ),
    exportPolicy(
      "sanitized",
      "Include the bound course version, stored snapshot lesson title, credited active seconds and lifecycle timestamps, but omit the internal anti-replay sequence.",
      { excludedColumns: ["last_sequence"] },
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete measured learning time unless approved learning-evidence retention requires pseudonymization.",
    ),
    legalHold(
      ["learning"],
      "Measured active learning time is part of the tenant's learning evidence.",
    ),
  ),
  lesson_progress: table(
    "lesson_progress",
    relation(
      "direct",
      ["user_id"],
      ["lessons"],
      "user_id directly identifies the learner whose progress is recorded.",
    ),
    exportPolicy("include", "Include lesson, status, percentage, and lifecycle timestamps."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete progress unless approved learning-evidence retention requires pseudonymization.",
    ),
    legalHold(["learning"], "Lesson progress is learning evidence."),
  ),
  media_playback_progress: table(
    "media_playback_progress",
    relation(
      "direct",
      ["user_id"],
      ["courses", "lessons", "content_blocks", "media_assets"],
      "user_id identifies the learner; course, lesson, block and media references bind the measured required playback.",
    ),
    exportPolicy(
      "include",
      "Include watched and required milliseconds, furthest position, completion and update timestamps.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete required-media progress unless approved learning evidence requires pseudonymization.",
    ),
    legalHold(["learning", "media"], "Required playback is learning and media evidence."),
  ),
  lessons: table(
    "lessons",
    relation(
      "none",
      [],
      ["modules"],
      "Lessons are shared instructional content without a subject identifier.",
    ),
    exportPolicy("context_only", "Use lesson labels and rules to contextualize subject records."),
    erasurePolicy("not_applicable", [], "Do not alter shared lessons for an individual request."),
    legalHold(["learning"], "Lesson context may accompany held progress or assessments."),
  ),
  media_assets: table(
    "media_assets",
    relation(
      "mixed",
      ["uploaded_by_id", "owner_user_id", "original_file_name"],
      [],
      "owner_user_id identifies personal ownership, uploaded_by_id identifies an actor, and file names can contain personal data.",
    ),
    exportPolicy(
      "sanitized",
      "Include safe metadata and a binary manifest; never expose storage identities, worker claims, malware details, or internal diagnostics.",
      {
        excludedColumns: [
          "storage_key",
          "staging_storage_key",
          "etag",
          "staging_storage_version_id",
          "storage_version_id",
          "scan_claim_token",
          "scan_failure_detail",
          "malware_signature",
        ],
      },
    ),
    erasurePolicy(
      "storage_purge_then_delete",
      ["legal_hold_clear", "storage_purge_verified", "shared_resource_review"],
      "Delete subject-owned personal media only after every immutable storage version is verified absent; shared course media requires review.",
    ),
    legalHold(["media"], "Binary objects and their safe metadata are governed by media holds."),
  ),
  media_upload_sessions: table(
    "media_upload_sessions",
    relation(
      "indirect",
      ["asset_id"],
      ["media_assets"],
      "asset_id resolves the owner or uploader through the associated media asset; the remaining fields are transient upload control state.",
    ),
    exportPolicy(
      "internal_only",
      "Do not export multipart provider identities or initialization tokens; subject-facing exports use the associated media asset projection.",
      { excludedColumns: ["initialization_token", "provider_upload_id"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["parent_erasure"],
      "Remove the transient multipart session with its media asset or when the upload expires or is cancelled.",
    ),
    legalHold(
      [],
      "Multipart upload sessions are transient transport control state and are not retained as legal evidence.",
    ),
  ),
  media_asset_derivatives: table(
    "media_asset_derivatives",
    relation(
      "indirect",
      ["source_asset_id", "processing_job_id"],
      ["media_assets", "media_processing_jobs"],
      "The source asset resolves owner and uploader relationships while the job resolves its requesting actor.",
    ),
    exportPolicy(
      "metadata_only",
      "Include safe derivative kind, MIME type, size, dimensions and duration through subject-related source media; exclude storage identity and digest.",
      { excludedColumns: ["storage_key", "content_sha256"] },
    ),
    erasurePolicy(
      "storage_purge_then_delete",
      ["legal_hold_clear", "storage_purge_verified", "parent_erasure"],
      "Physically purge the immutable derivative before deleting its database record.",
    ),
    legalHold(["media"], "Derived media follows the source media hold."),
  ),
  media_asset_transcripts: table(
    "media_asset_transcripts",
    relation(
      "indirect",
      ["source_asset_id", "processing_job_id", "document"],
      ["media_assets", "media_processing_jobs"],
      "The source and requesting job provide indirect subject relationships; transcript text can mention additional people.",
    ),
    exportPolicy(
      "manual_review",
      "Shared instructional transcript content is not automatically included in a subject export; review subject-specific source ownership and transcript text.",
      { excludedColumns: ["source_content_sha256"], reviewColumns: ["document"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear", "parent_erasure", "shared_resource_review"],
      "Delete with a personal source or retain shared instructional transcripts after review.",
    ),
    legalHold(["media", "learning"], "Transcripts can be shared learning content and media metadata."),
  ),
  media_processing_jobs: table(
    "media_processing_jobs",
    relation(
      "mixed",
      ["requested_by_id", "source_asset_id"],
      ["media_assets"],
      "requested_by_id identifies the actor and source_asset_id can identify its owner or uploader.",
    ),
    exportPolicy(
      "metadata_only",
      "Include safe job type, provider, status and lifecycle timestamps for subject-requested or subject-owned media; exclude claims, source digest, options and diagnostics.",
      {
        excludedColumns: [
          "request_key",
          "source_content_sha256",
          "options",
          "claim_token",
          "failure_detail",
        ],
      },
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Cancel active personal jobs and unlink requesting actors; shared-source processing evidence follows source retention.",
    ),
    legalHold(["media", "audit"], "Processing state can evidence media integrity and operations."),
  ),
  member_bundles: table(
    "member_bundles",
    relation(
      "direct",
      ["user_id"],
      ["bundles"],
      "user_id directly identifies the bundle recipient.",
    ),
    exportPolicy("include", "Include assigned bundle and assignment timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete direct bundle assignments for the subject."),
    legalHold(["learning"], "Bundle assignment is learning-access evidence."),
  ),
  member_data_profiles: table(
    "member_data_profiles",
    relation(
      "direct",
      ["user_id", "name"],
      ["data_profile_definitions"],
      "user_id identifies the profile owner and the profile name can itself contain subject context.",
    ),
    exportPolicy("include", "Include profile name, definition, default and active state, and lifecycle timestamps."),
    erasurePolicy("cascade_delete", ["legal_hold_clear"], "Delete the subject's named profiles and cascade their values."),
    legalHold(["profile"], "Named data profiles are governed by profile holds."),
  ),
  member_sidebar_links: table(
    "member_sidebar_links",
    relation(
      "embedded",
      ["label", "description", "href"],
      [],
      "Shared tenant navigation has no subject key, but its label, description, or target can contain incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Review shared link text and targets only when a reported value is plausibly related to the subject.",
      { reviewColumns: ["label", "description", "href"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal navigation content without deleting unrelated shared links.",
    ),
    legalHold(
      ["profile"],
      "Shared navigation content can contextualize a held profile-related link.",
    ),
  ),
  member_welcome_acknowledgements: table(
    "member_welcome_acknowledgements",
    relation(
      "direct",
      ["user_id"],
      [],
      "user_id identifies the member who confirmed a specific tenant welcome configuration version.",
    ),
    exportPolicy(
      "include",
      "Include the confirmed configuration version and acknowledgement timestamp for the subject.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the member acknowledgement so no onboarding state remains linked to the subject.",
    ),
    legalHold(
      ["profile"],
      "Welcome acknowledgement state can be covered by a profile lifecycle hold.",
    ),
  ),
  member_welcome_settings: table(
    "member_welcome_settings",
    relation(
      "embedded",
      ["title", "welcome_text", "video_url"],
      [],
      "Shared tenant welcome copy and the optional video URL can contain incidental personal information without a subject key.",
    ),
    exportPolicy(
      "manual_review",
      "Do not export shared welcome configuration wholesale; review configurable copy and media links only when a subject is named.",
      { reviewColumns: ["title", "welcome_text", "video_url"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal values while preserving the unrelated tenant-wide onboarding configuration.",
    ),
    legalHold(
      ["profile"],
      "Profile-oriented onboarding configuration can be covered by a profile hold.",
    ),
  ),
  mfa_login_challenges: table(
    "mfa_login_challenges",
    relation(
      "direct",
      ["user_id", "organization_id", "auth_method", "oidc_identity_id"],
      ["users"],
      "user_id identifies the privileged account completing a short-lived second-factor login challenge and OIDC provenance can reference its linked identity.",
    ),
    exportPolicy(
      "metadata_only",
      "Include challenge mode, authentication method, expiry, consumption, and creation timestamps without bearer-equivalent hashes or internal identity bindings.",
      { excludedColumns: ["jti_hash", "oidc_identity_id"] },
    ),
    erasurePolicy(
      "expire",
      [],
      "Delete consumed or expired challenges through the bounded 24-hour operational cleanup; challenge credentials are never retained for a legal hold.",
    ),
    legalHold(
      [],
      "Short-lived challenge credentials are excluded from holds and are purged after the documented operational window.",
    ),
  ),
  module_sections: table(
    "module_sections",
    relation(
      "none",
      [],
      ["modules"],
      "Module sections are shared instructional structure.",
    ),
    exportPolicy("context_only", "Use section labels and unlock rules to explain subject progress."),
    erasurePolicy("not_applicable", [], "Do not alter shared sections for a subject request."),
    legalHold(["learning"], "Section context may accompany held learning records."),
  ),
  modules: table(
    "modules",
    relation(
      "embedded",
      ["title", "description", "folder"],
      [],
      "Modules lack creator attribution but descriptive text can contain incidental personal data.",
    ),
    exportPolicy(
      "manual_review",
      "Use module labels as learning context and review free text only when embedded subject data is reported.",
      { reviewColumns: ["title", "description", "folder"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal data while preserving shared modules.",
    ),
    legalHold(["learning"], "Module context may accompany held learning evidence."),
  ),
  notifications: table(
    "notifications",
    relation(
      "direct",
      ["user_id", "title", "body", "href"],
      [],
      "user_id identifies the recipient and notification text or links may contain further subject data.",
    ),
    exportPolicy("include", "Include title, body, type, link, read state, and timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete subject notifications."),
    legalHold(["communications"], "Notifications are covered by communications holds."),
  ),
  user_notification_preferences: table(
    "user_notification_preferences",
    relation(
      "direct",
      ["user_id", "organization_id", "category"],
      ["users"],
      "The tenant-bound user and category identify personal delivery-channel choices.",
    ),
    exportPolicy(
      "include",
      "Include category, email and push choices plus the last update timestamp.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the subject's notification delivery preferences.",
    ),
    legalHold(
      ["communications"],
      "Preference history can accompany held communications evidence.",
    ),
  ),
  push_notification_deliveries: table(
    "push_notification_deliveries",
    relation(
      "direct",
      ["user_id", "notification_id", "subscription_id"],
      ["notifications", "web_push_subscriptions"],
      "user_id identifies the recipient while the linked notification contains the delivered subject content.",
    ),
    exportPolicy(
      "metadata_only",
      "Include delivery state, attempt count and lifecycle timestamps without endpoint credentials or internal failure text.",
      { excludedColumns: ["response_body"] },
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear", "parent_erasure"],
      "Delete with the subject notification or push subscription after applicable communications holds are cleared.",
    ),
    legalHold(
      ["communications"],
      "Terminal delivery evidence can be covered by a communications hold.",
    ),
  ),
  oidc_configurations: table(
    "oidc_configurations",
    relation(
      "none",
      [],
      [],
      "The tenant OIDC configuration is shared authentication infrastructure and has no subject key.",
    ),
    exportPolicy(
      "context_only",
      "Include enabled state, display name, auto-provisioning and domain policy, password-login policy, version, and lifecycle timestamps; never export issuer or client credentials.",
      {
        excludedColumns: [
          "issuer",
          "client_secret_encrypted",
          "client_id",
        ],
      },
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "An individual request never changes shared tenant authentication configuration.",
    ),
    legalHold(
      ["authentication"],
      "Authentication configuration can contextualize held sign-in evidence.",
    ),
  ),
  oidc_identities: table(
    "oidc_identities",
    relation(
      "direct",
      ["user_id", "issuer", "subject", "email_at_link"],
      [],
      "user_id and the provider subject identify the linked account; email_at_link records the verified email used at first link.",
    ),
    exportPolicy(
      "include",
      "Include issuer, subject, linked email, last proven configuration version, creation time, and last SSO login time.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Delete the external identity link before or with the local account.",
    ),
    legalHold(
      ["authentication"],
      "External identity links can be authentication evidence.",
    ),
  ),
  organizations: table(
    "organizations",
    relation(
      "none",
      [],
      [],
      "The tenant record is controller configuration and does not identify one data subject.",
    ),
    exportPolicy("context_only", "Include only tenant name and identifier needed to contextualize the subject package."),
    erasurePolicy("not_applicable", [], "A user request never deletes the tenant record."),
    legalHold([], "Tenant configuration is outside subject-scoped legal holds."),
  ),
  organization_mfa_policies: table(
    "organization_mfa_policies",
    relation(
      "none",
      [],
      [],
      "The row is tenant security configuration and contains no direct subject identifier or secret material.",
    ),
    exportPolicy(
      "context_only",
      "Use the required flag and revision only as authentication-policy context; it is not subject-owned profile data.",
    ),
    erasurePolicy(
      "not_applicable",
      [],
      "Delete through tenant lifecycle only because the policy belongs to the organization rather than an individual subject.",
    ),
    legalHold(
      ["authentication"],
      "The tenant authentication policy can be retained as context for authentication evidence.",
    ),
  ),
  password_reset_tokens: table(
    "password_reset_tokens",
    relation(
      "direct",
      ["user_id"],
      [],
      "user_id identifies the account for which the reset credential was issued.",
    ),
    exportPolicy(
      "metadata_only",
      "Include creation, expiry, and use timestamps without the token hash.",
      { excludedColumns: ["token_hash"] },
    ),
    erasurePolicy("delete", [], "Invalidate and delete all reset credentials immediately."),
    legalHold([], "Live or expired bearer credential material is never retained by a legal hold."),
  ),
  platform_settings: table(
    "platform_settings",
    relation(
      "embedded",
      ["key", "value"],
      [],
      "Tenant setting JSON, including locale-specific email template sets, can contain contact details, branding links, or other embedded personal data without a subject key.",
    ),
    exportPolicy(
      "manual_review",
      "Do not export tenant settings or localized email templates wholesale; review only the reported setting for confirmed subject-specific values.",
      { reviewColumns: ["value"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "shared_resource_review"],
      "Redact confirmed personal values while preserving shared tenant configuration and unrelated locale-specific email templates.",
    ),
    legalHold(["profile"], "Profile-related tenant settings can be held with profile data."),
  ),
  point_transactions: table(
    "point_transactions",
    relation(
      "direct",
      ["user_id", "reason", "entity_type", "entity_id"],
      [],
      "user_id identifies the recipient and the reason or entity can add subject context.",
    ),
    exportPolicy("include", "Include amount, reason, source entity, and timestamp."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete transactions or pseudonymize retained aggregate evidence according to the gamification policy.",
    ),
    legalHold(["gamification"], "Point history is governed by gamification holds."),
  ),
  post_likes: table(
    "post_likes",
    relation(
      "direct",
      ["user_id"],
      ["posts"],
      "user_id directly identifies the member who reacted to a post.",
    ),
    exportPolicy("include", "Include the reacted-to post, reaction type, and timestamp."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete reactions made by the subject."),
    legalHold(["community"], "Community reactions are covered by community holds."),
  ),
  post_votes: table(
    "post_votes",
    relation(
      "direct",
      ["user_id", "value"],
      ["posts"],
      "user_id identifies the voting subject and value records their discussion vote.",
    ),
    exportPolicy("include", "Include the discussion post identity, vote value, and lifecycle timestamps."),
    erasurePolicy("delete", ["legal_hold_clear"], "Delete discussion votes made by the subject."),
    legalHold(["community"], "Discussion votes are covered by community holds."),
  ),
  posts: table(
    "posts",
    relation(
      "mixed",
      [
        "author_id",
        "moderated_by_id",
        "linked_course_id",
        "title",
        "content",
        "rich_text",
        "image_url",
      ],
      ["community_spaces", "courses"],
      "author_id identifies the subject as author, moderated_by_id is internal moderator attribution, linked_course_id is typed course context, and the plain projection, rich-text document, or image references can contain additional personal data.",
    ),
    exportPolicy(
      "sanitized",
      "Include authored content, typed course context, and safe publication state while excluding moderator identity and internal moderation fingerprints or versions.",
      {
        excludedColumns: [
          "moderation_version",
          "moderation_fingerprint",
          "moderated_by_id",
        ],
      },
    ),
    erasurePolicy(
      "pseudonymize",
      ["legal_hold_clear", "storage_purge_verified"],
      "Purge managed personal media, then replace authored post content with a plain removal marker and discard its rich-text document while preserving discussion integrity.",
    ),
    legalHold(["community", "media"], "Posts can be held as community content and media."),
  ),
  privacy_export_artifacts: table(
    "privacy_export_artifacts",
    relation(
      "privacy_case",
      ["request_id"],
      ["privacy_requests"],
      "The artifact belongs to a privacy request and therefore inherits its subject reference.",
    ),
    exportPolicy(
      "internal_only",
      "The artifact row is operational control data; deliver the artifact contents, not storage identity or worker diagnostics.",
      {
        excludedColumns: [
          "storage_key",
          "storage_version_id",
          "storage_etag",
          "failure_detail",
        ],
      },
    ),
    erasurePolicy(
      "storage_purge_then_delete",
      ["storage_purge_verified", "parent_erasure"],
      "Expire and physically purge the generated package before deleting its control row under the artifact retention policy.",
    ),
    legalHold(["audit"], "Artifact digests and lifecycle evidence belong to the privacy audit record."),
  ),
  privacy_legal_holds: table(
    "privacy_legal_holds",
    relation(
      "privacy_case",
      [
        "request_id",
        "subject_user_id",
        "subject_reference",
        "created_by_id",
        "released_by_id",
      ],
      ["privacy_requests"],
      "The row identifies the held subject by user and HMAC reference and records creator or releaser actors.",
    ),
    exportPolicy(
      "internal_only",
      "Do not expose legal strategy automatically; provide an approved subject-facing summary when required.",
      { reviewColumns: ["reason", "legal_basis", "release_reason"] },
    ),
    erasurePolicy(
      "retain",
      ["retention_decision"],
      "Retain the hold record and pseudonymous subject reference for the approved legal retention period.",
    ),
    legalHold(["audit"], "The hold definition itself is retained as privacy audit evidence."),
  ),
  privacy_request_events: table(
    "privacy_request_events",
    relation(
      "privacy_case",
      ["request_id", "actor_reference", "metadata"],
      ["privacy_requests"],
      "The request resolves the subject and actor_reference is an immutable HMAC identifier for the acting principal.",
    ),
    exportPolicy(
      "internal_only",
      "Expose only an approved subject-facing status history; internal actor references and metadata remain audit-only.",
      { reviewColumns: ["metadata"] },
    ),
    erasurePolicy(
      "retain",
      ["retention_decision"],
      "The append-only event remains immutable for the privacy audit retention period.",
    ),
    legalHold(["audit"], "Request events are themselves privacy audit evidence."),
  ),
  privacy_requests: table(
    "privacy_requests",
    relation(
      "privacy_case",
      [
        "subject_user_id",
        "subject_reference",
        "requested_by_id",
        "identity_verified_by_id",
        "approved_by_id",
        "policy_snapshot",
      ],
      [],
      "The request directly identifies its subject by user and HMAC reference and records each responsible actor.",
    ),
    exportPolicy(
      "sanitized",
      "Include a subject-facing case summary without worker claims, internal reasons, or unrestricted policy internals.",
      {
        excludedColumns: [
          "processing_claim_token",
          "processing_claimed_at",
          "processing_lease_expires_at",
        ],
        reviewColumns: ["policy_snapshot", "status_reason"],
      },
    ),
    erasurePolicy(
      "retain",
      ["retention_decision"],
      "Retain a pseudonymous request receipt and lifecycle evidence for the approved privacy audit period.",
    ),
    legalHold(["audit"], "Privacy request records are audit evidence."),
  ),
  submission_attachments: table(
    "submission_attachments",
    relation(
      "indirect",
      ["submission_id", "media_asset_id"],
      ["submissions", "media_assets"],
      "The parent submission identifies the subject and media_asset_id identifies the binary object.",
    ),
    exportPolicy("metadata_only", "Include safe attachment metadata and reference the verified binary export manifest."),
    erasurePolicy(
      "storage_purge_then_delete",
      ["legal_hold_clear", "storage_purge_verified", "parent_erasure"],
      "Purge the linked binary object before removing the attachment through submission erasure.",
    ),
    legalHold(["learning", "media"], "Attachments are both learning evidence and media."),
  ),
  submission_review_annotations: table(
    "submission_review_annotations",
    relation(
      "indirect",
      ["review_id", "submission_id", "body", "media_asset_id"],
      ["submission_reviews", "submissions", "media_assets"],
      "The parent review and submission identify the learner while body can contain evaluator-authored personal data.",
    ),
    exportPolicy(
      "include",
      "Include immutable annotation body, type, safe target coordinates, media reference, ordering, and timestamp.",
    ),
    erasurePolicy(
      "cascade_delete",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Delete with the parent review or retain only under the approved learning-evidence policy.",
    ),
    legalHold(
      ["learning", "media"],
      "Review annotations are learning evidence and can refer to retained submission media.",
    ),
  ),
  submission_reviews: table(
    "submission_reviews",
    relation(
      "mixed",
      ["submission_id", "reviewer_id", "feedback"],
      ["submissions"],
      "The parent submission identifies the learner while reviewer_id identifies the evaluating actor.",
    ),
    exportPolicy("include", "Include decision, feedback, score, reviewer relationship, and review timestamp."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision", "parent_erasure"],
      "Delete with the submission or pseudonymize retained learning-evidence and reviewer attribution.",
    ),
    legalHold(["learning"], "Submission reviews are learning evidence."),
  ),
  submissions: table(
    "submissions",
    relation(
      "mixed",
      ["user_id", "reviewer_id", "content", "rich_text", "file_name"],
      [],
      "user_id identifies the learner, reviewer_id the evaluator, and plain or structured content and file names may contain additional subject data.",
    ),
    exportPolicy("include", "Include all attempts, lineage, sanitized structured content, its immutable text projection, scores, feedback, status, and timestamps."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision", "storage_purge_verified"],
      "Purge attachments first, then delete submissions or pseudonymize only the approved learning evidence.",
    ),
    legalHold(["learning", "media"], "Submissions and their file references are learning and media evidence."),
  ),
  team_role_assignments: table(
    "team_role_assignments",
    relation(
      "mixed",
      ["user_id", "assigned_by_id", "role_id"],
      ["users", "team_roles"],
      "user_id identifies the staff subject while assigned_by_id identifies the owner who made the access-control decision.",
    ),
    exportPolicy(
      "include",
      "Include the assigned role reference and assignment timestamp as part of the subject's account-access configuration.",
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete the subject assignment with the account; unlink an erased assigning actor while preserving required access-control evidence.",
    ),
    legalHold(["audit"], "Role assignments can be retained as access-control audit evidence."),
  ),
  team_roles: table(
    "team_roles",
    relation(
      "actor",
      ["created_by_id"],
      ["users"],
      "The role is tenant configuration; created_by_id identifies the creating owner.",
    ),
    exportPolicy(
      "context_only",
      "Include role name and effective permission context only when needed to explain a subject assignment.",
    ),
    erasurePolicy(
      "unlink",
      ["retention_decision"],
      "Unlink the creator attribution while retaining shared tenant role configuration.",
    ),
    legalHold(["audit"], "Role definitions can be retained as access-control audit context."),
  ),
  user_badges: table(
    "user_badges",
    relation(
      "direct",
      ["user_id", "source"],
      ["badge_definitions"],
      "user_id identifies the award recipient and source explains why the award was granted.",
    ),
    exportPolicy("include", "Include badge context, source, and award timestamp."),
    erasurePolicy(
      "delete_or_pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Delete awards or pseudonymize retained aggregate evidence under the gamification policy.",
    ),
    legalHold(["gamification"], "Badge awards are governed by gamification holds."),
  ),
  user_mfa_configurations: table(
    "user_mfa_configurations",
    relation(
      "direct",
      ["user_id", "organization_id"],
      ["users"],
      "user_id directly identifies the privileged account protected by the encrypted TOTP credential and hashed recovery set.",
    ),
    exportPolicy(
      "metadata_only",
      "Include activation status, enabled timestamp, lifecycle timestamps, and only the remaining recovery-code count; never export the encrypted secret, hashes, or replay counter.",
      {
        excludedColumns: [
          "secret_encrypted",
          "recovery_code_hashes",
          "last_totp_counter",
        ],
      },
    ),
    erasurePolicy(
      "revoke_and_unlink",
      ["revoke_credentials"],
      "Delete the MFA configuration during credential revocation; abandoned pending enrollment is purged after 24 hours.",
    ),
    legalHold(
      [],
      "TOTP secrets and recovery verifiers are credential material and are never retained for a legal hold.",
    ),
  ),
  user_sessions: table(
    "user_sessions",
    relation(
      "direct",
      ["user_id", "ip_address", "user_agent"],
      [],
      "user_id identifies the account and network or client fields are additional personal data.",
    ),
    exportPolicy(
      "sanitized",
      "Include authentication method, second-factor method and timestamp, OIDC configuration provenance, session lifecycle, IP address, and user agent without the authentication token hash or internal identity key.",
      { excludedColumns: ["jti_hash", "oidc_identity_id"] },
    ),
    erasurePolicy("delete", [], "Revoke and delete every subject session before further erasure."),
    legalHold(["authentication"], "Session metadata can be held as authentication evidence, never the token hash."),
  ),
  users: table(
    "users",
    relation(
      "direct",
      [
        "id",
        "email",
        "first_name",
        "last_name",
        "avatar_url",
        "job_title",
        "department",
        "phone",
        "bio",
        "preferred_locale",
        "last_login_at",
      ],
      [],
      "The user row is the primary subject identity and profile record.",
    ),
    exportPolicy(
      "sanitized",
      "Include account, profile, and language preference data without password credential material.",
      { excludedColumns: ["password_hash"] },
    ),
    erasurePolicy(
      "delete_or_pseudonymize",
      [
        "legal_hold_clear",
        "retention_decision",
        "revoke_credentials",
        "storage_purge_verified",
      ],
      "Delete the user only after dependent data and storage are resolved, or pseudonymize the minimum retained identity.",
    ),
    legalHold(["profile"], "The core identity is governed by profile holds."),
  ),
  web_push_subscriptions: table(
    "web_push_subscriptions",
    relation(
      "direct",
      ["user_id", "organization_id", "session_id"],
      ["users", "user_sessions"],
      "user_id and session_id identify the browser subscription owner and login session; the encrypted payload contains a capability endpoint and client encryption keys.",
    ),
    exportPolicy(
      "metadata_only",
      "Include subscription count, expiry and lifecycle timestamps without endpoint hashes, endpoints or client key material.",
      { excludedColumns: ["endpoint_hash", "subscription_encrypted"] },
    ),
    erasurePolicy(
      "revoke_and_unlink",
      ["revoke_credentials"],
      "Delete browser subscriptions during credential revocation so no future push can be delivered.",
    ),
    legalHold(
      [],
      "Push capability endpoints and client keys are credential material and are never retained for a legal hold.",
    ),
  ),
  commerce_provider_connections: table(
    "commerce_provider_connections",
    relation(
      "actor",
      ["created_by_id"],
      [],
      "created_by_id identifies the owner who configured the sales provider.",
    ),
    exportPolicy(
      "metadata_only",
      "Include provider, signature mode, status, and timestamps without endpoint capability or signing secret.",
      { excludedColumns: ["endpoint_key", "signing_secret_encrypted"] },
    ),
    erasurePolicy(
      "revoke_and_unlink",
      ["legal_hold_clear", "shared_resource_review"],
      "Transfer creator attribution; shared provider configuration is not deleted with one administrator.",
    ),
    legalHold(["integrations"], "Sales-provider administration is integration evidence."),
  ),
  commerce_products: table(
    "commerce_products",
    relation("none", [], [], "Tenant product configuration has no direct subject relation."),
    exportPolicy("exclude", "Product catalog configuration is not subject data.", {
      excludedColumns: ["metadata"],
    }),
    erasurePolicy("not_applicable", [], "Product catalog rows are shared configuration."),
    legalHold(["integrations"], "Product mappings can be held as integration configuration."),
  ),
  commerce_product_mappings: table(
    "commerce_product_mappings",
    relation("none", [], [], "Provider product identifiers do not identify a member."),
    exportPolicy("exclude", "Provider mapping configuration is not subject data.", {
      excludedColumns: ["provider_product_id", "provider_variant_id"],
    }),
    erasurePolicy("not_applicable", [], "Mappings are shared tenant configuration."),
    legalHold(["integrations"], "Provider mappings can be held as integration configuration."),
  ),
  commerce_orders: table(
    "commerce_orders",
    relation(
      "direct",
      ["user_id", "customer_email"],
      ["users"],
      "The linked member and normalized buyer email identify the purchaser.",
    ),
    exportPolicy(
      "include",
      "Include normalized order identifiers, amount, currency, status, and lifecycle timestamps.",
    ),
    erasurePolicy(
      "pseudonymize",
      ["legal_hold_clear", "retention_decision"],
      "Unlink the member and pseudonymize buyer email while retaining the minimum accounting record when required.",
    ),
    legalHold(["integrations"], "Orders may be retained as contractual or accounting evidence."),
  ),
  commerce_subscriptions: table(
    "commerce_subscriptions",
    relation("direct", ["user_id"], ["users"], "user_id identifies the subscription owner."),
    exportPolicy("include", "Include normalized subscription status and term timestamps."),
    erasurePolicy(
      "delete",
      ["legal_hold_clear", "retention_decision"],
      "End access and delete the subject subscription after retention review.",
    ),
    legalHold(["integrations"], "Subscription lifecycle can be contractual evidence."),
  ),
  commerce_entitlements: table(
    "commerce_entitlements",
    relation("direct", ["user_id"], ["users"], "user_id identifies the access beneficiary."),
    exportPolicy("include", "Include product, bundle, source, state, and access window."),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Revoke source-specific course grants and delete the entitlement.",
    ),
    legalHold(["integrations", "learning"], "Entitlement history can evidence course access."),
  ),
  commerce_inbound_events: table(
    "commerce_inbound_events",
    relation(
      "embedded",
      ["normalized_payload"],
      ["commerce_orders"],
      "The normalized payload can contain buyer email and provider references; raw payload content is never stored.",
    ),
    exportPolicy(
      "sanitized",
      "Include normalized lifecycle metadata without payload hash or buyer email duplication.",
      { excludedColumns: ["payload_hash"], reviewColumns: ["normalized_payload"] },
    ),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear", "retention_decision"],
      "Remove buyer identity from normalized payload while retaining idempotency references where required.",
    ),
    legalHold(["integrations"], "Verified inbound lifecycle events can be integration evidence."),
  ),
  commerce_outbox_events: table(
    "commerce_outbox_events",
    relation(
      "embedded",
      ["payload"],
      [],
      "Event payloads can contain member and entitlement identifiers.",
    ),
    exportPolicy("sanitized", "Include subject events with event-specific payload redaction.", {
      reviewColumns: ["payload"],
    }),
    erasurePolicy(
      "review_and_redact",
      ["legal_hold_clear"],
      "Replace subject-bearing payloads with a redaction marker.",
    ),
    legalHold(["integrations", "audit"], "Outbox events can evidence integration delivery."),
  ),
  automation_workflow_connections: table(
    "automation_workflow_connections",
    relation("actor", ["created_by_id"], [], "created_by_id identifies the configuring owner."),
    exportPolicy("metadata_only", "Include workflow name and lifecycle without target URL or secret."),
    erasurePolicy(
      "revoke_and_unlink",
      ["shared_resource_review"],
      "Unlink creator attribution without deleting a shared n8n workflow.",
    ),
    legalHold(["integrations"], "Workflow configuration is integration evidence."),
  ),
  organization_support_settings: table(
    "organization_support_settings",
    relation("none", [], [], "Support settings are shared tenant configuration."),
    exportPolicy("exclude", "Shared support configuration is not subject data.", {
      excludedColumns: ["identity_secret_encrypted"],
    }),
    erasurePolicy("not_applicable", [], "Support configuration is not erased with one member."),
    legalHold(["integrations"], "Support configuration can be held as integration configuration."),
  ),
  tenant_erasure_receipts: table(
    "tenant_erasure_receipts",
    relation(
      "actor",
      ["approved_by", "legal_basis", "policy_manifest"],
      [],
      "The retained organization-level deletion receipt identifies the approving operator and can contain the approved legal rationale without retaining tenant member rows.",
    ),
    exportPolicy(
      "internal_only",
      "Keep the deletion receipt in the restricted accountability archive; it is not part of a member DSAR after the tenant has been removed.",
      { reviewColumns: ["approved_by", "legal_basis", "policy_manifest"] },
    ),
    erasurePolicy(
      "retain",
      ["retention_decision"],
      "The receipt is immutable evidence that export, waiting period, storage purge and the authorized relational cascade were completed.",
    ),
    legalHold(
      ["audit"],
      "Tenant deletion receipts are accountability evidence governed by the audit retention decision.",
    ),
  ),
  tenant_erasure_events: table(
    "tenant_erasure_events",
    relation(
      "indirect",
      ["receipt_id", "metadata"],
      ["tenant_erasure_receipts"],
      "The append-only event resolves to an organization deletion receipt and contains only operational evidence hashes, counts and timestamps.",
    ),
    exportPolicy(
      "internal_only",
      "Keep the deletion event chain with the restricted receipt and never include it in a former member export.",
      { reviewColumns: ["metadata"] },
    ),
    erasurePolicy(
      "retain",
      ["retention_decision", "parent_erasure"],
      "The append-only event remains with its retained deletion receipt for the approved accountability period.",
    ),
    legalHold(
      ["audit"],
      "Tenant deletion events are accountability evidence governed by the audit retention decision.",
    ),
  ),
  webhook_deliveries: table(
    "webhook_deliveries",
    relation(
      "embedded",
      ["event", "payload", "response_body"],
      ["webhooks"],
      "Webhook payloads can embed member, enrollment, submission, feedback, community, or event subject data without a dedicated subject key.",
    ),
    exportPolicy(
      "manual_review",
      "Locate subject-bearing payloads through event-specific selectors and sanitize third-party response data before export.",
      { reviewColumns: ["payload", "response_body"] },
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear"],
      "Cancel pending subject deliveries and delete terminal payloads that contain the subject after integration retention review.",
    ),
    legalHold(["integrations", "communications"], "Deliveries can be integration and communication evidence."),
  ),
  webhook_delivery_attempts: table(
    "webhook_delivery_attempts",
    relation(
      "indirect",
      ["delivery_id", "webhook_id"],
      ["webhook_deliveries", "webhooks"],
      "The immutable attempt metadata resolves through its tenant-bound delivery; no payload or response body is retained in the attempt row.",
    ),
    exportPolicy(
      "metadata_only",
      "Include the generation, attempt number, outcome, sanitized failure class, duration, and timestamps when the parent delivery is in scope.",
    ),
    erasurePolicy(
      "delete",
      ["legal_hold_clear", "parent_erasure"],
      "Delete attempts only through parent delivery retention, webhook deletion, or the authorized tenant-erasure cascade.",
    ),
    legalHold(
      ["integrations", "communications"],
      "Attempt metadata can be retained with the parent integration evidence under an applicable hold.",
    ),
  ),
  webhooks: table(
    "webhooks",
    relation(
      "actor",
      ["created_by_id"],
      [],
      "created_by_id identifies the administrator who configured the integration.",
    ),
    exportPolicy(
      "metadata_only",
      "Include integration name, subscribed events, status, and lifecycle timestamps without endpoint or signing secret.",
      { excludedColumns: ["url", "signing_secret_encrypted"] },
    ),
    erasurePolicy(
      "revoke_and_unlink",
      ["legal_hold_clear", "shared_resource_review"],
      "Disable or transfer the integration before unlinking creator attribution; shared integrations are not blindly deleted.",
    ),
    legalHold(["integrations"], "Webhook administration is covered by integration holds."),
  ),
} satisfies Record<string, PrivacyDataInventoryEntry>;

export type PrivacyInventoryTableName = keyof typeof PRIVACY_DATA_INVENTORY;
import { PENDING_SCHEMA_PRIVACY_DATA_INVENTORY } from "@/lib/privacy/pending-schema-inventory";
