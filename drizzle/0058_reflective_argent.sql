CREATE TYPE "public"."email_bounce_kind" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TYPE "public"."email_feedback_event_type" AS ENUM('bounce', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."email_suppression_reason" AS ENUM('hard_bounce', 'soft_bounce', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."email_suppression_release_reason" AS ENUM('address_corrected', 'provider_error', 'member_request', 'other_verified');--> statement-breakpoint
CREATE TABLE "custom_domain_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"challenge_hash" varchar(64) NOT NULL,
	"challenge_expires_at" timestamp with time zone NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_code" varchar(32),
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domain_claims_hostname_check" CHECK ("custom_domain_claims"."hostname" = lower("custom_domain_claims"."hostname") and length("custom_domain_claims"."hostname") between 3 and 253 and "custom_domain_claims"."hostname" ~ '^[a-z0-9][a-z0-9.-]*[a-z0-9]$' and position('..' in "custom_domain_claims"."hostname") = 0 and position('.-' in "custom_domain_claims"."hostname") = 0 and position('-.' in "custom_domain_claims"."hostname") = 0),
	CONSTRAINT "custom_domain_claims_status_check" CHECK ("custom_domain_claims"."status" in ('pending', 'verified', 'revoked')),
	CONSTRAINT "custom_domain_claims_hash_check" CHECK ("custom_domain_claims"."challenge_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "custom_domain_claims_check_code_check" CHECK ("custom_domain_claims"."last_check_code" is null or "custom_domain_claims"."last_check_code" in ('verified', 'no_match', 'dns_error', 'timeout', 'expired')),
	CONSTRAINT "custom_domain_claims_state_check" CHECK (("custom_domain_claims"."status" = 'pending' and "custom_domain_claims"."verified_at" is null and "custom_domain_claims"."revoked_at" is null) or ("custom_domain_claims"."status" = 'verified' and "custom_domain_claims"."verified_at" is not null and "custom_domain_claims"."revoked_at" is null) or ("custom_domain_claims"."status" = 'revoked' and "custom_domain_claims"."revoked_at" is not null)),
	CONSTRAINT "custom_domain_claims_timeline_check" CHECK ("custom_domain_claims"."challenge_expires_at" > "custom_domain_claims"."created_at" and ("custom_domain_claims"."last_checked_at" is null or "custom_domain_claims"."last_checked_at" >= "custom_domain_claims"."created_at") and ("custom_domain_claims"."verified_at" is null or "custom_domain_claims"."verified_at" >= "custom_domain_claims"."created_at") and ("custom_domain_claims"."revoked_at" is null or "custom_domain_claims"."revoked_at" >= "custom_domain_claims"."created_at") and "custom_domain_claims"."updated_at" >= "custom_domain_claims"."created_at"),
	CONSTRAINT "custom_domain_claims_revision_check" CHECK ("custom_domain_claims"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "email_delivery_feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"external_event_id" varchar(180) NOT NULL,
	"event_type" "email_feedback_event_type" NOT NULL,
	"bounce_kind" "email_bounce_kind",
	"reason_code" varchar(120) NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_feedback_events_bounce_kind_check" CHECK (("email_delivery_feedback_events"."event_type" = 'bounce' and "email_delivery_feedback_events"."bounce_kind" is not null) or ("email_delivery_feedback_events"."event_type" = 'complaint' and "email_delivery_feedback_events"."bounce_kind" is null)),
	CONSTRAINT "email_feedback_events_payload_hash_check" CHECK ("email_delivery_feedback_events"."payload_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient_hash" varchar(64) NOT NULL,
	"reason" "email_suppression_reason" NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"first_occurred_at" timestamp with time zone NOT NULL,
	"last_occurred_at" timestamp with time zone NOT NULL,
	"source_delivery_id" uuid,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_by_id" uuid,
	"release_reason" "email_suppression_release_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suppressions_occurrence_count_check" CHECK ("email_suppressions"."occurrence_count" > 0),
	CONSTRAINT "email_suppressions_recipient_hash_check" CHECK ("email_suppressions"."recipient_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "email_suppressions_release_lifecycle_check" CHECK (("email_suppressions"."released_at" is null and "email_suppressions"."released_by_id" is null and "email_suppressions"."release_reason" is null) or ("email_suppressions"."released_at" is not null and "email_suppressions"."release_reason" is not null)),
	CONSTRAINT "email_suppressions_reason_expiry_check" CHECK (("email_suppressions"."reason" = 'soft_bounce' and "email_suppressions"."expires_at" is not null) or ("email_suppressions"."reason" in ('hard_bounce', 'complaint') and "email_suppressions"."expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "organization_contracts" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"plan_code" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"seat_limit" integer,
	"course_limit" integer,
	"storage_limit_bytes" bigint,
	"ai_monthly_credits" integer,
	"feature_entitlements" text[] DEFAULT '{}' NOT NULL,
	"external_reference" varchar(255),
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_contracts_plan_code_check" CHECK ("organization_contracts"."plan_code" ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
	CONSTRAINT "organization_contracts_status_check" CHECK ("organization_contracts"."status" in ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
	CONSTRAINT "organization_contracts_seat_limit_check" CHECK ("organization_contracts"."seat_limit" is null or "organization_contracts"."seat_limit" >= 1),
	CONSTRAINT "organization_contracts_course_limit_check" CHECK ("organization_contracts"."course_limit" is null or "organization_contracts"."course_limit" >= 1),
	CONSTRAINT "organization_contracts_storage_limit_check" CHECK ("organization_contracts"."storage_limit_bytes" is null or "organization_contracts"."storage_limit_bytes" >= 1048576),
	CONSTRAINT "organization_contracts_ai_credit_check" CHECK ("organization_contracts"."ai_monthly_credits" is null or "organization_contracts"."ai_monthly_credits" >= 0),
	CONSTRAINT "organization_contracts_entitlements_check" CHECK (cardinality("organization_contracts"."feature_entitlements") <= 64 and (cardinality("organization_contracts"."feature_entitlements") = 0 or array_to_string("organization_contracts"."feature_entitlements", ',') ~ '^([a-z][a-z0-9_.-]{1,63})(,[a-z][a-z0-9_.-]{1,63})*$')),
	CONSTRAINT "organization_contracts_revision_check" CHECK ("organization_contracts"."revision" >= 1),
	CONSTRAINT "organization_contracts_timeline_check" CHECK ("organization_contracts"."ends_at" is null or "organization_contracts"."ends_at" > "organization_contracts"."starts_at"),
	CONSTRAINT "organization_contracts_updated_check" CHECK ("organization_contracts"."updated_at" >= "organization_contracts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN "personalization_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD COLUMN "storage_version_id" varchar(1024);--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD COLUMN "storage_etag" varchar(255);--> statement-breakpoint
ALTER TABLE "custom_domain_claims" ADD CONSTRAINT "custom_domain_claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_domain_claims" ADD CONSTRAINT "custom_domain_claims_creator_tenant_fk" FOREIGN KEY ("created_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_id_org_idx" ON "email_deliveries" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "email_delivery_feedback_events" ADD CONSTRAINT "email_feedback_events_delivery_org_fk" FOREIGN KEY ("delivery_id","organization_id") REFERENCES "public"."email_deliveries"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_source_delivery_id_email_deliveries_id_fk" FOREIGN KEY ("source_delivery_id") REFERENCES "public"."email_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_released_by_id_users_id_fk" FOREIGN KEY ("released_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_user_org_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_contracts" ADD CONSTRAINT "organization_contracts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_claims_id_org_idx" ON "custom_domain_claims" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_claims_active_hostname_idx" ON "custom_domain_claims" USING btree ("hostname") WHERE "custom_domain_claims"."status" <> 'revoked';--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domain_claims_active_org_idx" ON "custom_domain_claims" USING btree ("organization_id") WHERE "custom_domain_claims"."status" <> 'revoked';--> statement-breakpoint
CREATE INDEX "custom_domain_claims_org_status_idx" ON "custom_domain_claims" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_feedback_events_org_external_idx" ON "email_delivery_feedback_events" USING btree ("organization_id","external_event_id");--> statement-breakpoint
CREATE INDEX "email_feedback_events_delivery_idx" ON "email_delivery_feedback_events" USING btree ("organization_id","delivery_id","occurred_at");--> statement-breakpoint
CREATE INDEX "email_feedback_events_created_idx" ON "email_delivery_feedback_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_suppressions_active_recipient_idx" ON "email_suppressions" USING btree ("organization_id","recipient_hash") WHERE "email_suppressions"."released_at" is null;--> statement-breakpoint
CREATE INDEX "email_suppressions_org_status_idx" ON "email_suppressions" USING btree ("organization_id","released_at","expires_at");--> statement-breakpoint
CREATE INDEX "email_suppressions_user_idx" ON "email_suppressions" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
CREATE INDEX "organization_contracts_status_idx" ON "organization_contracts" USING btree ("status","ends_at");--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_personalization_check" CHECK ("custom_field_definitions"."personalization_enabled" = false or ("custom_field_definitions"."visibility"::text = 'member' and "custom_field_definitions"."type"::text not in ('url', 'media')));--> statement-breakpoint
ALTER TABLE "media_asset_derivatives" ADD CONSTRAINT "media_asset_derivatives_storage_identity_check" CHECK (("media_asset_derivatives"."storage_driver" = 'filesystem' and "media_asset_derivatives"."storage_version_id" is null and "media_asset_derivatives"."storage_etag" is null) or ("media_asset_derivatives"."storage_driver" = 's3' and "media_asset_derivatives"."storage_version_id" is not null and btrim("media_asset_derivatives"."storage_version_id") <> '' and "media_asset_derivatives"."storage_etag" is not null and btrim("media_asset_derivatives"."storage_etag") <> ''));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_contract_floor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  current_seats bigint;
  current_courses bigint;
  current_storage bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-seat-limit:' || NEW.organization_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-course-limit:' || NEW.organization_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-storage-limit:' || NEW.organization_id::text, 0));

  IF NEW.seat_limit IS NOT NULL THEN
    SELECT count(*) INTO current_seats
    FROM users
    WHERE organization_id = NEW.organization_id
      AND status IN ('active', 'invited');
    IF current_seats > NEW.seat_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'organization_seat_limit_enforced',
        MESSAGE = 'Organization seat limit is below current usage.';
    END IF;
  END IF;

  IF NEW.course_limit IS NOT NULL THEN
    SELECT count(*) INTO current_courses
    FROM courses
    WHERE organization_id = NEW.organization_id
      AND status <> 'archived';
    IF current_courses > NEW.course_limit THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'organization_course_limit_enforced',
        MESSAGE = 'Organization course limit is below current usage.';
    END IF;
  END IF;

  IF NEW.storage_limit_bytes IS NOT NULL THEN
    SELECT
      coalesce((
        SELECT sum(quota_bytes)
        FROM media_assets
        WHERE organization_id = NEW.organization_id
          AND deleted_at IS NULL
      ), 0) +
      coalesce((
        SELECT sum(size_bytes)
        FROM media_asset_derivatives
        WHERE organization_id = NEW.organization_id
      ), 0)
    INTO current_storage;
    IF current_storage > NEW.storage_limit_bytes THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'organization_storage_limit_enforced',
        MESSAGE = 'Organization storage limit is below current usage.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_contracts_limit_floor
BEFORE INSERT OR UPDATE OF organization_id, seat_limit, course_limit, storage_limit_bytes
ON organization_contracts
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_contract_floor();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  configured_limit integer;
  current_usage bigint;
BEGIN
  IF NEW.status NOT IN ('active', 'invited') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-seat-limit:' || NEW.organization_id::text, 0));
  SELECT seat_limit INTO configured_limit
  FROM organization_contracts
  WHERE organization_id = NEW.organization_id
  FOR UPDATE;
  IF configured_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO current_usage
  FROM users
  WHERE organization_id = NEW.organization_id
    AND status IN ('active', 'invited')
    AND id <> NEW.id;
  IF current_usage + 1 > configured_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'organization_seat_limit_enforced',
      MESSAGE = 'Organization seat limit is reached.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER users_contract_seat_limit
BEFORE INSERT OR UPDATE OF organization_id, status
ON users
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_seat_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_course_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  configured_limit integer;
  current_usage bigint;
BEGIN
  IF NEW.status = 'archived' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-course-limit:' || NEW.organization_id::text, 0));
  SELECT course_limit INTO configured_limit
  FROM organization_contracts
  WHERE organization_id = NEW.organization_id
  FOR UPDATE;
  IF configured_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT count(*) INTO current_usage
  FROM courses
  WHERE organization_id = NEW.organization_id
    AND status <> 'archived'
    AND id <> NEW.id;
  IF current_usage + 1 > configured_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'organization_course_limit_enforced',
      MESSAGE = 'Organization course limit is reached.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER courses_contract_course_limit
BEFORE INSERT OR UPDATE OF organization_id, status
ON courses
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_course_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_media_asset_storage_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  configured_limit bigint;
  current_usage bigint;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-storage-limit:' || NEW.organization_id::text, 0));
  SELECT storage_limit_bytes INTO configured_limit
  FROM organization_contracts
  WHERE organization_id = NEW.organization_id
  FOR UPDATE;
  IF configured_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT
    coalesce((
      SELECT sum(quota_bytes)
      FROM media_assets
      WHERE organization_id = NEW.organization_id
        AND deleted_at IS NULL
        AND id <> NEW.id
    ), 0) +
    coalesce((
      SELECT sum(size_bytes)
      FROM media_asset_derivatives
      WHERE organization_id = NEW.organization_id
    ), 0)
  INTO current_usage;
  IF current_usage + NEW.quota_bytes > configured_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'organization_storage_limit_enforced',
      MESSAGE = 'Organization storage limit is reached.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_assets_contract_storage_limit
BEFORE INSERT OR UPDATE OF organization_id, quota_bytes, deleted_at
ON media_assets
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_media_asset_storage_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_media_derivative_storage_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  configured_limit bigint;
  current_usage bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('organization-storage-limit:' || NEW.organization_id::text, 0));
  SELECT storage_limit_bytes INTO configured_limit
  FROM organization_contracts
  WHERE organization_id = NEW.organization_id
  FOR UPDATE;
  IF configured_limit IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT
    coalesce((
      SELECT sum(quota_bytes)
      FROM media_assets
      WHERE organization_id = NEW.organization_id
        AND deleted_at IS NULL
    ), 0) +
    coalesce((
      SELECT sum(size_bytes)
      FROM media_asset_derivatives
      WHERE organization_id = NEW.organization_id
        AND id <> NEW.id
    ), 0)
  INTO current_usage;
  IF current_usage + NEW.size_bytes > configured_limit THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'organization_storage_limit_enforced',
      MESSAGE = 'Organization storage limit is reached.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER media_asset_derivatives_contract_storage_limit
BEFORE INSERT OR UPDATE OF organization_id, size_bytes
ON media_asset_derivatives
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_media_derivative_storage_limit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION q_academy_enforce_email_suppression_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  validate_source boolean := TG_OP = 'INSERT';
  validate_releaser boolean := TG_OP = 'INSERT';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    validate_source := NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.source_delivery_id IS DISTINCT FROM OLD.source_delivery_id;
    validate_releaser := NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.released_by_id IS DISTINCT FROM OLD.released_by_id;
  END IF;
  IF validate_source AND NEW.source_delivery_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM email_deliveries
    WHERE id = NEW.source_delivery_id
      AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'email_suppressions_source_tenant_enforced',
      MESSAGE = 'Suppression source delivery belongs to another organization.';
  END IF;
  IF validate_releaser AND NEW.released_by_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM users
    WHERE id = NEW.released_by_id
      AND organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      CONSTRAINT = 'email_suppressions_releaser_tenant_enforced',
      MESSAGE = 'Suppression releaser belongs to another organization.';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER email_suppressions_tenant_guard
BEFORE INSERT OR UPDATE OF organization_id, source_delivery_id, released_by_id
ON email_suppressions
FOR EACH ROW
EXECUTE FUNCTION q_academy_enforce_email_suppression_tenant();
