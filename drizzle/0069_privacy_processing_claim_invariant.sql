LOCK TABLE "privacy_requests" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
UPDATE "privacy_export_artifacts" AS "artifact"
SET
	"status" = 'failed',
	"failure_code" = 'processing_claim_invariant_migration',
	"failure_detail" = NULL,
	"updated_at" = clock_timestamp()
FROM "privacy_requests" AS "request"
WHERE "artifact"."request_id" = "request"."id"
	AND "artifact"."organization_id" = "request"."organization_id"
	AND "artifact"."status" = 'building'
	AND "request"."status" = 'processing'
	AND (
		"request"."processing_claim_token" IS NULL
		OR "request"."processing_claimed_at" IS NULL
		OR "request"."processing_lease_expires_at" IS NULL
		OR "request"."processing_lease_expires_at" <= "request"."processing_claimed_at"
	);--> statement-breakpoint
UPDATE "privacy_requests"
SET
	"status" = 'failed',
	"status_reason" = 'processing_claim_invariant_migration',
	"processing_claim_token" = NULL,
	"processing_claimed_at" = NULL,
	"processing_lease_expires_at" = NULL,
	"updated_at" = clock_timestamp()
WHERE "status" = 'processing'
	AND (
		"processing_claim_token" IS NULL
		OR "processing_claimed_at" IS NULL
		OR "processing_lease_expires_at" IS NULL
		OR "processing_lease_expires_at" <= "processing_claimed_at"
	);--> statement-breakpoint
UPDATE "privacy_requests"
SET
	"processing_claim_token" = NULL,
	"processing_claimed_at" = NULL,
	"processing_lease_expires_at" = NULL,
	"updated_at" = clock_timestamp()
WHERE "status" <> 'processing'
	AND (
		"processing_claim_token" IS NOT NULL
		OR "processing_claimed_at" IS NOT NULL
		OR "processing_lease_expires_at" IS NOT NULL
	);--> statement-breakpoint
ALTER TABLE "privacy_requests" DROP CONSTRAINT "privacy_requests_processing_claim_check";--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_processing_claim_check" CHECK (("privacy_requests"."status" = 'processing' and "privacy_requests"."processing_claim_token" is not null and "privacy_requests"."processing_claimed_at" is not null and "privacy_requests"."processing_lease_expires_at" is not null and "privacy_requests"."processing_lease_expires_at" > "privacy_requests"."processing_claimed_at") or ("privacy_requests"."status" <> 'processing' and "privacy_requests"."processing_claim_token" is null and "privacy_requests"."processing_claimed_at" is null and "privacy_requests"."processing_lease_expires_at" is null)) NOT VALID;--> statement-breakpoint
ALTER TABLE "privacy_requests" VALIDATE CONSTRAINT "privacy_requests_processing_claim_check";
