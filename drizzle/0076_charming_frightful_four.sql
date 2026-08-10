ALTER TABLE "media_upload_sessions" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ALTER COLUMN "state" TYPE varchar(32) USING "state"::text;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ALTER COLUMN "state" SET DEFAULT 'uploading';--> statement-breakpoint
DROP TYPE "public"."media_upload_session_state";--> statement-breakpoint
ALTER TABLE "media_upload_sessions" DROP CONSTRAINT "media_upload_sessions_provider_upload_id_check";--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ALTER COLUMN "provider_upload_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD COLUMN "initialization_token" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_provider_state_check" CHECK (("media_upload_sessions"."state" = 'initializing' and "media_upload_sessions"."provider_upload_id" is null) or ("media_upload_sessions"."state" = 'aborting' and ("media_upload_sessions"."provider_upload_id" is null or length("media_upload_sessions"."provider_upload_id") between 1 and 1024)) or ("media_upload_sessions"."state" not in ('initializing', 'aborting') and "media_upload_sessions"."provider_upload_id" is not null and length("media_upload_sessions"."provider_upload_id") between 1 and 1024));
