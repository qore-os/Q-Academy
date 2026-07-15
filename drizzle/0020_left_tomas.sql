CREATE TYPE "public"."community_report_outcome" AS ENUM('dismissed', 'content_removed', 'content_missing');--> statement-breakpoint
CREATE TYPE "public"."community_report_reason" AS ENUM('spam', 'harassment', 'hate_speech', 'misinformation', 'privacy', 'other');--> statement-breakpoint
CREATE TYPE "public"."community_report_status" AS ENUM('open', 'reviewing', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."community_report_target_type" AS ENUM('post', 'comment');--> statement-breakpoint
CREATE TABLE "community_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reporter_id" uuid,
	"target_type" "community_report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_author_id" uuid,
	"content_excerpt" varchar(500) NOT NULL,
	"reason" "community_report_reason" NOT NULL,
	"details" varchar(1000),
	"status" "community_report_status" DEFAULT 'open' NOT NULL,
	"handled_by_id" uuid,
	"outcome" "community_report_outcome",
	"resolution_note" varchar(1000),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_reports_resolution_state_check" CHECK ((("community_reports"."status" in ('open', 'reviewing')) and "community_reports"."resolved_at" is null and "community_reports"."outcome" is null) or ("community_reports"."status" = 'dismissed' and "community_reports"."resolved_at" is not null and "community_reports"."outcome" = 'dismissed') or ("community_reports"."status" = 'resolved' and "community_reports"."resolved_at" is not null and "community_reports"."outcome" in ('content_removed', 'content_missing')))
);
--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD COLUMN "available_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD COLUMN "delay_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD COLUMN "visible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target_author_id_users_id_fk" FOREIGN KEY ("target_author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_reporter_tenant_fk" FOREIGN KEY ("reporter_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_target_author_tenant_fk" FOREIGN KEY ("target_author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_handler_tenant_fk" FOREIGN KEY ("handled_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_reporter_target_idx" ON "community_reports" USING btree ("organization_id","reporter_id","target_type","target_id") WHERE "community_reports"."reporter_id" is not null;--> statement-breakpoint
CREATE INDEX "community_reports_org_status_created_idx" ON "community_reports" USING btree ("organization_id","status","created_at");--> statement-breakpoint
CREATE INDEX "community_reports_org_target_idx" ON "community_reports" USING btree ("organization_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "bundle_courses_course_idx" ON "bundle_courses" USING btree ("course_id");--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD CONSTRAINT "bundle_courses_delay_days_check" CHECK ("bundle_courses"."delay_days" >= 0 and "bundle_courses"."delay_days" <= 3650);--> statement-breakpoint
ALTER TABLE "bundle_courses" ADD CONSTRAINT "bundle_courses_availability_window_check" CHECK ("bundle_courses"."available_from" is null or "bundle_courses"."available_until" is null or "bundle_courses"."available_until" > "bundle_courses"."available_from");