CREATE TYPE "public"."privacy_export_artifact_format" AS ENUM('json', 'zip');--> statement-breakpoint
CREATE TYPE "public"."privacy_export_artifact_status" AS ENUM('building', 'ready', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."privacy_export_storage_driver" AS ENUM('filesystem', 's3');--> statement-breakpoint
CREATE TYPE "public"."privacy_legal_hold_scope" AS ENUM('all', 'profile', 'authentication', 'learning', 'certificates', 'community', 'feedback', 'events', 'gamification', 'ai', 'media', 'audit', 'integrations', 'communications');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('received', 'identity_verified', 'approved', 'processing', 'blocked', 'completed', 'rejected', 'cancelled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('access_export', 'erasure');--> statement-breakpoint
CREATE TABLE "privacy_export_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "privacy_export_artifact_status" DEFAULT 'building' NOT NULL,
	"format" "privacy_export_artifact_format" DEFAULT 'json' NOT NULL,
	"storage_driver" "privacy_export_storage_driver" NOT NULL,
	"storage_key" text NOT NULL,
	"storage_version_id" text,
	"storage_etag" varchar(160),
	"safe_file_name" varchar(120) NOT NULL,
	"content_type" varchar(180) NOT NULL,
	"manifest_sha256" varchar(64),
	"artifact_sha256" varchar(64),
	"size_bytes" bigint,
	"file_count" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"ready_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"failure_code" varchar(80),
	"failure_detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_export_artifacts_storage_namespace_check" CHECK ("privacy_export_artifacts"."storage_key" like ('tenants/' || "privacy_export_artifacts"."organization_id"::text || '/privacy-exports/' || "privacy_export_artifacts"."request_id"::text || '/%')),
	CONSTRAINT "privacy_export_artifacts_storage_identity_check" CHECK (("privacy_export_artifacts"."storage_driver" = 'filesystem' and "privacy_export_artifacts"."storage_version_id" is null and "privacy_export_artifacts"."storage_etag" is null) or ("privacy_export_artifacts"."storage_driver" = 's3' and (("privacy_export_artifacts"."storage_version_id" is null and "privacy_export_artifacts"."storage_etag" is null) or ("privacy_export_artifacts"."storage_version_id" is not null and length("privacy_export_artifacts"."storage_version_id") between 1 and 1024 and btrim("privacy_export_artifacts"."storage_version_id") <> '' and "privacy_export_artifacts"."storage_etag" is not null and btrim("privacy_export_artifacts"."storage_etag") <> '')) and ("privacy_export_artifacts"."status" not in ('ready', 'deleted') or ("privacy_export_artifacts"."storage_version_id" is not null and "privacy_export_artifacts"."storage_etag" is not null)))),
	CONSTRAINT "privacy_export_artifacts_file_name_check" CHECK ("privacy_export_artifacts"."safe_file_name" ~ '^[a-z0-9][a-z0-9_-]{0,114}[.](json|zip)$'),
	CONSTRAINT "privacy_export_artifacts_content_type_check" CHECK (btrim("privacy_export_artifacts"."content_type") <> ''),
	CONSTRAINT "privacy_export_artifacts_hash_check" CHECK (("privacy_export_artifacts"."manifest_sha256" is null or "privacy_export_artifacts"."manifest_sha256" ~ '^[0-9a-f]{64}$') and ("privacy_export_artifacts"."artifact_sha256" is null or "privacy_export_artifacts"."artifact_sha256" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "privacy_export_artifacts_size_check" CHECK (("privacy_export_artifacts"."size_bytes" is null and "privacy_export_artifacts"."file_count" is null) or ("privacy_export_artifacts"."size_bytes" > 0 and "privacy_export_artifacts"."file_count" > 0)),
	CONSTRAINT "privacy_export_artifacts_timeline_check" CHECK ("privacy_export_artifacts"."expires_at" > "privacy_export_artifacts"."created_at" and ("privacy_export_artifacts"."ready_at" is null or "privacy_export_artifacts"."ready_at" >= "privacy_export_artifacts"."created_at") and ("privacy_export_artifacts"."deleted_at" is null or ("privacy_export_artifacts"."deleted_at" >= "privacy_export_artifacts"."created_at" and ("privacy_export_artifacts"."ready_at" is null or "privacy_export_artifacts"."deleted_at" >= "privacy_export_artifacts"."ready_at")))),
	CONSTRAINT "privacy_export_artifacts_state_check" CHECK (("privacy_export_artifacts"."status" = 'building' and "privacy_export_artifacts"."ready_at" is null and "privacy_export_artifacts"."deleted_at" is null and "privacy_export_artifacts"."manifest_sha256" is null and "privacy_export_artifacts"."artifact_sha256" is null and "privacy_export_artifacts"."size_bytes" is null and "privacy_export_artifacts"."file_count" is null and "privacy_export_artifacts"."failure_code" is null) or ("privacy_export_artifacts"."status" = 'ready' and "privacy_export_artifacts"."ready_at" is not null and "privacy_export_artifacts"."deleted_at" is null and "privacy_export_artifacts"."manifest_sha256" is not null and "privacy_export_artifacts"."artifact_sha256" is not null and "privacy_export_artifacts"."size_bytes" is not null and "privacy_export_artifacts"."file_count" is not null and "privacy_export_artifacts"."failure_code" is null) or ("privacy_export_artifacts"."status" = 'failed' and "privacy_export_artifacts"."ready_at" is null and "privacy_export_artifacts"."deleted_at" is null and "privacy_export_artifacts"."failure_code" is not null and btrim("privacy_export_artifacts"."failure_code") <> '') or ("privacy_export_artifacts"."status" = 'deleted' and "privacy_export_artifacts"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "privacy_legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid,
	"subject_user_id" uuid,
	"subject_reference" varchar(64) NOT NULL,
	"scope" "privacy_legal_hold_scope" NOT NULL,
	"reference" varchar(180) NOT NULL,
	"reason" text NOT NULL,
	"legal_basis" text NOT NULL,
	"created_by_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_by_id" uuid,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_legal_holds_subject_reference_check" CHECK ("privacy_legal_holds"."subject_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "privacy_legal_holds_text_check" CHECK (btrim("privacy_legal_holds"."reference") <> '' and btrim("privacy_legal_holds"."reason") <> '' and btrim("privacy_legal_holds"."legal_basis") <> ''),
	CONSTRAINT "privacy_legal_holds_timeline_check" CHECK (("privacy_legal_holds"."expires_at" is null or "privacy_legal_holds"."expires_at" > "privacy_legal_holds"."starts_at") and ("privacy_legal_holds"."released_at" is null or "privacy_legal_holds"."released_at" >= "privacy_legal_holds"."starts_at")),
	CONSTRAINT "privacy_legal_holds_release_state_check" CHECK (("privacy_legal_holds"."released_at" is null and "privacy_legal_holds"."released_by_id" is null and "privacy_legal_holds"."release_reason" is null) or ("privacy_legal_holds"."released_at" is not null and "privacy_legal_holds"."release_reason" is not null and btrim("privacy_legal_holds"."release_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "privacy_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_reference" varchar(64) NOT NULL,
	"event" varchar(80) NOT NULL,
	"from_status" "privacy_request_status",
	"to_status" "privacy_request_status",
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_request_events_actor_reference_check" CHECK ("privacy_request_events"."actor_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "privacy_request_events_event_check" CHECK (btrim("privacy_request_events"."event") <> ''),
	CONSTRAINT "privacy_request_events_transition_check" CHECK ("privacy_request_events"."from_status" is null or "privacy_request_events"."to_status" is not null)
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"subject_reference" varchar(64) NOT NULL,
	"requested_by_id" uuid,
	"client_request_id" varchar(180) NOT NULL,
	"type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'received' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"identity_verified_at" timestamp with time zone,
	"identity_verified_by_id" uuid,
	"approved_at" timestamp with time zone,
	"approved_by_id" uuid,
	"processing_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"backup_expires_at" timestamp with time zone,
	"policy_version" varchar(80),
	"policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_reason" text,
	"processing_attempt" integer DEFAULT 0 NOT NULL,
	"processing_claim_token" uuid,
	"processing_claimed_at" timestamp with time zone,
	"processing_lease_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_subject_reference_check" CHECK ("privacy_requests"."subject_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "privacy_requests_client_request_check" CHECK (btrim("privacy_requests"."client_request_id") <> ''),
	CONSTRAINT "privacy_requests_due_at_check" CHECK ("privacy_requests"."due_at" >= "privacy_requests"."created_at"),
	CONSTRAINT "privacy_requests_timeline_check" CHECK (("privacy_requests"."identity_verified_at" is null or "privacy_requests"."identity_verified_at" >= "privacy_requests"."created_at") and ("privacy_requests"."approved_at" is null or ("privacy_requests"."identity_verified_at" is not null and "privacy_requests"."approved_at" >= "privacy_requests"."identity_verified_at")) and ("privacy_requests"."processing_started_at" is null or ("privacy_requests"."approved_at" is not null and "privacy_requests"."processing_started_at" >= "privacy_requests"."approved_at")) and ("privacy_requests"."completed_at" is null or ("privacy_requests"."processing_started_at" is not null and "privacy_requests"."completed_at" >= "privacy_requests"."processing_started_at")) and ("privacy_requests"."backup_expires_at" is null or ("privacy_requests"."completed_at" is not null and "privacy_requests"."backup_expires_at" >= "privacy_requests"."completed_at"))),
	CONSTRAINT "privacy_requests_completion_state_check" CHECK (("privacy_requests"."status" = 'completed' and "privacy_requests"."completed_at" is not null) or ("privacy_requests"."status" <> 'completed' and "privacy_requests"."completed_at" is null)),
	CONSTRAINT "privacy_requests_reason_state_check" CHECK ("privacy_requests"."status" not in ('blocked', 'rejected', 'cancelled', 'failed') or ("privacy_requests"."status_reason" is not null and btrim("privacy_requests"."status_reason") <> '')),
	CONSTRAINT "privacy_requests_processing_attempt_check" CHECK ("privacy_requests"."processing_attempt" >= 0),
	CONSTRAINT "privacy_requests_processing_claim_check" CHECK (("privacy_requests"."processing_claim_token" is null and "privacy_requests"."processing_claimed_at" is null and "privacy_requests"."processing_lease_expires_at" is null) or ("privacy_requests"."status" = 'processing' and "privacy_requests"."processing_claim_token" is not null and "privacy_requests"."processing_claimed_at" is not null and "privacy_requests"."processing_lease_expires_at" > "privacy_requests"."processing_claimed_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_id_organization_idx" ON "privacy_requests" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "privacy_export_artifacts" ADD CONSTRAINT "privacy_export_artifacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_export_artifacts" ADD CONSTRAINT "privacy_export_artifacts_request_tenant_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."privacy_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_request_tenant_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."privacy_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_subject_tenant_fk" FOREIGN KEY ("subject_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_creator_tenant_fk" FOREIGN KEY ("created_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_legal_holds" ADD CONSTRAINT "privacy_legal_holds_releaser_tenant_fk" FOREIGN KEY ("released_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_events" ADD CONSTRAINT "privacy_request_events_request_tenant_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."privacy_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_identity_verified_by_id_users_id_fk" FOREIGN KEY ("identity_verified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_subject_tenant_fk" FOREIGN KEY ("subject_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_requester_tenant_fk" FOREIGN KEY ("requested_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_verifier_tenant_fk" FOREIGN KEY ("identity_verified_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_approver_tenant_fk" FOREIGN KEY ("approved_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_export_artifacts_id_organization_idx" ON "privacy_export_artifacts" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "privacy_export_artifacts_org_request_idx" ON "privacy_export_artifacts" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_export_artifacts_storage_key_idx" ON "privacy_export_artifacts" USING btree ("storage_driver","storage_key");--> statement-breakpoint
CREATE INDEX "privacy_export_artifacts_org_status_expiry_idx" ON "privacy_export_artifacts" USING btree ("organization_id","status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_legal_holds_id_organization_idx" ON "privacy_legal_holds" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_legal_holds_org_reference_idx" ON "privacy_legal_holds" USING btree ("organization_id","reference");--> statement-breakpoint
CREATE INDEX "privacy_legal_holds_org_subject_active_idx" ON "privacy_legal_holds" USING btree ("organization_id","subject_reference","scope","expires_at") WHERE "privacy_legal_holds"."released_at" is null;--> statement-breakpoint
CREATE INDEX "privacy_legal_holds_org_request_idx" ON "privacy_legal_holds" USING btree ("organization_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_request_events_id_organization_idx" ON "privacy_request_events" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "privacy_request_events_org_request_created_idx" ON "privacy_request_events" USING btree ("organization_id","request_id","created_at","id");--> statement-breakpoint
CREATE INDEX "privacy_request_events_org_actor_created_idx" ON "privacy_request_events" USING btree ("organization_id","actor_reference","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_requests_org_client_request_idx" ON "privacy_requests" USING btree ("organization_id","client_request_id");--> statement-breakpoint
CREATE INDEX "privacy_requests_org_subject_status_idx" ON "privacy_requests" USING btree ("organization_id","subject_reference","status","created_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_org_status_due_idx" ON "privacy_requests" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_processing_lease_idx" ON "privacy_requests" USING btree ("status","processing_lease_expires_at");--> statement-breakpoint
CREATE FUNCTION "public"."prevent_privacy_request_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'privacy_request_events is append-only'
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "privacy_request_events_append_only"
BEFORE UPDATE OR DELETE ON "public"."privacy_request_events"
FOR EACH ROW
EXECUTE FUNCTION "public"."prevent_privacy_request_event_mutation"();--> statement-breakpoint
CREATE TRIGGER "privacy_request_events_prevent_truncate"
BEFORE TRUNCATE ON "public"."privacy_request_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."prevent_privacy_request_event_mutation"();--> statement-breakpoint
COMMENT ON TRIGGER "privacy_request_events_append_only" ON "public"."privacy_request_events" IS
  'Strict append-only audit invariant. Tenant cascade deletion is deliberately blocked; events must be retained or moved by an explicit audited hard-delete process.';
