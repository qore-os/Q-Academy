CREATE TYPE "public"."media_upload_session_state" AS ENUM('uploading', 'completing', 'aborting');--> statement-breakpoint
CREATE TABLE "media_upload_sessions" (
	"asset_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_upload_id" varchar(1024) NOT NULL,
	"part_size_bytes" bigint NOT NULL,
	"expected_part_count" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" "media_upload_session_state" DEFAULT 'uploading' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_upload_sessions_provider_upload_id_check" CHECK (length("media_upload_sessions"."provider_upload_id") between 1 and 1024),
	CONSTRAINT "media_upload_sessions_part_size_check" CHECK ("media_upload_sessions"."part_size_bytes" >= 5242880),
	CONSTRAINT "media_upload_sessions_expected_part_count_check" CHECK ("media_upload_sessions"."expected_part_count" between 1 and 10000)
);
--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_asset_tenant_fk" FOREIGN KEY ("asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_upload_sessions_org_expiry_state_idx" ON "media_upload_sessions" USING btree ("organization_id","expires_at","state");