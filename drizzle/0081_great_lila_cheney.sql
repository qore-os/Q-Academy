CREATE TABLE "video_description_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"origin_course_id" uuid,
	"live_block_id" uuid,
	"block_reference_id" uuid NOT NULL,
	"live_source_asset_id" uuid,
	"source_asset_reference_id" uuid NOT NULL,
	"requested_by_id" uuid,
	"requester_subject_reference" varchar(64),
	"source_content_sha256" varchar(64) NOT NULL,
	"locale" varchar(5) NOT NULL,
	"transcript_language" varchar(35) NOT NULL,
	"expected_block_revision" integer NOT NULL,
	"request_key" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 6 NOT NULL,
	"claim_token" uuid,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"generated_description" varchar(900),
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_description_jobs_digest_check" CHECK ("video_description_jobs"."source_content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "video_description_jobs_requester_reference_check" CHECK (("video_description_jobs"."requester_subject_reference" is null or "video_description_jobs"."requester_subject_reference" ~ '^[0-9a-f]{64}$') and ("video_description_jobs"."requested_by_id" is null or "video_description_jobs"."requester_subject_reference" is not null)),
	CONSTRAINT "video_description_jobs_locale_check" CHECK ("video_description_jobs"."locale" in ('de','en','it','es','fr')),
	CONSTRAINT "video_description_jobs_transcript_language_check" CHECK ("video_description_jobs"."transcript_language" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
	CONSTRAINT "video_description_jobs_attempt_check" CHECK ("video_description_jobs"."attempt" >= 0 and "video_description_jobs"."max_attempts" between 1 and 10 and "video_description_jobs"."attempt" <= "video_description_jobs"."max_attempts"),
	CONSTRAINT "video_description_jobs_revision_check" CHECK ("video_description_jobs"."expected_block_revision" > 0),
	CONSTRAINT "video_description_jobs_deadline_check" CHECK ("video_description_jobs"."deadline_at" > "video_description_jobs"."created_at"),
	CONSTRAINT "video_description_jobs_lease_check" CHECK (("video_description_jobs"."status" = 'processing' and "video_description_jobs"."claim_token" is not null and "video_description_jobs"."claimed_at" is not null and "video_description_jobs"."lease_expires_at" is not null) or ("video_description_jobs"."status" <> 'processing' and "video_description_jobs"."claim_token" is null and "video_description_jobs"."claimed_at" is null and "video_description_jobs"."lease_expires_at" is null)),
	CONSTRAINT "video_description_jobs_completion_check" CHECK (("video_description_jobs"."status" in ('succeeded','failed','superseded') and "video_description_jobs"."completed_at" is not null) or ("video_description_jobs"."status" in ('queued','processing') and "video_description_jobs"."completed_at" is null)),
	CONSTRAINT "video_description_jobs_generated_description_check" CHECK (("video_description_jobs"."generated_description" is null or length(btrim("video_description_jobs"."generated_description")) between 1 and 900) and ("video_description_jobs"."status" not in ('succeeded','failed','superseded') or "video_description_jobs"."generated_description" is null))
);
--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" DROP CONSTRAINT "orbit_transfer_jobs_state_check";--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "direct_upload_claim_token" uuid;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "direct_upload_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "orbit_transfer_jobs" AS job
		JOIN "orbit_transfer_items" AS item
			ON item."job_id" = job."id"
			AND item."kind" = 'media_asset'
		LEFT JOIN "media_assets" AS source
			ON source."id" = item."source_id"
			AND source."organization_id" = job."source_organization_id"
		WHERE job."status" = 'processing'
			AND (
				source."id" IS NULL
				OR source."actual_size_bytes" IS NULL
				OR source."actual_size_bytes" <= 0
				OR source."content_sha256" IS NULL
				OR source."content_sha256" <> item."checksum"
			)
	) THEN
		RAISE EXCEPTION 'legacy Orbit transfer media cannot be reconstructed safely';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "orbit_transfer_jobs" AS job
		JOIN "orbit_transfer_items" AS item
			ON item."job_id" = job."id"
			AND item."kind" = 'media_asset'
		JOIN "media_assets" AS target ON target."id" = item."target_id"
		WHERE job."status" = 'processing'
	) THEN
		RAISE EXCEPTION 'legacy Orbit transfer target media id already exists';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "media_assets" DISABLE TRIGGER "media_assets_contract_storage_limit";--> statement-breakpoint
INSERT INTO "media_assets" (
	"id",
	"organization_id",
	"purpose",
	"kind",
	"status",
	"storage_driver",
	"storage_key",
	"staging_storage_key",
	"original_file_name",
	"safe_file_name",
	"declared_mime_type",
	"declared_size_bytes",
	"quota_bytes",
	"upload_expires_at",
	"created_at",
	"updated_at"
)
SELECT
	item."target_id",
	job."target_organization_id",
	'course_content',
	source."kind",
	'pending',
	source."storage_driver",
	'tenants/' || job."target_organization_id"::text || '/assets/' || item."target_id"::text || '/' || regexp_replace(source."storage_key", '^.*/', ''),
	'incoming/tenants/' || job."target_organization_id"::text || '/assets/' || item."target_id"::text || '/' || regexp_replace(source."staging_storage_key", '^.*/', ''),
	source."original_file_name",
	source."safe_file_name",
	source."declared_mime_type",
	source."actual_size_bytes",
	source."actual_size_bytes",
	now() + interval '15 minutes',
	now(),
	now()
FROM "orbit_transfer_jobs" AS job
JOIN "orbit_transfer_items" AS item
	ON item."job_id" = job."id"
	AND item."kind" = 'media_asset'
JOIN "media_assets" AS source
	ON source."id" = item."source_id"
	AND source."organization_id" = job."source_organization_id"
WHERE job."status" = 'processing';--> statement-breakpoint
ALTER TABLE "media_assets" ENABLE TRIGGER "media_assets_contract_storage_limit";--> statement-breakpoint
UPDATE "orbit_transfer_items" AS item
SET "metadata" = item."metadata" || jsonb_build_object(
	'legacyRecovery', true,
	'cleanupReservationId', item."target_id"::text
)
FROM "orbit_transfer_jobs" AS job
WHERE item."job_id" = job."id"
	AND item."kind" = 'media_asset'
	AND job."status" = 'processing';--> statement-breakpoint
UPDATE "orbit_transfer_jobs"
SET "claim_token" = gen_random_uuid(),
    "lease_expires_at" = now() + interval '15 minutes',
    "updated_at" = greatest("updated_at", now())
WHERE "status" = 'processing';--> statement-breakpoint
ALTER TABLE "video_description_jobs" ADD CONSTRAINT "video_description_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_description_jobs" ADD CONSTRAINT "video_description_jobs_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_description_jobs" ADD CONSTRAINT "video_description_jobs_requester_tenant_fk" FOREIGN KEY ("requested_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_description_jobs_request_key_idx" ON "video_description_jobs" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "video_description_jobs_queue_idx" ON "video_description_jobs" USING btree ("status","next_retry_at","created_at");--> statement-breakpoint
CREATE INDEX "orbit_transfer_jobs_lease_idx" ON "orbit_transfer_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_direct_upload_claim_check" CHECK (("media_assets"."direct_upload_claim_token" is null and "media_assets"."direct_upload_claimed_at" is null) or ("media_assets"."direct_upload_claim_token" is not null and "media_assets"."direct_upload_claimed_at" is not null and "media_assets"."storage_driver" = 's3' and "media_assets"."status" = 'pending'));--> statement-breakpoint
ALTER TABLE "orbit_transfer_jobs" ADD CONSTRAINT "orbit_transfer_jobs_state_check" CHECK (("orbit_transfer_jobs"."status" = 'planned' and "orbit_transfer_jobs"."started_at" is null and "orbit_transfer_jobs"."claim_token" is null and "orbit_transfer_jobs"."lease_expires_at" is null and "orbit_transfer_jobs"."completed_at" is null and "orbit_transfer_jobs"."failure_code" is null and cardinality("orbit_transfer_jobs"."target_course_ids") = 0) or ("orbit_transfer_jobs"."status" = 'processing' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."claim_token" is not null and "orbit_transfer_jobs"."lease_expires_at" is not null and "orbit_transfer_jobs"."completed_at" is null and "orbit_transfer_jobs"."failure_code" is null) or ("orbit_transfer_jobs"."status" = 'completed' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."claim_token" is null and "orbit_transfer_jobs"."lease_expires_at" is null and "orbit_transfer_jobs"."completed_at" is not null and "orbit_transfer_jobs"."failure_code" is null and cardinality("orbit_transfer_jobs"."target_course_ids") = cardinality("orbit_transfer_jobs"."source_course_ids")) or ("orbit_transfer_jobs"."status" = 'failed' and "orbit_transfer_jobs"."started_at" is not null and "orbit_transfer_jobs"."claim_token" is null and "orbit_transfer_jobs"."lease_expires_at" is null and "orbit_transfer_jobs"."completed_at" is not null and "orbit_transfer_jobs"."failure_code" is not null));
