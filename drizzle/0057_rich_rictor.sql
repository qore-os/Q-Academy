CREATE TYPE "public"."ai_agent_action_target_type" AS ENUM('course', 'group', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_membership_revocation_reason" AS ENUM('ai_action', 'manual_takeover', 'manual_removal');--> statement-breakpoint
CREATE TYPE "public"."badge_group_display_mode" AS ENUM('all', 'highest');--> statement-breakpoint
CREATE TYPE "public"."media_derivative_kind" AS ENUM('thumbnail', 'transcode');--> statement-breakpoint
CREATE TYPE "public"."media_processing_job_status" AS ENUM('queued', 'processing', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."media_processing_job_type" AS ENUM('thumbnail', 'transcode', 'transcript');--> statement-breakpoint
CREATE TYPE "public"."native_push_platform" AS ENUM('ios', 'android');--> statement-breakpoint
ALTER TYPE "public"."ai_agent_action_type" ADD VALUE 'group_membership_add';--> statement-breakpoint
ALTER TYPE "public"."ai_agent_action_type" ADD VALUE 'group_membership_remove';--> statement-breakpoint
ALTER TYPE "public"."ai_agent_action_type" ADD VALUE 'bundle_assignment_add';--> statement-breakpoint
ALTER TYPE "public"."ai_agent_action_type" ADD VALUE 'bundle_assignment_remove';--> statement-breakpoint
ALTER TYPE "public"."custom_field_type" ADD VALUE 'media';--> statement-breakpoint
ALTER TYPE "public"."media_asset_purpose" ADD VALUE 'profile';--> statement-breakpoint
CREATE TABLE "ai_agent_membership_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"target_type" "ai_agent_action_target_type" NOT NULL,
	"target_group_id" uuid,
	"target_bundle_id" uuid,
	"grant_request_id" uuid NOT NULL,
	"revoked_by_request_id" uuid,
	"revocation_reason" "ai_agent_membership_revocation_reason",
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "ai_agent_membership_provenance_target_shape_check" CHECK (("ai_agent_membership_provenance"."target_type" = 'group' and "ai_agent_membership_provenance"."target_group_id" is not null and "ai_agent_membership_provenance"."target_bundle_id" is null) or ("ai_agent_membership_provenance"."target_type" = 'bundle' and "ai_agent_membership_provenance"."target_group_id" is null and "ai_agent_membership_provenance"."target_bundle_id" is not null)),
	CONSTRAINT "ai_agent_membership_provenance_revocation_state_check" CHECK (("ai_agent_membership_provenance"."revoked_at" is null and "ai_agent_membership_provenance"."revoked_by_request_id" is null and "ai_agent_membership_provenance"."revocation_reason" is null) or ("ai_agent_membership_provenance"."revoked_at" is not null and "ai_agent_membership_provenance"."revocation_reason" is not null and (("ai_agent_membership_provenance"."revocation_reason" = 'ai_action' and "ai_agent_membership_provenance"."revoked_by_request_id" is not null) or ("ai_agent_membership_provenance"."revocation_reason" <> 'ai_action' and "ai_agent_membership_provenance"."revoked_by_request_id" is null))))
);
--> statement-breakpoint
CREATE TABLE "automation_workflow_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(24) DEFAULT 'n8n' NOT NULL,
	"name" varchar(160) NOT NULL,
	"webhook_id" uuid NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_workflows_provider_check" CHECK ("automation_workflow_connections"."provider" = 'n8n')
);
--> statement-breakpoint
CREATE TABLE "badge_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"display_mode" "badge_group_display_mode" DEFAULT 'all' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badge_groups_name_check" CHECK (length(btrim("badge_groups"."name")) between 1 and 160),
	CONSTRAINT "badge_groups_description_check" CHECK (char_length("badge_groups"."description") <= 2000),
	CONSTRAINT "badge_groups_sort_order_check" CHECK ("badge_groups"."sort_order" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "commerce_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"order_id" uuid,
	"subscription_id" uuid,
	"source_key" varchar(520) NOT NULL,
	"status" varchar(24) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revocation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_entitlements_status_check" CHECK ("commerce_entitlements"."status" in ('active', 'revoked', 'expired')),
	CONSTRAINT "commerce_entitlements_window_check" CHECK ("commerce_entitlements"."ends_at" is null or "commerce_entitlements"."ends_at" > "commerce_entitlements"."starts_at"),
	CONSTRAINT "commerce_entitlements_revocation_state_check" CHECK (("commerce_entitlements"."status" = 'active' and "commerce_entitlements"."revoked_at" is null) or ("commerce_entitlements"."status" in ('revoked', 'expired') and "commerce_entitlements"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "commerce_inbound_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_event_id" varchar(240) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(24) DEFAULT 'processing' NOT NULL,
	"error_code" varchar(80),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "commerce_inbound_events_hash_check" CHECK ("commerce_inbound_events"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "commerce_inbound_events_status_check" CHECK ("commerce_inbound_events"."status" in ('processing', 'processed', 'ignored', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "commerce_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"mapping_id" uuid NOT NULL,
	"user_id" uuid,
	"external_order_id" varchar(240) NOT NULL,
	"customer_email" varchar(255) NOT NULL,
	"currency" varchar(3),
	"total_minor" integer,
	"status" varchar(32) NOT NULL,
	"ordered_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_orders_status_check" CHECK ("commerce_orders"."status" in ('pending', 'paid', 'payment_failed', 'refunded', 'cancelled')),
	CONSTRAINT "commerce_orders_currency_check" CHECK ("commerce_orders"."currency" is null or "commerce_orders"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "commerce_orders_total_minor_check" CHECK ("commerce_orders"."total_minor" is null or "commerce_orders"."total_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "commerce_outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"aggregate_type" varchar(48) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_product_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"provider_product_id" varchar(240) NOT NULL,
	"provider_variant_id" varchar(240) DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commerce_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"sku" varchar(120) NOT NULL,
	"bundle_id" uuid NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_products_sku_check" CHECK (btrim("commerce_products"."sku") <> '')
);
--> statement-breakpoint
CREATE TABLE "commerce_provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"endpoint_key" varchar(80) NOT NULL,
	"signature_mode" varchar(40) NOT NULL,
	"signing_secret_encrypted" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_create_members" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_connections_provider_check" CHECK ("commerce_provider_connections"."provider" in ('digistore24', 'ablefy', 'copecart')),
	CONSTRAINT "commerce_connections_signature_mode_check" CHECK ("commerce_provider_connections"."signature_mode" in ('hmac_sha256', 'digistore_sha512', 'shared_token'))
);
--> statement-breakpoint
CREATE TABLE "commerce_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"order_id" uuid,
	"user_id" uuid NOT NULL,
	"external_subscription_id" varchar(240) NOT NULL,
	"status" varchar(32) NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_subscriptions_status_check" CHECK ("commerce_subscriptions"."status" in ('pending', 'active', 'past_due', 'cancelled', 'expired')),
	CONSTRAINT "commerce_subscriptions_cancel_state_check" CHECK ("commerce_subscriptions"."cancel_at_period_end" = false or "commerce_subscriptions"."current_period_end" is not null)
);
--> statement-breakpoint
CREATE TABLE "editor_presences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid,
	"page_id" uuid,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editor_presences_scope_check" CHECK ("editor_presences"."page_id" is null or "editor_presences"."lesson_id" is not null),
	CONSTRAINT "editor_presences_timeline_check" CHECK ("editor_presences"."expires_at" > "editor_presences"."last_seen_at" and "editor_presences"."last_seen_at" >= "editor_presences"."created_at")
);
--> statement-breakpoint
CREATE TABLE "media_asset_derivatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"processing_job_id" uuid NOT NULL,
	"kind" "media_derivative_kind" NOT NULL,
	"storage_driver" "media_storage_driver" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" varchar(180) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"duration_milliseconds" integer,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_derivatives_size_check" CHECK ("media_asset_derivatives"."size_bytes" > 0),
	CONSTRAINT "media_asset_derivatives_digest_check" CHECK ("media_asset_derivatives"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_asset_derivatives_dimensions_check" CHECK (("media_asset_derivatives"."kind" = 'thumbnail' and "media_asset_derivatives"."width" > 0 and "media_asset_derivatives"."height" > 0 and "media_asset_derivatives"."duration_milliseconds" is null) or ("media_asset_derivatives"."kind" = 'transcode' and "media_asset_derivatives"."width" is null and "media_asset_derivatives"."height" is null and "media_asset_derivatives"."duration_milliseconds" > 0))
);
--> statement-breakpoint
CREATE TABLE "media_asset_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"processing_job_id" uuid NOT NULL,
	"source_content_sha256" varchar(64) NOT NULL,
	"language" varchar(35) NOT NULL,
	"provider" varchar(120) NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_transcripts_digest_check" CHECK ("media_asset_transcripts"."source_content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_asset_transcripts_language_check" CHECK ("media_asset_transcripts"."language" ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$')
);
--> statement-breakpoint
CREATE TABLE "media_playback_progress" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"watched_milliseconds" integer DEFAULT 0 NOT NULL,
	"furthest_milliseconds" integer DEFAULT 0 NOT NULL,
	"required_milliseconds" integer NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_playback_progress_pk" PRIMARY KEY("user_id","course_id","lesson_id","block_id"),
	CONSTRAINT "media_playback_progress_bounds_check" CHECK ("media_playback_progress"."watched_milliseconds" >= 0 and "media_playback_progress"."furthest_milliseconds" >= 0 and "media_playback_progress"."required_milliseconds" > 0 and "media_playback_progress"."watched_milliseconds" <= "media_playback_progress"."required_milliseconds"),
	CONSTRAINT "media_playback_progress_completion_check" CHECK ("media_playback_progress"."completed_at" is null or "media_playback_progress"."watched_milliseconds" >= "media_playback_progress"."required_milliseconds")
);
--> statement-breakpoint
CREATE TABLE "media_processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_asset_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"type" "media_processing_job_type" NOT NULL,
	"status" "media_processing_job_status" DEFAULT 'queued' NOT NULL,
	"request_key" varchar(64) NOT NULL,
	"source_content_sha256" varchar(64) NOT NULL,
	"provider" varchar(120) NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(80),
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_processing_jobs_source_digest_check" CHECK ("media_processing_jobs"."source_content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "media_processing_jobs_attempt_check" CHECK ("media_processing_jobs"."attempt" >= 0 and "media_processing_jobs"."max_attempts" between 1 and 10 and "media_processing_jobs"."attempt" <= "media_processing_jobs"."max_attempts"),
	CONSTRAINT "media_processing_jobs_lease_state_check" CHECK (("media_processing_jobs"."status" = 'processing' and "media_processing_jobs"."claim_token" is not null and "media_processing_jobs"."claimed_at" is not null and "media_processing_jobs"."lease_expires_at" is not null) or ("media_processing_jobs"."status" <> 'processing' and "media_processing_jobs"."claim_token" is null and "media_processing_jobs"."claimed_at" is null and "media_processing_jobs"."lease_expires_at" is null)),
	CONSTRAINT "media_processing_jobs_completion_state_check" CHECK (("media_processing_jobs"."status" = 'succeeded' and "media_processing_jobs"."completed_at" is not null and "media_processing_jobs"."result" is not null and "media_processing_jobs"."failure_code" is null) or ("media_processing_jobs"."status" = 'failed' and "media_processing_jobs"."completed_at" is not null and "media_processing_jobs"."failure_code" is not null and "media_processing_jobs"."result" is null) or ("media_processing_jobs"."status" = 'cancelled' and "media_processing_jobs"."completed_at" is not null and "media_processing_jobs"."result" is null) or ("media_processing_jobs"."status" in ('queued', 'processing') and "media_processing_jobs"."completed_at" is null and "media_processing_jobs"."result" is null))
);
--> statement-breakpoint
CREATE TABLE "native_push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"status" "push_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"next_retry_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_push_deliveries_attempt_check" CHECK ("native_push_deliveries"."attempt" between 0 and 8),
	CONSTRAINT "native_push_deliveries_response_status_check" CHECK ("native_push_deliveries"."response_status" is null or "native_push_deliveries"."response_status" between 100 and 599),
	CONSTRAINT "native_push_deliveries_response_body_check" CHECK ("native_push_deliveries"."response_body" is null or char_length("native_push_deliveries"."response_body") <= 500),
	CONSTRAINT "native_push_deliveries_state_check" CHECK (("native_push_deliveries"."status" = 'pending' and "native_push_deliveries"."claimed_at" is null and "native_push_deliveries"."next_retry_at" is null and "native_push_deliveries"."delivered_at" is null) or ("native_push_deliveries"."status" = 'processing' and "native_push_deliveries"."claimed_at" is not null and "native_push_deliveries"."next_retry_at" is null and "native_push_deliveries"."delivered_at" is null) or ("native_push_deliveries"."status" = 'retrying' and "native_push_deliveries"."claimed_at" is null and "native_push_deliveries"."next_retry_at" is not null and "native_push_deliveries"."delivered_at" is null) or ("native_push_deliveries"."status" = 'failed' and "native_push_deliveries"."claimed_at" is null and "native_push_deliveries"."next_retry_at" is null and "native_push_deliveries"."delivered_at" is null) or ("native_push_deliveries"."status" = 'delivered' and "native_push_deliveries"."claimed_at" is null and "native_push_deliveries"."next_retry_at" is null and "native_push_deliveries"."delivered_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "native_push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"platform" "native_push_platform" NOT NULL,
	"app_id" varchar(180) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_encrypted" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "native_push_devices_app_id_check" CHECK (length(btrim("native_push_devices"."app_id")) between 3 and 180),
	CONSTRAINT "native_push_devices_token_hash_check" CHECK ("native_push_devices"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "native_push_devices_encrypted_check" CHECK (jsonb_typeof("native_push_devices"."token_encrypted") = 'object' and "native_push_devices"."token_encrypted" ->> 'v' = '2' and "native_push_devices"."token_encrypted" ->> 'alg' = 'A256GCM' and btrim(coalesce("native_push_devices"."token_encrypted" ->> 'kid', '')) <> '' and btrim(coalesce("native_push_devices"."token_encrypted" ->> 'iv', '')) <> '' and btrim(coalesce("native_push_devices"."token_encrypted" ->> 'tag', '')) <> '' and btrim(coalesce("native_push_devices"."token_encrypted" ->> 'ciphertext', '')) <> ''),
	CONSTRAINT "native_push_devices_timestamps_check" CHECK ("native_push_devices"."updated_at" >= "native_push_devices"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_account_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_account_identities_revoke_timeline_check" CHECK ("orbit_account_identities"."revoked_at" is null or "orbit_account_identities"."revoked_at" >= "orbit_account_identities"."verified_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_accounts_email_normalized_check" CHECK ("orbit_accounts"."email" = lower(btrim("orbit_accounts"."email"))),
	CONSTRAINT "orbit_accounts_email_nonempty_check" CHECK (btrim("orbit_accounts"."email") <> ''),
	CONSTRAINT "orbit_accounts_name_nonempty_check" CHECK (btrim("orbit_accounts"."display_name") <> ''),
	CONSTRAINT "orbit_accounts_status_check" CHECK ("orbit_accounts"."status" in ('active', 'suspended')),
	CONSTRAINT "orbit_accounts_timeline_check" CHECK ("orbit_accounts"."updated_at" >= "orbit_accounts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_account_id" uuid,
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(180),
	"source_organization_id" uuid,
	"target_organization_id" uuid,
	"outcome" varchar(20) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_audit_events_action_nonempty_check" CHECK (btrim("orbit_audit_events"."action") <> ''),
	CONSTRAINT "orbit_audit_events_outcome_check" CHECK ("orbit_audit_events"."outcome" in ('succeeded', 'denied', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "orbit_instance_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(12) NOT NULL,
	"created_by_account_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_instance_claims_hash_check" CHECK ("orbit_instance_claims"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orbit_instance_claims_state_check" CHECK (("orbit_instance_claims"."consumed_at" is null and "orbit_instance_claims"."consumed_organization_id" is null) or "orbit_instance_claims"."consumed_at" is not null),
	CONSTRAINT "orbit_instance_claims_expiry_check" CHECK ("orbit_instance_claims"."expires_at" > "orbit_instance_claims"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"customer_reference" varchar(120),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"seat_limit" integer DEFAULT 100 NOT NULL,
	"course_limit" integer DEFAULT 100 NOT NULL,
	"entitlements" text[] DEFAULT '{"content_transfer"}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_instances_status_check" CHECK ("orbit_instances"."status" in ('active', 'suspended')),
	CONSTRAINT "orbit_instances_seat_limit_check" CHECK ("orbit_instances"."seat_limit" between 1 and 1000000),
	CONSTRAINT "orbit_instances_course_limit_check" CHECK ("orbit_instances"."course_limit" between 1 and 1000000),
	CONSTRAINT "orbit_instances_entitlements_check" CHECK ("orbit_instances"."entitlements" <@ array['content_transfer','partner_access','advanced_audit','api_access','custom_branding','ai_features']::text[] and cardinality("orbit_instances"."entitlements") <= 6),
	CONSTRAINT "orbit_instances_timeline_check" CHECK ("orbit_instances"."updated_at" >= "orbit_instances"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_partner_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"partner_account_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_by_account_id" uuid,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_partner_delegations_permissions_check" CHECK ("orbit_partner_delegations"."permissions" <@ array['instances:read','transfers:read','transfers:create','audit:read']::text[] and cardinality("orbit_partner_delegations"."permissions") between 1 and 4),
	CONSTRAINT "orbit_partner_delegations_timeline_check" CHECK ("orbit_partner_delegations"."updated_at" >= "orbit_partner_delegations"."created_at" and ("orbit_partner_delegations"."expires_at" is null or "orbit_partner_delegations"."expires_at" > "orbit_partner_delegations"."created_at") and ("orbit_partner_delegations"."revoked_at" is null or "orbit_partner_delegations"."revoked_at" >= "orbit_partner_delegations"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "orbit_permission_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500),
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_permission_sets_name_nonempty_check" CHECK (btrim("orbit_permission_sets"."name") <> ''),
	CONSTRAINT "orbit_permission_sets_permissions_check" CHECK ("orbit_permission_sets"."permissions" <@ array['instances:read','instances:manage','memberships:manage','delegations:manage','entitlements:manage','transfers:read','transfers:create','audit:read']::text[] and cardinality("orbit_permission_sets"."permissions") <= 8),
	CONSTRAINT "orbit_permission_sets_timeline_check" CHECK ("orbit_permission_sets"."updated_at" >= "orbit_permission_sets"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_transfer_items_kind_check" CHECK ("orbit_transfer_items"."kind" in ('course', 'version', 'media_asset')),
	CONSTRAINT "orbit_transfer_items_checksum_check" CHECK ("orbit_transfer_items"."checksum" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orbit_transfer_items_identity_check" CHECK ("orbit_transfer_items"."source_id" <> "orbit_transfer_items"."target_id")
);
--> statement-breakpoint
CREATE TABLE "orbit_transfer_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_organization_id" uuid NOT NULL,
	"target_organization_id" uuid NOT NULL,
	"source_course_ids" uuid[] NOT NULL,
	"target_course_ids" uuid[] DEFAULT '{}' NOT NULL,
	"requested_by_account_id" uuid,
	"idempotency_key" varchar(180) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'planned' NOT NULL,
	"preflight" jsonb NOT NULL,
	"failure_code" varchar(80),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_transfer_jobs_request_hash_check" CHECK ("orbit_transfer_jobs"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "orbit_transfer_jobs_courses_check" CHECK (cardinality("orbit_transfer_jobs"."source_course_ids") between 1 and 25),
	CONSTRAINT "orbit_transfer_jobs_distinct_tenants_check" CHECK ("orbit_transfer_jobs"."source_organization_id" <> "orbit_transfer_jobs"."target_organization_id"),
	CONSTRAINT "orbit_transfer_jobs_status_check" CHECK ("orbit_transfer_jobs"."status" in ('planned', 'processing', 'completed', 'failed')),
	CONSTRAINT "orbit_transfer_jobs_state_check" CHECK (("orbit_transfer_jobs"."status" = 'planned' and "orbit_transfer_jobs"."started_at" is null and "orbit_transfer_jobs"."completed_at" is null and "orbit_transfer_jobs"."failure_code" is null and cardinality("orbit_transfer_jobs"."target_course_ids") = 0) or ("orbit_transfer_jobs"."status" = 'processing' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."completed_at" is null and "orbit_transfer_jobs"."failure_code" is null) or ("orbit_transfer_jobs"."status" = 'completed' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."completed_at" is not null and "orbit_transfer_jobs"."failure_code" is null and cardinality("orbit_transfer_jobs"."target_course_ids") = cardinality("orbit_transfer_jobs"."source_course_ids")) or ("orbit_transfer_jobs"."status" = 'failed' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."completed_at" is not null and "orbit_transfer_jobs"."failure_code" is not null)),
	CONSTRAINT "orbit_transfer_jobs_timeline_check" CHECK ("orbit_transfer_jobs"."updated_at" >= "orbit_transfer_jobs"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_workspace_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" varchar(24) NOT NULL,
	"permission_set_id" uuid,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_workspace_memberships_role_check" CHECK ("orbit_workspace_memberships"."role" in ('owner', 'administrator', 'operator', 'auditor', 'partner')),
	CONSTRAINT "orbit_workspace_memberships_timeline_check" CHECK ("orbit_workspace_memberships"."updated_at" >= "orbit_workspace_memberships"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"instance_slot_limit" integer DEFAULT 1 NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_workspaces_name_nonempty_check" CHECK (btrim("orbit_workspaces"."name") <> ''),
	CONSTRAINT "orbit_workspaces_slug_check" CHECK ("orbit_workspaces"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$'),
	CONSTRAINT "orbit_workspaces_instance_slot_limit_check" CHECK ("orbit_workspaces"."instance_slot_limit" between 1 and 10000),
	CONSTRAINT "orbit_workspaces_timeline_check" CHECK ("orbit_workspaces"."updated_at" >= "orbit_workspaces"."created_at")
);
--> statement-breakpoint
CREATE TABLE "organization_support_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" varchar(24) DEFAULT 'link' NOT NULL,
	"launcher_label" varchar(80) DEFAULT 'Support' NOT NULL,
	"support_url" text,
	"support_email" varchar(255),
	"intercom_app_id" varchar(120),
	"identity_secret_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_support_settings_provider_check" CHECK ("organization_support_settings"."provider" in ('link', 'email', 'intercom')),
	CONSTRAINT "organization_support_settings_configuration_check" CHECK ("organization_support_settings"."enabled" = false or ("organization_support_settings"."provider" = 'link' and "organization_support_settings"."support_url" is not null) or ("organization_support_settings"."provider" = 'email' and "organization_support_settings"."support_email" is not null) or ("organization_support_settings"."provider" = 'intercom' and "organization_support_settings"."intercom_app_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "stock_image_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"selected_by_id" uuid,
	"provider" varchar(80) NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"image_url" text NOT NULL,
	"preview_url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"alt_text" varchar(500),
	"author" varchar(200) NOT NULL,
	"author_url" text,
	"source_url" text NOT NULL,
	"attribution" varchar(500) NOT NULL,
	"download_tracked_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_image_selections_dimensions_check" CHECK ("stock_image_selections"."width" > 0 and "stock_image_selections"."width" <= 50000 and "stock_image_selections"."height" > 0 and "stock_image_selections"."height" <= 50000),
	CONSTRAINT "stock_image_selections_https_check" CHECK ("stock_image_selections"."image_url" ~ '^https://' and "stock_image_selections"."preview_url" ~ '^https://' and "stock_image_selections"."source_url" ~ '^https://' and ("stock_image_selections"."author_url" is null or "stock_image_selections"."author_url" ~ '^https://')),
	CONSTRAINT "stock_image_selections_timeline_check" CHECK ("stock_image_selections"."download_tracked_at" >= "stock_image_selections"."created_at" and "stock_image_selections"."expires_at" > "stock_image_selections"."created_at" and ("stock_image_selections"."used_at" is null or "stock_image_selections"."used_at" >= "stock_image_selections"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "team_role_assignments" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_by_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_role_assignments_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "team_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(500),
	"color" varchar(7) DEFAULT '#2b9188' NOT NULL,
	"permissions" text[] DEFAULT '{}' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_roles_name_check" CHECK (btrim("team_roles"."name") <> ''),
	CONSTRAINT "team_roles_color_check" CHECK ("team_roles"."color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "team_roles_permissions_check" CHECK ("team_roles"."permissions" <@ array['members.view','members.manage','courses.view','courses.manage','community.view','community.manage','events.view','events.manage','analytics.view','settings.view','settings.manage','integrations.view','integrations.manage','api.view','api.manage','ai.view','ai.manage']::text[] and cardinality("team_roles"."permissions") <= 17),
	CONSTRAINT "team_roles_revision_check" CHECK ("team_roles"."revision" >= 1),
	CONSTRAINT "team_roles_timeline_check" CHECK ("team_roles"."updated_at" >= "team_roles"."created_at")
);
--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" DROP CONSTRAINT "ai_agent_version_sources_shape_check";--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" DROP CONSTRAINT "ai_agent_action_requests_configuration_tenant_fk";
--> statement-breakpoint
DROP INDEX "ai_agent_version_actions_version_course_idx";--> statement-breakpoint
DROP INDEX "ai_agent_version_actions_request_target_idx";--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ALTER COLUMN "target_course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ALTER COLUMN "course_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD COLUMN "target_type" "ai_agent_action_target_type";--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD COLUMN "target_group_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD COLUMN "target_bundle_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD COLUMN "target_type" "ai_agent_action_target_type";--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD COLUMN "bundle_id" uuid;--> statement-breakpoint
UPDATE "ai_agent_version_actions"
SET "target_type" = 'course'
WHERE "target_type" IS NULL
  AND "course_id" IS NOT NULL
  AND "action_type"::text IN ('course_enrollment', 'course_unenrollment');--> statement-breakpoint
UPDATE "ai_agent_action_requests"
SET "target_type" = 'course'
WHERE "target_type" IS NULL
  AND "target_course_id" IS NOT NULL
  AND "action_type"::text IN ('course_enrollment', 'course_unenrollment');--> statement-breakpoint
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_agent_version_actions"
    WHERE "target_type" IS DISTINCT FROM 'course'
      OR "course_id" IS NULL
      OR "group_id" IS NOT NULL
      OR "bundle_id" IS NOT NULL
      OR "action_type"::text NOT IN ('course_enrollment', 'course_unenrollment')
  ) THEN
    RAISE EXCEPTION '0057 cannot safely classify legacy AI action configurations';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_agent_action_requests"
    WHERE "target_type" IS DISTINCT FROM 'course'
      OR "target_course_id" IS NULL
      OR "target_group_id" IS NOT NULL
      OR "target_bundle_id" IS NOT NULL
      OR "action_type"::text NOT IN ('course_enrollment', 'course_unenrollment')
  ) THEN
    RAISE EXCEPTION '0057 cannot safely classify legacy AI action requests';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "ai_agent_action_requests" request
    JOIN "ai_agent_version_actions" configuration
      ON configuration."id" = request."action_configuration_id"
     AND configuration."organization_id" = request."organization_id"
     AND configuration."agent_version_id" = request."agent_version_id"
     AND configuration."action_type" = request."action_type"
    WHERE request."target_type" IS DISTINCT FROM configuration."target_type"
      OR request."target_course_id" IS DISTINCT FROM configuration."course_id"
      OR request."target_group_id" IS DISTINCT FROM configuration."group_id"
      OR request."target_bundle_id" IS DISTINCT FROM configuration."bundle_id"
  ) THEN
    RAISE EXCEPTION '0057 found an AI action request whose target differs from its configuration';
  END IF;
END;
$migration$;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ALTER COLUMN "target_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ALTER COLUMN "target_type" SET NOT NULL;--> statement-breakpoint
UPDATE "ai_agent_version_sources"
SET "source_type" = 'manual_text',
    "media_asset_id" = NULL,
    "source_url" = NULL,
    "content_digest" = NULL,
    "fetched_at" = NULL
WHERE "source_type" = 'media_asset'
  AND "content_digest" IS NULL;--> statement-breakpoint
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "ai_agent_version_sources"
    WHERE "source_type" = 'media_asset'
      AND (
        "content_digest" IS NULL
        OR "content_digest" !~ '^[0-9a-f]{64}$'
        OR "fetched_at" IS NULL
      )
  ) THEN
    RAISE EXCEPTION '0057 found an AI media source without an immutable extracted-content snapshot';
  END IF;
END;
$migration$;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD COLUMN "profile_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD COLUMN "additional_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "content_blocks" ADD COLUMN "style" jsonb DEFAULT '{"width":"content","alignment":"left","surface":"plain"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD COLUMN "layout_width" varchar(16) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD COLUMN "background_tone" varchar(16) DEFAULT 'plain' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD COLUMN "content_spacing" varchar(16) DEFAULT 'comfortable' NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_connections_id_org_idx" ON "commerce_provider_connections" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_products_id_org_idx" ON "commerce_products" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_product_mappings_id_org_idx" ON "commerce_product_mappings" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_id_org_idx" ON "commerce_orders" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_subscriptions_id_org_idx" ON "commerce_subscriptions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_pages_id_lesson_idx" ON "lesson_pages" USING btree ("id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_processing_jobs_id_org_idx" ON "media_processing_jobs" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "native_push_devices_id_user_org_idx" ON "native_push_devices" USING btree ("id","user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_instances_workspace_org_idx" ON "orbit_instances" USING btree ("workspace_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_permission_sets_id_workspace_idx" ON "orbit_permission_sets" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_workspace_memberships_workspace_account_idx" ON "orbit_workspace_memberships" USING btree ("workspace_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_roles_id_organization_idx" ON "team_roles" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_request_target_idx" ON "ai_agent_version_actions" USING btree ("id","organization_id","agent_version_id","action_type");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_definitions_id_org_idx" ON "badge_definitions" USING btree ("id","organization_id");--> statement-breakpoint
DO $migration$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "group_members" membership
		JOIN "users" member ON member."id" = membership."user_id"
		JOIN "groups" target ON target."id" = membership."group_id"
		WHERE member."organization_id" IS DISTINCT FROM target."organization_id"
	) THEN
		RAISE EXCEPTION '0057 found a cross-organization group membership'
			USING ERRCODE = '23514';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM "member_bundles" membership
		JOIN "users" member ON member."id" = membership."user_id"
		JOIN "bundles" target ON target."id" = membership."bundle_id"
		WHERE member."organization_id" IS DISTINCT FROM target."organization_id"
	) THEN
		RAISE EXCEPTION '0057 found a cross-organization bundle membership'
			USING ERRCODE = '23514';
	END IF;
END;
$migration$;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_agent_tenant_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."ai_agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_member_tenant_fk" FOREIGN KEY ("member_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_group_tenant_fk" FOREIGN KEY ("target_group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_bundle_tenant_fk" FOREIGN KEY ("target_bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_grant_request_tenant_fk" FOREIGN KEY ("grant_request_id","organization_id") REFERENCES "public"."ai_agent_action_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_membership_provenance" ADD CONSTRAINT "ai_agent_membership_provenance_revoke_request_tenant_fk" FOREIGN KEY ("revoked_by_request_id","organization_id") REFERENCES "public"."ai_agent_action_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflow_connections" ADD CONSTRAINT "automation_workflow_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_workflow_connections" ADD CONSTRAINT "automation_workflow_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhooks_id_org_idx" ON "webhooks" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "automation_workflow_connections" ADD CONSTRAINT "automation_workflows_webhook_tenant_fk" FOREIGN KEY ("webhook_id","organization_id") REFERENCES "public"."webhooks"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_groups" ADD CONSTRAINT "badge_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_connection_tenant_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."commerce_provider_connections"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_product_tenant_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."commerce_products"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_bundle_tenant_fk" FOREIGN KEY ("bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_order_tenant_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."commerce_orders"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_entitlements" ADD CONSTRAINT "commerce_entitlements_subscription_tenant_fk" FOREIGN KEY ("subscription_id","organization_id") REFERENCES "public"."commerce_subscriptions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_inbound_events" ADD CONSTRAINT "commerce_inbound_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_inbound_events" ADD CONSTRAINT "commerce_inbound_events_connection_tenant_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."commerce_provider_connections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_connection_tenant_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."commerce_provider_connections"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_product_tenant_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."commerce_products"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_mapping_tenant_fk" FOREIGN KEY ("mapping_id","organization_id") REFERENCES "public"."commerce_product_mappings"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_outbox_events" ADD CONSTRAINT "commerce_outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_product_mappings" ADD CONSTRAINT "commerce_product_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_product_mappings" ADD CONSTRAINT "commerce_product_mappings_connection_tenant_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."commerce_provider_connections"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_product_mappings" ADD CONSTRAINT "commerce_product_mappings_product_tenant_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."commerce_products"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_products" ADD CONSTRAINT "commerce_products_bundle_tenant_fk" FOREIGN KEY ("bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_provider_connections" ADD CONSTRAINT "commerce_provider_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_provider_connections" ADD CONSTRAINT "commerce_provider_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_connection_tenant_fk" FOREIGN KEY ("connection_id","organization_id") REFERENCES "public"."commerce_provider_connections"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_product_tenant_fk" FOREIGN KEY ("product_id","organization_id") REFERENCES "public"."commerce_products"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_order_tenant_fk" FOREIGN KEY ("order_id","organization_id") REFERENCES "public"."commerce_orders"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_subscriptions" ADD CONSTRAINT "commerce_subscriptions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_presences" ADD CONSTRAINT "editor_presences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_presences" ADD CONSTRAINT "editor_presences_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_presences" ADD CONSTRAINT "editor_presences_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_presences" ADD CONSTRAINT "editor_presences_lesson_tenant_fk" FOREIGN KEY ("lesson_id","organization_id") REFERENCES "public"."lessons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editor_presences" ADD CONSTRAINT "editor_presences_page_lesson_fk" FOREIGN KEY ("page_id","lesson_id") REFERENCES "public"."lesson_pages"("id","lesson_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD CONSTRAINT "media_asset_derivatives_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD CONSTRAINT "media_asset_derivatives_source_tenant_fk" FOREIGN KEY ("source_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD CONSTRAINT "media_asset_derivatives_job_tenant_fk" FOREIGN KEY ("processing_job_id","organization_id") REFERENCES "public"."media_processing_jobs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_transcripts" ADD CONSTRAINT "media_asset_transcripts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_transcripts" ADD CONSTRAINT "media_asset_transcripts_source_tenant_fk" FOREIGN KEY ("source_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset_transcripts" ADD CONSTRAINT "media_asset_transcripts_job_tenant_fk" FOREIGN KEY ("processing_job_id","organization_id") REFERENCES "public"."media_processing_jobs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_block_id_content_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."content_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_playback_progress" ADD CONSTRAINT "media_playback_progress_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_source_tenant_fk" FOREIGN KEY ("source_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_processing_jobs" ADD CONSTRAINT "media_processing_jobs_requester_tenant_fk" FOREIGN KEY ("requested_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_deliveries" ADD CONSTRAINT "native_push_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_deliveries" ADD CONSTRAINT "native_push_deliveries_notification_user_fk" FOREIGN KEY ("notification_id","user_id") REFERENCES "public"."notifications"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_deliveries" ADD CONSTRAINT "native_push_deliveries_device_tenant_fk" FOREIGN KEY ("device_id","user_id","organization_id") REFERENCES "public"."native_push_devices"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_devices" ADD CONSTRAINT "native_push_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_devices" ADD CONSTRAINT "native_push_devices_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "native_push_devices" ADD CONSTRAINT "native_push_devices_session_user_tenant_fk" FOREIGN KEY ("session_id","user_id","organization_id") REFERENCES "public"."user_sessions"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_account_identities" ADD CONSTRAINT "orbit_account_identities_account_id_orbit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_account_identities" ADD CONSTRAINT "orbit_account_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_account_identities" ADD CONSTRAINT "orbit_account_identities_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_audit_events" ADD CONSTRAINT "orbit_audit_events_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_audit_events" ADD CONSTRAINT "orbit_audit_events_actor_account_id_orbit_accounts_id_fk" FOREIGN KEY ("actor_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_audit_events" ADD CONSTRAINT "orbit_audit_events_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_audit_events" ADD CONSTRAINT "orbit_audit_events_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_instance_claims" ADD CONSTRAINT "orbit_instance_claims_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_instance_claims" ADD CONSTRAINT "orbit_instance_claims_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_instance_claims" ADD CONSTRAINT "orbit_instance_claims_consumed_organization_id_organizations_id_fk" FOREIGN KEY ("consumed_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_instances" ADD CONSTRAINT "orbit_instances_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_instances" ADD CONSTRAINT "orbit_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_partner_delegations" ADD CONSTRAINT "orbit_partner_delegations_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_partner_delegations" ADD CONSTRAINT "orbit_partner_delegations_membership_fk" FOREIGN KEY ("workspace_id","partner_account_id") REFERENCES "public"."orbit_workspace_memberships"("workspace_id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_partner_delegations" ADD CONSTRAINT "orbit_partner_delegations_instance_fk" FOREIGN KEY ("workspace_id","organization_id") REFERENCES "public"."orbit_instances"("workspace_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_permission_sets" ADD CONSTRAINT "orbit_permission_sets_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_permission_sets" ADD CONSTRAINT "orbit_permission_sets_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_items" ADD CONSTRAINT "orbit_transfer_items_job_id_orbit_transfer_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."orbit_transfer_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_source_organization_id_organizations_id_fk" FOREIGN KEY ("source_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_target_organization_id_organizations_id_fk" FOREIGN KEY ("target_organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_requested_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("requested_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_source_instance_fk" FOREIGN KEY ("workspace_id","source_organization_id") REFERENCES "public"."orbit_instances"("workspace_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_target_instance_fk" FOREIGN KEY ("workspace_id","target_organization_id") REFERENCES "public"."orbit_instances"("workspace_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_workspace_memberships" ADD CONSTRAINT "orbit_workspace_memberships_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_workspace_memberships" ADD CONSTRAINT "orbit_workspace_memberships_account_id_orbit_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_workspace_memberships" ADD CONSTRAINT "orbit_workspace_memberships_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_workspace_memberships" ADD CONSTRAINT "orbit_workspace_memberships_permission_set_fk" FOREIGN KEY ("permission_set_id","workspace_id") REFERENCES "public"."orbit_permission_sets"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_workspaces" ADD CONSTRAINT "orbit_workspaces_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_support_settings" ADD CONSTRAINT "organization_support_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_image_selections" ADD CONSTRAINT "stock_image_selections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_image_selections" ADD CONSTRAINT "stock_image_selections_selected_by_id_users_id_fk" FOREIGN KEY ("selected_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_image_selections" ADD CONSTRAINT "stock_image_selections_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_role_assignments" ADD CONSTRAINT "team_role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_role_assignments" ADD CONSTRAINT "team_role_assignments_assigned_by_id_users_id_fk" FOREIGN KEY ("assigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_role_assignments" ADD CONSTRAINT "team_role_assignments_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_role_assignments" ADD CONSTRAINT "team_role_assignments_role_tenant_fk" FOREIGN KEY ("role_id","organization_id") REFERENCES "public"."team_roles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_roles" ADD CONSTRAINT "team_roles_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_membership_provenance_grant_request_idx" ON "ai_agent_membership_provenance" USING btree ("grant_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_membership_provenance_active_group_idx" ON "ai_agent_membership_provenance" USING btree ("organization_id","member_id","target_group_id") WHERE "ai_agent_membership_provenance"."target_type" = 'group' and "ai_agent_membership_provenance"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_membership_provenance_active_bundle_idx" ON "ai_agent_membership_provenance" USING btree ("organization_id","member_id","target_bundle_id") WHERE "ai_agent_membership_provenance"."target_type" = 'bundle' and "ai_agent_membership_provenance"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "ai_agent_membership_provenance_member_idx" ON "ai_agent_membership_provenance" USING btree ("organization_id","member_id","granted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_workflows_org_provider_name_idx" ON "automation_workflow_connections" USING btree ("organization_id","provider","name");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_workflows_webhook_idx" ON "automation_workflow_connections" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "automation_workflows_org_created_idx" ON "automation_workflow_connections" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_groups_org_name_idx" ON "badge_groups" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "badge_groups_id_org_idx" ON "badge_groups" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "badge_groups_org_order_idx" ON "badge_groups" USING btree ("organization_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_entitlements_org_source_idx" ON "commerce_entitlements" USING btree ("organization_id","source_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_entitlements_id_org_idx" ON "commerce_entitlements" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "commerce_entitlements_org_user_status_idx" ON "commerce_entitlements" USING btree ("organization_id","user_id","status");--> statement-breakpoint
CREATE INDEX "commerce_entitlements_expiry_idx" ON "commerce_entitlements" USING btree ("status","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_inbound_events_connection_external_idx" ON "commerce_inbound_events" USING btree ("connection_id","external_event_id");--> statement-breakpoint
CREATE INDEX "commerce_inbound_events_org_received_idx" ON "commerce_inbound_events" USING btree ("organization_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_orders_connection_external_idx" ON "commerce_orders" USING btree ("connection_id","external_order_id");--> statement-breakpoint
CREATE INDEX "commerce_orders_org_ordered_idx" ON "commerce_orders" USING btree ("organization_id","ordered_at");--> statement-breakpoint
CREATE INDEX "commerce_outbox_org_created_idx" ON "commerce_outbox_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "commerce_outbox_pending_idx" ON "commerce_outbox_events" USING btree ("created_at") WHERE "commerce_outbox_events"."published_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_product_mappings_provider_product_idx" ON "commerce_product_mappings" USING btree ("connection_id","provider_product_id","provider_variant_id");--> statement-breakpoint
CREATE INDEX "commerce_product_mappings_org_product_idx" ON "commerce_product_mappings" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_products_org_sku_idx" ON "commerce_products" USING btree ("organization_id","sku");--> statement-breakpoint
CREATE INDEX "commerce_products_org_active_idx" ON "commerce_products" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_connections_endpoint_key_idx" ON "commerce_provider_connections" USING btree ("endpoint_key");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_connections_org_provider_idx" ON "commerce_provider_connections" USING btree ("organization_id","provider");--> statement-breakpoint
CREATE INDEX "commerce_connections_org_active_idx" ON "commerce_provider_connections" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_subscriptions_connection_external_idx" ON "commerce_subscriptions" USING btree ("connection_id","external_subscription_id");--> statement-breakpoint
CREATE INDEX "commerce_subscriptions_org_status_idx" ON "commerce_subscriptions" USING btree ("organization_id","status","current_period_end");--> statement-breakpoint
CREATE INDEX "editor_presences_course_expiry_idx" ON "editor_presences" USING btree ("organization_id","course_id","expires_at");--> statement-breakpoint
CREATE INDEX "editor_presences_expiry_idx" ON "editor_presences" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_derivatives_job_idx" ON "media_asset_derivatives" USING btree ("processing_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_derivatives_storage_key_idx" ON "media_asset_derivatives" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_asset_derivatives_source_kind_idx" ON "media_asset_derivatives" USING btree ("organization_id","source_asset_id","kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_transcripts_job_idx" ON "media_asset_transcripts" USING btree ("processing_job_id");--> statement-breakpoint
CREATE INDEX "media_asset_transcripts_source_language_idx" ON "media_asset_transcripts" USING btree ("organization_id","source_asset_id","language","created_at");--> statement-breakpoint
CREATE INDEX "media_playback_progress_lesson_user_idx" ON "media_playback_progress" USING btree ("organization_id","user_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_processing_jobs_request_key_idx" ON "media_processing_jobs" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "media_processing_jobs_queue_idx" ON "media_processing_jobs" USING btree ("status","next_retry_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "native_push_deliveries_notification_device_idx" ON "native_push_deliveries" USING btree ("notification_id","device_id");--> statement-breakpoint
CREATE INDEX "native_push_deliveries_status_retry_idx" ON "native_push_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "native_push_deliveries_processing_claim_idx" ON "native_push_deliveries" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "native_push_deliveries_org_created_idx" ON "native_push_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "native_push_devices_token_hash_idx" ON "native_push_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "native_push_devices_org_user_updated_idx" ON "native_push_devices" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_account_identities_account_org_idx" ON "orbit_account_identities" USING btree ("account_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_account_identities_user_org_idx" ON "orbit_account_identities" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "orbit_account_identities_account_active_idx" ON "orbit_account_identities" USING btree ("account_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_accounts_email_lower_idx" ON "orbit_accounts" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "orbit_audit_events_workspace_created_idx" ON "orbit_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "orbit_audit_events_actor_created_idx" ON "orbit_audit_events" USING btree ("actor_account_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_instance_claims_token_hash_idx" ON "orbit_instance_claims" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "orbit_instance_claims_workspace_expiry_idx" ON "orbit_instance_claims" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_instances_organization_idx" ON "orbit_instances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "orbit_instances_workspace_status_idx" ON "orbit_instances" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_partner_delegations_scope_idx" ON "orbit_partner_delegations" USING btree ("workspace_id","partner_account_id","organization_id");--> statement-breakpoint
CREATE INDEX "orbit_partner_delegations_account_active_idx" ON "orbit_partner_delegations" USING btree ("partner_account_id","revoked_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_permission_sets_workspace_name_lower_idx" ON "orbit_permission_sets" USING btree ("workspace_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_transfer_items_job_kind_source_idx" ON "orbit_transfer_items" USING btree ("job_id","kind","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_transfer_items_job_kind_target_idx" ON "orbit_transfer_items" USING btree ("job_id","kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_transfer_jobs_idempotency_idx" ON "orbit_transfer_jobs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orbit_transfer_jobs_workspace_created_idx" ON "orbit_transfer_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_workspace_memberships_id_workspace_idx" ON "orbit_workspace_memberships" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE INDEX "orbit_workspace_memberships_account_idx" ON "orbit_workspace_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_workspaces_slug_idx" ON "orbit_workspaces" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "stock_image_selections_org_course_created_idx" ON "stock_image_selections" USING btree ("organization_id","course_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_image_selections_expiry_idx" ON "stock_image_selections" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "stock_image_selections_selected_by_idx" ON "stock_image_selections" USING btree ("organization_id","selected_by_id");--> statement-breakpoint
CREATE INDEX "team_role_assignments_org_role_idx" ON "team_role_assignments" USING btree ("organization_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "team_roles_org_name_lower_idx" ON "team_roles" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE INDEX "team_roles_org_active_idx" ON "team_roles" USING btree ("organization_id","active");--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_group_tenant_fk" FOREIGN KEY ("target_group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_bundle_tenant_fk" FOREIGN KEY ("target_bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_configuration_tenant_fk" FOREIGN KEY ("action_configuration_id","organization_id","agent_version_id","action_type") REFERENCES "public"."ai_agent_version_actions"("id","organization_id","agent_version_id","action_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_group_tenant_fk" FOREIGN KEY ("group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_bundle_tenant_fk" FOREIGN KEY ("bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD CONSTRAINT "badge_definitions_group_tenant_fk" FOREIGN KEY ("group_id","organization_id") REFERENCES "public"."badge_groups"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_tenant_fk" FOREIGN KEY ("badge_id","organization_id") REFERENCES "public"."badge_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_version_group_idx" ON "ai_agent_version_actions" USING btree ("agent_version_id","action_type","group_id") WHERE "ai_agent_version_actions"."target_type" = 'group';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_version_bundle_idx" ON "ai_agent_version_actions" USING btree ("agent_version_id","action_type","bundle_id") WHERE "ai_agent_version_actions"."target_type" = 'bundle';--> statement-breakpoint
CREATE INDEX "badge_definitions_org_group_order_idx" ON "badge_definitions" USING btree ("organization_id","group_id","sort_order","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_version_course_idx" ON "ai_agent_version_actions" USING btree ("agent_version_id","action_type","course_id") WHERE "ai_agent_version_actions"."target_type" = 'course';--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_action_request_payload"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'AI agent action requests cannot be deleted or truncated'
			USING ERRCODE = '55000';
	END IF;
	IF OLD."status" <> 'pending'
		OR NEW."status" NOT IN ('approved', 'rejected', 'cancelled', 'expired') THEN
		RAISE EXCEPTION 'AI agent action requests may only transition once from pending to a terminal status'
			USING ERRCODE = '23514';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
		OR NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
		OR NEW."action_configuration_id" IS DISTINCT FROM OLD."action_configuration_id"
		OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
		OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
		OR NEW."action_type" IS DISTINCT FROM OLD."action_type"
		OR NEW."target_type" IS DISTINCT FROM OLD."target_type"
		OR NEW."target_course_id" IS DISTINCT FROM OLD."target_course_id"
		OR NEW."target_group_id" IS DISTINCT FROM OLD."target_group_id"
		OR NEW."target_bundle_id" IS DISTINCT FROM OLD."target_bundle_id"
		OR NEW."label_snapshot" IS DISTINCT FROM OLD."label_snapshot"
		OR NEW."payload_digest" IS DISTINCT FROM OLD."payload_digest"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
		OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
		RAISE EXCEPTION 'AI agent action request payload is immutable'
			USING ERRCODE = '55000';
	END IF;
	IF NEW."revision" <> OLD."revision" + 1 THEN
		RAISE EXCEPTION 'AI agent action request transitions must increment revision by exactly one'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_ai_agent_action_request_target"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
	PERFORM 1
	FROM "public"."ai_agent_version_actions" configuration
	WHERE configuration."id" = NEW."action_configuration_id"
		AND configuration."organization_id" = NEW."organization_id"
		AND configuration."agent_version_id" = NEW."agent_version_id"
		AND configuration."action_type" = NEW."action_type"
		AND configuration."target_type" = NEW."target_type"
		AND configuration."course_id" IS NOT DISTINCT FROM NEW."target_course_id"
		AND configuration."group_id" IS NOT DISTINCT FROM NEW."target_group_id"
		AND configuration."bundle_id" IS NOT DISTINCT FROM NEW."target_bundle_id";
	IF NOT FOUND THEN
		RAISE EXCEPTION 'AI action request target does not match its configuration'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_requests_target_validate_trigger"
BEFORE INSERT ON "public"."ai_agent_action_requests"
FOR EACH ROW EXECUTE FUNCTION "public"."validate_ai_agent_action_request_target"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_ai_agent_membership_provenance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'INSERT' AND (
		NEW."revoked_at" IS NOT NULL
		OR NEW."revoked_by_request_id" IS NOT NULL
		OR NEW."revocation_reason" IS NOT NULL
	) THEN
		RAISE EXCEPTION 'AI membership provenance must be inserted as active'
			USING ERRCODE = '23514';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF OLD."revoked_at" IS NOT NULL OR NEW."revoked_at" IS NULL THEN
			RAISE EXCEPTION 'AI membership provenance may only be revoked once'
				USING ERRCODE = '55000';
		END IF;
		IF NEW."id" IS DISTINCT FROM OLD."id"
			OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
			OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
			OR NEW."member_id" IS DISTINCT FROM OLD."member_id"
			OR NEW."target_type" IS DISTINCT FROM OLD."target_type"
			OR NEW."target_group_id" IS DISTINCT FROM OLD."target_group_id"
			OR NEW."target_bundle_id" IS DISTINCT FROM OLD."target_bundle_id"
			OR NEW."grant_request_id" IS DISTINCT FROM OLD."grant_request_id"
			OR NEW."granted_at" IS DISTINCT FROM OLD."granted_at" THEN
			RAISE EXCEPTION 'AI membership provenance identity is immutable'
				USING ERRCODE = '55000';
		END IF;
	END IF;

	PERFORM 1
	FROM "public"."ai_agent_action_requests" request
	WHERE request."id" = NEW."grant_request_id"
		AND request."organization_id" = NEW."organization_id"
		AND request."agent_id" = NEW."agent_id"
		AND request."requested_by_id" = NEW."member_id"
		AND request."status"::text = CASE WHEN TG_OP = 'INSERT' THEN 'pending' ELSE 'approved' END
		AND request."target_type" = NEW."target_type"
		AND (
			(NEW."target_type" = 'group'
				AND request."action_type"::text = 'group_membership_add'
				AND request."target_course_id" IS NULL
				AND request."target_group_id" = NEW."target_group_id"
				AND request."target_bundle_id" IS NULL
				AND NEW."target_bundle_id" IS NULL)
			OR
			(NEW."target_type" = 'bundle'
				AND request."action_type"::text = 'bundle_assignment_add'
				AND request."target_course_id" IS NULL
				AND request."target_bundle_id" = NEW."target_bundle_id"
				AND request."target_group_id" IS NULL
				AND NEW."target_group_id" IS NULL)
		);
	IF NOT FOUND THEN
		RAISE EXCEPTION 'AI membership provenance does not match its grant request'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."revocation_reason" = 'ai_action' THEN
		PERFORM 1
		FROM "public"."ai_agent_action_requests" request
		WHERE request."id" = NEW."revoked_by_request_id"
			AND request."organization_id" = NEW."organization_id"
			AND request."agent_id" = NEW."agent_id"
			AND request."requested_by_id" = NEW."member_id"
			AND request."status"::text = 'pending'
			AND request."target_type" = NEW."target_type"
			AND (
				(NEW."target_type" = 'group'
					AND request."action_type"::text = 'group_membership_remove'
					AND request."target_course_id" IS NULL
					AND request."target_group_id" = NEW."target_group_id"
					AND request."target_bundle_id" IS NULL)
				OR
				(NEW."target_type" = 'bundle'
					AND request."action_type"::text = 'bundle_assignment_remove'
					AND request."target_course_id" IS NULL
					AND request."target_bundle_id" = NEW."target_bundle_id"
					AND request."target_group_id" IS NULL)
			);
		IF NOT FOUND THEN
			RAISE EXCEPTION 'AI membership provenance does not match its revocation request'
				USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "ai_agent_membership_provenance_validate_trigger"
BEFORE INSERT OR UPDATE ON "public"."ai_agent_membership_provenance"
FOR EACH ROW EXECUTE FUNCTION "public"."validate_ai_agent_membership_provenance"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_ai_agent_membership_provenance_removal"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'AI membership provenance is append-only'
		USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reject_ai_agent_membership_provenance_removal"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_membership_provenance_reject_delete_trigger"
BEFORE DELETE ON "public"."ai_agent_membership_provenance"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_ai_agent_membership_provenance_removal"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_membership_provenance_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."ai_agent_membership_provenance"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_ai_agent_membership_provenance_removal"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."close_ai_group_membership_provenance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_user_id uuid;
	v_group_id uuid;
	v_organization_id uuid;
BEGIN
	IF TG_OP = 'DELETE' THEN
		v_user_id := OLD."user_id";
		v_group_id := OLD."group_id";
	ELSE
		v_user_id := NEW."user_id";
		v_group_id := NEW."group_id";
	END IF;
	SELECT member."organization_id"
	INTO v_organization_id
	FROM "public"."users" member
	JOIN "public"."groups" target
		ON target."id" = v_group_id
		AND target."organization_id" = member."organization_id"
	WHERE member."id" = v_user_id;
	IF NOT FOUND THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'Group membership must remain within one organization'
			USING ERRCODE = '23514';
	END IF;
	IF current_setting('q_academy.ai_membership_origin', true) = 'ai_action' THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;
	UPDATE "public"."ai_agent_membership_provenance"
	SET "revoked_at" = now(),
		"revoked_by_request_id" = NULL,
		"revocation_reason" = (CASE WHEN TG_OP = 'DELETE' THEN 'manual_removal' ELSE 'manual_takeover' END)::"public"."ai_agent_membership_revocation_reason"
	WHERE "organization_id" = v_organization_id
		AND "member_id" = v_user_id
		AND "target_type" = 'group'
		AND "target_group_id" = v_group_id
		AND "revoked_at" IS NULL;
	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "group_members_close_ai_provenance_trigger"
BEFORE INSERT OR DELETE ON "public"."group_members"
FOR EACH ROW EXECUTE FUNCTION "public"."close_ai_group_membership_provenance"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."close_ai_bundle_membership_provenance"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
	v_user_id uuid;
	v_bundle_id uuid;
	v_organization_id uuid;
BEGIN
	IF TG_OP = 'DELETE' THEN
		v_user_id := OLD."user_id";
		v_bundle_id := OLD."bundle_id";
	ELSE
		v_user_id := NEW."user_id";
		v_bundle_id := NEW."bundle_id";
	END IF;
	SELECT member."organization_id"
	INTO v_organization_id
	FROM "public"."users" member
	JOIN "public"."bundles" target
		ON target."id" = v_bundle_id
		AND target."organization_id" = member."organization_id"
	WHERE member."id" = v_user_id;
	IF NOT FOUND THEN
		IF TG_OP = 'DELETE' THEN
			RETURN OLD;
		END IF;
		RAISE EXCEPTION 'Bundle membership must remain within one organization'
			USING ERRCODE = '23514';
	END IF;
	IF current_setting('q_academy.ai_membership_origin', true) = 'ai_action' THEN
		RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
	END IF;
	UPDATE "public"."ai_agent_membership_provenance"
	SET "revoked_at" = now(),
		"revoked_by_request_id" = NULL,
		"revocation_reason" = (CASE WHEN TG_OP = 'DELETE' THEN 'manual_removal' ELSE 'manual_takeover' END)::"public"."ai_agent_membership_revocation_reason"
	WHERE "organization_id" = v_organization_id
		AND "member_id" = v_user_id
		AND "target_type" = 'bundle'
		AND "target_bundle_id" = v_bundle_id
		AND "revoked_at" IS NULL;
	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "member_bundles_close_ai_provenance_trigger"
BEFORE INSERT OR DELETE ON "public"."member_bundles"
FOR EACH ROW EXECUTE FUNCTION "public"."close_ai_bundle_membership_provenance"();--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_target_shape_check" CHECK ((
        "ai_agent_action_requests"."target_type" = 'course' and "ai_agent_action_requests"."action_type"::text in ('course_enrollment', 'course_unenrollment') and "ai_agent_action_requests"."target_course_id" is not null and "ai_agent_action_requests"."target_group_id" is null and "ai_agent_action_requests"."target_bundle_id" is null
      ) or (
        "ai_agent_action_requests"."target_type" = 'group' and "ai_agent_action_requests"."action_type"::text in ('group_membership_add', 'group_membership_remove') and "ai_agent_action_requests"."target_course_id" is null and "ai_agent_action_requests"."target_group_id" is not null and "ai_agent_action_requests"."target_bundle_id" is null
      ) or (
        "ai_agent_action_requests"."target_type" = 'bundle' and "ai_agent_action_requests"."action_type"::text in ('bundle_assignment_add', 'bundle_assignment_remove') and "ai_agent_action_requests"."target_course_id" is null and "ai_agent_action_requests"."target_group_id" is null and "ai_agent_action_requests"."target_bundle_id" is not null
      ));--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_target_shape_check" CHECK ((
        "ai_agent_version_actions"."target_type" = 'course' and "ai_agent_version_actions"."action_type"::text in ('course_enrollment', 'course_unenrollment') and "ai_agent_version_actions"."course_id" is not null and "ai_agent_version_actions"."group_id" is null and "ai_agent_version_actions"."bundle_id" is null
      ) or (
        "ai_agent_version_actions"."target_type" = 'group' and "ai_agent_version_actions"."action_type"::text in ('group_membership_add', 'group_membership_remove') and "ai_agent_version_actions"."course_id" is null and "ai_agent_version_actions"."group_id" is not null and "ai_agent_version_actions"."bundle_id" is null
      ) or (
        "ai_agent_version_actions"."target_type" = 'bundle' and "ai_agent_version_actions"."action_type"::text in ('bundle_assignment_add', 'bundle_assignment_remove') and "ai_agent_version_actions"."course_id" is null and "ai_agent_version_actions"."group_id" is null and "ai_agent_version_actions"."bundle_id" is not null
      ));--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_shape_check" CHECK ((
        "ai_agent_version_sources"."source_type"::text = 'course_version'
        and "ai_agent_version_sources"."course_id" is not null
        and "ai_agent_version_sources"."course_version_id" is not null
        and "ai_agent_version_sources"."media_asset_id" is null
        and "ai_agent_version_sources"."title" is null
        and "ai_agent_version_sources"."content" is null
        and "ai_agent_version_sources"."source_url" is null
        and "ai_agent_version_sources"."content_digest" is null
        and "ai_agent_version_sources"."fetched_at" is null
      ) or (
        "ai_agent_version_sources"."source_type"::text = 'manual_text'
        and "ai_agent_version_sources"."course_id" is null
        and "ai_agent_version_sources"."course_version_id" is null
        and "ai_agent_version_sources"."media_asset_id" is null
        and "ai_agent_version_sources"."title" is not null
        and "ai_agent_version_sources"."content" is not null
        and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
        and length(btrim("ai_agent_version_sources"."content")) between 1 and 2000000
        and "ai_agent_version_sources"."source_url" is null
        and "ai_agent_version_sources"."content_digest" is null
        and "ai_agent_version_sources"."fetched_at" is null
      ) or (
        "ai_agent_version_sources"."source_type"::text = 'media_asset'
        and "ai_agent_version_sources"."course_id" is null
        and "ai_agent_version_sources"."course_version_id" is null
        and "ai_agent_version_sources"."media_asset_id" is not null
        and "ai_agent_version_sources"."title" is not null
        and "ai_agent_version_sources"."content" is not null
        and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
        and length(btrim("ai_agent_version_sources"."content")) between 1 and 2000000
        and "ai_agent_version_sources"."source_url" is null
        and "ai_agent_version_sources"."content_digest" is not null
        and "ai_agent_version_sources"."content_digest" ~ '^[0-9a-f]{64}$'
        and "ai_agent_version_sources"."fetched_at" is not null
      ) or (
        "ai_agent_version_sources"."source_type"::text = 'web_url'
        and "ai_agent_version_sources"."course_id" is null
        and "ai_agent_version_sources"."course_version_id" is null
        and "ai_agent_version_sources"."media_asset_id" is null
        and "ai_agent_version_sources"."title" is not null
        and "ai_agent_version_sources"."content" is not null
        and "ai_agent_version_sources"."source_url" is not null
        and "ai_agent_version_sources"."content_digest" is not null
        and "ai_agent_version_sources"."fetched_at" is not null
        and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
        and length(btrim("ai_agent_version_sources"."content")) between 1 and 200000
        and length("ai_agent_version_sources"."source_url") between 12 and 2048
        and "ai_agent_version_sources"."source_url" like 'https://%'
        and "ai_agent_version_sources"."content_digest" ~ '^[0-9a-f]{64}$'
      ));--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_profile_fields_check" CHECK (jsonb_typeof("ai_agent_versions"."profile_field_ids") = 'array' and jsonb_array_length("ai_agent_versions"."profile_field_ids") <= 25);--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_additional_prompts_check" CHECK (jsonb_typeof("ai_agent_versions"."additional_prompts") = 'array' and jsonb_array_length("ai_agent_versions"."additional_prompts") <= 20);--> statement-breakpoint
ALTER TABLE "badge_definitions" ADD CONSTRAINT "badge_definitions_sort_order_check" CHECK ("badge_definitions"."sort_order" between 0 and 1000);--> statement-breakpoint
ALTER TABLE "content_blocks" ADD CONSTRAINT "content_blocks_style_check" CHECK (jsonb_typeof("content_blocks"."style") = 'object' and ("content_blocks"."style" - 'width' - 'alignment' - 'surface') = '{}'::jsonb and "content_blocks"."style" ?& array['width','alignment','surface'] and ("content_blocks"."style"->>'width') in ('compact','content','full') and ("content_blocks"."style"->>'alignment') in ('left','center') and ("content_blocks"."style"->>'surface') in ('plain','bordered','muted'));--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD CONSTRAINT "lesson_pages_layout_width_check" CHECK ("lesson_pages"."layout_width" in ('narrow', 'standard', 'wide'));--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD CONSTRAINT "lesson_pages_background_tone_check" CHECK ("lesson_pages"."background_tone" in ('plain', 'soft', 'contrast'));--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD CONSTRAINT "lesson_pages_content_spacing_check" CHECK ("lesson_pages"."content_spacing" in ('compact', 'comfortable', 'spacious'));--> statement-breakpoint
ALTER TABLE "lesson_pages" ADD CONSTRAINT "lesson_pages_revision_check" CHECK ("lesson_pages"."revision" >= 1);
--> statement-breakpoint
CREATE FUNCTION "public"."prevent_orbit_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'orbit_audit_events is append-only'
		USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."prevent_orbit_audit_event_mutation"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "orbit_audit_events_append_only_trigger"
BEFORE UPDATE OR DELETE ON "public"."orbit_audit_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_orbit_audit_event_mutation"();--> statement-breakpoint
CREATE TRIGGER "orbit_audit_events_prevent_truncate_trigger"
BEFORE TRUNCATE ON "public"."orbit_audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."prevent_orbit_audit_event_mutation"();--> statement-breakpoint
COMMENT ON FUNCTION "public"."prevent_orbit_audit_event_mutation"() IS
	'Fail-closed guard for immutable Orbit control-plane audit evidence.';--> statement-breakpoint
COMMENT ON TRIGGER "orbit_audit_events_append_only_trigger" ON "public"."orbit_audit_events" IS
	'Strict append-only audit invariant. UPDATE and DELETE, including referential cascades, require an explicit audited retention migration.';--> statement-breakpoint
COMMENT ON TRIGGER "orbit_audit_events_prevent_truncate_trigger" ON "public"."orbit_audit_events" IS
	'Strict append-only audit invariant. TRUNCATE is prohibited because it bypasses row-level retention evidence.';
