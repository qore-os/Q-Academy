CREATE TYPE "public"."media_asset_kind" AS ENUM('image', 'audio', 'video', 'document');--> statement-breakpoint
CREATE TYPE "public"."media_asset_purpose" AS ENUM('course_content', 'submission', 'avatar', 'branding');--> statement-breakpoint
CREATE TYPE "public"."media_asset_status" AS ENUM('pending', 'uploaded', 'scanning', 'ready', 'quarantined', 'failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."media_storage_driver" AS ENUM('filesystem', 's3');--> statement-breakpoint
CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"uploaded_by_id" uuid,
	"owner_user_id" uuid,
	"purpose" "media_asset_purpose" NOT NULL,
	"kind" "media_asset_kind" NOT NULL,
	"status" "media_asset_status" DEFAULT 'pending' NOT NULL,
	"storage_driver" "media_storage_driver" NOT NULL,
	"storage_key" text NOT NULL,
	"staging_storage_key" text NOT NULL,
	"original_file_name" varchar(255) NOT NULL,
	"safe_file_name" varchar(120) NOT NULL,
	"declared_mime_type" varchar(180) NOT NULL,
	"detected_mime_type" varchar(180),
	"declared_size_bytes" bigint NOT NULL,
	"actual_size_bytes" bigint,
	"quota_bytes" bigint NOT NULL,
	"etag" varchar(255),
	"upload_expires_at" timestamp with time zone NOT NULL,
	"uploaded_at" timestamp with time zone,
	"scan_attempt" integer DEFAULT 0 NOT NULL,
	"scan_claim_token" uuid,
	"scan_claimed_at" timestamp with time zone,
	"scan_lease_expires_at" timestamp with time zone,
	"scan_next_retry_at" timestamp with time zone,
	"scan_completed_at" timestamp with time zone,
	"scan_failure_code" varchar(80),
	"scan_failure_detail" text,
	"malware_signature" varchar(255),
	"deleted_at" timestamp with time zone,
	"storage_deleted_at" timestamp with time zone,
	"staging_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_declared_size_check" CHECK ("media_assets"."declared_size_bytes" > 0),
	CONSTRAINT "media_assets_storage_key_namespace_check" CHECK ("media_assets"."storage_key" like ('tenants/' || "media_assets"."organization_id"::text || '/assets/' || "media_assets"."id"::text || '/%')),
	CONSTRAINT "media_assets_staging_key_namespace_check" CHECK ("media_assets"."staging_storage_key" like ('incoming/tenants/' || "media_assets"."organization_id"::text || '/assets/' || "media_assets"."id"::text || '/%')),
	CONSTRAINT "media_assets_distinct_storage_keys_check" CHECK ("media_assets"."storage_key" <> "media_assets"."staging_storage_key"),
	CONSTRAINT "media_assets_safe_file_name_check" CHECK ("media_assets"."safe_file_name" ~ '^[a-z0-9][a-z0-9_-]{0,114}[.][a-z0-9]{1,8}$'),
	CONSTRAINT "media_assets_actual_size_check" CHECK ("media_assets"."actual_size_bytes" is null or "media_assets"."actual_size_bytes" > 0),
	CONSTRAINT "media_assets_scan_attempt_check" CHECK ("media_assets"."scan_attempt" >= 0),
	CONSTRAINT "media_assets_quota_state_check" CHECK (("media_assets"."status" = 'deleted' and "media_assets"."deleted_at" is not null and ("media_assets"."quota_bytes" = "media_assets"."declared_size_bytes" or ("media_assets"."quota_bytes" = 0 and "media_assets"."storage_deleted_at" is not null and "media_assets"."staging_deleted_at" >= "media_assets"."upload_expires_at" + interval '1 hour'))) or ("media_assets"."status" <> 'deleted' and "media_assets"."quota_bytes" = "media_assets"."declared_size_bytes" and "media_assets"."deleted_at" is null)),
	CONSTRAINT "media_assets_upload_state_check" CHECK ("media_assets"."status" = 'deleted' or ("media_assets"."status" = 'pending' and "media_assets"."actual_size_bytes" is null and "media_assets"."uploaded_at" is null) or ("media_assets"."status" in ('uploaded', 'scanning', 'ready', 'quarantined', 'failed') and "media_assets"."actual_size_bytes" is not null and "media_assets"."uploaded_at" is not null)),
	CONSTRAINT "media_assets_scan_lease_state_check" CHECK (("media_assets"."status" = 'scanning' and "media_assets"."scan_claim_token" is not null and "media_assets"."scan_claimed_at" is not null and "media_assets"."scan_lease_expires_at" is not null) or ("media_assets"."status" <> 'scanning' and "media_assets"."scan_claim_token" is null and "media_assets"."scan_claimed_at" is null and "media_assets"."scan_lease_expires_at" is null)),
	CONSTRAINT "media_assets_scan_completion_state_check" CHECK ("media_assets"."status" = 'deleted' or ("media_assets"."status" in ('ready', 'quarantined', 'failed') and "media_assets"."scan_completed_at" is not null) or ("media_assets"."status" in ('pending', 'uploaded', 'scanning') and "media_assets"."scan_completed_at" is null)),
	CONSTRAINT "media_assets_malware_state_check" CHECK ("media_assets"."malware_signature" is null or "media_assets"."status" in ('quarantined', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "submission_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_attachments_sort_order_check" CHECK ("submission_attachments"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_id_organization_idx" ON "users" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_id_organization_idx" ON "submissions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_id_organization_idx" ON "media_assets" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploader_tenant_fk" FOREIGN KEY ("uploaded_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_owner_tenant_fk" FOREIGN KEY ("owner_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_submission_tenant_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."submissions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_attachments" ADD CONSTRAINT "submission_attachments_media_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_idx" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_staging_storage_key_idx" ON "media_assets" USING btree ("staging_storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_org_created_idx" ON "media_assets" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_org_status_idx" ON "media_assets" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "media_assets_org_owner_idx" ON "media_assets" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "media_assets_scan_queue_idx" ON "media_assets" USING btree ("status","scan_next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX "media_assets_scan_lease_idx" ON "media_assets" USING btree ("status","scan_lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_attachments_media_asset_idx" ON "submission_attachments" USING btree ("media_asset_id");--> statement-breakpoint
CREATE INDEX "submission_attachments_org_submission_idx" ON "submission_attachments" USING btree ("organization_id","submission_id","sort_order");--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_submission_tenant_fk" FOREIGN KEY ("submission_id","organization_id") REFERENCES "public"."submissions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_reviewer_tenant_fk" FOREIGN KEY ("reviewer_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_supersedes_tenant_fk" FOREIGN KEY ("supersedes_id","organization_id") REFERENCES "public"."submissions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "submissions" current_submission
		JOIN "submissions" predecessor ON predecessor."id" = current_submission."supersedes_id"
		WHERE current_submission."supersedes_id" IS NOT NULL
			AND (
				current_submission."organization_id" IS DISTINCT FROM predecessor."organization_id"
				OR current_submission."user_id" IS DISTINCT FROM predecessor."user_id"
				OR current_submission."course_id" IS DISTINCT FROM predecessor."course_id"
				OR current_submission."lesson_id" IS DISTINCT FROM predecessor."lesson_id"
				OR current_submission."block_id" IS DISTINCT FROM predecessor."block_id"
				OR current_submission."attempt_number" <> predecessor."attempt_number" + 1
			)
	) THEN
		RAISE EXCEPTION 'existing submission supersession chain is inconsistent' USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "enforce_submission_supersession_chain"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	predecessor "submissions"%ROWTYPE;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW."supersedes_id" IS DISTINCT FROM OLD."supersedes_id"
			OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
			OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
			OR NEW."course_id" IS DISTINCT FROM OLD."course_id"
			OR NEW."lesson_id" IS DISTINCT FROM OLD."lesson_id"
			OR NEW."block_id" IS DISTINCT FROM OLD."block_id"
			OR NEW."attempt_number" IS DISTINCT FROM OLD."attempt_number"
		THEN
			RAISE EXCEPTION 'submission identity and supersession fields are immutable' USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."supersedes_id" IS NOT NULL THEN
		SELECT * INTO predecessor FROM "submissions" WHERE "id" = NEW."supersedes_id";
		IF FOUND AND (
			NEW."organization_id" IS DISTINCT FROM predecessor."organization_id"
			OR NEW."user_id" IS DISTINCT FROM predecessor."user_id"
			OR NEW."course_id" IS DISTINCT FROM predecessor."course_id"
			OR NEW."lesson_id" IS DISTINCT FROM predecessor."lesson_id"
			OR NEW."block_id" IS DISTINCT FROM predecessor."block_id"
			OR NEW."attempt_number" <> predecessor."attempt_number" + 1
		) THEN
			RAISE EXCEPTION 'submission supersession chain is inconsistent' USING ERRCODE = '23514';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submissions_enforce_supersession_chain"
BEFORE INSERT OR UPDATE OF "supersedes_id", "organization_id", "user_id", "course_id", "lesson_id", "block_id", "attempt_number" ON "submissions"
FOR EACH ROW
EXECUTE FUNCTION "enforce_submission_supersession_chain"();--> statement-breakpoint
CREATE FUNCTION "enforce_submission_attachment_asset"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	asset "media_assets"%ROWTYPE;
	submission_owner_id uuid;
BEGIN
	SELECT * INTO asset
	FROM "media_assets"
	WHERE "id" = NEW."media_asset_id"
		AND "organization_id" = NEW."organization_id"
	FOR KEY SHARE;
	SELECT "user_id" INTO submission_owner_id
	FROM "submissions"
	WHERE "id" = NEW."submission_id"
		AND "organization_id" = NEW."organization_id";
	IF NOT FOUND
		OR asset."id" IS NULL
		OR asset."purpose" <> 'submission'
		OR asset."status" <> 'ready'
		OR asset."deleted_at" IS NOT NULL
		OR asset."owner_user_id" IS DISTINCT FROM submission_owner_id
	THEN
		RAISE EXCEPTION 'submission attachments require a ready same-tenant asset owned by the submitting user' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submission_attachments_enforce_asset"
BEFORE INSERT ON "submission_attachments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_submission_attachment_asset"();--> statement-breakpoint
CREATE FUNCTION "prevent_submission_attachment_rebind"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'submission attachment relationships are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submission_attachments_prevent_rebind"
BEFORE UPDATE OF "organization_id", "submission_id", "media_asset_id" ON "submission_attachments"
FOR EACH ROW
EXECUTE FUNCTION "prevent_submission_attachment_rebind"();--> statement-breakpoint
CREATE FUNCTION "prevent_attached_media_asset_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."status" = 'deleted'
		AND OLD."status" = 'scanning'
		AND OLD."scan_lease_expires_at" > now()
	THEN
		RAISE EXCEPTION 'actively scanned media assets cannot be deleted' USING ERRCODE = '55000';
	END IF;
	IF NEW."status" = 'deleted'
		AND OLD."status" <> 'deleted'
		AND EXISTS (
			SELECT 1 FROM "submission_attachments"
			WHERE "media_asset_id" = OLD."id"
				AND "organization_id" = OLD."organization_id"
		)
	THEN
		RAISE EXCEPTION 'attached media assets cannot be deleted' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "media_assets_prevent_attached_delete"
BEFORE UPDATE OF "status" ON "media_assets"
FOR EACH ROW
EXECUTE FUNCTION "prevent_attached_media_asset_delete"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_submission_review_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."reviewer_id" IS NOT NULL
		AND NEW."reviewer_id" IS NULL
		AND NEW."id" IS NOT DISTINCT FROM OLD."id"
		AND NEW."organization_id" IS NOT DISTINCT FROM OLD."organization_id"
		AND NEW."submission_id" IS NOT DISTINCT FROM OLD."submission_id"
		AND NEW."decision" IS NOT DISTINCT FROM OLD."decision"
		AND NEW."feedback" IS NOT DISTINCT FROM OLD."feedback"
		AND NEW."score" IS NOT DISTINCT FROM OLD."score"
		AND NEW."reviewed_at" IS NOT DISTINCT FROM OLD."reviewed_at"
	THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'submission review history is immutable' USING ERRCODE = '55000';
END;
$$;
