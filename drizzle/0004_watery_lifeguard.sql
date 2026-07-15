ALTER TABLE "courses" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
CREATE INDEX "courses_published_version_idx" ON "courses" USING btree ("published_version_id");