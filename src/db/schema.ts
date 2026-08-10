import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgTableExtraConfigValue,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { RichTextDocument } from "@/lib/rich-text/document";
import type {
  GalleryDocument,
  LinkButtonDocument,
} from "@/lib/content-blocks/interactive-documents";
import type { AnnouncementTargetRuleSet } from "@/lib/announcement-rules";
import type { AnnouncementContentDocument } from "@/lib/announcement-content";
import type { VideoTranscriptDocument } from "@/lib/content-blocks/video-transcript";
import type { EncryptedPayload } from "@/lib/encryption-keyring";
import type { ContentBlockStyle } from "@/lib/content-style-model";

export const roleEnum = pgEnum("role", ["owner", "admin", "trainer", "member"]);
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "invited",
  "disabled",
]);
export const organizationStatusEnum = pgEnum("organization_status", [
  "active",
  "suspended",
  "offboarding",
]);
export const courseStatusEnum = pgEnum("course_status", [
  "draft",
  "published",
  "archived",
]);
export const coursePermissionEnum = pgEnum("course_permission", [
  "view",
  "edit",
  "manage",
]);
export const courseModuleAccessModeEnum = pgEnum("course_module_access_mode", [
  "visible",
  "after_previous",
  "delay_days",
  "date_window",
  "coming_soon",
  "locked",
  "hidden",
]);
export const courseModuleAccessStateEnum = pgEnum(
  "course_module_access_state",
  ["available", "read_only", "locked", "hidden"],
);
export const courseModuleAccessRequestStatusEnum = pgEnum(
  "course_module_access_request_status",
  ["pending", "approved", "rejected", "cancelled"],
);
export const learningContentVisibilityEnum = pgEnum(
  "learning_content_visibility",
  ["visible", "draft", "coming_soon"],
);
export const courseWidgetTypeEnum = pgEnum("course_widget_type", [
  "author",
  "info",
  "image_link",
]);
export const lessonTypeEnum = pgEnum("lesson_type", [
  "lesson",
  "quiz",
  "assignment",
  "exam",
  "live",
]);
export const moduleKindEnum = pgEnum("module_kind", [
  "learning",
  "exam",
  "link",
]);
export const progressStatusEnum = pgEnum("progress_status", [
  "not_started",
  "in_progress",
  "completed",
]);
export const assessmentAttemptStatusEnum = pgEnum("assessment_attempt_status", [
  "in_progress",
  "submitted",
  "graded",
]);
export const examResultReleaseModeEnum = pgEnum("exam_result_release_mode", [
  "immediate",
  "after_deadline",
  "manual",
]);
export const examReviewReleaseModeEnum = pgEnum("exam_review_release_mode", [
  "never",
  "after_result",
  "manual",
]);
export const examContentAccessModeEnum = pgEnum("exam_content_access_mode", [
  "allow",
  "block_course",
  "block_academy",
]);
export const examFinalizationReasonEnum = pgEnum("exam_finalization_reason", [
  "submitted",
  "timeout",
  "administrator",
]);
export const submissionStatusEnum = pgEnum("submission_status", [
  "open",
  "in_review",
  "revision",
  "approved",
]);
export const submissionReviewDecisionEnum = pgEnum(
  "submission_review_decision",
  ["revision", "approved"],
);
export const submissionReviewAnnotationTypeEnum = pgEnum(
  "submission_review_annotation_type",
  ["text_range", "media_timestamp"],
);
export const feedbackStatusEnum = pgEnum("feedback_status", [
  "new",
  "reviewed",
  "archived",
]);
export const customFieldTypeEnum = pgEnum("custom_field_type", [
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
  "url",
  "media",
]);
export const customFieldVisibilityEnum = pgEnum("custom_field_visibility", [
  "member",
  "trainer",
  "admin",
]);
export const eventTypeEnum = pgEnum("event_type", [
  "live_call",
  "workshop",
  "deadline",
  "webinar",
]);
export const eventAudienceModeEnum = pgEnum("event_audience_mode", [
  "tenant",
  "restricted",
]);
export const eventStatusEnum = pgEnum("event_status", [
  "scheduled",
  "cancelled",
]);
export const eventLifecycleActionEnum = pgEnum("event_lifecycle_action", [
  "created",
  "rescheduled",
  "cancelled",
]);
export const attendanceStatusEnum = pgEnum("attendance_status", [
  "going",
  "maybe",
  "declined",
]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["active", "revoked"]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
  "retrying",
]);
export const emailDeliveryStatusEnum = pgEnum("email_delivery_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
  "retrying",
]);
export const emailFeedbackEventTypeEnum = pgEnum(
  "email_feedback_event_type",
  ["bounce", "complaint"],
);
export const emailBounceKindEnum = pgEnum("email_bounce_kind", [
  "hard",
  "soft",
]);
export const emailSuppressionReasonEnum = pgEnum(
  "email_suppression_reason",
  ["hard_bounce", "soft_bounce", "complaint"],
);
export const emailSuppressionReleaseReasonEnum = pgEnum(
  "email_suppression_release_reason",
  ["address_corrected", "provider_error", "member_request", "other_verified"],
);
export const pushDeliveryStatusEnum = pgEnum("push_delivery_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
  "retrying",
]);
export const notificationCategoryEnum = pgEnum("notification_category", [
  "learning",
  "community",
  "events",
  "feedback",
  "announcements",
  "system",
]);
export const nativePushPlatformEnum = pgEnum("native_push_platform", [
  "ios",
  "android",
]);
export const aiConversationStatusEnum = pgEnum("ai_conversation_status", [
  "active",
  "archived",
]);
export const aiMessageRoleEnum = pgEnum("ai_message_role", [
  "system",
  "user",
  "assistant",
  "tool",
]);
export const aiAgentTypeEnum = pgEnum("ai_agent_type", [
  "learning_coach",
  "knowledge_assistant",
  "form_assistant",
]);
export const aiAgentVersionStateEnum = pgEnum("ai_agent_version_state", [
  "draft",
  "published",
]);
export const aiAgentKnowledgeModeEnum = pgEnum("ai_agent_knowledge_mode", [
  "all_accessible_courses",
  "selected_sources",
]);
export const aiAgentAccessModeEnum = pgEnum("ai_agent_access_mode", [
  "open",
  "restricted",
]);
export const aiAgentAccessSubjectEnum = pgEnum("ai_agent_access_subject", [
  "role",
  "user",
  "group",
  "bundle",
]);
export const aiAgentSourceTypeEnum = pgEnum("ai_agent_source_type", [
  "course_version",
  "manual_text",
  "media_asset",
  "web_url",
]);
export const aiAgentActionTypeEnum = pgEnum("ai_agent_action_type", [
  "course_enrollment",
  "course_unenrollment",
  "group_membership_add",
  "group_membership_remove",
  "bundle_assignment_add",
  "bundle_assignment_remove",
]);
export const aiAgentActionTargetTypeEnum = pgEnum(
  "ai_agent_action_target_type",
  ["course", "group", "bundle"],
);
export const aiAgentMembershipRevocationReasonEnum = pgEnum(
  "ai_agent_membership_revocation_reason",
  ["ai_action", "manual_takeover", "manual_removal"],
);
export const aiAgentActionRequestStatusEnum = pgEnum(
  "ai_agent_action_request_status",
  ["pending", "approved", "rejected", "cancelled", "expired"],
);
export const mediaAssetPurposeEnum = pgEnum("media_asset_purpose", [
  "course_content",
  "submission",
  "community",
  "avatar",
  "branding",
  "profile",
]);
export const mediaAssetKindEnum = pgEnum("media_asset_kind", [
  "image",
  "audio",
  "video",
  "document",
]);
export const mediaAssetStatusEnum = pgEnum("media_asset_status", [
  "pending",
  "uploaded",
  "scanning",
  "ready",
  "quarantined",
  "failed",
  "deleted",
]);
export const mediaStorageDriverEnum = pgEnum("media_storage_driver", [
  "filesystem",
  "s3",
]);
export const MEDIA_UPLOAD_SESSION_STATES = [
  "initializing",
  "recovering",
  "uploading",
  "completing",
  "aborting",
] as const;
export type MediaUploadSessionState =
  (typeof MEDIA_UPLOAD_SESSION_STATES)[number];
export const mediaProcessingJobTypeEnum = pgEnum("media_processing_job_type", [
  "thumbnail",
  "transcode",
  "transcript",
]);
export const mediaProcessingJobStatusEnum = pgEnum(
  "media_processing_job_status",
  ["queued", "processing", "succeeded", "failed", "cancelled"],
);
export const mediaDerivativeKindEnum = pgEnum("media_derivative_kind", [
  "thumbnail",
  "transcode",
]);
export const privacyRequestTypeEnum = pgEnum("privacy_request_type", [
  "access_export",
  "erasure",
]);
export const privacyRequestStatusEnum = pgEnum("privacy_request_status", [
  "received",
  "identity_verified",
  "approved",
  "processing",
  "blocked",
  "completed",
  "rejected",
  "cancelled",
  "failed",
]);
export const privacyLegalHoldScopeEnum = pgEnum("privacy_legal_hold_scope", [
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
]);
export const privacyExportArtifactStatusEnum = pgEnum(
  "privacy_export_artifact_status",
  ["building", "ready", "failed", "deleted"],
);
export const privacyExportArtifactFormatEnum = pgEnum(
  "privacy_export_artifact_format",
  ["json", "zip"],
);
export const privacyExportStorageDriverEnum = pgEnum(
  "privacy_export_storage_driver",
  ["filesystem", "s3"],
);
export const communityReportTargetTypeEnum = pgEnum(
  "community_report_target_type",
  ["post", "comment"],
);
export const communityReportReasonEnum = pgEnum("community_report_reason", [
  "spam",
  "harassment",
  "hate_speech",
  "misinformation",
  "privacy",
  "other",
]);
export const communityReportStatusEnum = pgEnum("community_report_status", [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);
export const communityReportOutcomeEnum = pgEnum("community_report_outcome", [
  "dismissed",
  "content_removed",
  "content_missing",
]);
export const communitySpaceTypeEnum = pgEnum("community_space_type", [
  "feed",
  "discussion",
  "announcement",
]);
export const communitySpaceAccessModeEnum = pgEnum(
  "community_space_access_mode",
  ["open", "restricted"],
);
export const communityAccessSubjectTypeEnum = pgEnum(
  "community_access_subject_type",
  ["role", "user", "group", "bundle"],
);
export const communityReactionTypeEnum = pgEnum("community_reaction_type", [
  "like",
  "celebrate",
  "insightful",
  "question",
]);
export const badgeGroupDisplayModeEnum = pgEnum("badge_group_display_mode", [
  "all",
  "highest",
]);
export const communityScoreContributionKindEnum = pgEnum(
  "community_score_contribution_kind",
  ["post_reaction", "post_comment", "comment_reply", "comment_reaction"],
);
export const communityFollowTargetTypeEnum = pgEnum(
  "community_follow_target_type",
  ["author", "space"],
);
export const communityAuthorBoostStrengthEnum = pgEnum(
  "community_author_boost_strength",
  ["light", "medium", "high"],
);
export const communityContentStateEnum = pgEnum("community_content_state", [
  "pending",
  "published",
  "held",
  "rejected",
]);
export const communityApprovalModeEnum = pgEnum("community_approval_mode", [
  "off",
  "members",
  "non_admins",
]);
export const communityAutomationModeEnum = pgEnum("community_automation_mode", [
  "off",
  "observe",
  "enforce",
]);
export const communityModerationCaseStatusEnum = pgEnum(
  "community_moderation_case_status",
  ["open", "reviewing", "resolved", "appealed"],
);
export const communityModerationDecisionActionEnum = pgEnum(
  "community_moderation_decision_action",
  [
    "submitted",
    "flagged",
    "held",
    "approved",
    "rejected",
    "restored",
    "appealed",
    "appeal_upheld",
    "appeal_overturned",
  ],
);
export const communityModerationReasonCodeEnum = pgEnum(
  "community_moderation_reason_code",
  [
    "approval_required",
    "report_threshold",
    "duplicate",
    "link_limit",
    "manual",
  ],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    description: text("description"),
    primaryColor: varchar("primary_color", { length: 20 })
      .default("#17324d")
      .notNull(),
    accentColor: varchar("accent_color", { length: 20 })
      .default("#2bb7a9")
      .notNull(),
    logoMark: varchar("logo_mark", { length: 12 }).default("Q").notNull(),
    defaultLocale: varchar("default_locale", { length: 5 })
      .default("de")
      .notNull(),
    status: organizationStatusEnum("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("organizations_slug_idx").on(table.slug),
    index("organizations_status_idx").on(table.status),
    check(
      "organizations_default_locale_check",
      sql`${table.defaultLocale} in ('de', 'en', 'it', 'es', 'fr')`,
    ),
  ],
);

export const tenantErasureReceipts = pgTable(
  "tenant_erasure_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    organizationSlug: varchar("organization_slug", { length: 100 }).notNull(),
    requestReference: varchar("request_reference", { length: 180 }).notNull(),
    approvedBy: varchar("approved_by", { length: 180 }).notNull(),
    legalBasis: text("legal_basis").notNull(),
    status: varchar("status", { length: 32 }).default("erasing").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    executeAfter: timestamp("execute_after", { withTimezone: true }).notNull(),
    primaryErasedAt: timestamp("primary_erased_at", { withTimezone: true }),
    backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    customerExportSha256: varchar("customer_export_sha256", { length: 64 }).notNull(),
    evidenceArchiveSha256: varchar("evidence_archive_sha256", { length: 64 }).notNull(),
    evidenceManifestSha256: varchar("evidence_manifest_sha256", { length: 64 }).notNull(),
    archiveKeyId: varchar("archive_key_id", { length: 64 }).notNull(),
    mediaAssetCount: integer("media_asset_count").default(0).notNull(),
    storageObjectCount: integer("storage_object_count").default(0).notNull(),
    rowCounts: jsonb("row_counts")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    policyManifest: jsonb("policy_manifest")
      .$type<Record<string, unknown>>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("tenant_erasure_receipts_org_reference_idx").on(
      table.organizationId,
      table.requestReference,
    ),
    index("tenant_erasure_receipts_status_backup_idx").on(
      table.status,
      table.backupExpiresAt,
    ),
    check(
      "tenant_erasure_receipts_status_check",
      sql`${table.status} in ('erasing', 'primary_erased', 'backup_retention_pending', 'completed', 'failed')`,
    ),
    check(
      "tenant_erasure_receipts_text_check",
      sql`btrim(${table.organizationSlug}) <> '' and btrim(${table.requestReference}) <> '' and btrim(${table.approvedBy}) <> '' and btrim(${table.legalBasis}) <> ''`,
    ),
    check(
      "tenant_erasure_receipts_hashes_check",
      sql`${table.customerExportSha256} ~ '^[0-9a-f]{64}$' and ${table.evidenceArchiveSha256} ~ '^[0-9a-f]{64}$' and ${table.evidenceManifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "tenant_erasure_receipts_timeline_check",
      sql`${table.executeAfter} >= ${table.requestedAt} and ${table.backupExpiresAt} >= ${table.executeAfter} and (${table.primaryErasedAt} is null or ${table.primaryErasedAt} >= ${table.executeAfter}) and (${table.completedAt} is null or (${table.primaryErasedAt} is not null and ${table.completedAt} >= ${table.primaryErasedAt}))`,
    ),
    check(
      "tenant_erasure_receipts_counts_check",
      sql`${table.mediaAssetCount} >= 0 and ${table.storageObjectCount} >= 0`,
    ),
  ],
);

export const tenantErasureEvents = pgTable(
  "tenant_erasure_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => tenantErasureReceipts.id, { onDelete: "restrict" }),
    event: varchar("event", { length: 80 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("tenant_erasure_events_receipt_created_idx").on(
      table.receiptId,
      table.createdAt,
      table.id,
    ),
    check(
      "tenant_erasure_events_event_check",
      sql`btrim(${table.event}) <> ''`,
    ),
  ],
);

export const organizationContracts = pgTable(
  "organization_contracts",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planCode: varchar("plan_code", { length: 64 }).notNull(),
    status: varchar("status", { length: 24 }).default("active").notNull(),
    seatLimit: integer("seat_limit"),
    courseLimit: integer("course_limit"),
    storageLimitBytes: bigint("storage_limit_bytes", { mode: "number" }),
    aiMonthlyCredits: integer("ai_monthly_credits"),
    featureEntitlements: text("feature_entitlements").array().default([]).notNull(),
    externalReference: varchar("external_reference", { length: 255 }),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("organization_contracts_status_idx").on(table.status, table.endsAt),
    check(
      "organization_contracts_plan_code_check",
      sql`${table.planCode} ~ '^[a-z0-9][a-z0-9_-]{1,63}$'`,
    ),
    check(
      "organization_contracts_status_check",
      sql`${table.status} in ('trial', 'active', 'past_due', 'suspended', 'cancelled')`,
    ),
    check(
      "organization_contracts_seat_limit_check",
      sql`${table.seatLimit} is null or ${table.seatLimit} >= 1`,
    ),
    check(
      "organization_contracts_course_limit_check",
      sql`${table.courseLimit} is null or ${table.courseLimit} >= 1`,
    ),
    check(
      "organization_contracts_storage_limit_check",
      sql`${table.storageLimitBytes} is null or ${table.storageLimitBytes} >= 1048576`,
    ),
    check(
      "organization_contracts_ai_credit_check",
      sql`${table.aiMonthlyCredits} is null or ${table.aiMonthlyCredits} >= 0`,
    ),
    check(
      "organization_contracts_entitlements_check",
      sql`cardinality(${table.featureEntitlements}) <= 64 and (cardinality(${table.featureEntitlements}) = 0 or array_to_string(${table.featureEntitlements}, ',') ~ '^([a-z][a-z0-9_.-]{1,63})(,[a-z][a-z0-9_.-]{1,63})*$')`,
    ),
    check(
      "organization_contracts_revision_check",
      sql`${table.revision} >= 1`,
    ),
    check(
      "organization_contracts_timeline_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "organization_contracts_updated_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }).notNull(),
    avatarUrl: text("avatar_url"),
    role: roleEnum("role").default("member").notNull(),
    status: userStatusEnum("status").default("active").notNull(),
    jobTitle: varchar("job_title", { length: 180 }),
    department: varchar("department", { length: 120 }),
    phone: varchar("phone", { length: 16 }),
    bio: text("bio"),
    preferredLocale: varchar("preferred_locale", { length: 5 }),
    points: integer("points").default(0).notNull(),
    communityPoints: integer("community_points").default(0).notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("users_org_email_idx").on(table.organizationId, table.email),
    uniqueIndex("users_id_organization_idx").on(table.id, table.organizationId),
    index("users_org_role_idx").on(table.organizationId, table.role),
    check("users_points_nonnegative_check", sql`${table.points} >= 0`),
    check(
      "users_community_points_nonnegative_check",
      sql`${table.communityPoints} >= 0`,
    ),
    check(
      "users_preferred_locale_check",
      sql`${table.preferredLocale} is null or ${table.preferredLocale} in ('de', 'en', 'it', 'es', 'fr')`,
    ),
    check(
      "users_phone_e164_check",
      sql`${table.phone} is null or ${table.phone} ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
  ],
);

export const teamRoles = pgTable(
  "team_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }),
    color: varchar("color", { length: 7 }).default("#2b9188").notNull(),
    permissions: text("permissions").array().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    revision: integer("revision").default(1).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("team_roles_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("team_roles_org_name_lower_idx").on(
      table.organizationId,
      sql`lower(${table.name})`,
    ),
    index("team_roles_org_active_idx").on(table.organizationId, table.active),
    check("team_roles_name_check", sql`btrim(${table.name}) <> ''`),
    check("team_roles_color_check", sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`),
    check(
      "team_roles_permissions_check",
      sql`${table.permissions} <@ array['members.view','members.manage','courses.view','courses.manage','community.view','community.manage','events.view','events.manage','analytics.view','settings.view','settings.manage','integrations.view','integrations.manage','api.view','api.manage','ai.view','ai.manage']::text[] and cardinality(${table.permissions}) <= 17`,
    ),
    check("team_roles_revision_check", sql`${table.revision} >= 1`),
    check("team_roles_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const teamRoleAssignments = pgTable(
  "team_role_assignments",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    roleId: uuid("role_id").notNull(),
    assignedById: uuid("assigned_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "team_role_assignments_pk",
      columns: [table.organizationId, table.userId],
    }),
    foreignKey({
      name: "team_role_assignments_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_role_assignments_role_tenant_fk",
      columns: [table.roleId, table.organizationId],
      foreignColumns: [teamRoles.id, teamRoles.organizationId],
    }).onDelete("restrict"),
    index("team_role_assignments_org_role_idx").on(
      table.organizationId,
      table.roleId,
    ),
  ],
);

export const userMfaConfigurations = pgTable(
  "user_mfa_configurations",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).default("pending").notNull(),
    secretEncrypted: jsonb("secret_encrypted")
      .$type<Record<string, unknown>>()
      .notNull(),
    recoveryCodeHashes: text("recovery_code_hashes").array().default([]).notNull(),
    lastTotpCounter: bigint("last_totp_counter", { mode: "number" }),
    enabledAt: timestamp("enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "user_mfa_configurations_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    index("user_mfa_configurations_org_status_idx").on(
      table.organizationId,
      table.status,
    ),
    check(
      "user_mfa_configurations_status_check",
      sql`${table.status} in ('pending', 'enabled')`,
    ),
    check(
      "user_mfa_configurations_secret_envelope_check",
      sql`jsonb_typeof(${table.secretEncrypted}) = 'object' and ${table.secretEncrypted} ->> 'v' = '2' and btrim(coalesce(${table.secretEncrypted} ->> 'kid', '')) <> '' and btrim(coalesce(${table.secretEncrypted} ->> 'iv', '')) <> '' and btrim(coalesce(${table.secretEncrypted} ->> 'tag', '')) <> '' and btrim(coalesce(${table.secretEncrypted} ->> 'ciphertext', '')) <> ''`,
    ),
    check(
      "user_mfa_configurations_recovery_hashes_check",
      sql`cardinality(${table.recoveryCodeHashes}) <= 12 and array_to_string(${table.recoveryCodeHashes}, ',') ~ '^(v1\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.[a-f0-9]{64})(,v1\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.[a-f0-9]{64})*$|^$'`,
    ),
    check(
      "user_mfa_configurations_state_check",
      sql`(${table.status} = 'pending' and ${table.enabledAt} is null and ${table.lastTotpCounter} is null and cardinality(${table.recoveryCodeHashes}) = 0) or (${table.status} = 'enabled' and ${table.enabledAt} is not null and ${table.lastTotpCounter} is not null)`,
    ),
    check(
      "user_mfa_configurations_counter_check",
      sql`${table.lastTotpCounter} is null or ${table.lastTotpCounter} >= 0`,
    ),
    check(
      "user_mfa_configurations_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.enabledAt} is null or (${table.enabledAt} >= ${table.createdAt} and ${table.enabledAt} <= ${table.updatedAt}))`,
    ),
  ],
);

export const organizationMfaPolicies = pgTable(
  "organization_mfa_policies",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requireForPrivileged: boolean("require_for_privileged")
      .default(false)
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("organization_mfa_policies_revision_check", sql`${table.revision} >= 1`),
    check(
      "organization_mfa_policies_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const mfaLoginChallenges = pgTable(
  "mfa_login_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jtiHash: varchar("jti_hash", { length: 64 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    authMethod: varchar("auth_method", { length: 16 }).notNull(),
    oidcIdentityId: uuid("oidc_identity_id"),
    oidcConfigurationVersion: integer("oidc_configuration_version"),
    oidcAuthTime: timestamp("oidc_auth_time", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "mfa_login_challenges_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("mfa_login_challenges_jti_hash_idx").on(table.jtiHash),
    index("mfa_login_challenges_user_active_idx").on(
      table.organizationId,
      table.userId,
      table.consumedAt,
      table.expiresAt,
    ),
    index("mfa_login_challenges_expiry_idx").on(table.expiresAt),
    check(
      "mfa_login_challenges_mode_check",
      sql`${table.mode} in ('verify', 'enroll')`,
    ),
    check(
      "mfa_login_challenges_auth_shape_check",
      sql`(${table.authMethod} = 'password' and ${table.oidcIdentityId} is null and ${table.oidcConfigurationVersion} is null and ${table.oidcAuthTime} is null) or (${table.authMethod} = 'oidc' and ${table.oidcIdentityId} is not null and ${table.oidcConfigurationVersion} is not null)`,
    ),
    check(
      "mfa_login_challenges_oidc_version_check",
      sql`${table.oidcConfigurationVersion} is null or ${table.oidcConfigurationVersion} >= 1`,
    ),
    check(
      "mfa_login_challenges_timeline_check",
      sql`${table.expiresAt} > ${table.createdAt} and (${table.consumedAt} is null or ${table.consumedAt} >= ${table.createdAt})`,
    ),
  ],
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jtiHash: varchar("jti_hash", { length: 64 }).notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    authMethod: varchar("auth_method", { length: 16 })
      .default("password")
      .notNull(),
    oidcIdentityId: uuid("oidc_identity_id"),
    oidcConfigurationVersion: integer("oidc_configuration_version"),
    authenticatedAt: timestamp("authenticated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    oidcAuthTime: timestamp("oidc_auth_time", { withTimezone: true }),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    mfaMethod: varchar("mfa_method", { length: 16 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_sessions_jti_hash_idx").on(table.jtiHash),
    uniqueIndex("user_sessions_id_user_org_idx").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    index("user_sessions_expiry_idx").on(table.expiresAt),
    index("user_sessions_user_active_idx").on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index("user_sessions_oidc_identity_active_idx").on(
      table.oidcIdentityId,
      table.revokedAt,
      table.expiresAt,
    ),
    check(
      "user_sessions_auth_method_shape_check",
      sql`(${table.authMethod} = 'password' and ${table.oidcIdentityId} is null and ${table.oidcConfigurationVersion} is null and ${table.oidcAuthTime} is null) or (${table.authMethod} = 'oidc' and ${table.oidcIdentityId} is not null and ${table.oidcConfigurationVersion} is not null)`,
    ),
    check(
      "user_sessions_oidc_configuration_version_check",
      sql`${table.oidcConfigurationVersion} is null or ${table.oidcConfigurationVersion} >= 1`,
    ),
    check(
      "user_sessions_auth_timeline_check",
      sql`${table.authenticatedAt} <= ${table.lastSeenAt} and (${table.oidcAuthTime} is null or ${table.oidcAuthTime} <= ${table.authenticatedAt} + interval '5 minutes') and (${table.mfaVerifiedAt} is null or ${table.mfaVerifiedAt} >= ${table.authenticatedAt} - interval '5 minutes')`,
    ),
    check(
      "user_sessions_mfa_shape_check",
      sql`(${table.mfaVerifiedAt} is null and ${table.mfaMethod} is null) or (${table.mfaVerifiedAt} is not null and ${table.mfaMethod} in ('totp', 'recovery'))`,
    ),
  ],
);

export const oidcConfigurations = pgTable(
  "oidc_configurations",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    displayName: varchar("display_name", { length: 80 })
      .default("Unternehmens-Login")
      .notNull(),
    issuer: varchar("issuer", { length: 2000 }),
    clientId: varchar("client_id", { length: 512 }),
    clientSecretEncrypted: jsonb("client_secret_encrypted").$type<
      Record<string, unknown>
    >(),
    autoProvisionMembers: boolean("auto_provision_members")
      .default(false)
      .notNull(),
    allowedEmailDomains: jsonb("allowed_email_domains")
      .$type<string[]>()
      .default([])
      .notNull(),
    passwordLoginEnabled: boolean("password_login_enabled")
      .default(true)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "oidc_configurations_display_name_check",
      sql`btrim(${table.displayName}) <> ''`,
    ),
    check(
      "oidc_configurations_enabled_shape_check",
      sql`not ${table.enabled} or (${table.issuer} is not null and btrim(${table.issuer}) <> '' and ${table.clientId} is not null and btrim(${table.clientId}) <> '' and ${table.clientSecretEncrypted} is not null)`,
    ),
    check(
      "oidc_configurations_password_fallback_check",
      sql`${table.passwordLoginEnabled} or ${table.enabled}`,
    ),
    check(
      "oidc_configurations_domains_check",
      sql`jsonb_typeof(${table.allowedEmailDomains}) = 'array' and jsonb_array_length(${table.allowedEmailDomains}) <= 50`,
    ),
    check(
      "oidc_configurations_auto_provision_domains_check",
      sql`not ${table.autoProvisionMembers} or jsonb_array_length(${table.allowedEmailDomains}) > 0`,
    ),
    check(
      "oidc_configurations_secret_envelope_check",
      sql`${table.clientSecretEncrypted} is null or (jsonb_typeof(${table.clientSecretEncrypted}) = 'object' and ${table.clientSecretEncrypted} ->> 'v' = '2' and btrim(coalesce(${table.clientSecretEncrypted} ->> 'kid', '')) <> '' and btrim(coalesce(${table.clientSecretEncrypted} ->> 'iv', '')) <> '' and btrim(coalesce(${table.clientSecretEncrypted} ->> 'tag', '')) <> '' and btrim(coalesce(${table.clientSecretEncrypted} ->> 'ciphertext', '')) <> '')`,
    ),
    check("oidc_configurations_version_check", sql`${table.version} >= 1`),
    check(
      "oidc_configurations_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const oidcIdentities = pgTable(
  "oidc_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    issuer: varchar("issuer", { length: 2000 }).notNull(),
    subject: varchar("subject", { length: 512 }).notNull(),
    emailAtLink: varchar("email_at_link", { length: 255 }).notNull(),
    lastConfigurationVersion: integer("last_configuration_version"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "oidc_identities_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("oidc_identities_org_issuer_subject_idx").on(
      table.organizationId,
      table.issuer,
      table.subject,
    ),
    uniqueIndex("oidc_identities_org_user_issuer_idx").on(
      table.organizationId,
      table.userId,
      table.issuer,
    ),
    index("oidc_identities_user_created_idx").on(table.userId, table.createdAt),
    check(
      "oidc_identities_values_check",
      sql`btrim(${table.issuer}) <> '' and btrim(${table.subject}) <> '' and btrim(${table.emailAtLink}) <> ''`,
    ),
    check(
      "oidc_identities_configuration_version_check",
      sql`${table.lastConfigurationVersion} >= 1`,
    ),
    check(
      "oidc_identities_timeline_check",
      sql`${table.lastLoginAt} >= ${table.createdAt}`,
    ),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_idx").on(table.tokenHash),
    index("invitations_org_email_idx").on(table.organizationId, table.email),
    index("invitations_expiry_idx").on(table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_expiry_idx").on(table.expiresAt),
    index("password_reset_tokens_user_expiry_idx").on(
      table.userId,
      table.expiresAt,
    ),
  ],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    action: varchar("action", { length: 40 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.action, table.keyHash] }),
    index("auth_rate_limits_reset_idx").on(table.resetAt),
    check("auth_rate_limits_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const badgeGroups = pgTable(
  "badge_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").default("").notNull(),
    displayMode: badgeGroupDisplayModeEnum("display_mode")
      .default("all")
      .notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("badge_groups_org_name_idx").on(
      table.organizationId,
      table.name,
    ),
    uniqueIndex("badge_groups_id_org_idx").on(table.id, table.organizationId),
    index("badge_groups_org_order_idx").on(
      table.organizationId,
      table.sortOrder,
      table.id,
    ),
    check(
      "badge_groups_name_check",
      sql`length(btrim(${table.name})) between 1 and 160`,
    ),
    check(
      "badge_groups_description_check",
      sql`char_length(${table.description}) <= 2000`,
    ),
    check(
      "badge_groups_sort_order_check",
      sql`${table.sortOrder} between 0 and 1000`,
    ),
  ],
);

export const badgeDefinitions = pgTable(
  "badge_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id"),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description").notNull(),
    icon: varchar("icon", { length: 60 }).default("award").notNull(),
    color: varchar("color", { length: 20 }).default("#d6a536").notNull(),
    pointsThreshold: integer("points_threshold"),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "badge_definitions_group_tenant_fk",
      columns: [table.groupId, table.organizationId],
      foreignColumns: [badgeGroups.id, badgeGroups.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("badge_definitions_org_slug_idx").on(
      table.organizationId,
      table.slug,
    ),
    uniqueIndex("badge_definitions_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("badge_definitions_org_group_order_idx").on(
      table.organizationId,
      table.groupId,
      table.sortOrder,
      table.id,
    ),
    check(
      "badge_definitions_sort_order_check",
      sql`${table.sortOrder} between 0 and 1000`,
    ),
  ],
);

export const userBadges = pgTable(
  "user_badges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badgeDefinitions.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 180 }),
    awardedAt: timestamp("awarded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "user_badges_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "user_badges_badge_tenant_fk",
      columns: [table.badgeId, table.organizationId],
      foreignColumns: [badgeDefinitions.id, badgeDefinitions.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("user_badges_user_badge_idx").on(table.userId, table.badgeId),
    index("user_badges_org_awarded_idx").on(
      table.organizationId,
      table.awardedAt,
    ),
  ],
);

export const pointTransactions = pgTable(
  "point_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("point_transactions_org_user_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
    uniqueIndex("point_transactions_user_reason_entity_idx").on(
      table.userId,
      table.reason,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const communityLevelSettings = pgTable(
  "community_level_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedById: uuid("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_level_settings_updater_tenant_fk",
      columns: [table.updatedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    check(
      "community_level_settings_revision_check",
      sql`${table.revision} >= 1`,
    ),
  ],
);

export const communityLevels = pgTable(
  "community_levels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description").notNull(),
    minPoints: integer("min_points").notNull(),
    icon: varchar("icon", { length: 60 }).default("award").notNull(),
    color: varchar("color", { length: 20 }).default("#d6a536").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("community_levels_org_position_idx").on(
      table.organizationId,
      table.position,
    ),
    uniqueIndex("community_levels_org_min_points_idx").on(
      table.organizationId,
      table.minPoints,
    ),
    uniqueIndex("community_levels_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("community_levels_org_active_position_idx").on(
      table.organizationId,
      table.active,
      table.position,
    ),
    check(
      "community_levels_position_check",
      sql`${table.position} between 1 and 100`,
    ),
    check("community_levels_min_points_check", sql`${table.minPoints} >= 0`),
    check(
      "community_levels_name_check",
      sql`length(btrim(${table.name})) between 1 and 160`,
    ),
    check(
      "community_levels_description_check",
      sql`length(${table.description}) <= 5000`,
    ),
    check(
      "community_levels_icon_check",
      sql`length(btrim(${table.icon})) between 1 and 60`,
    ),
    check(
      "community_levels_color_check",
      sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#4f7cac").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("groups_org_name_idx").on(table.organizationId, table.name),
    uniqueIndex("groups_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.userId] })],
);

export const courseCategories = pgTable(
  "course_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#2bb7a9").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
  },
  (table) => [
    uniqueIndex("course_categories_org_slug_idx").on(
      table.organizationId,
      table.slug,
    ),
  ],
);

export const courses = pgTable(
  "courses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => courseCategories.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 220 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    shortDescription: text("short_description").notNull(),
    description: text("description").notNull(),
    coverImage: text("cover_image"),
    status: courseStatusEnum("status").default("draft").notNull(),
    difficulty: varchar("difficulty", { length: 40 })
      .default("Grundlagen")
      .notNull(),
    estimatedMinutes: integer("estimated_minutes").default(60).notNull(),
    certificateEnabled: boolean("certificate_enabled").default(true).notNull(),
    featured: boolean("featured").default(false).notNull(),
    visibleInCatalog: boolean("visible_in_catalog").default(true).notNull(),
    showProgressPercentage: boolean("show_progress_percentage")
      .default(true)
      .notNull(),
    notifyMembersOnModuleRelease: boolean("notify_members_on_module_release")
      .default(false)
      .notNull(),
    publishedVersionId: uuid("published_version_id"),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("courses_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("courses_org_slug_idx").on(table.organizationId, table.slug),
    index("courses_org_status_idx").on(table.organizationId, table.status),
    index("courses_published_version_idx").on(table.publishedVersionId),
  ],
);

export const courseCollaborators = pgTable(
  "course_collaborators",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    userId: uuid("user_id").notNull(),
    permission: coursePermissionEnum("permission").default("view").notNull(),
    grantedById: uuid("granted_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.userId] }),
    foreignKey({
      name: "course_collaborators_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_collaborators_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_collaborators_granter_tenant_fk",
      columns: [table.grantedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    index("course_collaborators_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const courseLearningGoals = pgTable(
  "course_learning_goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    text: varchar("text", { length: 500 }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "course_learning_goals_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("course_learning_goals_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("course_learning_goals_org_course_sort_idx").on(
      table.organizationId,
      table.courseId,
      table.sortOrder,
    ),
    check(
      "course_learning_goals_text_check",
      sql`length(btrim(${table.text})) between 1 and 500`,
    ),
    check(
      "course_learning_goals_sort_order_check",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const courseAuthors = pgTable(
  "course_authors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "course_authors_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_authors_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("course_authors_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("course_authors_org_course_user_idx").on(
      table.organizationId,
      table.courseId,
      table.userId,
    ),
    index("course_authors_org_course_sort_idx").on(
      table.organizationId,
      table.courseId,
      table.sortOrder,
    ),
    check("course_authors_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const courseWidgets = pgTable(
  "course_widgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    type: courseWidgetTypeEnum("type").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    authorRole: varchar("author_role", { length: 160 }),
    authorDescription: text("author_description"),
    title: varchar("title", { length: 220 }),
    text: text("text"),
    linkUrl: text("link_url"),
    imageUrl: text("image_url"),
    mediaAssetId: uuid("media_asset_id"),
    altText: varchar("alt_text", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "course_widgets_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_widgets_author_tenant_fk",
      columns: [table.authorUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "course_widgets_media_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("course_widgets_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("course_widgets_org_course_sort_idx").on(
      table.organizationId,
      table.courseId,
      table.sortOrder,
    ),
    index("course_widgets_org_media_asset_idx").on(
      table.organizationId,
      table.mediaAssetId,
    ),
    check("course_widgets_sort_order_check", sql`${table.sortOrder} >= 0`),
    check(
      "course_widgets_payload_check",
      sql`(
        ${table.type} = 'author'
        and ${table.authorUserId} is not null
        and ${table.title} is null
        and ${table.text} is null
        and ${table.linkUrl} is null
        and ${table.imageUrl} is null
        and ${table.mediaAssetId} is null
        and ${table.altText} is null
      ) or (
        ${table.type} = 'info'
        and ${table.authorUserId} is null
        and ${table.authorRole} is null
        and ${table.authorDescription} is null
        and length(${table.title}) > 0
        and length(${table.text}) > 0
        and ${table.imageUrl} is null
        and ${table.mediaAssetId} is null
        and ${table.altText} is null
      ) or (
        ${table.type} = 'image_link'
        and ${table.authorUserId} is null
        and ${table.authorRole} is null
        and ${table.authorDescription} is null
        and ${table.title} is null
        and ${table.text} is null
        and length(${table.linkUrl}) > 0
        and length(${table.imageUrl}) > 0
        and length(${table.altText}) > 0
        and (
          ${table.mediaAssetId} is null
          or ${table.imageUrl} = '/api/media-assets/' || ${table.mediaAssetId}::text || '/download'
        )
      )`,
    ),
  ],
);

export const modules = pgTable(
  "modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 220 }).notNull(),
    kind: moduleKindEnum("kind").default("learning").notNull(),
    linkedCourseId: uuid("linked_course_id"),
    description: text("description"),
    folder: varchar("folder", { length: 120 }).default("Allgemein").notNull(),
    isReusable: boolean("is_reusable").default(true).notNull(),
    estimatedMinutes: integer("estimated_minutes").default(30).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("modules_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      name: "modules_linked_course_tenant_fk",
      columns: [table.linkedCourseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("restrict"),
    index("modules_org_folder_idx").on(table.organizationId, table.folder),
    index("modules_org_kind_folder_idx").on(
      table.organizationId,
      table.kind,
      table.folder,
    ),
    index("modules_org_linked_course_idx").on(
      table.organizationId,
      table.linkedCourseId,
    ),
    check(
      "modules_link_target_check",
      sql`(
        (${table.kind}::text = 'link' and ${table.linkedCourseId} is not null)
        or (${table.kind}::text <> 'link' and ${table.linkedCourseId} is null)
      )`,
    ),
  ],
);

export const moduleSections = pgTable(
  "module_sections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id").notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: courseStatusEnum("status").default("published").notNull(),
    visibility: learningContentVisibilityEnum("visibility")
      .default("visible")
      .notNull(),
    unlockAfterPrevious: boolean("unlock_after_previous")
      .default(false)
      .notNull(),
    dripDays: integer("drip_days").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "module_sections_module_tenant_fk",
      columns: [table.moduleId, table.organizationId],
      foreignColumns: [modules.id, modules.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("module_sections_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("module_sections_id_module_organization_idx").on(
      table.id,
      table.moduleId,
      table.organizationId,
    ),
    index("module_sections_module_sort_idx").on(
      table.moduleId,
      table.sortOrder,
    ),
  ],
);

export const courseModules = pgTable(
  "course_modules",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    moduleId: uuid("module_id").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    indentLevel: integer("indent_level").default(0).notNull(),
    accessMode: courseModuleAccessModeEnum("access_mode")
      .default("visible")
      .notNull(),
    dripDays: integer("drip_days").default(0).notNull(),
    delayPendingState: courseModuleAccessStateEnum("delay_pending_state")
      .default("locked")
      .notNull(),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    windowDefaultState: courseModuleAccessStateEnum("window_default_state")
      .default("locked")
      .notNull(),
    windowState: courseModuleAccessStateEnum("window_state")
      .default("available")
      .notNull(),
    requestAccessEnabled: boolean("request_access_enabled")
      .default(false)
      .notNull(),
    isRequired: boolean("is_required").default(true).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.moduleId] }),
    foreignKey({
      name: "course_modules_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_modules_module_tenant_fk",
      columns: [table.moduleId, table.organizationId],
      foreignColumns: [modules.id, modules.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("course_modules_course_module_organization_idx").on(
      table.courseId,
      table.moduleId,
      table.organizationId,
    ),
    index("course_modules_org_course_outline_idx").on(
      table.organizationId,
      table.courseId,
      table.sortOrder,
      table.moduleId,
    ),
    check(
      "course_modules_drip_days_check",
      sql`${table.dripDays} >= 0 and ${table.dripDays} <= 36500`,
    ),
    check(
      "course_modules_window_check",
      sql`${table.availableFrom} is null or ${table.availableUntil} is null or ${table.availableUntil} > ${table.availableFrom}`,
    ),
    check(
      "course_modules_access_mode_config_check",
      sql`(
        (${table.accessMode} = 'delay_days' and ${table.availableFrom} is null and ${table.availableUntil} is null)
        or (${table.accessMode} = 'date_window' and ${table.dripDays} = 0 and (${table.availableFrom} is not null or ${table.availableUntil} is not null))
        or (${table.accessMode} not in ('delay_days', 'date_window') and ${table.dripDays} = 0 and ${table.availableFrom} is null and ${table.availableUntil} is null)
      )`,
    ),
    check(
      "course_modules_delay_pending_state_check",
      sql`${table.delayPendingState} in ('locked', 'hidden')`,
    ),
    check(
      "course_modules_indent_level_check",
      sql`${table.indentLevel} >= 0 and ${table.indentLevel} <= 3`,
    ),
  ],
);

export const courseModuleAccessOverrides = pgTable(
  "course_module_access_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: courseModuleAccessStateEnum("state").notNull(),
    reason: varchar("reason", { length: 500 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "course_module_access_overrides_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_overrides_module_tenant_fk",
      columns: [table.moduleId, table.organizationId],
      foreignColumns: [modules.id, modules.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_overrides_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_overrides_assignment_fk",
      columns: [table.courseId, table.moduleId, table.organizationId],
      foreignColumns: [
        courseModules.courseId,
        courseModules.moduleId,
        courseModules.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_overrides_actor_tenant_fk",
      columns: [table.createdById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("course_module_access_overrides_org_member_module_idx").on(
      table.organizationId,
      table.userId,
      table.courseId,
      table.moduleId,
    ),
    index("course_module_access_overrides_org_course_idx").on(
      table.organizationId,
      table.courseId,
    ),
    index("course_module_access_overrides_member_expiry_idx").on(
      table.userId,
      table.expiresAt,
    ),
  ],
);

export const courseModuleAccessRequests = pgTable(
  "course_module_access_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: courseModuleAccessRequestStatusEnum("status")
      .default("pending")
      .notNull(),
    message: varchar("message", { length: 1_000 }),
    decisionNote: varchar("decision_note", { length: 1_000 }),
    decidedById: uuid("decided_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "course_module_access_requests_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_requests_module_tenant_fk",
      columns: [table.moduleId, table.organizationId],
      foreignColumns: [modules.id, modules.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_requests_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_requests_assignment_fk",
      columns: [table.courseId, table.moduleId, table.organizationId],
      foreignColumns: [
        courseModules.courseId,
        courseModules.moduleId,
        courseModules.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_module_access_requests_decider_tenant_fk",
      columns: [table.decidedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("course_module_access_requests_pending_idx")
      .on(table.organizationId, table.userId, table.courseId, table.moduleId)
      .where(sql`${table.status} = 'pending'`),
    index("course_module_access_requests_org_course_status_idx").on(
      table.organizationId,
      table.courseId,
      table.status,
      table.requestedAt,
    ),
    check(
      "course_module_access_requests_decision_check",
      sql`(
        (${table.status} = 'pending' and ${table.decidedAt} is null and ${table.decidedById} is null)
        or (${table.status} in ('approved', 'rejected') and ${table.decidedAt} is not null and ${table.decidedById} is not null)
        or (${table.status} = 'cancelled' and ${table.decidedAt} is not null and ${table.decidedById} is null)
      )`,
    ),
  ],
);

export type ContentBlockData = {
  agentId?: string;
  text?: string;
  richText?: RichTextDocument;
  button?: LinkButtonDocument;
  gallery?: GalleryDocument;
  callout?: import("@/lib/content-blocks/layout-documents").CalloutDocument;
  quote?: import("@/lib/content-blocks/layout-documents").QuoteDocument;
  divider?: import("@/lib/content-blocks/layout-documents").DividerDocument;
  accordion?: import("@/lib/content-blocks/layout-documents").AccordionDocument;
  tabs?: import("@/lib/content-blocks/layout-documents").TabsDocument;
  columns?: import("@/lib/content-blocks/layout-documents").ColumnsDocument;
  download?: import("@/lib/content-blocks/layout-documents").DownloadDocument;
  code?: import("@/lib/content-blocks/layout-documents").CodeDocument;
  table?: import("@/lib/content-blocks/layout-documents").TableDocument;
  items?: string[];
  videoUrl?: string;
  transcript?: VideoTranscriptDocument;
  videoEndCard?: import("@/lib/media/video-end-card").VideoEndCard;
  videoPlayback?: import("@/lib/media/video-playback-policy").VideoPlaybackPolicy;
  videoComposition?: import("@/lib/media/video-composition").VideoCompositionDocument;
  formId?: string;
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileName?: string;
  mediaAssetId?: string;
  mediaAssetName?: string;
  embedUrl?: string;
  embedProvider?: import("@/lib/content-blocks/integration-catalog").CourseIntegrationProviderId;
  embedLayout?: import("@/lib/content-blocks/integration-catalog").CourseIntegrationLayout;
  caption?: string;
  options?: string[];
  presentationOrder?: string[];
  optionIds?: string[];
  correctOption?: number;
  correctOptions?: number[];
  acceptedAnswers?: string[];
  caseSensitive?: boolean;
  prompt?: string;
  feedback?: string;
  accent?: "navy" | "teal" | "coral" | "amber";
  stockImage?: {
    selectionId: string;
    provider: string;
    externalId: string;
    author: string;
    authorUrl?: string;
    sourceUrl: string;
    attribution: string;
  };
};

export type ExamQuestionPoolConfiguration = {
  id: string;
  questionIds: string[];
  drawCount: number;
};

export const lessons = pgTable(
  "lessons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => moduleSections.id, {
      onDelete: "set null",
    }),
    title: varchar("title", { length: 220 }).notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    summary: text("summary"),
    type: lessonTypeEnum("type").default("lesson").notNull(),
    durationMinutes: integer("duration_minutes").default(10).notNull(),
    passingScore: integer("passing_score").default(100).notNull(),
    maxAttempts: integer("max_attempts"),
    shuffleQuestions: boolean("shuffle_questions").default(false).notNull(),
    examDurationSeconds: integer("exam_duration_seconds"),
    examQuestionPools: jsonb("exam_question_pools")
      .$type<ExamQuestionPoolConfiguration[]>()
      .default([])
      .notNull(),
    examResultReleaseMode: examResultReleaseModeEnum("exam_result_release_mode")
      .default("immediate")
      .notNull(),
    examReviewReleaseMode: examReviewReleaseModeEnum("exam_review_release_mode")
      .default("after_result")
      .notNull(),
    examContentAccessMode: examContentAccessModeEnum("exam_content_access_mode")
      .default("allow")
      .notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: courseStatusEnum("status").default("published").notNull(),
    visibility: learningContentVisibilityEnum("visibility")
      .default("visible")
      .notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "lessons_module_tenant_fk",
      columns: [table.moduleId, table.organizationId],
      foreignColumns: [modules.id, modules.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lessons_section_module_tenant_fk",
      columns: [table.sectionId, table.moduleId, table.organizationId],
      foreignColumns: [
        moduleSections.id,
        moduleSections.moduleId,
        moduleSections.organizationId,
      ],
    }),
    uniqueIndex("lessons_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("lessons_id_module_organization_idx").on(
      table.id,
      table.moduleId,
      table.organizationId,
    ),
    uniqueIndex("lessons_module_slug_idx").on(table.moduleId, table.slug),
    check(
      "lessons_passing_score_check",
      sql`${table.passingScore} >= 1 and ${table.passingScore} <= 100`,
    ),
    check(
      "lessons_max_attempts_check",
      sql`${table.maxAttempts} is null or (${table.maxAttempts} >= 1 and ${table.maxAttempts} <= 100)`,
    ),
    check(
      "lessons_exam_duration_seconds_check",
      sql`${table.examDurationSeconds} is null or (${table.examDurationSeconds} >= 60 and ${table.examDurationSeconds} <= 86400)`,
    ),
    check(
      "lessons_exam_question_pools_shape_check",
      sql`jsonb_typeof(${table.examQuestionPools}) = 'array'`,
    ),
  ],
);

export const lessonPages = pgTable(
  "lesson_pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 220 }).notNull(),
    titleSyncedWithLesson: boolean("title_synced_with_lesson")
      .default(false)
      .notNull(),
    slug: varchar("slug", { length: 180 }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    status: courseStatusEnum("status").default("published").notNull(),
    layoutWidth: varchar("layout_width", { length: 16 })
      .$type<"narrow" | "standard" | "wide">()
      .default("standard")
      .notNull(),
    backgroundTone: varchar("background_tone", { length: 16 })
      .$type<"plain" | "soft" | "contrast">()
      .default("plain")
      .notNull(),
    contentSpacing: varchar("content_spacing", { length: 16 })
      .$type<"compact" | "comfortable" | "spacious">()
      .default("comfortable")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("lesson_pages_lesson_slug_idx").on(table.lessonId, table.slug),
    uniqueIndex("lesson_pages_id_lesson_idx").on(table.id, table.lessonId),
    uniqueIndex("lesson_pages_one_title_sync_idx")
      .on(table.lessonId)
      .where(sql`${table.titleSyncedWithLesson} = true`),
    index("lesson_pages_lesson_sort_idx").on(table.lessonId, table.sortOrder),
    check(
      "lesson_pages_layout_width_check",
      sql`${table.layoutWidth} in ('narrow', 'standard', 'wide')`,
    ),
    check(
      "lesson_pages_background_tone_check",
      sql`${table.backgroundTone} in ('plain', 'soft', 'contrast')`,
    ),
    check(
      "lesson_pages_content_spacing_check",
      sql`${table.contentSpacing} in ('compact', 'comfortable', 'spacious')`,
    ),
    check("lesson_pages_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const contentBlocks = pgTable(
  "content_blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").references(() => lessonPages.id, {
      onDelete: "cascade",
    }),
    type: varchar("type", { length: 60 }).notNull(),
    title: varchar("title", { length: 220 }),
    sortOrder: integer("sort_order").default(0).notNull(),
    required: boolean("required").default(false).notNull(),
    data: jsonb("data").$type<ContentBlockData>().default({}).notNull(),
    style: jsonb("style")
      .$type<ContentBlockStyle>()
      .default({ width: "content", alignment: "left", surface: "plain" })
      .notNull(),
    revision: integer("revision").default(1).notNull(),
  },
  (table) => [
    index("content_blocks_lesson_sort_idx").on(table.lessonId, table.sortOrder),
    check("content_blocks_revision_check", sql`${table.revision} > 0`),
    check(
      "content_blocks_style_check",
      sql`jsonb_typeof(${table.style}) = 'object' and (${table.style} - 'width' - 'alignment' - 'surface') = '{}'::jsonb and ${table.style} ?& array['width','alignment','surface'] and (${table.style}->>'width') in ('compact','content','full') and (${table.style}->>'alignment') in ('left','center') and (${table.style}->>'surface') in ('plain','bordered','muted')`,
    ),
  ],
);

export const editorPresences = pgTable(
  "editor_presences",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    userId: uuid("user_id").notNull(),
    lessonId: uuid("lesson_id"),
    pageId: uuid("page_id"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "editor_presences_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "editor_presences_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "editor_presences_lesson_tenant_fk",
      columns: [table.lessonId, table.organizationId],
      foreignColumns: [lessons.id, lessons.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "editor_presences_page_lesson_fk",
      columns: [table.pageId, table.lessonId],
      foreignColumns: [lessonPages.id, lessonPages.lessonId],
    }).onDelete("cascade"),
    index("editor_presences_course_expiry_idx").on(
      table.organizationId,
      table.courseId,
      table.expiresAt,
    ),
    index("editor_presences_expiry_idx").on(table.expiresAt),
    check(
      "editor_presences_scope_check",
      sql`${table.pageId} is null or ${table.lessonId} is not null`,
    ),
    check(
      "editor_presences_timeline_check",
      sql`${table.expiresAt} > ${table.lastSeenAt} and ${table.lastSeenAt} >= ${table.createdAt}`,
    ),
  ],
);

type CourseSnapshotRecord = Omit<
  typeof courses.$inferSelect,
  | "createdAt"
  | "updatedAt"
  | "firstPublishedAt"
  | "notifyMembersOnModuleRelease"
> & {
  createdAt: string;
  updatedAt: string;
  firstPublishedAt?: string | null;
  notifyMembersOnModuleRelease?: boolean;
};

type CourseSnapshotBlock = Omit<
  typeof contentBlocks.$inferSelect,
  "revision" | "style"
> & {
  revision?: number;
  style?: ContentBlockStyle;
};

type CourseSnapshotPage = Omit<
  typeof lessonPages.$inferSelect,
  | "createdAt"
  | "updatedAt"
  | "titleSyncedWithLesson"
  | "revision"
  | "layoutWidth"
  | "backgroundTone"
  | "contentSpacing"
> & {
  titleSyncedWithLesson?: boolean;
  revision?: number;
  layoutWidth?: "narrow" | "standard" | "wide";
  backgroundTone?: "plain" | "soft" | "contrast";
  contentSpacing?: "compact" | "comfortable" | "spacious";
  createdAt: string;
  updatedAt: string;
  blocks: CourseSnapshotBlock[];
};

type CourseSnapshotLesson = Omit<
  typeof lessons.$inferSelect,
  "organizationId" | "visibility" | "availableAt" | "createdAt" | "updatedAt"
> & {
  organizationId?: string;
  visibility?: (typeof learningContentVisibilityEnum.enumValues)[number];
  availableAt: string | null;
  createdAt: string;
  updatedAt: string;
  blocks: CourseSnapshotBlock[];
  pages: CourseSnapshotPage[];
};

type CourseSnapshotSection = Omit<
  typeof moduleSections.$inferSelect,
  "organizationId" | "visibility" | "createdAt" | "updatedAt"
> & {
  organizationId?: string;
  visibility?: (typeof learningContentVisibilityEnum.enumValues)[number];
  createdAt: string;
  updatedAt: string;
  lessons: CourseSnapshotLesson[];
};

type CourseSnapshotModule = Omit<
  typeof modules.$inferSelect,
  "createdAt" | "updatedAt" | "kind" | "linkedCourseId"
> & {
  kind?: (typeof moduleKindEnum.enumValues)[number];
  linkedCourseId?: string | null;
  targetVersionIdAtCapture?: string | null;
  createdAt: string;
  updatedAt: string;
  sortOrder: number;
  indentLevel?: number;
  dripDays: number;
  accessMode?: (typeof courseModuleAccessModeEnum.enumValues)[number];
  delayPendingState?: (typeof courseModuleAccessStateEnum.enumValues)[number];
  availableFrom?: string | null;
  availableUntil?: string | null;
  windowDefaultState?: (typeof courseModuleAccessStateEnum.enumValues)[number];
  windowState?: (typeof courseModuleAccessStateEnum.enumValues)[number];
  requestAccessEnabled?: boolean;
  isRequired: boolean;
  lessons: CourseSnapshotLesson[];
  sections: CourseSnapshotSection[];
};

export type CourseWidgetSnapshot = Omit<
  typeof courseWidgets.$inferSelect,
  "createdAt" | "updatedAt" | "mediaAssetId"
> & {
  mediaAssetId?: string | null;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    bio: string | null;
  } | null;
};

export type CourseLearningGoalSnapshot = Omit<
  typeof courseLearningGoals.$inferSelect,
  "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
};

export type CourseAuthorSnapshot = Omit<
  typeof courseAuthors.$inferSelect,
  "createdAt"
> & {
  createdAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    bio: string | null;
  };
};

export type CourseVersionSnapshot = {
  schemaVersion: 2 | 3 | 4 | 5;
  accessPolicyVersion?: 1;
  moduleKindVersion?: 1;
  courseOutlineVersion?: 1;
  capturedAt: string;
  course: CourseSnapshotRecord;
  learningGoals?: CourseLearningGoalSnapshot[];
  authors?: CourseAuthorSnapshot[];
  widgets?: CourseWidgetSnapshot[];
  modules: CourseSnapshotModule[];
};

export const courseVersions = pgTable(
  "course_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<CourseVersionSnapshot>().notNull(),
    changelog: text("changelog").default("").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("course_versions_id_course_org_idx").on(
      table.id,
      table.courseId,
      table.organizationId,
    ),
    uniqueIndex("course_versions_org_course_number_idx").on(
      table.organizationId,
      table.courseId,
      table.version,
    ),
    index("course_versions_org_course_created_idx").on(
      table.organizationId,
      table.courseId,
      table.createdAt,
    ),
  ],
);

export const publishedCourseLinkEdges = pgTable(
  "published_course_link_edges",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceCourseId: uuid("source_course_id").notNull(),
    sourceVersionId: uuid("source_version_id").notNull(),
    linkModuleId: uuid("link_module_id").notNull(),
    targetCourseId: uuid("target_course_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceCourseId, table.linkModuleId] }),
    foreignKey({
      name: "published_course_link_edges_source_tenant_fk",
      columns: [table.sourceCourseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "published_course_link_edges_target_tenant_fk",
      columns: [table.targetCourseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "published_course_link_edges_version_tenant_fk",
      columns: [
        table.sourceVersionId,
        table.sourceCourseId,
        table.organizationId,
      ],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("cascade"),
    index("published_course_link_edges_org_target_idx").on(
      table.organizationId,
      table.targetCourseId,
    ),
    index("published_course_link_edges_org_source_version_idx").on(
      table.organizationId,
      table.sourceCourseId,
      table.sourceVersionId,
    ),
    check(
      "published_course_link_edges_no_self_check",
      sql`${table.sourceCourseId} <> ${table.targetCourseId}`,
    ),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    status: progressStatusEnum("status").default("not_started").notNull(),
    accessActive: boolean("access_active").default(true).notNull(),
    progress: integer("progress").default(0).notNull(),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("enrollments_user_course_idx").on(table.userId, table.courseId),
  ],
);

export const courseCertificates = pgTable(
  "course_certificates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    certificateNumber: varchar("certificate_number", { length: 64 }).notNull(),
    recipientName: varchar("recipient_name", { length: 220 }).notNull(),
    courseTitle: varchar("course_title", { length: 220 }).notNull(),
    organizationName: varchar("organization_name", { length: 160 }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    issuedById: uuid("issued_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedById: uuid("revoked_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revocationReason: text("revocation_reason"),
  },
  (table) => [
    uniqueIndex("course_certificates_number_idx").on(table.certificateNumber),
    uniqueIndex("course_certificates_active_user_course_idx")
      .on(table.organizationId, table.userId, table.courseId)
      .where(sql`${table.revokedAt} is null`),
    index("course_certificates_org_issued_idx").on(
      table.organizationId,
      table.issuedAt,
    ),
    index("course_certificates_user_issued_idx").on(
      table.userId,
      table.issuedAt,
    ),
  ],
);

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    status: progressStatusEnum("status").default("not_started").notNull(),
    percent: integer("percent").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("lesson_progress_user_lesson_idx").on(
      table.userId,
      table.lessonId,
    ),
  ],
);

export const lessonBookmarks = pgTable(
  "lesson_bookmarks",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    courseId: uuid("course_id").notNull(),
    moduleId: uuid("module_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "lesson_bookmarks_user_course_lesson_pk",
      columns: [table.userId, table.courseId, table.lessonId],
    }),
    foreignKey({
      name: "lesson_bookmarks_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_bookmarks_course_module_tenant_fk",
      columns: [table.courseId, table.moduleId, table.organizationId],
      foreignColumns: [
        courseModules.courseId,
        courseModules.moduleId,
        courseModules.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_bookmarks_lesson_module_tenant_fk",
      columns: [table.lessonId, table.moduleId, table.organizationId],
      foreignColumns: [
        lessons.id,
        lessons.moduleId,
        lessons.organizationId,
      ],
    }).onDelete("cascade"),
    index("lesson_bookmarks_org_user_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);

export const lessonLearningTimeSessions = pgTable(
  "lesson_learning_time_sessions",
  {
    id: uuid("id").primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    courseId: uuid("course_id").notNull(),
    courseVersionId: uuid("course_version_id").notNull(),
    lessonId: uuid("lesson_id").notNull(),
    lessonTitle: varchar("lesson_title", { length: 220 }).notNull(),
    lastSequence: integer("last_sequence").default(0).notNull(),
    activeSeconds: integer("active_seconds").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "lesson_learning_time_sessions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_learning_time_sessions_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_learning_time_sessions_version_scope_fk",
      columns: [
        table.courseVersionId,
        table.courseId,
        table.organizationId,
      ],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("cascade"),
    index("lesson_learning_time_sessions_org_course_idx").on(
      table.organizationId,
      table.courseId,
      table.lastHeartbeatAt,
    ),
    index("lesson_learning_time_sessions_org_user_idx").on(
      table.organizationId,
      table.userId,
      table.lastHeartbeatAt,
    ),
    index("lesson_learning_time_sessions_org_lesson_idx").on(
      table.organizationId,
      table.lessonId,
      table.lastHeartbeatAt,
    ),
    index("lesson_learning_time_sessions_org_version_idx").on(
      table.organizationId,
      table.courseVersionId,
      table.lastHeartbeatAt,
    ),
    check(
      "lesson_learning_time_sessions_sequence_check",
      sql`${table.lastSequence} >= 0 and ${table.lastSequence} <= 1000000`,
    ),
    check(
      "lesson_learning_time_sessions_active_seconds_check",
      sql`${table.activeSeconds} >= 0 and ${table.activeSeconds} <= 86400`,
    ),
    check(
      "lesson_learning_time_sessions_lesson_title_check",
      sql`length(btrim(${table.lessonTitle})) between 1 and 220`,
    ),
    check(
      "lesson_learning_time_sessions_timestamps_check",
      sql`${table.lastHeartbeatAt} >= ${table.startedAt} and ${table.updatedAt} >= ${table.lastHeartbeatAt}`,
    ),
  ],
);

type AssessmentQuestionSnapshotBase = {
  blockId: string;
  title: string | null;
  prompt: string;
  required: boolean;
  feedback: string | null;
};

export type AssessmentChoiceQuestionSnapshot =
  AssessmentQuestionSnapshotBase & {
    type: "multiple_choice" | "true_false";
    options: string[];
    correctOption: number;
  };

export type AssessmentQuestionSnapshot =
  | AssessmentChoiceQuestionSnapshot
  | (AssessmentQuestionSnapshotBase & {
      type: "multi_select";
      options: string[];
      correctOptions: number[];
    })
  | (AssessmentQuestionSnapshotBase & {
      type: "fill_blank";
      acceptedAnswers: string[];
      caseSensitive: boolean;
    })
  | (AssessmentQuestionSnapshotBase & {
      type: "ordering";
      correctOrder: string[];
    });

export type AssessmentAttemptSnapshot =
  | {
      schemaVersion: 1;
      questions: Array<Omit<AssessmentQuestionSnapshot, "type" | "feedback">>;
    }
  | {
      schemaVersion: 2;
      passingScore: number;
      maxAttempts: number | null;
      shuffleQuestions: boolean;
      questions: AssessmentChoiceQuestionSnapshot[];
    }
  | {
      schemaVersion: 3;
      passingScore: number;
      maxAttempts: number | null;
      shuffleQuestions: boolean;
      questions: AssessmentQuestionSnapshot[];
    };

export type AssessmentAnswerSnapshot =
  | { selectedOption: number; optionText: string }
  | { selectedOptions: number[]; optionTexts: string[] }
  | { textAnswer: string }
  | { orderedItemIds: string[] };

export type ExamQuestionPresentation = {
  blockId: string;
  type: string;
  title: string | null;
  required: boolean;
  data: ContentBlockData;
};

export type FrozenExamQuestionPool = {
  id: string;
  drawCount: number;
  availableQuestionIds: string[];
  selectedQuestionIds: string[];
};

export type ExamDraftAnswer =
  | { blockId: string; selectedOption: number }
  | { blockId: string; selectedOptions: number[] }
  | { blockId: string; textAnswer: string }
  | { blockId: string; orderedItemIds: string[] };

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    courseVersionId: uuid("course_version_id").references(
      () => courseVersions.id,
      { onDelete: "restrict" },
    ),
    definitionHash: varchar("definition_hash", { length: 64 }),
    attemptNumber: integer("attempt_number").notNull(),
    status: assessmentAttemptStatusEnum("status")
      .default("in_progress")
      .notNull(),
    score: real("score").default(0).notNull(),
    passed: boolean("passed").default(false).notNull(),
    questionCount: integer("question_count").notNull(),
    correctCount: integer("correct_count").default(0).notNull(),
    assessmentSnapshot: jsonb("assessment_snapshot")
      .$type<AssessmentAttemptSnapshot>()
      .notNull(),
    questionOrder: jsonb("question_order")
      .$type<string[]>()
      .default([])
      .notNull(),
    questionPools: jsonb("question_pools")
      .$type<FrozenExamQuestionPool[]>()
      .default([])
      .notNull(),
    questionPresentation: jsonb("question_presentation")
      .$type<ExamQuestionPresentation[]>()
      .default([])
      .notNull(),
    draftAnswers: jsonb("draft_answers")
      .$type<ExamDraftAnswer[]>()
      .default([])
      .notNull(),
    draftRevision: integer("draft_revision").default(0).notNull(),
    lastSavedAt: timestamp("last_saved_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    finalizationReason: examFinalizationReasonEnum("finalization_reason"),
    resultReleaseMode: examResultReleaseModeEnum("result_release_mode")
      .default("immediate")
      .notNull(),
    reviewReleaseMode: examReviewReleaseModeEnum("review_release_mode")
      .default("after_result")
      .notNull(),
    contentAccessMode: examContentAccessModeEnum("content_access_mode")
      .default("allow")
      .notNull(),
    resultReleasedAt: timestamp("result_released_at", {
      withTimezone: true,
    }),
    reviewReleasedAt: timestamp("review_released_at", {
      withTimezone: true,
    }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    gradedAt: timestamp("graded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "assessment_attempts_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "assessment_attempts_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "assessment_attempts_lesson_tenant_fk",
      columns: [table.lessonId, table.organizationId],
      foreignColumns: [lessons.id, lessons.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "assessment_attempts_version_scope_fk",
      columns: [table.courseVersionId, table.courseId, table.organizationId],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("assessment_attempts_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("assessment_attempts_org_user_course_lesson_no_idx").on(
      table.organizationId,
      table.userId,
      table.courseId,
      table.lessonId,
      table.attemptNumber,
    ),
    uniqueIndex("assessment_attempts_one_active_idx")
      .on(table.organizationId, table.userId, table.courseId, table.lessonId)
      .where(sql`${table.status} in ('in_progress', 'submitted')`),
    index("assessment_attempts_org_user_created_idx").on(
      table.organizationId,
      table.userId,
      table.createdAt,
    ),
    index("assessment_attempts_org_course_lesson_idx").on(
      table.organizationId,
      table.courseId,
      table.lessonId,
      table.createdAt,
    ),
    index("assessment_attempts_org_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("assessment_attempts_active_deadline_idx")
      .on(table.deadlineAt, table.id)
      .where(
        sql`${table.deadlineAt} is not null and ${table.status} in ('in_progress', 'submitted')`,
      ),
    index("assessment_attempts_result_release_deadline_idx")
      .on(table.deadlineAt, table.id)
      .where(
        sql`${table.deadlineAt} is not null and ${table.status} = 'graded' and ${table.resultReleaseMode} = 'after_deadline' and ${table.resultReleasedAt} is null`,
      ),
    check("assessment_attempts_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "assessment_attempts_definition_hash_check",
      sql`${table.definitionHash} is null or ${table.definitionHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "assessment_attempts_lifecycle_scope_check",
      sql`(${table.courseVersionId} is null and ${table.definitionHash} is null) or (${table.courseVersionId} is not null and ${table.definitionHash} is not null)`,
    ),
    check(
      "assessment_attempts_lifecycle_json_shape_check",
      sql`jsonb_typeof(${table.questionOrder}) = 'array' and jsonb_typeof(${table.questionPools}) = 'array' and jsonb_typeof(${table.questionPresentation}) = 'array' and jsonb_typeof(${table.draftAnswers}) = 'array'`,
    ),
    check(
      "assessment_attempts_draft_revision_check",
      sql`${table.draftRevision} >= 0`,
    ),
    check(
      "assessment_attempts_deadline_check",
      sql`${table.deadlineAt} is null or ${table.deadlineAt} > ${table.startedAt}`,
    ),
    check(
      "assessment_attempts_score_check",
      sql`${table.score} >= 0 and ${table.score} <= 100`,
    ),
    check(
      "assessment_attempts_counts_check",
      sql`${table.questionCount} > 0 and ${table.correctCount} >= 0 and ${table.correctCount} <= ${table.questionCount}`,
    ),
    check(
      "assessment_attempts_timestamps_check",
      sql`(${table.submittedAt} is null or ${table.submittedAt} >= ${table.startedAt}) and (${table.gradedAt} is null or (${table.submittedAt} is not null and ${table.gradedAt} >= ${table.submittedAt}))`,
    ),
    check(
      "assessment_attempts_release_timestamps_check",
      sql`(${table.resultReleasedAt} is null or (${table.gradedAt} is not null and ${table.resultReleasedAt} >= ${table.gradedAt})) and (${table.reviewReleasedAt} is null or (${table.resultReleasedAt} is not null and ${table.reviewReleasedAt} >= ${table.resultReleasedAt}))`,
    ),
  ],
);

export const assessmentAnswers = pgTable(
  "assessment_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => assessmentAttempts.id, { onDelete: "cascade" }),
    blockId: uuid("block_id").notNull(),
    questionSnapshot: jsonb("question_snapshot")
      .$type<AssessmentQuestionSnapshot>()
      .notNull(),
    selectedOption: integer("selected_option").notNull(),
    answerSnapshot: jsonb("answer_snapshot")
      .$type<AssessmentAnswerSnapshot>()
      .notNull(),
    correct: boolean("correct").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "assessment_answers_attempt_tenant_fk",
      columns: [table.attemptId, table.organizationId],
      foreignColumns: [
        assessmentAttempts.id,
        assessmentAttempts.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("assessment_answers_attempt_block_idx").on(
      table.attemptId,
      table.blockId,
    ),
    index("assessment_answers_org_attempt_idx").on(
      table.organizationId,
      table.attemptId,
    ),
    check(
      "assessment_answers_selected_option_check",
      sql`${table.selectedOption} >= 0`,
    ),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    blockId: uuid("block_id"),
    attemptNumber: integer("attempt_number").default(1).notNull(),
    supersedesId: uuid("supersedes_id").references(
      (): AnyPgColumn => submissions.id,
      { onDelete: "restrict" },
    ),
    title: varchar("title", { length: 220 }).notNull(),
    type: varchar("type", { length: 40 }).default("text").notNull(),
    content: text("content"),
    contentFormat: varchar("content_format", { length: 20 })
      .$type<"plain_text" | "rich_text">()
      .default("plain_text")
      .notNull(),
    richText: jsonb("rich_text").$type<RichTextDocument>(),
    contentProjectionVersion: integer("content_projection_version")
      .default(1)
      .notNull(),
    fileName: text("file_name"),
    status: submissionStatusEnum("status").default("open").notNull(),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    feedback: text("feedback"),
    score: real("score"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "submissions_supersedes_tenant_fk",
      columns: [table.supersedesId, table.organizationId],
      foreignColumns: [table.id, table.organizationId],
    }),
    index("submissions_org_status_idx").on(table.organizationId, table.status),
    index("submissions_org_member_block_idx").on(
      table.organizationId,
      table.userId,
      table.courseId,
      table.lessonId,
      table.blockId,
    ),
    uniqueIndex("submissions_org_member_block_attempt_idx")
      .on(
        table.organizationId,
        table.userId,
        table.courseId,
        table.lessonId,
        table.blockId,
        table.attemptNumber,
      )
      .where(
        sql`${table.blockId} is not null and ${table.lessonId} is not null`,
      ),
    uniqueIndex("submissions_supersedes_idx")
      .on(table.supersedesId)
      .where(sql`${table.supersedesId} is not null`),
    uniqueIndex("submissions_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    check("submissions_attempt_number_check", sql`${table.attemptNumber} > 0`),
    check(
      "submissions_supersedes_self_check",
      sql`${table.supersedesId} is null or ${table.supersedesId} <> ${table.id}`,
    ),
    check(
      "submissions_content_length_check",
      sql`${table.content} is null or char_length(${table.content}) <= 50000`,
    ),
    check(
      "submissions_content_document_shape_check",
      sql`(
        ${table.contentFormat} = 'plain_text'
        and ${table.richText} is null
        and ${table.contentProjectionVersion} = 1
      ) or (
        ${table.contentFormat} = 'rich_text'
        and ${table.content} is not null
        and btrim(${table.content}) <> ''
        and ${table.richText} is not null
        and jsonb_typeof(${table.richText}) = 'object'
        and ${table.richText} ->> 'version' = '1'
        and jsonb_typeof(${table.richText} -> 'blocks') = 'array'
        and char_length(${table.richText}::text) <= 100000
        and ${table.contentProjectionVersion} = 1
      )`,
    ),
  ],
);

export const submissionReviews = pgTable(
  "submission_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decision: submissionReviewDecisionEnum("decision").notNull(),
    feedback: text("feedback").notNull(),
    score: real("score").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "submission_reviews_submission_tenant_fk",
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [submissions.id, submissions.organizationId],
    }),
    foreignKey({
      name: "submission_reviews_reviewer_tenant_fk",
      columns: [table.reviewerId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("submission_reviews_submission_idx").on(table.submissionId),
    uniqueIndex("submission_reviews_id_submission_org_idx").on(
      table.id,
      table.submissionId,
      table.organizationId,
    ),
    index("submission_reviews_org_reviewed_idx").on(
      table.organizationId,
      table.reviewedAt,
    ),
    check(
      "submission_reviews_score_check",
      sql`${table.score} >= 0 and ${table.score} <= 100`,
    ),
  ],
);

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    purpose: mediaAssetPurposeEnum("purpose").notNull(),
    kind: mediaAssetKindEnum("kind").notNull(),
    status: mediaAssetStatusEnum("status").default("pending").notNull(),
    storageDriver: mediaStorageDriverEnum("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    stagingStorageKey: text("staging_storage_key").notNull(),
    originalFileName: varchar("original_file_name", { length: 255 }).notNull(),
    safeFileName: varchar("safe_file_name", { length: 120 }).notNull(),
    declaredMimeType: varchar("declared_mime_type", { length: 180 }).notNull(),
    detectedMimeType: varchar("detected_mime_type", { length: 180 }),
    declaredSizeBytes: bigint("declared_size_bytes", {
      mode: "number",
    }).notNull(),
    actualSizeBytes: bigint("actual_size_bytes", { mode: "number" }),
    durationMilliseconds: integer("duration_milliseconds"),
    quotaBytes: bigint("quota_bytes", { mode: "number" }).notNull(),
    etag: varchar("etag", { length: 255 }),
    stagingStorageVersionId: text("staging_storage_version_id"),
    storageVersionId: text("storage_version_id"),
    contentSha256: varchar("content_sha256", { length: 64 }),
    uploadExpiresAt: timestamp("upload_expires_at", {
      withTimezone: true,
    }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    scanAttempt: integer("scan_attempt").default(0).notNull(),
    scanClaimToken: uuid("scan_claim_token"),
    scanClaimedAt: timestamp("scan_claimed_at", { withTimezone: true }),
    scanLeaseExpiresAt: timestamp("scan_lease_expires_at", {
      withTimezone: true,
    }),
    scanNextRetryAt: timestamp("scan_next_retry_at", { withTimezone: true }),
    scanCompletedAt: timestamp("scan_completed_at", { withTimezone: true }),
    scanFailureCode: varchar("scan_failure_code", { length: 80 }),
    scanFailureDetail: text("scan_failure_detail"),
    malwareSignature: varchar("malware_signature", { length: 255 }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    storageDeletedAt: timestamp("storage_deleted_at", { withTimezone: true }),
    stagingDeletedAt: timestamp("staging_deleted_at", { withTimezone: true }),
    multipartAbortVerifiedAt: timestamp("multipart_abort_verified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "media_assets_uploader_tenant_fk",
      columns: [table.uploadedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "media_assets_owner_tenant_fk",
      columns: [table.ownerUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("media_assets_storage_key_idx").on(table.storageKey),
    uniqueIndex("media_assets_staging_storage_key_idx").on(
      table.stagingStorageKey,
    ),
    uniqueIndex("media_assets_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("media_assets_id_org_kind_idx").on(
      table.id,
      table.organizationId,
      table.kind,
    ),
    index("media_assets_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("media_assets_org_status_idx").on(table.organizationId, table.status),
    index("media_assets_org_owner_idx").on(
      table.organizationId,
      table.ownerUserId,
    ),
    index("media_assets_scan_queue_idx").on(
      table.status,
      table.scanNextRetryAt,
      table.createdAt,
    ),
    index("media_assets_scan_lease_idx").on(
      table.status,
      table.scanLeaseExpiresAt,
    ),
    check(
      "media_assets_declared_size_check",
      sql`${table.declaredSizeBytes} > 0`,
    ),
    check(
      "media_assets_storage_key_namespace_check",
      sql`${table.storageKey} like ('tenants/' || ${table.organizationId}::text || '/assets/' || ${table.id}::text || '/%')`,
    ),
    check(
      "media_assets_staging_key_namespace_check",
      sql`${table.stagingStorageKey} like ('incoming/tenants/' || ${table.organizationId}::text || '/assets/' || ${table.id}::text || '/%')`,
    ),
    check(
      "media_assets_distinct_storage_keys_check",
      sql`${table.storageKey} <> ${table.stagingStorageKey}`,
    ),
    check(
      "media_assets_safe_file_name_check",
      sql`${table.safeFileName} ~ '^[a-z0-9][a-z0-9_-]{0,114}[.][a-z0-9]{1,8}$'`,
    ),
    check(
      "media_assets_actual_size_check",
      sql`${table.actualSizeBytes} is null or ${table.actualSizeBytes} > 0`,
    ),
    check(
      "media_assets_duration_state_check",
      sql`${table.durationMilliseconds} is null or (${table.durationMilliseconds} > 0 and ${table.kind} in ('audio', 'video') and ${table.status} in ('ready', 'deleted'))`,
    ),
    check("media_assets_scan_attempt_check", sql`${table.scanAttempt} >= 0`),
    check(
      "media_assets_quota_state_check",
      sql`((${table.status} = 'deleted' and ${table.deletedAt} is not null) or (${table.status} in ('quarantined', 'failed') and ${table.deletedAt} is null)) and (${table.quotaBytes} = ${table.declaredSizeBytes} or (${table.quotaBytes} = 0 and ${table.storageDeletedAt} is not null and ${table.stagingDeletedAt} is not null and (${table.stagingDeletedAt} >= ${table.uploadExpiresAt} + interval '1 hour' or (${table.multipartAbortVerifiedAt} is not null and ${table.stagingDeletedAt} >= ${table.multipartAbortVerifiedAt})))) or (${table.status} not in ('deleted', 'quarantined', 'failed') and ${table.quotaBytes} = ${table.declaredSizeBytes} and ${table.deletedAt} is null)`,
    ),
    check(
      "media_assets_multipart_abort_proof_check",
      sql`${table.multipartAbortVerifiedAt} is null or (${table.status} = 'deleted' and ${table.deletedAt} is not null and ${table.quotaBytes} = 0 and ${table.storageDeletedAt} is not null and ${table.stagingDeletedAt} is not null and ${table.multipartAbortVerifiedAt} >= ${table.deletedAt} and ${table.storageDeletedAt} >= ${table.multipartAbortVerifiedAt} and ${table.stagingDeletedAt} >= ${table.multipartAbortVerifiedAt})`,
    ),
    check(
      "media_assets_upload_state_check",
      sql`${table.status} = 'deleted' or (${table.status} = 'pending' and ${table.actualSizeBytes} is null and ${table.uploadedAt} is null) or (${table.status} in ('uploaded', 'scanning', 'ready', 'quarantined', 'failed') and ${table.actualSizeBytes} is not null and ${table.uploadedAt} is not null)`,
    ),
    check(
      "media_assets_scan_lease_state_check",
      sql`(${table.status} = 'scanning' and ${table.scanClaimToken} is not null and ${table.scanClaimedAt} is not null and ${table.scanLeaseExpiresAt} is not null) or (${table.status} <> 'scanning' and ${table.scanClaimToken} is null and ${table.scanClaimedAt} is null and ${table.scanLeaseExpiresAt} is null)`,
    ),
    check(
      "media_assets_scan_completion_state_check",
      sql`${table.status} = 'deleted' or (${table.status} in ('ready', 'quarantined', 'failed') and ${table.scanCompletedAt} is not null) or (${table.status} in ('pending', 'uploaded', 'scanning') and ${table.scanCompletedAt} is null)`,
    ),
    check(
      "media_assets_malware_state_check",
      sql`${table.malwareSignature} is null or ${table.status} in ('quarantined', 'deleted')`,
    ),
    check(
      "media_assets_storage_version_state_check",
      sql`(${table.storageDriver} = 'filesystem' and ${table.stagingStorageVersionId} is null and ${table.storageVersionId} is null) or (${table.storageDriver} = 's3' and (${table.status} in ('pending', 'quarantined', 'failed', 'deleted') or ${table.stagingStorageVersionId} is not null) and (${table.status} <> 'ready' or ${table.storageVersionId} is not null) and (${table.storageVersionId} is null or ${table.status} in ('ready', 'deleted')))`,
    ),
    check(
      "media_assets_storage_version_format_check",
      sql`(${table.stagingStorageVersionId} is null or (length(${table.stagingStorageVersionId}) between 1 and 1024 and btrim(${table.stagingStorageVersionId}) <> '')) and (${table.storageVersionId} is null or (length(${table.storageVersionId}) between 1 and 1024 and btrim(${table.storageVersionId}) <> ''))`,
    ),
    check(
      "media_assets_content_digest_state_check",
      sql`${table.storageDriver} = 'filesystem' or (${table.contentSha256} is null and ${table.status} <> 'ready') or (${table.contentSha256} ~ '^[0-9a-f]{64}$' and ${table.status} in ('ready', 'deleted'))`,
    ),
  ],
);

export const mediaUploadSessions = pgTable(
  "media_upload_sessions",
  {
    assetId: uuid("asset_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    initializationToken: uuid("initialization_token").defaultRandom().notNull(),
    providerUploadId: varchar("provider_upload_id", { length: 1024 }),
    partSizeBytes: bigint("part_size_bytes", { mode: "number" }).notNull(),
    expectedPartCount: integer("expected_part_count").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    uploadDeadlineAt: timestamp("upload_deadline_at", {
      withTimezone: true,
    }).notNull(),
    state: varchar("state", { length: 32 })
      .$type<MediaUploadSessionState>()
      .default("uploading")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "media_upload_sessions_asset_tenant_fk",
      columns: [table.assetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    index("media_upload_sessions_org_expiry_state_idx").on(
      table.organizationId,
      table.expiresAt,
      table.state,
    ),
    check(
      "media_upload_sessions_provider_state_check",
      sql`(${table.state} in ('initializing', 'recovering') and ${table.providerUploadId} is null) or (${table.state} = 'aborting' and (${table.providerUploadId} is null or length(${table.providerUploadId}) between 1 and 1024)) or (${table.state} not in ('initializing', 'recovering', 'aborting') and ${table.providerUploadId} is not null and length(${table.providerUploadId}) between 1 and 1024)`,
    ),
    check(
      "media_upload_sessions_state_check",
      sql`${table.state} in ('initializing', 'recovering', 'uploading', 'completing', 'aborting')`,
    ),
    check(
      "media_upload_sessions_part_size_check",
      sql`${table.partSizeBytes} >= 5242880`,
    ),
    check(
      "media_upload_sessions_expected_part_count_check",
      sql`${table.expectedPartCount} between 1 and 10000`,
    ),
    check(
      "media_upload_sessions_deadline_check",
      sql`${table.uploadDeadlineAt} <= ${table.expiresAt}`,
    ),
  ],
);

export const courseMediaAssets = pgTable(
  "course_media_assets",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    attachedById: uuid("attached_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "course_media_assets_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "course_media_assets_media_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "course_media_assets_attached_by_tenant_fk",
      columns: [table.attachedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("course_media_assets_org_course_asset_idx").on(
      table.organizationId,
      table.courseId,
      table.mediaAssetId,
    ),
    index("course_media_assets_org_course_created_idx").on(
      table.organizationId,
      table.courseId,
      table.createdAt,
    ),
    index("course_media_assets_org_asset_idx").on(
      table.organizationId,
      table.mediaAssetId,
    ),
    index("course_media_assets_org_attached_by_idx").on(
      table.organizationId,
      table.attachedById,
    ),
  ],
);

export const stockImageSelections = pgTable(
  "stock_image_selections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").notNull(),
    selectedById: uuid("selected_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    provider: varchar("provider", { length: 80 }).notNull(),
    externalId: varchar("external_id", { length: 200 }).notNull(),
    imageUrl: text("image_url").notNull(),
    previewUrl: text("preview_url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    altText: varchar("alt_text", { length: 500 }),
    author: varchar("author", { length: 200 }).notNull(),
    authorUrl: text("author_url"),
    sourceUrl: text("source_url").notNull(),
    attribution: varchar("attribution", { length: 500 }).notNull(),
    downloadTrackedAt: timestamp("download_tracked_at", { withTimezone: true })
      .notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "stock_image_selections_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    index("stock_image_selections_org_course_created_idx").on(
      table.organizationId,
      table.courseId,
      table.createdAt,
    ),
    index("stock_image_selections_expiry_idx").on(table.expiresAt),
    index("stock_image_selections_selected_by_idx").on(
      table.organizationId,
      table.selectedById,
    ),
    check(
      "stock_image_selections_dimensions_check",
      sql`${table.width} > 0 and ${table.width} <= 50000 and ${table.height} > 0 and ${table.height} <= 50000`,
    ),
    check(
      "stock_image_selections_https_check",
      sql`${table.imageUrl} ~ '^https://' and ${table.previewUrl} ~ '^https://' and ${table.sourceUrl} ~ '^https://' and (${table.authorUrl} is null or ${table.authorUrl} ~ '^https://')`,
    ),
    check(
      "stock_image_selections_timeline_check",
      sql`${table.downloadTrackedAt} >= ${table.createdAt} and ${table.expiresAt} > ${table.createdAt} and (${table.usedAt} is null or ${table.usedAt} >= ${table.createdAt})`,
    ),
  ],
);

export type MediaProcessingOptions = {
  language?: string;
  width?: number;
  height?: number;
  atMilliseconds?: number;
  videoCodec?: "h264";
  audioCodec?: "aac";
  videoEdit?: import("@/lib/media/video-edit-plan").VideoEditPlan;
  videoComposition?: import("@/lib/media/video-composition").BoundVideoComposition;
  videoCompositionCourseId?: string;
};

export type MediaProcessingResult = {
  derivativeId?: string;
  transcriptId?: string;
};

export const mediaProcessingJobs = pgTable(
  "media_processing_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceAssetId: uuid("source_asset_id").notNull(),
    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: mediaProcessingJobTypeEnum("type").notNull(),
    status: mediaProcessingJobStatusEnum("status").default("queued").notNull(),
    requestKey: varchar("request_key", { length: 64 }).notNull(),
    sourceContentSha256: varchar("source_content_sha256", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    options: jsonb("options").$type<MediaProcessingOptions>().default({}).notNull(),
    result: jsonb("result").$type<MediaProcessingResult>(),
    attempt: integer("attempt").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    claimToken: uuid("claim_token"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "media_processing_jobs_source_tenant_fk",
      columns: [table.sourceAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_processing_jobs_requester_tenant_fk",
      columns: [table.requestedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("media_processing_jobs_request_key_idx").on(table.requestKey),
    uniqueIndex("media_processing_jobs_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("media_processing_jobs_queue_idx").on(
      table.status,
      table.nextRetryAt,
      table.createdAt,
    ),
    check(
      "media_processing_jobs_source_digest_check",
      sql`${table.sourceContentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "media_processing_jobs_attempt_check",
      sql`${table.attempt} >= 0 and ${table.maxAttempts} between 1 and 10 and ${table.attempt} <= ${table.maxAttempts}`,
    ),
    check(
      "media_processing_jobs_lease_state_check",
      sql`(${table.status} = 'processing' and ${table.claimToken} is not null and ${table.claimedAt} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'processing' and ${table.claimToken} is null and ${table.claimedAt} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "media_processing_jobs_completion_state_check",
      sql`(${table.status} = 'succeeded' and ${table.completedAt} is not null and ${table.result} is not null and ${table.failureCode} is null) or (${table.status} = 'failed' and ${table.completedAt} is not null and ${table.failureCode} is not null and ${table.result} is null) or (${table.status} = 'cancelled' and ${table.completedAt} is not null and ${table.result} is null) or (${table.status} in ('queued', 'processing') and ${table.completedAt} is null and ${table.result} is null)`,
    ),
  ],
);

export const mediaAssetDerivatives = pgTable(
  "media_asset_derivatives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceAssetId: uuid("source_asset_id").notNull(),
    processingJobId: uuid("processing_job_id").notNull(),
    kind: mediaDerivativeKindEnum("kind").notNull(),
    storageDriver: mediaStorageDriverEnum("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    storageVersionId: varchar("storage_version_id", { length: 1024 }),
    storageEtag: varchar("storage_etag", { length: 255 }),
    mimeType: varchar("mime_type", { length: 180 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    durationMilliseconds: integer("duration_milliseconds"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "media_asset_derivatives_source_tenant_fk",
      columns: [table.sourceAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_asset_derivatives_job_tenant_fk",
      columns: [table.processingJobId, table.organizationId],
      foreignColumns: [mediaProcessingJobs.id, mediaProcessingJobs.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("media_asset_derivatives_job_idx").on(table.processingJobId),
    uniqueIndex("media_asset_derivatives_storage_key_idx").on(table.storageKey),
    index("media_asset_derivatives_source_kind_idx").on(
      table.organizationId,
      table.sourceAssetId,
      table.kind,
      table.createdAt,
    ),
    check("media_asset_derivatives_size_check", sql`${table.sizeBytes} > 0`),
    check(
      "media_asset_derivatives_digest_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "media_asset_derivatives_dimensions_check",
      sql`(${table.kind} = 'thumbnail' and ${table.width} > 0 and ${table.height} > 0 and ${table.durationMilliseconds} is null) or (${table.kind} = 'transcode' and ${table.width} is null and ${table.height} is null and ${table.durationMilliseconds} > 0)`,
    ),
    check(
      "media_asset_derivatives_storage_identity_check",
      sql`(${table.storageDriver} = 'filesystem' and ${table.storageVersionId} is null and ${table.storageEtag} is null) or (${table.storageDriver} = 's3' and ${table.storageVersionId} is not null and btrim(${table.storageVersionId}) <> '' and ${table.storageEtag} is not null and btrim(${table.storageEtag}) <> '')`,
    ),
  ],
);

export const mediaAssetTranscripts = pgTable(
  "media_asset_transcripts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceAssetId: uuid("source_asset_id").notNull(),
    processingJobId: uuid("processing_job_id").notNull(),
    sourceContentSha256: varchar("source_content_sha256", { length: 64 }).notNull(),
    language: varchar("language", { length: 35 }).notNull(),
    provider: varchar("provider", { length: 120 }).notNull(),
    document: jsonb("document").$type<VideoTranscriptDocument>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "media_asset_transcripts_source_tenant_fk",
      columns: [table.sourceAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_asset_transcripts_job_tenant_fk",
      columns: [table.processingJobId, table.organizationId],
      foreignColumns: [mediaProcessingJobs.id, mediaProcessingJobs.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("media_asset_transcripts_job_idx").on(table.processingJobId),
    index("media_asset_transcripts_source_language_idx").on(
      table.organizationId,
      table.sourceAssetId,
      table.language,
      table.createdAt,
    ),
    check(
      "media_asset_transcripts_digest_check",
      sql`${table.sourceContentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "media_asset_transcripts_language_check",
      sql`${table.language} ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'`,
    ),
  ],
);

export const mediaPlaybackProgress = pgTable(
  "media_playback_progress",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    courseId: uuid("course_id").notNull(),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    blockId: uuid("block_id")
      .notNull()
      .references(() => contentBlocks.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").notNull(),
    watchedMilliseconds: integer("watched_milliseconds").default(0).notNull(),
    furthestMilliseconds: integer("furthest_milliseconds").default(0).notNull(),
    requiredMilliseconds: integer("required_milliseconds").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "media_playback_progress_pk",
      columns: [table.userId, table.courseId, table.lessonId, table.blockId],
    }),
    foreignKey({
      name: "media_playback_progress_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_playback_progress_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_playback_progress_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    index("media_playback_progress_lesson_user_idx").on(
      table.organizationId,
      table.userId,
      table.lessonId,
    ),
    check(
      "media_playback_progress_bounds_check",
      sql`${table.watchedMilliseconds} >= 0 and ${table.furthestMilliseconds} >= 0 and ${table.requiredMilliseconds} > 0 and ${table.watchedMilliseconds} <= ${table.requiredMilliseconds}`,
    ),
    check(
      "media_playback_progress_completion_check",
      sql`${table.completedAt} is null or ${table.watchedMilliseconds} >= ${table.requiredMilliseconds}`,
    ),
  ],
);

export const submissionAttachments = pgTable(
  "submission_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "submission_attachments_submission_tenant_fk",
      columns: [table.submissionId, table.organizationId],
      foreignColumns: [submissions.id, submissions.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "submission_attachments_media_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("submission_attachments_media_asset_idx").on(
      table.mediaAssetId,
    ),
    uniqueIndex("submission_attachments_asset_submission_org_idx").on(
      table.mediaAssetId,
      table.submissionId,
      table.organizationId,
    ),
    index("submission_attachments_org_submission_idx").on(
      table.organizationId,
      table.submissionId,
      table.sortOrder,
    ),
    check(
      "submission_attachments_sort_order_check",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const submissionReviewAnnotations = pgTable(
  "submission_review_annotations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reviewId: uuid("review_id").notNull(),
    submissionId: uuid("submission_id").notNull(),
    type: submissionReviewAnnotationTypeEnum("type").notNull(),
    body: text("body").notNull(),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    mediaAssetId: uuid("media_asset_id"),
    mediaAssetKind: mediaAssetKindEnum("media_asset_kind"),
    timestampMilliseconds: integer("timestamp_milliseconds"),
    sortOrder: integer("sort_order").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "submission_review_annotations_review_scope_fk",
      columns: [table.reviewId, table.submissionId, table.organizationId],
      foreignColumns: [
        submissionReviews.id,
        submissionReviews.submissionId,
        submissionReviews.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "submission_review_annotations_attachment_scope_fk",
      columns: [table.mediaAssetId, table.submissionId, table.organizationId],
      foreignColumns: [
        submissionAttachments.mediaAssetId,
        submissionAttachments.submissionId,
        submissionAttachments.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "submission_review_annotations_media_kind_fk",
      columns: [table.mediaAssetId, table.organizationId, table.mediaAssetKind],
      foreignColumns: [
        mediaAssets.id,
        mediaAssets.organizationId,
        mediaAssets.kind,
      ],
    }).onDelete("restrict"),
    uniqueIndex("submission_review_annotations_review_order_idx").on(
      table.reviewId,
      table.sortOrder,
    ),
    uniqueIndex("submission_review_annotations_review_fingerprint_idx").on(
      table.reviewId,
      table.fingerprint,
    ),
    index("submission_review_annotations_org_submission_idx").on(
      table.organizationId,
      table.submissionId,
      table.sortOrder,
    ),
    index("submission_review_annotations_org_asset_idx").on(
      table.organizationId,
      table.mediaAssetId,
    ),
    check(
      "submission_review_annotations_body_check",
      sql`char_length(${table.body}) between 1 and 2000 and btrim(${table.body}) <> ''`,
    ),
    check(
      "submission_review_annotations_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "submission_review_annotations_sort_order_check",
      sql`${table.sortOrder} >= 0 and ${table.sortOrder} < 100`,
    ),
    check(
      "submission_review_annotations_shape_check",
      sql`(
        ${table.type} = 'text_range'
        and ${table.startOffset} >= 0
        and ${table.endOffset} > ${table.startOffset}
        and ${table.mediaAssetId} is null
        and ${table.mediaAssetKind} is null
        and ${table.timestampMilliseconds} is null
      ) or (
        ${table.type} = 'media_timestamp'
        and ${table.startOffset} is null
        and ${table.endOffset} is null
        and ${table.mediaAssetId} is not null
        and ${table.mediaAssetKind} in ('audio', 'video')
        and ${table.timestampMilliseconds} >= 0
      )`,
    ),
  ],
);

export const feedbackEntries = pgTable(
  "feedback_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id").references(() => courses.id, {
      onDelete: "set null",
    }),
    lessonId: uuid("lesson_id").references(() => lessons.id, {
      onDelete: "set null",
    }),
    type: varchar("type", { length: 40 }).default("course").notNull(),
    rating: integer("rating").notNull(),
    content: text("content").notNull(),
    testimonialConsent: boolean("testimonial_consent").default(false).notNull(),
    status: feedbackStatusEnum("status").default("new").notNull(),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("feedback_entries_org_status_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    check(
      "feedback_entries_rating_check",
      sql`${table.rating} between 1 and 5`,
    ),
  ],
);

export const bundles = pgTable(
  "bundles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#ee6c5d").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("bundles_org_name_idx").on(table.organizationId, table.name),
    uniqueIndex("bundles_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
  ],
);

export const bundleCourses = pgTable(
  "bundle_courses",
  {
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    availableFrom: timestamp("available_from", { withTimezone: true }),
    availableUntil: timestamp("available_until", { withTimezone: true }),
    delayDays: integer("delay_days").default(0).notNull(),
    visible: boolean("visible").default(true).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bundleId, table.courseId] }),
    index("bundle_courses_course_idx").on(table.courseId),
    check(
      "bundle_courses_delay_days_check",
      sql`${table.delayDays} >= 0 and ${table.delayDays} <= 3650`,
    ),
    check(
      "bundle_courses_availability_window_check",
      sql`${table.availableFrom} is null or ${table.availableUntil} is null or ${table.availableUntil} > ${table.availableFrom}`,
    ),
  ],
);

export const groupCourses = pgTable(
  "group_courses",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.courseId] })],
);

export const groupBundles = pgTable(
  "group_bundles",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.bundleId] })],
);

export const memberBundles = pgTable(
  "member_bundles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => bundles.id, { onDelete: "cascade" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.bundleId] })],
);

export const courseAccessGrants = pgTable(
  "course_access_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 240 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("course_access_grants_user_course_source_idx").on(
      table.userId,
      table.courseId,
      table.source,
    ),
    index("course_access_grants_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const commerceProviderConnections = pgTable(
  "commerce_provider_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 32 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    endpointKey: varchar("endpoint_key", { length: 80 }).notNull(),
    signatureMode: varchar("signature_mode", { length: 40 }).notNull(),
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    active: boolean("active").default(true).notNull(),
    autoCreateMembers: boolean("auto_create_members").default(true).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("commerce_connections_endpoint_key_idx").on(table.endpointKey),
    uniqueIndex("commerce_connections_org_provider_idx").on(
      table.organizationId,
      table.provider,
    ),
    uniqueIndex("commerce_connections_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("commerce_connections_org_active_idx").on(
      table.organizationId,
      table.active,
    ),
    check(
      "commerce_connections_provider_check",
      sql`${table.provider} in ('digistore24', 'ablefy', 'copecart')`,
    ),
    check(
      "commerce_connections_signature_mode_check",
      sql`${table.signatureMode} in ('hmac_sha256', 'digistore_sha512', 'shared_token')`,
    ),
  ],
);

export const commerceProducts = pgTable(
  "commerce_products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 180 }).notNull(),
    sku: varchar("sku", { length: 120 }).notNull(),
    bundleId: uuid("bundle_id").notNull(),
    active: boolean("active").default(true).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_products_bundle_tenant_fk",
      columns: [table.bundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("commerce_products_org_sku_idx").on(
      table.organizationId,
      table.sku,
    ),
    uniqueIndex("commerce_products_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("commerce_products_org_active_idx").on(
      table.organizationId,
      table.active,
    ),
    check("commerce_products_sku_check", sql`btrim(${table.sku}) <> ''`),
  ],
);

export const commerceProductMappings = pgTable(
  "commerce_product_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    productId: uuid("product_id").notNull(),
    providerProductId: varchar("provider_product_id", { length: 240 }).notNull(),
    providerVariantId: varchar("provider_variant_id", { length: 240 })
      .default("")
      .notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_product_mappings_connection_tenant_fk",
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [
        commerceProviderConnections.id,
        commerceProviderConnections.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "commerce_product_mappings_product_tenant_fk",
      columns: [table.productId, table.organizationId],
      foreignColumns: [commerceProducts.id, commerceProducts.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("commerce_product_mappings_provider_product_idx").on(
      table.connectionId,
      table.providerProductId,
      table.providerVariantId,
    ),
    uniqueIndex("commerce_product_mappings_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("commerce_product_mappings_org_product_idx").on(
      table.organizationId,
      table.productId,
    ),
  ],
);

export const commerceOrders = pgTable(
  "commerce_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    productId: uuid("product_id").notNull(),
    mappingId: uuid("mapping_id").notNull(),
    userId: uuid("user_id"),
    externalOrderId: varchar("external_order_id", { length: 240 }).notNull(),
    customerEmail: varchar("customer_email", { length: 255 }).notNull(),
    currency: varchar("currency", { length: 3 }),
    totalMinor: integer("total_minor"),
    status: varchar("status", { length: 32 }).notNull(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_orders_connection_tenant_fk",
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [
        commerceProviderConnections.id,
        commerceProviderConnections.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_orders_product_tenant_fk",
      columns: [table.productId, table.organizationId],
      foreignColumns: [commerceProducts.id, commerceProducts.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_orders_mapping_tenant_fk",
      columns: [table.mappingId, table.organizationId],
      foreignColumns: [
        commerceProductMappings.id,
        commerceProductMappings.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_orders_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("commerce_orders_connection_external_idx").on(
      table.connectionId,
      table.externalOrderId,
    ),
    uniqueIndex("commerce_orders_id_org_idx").on(table.id, table.organizationId),
    index("commerce_orders_org_ordered_idx").on(
      table.organizationId,
      table.orderedAt,
    ),
    check(
      "commerce_orders_status_check",
      sql`${table.status} in ('pending', 'paid', 'payment_failed', 'refunded', 'cancelled')`,
    ),
    check(
      "commerce_orders_currency_check",
      sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "commerce_orders_total_minor_check",
      sql`${table.totalMinor} is null or ${table.totalMinor} >= 0`,
    ),
  ],
);

export const commerceSubscriptions = pgTable(
  "commerce_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    productId: uuid("product_id").notNull(),
    orderId: uuid("order_id"),
    userId: uuid("user_id").notNull(),
    externalSubscriptionId: varchar("external_subscription_id", {
      length: 240,
    }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_subscriptions_connection_tenant_fk",
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [
        commerceProviderConnections.id,
        commerceProviderConnections.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_subscriptions_product_tenant_fk",
      columns: [table.productId, table.organizationId],
      foreignColumns: [commerceProducts.id, commerceProducts.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_subscriptions_order_tenant_fk",
      columns: [table.orderId, table.organizationId],
      foreignColumns: [commerceOrders.id, commerceOrders.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_subscriptions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("commerce_subscriptions_connection_external_idx").on(
      table.connectionId,
      table.externalSubscriptionId,
    ),
    uniqueIndex("commerce_subscriptions_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("commerce_subscriptions_org_status_idx").on(
      table.organizationId,
      table.status,
      table.currentPeriodEnd,
    ),
    check(
      "commerce_subscriptions_status_check",
      sql`${table.status} in ('pending', 'active', 'past_due', 'cancelled', 'expired')`,
    ),
    check(
      "commerce_subscriptions_cancel_state_check",
      sql`${table.cancelAtPeriodEnd} = false or ${table.currentPeriodEnd} is not null`,
    ),
  ],
);

export const commerceEntitlements = pgTable(
  "commerce_entitlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id"),
    userId: uuid("user_id").notNull(),
    productId: uuid("product_id").notNull(),
    bundleId: uuid("bundle_id").notNull(),
    orderId: uuid("order_id"),
    subscriptionId: uuid("subscription_id"),
    sourceKey: varchar("source_key", { length: 520 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "commerce_entitlements_connection_tenant_fk",
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [
        commerceProviderConnections.id,
        commerceProviderConnections.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_entitlements_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "commerce_entitlements_product_tenant_fk",
      columns: [table.productId, table.organizationId],
      foreignColumns: [commerceProducts.id, commerceProducts.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_entitlements_bundle_tenant_fk",
      columns: [table.bundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_entitlements_order_tenant_fk",
      columns: [table.orderId, table.organizationId],
      foreignColumns: [commerceOrders.id, commerceOrders.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "commerce_entitlements_subscription_tenant_fk",
      columns: [table.subscriptionId, table.organizationId],
      foreignColumns: [
        commerceSubscriptions.id,
        commerceSubscriptions.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("commerce_entitlements_org_source_idx").on(
      table.organizationId,
      table.sourceKey,
    ),
    uniqueIndex("commerce_entitlements_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("commerce_entitlements_org_user_status_idx").on(
      table.organizationId,
      table.userId,
      table.status,
    ),
    index("commerce_entitlements_expiry_idx").on(table.status, table.endsAt),
    check(
      "commerce_entitlements_status_check",
      sql`${table.status} in ('active', 'revoked', 'expired')`,
    ),
    check(
      "commerce_entitlements_window_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "commerce_entitlements_revocation_state_check",
      sql`(${table.status} = 'active' and ${table.revokedAt} is null) or (${table.status} in ('revoked', 'expired') and ${table.revokedAt} is not null)`,
    ),
  ],
);

export const commerceInboundEvents = pgTable(
  "commerce_inbound_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").notNull(),
    externalEventId: varchar("external_event_id", { length: 240 }).notNull(),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    normalizedPayload: jsonb("normalized_payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: varchar("status", { length: 24 }).default("processing").notNull(),
    errorCode: varchar("error_code", { length: 80 }),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "commerce_inbound_events_connection_tenant_fk",
      columns: [table.connectionId, table.organizationId],
      foreignColumns: [
        commerceProviderConnections.id,
        commerceProviderConnections.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("commerce_inbound_events_connection_external_idx").on(
      table.connectionId,
      table.externalEventId,
    ),
    index("commerce_inbound_events_org_received_idx").on(
      table.organizationId,
      table.receivedAt,
    ),
    check(
      "commerce_inbound_events_hash_check",
      sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "commerce_inbound_events_status_check",
      sql`${table.status} in ('processing', 'processed', 'ignored', 'failed')`,
    ),
  ],
);

export const commerceOutboxEvents = pgTable(
  "commerce_outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    aggregateType: varchar("aggregate_type", { length: 48 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("commerce_outbox_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("commerce_outbox_pending_idx")
      .on(table.createdAt)
      .where(sql`${table.publishedAt} is null`),
  ],
);

export const organizationSupportSettings = pgTable(
  "organization_support_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    provider: varchar("provider", { length: 24 }).default("link").notNull(),
    launcherLabel: varchar("launcher_label", { length: 80 })
      .default("Support")
      .notNull(),
    supportUrl: text("support_url"),
    supportEmail: varchar("support_email", { length: 255 }),
    intercomAppId: varchar("intercom_app_id", { length: 120 }),
    identitySecretEncrypted: text("identity_secret_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "organization_support_settings_provider_check",
      sql`${table.provider} in ('link', 'email', 'intercom')`,
    ),
    check(
      "organization_support_settings_configuration_check",
      sql`${table.enabled} = false or (${table.provider} = 'link' and ${table.supportUrl} is not null) or (${table.provider} = 'email' and ${table.supportEmail} is not null) or (${table.provider} = 'intercom' and ${table.intercomAppId} is not null and ${table.identitySecretEncrypted} is not null and ${table.identitySecretEncrypted} <> '')`,
    ),
  ],
);

export const memberSidebarLinks = pgTable(
  "member_sidebar_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 80 }).notNull(),
    description: varchar("description", { length: 240 }),
    href: text("href").notNull(),
    icon: varchar("icon", { length: 32 }).default("link").notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_sidebar_links_org_label_lower_idx").on(
      table.organizationId,
      sql`lower(${table.label})`,
    ),
    uniqueIndex("member_sidebar_links_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("member_sidebar_links_org_active_sort_idx").on(
      table.organizationId,
      table.active,
      table.sortOrder,
      table.id,
    ),
    check(
      "member_sidebar_links_label_check",
      sql`length(btrim(${table.label})) between 1 and 80`,
    ),
    check(
      "member_sidebar_links_description_check",
      sql`${table.description} is null or length(btrim(${table.description})) between 1 and 240`,
    ),
    check(
      "member_sidebar_links_href_check",
      sql`length(${table.href}) between 1 and 2048 and ${table.href} !~ '[[:cntrl:]]' and (${table.href} ~ '^/[A-Za-z0-9]' or ${table.href} ~ '^https://[^[:space:]]+$')`,
    ),
    check(
      "member_sidebar_links_icon_check",
      sql`${table.icon} in ('link', 'book-open', 'life-buoy', 'video', 'file-text', 'globe', 'messages-square', 'calendar', 'home', 'graduation-cap', 'library', 'bookmark', 'award', 'trophy', 'users', 'user-round', 'briefcase', 'building', 'chart', 'clipboard-check', 'circle-help', 'lightbulb', 'megaphone', 'mail', 'phone', 'map-pin', 'rocket', 'star', 'target', 'heart', 'shield-check', 'shopping-bag')`,
    ),
    check(
      "member_sidebar_links_sort_order_check",
      sql`${table.sortOrder} between 0 and 999`,
    ),
  ],
);

type HubLayoutWidgetBase = {
  title: string;
  description?: string;
  color?: string;
};

export type HubLayoutWidget =
  | (HubLayoutWidgetBase & {
      type: "link" | "text" | "contact" | "stat" | "event" | "code";
      href?: string;
      formId?: never;
      agentId?: never;
    })
  | (HubLayoutWidgetBase & {
      type: "embed";
      href: string;
      formId?: never;
      agentId?: never;
    })
  | (HubLayoutWidgetBase & {
      type: "data_form";
      formId: string;
      href?: never;
      agentId?: never;
    })
  | (HubLayoutWidgetBase & {
      type: "ai_agent";
      agentId: string;
      href?: never;
      formId?: never;
    });

export type HubLayout = Array<{
  id: string;
  category?: string;
  columns: HubLayoutWidget[];
}>;

export const hubs = pgTable(
  "hubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    slug: varchar("slug", { length: 140 }).notNull(),
    description: text("description"),
    status: courseStatusEnum("status").default("published").notNull(),
    layout: jsonb("layout").$type<HubLayout>().default([]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("hubs_org_slug_idx").on(table.organizationId, table.slug),
  ],
);

export const hubAccessGrants = pgTable(
  "hub_access_grants",
  {
    hubId: uuid("hub_id")
      .notNull()
      .references(() => hubs.id, { onDelete: "cascade" }),
    subjectType: varchar("subject_type", { length: 20 }).notNull(),
    subjectId: uuid("subject_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.hubId, table.subjectType, table.subjectId] }),
    index("hub_access_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

export const communityAreas = pgTable(
  "community_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("community_areas_org_slug_idx").on(
      table.organizationId,
      table.slug,
    ),
    uniqueIndex("community_areas_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("community_areas_org_sort_idx").on(
      table.organizationId,
      table.sortOrder,
    ),
    check("community_areas_title_check", sql`btrim(${table.title}) <> ''`),
    check(
      "community_areas_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("community_areas_sort_check", sql`${table.sortOrder} >= 0`),
    check(
      "community_areas_updated_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const communitySpaces = pgTable(
  "community_spaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => communityAreas.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    description: text("description"),
    color: varchar("color", { length: 20 }).default("#2bb7a9").notNull(),
    type: communitySpaceTypeEnum("type").default("feed").notNull(),
    accessMode: communitySpaceAccessModeEnum("access_mode")
      .default("open")
      .notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_spaces_area_tenant_fk",
      columns: [table.areaId, table.organizationId],
      foreignColumns: [communityAreas.id, communityAreas.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("community_spaces_org_slug_idx").on(
      table.organizationId,
      table.slug,
    ),
    uniqueIndex("community_spaces_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("community_spaces_org_area_sort_idx").on(
      table.organizationId,
      table.areaId,
      table.sortOrder,
    ),
    check("community_spaces_title_check", sql`btrim(${table.title}) <> ''`),
    check(
      "community_spaces_slug_check",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`,
    ),
    check("community_spaces_sort_check", sql`${table.sortOrder} >= 0`),
    check(
      "community_spaces_updated_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const communitySpaceAccessRules = pgTable(
  "community_space_access_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull(),
    subjectType: communityAccessSubjectTypeEnum("subject_type").notNull(),
    subjectRole: roleEnum("subject_role"),
    subjectUserId: uuid("subject_user_id"),
    subjectGroupId: uuid("subject_group_id"),
    subjectBundleId: uuid("subject_bundle_id"),
    canView: boolean("can_view").default(false).notNull(),
    canPost: boolean("can_post").default(false).notNull(),
    canComment: boolean("can_comment").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_access_rules_space_tenant_fk",
      columns: [table.spaceId, table.organizationId],
      foreignColumns: [communitySpaces.id, communitySpaces.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_access_rules_user_tenant_fk",
      columns: [table.subjectUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_access_rules_group_tenant_fk",
      columns: [table.subjectGroupId, table.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_access_rules_bundle_tenant_fk",
      columns: [table.subjectBundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("community_access_rules_role_idx")
      .on(table.spaceId, table.subjectRole)
      .where(sql`${table.subjectType} = 'role'`),
    uniqueIndex("community_access_rules_user_idx")
      .on(table.spaceId, table.subjectUserId)
      .where(sql`${table.subjectType} = 'user'`),
    uniqueIndex("community_access_rules_group_idx")
      .on(table.spaceId, table.subjectGroupId)
      .where(sql`${table.subjectType} = 'group'`),
    uniqueIndex("community_access_rules_bundle_idx")
      .on(table.spaceId, table.subjectBundleId)
      .where(sql`${table.subjectType} = 'bundle'`),
    index("community_access_rules_org_space_idx").on(
      table.organizationId,
      table.spaceId,
    ),
    check(
      "community_access_rules_subject_shape_check",
      sql`(
        ${table.subjectType} = 'role' and ${table.subjectRole} is not null and ${table.subjectUserId} is null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'user' and ${table.subjectRole} is null and ${table.subjectUserId} is not null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'group' and ${table.subjectRole} is null and ${table.subjectUserId} is null and ${table.subjectGroupId} is not null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'bundle' and ${table.subjectRole} is null and ${table.subjectUserId} is null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is not null
      )`,
    ),
    check(
      "community_access_rules_permission_check",
      sql`${table.canView} and (${table.canView} or ${table.canPost} or ${table.canComment})`,
    ),
  ],
);

export const communitySpaceModerationPolicies = pgTable(
  "community_space_moderation_policies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id").notNull(),
    postApproval: communityApprovalModeEnum("post_approval")
      .default("off")
      .notNull(),
    commentApproval: communityApprovalModeEnum("comment_approval")
      .default("off")
      .notNull(),
    automationMode: communityAutomationModeEnum("automation_mode")
      .default("off")
      .notNull(),
    reportThreshold: integer("report_threshold"),
    duplicateWindowMinutes: integer("duplicate_window_minutes")
      .default(0)
      .notNull(),
    linkLimit: integer("link_limit").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    updatedById: uuid("updated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_moderation_policies_space_tenant_fk",
      columns: [table.spaceId, table.organizationId],
      foreignColumns: [communitySpaces.id, communitySpaces.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_moderation_policies_updater_tenant_fk",
      columns: [table.updatedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("community_moderation_policies_org_space_idx").on(
      table.organizationId,
      table.spaceId,
    ),
    uniqueIndex("community_moderation_policies_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    check(
      "community_moderation_policies_report_threshold_check",
      sql`${table.reportThreshold} is null or ${table.reportThreshold} between 2 and 20`,
    ),
    check(
      "community_moderation_policies_duplicate_window_check",
      sql`${table.duplicateWindowMinutes} between 0 and 1440`,
    ),
    check(
      "community_moderation_policies_link_limit_check",
      sql`${table.linkLimit} between 0 and 20`,
    ),
    check(
      "community_moderation_policies_version_check",
      sql`${table.version} >= 1`,
    ),
  ],
);

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => communitySpaces.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    linkedCourseId: uuid("linked_course_id"),
    title: varchar("title", { length: 240 }),
    content: text("content").notNull(),
    contentFormat: varchar("content_format", { length: 20 })
      .$type<"plain_text" | "rich_text">()
      .default("plain_text")
      .notNull(),
    richText: jsonb("rich_text").$type<RichTextDocument>(),
    contentProjectionVersion: integer("content_projection_version")
      .default(1)
      .notNull(),
    imageUrl: text("image_url"),
    pinned: boolean("pinned").default(false).notNull(),
    locked: boolean("locked").default(false).notNull(),
    moderationState: communityContentStateEnum("moderation_state")
      .default("published")
      .notNull(),
    moderationVersion: integer("moderation_version").default(1).notNull(),
    moderationFingerprint: varchar("moderation_fingerprint", { length: 64 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedById: uuid("moderated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "posts_space_tenant_fk",
      columns: [table.spaceId, table.organizationId],
      foreignColumns: [communitySpaces.id, communitySpaces.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "posts_author_tenant_fk",
      columns: [table.authorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "posts_linked_course_tenant_fk",
      columns: [table.linkedCourseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "posts_moderator_tenant_fk",
      columns: [table.moderatedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    index("posts_space_created_idx").on(table.spaceId, table.createdAt),
    index("posts_org_created_id_idx").on(
      table.organizationId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("posts_org_author_created_id_idx").on(
      table.organizationId,
      table.authorId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("posts_org_space_created_id_idx").on(
      table.organizationId,
      table.spaceId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("posts_org_linked_course_idx").on(
      table.organizationId,
      table.linkedCourseId,
    ),
    index("posts_org_pinned_created_id_idx")
      .on(table.organizationId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.pinned} = true`),
    uniqueIndex("posts_id_organization_idx").on(table.id, table.organizationId),
    index("posts_org_moderation_queue_idx").on(
      table.organizationId,
      table.moderationState,
      table.createdAt,
      table.id,
    ),
    index("posts_org_space_published_idx")
      .on(
        table.organizationId,
        table.spaceId,
        table.publishedAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.moderationState} = 'published'`),
    check(
      "posts_moderation_version_check",
      sql`${table.moderationVersion} >= 1`,
    ),
    check(
      "posts_moderation_fingerprint_check",
      sql`${table.moderationFingerprint} is null or ${table.moderationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "posts_published_at_check",
      sql`${table.moderationState} <> 'published' or ${table.publishedAt} is not null`,
    ),
    check(
      "posts_content_length_check",
      sql`char_length(${table.content}) between 1 and 10000`,
    ),
    check(
      "posts_content_document_shape_check",
      sql`(
        ${table.contentFormat} = 'plain_text'
        and ${table.richText} is null
        and ${table.contentProjectionVersion} = 1
      ) or (
        ${table.contentFormat} = 'rich_text'
        and btrim(${table.content}) <> ''
        and ${table.richText} is not null
        and jsonb_typeof(${table.richText}) = 'object'
        and ${table.richText} ->> 'version' = '1'
        and jsonb_typeof(${table.richText} -> 'blocks') = 'array'
        and char_length(${table.richText}::text) <= 100000
        and ${table.contentProjectionVersion} = 1
      )`,
    ),
  ],
);

export const postLikes = pgTable(
  "post_likes",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    reaction: communityReactionTypeEnum("reaction").default("like").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
    foreignKey({
      name: "post_likes_post_tenant_fk",
      columns: [table.postId, table.organizationId],
      foreignColumns: [posts.id, posts.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "post_likes_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("post_likes_source_tenant_idx").on(
      table.postId,
      table.userId,
      table.organizationId,
    ),
    index("post_likes_org_post_idx").on(table.organizationId, table.postId),
    index("post_likes_org_post_created_user_idx").on(
      table.organizationId,
      table.postId,
      table.createdAt,
      table.userId,
    ),
    index("post_likes_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const postVotes = pgTable(
  "post_votes",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.userId] }),
    foreignKey({
      name: "post_votes_post_tenant_fk",
      columns: [table.postId, table.organizationId],
      foreignColumns: [posts.id, posts.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "post_votes_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    index("post_votes_org_post_idx").on(table.organizationId, table.postId),
    index("post_votes_org_post_created_user_idx").on(
      table.organizationId,
      table.postId,
      table.createdAt,
      table.userId,
    ),
    index("post_votes_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check("post_votes_value_check", sql`${table.value} in (-1, 1)`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    authorId: uuid("author_id").notNull(),
    parentId: uuid("parent_id"),
    content: text("content").notNull(),
    contentFormat: varchar("content_format", { length: 20 })
      .$type<"plain_text" | "rich_text">()
      .default("plain_text")
      .notNull(),
    richText: jsonb("rich_text").$type<RichTextDocument>(),
    contentProjectionVersion: integer("content_projection_version")
      .default(1)
      .notNull(),
    moderationState: communityContentStateEnum("moderation_state")
      .default("published")
      .notNull(),
    moderationVersion: integer("moderation_version").default(1).notNull(),
    moderationFingerprint: varchar("moderation_fingerprint", { length: 64 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow(),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    moderatedById: uuid("moderated_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "comments_post_tenant_fk",
      columns: [table.postId, table.organizationId],
      foreignColumns: [posts.id, posts.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "comments_author_tenant_fk",
      columns: [table.authorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "comments_moderator_tenant_fk",
      columns: [table.moderatedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "comments_parent_post_tenant_fk",
      columns: [table.parentId, table.postId, table.organizationId],
      foreignColumns: [table.id, table.postId, table.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("comments_id_post_organization_idx").on(
      table.id,
      table.postId,
      table.organizationId,
    ),
    uniqueIndex("comments_id_author_organization_idx").on(
      table.id,
      table.authorId,
      table.organizationId,
    ),
    index("comments_post_created_idx").on(table.postId, table.createdAt),
    index("comments_parent_created_idx").on(table.parentId, table.createdAt),
    index("comments_org_post_parent_created_idx").on(
      table.organizationId,
      table.postId,
      table.parentId,
      table.createdAt,
      table.id,
    ),
    index("comments_org_post_created_author_idx").on(
      table.organizationId,
      table.postId,
      table.createdAt,
      table.authorId,
    ),
    index("comments_org_created_idx").on(table.organizationId, table.createdAt),
    check(
      "comments_parent_self_check",
      sql`${table.parentId} is null or ${table.parentId} <> ${table.id}`,
    ),
    index("comments_org_moderation_queue_idx").on(
      table.organizationId,
      table.moderationState,
      table.createdAt,
      table.id,
    ),
    index("comments_org_post_published_idx")
      .on(table.organizationId, table.postId, table.publishedAt, table.id)
      .where(sql`${table.moderationState} = 'published'`),
    check(
      "comments_moderation_version_check",
      sql`${table.moderationVersion} >= 1`,
    ),
    check(
      "comments_moderation_fingerprint_check",
      sql`${table.moderationFingerprint} is null or ${table.moderationFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "comments_published_at_check",
      sql`${table.moderationState} <> 'published' or ${table.publishedAt} is not null`,
    ),
    check(
      "comments_content_length_check",
      sql`char_length(${table.content}) between 1 and 5000`,
    ),
    check(
      "comments_content_document_shape_check",
      sql`(
        ${table.contentFormat} = 'plain_text'
        and ${table.richText} is null
        and ${table.contentProjectionVersion} = 1
      ) or (
        ${table.contentFormat} = 'rich_text'
        and btrim(${table.content}) <> ''
        and ${table.richText} is not null
        and jsonb_typeof(${table.richText}) = 'object'
        and ${table.richText} ->> 'version' = '1'
        and jsonb_typeof(${table.richText} -> 'blocks') = 'array'
        and char_length(${table.richText}::text) <= 100000
        and ${table.contentProjectionVersion} = 1
      )`,
    ),
  ],
);

export const commentReactions = pgTable(
  "comment_reactions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull(),
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    reaction: communityReactionTypeEnum("reaction").default("like").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commentId, table.userId] }),
    foreignKey({
      name: "comment_reactions_comment_tenant_fk",
      columns: [table.commentId, table.postId, table.organizationId],
      foreignColumns: [comments.id, comments.postId, comments.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "comment_reactions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("comment_reactions_source_tenant_idx").on(
      table.commentId,
      table.userId,
      table.organizationId,
    ),
    index("comment_reactions_org_comment_idx").on(
      table.organizationId,
      table.commentId,
    ),
    index("comment_reactions_org_post_idx").on(
      table.organizationId,
      table.postId,
    ),
    index("comment_reactions_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const communityScoreContributions = pgTable(
  "community_score_contributions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id").notNull(),
    actorId: uuid("actor_id").notNull(),
    kind: communityScoreContributionKindEnum("kind").notNull(),
    postId: uuid("post_id"),
    commentId: uuid("comment_id"),
    reactionCommentId: uuid("reaction_comment_id"),
    points: integer("points").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_score_contributions_recipient_tenant_fk",
      columns: [table.recipientId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_score_contributions_actor_tenant_fk",
      columns: [table.actorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_score_contributions_post_reaction_source_fk",
      columns: [table.postId, table.actorId, table.organizationId],
      foreignColumns: [
        postLikes.postId,
        postLikes.userId,
        postLikes.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_score_contributions_comment_source_fk",
      columns: [table.commentId, table.actorId, table.organizationId],
      foreignColumns: [comments.id, comments.authorId, comments.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_score_contributions_comment_reaction_source_fk",
      columns: [table.reactionCommentId, table.actorId, table.organizationId],
      foreignColumns: [
        commentReactions.commentId,
        commentReactions.userId,
        commentReactions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("community_score_contributions_post_reaction_uidx")
      .on(table.organizationId, table.postId, table.actorId)
      .where(sql`${table.kind} = 'post_reaction'`),
    uniqueIndex("community_score_contributions_post_comment_uidx")
      .on(table.organizationId, table.commentId)
      .where(sql`${table.kind} = 'post_comment'`),
    uniqueIndex("community_score_contributions_comment_reply_uidx")
      .on(table.organizationId, table.commentId)
      .where(sql`${table.kind} = 'comment_reply'`),
    uniqueIndex("community_score_contributions_comment_reaction_uidx")
      .on(table.organizationId, table.reactionCommentId, table.actorId)
      .where(sql`${table.kind} = 'comment_reaction'`),
    index("community_score_contributions_org_recipient_created_idx").on(
      table.organizationId,
      table.recipientId,
      table.createdAt,
    ),
    index("community_score_contributions_org_actor_created_idx").on(
      table.organizationId,
      table.actorId,
      table.createdAt,
    ),
    check(
      "community_score_contributions_not_self_check",
      sql`${table.recipientId} <> ${table.actorId}`,
    ),
    check(
      "community_score_contributions_shape_check",
      sql`(
        ${table.kind} = 'post_reaction'
        and ${table.points} = 1
        and ${table.postId} is not null
        and ${table.commentId} is null
        and ${table.reactionCommentId} is null
      ) or (
        ${table.kind} = 'post_comment'
        and ${table.points} = 2
        and ${table.postId} is null
        and ${table.commentId} is not null
        and ${table.reactionCommentId} is null
      ) or (
        ${table.kind} = 'comment_reply'
        and ${table.points} = 1
        and ${table.postId} is null
        and ${table.commentId} is not null
        and ${table.reactionCommentId} is null
      ) or (
        ${table.kind} = 'comment_reaction'
        and ${table.points} = 1
        and ${table.postId} is null
        and ${table.commentId} is null
        and ${table.reactionCommentId} is not null
      )`,
    ),
  ],
);

export const communityAssetBindings = pgTable(
  "community_asset_bindings",
  {
    mediaAssetId: uuid("media_asset_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_asset_bindings_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }),
    uniqueIndex("community_asset_bindings_asset_org_idx").on(
      table.mediaAssetId,
      table.organizationId,
    ),
    index("community_asset_bindings_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const communityPostAttachments = pgTable(
  "community_post_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_post_attachments_post_tenant_fk",
      columns: [table.postId, table.organizationId],
      foreignColumns: [posts.id, posts.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_post_attachments_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }),
    foreignKey({
      name: "community_post_attachments_registry_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [
        communityAssetBindings.mediaAssetId,
        communityAssetBindings.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("community_post_attachments_asset_idx").on(table.mediaAssetId),
    uniqueIndex("community_post_attachments_post_order_idx").on(
      table.postId,
      table.sortOrder,
    ),
    index("community_post_attachments_org_post_idx").on(
      table.organizationId,
      table.postId,
      table.sortOrder,
    ),
    check(
      "community_post_attachments_sort_order_check",
      sql`${table.sortOrder} >= 0 and ${table.sortOrder} < 6`,
    ),
  ],
);

export const communityCommentAttachments = pgTable(
  "community_comment_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull(),
    postId: uuid("post_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_comment_attachments_comment_tenant_fk",
      columns: [table.commentId, table.postId, table.organizationId],
      foreignColumns: [comments.id, comments.postId, comments.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_comment_attachments_asset_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }),
    foreignKey({
      name: "community_comment_attachments_registry_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [
        communityAssetBindings.mediaAssetId,
        communityAssetBindings.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("community_comment_attachments_asset_idx").on(
      table.mediaAssetId,
    ),
    uniqueIndex("community_comment_attachments_comment_order_idx").on(
      table.commentId,
      table.sortOrder,
    ),
    index("community_comment_attachments_org_comment_idx").on(
      table.organizationId,
      table.commentId,
      table.sortOrder,
    ),
    check(
      "community_comment_attachments_sort_order_check",
      sql`${table.sortOrder} >= 0 and ${table.sortOrder} < 3`,
    ),
  ],
);

export const communityMentions = pgTable(
  "community_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull(),
    commentId: uuid("comment_id"),
    mentionedUserId: uuid("mentioned_user_id").notNull(),
    mentionedById: uuid("mentioned_by_id").notNull(),
    handle: varchar("handle", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_mentions_post_tenant_fk",
      columns: [table.postId, table.organizationId],
      foreignColumns: [posts.id, posts.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_mentions_comment_post_tenant_fk",
      columns: [table.commentId, table.postId, table.organizationId],
      foreignColumns: [comments.id, comments.postId, comments.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_mentions_mentioned_user_tenant_fk",
      columns: [table.mentionedUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_mentions_mentioner_tenant_fk",
      columns: [table.mentionedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("community_mentions_post_user_idx")
      .on(table.organizationId, table.postId, table.mentionedUserId)
      .where(sql`${table.commentId} is null`),
    uniqueIndex("community_mentions_comment_user_idx")
      .on(table.organizationId, table.commentId, table.mentionedUserId)
      .where(sql`${table.commentId} is not null`),
    index("community_mentions_org_user_created_idx").on(
      table.organizationId,
      table.mentionedUserId,
      table.createdAt,
    ),
    check(
      "community_mentions_not_self_check",
      sql`${table.mentionedUserId} <> ${table.mentionedById}`,
    ),
  ],
);

export const communityModerationCases = pgTable(
  "community_moderation_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    targetType: communityReportTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetAuthorId: uuid("target_author_id"),
    contentVersion: integer("content_version").default(1).notNull(),
    policyVersion: integer("policy_version").default(1).notNull(),
    reason: communityModerationReasonCodeEnum("reason").notNull(),
    priority: integer("priority").default(0).notNull(),
    status: communityModerationCaseStatusEnum("status")
      .default("open")
      .notNull(),
    claimedById: uuid("claimed_by_id"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    decisionVersion: integer("decision_version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_moderation_cases_author_tenant_fk",
      columns: [table.targetAuthorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_moderation_cases_claimant_tenant_fk",
      columns: [table.claimedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_moderation_cases_resolver_tenant_fk",
      columns: [table.resolvedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("community_moderation_cases_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("community_moderation_cases_active_target_idx")
      .on(table.organizationId, table.targetType, table.targetId)
      .where(sql`${table.status} in ('open', 'reviewing', 'appealed')`),
    index("community_moderation_cases_queue_idx").on(
      table.organizationId,
      table.status,
      table.priority.desc(),
      table.createdAt,
      table.id,
    ),
    index("community_moderation_cases_target_history_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
      table.createdAt.desc(),
    ),
    check(
      "community_moderation_cases_versions_check",
      sql`${table.contentVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.decisionVersion} >= 1`,
    ),
    check(
      "community_moderation_cases_priority_check",
      sql`${table.priority} between 0 and 100`,
    ),
    check(
      "community_moderation_cases_resolution_check",
      sql`(${table.status} in ('open', 'reviewing') and ${table.resolvedAt} is null) or (${table.status} in ('resolved', 'appealed') and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const communityReports = pgTable(
  "community_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id"),
    reporterId: uuid("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetType: communityReportTargetTypeEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetAuthorId: uuid("target_author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contentExcerpt: varchar("content_excerpt", { length: 500 }).notNull(),
    reason: communityReportReasonEnum("reason").notNull(),
    details: varchar("details", { length: 1000 }),
    status: communityReportStatusEnum("status").default("open").notNull(),
    handledById: uuid("handled_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    outcome: communityReportOutcomeEnum("outcome"),
    resolutionNote: varchar("resolution_note", { length: 1000 }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_reports_case_tenant_fk",
      columns: [table.caseId, table.organizationId],
      foreignColumns: [
        communityModerationCases.id,
        communityModerationCases.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_reports_reporter_tenant_fk",
      columns: [table.reporterId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "community_reports_target_author_tenant_fk",
      columns: [table.targetAuthorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "community_reports_handler_tenant_fk",
      columns: [table.handledById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("community_reports_case_reporter_idx")
      .on(table.organizationId, table.caseId, table.reporterId)
      .where(
        sql`${table.caseId} is not null and ${table.reporterId} is not null`,
      ),
    uniqueIndex("community_reports_legacy_reporter_target_idx")
      .on(
        table.organizationId,
        table.reporterId,
        table.targetType,
        table.targetId,
      )
      .where(sql`${table.caseId} is null and ${table.reporterId} is not null`),
    index("community_reports_org_status_created_idx").on(
      table.organizationId,
      table.status,
      table.createdAt,
    ),
    index("community_reports_org_target_idx").on(
      table.organizationId,
      table.targetType,
      table.targetId,
    ),
    index("community_reports_org_case_created_idx").on(
      table.organizationId,
      table.caseId,
      table.createdAt,
    ),
    check(
      "community_reports_resolution_state_check",
      sql`((${table.status} in ('open', 'reviewing')) and ${table.resolvedAt} is null and ${table.outcome} is null) or (${table.status} = 'dismissed' and ${table.resolvedAt} is not null and ${table.outcome} = 'dismissed') or (${table.status} = 'resolved' and ${table.resolvedAt} is not null and ${table.outcome} in ('content_removed', 'content_missing'))`,
    ),
  ],
);

export const communityModerationEvents = pgTable(
  "community_moderation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull(),
    action: communityModerationDecisionActionEnum("action").notNull(),
    actorId: uuid("actor_id"),
    reasonCode: communityModerationReasonCodeEnum("reason_code").notNull(),
    contentVersion: integer("content_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    decisionVersion: integer("decision_version").notNull(),
    note: varchar("note", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_moderation_events_case_tenant_fk",
      columns: [table.caseId, table.organizationId],
      foreignColumns: [
        communityModerationCases.id,
        communityModerationCases.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_moderation_events_actor_tenant_fk",
      columns: [table.actorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("community_moderation_events_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("community_moderation_events_case_timeline_idx").on(
      table.organizationId,
      table.caseId,
      table.createdAt,
      table.id,
    ),
    index("community_moderation_events_action_created_idx").on(
      table.organizationId,
      table.action,
      table.createdAt,
    ),
    check(
      "community_moderation_events_versions_check",
      sql`${table.contentVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.decisionVersion} >= 1`,
    ),
  ],
);

export const communityModerationAssessments = pgTable(
  "community_moderation_assessments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull(),
    revision: integer("revision").notNull(),
    policyVersion: integer("policy_version").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    signals: jsonb("signals")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    outcome: communityContentStateEnum("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_moderation_assessments_case_tenant_fk",
      columns: [table.caseId, table.organizationId],
      foreignColumns: [
        communityModerationCases.id,
        communityModerationCases.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("community_moderation_assessments_case_revision_idx").on(
      table.organizationId,
      table.caseId,
      table.revision,
    ),
    index("community_moderation_assessments_case_history_idx").on(
      table.organizationId,
      table.caseId,
      table.revision.desc(),
    ),
    index("community_moderation_assessments_outcome_created_idx").on(
      table.organizationId,
      table.outcome,
      table.createdAt,
    ),
    check(
      "community_moderation_assessments_revision_check",
      sql`${table.revision} >= 1 and ${table.policyVersion} >= 1`,
    ),
    check(
      "community_moderation_assessments_fingerprint_check",
      sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "community_moderation_assessments_signals_check",
      sql`jsonb_typeof(${table.signals}) = 'object' and octet_length(${table.signals}::text) <= 16384`,
    ),
  ],
);

export const communityModerationAppeals = pgTable(
  "community_moderation_appeals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    caseId: uuid("case_id").notNull(),
    appellantId: uuid("appellant_id").notNull(),
    statement: varchar("statement", { length: 2000 }).notNull(),
    decisionVersion: integer("decision_version").notNull(),
    resolutionAction:
      communityModerationDecisionActionEnum("resolution_action"),
    resolvedById: uuid("resolved_by_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: varchar("resolution_note", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_moderation_appeals_case_tenant_fk",
      columns: [table.caseId, table.organizationId],
      foreignColumns: [
        communityModerationCases.id,
        communityModerationCases.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_moderation_appeals_appellant_tenant_fk",
      columns: [table.appellantId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "community_moderation_appeals_resolver_tenant_fk",
      columns: [table.resolvedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("community_moderation_appeals_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("community_moderation_appeals_active_case_idx")
      .on(table.organizationId, table.caseId)
      .where(sql`${table.resolutionAction} is null`),
    index("community_moderation_appeals_case_created_idx").on(
      table.organizationId,
      table.caseId,
      table.createdAt,
    ),
    index("community_moderation_appeals_resolution_queue_idx").on(
      table.organizationId,
      table.resolvedAt,
      table.createdAt,
    ),
    check(
      "community_moderation_appeals_statement_check",
      sql`length(btrim(${table.statement})) between 3 and 2000`,
    ),
    check(
      "community_moderation_appeals_decision_version_check",
      sql`${table.decisionVersion} >= 1`,
    ),
    check(
      "community_moderation_appeals_resolution_check",
      sql`(${table.resolutionAction} is null and ${table.resolvedById} is null and ${table.resolvedAt} is null and ${table.resolutionNote} is null) or (${table.resolutionAction} in ('appeal_upheld', 'appeal_overturned') and ${table.resolvedById} is not null and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const communityFollows = pgTable(
  "community_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: communityFollowTargetTypeEnum("target_type").notNull(),
    targetAuthorId: uuid("target_author_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    targetSpaceId: uuid("target_space_id").references(
      () => communitySpaces.id,
      { onDelete: "cascade" },
    ),
    notify: boolean("notify").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_follows_follower_tenant_fk",
      columns: [table.followerId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_follows_author_tenant_fk",
      columns: [table.targetAuthorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_follows_space_tenant_fk",
      columns: [table.targetSpaceId, table.organizationId],
      foreignColumns: [communitySpaces.id, communitySpaces.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("community_follows_author_unique_idx")
      .on(table.organizationId, table.followerId, table.targetAuthorId)
      .where(sql`${table.targetType} = 'author'`),
    uniqueIndex("community_follows_space_unique_idx")
      .on(table.organizationId, table.followerId, table.targetSpaceId)
      .where(sql`${table.targetType} = 'space'`),
    index("community_follows_follower_created_idx").on(
      table.organizationId,
      table.followerId,
      table.createdAt,
    ),
    index("community_follows_author_idx").on(
      table.organizationId,
      table.targetAuthorId,
    ),
    index("community_follows_space_idx").on(
      table.organizationId,
      table.targetSpaceId,
    ),
    check(
      "community_follows_target_shape_check",
      sql`(${table.targetType} = 'author' and ${table.targetAuthorId} is not null and ${table.targetSpaceId} is null) or (${table.targetType} = 'space' and ${table.targetAuthorId} is null and ${table.targetSpaceId} is not null)`,
    ),
    check(
      "community_follows_not_self_check",
      sql`${table.targetAuthorId} is null or ${table.targetAuthorId} <> ${table.followerId}`,
    ),
  ],
);

export const communityAuthorBoosts = pgTable(
  "community_author_boosts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    strength: communityAuthorBoostStrengthEnum("strength").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: varchar("reason", { length: 500 }).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_author_boosts_author_tenant_fk",
      columns: [table.authorId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "community_author_boosts_creator_tenant_fk",
      columns: [table.createdById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("community_author_boosts_author_unique_idx").on(
      table.organizationId,
      table.authorId,
    ),
    index("community_author_boosts_active_idx").on(
      table.organizationId,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "community_author_boosts_window_check",
      sql`${table.startsAt} < ${table.endsAt} and ${table.endsAt} <= ${table.startsAt} + interval '90 days'`,
    ),
    check(
      "community_author_boosts_reason_check",
      sql`length(btrim(${table.reason})) between 3 and 500`,
    ),
  ],
);

export const communityFeedRevisions = pgTable(
  "community_feed_revisions",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revision: bigint("revision", { mode: "number" }).default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "community_feed_revisions_nonnegative_check",
      sql`${table.revision} >= 0`,
    ),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 220 }).notNull(),
    description: text("description"),
    type: eventTypeEnum("type").default("live_call").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("Europe/Berlin")
      .notNull(),
    meetingUrl: text("meeting_url"),
    location: varchar("location", { length: 200 }),
    color: varchar("color", { length: 20 }).default("#ee6c5d").notNull(),
    capacity: integer("capacity"),
    audienceMode: eventAudienceModeEnum("audience_mode")
      .default("tenant")
      .notNull(),
    status: eventStatusEnum("status").default("scheduled").notNull(),
    lifecycleRevision: integer("lifecycle_revision").default(0).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("events_org_start_idx").on(table.organizationId, table.startsAt),
    uniqueIndex("events_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    check("events_window_check", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "events_timezone_check",
      sql`${table.timezone} = 'UTC' or ${table.timezone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9._+-]+)+$'`,
    ),
    check(
      "events_lifecycle_revision_nonnegative_check",
      sql`${table.lifecycleRevision} >= 0`,
    ),
  ],
);

export const eventLifecycleHistory = pgTable(
  "event_lifecycle_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    actorReference: varchar("actor_reference", { length: 96 }).notNull(),
    action: eventLifecycleActionEnum("action").notNull(),
    fromStatus: eventStatusEnum("from_status"),
    toStatus: eventStatusEnum("to_status").notNull(),
    previousStartsAt: timestamp("previous_starts_at", { withTimezone: true }),
    previousEndsAt: timestamp("previous_ends_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .default("Europe/Berlin")
      .notNull(),
    reason: varchar("reason", { length: 500 }),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "event_lifecycle_history_event_tenant_fk",
      columns: [table.eventId, table.organizationId],
      foreignColumns: [events.id, events.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("event_lifecycle_history_event_revision_idx").on(
      table.eventId,
      table.revision,
    ),
    index("event_lifecycle_history_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "event_lifecycle_history_revision_nonnegative_check",
      sql`${table.revision} >= 0`,
    ),
    check(
      "event_lifecycle_history_actor_reference_check",
      sql`${table.actorReference} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "event_lifecycle_history_window_check",
      sql`${table.endsAt} > ${table.startsAt} and (${table.previousStartsAt} is null or ${table.previousEndsAt} > ${table.previousStartsAt})`,
    ),
    check(
      "event_lifecycle_history_timezone_check",
      sql`${table.timezone} = 'UTC' or ${table.timezone} ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9._+-]+)+$'`,
    ),
    check(
      "event_lifecycle_history_shape_check",
      sql`(${table.action} = 'created' and ${table.revision} = 0 and ${table.fromStatus} is null and ${table.previousStartsAt} is null and ${table.previousEndsAt} is null and ${table.reason} is null) or (${table.action} <> 'created' and ${table.revision} > 0 and ${table.fromStatus} is not null and ${table.previousStartsAt} is not null and ${table.previousEndsAt} is not null and length(btrim(${table.reason})) between 3 and 500)`,
    ),
  ],
);

export const eventCalendarSettings = pgTable(
  "event_calendar_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    backgroundColor: varchar("background_color", { length: 7 })
      .default("#f7f9fb")
      .notNull(),
    surfaceColor: varchar("surface_color", { length: 7 })
      .default("#ffffff")
      .notNull(),
    borderColor: varchar("border_color", { length: 7 })
      .default("#dfe4e8")
      .notNull(),
    headingColor: varchar("heading_color", { length: 7 })
      .default("#243444")
      .notNull(),
    bodyColor: varchar("body_color", { length: 7 })
      .default("#66727f")
      .notNull(),
    accentColor: varchar("accent_color", { length: 7 })
      .default("#167e74")
      .notNull(),
    liveColor: varchar("live_color", { length: 7 })
      .default("#b84e42")
      .notNull(),
    cancelledColor: varchar("cancelled_color", { length: 7 })
      .default("#8c3f35")
      .notNull(),
    density: varchar("density", { length: 16 })
      .default("comfortable")
      .$type<"compact" | "comfortable">()
      .notNull(),
    cardRadius: integer("card_radius").default(6).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "event_calendar_settings_colors_check",
      sql`${table.backgroundColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.surfaceColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.borderColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.headingColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.bodyColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.accentColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.liveColor} ~ '^#[0-9a-fA-F]{6}$' and ${table.cancelledColor} ~ '^#[0-9a-fA-F]{6}$'`,
    ),
    check(
      "event_calendar_settings_density_check",
      sql`${table.density} in ('compact', 'comfortable')`,
    ),
    check(
      "event_calendar_settings_radius_check",
      sql`${table.cardRadius} between 0 and 8`,
    ),
  ],
);

export const eventAudienceGrants = pgTable(
  "event_audience_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    bundleId: uuid("bundle_id").references(() => bundles.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("event_audience_grants_org_event_idx").on(
      table.organizationId,
      table.eventId,
    ),
    uniqueIndex("event_audience_grants_event_user_idx").on(
      table.eventId,
      table.userId,
    ),
    uniqueIndex("event_audience_grants_event_group_idx").on(
      table.eventId,
      table.groupId,
    ),
    uniqueIndex("event_audience_grants_event_bundle_idx").on(
      table.eventId,
      table.bundleId,
    ),
    check(
      "event_audience_grants_single_target_check",
      sql`num_nonnulls(${table.userId}, ${table.groupId}, ${table.bundleId}) = 1`,
    ),
  ],
);

export const eventAttendees = pgTable(
  "event_attendees",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum("status").default("going").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body").notNull(),
    type: varchar("type", { length: 50 }).default("info").notNull(),
    category: notificationCategoryEnum("category").default("system").notNull(),
    href: text("href"),
    read: boolean("read").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notifications_id_user_idx").on(table.id, table.userId),
    index("notifications_user_read_idx").on(table.userId, table.read),
  ],
);

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    category: notificationCategoryEnum("category").notNull(),
    emailEnabled: boolean("email_enabled").default(true).notNull(),
    pushEnabled: boolean("push_enabled").default(true).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      name: "user_notification_preferences_pk",
      columns: [table.organizationId, table.userId, table.category],
    }),
    foreignKey({
      name: "user_notification_preferences_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    index("user_notification_preferences_user_idx").on(
      table.userId,
      table.organizationId,
    ),
    check(
      "user_notification_preferences_configurable_category_check",
      sql`${table.category} <> 'system'`,
    ),
  ],
);

export const webPushSubscriptions = pgTable(
  "web_push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    subscriptionEncrypted: jsonb("subscription_encrypted")
      .$type<EncryptedPayload>()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "web_push_subscriptions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "web_push_subscriptions_session_user_tenant_fk",
      columns: [table.sessionId, table.userId, table.organizationId],
      foreignColumns: [
        userSessions.id,
        userSessions.userId,
        userSessions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("web_push_subscriptions_endpoint_hash_idx").on(
      table.endpointHash,
    ),
    uniqueIndex("web_push_subscriptions_id_user_org_idx").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    index("web_push_subscriptions_org_user_idx").on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
    check(
      "web_push_subscriptions_endpoint_hash_check",
      sql`${table.endpointHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "web_push_subscriptions_encrypted_check",
      sql`jsonb_typeof(${table.subscriptionEncrypted}) = 'object' and ${table.subscriptionEncrypted} ->> 'v' = '2' and ${table.subscriptionEncrypted} ->> 'alg' = 'A256GCM' and btrim(coalesce(${table.subscriptionEncrypted} ->> 'kid', '')) <> '' and btrim(coalesce(${table.subscriptionEncrypted} ->> 'iv', '')) <> '' and btrim(coalesce(${table.subscriptionEncrypted} ->> 'tag', '')) <> '' and btrim(coalesce(${table.subscriptionEncrypted} ->> 'ciphertext', '')) <> ''`,
    ),
    check(
      "web_push_subscriptions_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const nativePushDevices = pgTable(
  "native_push_devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    platform: nativePushPlatformEnum("platform").notNull(),
    appId: varchar("app_id", { length: 180 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    tokenEncrypted: jsonb("token_encrypted")
      .$type<EncryptedPayload>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "native_push_devices_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "native_push_devices_session_user_tenant_fk",
      columns: [table.sessionId, table.userId, table.organizationId],
      foreignColumns: [
        userSessions.id,
        userSessions.userId,
        userSessions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("native_push_devices_token_hash_idx").on(table.tokenHash),
    uniqueIndex("native_push_devices_id_user_org_idx").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    index("native_push_devices_org_user_updated_idx").on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
    check(
      "native_push_devices_app_id_check",
      sql`length(btrim(${table.appId})) between 3 and 180`,
    ),
    check(
      "native_push_devices_token_hash_check",
      sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "native_push_devices_encrypted_check",
      sql`jsonb_typeof(${table.tokenEncrypted}) = 'object' and ${table.tokenEncrypted} ->> 'v' = '2' and ${table.tokenEncrypted} ->> 'alg' = 'A256GCM' and btrim(coalesce(${table.tokenEncrypted} ->> 'kid', '')) <> '' and btrim(coalesce(${table.tokenEncrypted} ->> 'iv', '')) <> '' and btrim(coalesce(${table.tokenEncrypted} ->> 'tag', '')) <> '' and btrim(coalesce(${table.tokenEncrypted} ->> 'ciphertext', '')) <> ''`,
    ),
    check(
      "native_push_devices_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const nativePushDeliveries = pgTable(
  "native_push_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    notificationId: uuid("notification_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    status: pushDeliveryStatusEnum("status").default("pending").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "native_push_deliveries_notification_user_fk",
      columns: [table.notificationId, table.userId],
      foreignColumns: [notifications.id, notifications.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "native_push_deliveries_device_tenant_fk",
      columns: [table.deviceId, table.userId, table.organizationId],
      foreignColumns: [
        nativePushDevices.id,
        nativePushDevices.userId,
        nativePushDevices.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("native_push_deliveries_notification_device_idx").on(
      table.notificationId,
      table.deviceId,
    ),
    index("native_push_deliveries_status_retry_idx").on(
      table.status,
      table.nextRetryAt,
    ),
    index("native_push_deliveries_processing_claim_idx").on(
      table.status,
      table.claimedAt,
    ),
    index("native_push_deliveries_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "native_push_deliveries_attempt_check",
      sql`${table.attempt} between 0 and 8`,
    ),
    check(
      "native_push_deliveries_response_status_check",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "native_push_deliveries_response_body_check",
      sql`${table.responseBody} is null or char_length(${table.responseBody}) <= 500`,
    ),
    check(
      "native_push_deliveries_state_check",
      sql`(${table.status} = 'pending' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'retrying' and ${table.claimedAt} is null and ${table.nextRetryAt} is not null and ${table.deliveredAt} is null) or (${table.status} = 'failed' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'delivered' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is not null)`,
    ),
  ],
);

export const pushNotificationDeliveries = pgTable(
  "push_notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    notificationId: uuid("notification_id").notNull(),
    subscriptionId: uuid("subscription_id").notNull(),
    status: pushDeliveryStatusEnum("status").default("pending").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "push_notification_deliveries_notification_user_fk",
      columns: [table.notificationId, table.userId],
      foreignColumns: [notifications.id, notifications.userId],
    }).onDelete("cascade"),
    foreignKey({
      name: "push_notification_deliveries_subscription_tenant_fk",
      columns: [table.subscriptionId, table.userId, table.organizationId],
      foreignColumns: [
        webPushSubscriptions.id,
        webPushSubscriptions.userId,
        webPushSubscriptions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("push_notification_deliveries_notification_subscription_idx").on(
      table.notificationId,
      table.subscriptionId,
    ),
    index("push_notification_deliveries_status_retry_idx").on(
      table.status,
      table.nextRetryAt,
    ),
    index("push_notification_deliveries_processing_claim_idx").on(
      table.status,
      table.claimedAt,
    ),
    index("push_notification_deliveries_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "push_notification_deliveries_attempt_check",
      sql`${table.attempt} between 0 and 8`,
    ),
    check(
      "push_notification_deliveries_response_status_check",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "push_notification_deliveries_response_body_check",
      sql`${table.responseBody} is null or char_length(${table.responseBody}) <= 500`,
    ),
    check(
      "push_notification_deliveries_state_check",
      sql`(${table.status} = 'pending' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'retrying' and ${table.claimedAt} is null and ${table.nextRetryAt} is not null and ${table.deliveredAt} is null) or (${table.status} = 'failed' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is null) or (${table.status} = 'delivered' and ${table.claimedAt} is null and ${table.nextRetryAt} is null and ${table.deliveredAt} is not null)`,
    ),
    check(
      "push_notification_deliveries_timestamps_check",
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.deliveredAt} is null or ${table.deliveredAt} >= ${table.createdAt})`,
    ),
  ],
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    body: text("body").notNull(),
    tone: varchar("tone", { length: 20 }).default("info").notNull(),
    placement: varchar("placement", { length: 20 }).default("banner").notNull(),
    audience: varchar("audience", { length: 20 }).default("all").notNull(),
    audienceId: uuid("audience_id"),
    targetRuleSet: jsonb("target_rule_set")
      .$type<AnnouncementTargetRuleSet>()
      .default({ version: 1, conjunction: "and", conditions: [] })
      .notNull(),
    contentDocument: jsonb("content_document")
      .$type<AnnouncementContentDocument>()
      .default({ version: 1, blocks: [] })
      .notNull(),
    href: text("href"),
    actionLabel: varchar("action_label", { length: 80 }),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    dismissible: boolean("dismissible").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("announcements_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("announcements_org_active_schedule_idx").on(
      table.organizationId,
      table.active,
      table.startsAt,
      table.endsAt,
    ),
    index("announcements_org_audience_idx").on(
      table.organizationId,
      table.audience,
      table.audienceId,
    ),
    check(
      "announcements_tone_check",
      sql`${table.tone} in ('info', 'success', 'warning', 'critical')`,
    ),
    check(
      "announcements_placement_check",
      sql`${table.placement} in ('banner', 'modal')`,
    ),
    check(
      "announcements_audience_check",
      sql`(${table.audience} = 'all' and ${table.audienceId} is null) or (${table.audience} in ('user', 'group') and ${table.audienceId} is not null)`,
    ),
    check(
      "announcements_schedule_check",
      sql`${table.endsAt} is null or ${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "announcements_target_rule_set_check",
      sql`case when jsonb_typeof(${table.targetRuleSet}) = 'object' and jsonb_typeof(${table.targetRuleSet} -> 'conditions') = 'array' then ${table.targetRuleSet} -> 'version' = '1'::jsonb and ${table.targetRuleSet} ->> 'conjunction' = 'and' and jsonb_array_length(${table.targetRuleSet} -> 'conditions') <= 20 else false end`,
    ),
    check(
      "announcements_content_document_check",
      sql`case when jsonb_typeof(${table.contentDocument}) = 'object' and jsonb_typeof(${table.contentDocument} -> 'blocks') = 'array' then ${table.contentDocument} -> 'version' = '1'::jsonb and jsonb_array_length(${table.contentDocument} -> 'blocks') <= 16 and octet_length(${table.contentDocument}::text) <= 30000 else false end`,
    ),
  ],
);

export const announcementDismissals = pgTable(
  "announcement_dismissals",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.announcementId, table.userId] }),
    index("announcement_dismissals_user_idx").on(
      table.userId,
      table.dismissedAt,
    ),
  ],
);

export const announcementInteractions = pgTable(
  "announcement_interactions",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    announcementId: uuid("announcement_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: varchar("kind", { length: 20 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.announcementId, table.userId, table.kind],
    }),
    foreignKey({
      name: "announcement_interactions_announcement_tenant_fk",
      columns: [table.announcementId, table.organizationId],
      foreignColumns: [announcements.id, announcements.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "announcement_interactions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    index("announcement_interactions_org_kind_occurred_idx").on(
      table.organizationId,
      table.kind,
      table.occurredAt,
    ),
    check(
      "announcement_interactions_kind_check",
      sql`${table.kind} in ('impression', 'click', 'dismiss')`,
    ),
  ],
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    color: varchar("color", { length: 20 }).default("#2bb7a9").notNull(),
    icon: varchar("icon", { length: 40 }).default("sparkles").notNull(),
    active: boolean("active").default(true).notNull(),
    draftVersionId: uuid("draft_version_id").notNull(),
    publishedVersionId: uuid("published_version_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    uniqueIndex("ai_agents_org_name_idx").on(table.organizationId, table.name),
    uniqueIndex("ai_agents_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      name: "ai_agents_draft_version_tenant_fk",
      columns: [table.draftVersionId, table.id, table.organizationId],
      foreignColumns: [
        aiAgentVersions.id,
        aiAgentVersions.agentId,
        aiAgentVersions.organizationId,
      ],
    }),
    foreignKey({
      name: "ai_agents_published_version_tenant_fk",
      columns: [table.publishedVersionId, table.id, table.organizationId],
      foreignColumns: [
        aiAgentVersions.id,
        aiAgentVersions.agentId,
        aiAgentVersions.organizationId,
      ],
    }),
    check(
      "ai_agents_version_pointers_distinct_check",
      sql`${table.publishedVersionId} is null or ${table.publishedVersionId} <> ${table.draftVersionId}`,
    ),
  ],
);

export const aiAgentVersions = pgTable(
  "ai_agent_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    version: integer("version").notNull(),
    draftRevision: integer("draft_revision").default(1).notNull(),
    state: aiAgentVersionStateEnum("state").default("draft").notNull(),
    type: aiAgentTypeEnum("type").default("learning_coach").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    color: varchar("color", { length: 20 }).default("#2bb7a9").notNull(),
    icon: varchar("icon", { length: 40 }).default("sparkles").notNull(),
    knowledgeMode: aiAgentKnowledgeModeEnum("knowledge_mode")
      .default("all_accessible_courses")
      .notNull(),
    accessMode: aiAgentAccessModeEnum("access_mode").default("open").notNull(),
    profileFieldIds: jsonb("profile_field_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    additionalPrompts: jsonb("additional_prompts")
      .$type<Array<{ label: string; prompt: string }>>()
      .default([])
      .notNull(),
    createdById: uuid("created_by_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "ai_agent_versions_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_versions_agent_tenant_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [aiAgents.id, aiAgents.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_versions_creator_tenant_fk",
      columns: [table.createdById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("ai_agent_versions_id_agent_org_idx").on(
      table.id,
      table.agentId,
      table.organizationId,
    ),
    uniqueIndex("ai_agent_versions_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("ai_agent_versions_agent_number_idx").on(
      table.agentId,
      table.version,
    ),
    uniqueIndex("ai_agent_versions_one_draft_idx")
      .on(table.agentId)
      .where(sql`${table.state} = 'draft'`),
    index("ai_agent_versions_org_state_updated_idx").on(
      table.organizationId,
      table.state,
      table.updatedAt,
    ),
    check(
      "ai_agent_versions_numbers_check",
      sql`${table.version} >= 1 and ${table.draftRevision} >= 1`,
    ),
    check(
      "ai_agent_versions_name_check",
      sql`length(btrim(${table.name})) between 1 and 120`,
    ),
    check(
      "ai_agent_versions_description_check",
      sql`length(${table.description}) <= 10000`,
    ),
    check(
      "ai_agent_versions_system_prompt_check",
      sql`length(btrim(${table.systemPrompt})) between 10 and 50000`,
    ),
    check(
      "ai_agent_versions_color_check",
      sql`${table.color} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
    check(
      "ai_agent_versions_icon_check",
      sql`length(btrim(${table.icon})) between 1 and 40`,
    ),
    check(
      "ai_agent_versions_profile_fields_check",
      sql`jsonb_typeof(${table.profileFieldIds}) = 'array' and jsonb_array_length(${table.profileFieldIds}) <= 25`,
    ),
    check(
      "ai_agent_versions_additional_prompts_check",
      sql`jsonb_typeof(${table.additionalPrompts}) = 'array' and jsonb_array_length(${table.additionalPrompts}) <= 20`,
    ),
    check(
      "ai_agent_versions_publication_check",
      sql`(${table.state} = 'draft' and ${table.publishedAt} is null) or (${table.state} = 'published' and ${table.publishedAt} is not null)`,
    ),
  ],
);

export const aiAgentVersionSources = pgTable(
  "ai_agent_version_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    sourceType: aiAgentSourceTypeEnum("source_type").notNull(),
    courseId: uuid("course_id"),
    courseVersionId: uuid("course_version_id"),
    mediaAssetId: uuid("media_asset_id"),
    title: varchar("title", { length: 220 }),
    content: text("content"),
    sourceUrl: text("source_url"),
    contentDigest: varchar("content_digest", { length: 64 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_version_sources_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_sources_version_tenant_fk",
      columns: [table.agentVersionId, table.organizationId],
      foreignColumns: [aiAgentVersions.id, aiAgentVersions.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_sources_course_version_tenant_fk",
      columns: [
        table.courseVersionId,
        table.courseId,
        table.organizationId,
      ],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_version_sources_media_tenant_fk",
      columns: [table.mediaAssetId, table.organizationId],
      foreignColumns: [mediaAssets.id, mediaAssets.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("ai_agent_version_sources_course_idx")
      .on(table.agentVersionId, table.courseVersionId)
      .where(sql`${table.sourceType} = 'course_version'`),
    uniqueIndex("ai_agent_version_sources_media_idx")
      .on(table.agentVersionId, table.mediaAssetId)
      .where(sql`${table.sourceType} = 'media_asset'`),
    uniqueIndex("ai_agent_version_sources_web_url_idx")
      .on(table.agentVersionId, table.sourceUrl),
    index("ai_agent_version_sources_org_version_order_idx").on(
      table.organizationId,
      table.agentVersionId,
      table.sortOrder,
      table.id,
    ),
    check(
      "ai_agent_version_sources_sort_order_check",
      sql`${table.sortOrder} between 0 and 10000`,
    ),
    check(
      "ai_agent_version_sources_shape_check",
      sql`(
        ${table.sourceType} = 'course_version'
        and ${table.courseId} is not null
        and ${table.courseVersionId} is not null
        and ${table.mediaAssetId} is null
        and ${table.title} is null
        and ${table.content} is null
        and ${table.sourceUrl} is null
        and ${table.contentDigest} is null
        and ${table.fetchedAt} is null
      ) or (
        ${table.sourceType} = 'manual_text'
        and ${table.courseId} is null
        and ${table.courseVersionId} is null
        and ${table.mediaAssetId} is null
        and ${table.title} is not null
        and ${table.content} is not null
        and length(btrim(${table.title})) between 1 and 220
        and length(btrim(${table.content})) between 1 and 2000000
        and ${table.sourceUrl} is null
        and ${table.contentDigest} is null
        and ${table.fetchedAt} is null
      ) or (
        ${table.sourceType} = 'media_asset'
        and ${table.courseId} is null
        and ${table.courseVersionId} is null
        and ${table.mediaAssetId} is not null
        and ${table.title} is not null
        and ${table.content} is not null
        and length(btrim(${table.title})) between 1 and 220
        and length(btrim(${table.content})) between 1 and 2000000
        and ${table.sourceUrl} is null
        and ${table.contentDigest} is not null
        and ${table.contentDigest} ~ '^[0-9a-f]{64}$'
        and ${table.fetchedAt} is not null
      ) or (
        ${table.sourceType} = 'web_url'
        and ${table.courseId} is null
        and ${table.courseVersionId} is null
        and ${table.mediaAssetId} is null
        and ${table.title} is not null
        and ${table.content} is not null
        and ${table.sourceUrl} is not null
        and ${table.contentDigest} is not null
        and ${table.fetchedAt} is not null
        and length(btrim(${table.title})) between 1 and 220
        and length(btrim(${table.content})) between 1 and 200000
        and length(${table.sourceUrl}) between 12 and 2048
        and ${table.sourceUrl} like 'https://%'
        and ${table.contentDigest} ~ '^[0-9a-f]{64}$'
      )`,
    ),
  ],
);

export const aiAgentVersionAccessGrants = pgTable(
  "ai_agent_version_access_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    subjectType: aiAgentAccessSubjectEnum("subject_type").notNull(),
    subjectRole: roleEnum("subject_role"),
    subjectUserId: uuid("subject_user_id"),
    subjectGroupId: uuid("subject_group_id"),
    subjectBundleId: uuid("subject_bundle_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_version_access_grants_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_access_grants_version_tenant_fk",
      columns: [table.agentVersionId, table.organizationId],
      foreignColumns: [aiAgentVersions.id, aiAgentVersions.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_access_grants_user_tenant_fk",
      columns: [table.subjectUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_access_grants_group_tenant_fk",
      columns: [table.subjectGroupId, table.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_access_grants_bundle_tenant_fk",
      columns: [table.subjectBundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("ai_agent_version_access_grants_role_idx")
      .on(table.agentVersionId, table.subjectRole)
      .where(sql`${table.subjectType} = 'role'`),
    uniqueIndex("ai_agent_version_access_grants_user_idx")
      .on(table.agentVersionId, table.subjectUserId)
      .where(sql`${table.subjectType} = 'user'`),
    uniqueIndex("ai_agent_version_access_grants_group_idx")
      .on(table.agentVersionId, table.subjectGroupId)
      .where(sql`${table.subjectType} = 'group'`),
    uniqueIndex("ai_agent_version_access_grants_bundle_idx")
      .on(table.agentVersionId, table.subjectBundleId)
      .where(sql`${table.subjectType} = 'bundle'`),
    index("ai_agent_version_access_grants_org_version_idx").on(
      table.organizationId,
      table.agentVersionId,
    ),
    check(
      "ai_agent_version_access_grants_subject_shape_check",
      sql`(
        ${table.subjectType} = 'role' and ${table.subjectRole} is not null and ${table.subjectUserId} is null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'user' and ${table.subjectRole} is null and ${table.subjectUserId} is not null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'group' and ${table.subjectRole} is null and ${table.subjectUserId} is null and ${table.subjectGroupId} is not null and ${table.subjectBundleId} is null
      ) or (
        ${table.subjectType} = 'bundle' and ${table.subjectRole} is null and ${table.subjectUserId} is null and ${table.subjectGroupId} is null and ${table.subjectBundleId} is not null
      )`,
    ),
  ],
);

export const aiAgentVersionActions = pgTable(
  "ai_agent_version_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    actionType: aiAgentActionTypeEnum("action_type").notNull(),
    targetType: aiAgentActionTargetTypeEnum("target_type").notNull(),
    courseId: uuid("course_id"),
    groupId: uuid("group_id"),
    bundleId: uuid("bundle_id"),
    label: varchar("label", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_version_actions_organization_fk",
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_actions_version_tenant_fk",
      columns: [table.agentVersionId, table.organizationId],
      foreignColumns: [aiAgentVersions.id, aiAgentVersions.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_agent_version_actions_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_version_actions_group_tenant_fk",
      columns: [table.groupId, table.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_version_actions_bundle_tenant_fk",
      columns: [table.bundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("ai_agent_version_actions_version_course_idx")
      .on(table.agentVersionId, table.actionType, table.courseId)
      .where(sql`${table.targetType} = 'course'`),
    uniqueIndex("ai_agent_version_actions_version_group_idx")
      .on(table.agentVersionId, table.actionType, table.groupId)
      .where(sql`${table.targetType} = 'group'`),
    uniqueIndex("ai_agent_version_actions_version_bundle_idx")
      .on(table.agentVersionId, table.actionType, table.bundleId)
      .where(sql`${table.targetType} = 'bundle'`),
    uniqueIndex("ai_agent_version_actions_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("ai_agent_version_actions_request_target_idx").on(
      table.id,
      table.organizationId,
      table.agentVersionId,
      table.actionType,
    ),
    index("ai_agent_version_actions_org_version_order_idx").on(
      table.organizationId,
      table.agentVersionId,
      table.sortOrder,
      table.id,
    ),
    check(
      "ai_agent_version_actions_label_check",
      sql`length(btrim(${table.label})) between 2 and 120`,
    ),
    check(
      "ai_agent_version_actions_description_check",
      sql`length(btrim(${table.description})) between 3 and 500`,
    ),
    check(
      "ai_agent_version_actions_sort_order_check",
      sql`${table.sortOrder} between 0 and 100`,
    ),
    check(
      "ai_agent_version_actions_target_shape_check",
      sql`(
        ${table.targetType} = 'course' and ${table.actionType} in ('course_enrollment', 'course_unenrollment') and ${table.courseId} is not null and ${table.groupId} is null and ${table.bundleId} is null
      ) or (
        ${table.targetType} = 'group' and ${table.actionType} in ('group_membership_add', 'group_membership_remove') and ${table.courseId} is null and ${table.groupId} is not null and ${table.bundleId} is null
      ) or (
        ${table.targetType} = 'bundle' and ${table.actionType} in ('bundle_assignment_add', 'bundle_assignment_remove') and ${table.courseId} is null and ${table.groupId} is null and ${table.bundleId} is not null
      )`,
    ),
  ],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 220 }),
    status: aiConversationStatusEnum("status").default("active").notNull(),
    messageCount: integer("message_count").default(0).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("ai_conversations_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    foreignKey({
      name: "ai_conversations_agent_tenant_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [aiAgents.id, aiAgents.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "ai_conversations_agent_version_tenant_fk",
      columns: [
        table.agentVersionId,
        table.agentId,
        table.organizationId,
      ],
      foreignColumns: [
        aiAgentVersions.id,
        aiAgentVersions.agentId,
        aiAgentVersions.organizationId,
      ],
    }).onDelete("restrict"),
    index("ai_conversations_org_agent_status_idx").on(
      table.organizationId,
      table.agentId,
      table.status,
    ),
    index("ai_conversations_org_user_updated_idx").on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
    check(
      "ai_conversations_message_count_check",
      sql`${table.messageCount} >= 0`,
    ),
  ],
);

export const aiExternalUseAcknowledgements = pgTable(
  "ai_external_use_acknowledgements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    noticeVersion: integer("notice_version").notNull(),
    noticeDigest: varchar("notice_digest", { length: 64 }).notNull(),
    privacyPolicyUrl: text("privacy_policy_url"),
    transparencyPolicyUrl: text("transparency_policy_url"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_external_use_acknowledgements_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("ai_external_use_acknowledgements_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("ai_external_use_acknowledgements_user_notice_idx").on(
      table.organizationId,
      table.userId,
      table.noticeDigest,
    ),
    index("ai_external_use_acknowledgements_org_acknowledged_idx").on(
      table.organizationId,
      table.acknowledgedAt,
    ),
    check(
      "ai_external_use_acknowledgements_version_check",
      sql`${table.noticeVersion} >= 1`,
    ),
    check(
      "ai_external_use_acknowledgements_digest_check",
      sql`${table.noticeDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_external_use_acknowledgements_privacy_url_check",
      sql`${table.privacyPolicyUrl} is null or ${table.privacyPolicyUrl} ~ '^https://[^[:space:]]+$'`,
    ),
    check(
      "ai_external_use_acknowledgements_transparency_url_check",
      sql`${table.transparencyPolicyUrl} is null or ${table.transparencyPolicyUrl} ~ '^https://[^[:space:]]+$'`,
    ),
  ],
);

export const aiAgentActionRequests = pgTable(
  "ai_agent_action_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    agentVersionId: uuid("agent_version_id").notNull(),
    actionConfigurationId: uuid("action_configuration_id").notNull(),
    conversationId: uuid("conversation_id"),
    requestedById: uuid("requested_by_id").notNull(),
    actionType: aiAgentActionTypeEnum("action_type").notNull(),
    targetType: aiAgentActionTargetTypeEnum("target_type").notNull(),
    targetCourseId: uuid("target_course_id"),
    targetGroupId: uuid("target_group_id"),
    targetBundleId: uuid("target_bundle_id"),
    labelSnapshot: varchar("label_snapshot", { length: 120 }).notNull(),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    status: aiAgentActionRequestStatusEnum("status")
      .default("pending")
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    decisionNote: varchar("decision_note", { length: 1_000 }),
    decidedById: uuid("decided_by_id"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_action_requests_agent_tenant_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [aiAgents.id, aiAgents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_version_tenant_fk",
      columns: [table.agentVersionId, table.agentId, table.organizationId],
      foreignColumns: [
        aiAgentVersions.id,
        aiAgentVersions.agentId,
        aiAgentVersions.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_configuration_tenant_fk",
      columns: [
        table.actionConfigurationId,
        table.organizationId,
        table.agentVersionId,
        table.actionType,
      ],
      foreignColumns: [
        aiAgentVersionActions.id,
        aiAgentVersionActions.organizationId,
        aiAgentVersionActions.agentVersionId,
        aiAgentVersionActions.actionType,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_conversation_tenant_fk",
      columns: [table.conversationId, table.organizationId],
      foreignColumns: [aiConversations.id, aiConversations.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_requester_tenant_fk",
      columns: [table.requestedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_decider_tenant_fk",
      columns: [table.decidedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_course_tenant_fk",
      columns: [table.targetCourseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_group_tenant_fk",
      columns: [table.targetGroupId, table.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_action_requests_bundle_tenant_fk",
      columns: [table.targetBundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("ai_agent_action_requests_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("ai_agent_action_requests_pending_member_config_idx")
      .on(table.organizationId, table.requestedById, table.actionConfigurationId)
      .where(sql`${table.status} = 'pending'`),
    index("ai_agent_action_requests_org_status_requested_idx").on(
      table.organizationId,
      table.status,
      table.requestedAt,
      table.id,
    ),
    index("ai_agent_action_requests_org_member_requested_idx").on(
      table.organizationId,
      table.requestedById,
      table.requestedAt,
      table.id,
    ),
    check(
      "ai_agent_action_requests_payload_digest_check",
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_agent_action_requests_label_check",
      sql`length(btrim(${table.labelSnapshot})) between 2 and 120`,
    ),
    check(
      "ai_agent_action_requests_revision_check",
      sql`${table.revision} >= 1`,
    ),
    check(
      "ai_agent_action_requests_expiry_check",
      sql`${table.expiresAt} > ${table.requestedAt}`,
    ),
    check(
      "ai_agent_action_requests_decision_state_check",
      sql`(
        ${table.status} = 'pending'
        and ${table.decidedById} is null
        and ${table.decisionNote} is null
        and ${table.decidedAt} is null
        and ${table.executedAt} is null
      ) or (
        ${table.status} = 'approved'
        and ${table.decidedById} is not null
        and ${table.decidedAt} is not null
        and ${table.executedAt} is not null
      ) or (
        ${table.status} = 'rejected'
        and ${table.decidedById} is not null
        and ${table.decisionNote} is not null
        and btrim(${table.decisionNote}) <> ''
        and ${table.decidedAt} is not null
        and ${table.executedAt} is null
      ) or (
        ${table.status} in ('cancelled', 'expired')
        and ${table.decidedById} is null
        and ${table.decidedAt} is not null
        and ${table.executedAt} is null
      )`,
    ),
    check(
      "ai_agent_action_requests_target_shape_check",
      sql`(
        ${table.targetType} = 'course' and ${table.actionType} in ('course_enrollment', 'course_unenrollment') and ${table.targetCourseId} is not null and ${table.targetGroupId} is null and ${table.targetBundleId} is null
      ) or (
        ${table.targetType} = 'group' and ${table.actionType} in ('group_membership_add', 'group_membership_remove') and ${table.targetCourseId} is null and ${table.targetGroupId} is not null and ${table.targetBundleId} is null
      ) or (
        ${table.targetType} = 'bundle' and ${table.actionType} in ('bundle_assignment_add', 'bundle_assignment_remove') and ${table.targetCourseId} is null and ${table.targetGroupId} is null and ${table.targetBundleId} is not null
      )`,
    ),
  ],
);

export const aiAgentMembershipProvenance = pgTable(
  "ai_agent_membership_provenance",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull(),
    memberId: uuid("member_id").notNull(),
    targetType: aiAgentActionTargetTypeEnum("target_type").notNull(),
    targetGroupId: uuid("target_group_id"),
    targetBundleId: uuid("target_bundle_id"),
    grantRequestId: uuid("grant_request_id").notNull(),
    revokedByRequestId: uuid("revoked_by_request_id"),
    revocationReason: aiAgentMembershipRevocationReasonEnum("revocation_reason"),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_membership_provenance_agent_tenant_fk",
      columns: [table.agentId, table.organizationId],
      foreignColumns: [aiAgents.id, aiAgents.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_membership_provenance_member_tenant_fk",
      columns: [table.memberId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_membership_provenance_group_tenant_fk",
      columns: [table.targetGroupId, table.organizationId],
      foreignColumns: [groups.id, groups.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_membership_provenance_bundle_tenant_fk",
      columns: [table.targetBundleId, table.organizationId],
      foreignColumns: [bundles.id, bundles.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_membership_provenance_grant_request_tenant_fk",
      columns: [table.grantRequestId, table.organizationId],
      foreignColumns: [
        aiAgentActionRequests.id,
        aiAgentActionRequests.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "ai_agent_membership_provenance_revoke_request_tenant_fk",
      columns: [table.revokedByRequestId, table.organizationId],
      foreignColumns: [
        aiAgentActionRequests.id,
        aiAgentActionRequests.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("ai_agent_membership_provenance_grant_request_idx").on(
      table.grantRequestId,
    ),
    uniqueIndex("ai_agent_membership_provenance_active_group_idx")
      .on(table.organizationId, table.memberId, table.targetGroupId)
      .where(sql`${table.targetType} = 'group' and ${table.revokedAt} is null`),
    uniqueIndex("ai_agent_membership_provenance_active_bundle_idx")
      .on(table.organizationId, table.memberId, table.targetBundleId)
      .where(sql`${table.targetType} = 'bundle' and ${table.revokedAt} is null`),
    index("ai_agent_membership_provenance_member_idx").on(
      table.organizationId,
      table.memberId,
      table.grantedAt,
    ),
    check(
      "ai_agent_membership_provenance_target_shape_check",
      sql`(${table.targetType} = 'group' and ${table.targetGroupId} is not null and ${table.targetBundleId} is null) or (${table.targetType} = 'bundle' and ${table.targetGroupId} is null and ${table.targetBundleId} is not null)`,
    ),
    check(
      "ai_agent_membership_provenance_revocation_state_check",
      sql`(${table.revokedAt} is null and ${table.revokedByRequestId} is null and ${table.revocationReason} is null) or (${table.revokedAt} is not null and ${table.revocationReason} is not null and ((${table.revocationReason} = 'ai_action' and ${table.revokedByRequestId} is not null) or (${table.revocationReason} <> 'ai_action' and ${table.revokedByRequestId} is null)))`,
    ),
  ],
);

export const aiAgentActionEvents = pgTable(
  "ai_agent_action_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    actorReference: varchar("actor_reference", { length: 64 }).notNull(),
    event: varchar("event", { length: 80 }).notNull(),
    fromStatus: aiAgentActionRequestStatusEnum("from_status"),
    toStatus: aiAgentActionRequestStatusEnum("to_status").notNull(),
    revision: integer("revision").notNull(),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "ai_agent_action_events_request_tenant_fk",
      columns: [table.requestId, table.organizationId],
      foreignColumns: [aiAgentActionRequests.id, aiAgentActionRequests.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("ai_agent_action_events_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("ai_agent_action_events_request_revision_idx").on(
      table.requestId,
      table.revision,
    ),
    index("ai_agent_action_events_org_request_created_idx").on(
      table.organizationId,
      table.requestId,
      table.createdAt,
      table.id,
    ),
    check(
      "ai_agent_action_events_actor_reference_check",
      sql`${table.actorReference} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_agent_action_events_payload_digest_check",
      sql`${table.payloadDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "ai_agent_action_events_revision_check",
      sql`${table.revision} >= 1`,
    ),
    check(
      "ai_agent_action_events_transition_check",
      sql`(${table.fromStatus} is null and ${table.toStatus} = 'pending') or (${table.fromStatus} is not null and ${table.fromStatus} <> ${table.toStatus})`,
    ),
  ],
);

export type AiMessageCitation = {
  title: string;
  href?: string;
  courseId?: string;
  lessonId?: string;
  pageId?: string;
  excerpt?: string;
};

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    inputTokens: integer("input_tokens").default(0).notNull(),
    outputTokens: integer("output_tokens").default(0).notNull(),
    latencyMs: integer("latency_ms"),
    provider: varchar("provider", { length: 80 }),
    model: varchar("model", { length: 160 }),
    citations: jsonb("citations")
      .$type<AiMessageCitation[]>()
      .default([])
      .notNull(),
    toolCalls: jsonb("tool_calls")
      .$type<Record<string, unknown>[]>()
      .default([])
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("ai_messages_org_conversation_created_idx").on(
      table.organizationId,
      table.conversationId,
      table.createdAt,
    ),
    check("ai_messages_input_tokens_check", sql`${table.inputTokens} >= 0`),
    check("ai_messages_output_tokens_check", sql`${table.outputTokens} >= 0`),
    check(
      "ai_messages_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    type: varchar("type", { length: 80 }).notNull(),
    entityType: varchar("entity_type", { length: 80 }),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("activity_events_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);

export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    subjectReference: varchar("subject_reference", { length: 64 }).notNull(),
    requestedById: uuid("requested_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    clientRequestId: varchar("client_request_id", { length: 180 }).notNull(),
    type: privacyRequestTypeEnum("type").notNull(),
    status: privacyRequestStatusEnum("status").default("received").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    identityVerifiedAt: timestamp("identity_verified_at", {
      withTimezone: true,
    }),
    identityVerifiedById: uuid("identity_verified_by_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedById: uuid("approved_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    backupExpiresAt: timestamp("backup_expires_at", { withTimezone: true }),
    policyVersion: varchar("policy_version", { length: 80 }),
    policySnapshot: jsonb("policy_snapshot")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    statusReason: text("status_reason"),
    processingAttempt: integer("processing_attempt").default(0).notNull(),
    processingClaimToken: uuid("processing_claim_token"),
    processingClaimedAt: timestamp("processing_claimed_at", {
      withTimezone: true,
    }),
    processingLeaseExpiresAt: timestamp("processing_lease_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "privacy_requests_subject_tenant_fk",
      columns: [table.subjectUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "privacy_requests_requester_tenant_fk",
      columns: [table.requestedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "privacy_requests_verifier_tenant_fk",
      columns: [table.identityVerifiedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "privacy_requests_approver_tenant_fk",
      columns: [table.approvedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("privacy_requests_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("privacy_requests_org_client_request_idx").on(
      table.organizationId,
      table.clientRequestId,
    ),
    index("privacy_requests_org_subject_status_idx").on(
      table.organizationId,
      table.subjectReference,
      table.status,
      table.createdAt,
    ),
    index("privacy_requests_org_status_due_idx").on(
      table.organizationId,
      table.status,
      table.dueAt,
    ),
    index("privacy_requests_processing_lease_idx").on(
      table.status,
      table.processingLeaseExpiresAt,
    ),
    check(
      "privacy_requests_subject_reference_check",
      sql`${table.subjectReference} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "privacy_requests_client_request_check",
      sql`btrim(${table.clientRequestId}) <> ''`,
    ),
    check(
      "privacy_requests_due_at_check",
      sql`${table.dueAt} >= ${table.createdAt}`,
    ),
    check(
      "privacy_requests_timeline_check",
      sql`(${table.identityVerifiedAt} is null or ${table.identityVerifiedAt} >= ${table.createdAt}) and (${table.approvedAt} is null or (${table.identityVerifiedAt} is not null and ${table.approvedAt} >= ${table.identityVerifiedAt})) and (${table.processingStartedAt} is null or (${table.approvedAt} is not null and ${table.processingStartedAt} >= ${table.approvedAt})) and (${table.completedAt} is null or (${table.processingStartedAt} is not null and ${table.completedAt} >= ${table.processingStartedAt})) and (${table.backupExpiresAt} is null or (${table.completedAt} is not null and ${table.backupExpiresAt} >= ${table.completedAt}))`,
    ),
    check(
      "privacy_requests_completion_state_check",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
    check(
      "privacy_requests_reason_state_check",
      sql`${table.status} not in ('blocked', 'rejected', 'cancelled', 'failed') or (${table.statusReason} is not null and btrim(${table.statusReason}) <> '')`,
    ),
    check(
      "privacy_requests_processing_attempt_check",
      sql`${table.processingAttempt} >= 0`,
    ),
    check(
      "privacy_requests_processing_claim_check",
      sql`(${table.status} = 'processing' and ${table.processingClaimToken} is not null and ${table.processingClaimedAt} is not null and ${table.processingLeaseExpiresAt} is not null and ${table.processingLeaseExpiresAt} > ${table.processingClaimedAt}) or (${table.status} <> 'processing' and ${table.processingClaimToken} is null and ${table.processingClaimedAt} is null and ${table.processingLeaseExpiresAt} is null)`,
    ),
  ],
);

export const privacyRequestEvents = pgTable(
  "privacy_request_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    actorReference: varchar("actor_reference", { length: 64 }).notNull(),
    event: varchar("event", { length: 80 }).notNull(),
    fromStatus: privacyRequestStatusEnum("from_status"),
    toStatus: privacyRequestStatusEnum("to_status"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "privacy_request_events_request_tenant_fk",
      columns: [table.requestId, table.organizationId],
      foreignColumns: [privacyRequests.id, privacyRequests.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("privacy_request_events_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("privacy_request_events_org_request_created_idx").on(
      table.organizationId,
      table.requestId,
      table.createdAt,
      table.id,
    ),
    index("privacy_request_events_org_actor_created_idx").on(
      table.organizationId,
      table.actorReference,
      table.createdAt,
    ),
    check(
      "privacy_request_events_actor_reference_check",
      sql`${table.actorReference} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "privacy_request_events_event_check",
      sql`btrim(${table.event}) <> ''`,
    ),
    check(
      "privacy_request_events_transition_check",
      sql`${table.fromStatus} is null or ${table.toStatus} is not null`,
    ),
  ],
);

export const privacyLegalHolds = pgTable(
  "privacy_legal_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id"),
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    subjectReference: varchar("subject_reference", { length: 64 }).notNull(),
    scope: privacyLegalHoldScopeEnum("scope").notNull(),
    reference: varchar("reference", { length: 180 }).notNull(),
    reason: text("reason").notNull(),
    legalBasis: text("legal_basis").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startsAt: timestamp("starts_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedById: uuid("released_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "privacy_legal_holds_request_tenant_fk",
      columns: [table.requestId, table.organizationId],
      foreignColumns: [privacyRequests.id, privacyRequests.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "privacy_legal_holds_subject_tenant_fk",
      columns: [table.subjectUserId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "privacy_legal_holds_creator_tenant_fk",
      columns: [table.createdById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    foreignKey({
      name: "privacy_legal_holds_releaser_tenant_fk",
      columns: [table.releasedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }),
    uniqueIndex("privacy_legal_holds_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("privacy_legal_holds_org_reference_idx").on(
      table.organizationId,
      table.reference,
    ),
    index("privacy_legal_holds_org_subject_active_idx")
      .on(
        table.organizationId,
        table.subjectReference,
        table.scope,
        table.expiresAt,
      )
      .where(sql`${table.releasedAt} is null`),
    index("privacy_legal_holds_org_request_idx").on(
      table.organizationId,
      table.requestId,
    ),
    check(
      "privacy_legal_holds_subject_reference_check",
      sql`${table.subjectReference} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "privacy_legal_holds_text_check",
      sql`btrim(${table.reference}) <> '' and btrim(${table.reason}) <> '' and btrim(${table.legalBasis}) <> ''`,
    ),
    check(
      "privacy_legal_holds_timeline_check",
      sql`(${table.expiresAt} is null or ${table.expiresAt} > ${table.startsAt}) and (${table.releasedAt} is null or ${table.releasedAt} >= ${table.startsAt})`,
    ),
    check(
      "privacy_legal_holds_release_state_check",
      sql`(${table.releasedAt} is null and ${table.releasedById} is null and ${table.releaseReason} is null) or (${table.releasedAt} is not null and ${table.releaseReason} is not null and btrim(${table.releaseReason}) <> '')`,
    ),
  ],
);

export const privacyExportArtifacts = pgTable(
  "privacy_export_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull(),
    status: privacyExportArtifactStatusEnum("status")
      .default("building")
      .notNull(),
    format: privacyExportArtifactFormatEnum("format").default("json").notNull(),
    storageDriver: privacyExportStorageDriverEnum("storage_driver").notNull(),
    storageKey: text("storage_key").notNull(),
    storageVersionId: text("storage_version_id"),
    storageEtag: varchar("storage_etag", { length: 160 }),
    safeFileName: varchar("safe_file_name", { length: 120 }).notNull(),
    contentType: varchar("content_type", { length: 180 }).notNull(),
    manifestSha256: varchar("manifest_sha256", { length: 64 }),
    artifactSha256: varchar("artifact_sha256", { length: 64 }),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    fileCount: integer("file_count"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    failureCode: varchar("failure_code", { length: 80 }),
    failureDetail: text("failure_detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "privacy_export_artifacts_request_tenant_fk",
      columns: [table.requestId, table.organizationId],
      foreignColumns: [privacyRequests.id, privacyRequests.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("privacy_export_artifacts_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("privacy_export_artifacts_org_request_idx").on(
      table.organizationId,
      table.requestId,
    ),
    uniqueIndex("privacy_export_artifacts_storage_key_idx").on(
      table.storageDriver,
      table.storageKey,
    ),
    index("privacy_export_artifacts_org_status_expiry_idx").on(
      table.organizationId,
      table.status,
      table.expiresAt,
    ),
    check(
      "privacy_export_artifacts_storage_namespace_check",
      sql`${table.storageKey} like ('tenants/' || ${table.organizationId}::text || '/privacy-exports/' || ${table.requestId}::text || '/%')`,
    ),
    check(
      "privacy_export_artifacts_storage_identity_check",
      sql`(${table.storageDriver} = 'filesystem' and ${table.storageVersionId} is null and ${table.storageEtag} is null) or (${table.storageDriver} = 's3' and ((${table.storageVersionId} is null and ${table.storageEtag} is null) or (${table.storageVersionId} is not null and length(${table.storageVersionId}) between 1 and 1024 and btrim(${table.storageVersionId}) <> '' and ${table.storageEtag} is not null and btrim(${table.storageEtag}) <> '')) and (${table.status} not in ('ready', 'deleted') or (${table.storageVersionId} is not null and ${table.storageEtag} is not null)))`,
    ),
    check(
      "privacy_export_artifacts_file_name_check",
      sql`${table.safeFileName} ~ '^[a-z0-9][a-z0-9_-]{0,114}[.](json|zip)$'`,
    ),
    check(
      "privacy_export_artifacts_content_type_check",
      sql`btrim(${table.contentType}) <> ''`,
    ),
    check(
      "privacy_export_artifacts_hash_check",
      sql`(${table.manifestSha256} is null or ${table.manifestSha256} ~ '^[0-9a-f]{64}$') and (${table.artifactSha256} is null or ${table.artifactSha256} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      "privacy_export_artifacts_size_check",
      sql`(${table.sizeBytes} is null and ${table.fileCount} is null) or (${table.sizeBytes} > 0 and ${table.fileCount} > 0)`,
    ),
    check(
      "privacy_export_artifacts_timeline_check",
      sql`${table.expiresAt} > ${table.createdAt} and (${table.readyAt} is null or ${table.readyAt} >= ${table.createdAt}) and (${table.deletedAt} is null or (${table.deletedAt} >= ${table.createdAt} and (${table.readyAt} is null or ${table.deletedAt} >= ${table.readyAt})))`,
    ),
    check(
      "privacy_export_artifacts_state_check",
      sql`(${table.status} = 'building' and ${table.readyAt} is null and ${table.deletedAt} is null and ${table.manifestSha256} is null and ${table.artifactSha256} is null and ${table.sizeBytes} is null and ${table.fileCount} is null and ${table.failureCode} is null) or (${table.status} = 'ready' and ${table.readyAt} is not null and ${table.deletedAt} is null and ${table.manifestSha256} is not null and ${table.artifactSha256} is not null and ${table.sizeBytes} is not null and ${table.fileCount} is not null and ${table.failureCode} is null) or (${table.status} = 'failed' and ${table.readyAt} is null and ${table.deletedAt} is null and ${table.failureCode} is not null and btrim(${table.failureCode}) <> '') or (${table.status} = 'deleted' and ${table.deletedAt} is not null)`,
    ),
  ],
);

export const platformSettings = pgTable(
  "platform_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 120 }).notNull(),
    value: jsonb("value")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("platform_settings_org_key_idx").on(
      table.organizationId,
      table.key,
    ),
  ],
);

export const customDomainClaims = pgTable(
  "custom_domain_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    hostname: varchar("hostname", { length: 253 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    challengeHash: varchar("challenge_hash", { length: 64 }).notNull(),
    challengeExpiresAt: timestamp("challenge_expires_at", {
      withTimezone: true,
    }).notNull(),
    revision: integer("revision").default(1).notNull(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastCheckCode: varchar("last_check_code", { length: 32 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdById: uuid("created_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_domain_claims_creator_tenant_fk",
      columns: [table.createdById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("custom_domain_claims_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("custom_domain_claims_active_hostname_idx")
      .on(table.hostname)
      .where(sql`${table.status} <> 'revoked'`),
    uniqueIndex("custom_domain_claims_active_org_idx")
      .on(table.organizationId)
      .where(sql`${table.status} <> 'revoked'`),
    index("custom_domain_claims_org_status_idx").on(
      table.organizationId,
      table.status,
      table.updatedAt,
    ),
    check(
      "custom_domain_claims_hostname_check",
      sql`${table.hostname} = lower(${table.hostname}) and length(${table.hostname}) between 3 and 253 and ${table.hostname} ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and position('..' in ${table.hostname}) = 0 and position('.-' in ${table.hostname}) = 0 and position('-.' in ${table.hostname}) = 0`,
    ),
    check(
      "custom_domain_claims_status_check",
      sql`${table.status} in ('pending', 'verified', 'revoked')`,
    ),
    check(
      "custom_domain_claims_hash_check",
      sql`${table.challengeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "custom_domain_claims_check_code_check",
      sql`${table.lastCheckCode} is null or ${table.lastCheckCode} in ('verified', 'no_match', 'dns_error', 'timeout', 'expired')`,
    ),
    check(
      "custom_domain_claims_state_check",
      sql`(${table.status} = 'pending' and ${table.verifiedAt} is null and ${table.revokedAt} is null) or (${table.status} = 'verified' and ${table.verifiedAt} is not null and ${table.revokedAt} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null)`,
    ),
    check(
      "custom_domain_claims_timeline_check",
      sql`${table.challengeExpiresAt} > ${table.createdAt} and (${table.lastCheckedAt} is null or ${table.lastCheckedAt} >= ${table.createdAt}) and (${table.verifiedAt} is null or ${table.verifiedAt} >= ${table.createdAt}) and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}) and ${table.updatedAt} >= ${table.createdAt}`,
    ),
    check(
      "custom_domain_claims_revision_check",
      sql`${table.revision} >= 1`,
    ),
  ],
);

export const memberWelcomeSettings = pgTable(
  "member_welcome_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(false).notNull(),
    title: varchar("title", { length: 160 })
      .default("Willkommen in deiner Academy")
      .notNull(),
    welcomeText: text("welcome_text")
      .default(
        "Schoen, dass du da bist. Hier findest du alles fuer deinen Lernstart.",
      )
      .notNull(),
    videoUrl: varchar("video_url", { length: 2000 }),
    promptProfileImage: boolean("prompt_profile_image")
      .default(false)
      .notNull(),
    promptProfileCompletion: boolean("prompt_profile_completion")
      .default(false)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "member_welcome_settings_title_check",
      sql`btrim(${table.title}) <> ''`,
    ),
    check(
      "member_welcome_settings_text_check",
      sql`btrim(${table.welcomeText}) <> '' and char_length(${table.welcomeText}) <= 5000`,
    ),
    check(
      "member_welcome_settings_video_url_check",
      sql`${table.videoUrl} is null or ${table.videoUrl} ~ '^https://[^[:space:]]+$'`,
    ),
    check("member_welcome_settings_version_check", sql`${table.version} >= 1`),
  ],
);

export const memberWelcomeAcknowledgements = pgTable(
  "member_welcome_acknowledgements",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => memberWelcomeSettings.organizationId, {
        onDelete: "cascade",
      }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    configurationVersion: integer("configuration_version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "member_welcome_acknowledgements_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("member_welcome_acknowledgements_org_version_idx").on(
      table.organizationId,
      table.configurationVersion,
    ),
    check(
      "member_welcome_acknowledgements_version_check",
      sql`${table.configurationVersion} >= 1`,
    ),
  ],
);

export const dataProfileDefinitions = pgTable(
  "data_profile_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 120 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    allowMemberCreation: boolean("allow_member_creation")
      .default(true)
      .notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("data_profile_definitions_org_key_idx").on(
      table.organizationId,
      table.key,
    ),
    uniqueIndex("data_profile_definitions_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("data_profile_definitions_org_active_sort_idx").on(
      table.organizationId,
      table.active,
      table.sortOrder,
    ),
    check(
      "data_profile_definitions_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_]{1,119}$'`,
    ),
    check(
      "data_profile_definitions_name_check",
      sql`btrim(${table.name}) <> ''`,
    ),
  ],
);

export const memberDataProfiles = pgTable(
  "member_data_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    definitionId: uuid("definition_id")
      .notNull()
      .references(() => dataProfileDefinitions.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 180 }).notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "member_data_profiles_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "member_data_profiles_definition_tenant_fk",
      columns: [table.definitionId, table.organizationId],
      foreignColumns: [
        dataProfileDefinitions.id,
        dataProfileDefinitions.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("member_data_profiles_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    uniqueIndex("member_data_profiles_id_user_org_idx").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    uniqueIndex("member_data_profiles_org_user_name_idx").on(
      table.organizationId,
      table.userId,
      table.name,
    ),
    uniqueIndex("member_data_profiles_org_user_default_idx")
      .on(table.organizationId, table.userId)
      .where(sql`${table.isDefault} = true`),
    index("member_data_profiles_org_user_active_idx").on(
      table.organizationId,
      table.userId,
      table.active,
    ),
    check("member_data_profiles_name_check", sql`btrim(${table.name}) <> ''`),
    check(
      "member_data_profiles_default_active_check",
      sql`${table.isDefault} = false or ${table.active} = true`,
    ),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 120 }).notNull(),
    label: varchar("label", { length: 180 }).notNull(),
    description: text("description"),
    type: customFieldTypeEnum("type").default("text").notNull(),
    category: varchar("category", { length: 120 }).default("Profil").notNull(),
    required: boolean("required").default(false).notNull(),
    visibility: customFieldVisibilityEnum("visibility")
      .default("member")
      .notNull(),
    personalizationEnabled: boolean("personalization_enabled")
      .default(false)
      .notNull(),
    options: jsonb("options").$type<string[]>().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_org_key_idx").on(
      table.organizationId,
      table.key,
    ),
    uniqueIndex("custom_field_definitions_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("custom_field_definitions_org_category_idx").on(
      table.organizationId,
      table.category,
      table.sortOrder,
    ),
    check(
      "custom_field_definitions_personalization_check",
      sql`${table.personalizationEnabled} = false or (${table.visibility}::text = 'member' and ${table.type}::text not in ('url', 'media'))`,
    ),
  ],
);

export const dataProfileFields = pgTable(
  "data_profile_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileDefinitionId: uuid("profile_definition_id")
      .notNull()
      .references(() => dataProfileDefinitions.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    requiredOverride: boolean("required_override"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "data_profile_fields_definition_tenant_fk",
      columns: [table.profileDefinitionId, table.organizationId],
      foreignColumns: [
        dataProfileDefinitions.id,
        dataProfileDefinitions.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "data_profile_fields_field_tenant_fk",
      columns: [table.fieldId, table.organizationId],
      foreignColumns: [
        customFieldDefinitions.id,
        customFieldDefinitions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("data_profile_fields_definition_field_idx").on(
      table.profileDefinitionId,
      table.fieldId,
    ),
    index("data_profile_fields_org_definition_sort_idx").on(
      table.organizationId,
      table.profileDefinitionId,
      table.sortOrder,
    ),
    check("data_profile_fields_sort_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value")
      .$type<string | number | boolean | string[] | null>()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("custom_field_values_user_field_idx").on(
      table.userId,
      table.fieldId,
    ),
    index("custom_field_values_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const dataProfileValues = pgTable(
  "data_profile_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => memberDataProfiles.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    value: jsonb("value")
      .$type<string | number | boolean | string[] | null>()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "data_profile_values_profile_user_tenant_fk",
      columns: [table.profileId, table.userId, table.organizationId],
      foreignColumns: [
        memberDataProfiles.id,
        memberDataProfiles.userId,
        memberDataProfiles.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "data_profile_values_field_tenant_fk",
      columns: [table.fieldId, table.organizationId],
      foreignColumns: [
        customFieldDefinitions.id,
        customFieldDefinitions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("data_profile_values_profile_field_idx").on(
      table.profileId,
      table.fieldId,
    ),
    index("data_profile_values_org_user_idx").on(
      table.organizationId,
      table.userId,
    ),
  ],
);

export const communityProfileSettings = pgTable(
  "community_profile_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    completionGateEnabled: boolean("completion_gate_enabled")
      .default(false)
      .notNull(),
    revision: integer("revision").default(1).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("community_profile_settings_revision_check", sql`${table.revision} >= 1`),
  ],
);

export const communityPublicProfileFields = pgTable(
  "community_public_profile_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => communityProfileSettings.organizationId, {
        onDelete: "cascade",
      }),
    standardField: varchar("standard_field", { length: 40 }).$type<
      | "avatar"
      | "job_title"
      | "department"
      | "bio"
      | "community_points"
      | "badges"
    >(),
    customFieldId: uuid("custom_field_id").references(
      () => customFieldDefinitions.id,
      { onDelete: "no action" },
    ),
    requiredForPosting: boolean("required_for_posting")
      .default(false)
      .notNull(),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "community_public_profile_fields_custom_tenant_fk",
      columns: [table.customFieldId, table.organizationId],
      foreignColumns: [
        customFieldDefinitions.id,
        customFieldDefinitions.organizationId,
      ],
    }).onDelete("no action"),
    uniqueIndex("community_public_profile_fields_org_standard_idx")
      .on(table.organizationId, table.standardField)
      .where(sql`${table.standardField} is not null`),
    uniqueIndex("community_public_profile_fields_org_custom_idx")
      .on(table.organizationId, table.customFieldId)
      .where(sql`${table.customFieldId} is not null`),
    uniqueIndex("community_public_profile_fields_org_sort_idx").on(
      table.organizationId,
      table.sortOrder,
    ),
    check(
      "community_public_profile_fields_source_check",
      sql`num_nonnulls(${table.standardField}, ${table.customFieldId}) = 1`,
    ),
    check(
      "community_public_profile_fields_standard_check",
      sql`${table.standardField} is null or ${table.standardField} in ('avatar', 'job_title', 'department', 'bio', 'community_points', 'badges')`,
    ),
    check(
      "community_public_profile_fields_required_check",
      sql`${table.requiredForPosting} = false or ${table.customFieldId} is not null or ${table.standardField} in ('avatar', 'job_title', 'department', 'bio')`,
    ),
    check(
      "community_public_profile_fields_sort_check",
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);

export const dataForms = pgTable(
  "data_forms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileDefinitionId: uuid("profile_definition_id")
      .notNull()
      .references(() => dataProfileDefinitions.id, { onDelete: "restrict" }),
    key: varchar("key", { length: 120 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    submitLabel: varchar("submit_label", { length: 80 })
      .default("Angaben speichern")
      .notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "data_forms_definition_tenant_fk",
      columns: [table.profileDefinitionId, table.organizationId],
      foreignColumns: [
        dataProfileDefinitions.id,
        dataProfileDefinitions.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("data_forms_org_key_idx").on(table.organizationId, table.key),
    uniqueIndex("data_forms_id_org_idx").on(table.id, table.organizationId),
    index("data_forms_org_active_idx").on(table.organizationId, table.active),
    check(
      "data_forms_key_check",
      sql`${table.key} ~ '^[a-z][a-z0-9_]{1,119}$'`,
    ),
    check("data_forms_name_check", sql`btrim(${table.name}) <> ''`),
    check(
      "data_forms_submit_label_check",
      sql`btrim(${table.submitLabel}) <> ''`,
    ),
  ],
);

export const dataFormFields = pgTable(
  "data_form_fields",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => dataForms.id, { onDelete: "cascade" }),
    fieldId: uuid("field_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    requiredOverride: boolean("required_override"),
    sortOrder: integer("sort_order").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "data_form_fields_form_tenant_fk",
      columns: [table.formId, table.organizationId],
      foreignColumns: [dataForms.id, dataForms.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "data_form_fields_field_tenant_fk",
      columns: [table.fieldId, table.organizationId],
      foreignColumns: [
        customFieldDefinitions.id,
        customFieldDefinitions.organizationId,
      ],
    }).onDelete("cascade"),
    uniqueIndex("data_form_fields_form_field_idx").on(
      table.formId,
      table.fieldId,
    ),
    index("data_form_fields_org_form_sort_idx").on(
      table.organizationId,
      table.formId,
      table.sortOrder,
    ),
    check("data_form_fields_sort_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const dataFormSubmissions = pgTable(
  "data_form_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => dataForms.id, { onDelete: "restrict" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => memberDataProfiles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submittedById: uuid("submitted_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceType: varchar("source_type", { length: 40 })
      .default("profile")
      .notNull(),
    sourceId: uuid("source_id"),
    responseSnapshot: jsonb("response_snapshot")
      .$type<
        Array<{
          fieldId: string;
          key: string;
          label: string;
          value: string | number | boolean | string[] | null;
        }>
      >()
      .default([])
      .notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "data_form_submissions_form_tenant_fk",
      columns: [table.formId, table.organizationId],
      foreignColumns: [dataForms.id, dataForms.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "data_form_submissions_profile_user_tenant_fk",
      columns: [table.profileId, table.userId, table.organizationId],
      foreignColumns: [
        memberDataProfiles.id,
        memberDataProfiles.userId,
        memberDataProfiles.organizationId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "data_form_submissions_submitter_tenant_fk",
      columns: [table.submittedById, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("restrict"),
    index("data_form_submissions_org_user_date_idx").on(
      table.organizationId,
      table.userId,
      table.submittedAt,
    ),
    index("data_form_submissions_org_form_date_idx").on(
      table.organizationId,
      table.formId,
      table.submittedAt,
    ),
    check(
      "data_form_submissions_source_type_check",
      sql`${table.sourceType} in ('profile', 'lesson', 'hub', 'api')`,
    ),
    check(
      "data_form_submissions_source_id_check",
      sql`(${table.sourceType} in ('profile', 'api') and ${table.sourceId} is null) or (${table.sourceType} in ('lesson', 'hub') and ${table.sourceId} is not null)`,
    ),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    prefix: varchar("prefix", { length: 32 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    scopes: text("scopes").array().default([]).notNull(),
    status: apiKeyStatusEnum("status").default("active").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("api_keys_hash_idx").on(table.keyHash),
    index("api_keys_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    category: notificationCategoryEnum("category").default("system").notNull(),
    recipientEmail: varchar("recipient_email", { length: 255 }).notNull(),
    payload: jsonb("payload")
      .$type<
        | {
            v: 1;
            alg: "A256GCM";
            iv: string;
            tag: string;
            ciphertext: string;
          }
        | {
            v: 2;
            alg: "A256GCM";
            kid: string;
            iv: string;
            tag: string;
            ciphertext: string;
          }
      >()
      .notNull(),
    status: emailDeliveryStatusEnum("status").default("pending").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_deliveries_id_user_org_idx").on(
      table.id,
      table.userId,
      table.organizationId,
    ),
    uniqueIndex("email_deliveries_id_org_idx").on(
      table.id,
      table.organizationId,
    ),
    index("email_deliveries_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("email_deliveries_status_retry_idx").on(
      table.status,
      table.nextRetryAt,
    ),
    index("email_deliveries_processing_claim_idx").on(
      table.status,
      table.claimedAt,
    ),
    index("email_deliveries_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const emailDeliveryFeedbackEvents = pgTable(
  "email_delivery_feedback_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    deliveryId: uuid("delivery_id").notNull(),
    externalEventId: varchar("external_event_id", { length: 180 }).notNull(),
    eventType: emailFeedbackEventTypeEnum("event_type").notNull(),
    bounceKind: emailBounceKindEnum("bounce_kind"),
    reasonCode: varchar("reason_code", { length: 120 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_feedback_events_org_external_idx").on(
      table.organizationId,
      table.externalEventId,
    ),
    index("email_feedback_events_delivery_idx").on(
      table.organizationId,
      table.deliveryId,
      table.occurredAt,
    ),
    index("email_feedback_events_created_idx").on(table.createdAt),
    foreignKey({
      columns: [table.deliveryId, table.organizationId],
      foreignColumns: [emailDeliveries.id, emailDeliveries.organizationId],
      name: "email_feedback_events_delivery_org_fk",
    }).onDelete("cascade"),
    check(
      "email_feedback_events_bounce_kind_check",
      sql`(${table.eventType} = 'bounce' and ${table.bounceKind} is not null) or (${table.eventType} = 'complaint' and ${table.bounceKind} is null)`,
    ),
    check(
      "email_feedback_events_payload_hash_check",
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const emailSuppressions = pgTable(
  "email_suppressions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    userId: uuid("user_id").notNull(),
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),
    reason: emailSuppressionReasonEnum("reason").notNull(),
    occurrenceCount: integer("occurrence_count").default(1).notNull(),
    firstOccurredAt: timestamp("first_occurred_at", {
      withTimezone: true,
    }).notNull(),
    lastOccurredAt: timestamp("last_occurred_at", {
      withTimezone: true,
    }).notNull(),
    sourceDeliveryId: uuid("source_delivery_id").references(
      () => emailDeliveries.id,
      { onDelete: "set null" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedById: uuid("released_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    releaseReason: emailSuppressionReleaseReasonEnum("release_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_suppressions_active_recipient_idx")
      .on(table.organizationId, table.recipientHash)
      .where(sql`${table.releasedAt} is null`),
    index("email_suppressions_org_status_idx").on(
      table.organizationId,
      table.releasedAt,
      table.expiresAt,
    ),
    index("email_suppressions_user_idx").on(
      table.organizationId,
      table.userId,
      table.updatedAt,
    ),
    foreignKey({
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
      name: "email_suppressions_user_org_fk",
    }).onDelete("cascade"),
    check(
      "email_suppressions_occurrence_count_check",
      sql`${table.occurrenceCount} > 0`,
    ),
    check(
      "email_suppressions_recipient_hash_check",
      sql`${table.recipientHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "email_suppressions_release_lifecycle_check",
      sql`(${table.releasedAt} is null and ${table.releasedById} is null and ${table.releaseReason} is null) or (${table.releasedAt} is not null and ${table.releaseReason} is not null)`,
    ),
    check(
      "email_suppressions_reason_expiry_check",
      sql`(${table.reason} = 'soft_bounce' and ${table.expiresAt} is not null) or (${table.reason} in ('hard_bounce', 'complaint') and ${table.expiresAt} is null)`,
    ),
  ],
);

export const lessonAvailabilitySubscriptions = pgTable(
  "lesson_availability_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    subscribedVersionId: uuid("subscribed_version_id")
      .notNull()
      .references(() => courseVersions.id, { onDelete: "restrict" }),
    fulfilledVersionId: uuid("fulfilled_version_id").references(
      () => courseVersions.id,
      { onDelete: "restrict" },
    ),
    notificationId: uuid("notification_id").references(() => notifications.id, {
      onDelete: "restrict",
    }),
    emailDeliveryId: uuid("email_delivery_id").references(
      () => emailDeliveries.id,
      { onDelete: "restrict" },
    ),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "lesson_availability_subscriptions_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_availability_subscriptions_course_tenant_fk",
      columns: [table.courseId, table.organizationId],
      foreignColumns: [courses.id, courses.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_availability_subscriptions_lesson_tenant_fk",
      columns: [table.lessonId, table.organizationId],
      foreignColumns: [lessons.id, lessons.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "lesson_availability_subscriptions_subscribed_version_scope_fk",
      columns: [
        table.subscribedVersionId,
        table.courseId,
        table.organizationId,
      ],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "lesson_availability_subscriptions_fulfilled_version_scope_fk",
      columns: [table.fulfilledVersionId, table.courseId, table.organizationId],
      foreignColumns: [
        courseVersions.id,
        courseVersions.courseId,
        courseVersions.organizationId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "lesson_availability_subscriptions_notification_recipient_fk",
      columns: [table.notificationId, table.userId],
      foreignColumns: [notifications.id, notifications.userId],
    }).onDelete("restrict"),
    foreignKey({
      name: "lesson_availability_subscriptions_delivery_recipient_fk",
      columns: [table.emailDeliveryId, table.userId, table.organizationId],
      foreignColumns: [
        emailDeliveries.id,
        emailDeliveries.userId,
        emailDeliveries.organizationId,
      ],
    }).onDelete("restrict"),
    uniqueIndex("lesson_availability_subscriptions_active_idx")
      .on(table.organizationId, table.userId, table.courseId, table.lessonId)
      .where(
        sql`${table.cancelledAt} is null and ${table.fulfilledAt} is null`,
      ),
    uniqueIndex("lesson_availability_subscriptions_notification_idx")
      .on(table.notificationId)
      .where(sql`${table.notificationId} is not null`),
    uniqueIndex("lesson_availability_subscriptions_delivery_idx")
      .on(table.emailDeliveryId)
      .where(sql`${table.emailDeliveryId} is not null`),
    index("lesson_availability_subscriptions_course_active_idx").on(
      table.organizationId,
      table.courseId,
      table.cancelledAt,
      table.fulfilledAt,
    ),
    index("lesson_availability_subscriptions_user_created_idx").on(
      table.organizationId,
      table.userId,
      table.subscribedAt,
    ),
    check(
      "lesson_availability_subscriptions_lifecycle_check",
      sql`(
        ${table.cancelledAt} is null or ${table.fulfilledAt} is null
      ) and (
        (
          ${table.fulfilledAt} is null
          and ${table.fulfilledVersionId} is null
          and ${table.notificationId} is null
          and ${table.emailDeliveryId} is null
        ) or (
          ${table.fulfilledAt} is not null
          and ${table.fulfilledVersionId} is not null
          and ${table.notificationId} is not null
        )
      )`,
    ),
    check(
      "lesson_availability_subscriptions_timestamps_check",
      sql`${table.cancelledAt} is null or ${table.cancelledAt} >= ${table.subscribedAt}`,
    ),
    check(
      "lesson_availability_subscriptions_fulfilled_at_check",
      sql`${table.fulfilledAt} is null or ${table.fulfilledAt} >= ${table.subscribedAt}`,
    ),
  ],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    url: text("url").notNull(),
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    events: text("events").array().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("webhooks_id_org_idx").on(table.id, table.organizationId),
    index("webhooks_org_active_idx").on(table.organizationId, table.active),
  ],
);

export const automationWorkflowConnections = pgTable(
  "automation_workflow_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 24 }).default("n8n").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    webhookId: uuid("webhook_id").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "automation_workflows_webhook_tenant_fk",
      columns: [table.webhookId, table.organizationId],
      foreignColumns: [webhooks.id, webhooks.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("automation_workflows_org_provider_name_idx").on(
      table.organizationId,
      table.provider,
      table.name,
    ),
    uniqueIndex("automation_workflows_webhook_idx").on(table.webhookId),
    index("automation_workflows_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    check(
      "automation_workflows_provider_check",
      sql`${table.provider} = 'n8n'`,
    ),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: varchar("event", { length: 120 }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    status: webhookDeliveryStatusEnum("status").default("pending").notNull(),
    attempt: integer("attempt").default(0).notNull(),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    durationMs: integer("duration_ms"),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: uuid("claim_token"),
    replayGeneration: integer("replay_generation").default(0).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_id_organization_idx").on(
      table.id,
      table.organizationId,
    ),
    index("webhook_deliveries_webhook_created_idx").on(
      table.webhookId,
      table.createdAt,
    ),
    index("webhook_deliveries_status_retry_idx").on(
      table.status,
      table.nextRetryAt,
    ),
    index("webhook_deliveries_processing_claim_idx").on(
      table.status,
      table.claimedAt,
    ),
    index("webhook_deliveries_status_updated_idx").on(
      table.status,
      table.updatedAt,
    ),
    check(
      "webhook_deliveries_claim_state_check",
      sql`(${table.status} = 'processing' and ${table.claimedAt} is not null and ${table.claimToken} is not null) or (${table.status} <> 'processing' and ${table.claimedAt} is null and ${table.claimToken} is null)`,
    ),
    check(
      "webhook_deliveries_replay_generation_check",
      sql`${table.replayGeneration} >= 0`,
    ),
  ],
);

export const webhookDeliveryAttempts = pgTable(
  "webhook_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    deliveryId: uuid("delivery_id").notNull(),
    webhookId: uuid("webhook_id").notNull(),
    replayGeneration: integer("replay_generation").notNull(),
    attempt: integer("attempt").notNull(),
    outcome: varchar("outcome", { length: 20 })
      .$type<"delivered" | "retrying" | "failed">()
      .notNull(),
    responseStatus: integer("response_status"),
    failureKind: varchar("failure_kind", { length: 24 }).$type<
      | "http"
      | "timeout"
      | "dns"
      | "tls"
      | "connection"
      | "configuration"
      | "unknown"
      | null
    >(),
    responseBodyRedacted: boolean("response_body_redacted")
      .default(false)
      .notNull(),
    durationMs: integer("duration_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "webhook_delivery_attempts_delivery_tenant_fk",
      columns: [table.deliveryId, table.organizationId],
      foreignColumns: [webhookDeliveries.id, webhookDeliveries.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "webhook_delivery_attempts_webhook_tenant_fk",
      columns: [table.webhookId, table.organizationId],
      foreignColumns: [webhooks.id, webhooks.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("webhook_delivery_attempts_delivery_generation_attempt_idx").on(
      table.deliveryId,
      table.replayGeneration,
      table.attempt,
    ),
    index("webhook_delivery_attempts_org_completed_idx").on(
      table.organizationId,
      table.completedAt,
      table.id,
    ),
    index("webhook_delivery_attempts_delivery_completed_idx").on(
      table.deliveryId,
      table.completedAt,
      table.id,
    ),
    check(
      "webhook_delivery_attempts_position_check",
      sql`${table.replayGeneration} >= 0 and ${table.attempt} >= 1`,
    ),
    check(
      "webhook_delivery_attempts_outcome_check",
      sql`${table.outcome} in ('delivered', 'retrying', 'failed')`,
    ),
    check(
      "webhook_delivery_attempts_response_check",
      sql`${table.responseStatus} is null or ${table.responseStatus} between 100 and 599`,
    ),
    check(
      "webhook_delivery_attempts_failure_check",
      sql`(${table.outcome} = 'delivered' and ${table.failureKind} is null) or (${table.outcome} <> 'delivered' and ${table.failureKind} in ('http', 'timeout', 'dns', 'tls', 'connection', 'configuration', 'unknown'))`,
    ),
    check(
      "webhook_delivery_attempts_timeline_check",
      sql`${table.durationMs} >= 0 and ${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);

export const apiIdempotencyKeys = pgTable(
  "api_idempotency_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    key: varchar("key", { length: 180 }).notNull(),
    method: varchar("method", { length: 12 }).notNull(),
    path: text("path").notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).default("processing").notNull(),
    claimToken: uuid("claim_token").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<
      | {
          v: 1;
          alg: "A256GCM";
          iv: string;
          tag: string;
          ciphertext: string;
        }
      | {
          v: 2;
          alg: "A256GCM";
          kid: string;
          iv: string;
          tag: string;
          ciphertext: string;
        }
    >(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("api_idempotency_org_api_key_key_idx").on(
      table.organizationId,
      table.apiKeyId,
      table.key,
    ),
    index("api_idempotency_expiry_idx").on(table.expiresAt),
    check(
      "api_idempotency_status_check",
      sql`${table.status} in ('processing', 'completed')`,
    ),
    check(
      "api_idempotency_response_state_check",
      sql`(${table.status} = 'processing' and ${table.responseStatus} is null and ${table.responseBody} is null) or (${table.status} = 'completed' and ${table.responseStatus} is not null and ${table.responseBody} is not null)`,
    ),
  ],
);

export const apiAuditLogs = pgTable(
  "api_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, {
      onDelete: "set null",
    }),
    requestId: uuid("request_id").notNull(),
    method: varchar("method", { length: 12 }).notNull(),
    path: text("path").notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }),
    resourceId: varchar("resource_id", { length: 180 }),
    responseStatus: integer("response_status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("api_audit_logs_org_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("api_audit_logs_request_idx").on(table.requestId),
  ],
);

export const orbitAccounts = pgTable(
  "orbit_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 160 }).notNull(),
    status: varchar("status", { length: 20 })
      .$type<"active" | "suspended">()
      .default("active")
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_accounts_email_lower_idx").on(sql`lower(${table.email})`),
    check("orbit_accounts_email_normalized_check", sql`${table.email} = lower(btrim(${table.email}))`),
    check("orbit_accounts_email_nonempty_check", sql`btrim(${table.email}) <> ''`),
    check("orbit_accounts_name_nonempty_check", sql`btrim(${table.displayName}) <> ''`),
    check("orbit_accounts_status_check", sql`${table.status} in ('active', 'suspended')`),
    check("orbit_accounts_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitAccountIdentities = pgTable(
  "orbit_account_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => orbitAccounts.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "orbit_account_identities_user_tenant_fk",
      columns: [table.userId, table.organizationId],
      foreignColumns: [users.id, users.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("orbit_account_identities_account_org_idx").on(
      table.accountId,
      table.organizationId,
    ),
    uniqueIndex("orbit_account_identities_user_org_idx").on(
      table.userId,
      table.organizationId,
    ),
    index("orbit_account_identities_account_active_idx").on(
      table.accountId,
      table.revokedAt,
    ),
    check(
      "orbit_account_identities_revoke_timeline_check",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.verifiedAt}`,
    ),
  ],
);

export const orbitWorkspaces = pgTable(
  "orbit_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    instanceSlotLimit: integer("instance_slot_limit").default(1).notNull(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_workspaces_slug_idx").on(table.slug),
    check("orbit_workspaces_name_nonempty_check", sql`btrim(${table.name}) <> ''`),
    check(
      "orbit_workspaces_slug_check",
      sql`${table.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'`,
    ),
    check(
      "orbit_workspaces_instance_slot_limit_check",
      sql`${table.instanceSlotLimit} between 1 and 10000`,
    ),
    check("orbit_workspaces_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitBillingAccounts = pgTable(
  "orbit_billing_accounts",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => orbitWorkspaces.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 })
      .$type<"active" | "past_due" | "suspended">()
      .default("active")
      .notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR").notNull(),
    billingInterval: varchar("billing_interval", { length: 16 })
      .$type<"monthly" | "annual">()
      .default("monthly")
      .notNull(),
    baseFeeCents: bigint("base_fee_cents", { mode: "number" })
      .default(0)
      .notNull(),
    includedInstanceSlots: integer("included_instance_slots")
      .default(1)
      .notNull(),
    additionalInstanceFeeCents: bigint("additional_instance_fee_cents", {
      mode: "number",
    })
      .default(0)
      .notNull(),
    settlementMode: varchar("settlement_mode", { length: 20 })
      .$type<"manual" | "external">()
      .default("manual")
      .notNull(),
    externalCustomerReference: varchar("external_customer_reference", {
      length: 180,
    }),
    revision: integer("revision").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "orbit_billing_accounts_status_check",
      sql`${table.status} in ('active', 'past_due', 'suspended')`,
    ),
    check(
      "orbit_billing_accounts_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "orbit_billing_accounts_interval_check",
      sql`${table.billingInterval} in ('monthly', 'annual')`,
    ),
    check(
      "orbit_billing_accounts_amounts_check",
      sql`${table.baseFeeCents} between 0 and 100000000000 and ${table.additionalInstanceFeeCents} between 0 and 100000000000`,
    ),
    check(
      "orbit_billing_accounts_included_slots_check",
      sql`${table.includedInstanceSlots} between 0 and 10000`,
    ),
    check(
      "orbit_billing_accounts_settlement_check",
      sql`(${table.settlementMode} = 'manual' and ${table.externalCustomerReference} is null) or (${table.settlementMode} = 'external' and btrim(${table.externalCustomerReference}) <> '')`,
    ),
    check(
      "orbit_billing_accounts_revision_check",
      sql`${table.revision} between 1 and 2147483647`,
    ),
    check(
      "orbit_billing_accounts_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const orbitBillingPriceVersions = pgTable(
  "orbit_billing_price_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "restrict" }),
    revision: integer("revision").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    baseFeeCents: bigint("base_fee_cents", { mode: "number" }).notNull(),
    includedInstanceSlots: integer("included_instance_slots").notNull(),
    additionalInstanceFeeCents: bigint("additional_instance_fee_cents", {
      mode: "number",
    }).notNull(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_billing_price_versions_workspace_revision_idx").on(
      table.workspaceId,
      table.revision,
    ),
    index("orbit_billing_price_versions_workspace_effective_idx").on(
      table.workspaceId,
      table.effectiveFrom,
      table.revision,
    ),
    check(
      "orbit_billing_price_versions_revision_check",
      sql`${table.revision} between 1 and 2147483647`,
    ),
    check(
      "orbit_billing_price_versions_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "orbit_billing_price_versions_amounts_check",
      sql`${table.baseFeeCents} between 0 and 100000000000 and ${table.additionalInstanceFeeCents} between 0 and 100000000000`,
    ),
    check(
      "orbit_billing_price_versions_included_slots_check",
      sql`${table.includedInstanceSlots} between 0 and 10000`,
    ),
    check(
      "orbit_billing_price_versions_timeline_check",
      sql`${table.effectiveFrom} <= ${table.createdAt} + interval '366 days'`,
    ),
  ],
);

export const orbitBillingStatements = pgTable(
  "orbit_billing_statements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "restrict" }),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    instanceCount: integer("instance_count").notNull(),
    includedInstanceSlots: integer("included_instance_slots").notNull(),
    additionalInstanceCount: integer("additional_instance_count").notNull(),
    baseFeeCents: bigint("base_fee_cents", { mode: "number" }).notNull(),
    additionalInstanceFeeCents: bigint("additional_instance_fee_cents", {
      mode: "number",
    }).notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    pricingRevision: integer("pricing_revision").notNull(),
    finalizedByAccountId: uuid("finalized_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    finalizedAt: timestamp("finalized_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_billing_statements_workspace_period_idx").on(
      table.workspaceId,
      table.periodStart,
      table.periodEnd,
    ),
    index("orbit_billing_statements_workspace_finalized_idx").on(
      table.workspaceId,
      table.finalizedAt,
    ),
    check(
      "orbit_billing_statements_period_check",
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
    check(
      "orbit_billing_statements_counts_check",
      sql`${table.instanceCount} between 0 and 10000 and ${table.includedInstanceSlots} between 0 and 10000 and ${table.additionalInstanceCount} = greatest(${table.instanceCount} - ${table.includedInstanceSlots}, 0)`,
    ),
    check(
      "orbit_billing_statements_amounts_check",
      sql`${table.baseFeeCents} between 0 and 100000000000 and ${table.additionalInstanceFeeCents} between 0 and 100000000000 and ${table.subtotalCents} = ${table.baseFeeCents} + (${table.additionalInstanceCount}::bigint * ${table.additionalInstanceFeeCents})`,
    ),
    check(
      "orbit_billing_statements_currency_check",
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "orbit_billing_statements_revision_check",
      sql`${table.pricingRevision} between 1 and 2147483647`,
    ),
    check(
      "orbit_billing_statements_timeline_check",
      sql`${table.finalizedAt} >= ${table.periodEnd} and ${table.createdAt} >= ${table.finalizedAt}`,
    ),
  ],
);

export const orbitPermissionSets = pgTable(
  "orbit_permission_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    permissions: text("permissions").array().default([]).notNull(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_permission_sets_workspace_name_lower_idx").on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
    uniqueIndex("orbit_permission_sets_id_workspace_idx").on(
      table.id,
      table.workspaceId,
    ),
    check("orbit_permission_sets_name_nonempty_check", sql`btrim(${table.name}) <> ''`),
    check(
      "orbit_permission_sets_permissions_check",
      sql`${table.permissions} <@ array['instances:read','instances:manage','memberships:manage','delegations:manage','entitlements:manage','transfers:read','transfers:create','billing:read','billing:manage','audit:read']::text[] and cardinality(${table.permissions}) <= 10`,
    ),
    check("orbit_permission_sets_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitWorkspaceMemberships = pgTable(
  "orbit_workspace_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => orbitAccounts.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 24 })
      .$type<"owner" | "administrator" | "operator" | "auditor" | "partner">()
      .notNull(),
    permissionSetId: uuid("permission_set_id"),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "orbit_workspace_memberships_permission_set_fk",
      columns: [table.permissionSetId, table.workspaceId],
      foreignColumns: [orbitPermissionSets.id, orbitPermissionSets.workspaceId],
    }).onDelete("restrict"),
    uniqueIndex("orbit_workspace_memberships_workspace_account_idx").on(
      table.workspaceId,
      table.accountId,
    ),
    uniqueIndex("orbit_workspace_memberships_id_workspace_idx").on(
      table.id,
      table.workspaceId,
    ),
    index("orbit_workspace_memberships_account_idx").on(table.accountId),
    check(
      "orbit_workspace_memberships_role_check",
      sql`${table.role} in ('owner', 'administrator', 'operator', 'auditor', 'partner')`,
    ),
    check("orbit_workspace_memberships_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitInstances = pgTable(
  "orbit_instances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    customerReference: varchar("customer_reference", { length: 120 }),
    status: varchar("status", { length: 20 })
      .$type<"active" | "suspended">()
      .default("active")
      .notNull(),
    seatLimit: integer("seat_limit").default(100).notNull(),
    courseLimit: integer("course_limit").default(100).notNull(),
    entitlements: text("entitlements").array().default(["content_transfer"]).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_instances_organization_idx").on(table.organizationId),
    uniqueIndex("orbit_instances_workspace_org_idx").on(
      table.workspaceId,
      table.organizationId,
    ),
    index("orbit_instances_workspace_status_idx").on(table.workspaceId, table.status),
    check("orbit_instances_status_check", sql`${table.status} in ('active', 'suspended')`),
    check("orbit_instances_seat_limit_check", sql`${table.seatLimit} between 1 and 1000000`),
    check("orbit_instances_course_limit_check", sql`${table.courseLimit} between 1 and 1000000`),
    check(
      "orbit_instances_entitlements_check",
      sql`${table.entitlements} <@ array['content_transfer','partner_access','advanced_audit','api_access','custom_branding','ai_features']::text[] and cardinality(${table.entitlements}) <= 6`,
    ),
    check("orbit_instances_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitInstanceClaims = pgTable(
  "orbit_instance_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    tokenPrefix: varchar("token_prefix", { length: 12 }).notNull(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedOrganizationId: uuid("consumed_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_instance_claims_token_hash_idx").on(table.tokenHash),
    index("orbit_instance_claims_workspace_expiry_idx").on(
      table.workspaceId,
      table.expiresAt,
    ),
    check("orbit_instance_claims_hash_check", sql`${table.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check(
      "orbit_instance_claims_state_check",
      sql`(${table.consumedAt} is null and ${table.consumedOrganizationId} is null) or ${table.consumedAt} is not null`,
    ),
    check("orbit_instance_claims_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const orbitPartnerDelegations = pgTable(
  "orbit_partner_delegations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    partnerAccountId: uuid("partner_account_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    permissions: text("permissions").array().default([]).notNull(),
    createdByAccountId: uuid("created_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "orbit_partner_delegations_membership_fk",
      columns: [table.workspaceId, table.partnerAccountId],
      foreignColumns: [
        orbitWorkspaceMemberships.workspaceId,
        orbitWorkspaceMemberships.accountId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "orbit_partner_delegations_instance_fk",
      columns: [table.workspaceId, table.organizationId],
      foreignColumns: [orbitInstances.workspaceId, orbitInstances.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("orbit_partner_delegations_scope_idx").on(
      table.workspaceId,
      table.partnerAccountId,
      table.organizationId,
    ),
    index("orbit_partner_delegations_account_active_idx").on(
      table.partnerAccountId,
      table.revokedAt,
      table.expiresAt,
    ),
    check(
      "orbit_partner_delegations_permissions_check",
      sql`${table.permissions} <@ array['instances:read','transfers:read','transfers:create','audit:read']::text[] and cardinality(${table.permissions}) between 1 and 4`,
    ),
    check(
      "orbit_partner_delegations_timeline_check",
      sql`${table.updatedAt} >= ${table.createdAt} and (${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}) and (${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt})`,
    ),
  ],
);

export type OrbitTransferPreflight = {
  sourceCourseCount: number;
  targetCourseCount: number;
  targetCourseLimit: number;
  mediaAssetCount: number;
  mediaBytes: number;
  warnings: string[];
  authorMappings?: Array<{
    sourceUserId: string;
    targetUserId: string;
  }>;
};

export const orbitTransferJobs = pgTable(
  "orbit_transfer_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "restrict" }),
    sourceOrganizationId: uuid("source_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    targetOrganizationId: uuid("target_organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    sourceCourseIds: uuid("source_course_ids").array().notNull(),
    targetCourseIds: uuid("target_course_ids").array().default([]).notNull(),
    requestedByAccountId: uuid("requested_by_account_id").references(
      () => orbitAccounts.id,
      { onDelete: "set null" },
    ),
    idempotencyKey: varchar("idempotency_key", { length: 180 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 })
      .$type<"planned" | "processing" | "completed" | "failed">()
      .default("planned")
      .notNull(),
    preflight: jsonb("preflight").$type<OrbitTransferPreflight>().notNull(),
    failureCode: varchar("failure_code", { length: 80 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "orbit_transfer_jobs_source_instance_fk",
      columns: [table.workspaceId, table.sourceOrganizationId],
      foreignColumns: [orbitInstances.workspaceId, orbitInstances.organizationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "orbit_transfer_jobs_target_instance_fk",
      columns: [table.workspaceId, table.targetOrganizationId],
      foreignColumns: [orbitInstances.workspaceId, orbitInstances.organizationId],
    }).onDelete("restrict"),
    uniqueIndex("orbit_transfer_jobs_idempotency_idx").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("orbit_transfer_jobs_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check("orbit_transfer_jobs_request_hash_check", sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`),
    check("orbit_transfer_jobs_courses_check", sql`cardinality(${table.sourceCourseIds}) between 1 and 25`),
    check("orbit_transfer_jobs_distinct_tenants_check", sql`${table.sourceOrganizationId} <> ${table.targetOrganizationId}`),
    check(
      "orbit_transfer_jobs_status_check",
      sql`${table.status} in ('planned', 'processing', 'completed', 'failed')`,
    ),
    check(
      "orbit_transfer_jobs_state_check",
      sql`(${table.status} = 'planned' and ${table.startedAt} is null and ${table.completedAt} is null and ${table.failureCode} is null and cardinality(${table.targetCourseIds}) = 0) or (${table.status} = 'processing' and ${table.startedAt} is not null and ${table.completedAt} is null and ${table.failureCode} is null) or (${table.status} = 'completed' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.failureCode} is null and cardinality(${table.targetCourseIds}) = cardinality(${table.sourceCourseIds})) or (${table.status} = 'failed' and ${table.startedAt} is not null and ${table.completedAt} is not null and ${table.failureCode} is not null)`,
    ),
    check("orbit_transfer_jobs_timeline_check", sql`${table.updatedAt} >= ${table.createdAt}`),
  ],
);

export const orbitTransferItems = pgTable(
  "orbit_transfer_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => orbitTransferJobs.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 })
      .$type<"course" | "version" | "media_asset">()
      .notNull(),
    sourceId: uuid("source_id").notNull(),
    targetId: uuid("target_id").notNull(),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("orbit_transfer_items_job_kind_source_idx").on(
      table.jobId,
      table.kind,
      table.sourceId,
    ),
    uniqueIndex("orbit_transfer_items_job_kind_target_idx").on(
      table.jobId,
      table.kind,
      table.targetId,
    ),
    check("orbit_transfer_items_kind_check", sql`${table.kind} in ('course', 'version', 'media_asset')`),
    check("orbit_transfer_items_checksum_check", sql`${table.checksum} ~ '^[0-9a-f]{64}$'`),
    check("orbit_transfer_items_identity_check", sql`${table.sourceId} <> ${table.targetId}`),
  ],
);

export const orbitAuditEvents = pgTable(
  "orbit_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => orbitWorkspaces.id, { onDelete: "restrict" }),
    actorAccountId: uuid("actor_account_id").references(() => orbitAccounts.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: varchar("resource_id", { length: 180 }),
    sourceOrganizationId: uuid("source_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    targetOrganizationId: uuid("target_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    outcome: varchar("outcome", { length: 20 })
      .$type<"succeeded" | "denied" | "failed">()
      .notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("orbit_audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    index("orbit_audit_events_actor_created_idx").on(
      table.actorAccountId,
      table.createdAt,
    ),
    check("orbit_audit_events_action_nonempty_check", sql`btrim(${table.action}) <> ''`),
    check("orbit_audit_events_outcome_check", sql`${table.outcome} in ('succeeded', 'denied', 'failed')`),
  ],
);

export type User = typeof users.$inferSelect;
export type OrbitAccount = typeof orbitAccounts.$inferSelect;
export type OrbitWorkspace = typeof orbitWorkspaces.$inferSelect;
export type OrbitWorkspaceMembership = typeof orbitWorkspaceMemberships.$inferSelect;
export type OrbitInstance = typeof orbitInstances.$inferSelect;
export type OrbitBillingAccount = typeof orbitBillingAccounts.$inferSelect;
export type OrbitBillingPriceVersion = typeof orbitBillingPriceVersions.$inferSelect;
export type OrbitBillingStatement = typeof orbitBillingStatements.$inferSelect;
export type OrbitTransferJob = typeof orbitTransferJobs.$inferSelect;
export type TeamRole = typeof teamRoles.$inferSelect;
export type TeamRoleAssignment = typeof teamRoleAssignments.$inferSelect;
export type OrganizationContract = typeof organizationContracts.$inferSelect;
export type UserMfaConfiguration = typeof userMfaConfigurations.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type CourseLearningGoal = typeof courseLearningGoals.$inferSelect;
export type CourseAuthor = typeof courseAuthors.$inferSelect;
export type CourseWidget = typeof courseWidgets.$inferSelect;
export type CourseVersion = typeof courseVersions.$inferSelect;
export type CourseCertificate = typeof courseCertificates.$inferSelect;
export type AssessmentAttempt = typeof assessmentAttempts.$inferSelect;
export type AssessmentAnswer = typeof assessmentAnswers.$inferSelect;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiAgentActionRequest = typeof aiAgentActionRequests.$inferSelect;
export type AiAgentMembershipProvenance =
  typeof aiAgentMembershipProvenance.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type AnnouncementInteraction =
  typeof announcementInteractions.$inferSelect;
export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export type PrivacyRequestEvent = typeof privacyRequestEvents.$inferSelect;
export type PrivacyLegalHold = typeof privacyLegalHolds.$inferSelect;
export type PrivacyExportArtifact = typeof privacyExportArtifacts.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Lesson = typeof lessons.$inferSelect;
export type LessonBookmark = typeof lessonBookmarks.$inferSelect;
export type MemberSidebarLink = typeof memberSidebarLinks.$inferSelect;
export type ModuleSection = typeof moduleSections.$inferSelect;
export type LessonPage = typeof lessonPages.$inferSelect;
export type EditorPresence = typeof editorPresences.$inferSelect;
export type StockImageSelection = typeof stockImageSelections.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type CommentReaction = typeof commentReactions.$inferSelect;
export type CommunityScoreContribution =
  typeof communityScoreContributions.$inferSelect;
export type CommunityReport = typeof communityReports.$inferSelect;
export type CommunityFollow = typeof communityFollows.$inferSelect;
export type CommunityAuthorBoost = typeof communityAuthorBoosts.$inferSelect;
export type MemberWelcomeSetting = typeof memberWelcomeSettings.$inferSelect;
export type MemberWelcomeAcknowledgement =
  typeof memberWelcomeAcknowledgements.$inferSelect;
export type OidcConfiguration = typeof oidcConfigurations.$inferSelect;
export type OidcIdentity = typeof oidcIdentities.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
