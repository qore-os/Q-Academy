ALTER TABLE "media_upload_sessions" ADD COLUMN "upload_deadline_at" timestamp with time zone;--> statement-breakpoint
UPDATE "media_upload_sessions" SET "upload_deadline_at" = "expires_at" WHERE "upload_deadline_at" IS NULL;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ALTER COLUMN "upload_deadline_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_upload_sessions" ADD CONSTRAINT "media_upload_sessions_deadline_check" CHECK ("media_upload_sessions"."upload_deadline_at" <= "media_upload_sessions"."expires_at");
