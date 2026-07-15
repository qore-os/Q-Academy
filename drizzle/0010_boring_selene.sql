CREATE TYPE "public"."email_delivery_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event" varchar(120) NOT NULL,
	"recipient_email" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "email_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"next_retry_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_deliveries_org_created_idx" ON "email_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_status_retry_idx" ON "email_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "email_deliveries_processing_claim_idx" ON "email_deliveries" USING btree ("status","claimed_at");