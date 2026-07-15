ALTER TABLE "webhook_deliveries" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "webhook_deliveries_processing_claim_idx" ON "webhook_deliveries" USING btree ("status","claimed_at");