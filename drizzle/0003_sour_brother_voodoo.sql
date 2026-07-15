CREATE TABLE "course_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"certificate_number" varchar(64) NOT NULL,
	"recipient_name" varchar(220) NOT NULL,
	"course_title" varchar(220) NOT NULL,
	"organization_name" varchar(160) NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"issued_by_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_id" uuid,
	"revocation_reason" text
);
--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_certificates" ADD CONSTRAINT "course_certificates_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_number_idx" ON "course_certificates" USING btree ("certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "course_certificates_active_user_course_idx" ON "course_certificates" USING btree ("organization_id","user_id","course_id") WHERE "course_certificates"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "course_certificates_org_issued_idx" ON "course_certificates" USING btree ("organization_id","issued_at");--> statement-breakpoint
CREATE INDEX "course_certificates_user_issued_idx" ON "course_certificates" USING btree ("user_id","issued_at");