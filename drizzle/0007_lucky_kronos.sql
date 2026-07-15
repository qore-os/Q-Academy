-- Legacy rows contain plaintext responses and cannot be upgraded safely.
DELETE FROM "api_idempotency_keys";--> statement-breakpoint
DROP INDEX "api_idempotency_org_key_idx";--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ALTER COLUMN "response_status" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ALTER COLUMN "response_body" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD COLUMN "status" varchar(16) DEFAULT 'processing' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD COLUMN "claim_token" uuid NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "api_idempotency_org_api_key_key_idx" ON "api_idempotency_keys" USING btree ("organization_id","api_key_id","key");--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_status_check" CHECK ("api_idempotency_keys"."status" in ('processing', 'completed'));--> statement-breakpoint
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_response_state_check" CHECK (("api_idempotency_keys"."status" = 'processing' and "api_idempotency_keys"."response_status" is null and "api_idempotency_keys"."response_body" is null) or ("api_idempotency_keys"."status" = 'completed' and "api_idempotency_keys"."response_status" is not null and "api_idempotency_keys"."response_body" is not null));
