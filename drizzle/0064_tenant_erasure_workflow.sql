CREATE TABLE "tenant_erasure_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_slug" varchar(100) NOT NULL,
	"request_reference" varchar(180) NOT NULL,
	"approved_by" varchar(180) NOT NULL,
	"legal_basis" text NOT NULL,
	"status" varchar(32) DEFAULT 'erasing' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"execute_after" timestamp with time zone NOT NULL,
	"primary_erased_at" timestamp with time zone,
	"backup_expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"customer_export_sha256" varchar(64) NOT NULL,
	"evidence_archive_sha256" varchar(64) NOT NULL,
	"evidence_manifest_sha256" varchar(64) NOT NULL,
	"archive_key_id" varchar(64) NOT NULL,
	"media_asset_count" integer DEFAULT 0 NOT NULL,
	"storage_object_count" integer DEFAULT 0 NOT NULL,
	"row_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_manifest" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_erasure_receipts_status_check" CHECK ("status" in ('erasing', 'primary_erased', 'backup_retention_pending', 'completed', 'failed')),
	CONSTRAINT "tenant_erasure_receipts_text_check" CHECK (btrim("organization_slug") <> '' and btrim("request_reference") <> '' and btrim("approved_by") <> '' and btrim("legal_basis") <> ''),
	CONSTRAINT "tenant_erasure_receipts_hashes_check" CHECK ("customer_export_sha256" ~ '^[0-9a-f]{64}$' and "evidence_archive_sha256" ~ '^[0-9a-f]{64}$' and "evidence_manifest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "tenant_erasure_receipts_timeline_check" CHECK ("execute_after" >= "requested_at" and "backup_expires_at" >= "execute_after" and ("primary_erased_at" is null or "primary_erased_at" >= "execute_after") and ("completed_at" is null or ("primary_erased_at" is not null and "completed_at" >= "primary_erased_at"))),
	CONSTRAINT "tenant_erasure_receipts_counts_check" CHECK ("media_asset_count" >= 0 and "storage_object_count" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_erasure_receipts_org_reference_idx" ON "tenant_erasure_receipts" USING btree ("organization_id", "request_reference");
--> statement-breakpoint
CREATE INDEX "tenant_erasure_receipts_status_backup_idx" ON "tenant_erasure_receipts" USING btree ("status", "backup_expires_at");
--> statement-breakpoint
CREATE TABLE "tenant_erasure_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"event" varchar(80) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_erasure_events_event_check" CHECK (btrim("event") <> '')
);
--> statement-breakpoint
ALTER TABLE "tenant_erasure_events" ADD CONSTRAINT "tenant_erasure_events_receipt_id_tenant_erasure_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."tenant_erasure_receipts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tenant_erasure_events_receipt_created_idx" ON "tenant_erasure_events" USING btree ("receipt_id", "created_at", "id");
--> statement-breakpoint
CREATE FUNCTION "public"."tenant_erasure_cascade_is_authorized"("target_organization_id" uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
	SELECT EXISTS (
		SELECT 1
		FROM "public"."tenant_erasure_receipts" receipt
		WHERE receipt."id"::text = current_setting('q_academy.tenant_erasure_receipt', true)
			AND receipt."organization_id" = "target_organization_id"
			AND receipt."status" = 'erasing'
	) AND NOT EXISTS (
		SELECT 1
		FROM "public"."organizations" organization
		WHERE organization."id" = "target_organization_id"
			AND organization."status" <> 'offboarding'
	);
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."tenant_erasure_cascade_is_authorized"(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_privacy_request_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'privacy_request_events is append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_community_moderation_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'community_moderation_events is append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."prevent_ai_agent_action_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'ai_agent_action_events is append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_action_request_payload"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'AI agent action requests cannot be deleted or truncated' USING ERRCODE = '55000';
	END IF;
	IF OLD."status" <> 'pending'
		OR NEW."status" NOT IN ('approved', 'rejected', 'cancelled', 'expired') THEN
		RAISE EXCEPTION 'AI agent action requests may only transition once from pending to a terminal status' USING ERRCODE = '23514';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
		OR NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
		OR NEW."action_configuration_id" IS DISTINCT FROM OLD."action_configuration_id"
		OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
		OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
		OR NEW."action_type" IS DISTINCT FROM OLD."action_type"
		OR NEW."target_course_id" IS DISTINCT FROM OLD."target_course_id"
		OR NEW."label_snapshot" IS DISTINCT FROM OLD."label_snapshot"
		OR NEW."payload_digest" IS DISTINCT FROM OLD."payload_digest"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
		OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
		RAISE EXCEPTION 'AI agent action request payload is immutable' USING ERRCODE = '55000';
	END IF;
	IF NEW."revision" <> OLD."revision" + 1 THEN
		RAISE EXCEPTION 'AI agent action request transitions must increment revision by exactly one' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_ai_agent_membership_provenance_removal"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'AI membership provenance is append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_event_lifecycle_history"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id") THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'event_lifecycle_history is append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
CREATE FUNCTION "public"."protect_tenant_erasure_receipt"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'tenant erasure receipts are immutable evidence' USING ERRCODE = '55000';
	END IF;
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."organization_slug" IS DISTINCT FROM OLD."organization_slug"
		OR NEW."request_reference" IS DISTINCT FROM OLD."request_reference"
		OR NEW."approved_by" IS DISTINCT FROM OLD."approved_by"
		OR NEW."legal_basis" IS DISTINCT FROM OLD."legal_basis"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
		OR NEW."execute_after" IS DISTINCT FROM OLD."execute_after"
		OR NEW."backup_expires_at" IS DISTINCT FROM OLD."backup_expires_at"
		OR NEW."customer_export_sha256" IS DISTINCT FROM OLD."customer_export_sha256"
		OR NEW."evidence_archive_sha256" IS DISTINCT FROM OLD."evidence_archive_sha256"
		OR NEW."evidence_manifest_sha256" IS DISTINCT FROM OLD."evidence_manifest_sha256"
		OR NEW."archive_key_id" IS DISTINCT FROM OLD."archive_key_id"
		OR NEW."media_asset_count" IS DISTINCT FROM OLD."media_asset_count"
		OR NEW."storage_object_count" IS DISTINCT FROM OLD."storage_object_count"
		OR NEW."row_counts" IS DISTINCT FROM OLD."row_counts"
		OR NEW."policy_manifest" IS DISTINCT FROM OLD."policy_manifest"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'tenant erasure receipt evidence is immutable' USING ERRCODE = '55000';
	END IF;
	IF NOT (
		(OLD."status" = 'erasing' AND NEW."status" IN ('primary_erased', 'backup_retention_pending', 'completed', 'failed'))
		OR (OLD."status" IN ('primary_erased', 'backup_retention_pending') AND NEW."status" IN ('completed', 'failed'))
	) THEN
		RAISE EXCEPTION 'invalid tenant erasure receipt transition' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_tenant_erasure_receipt"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "tenant_erasure_receipts_protect_trigger"
BEFORE UPDATE OR DELETE ON "public"."tenant_erasure_receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_tenant_erasure_receipt"();
--> statement-breakpoint
CREATE TRIGGER "tenant_erasure_receipts_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."tenant_erasure_receipts"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."protect_tenant_erasure_receipt"();
--> statement-breakpoint
CREATE FUNCTION "public"."protect_tenant_erasure_event"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'tenant erasure events are append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_tenant_erasure_event"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "tenant_erasure_events_protect_trigger"
BEFORE UPDATE OR DELETE ON "public"."tenant_erasure_events"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_tenant_erasure_event"();
--> statement-breakpoint
CREATE TRIGGER "tenant_erasure_events_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."tenant_erasure_events"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."protect_tenant_erasure_event"();
