CREATE TYPE "public"."course_module_access_mode" AS ENUM('visible', 'after_previous', 'delay_days', 'date_window', 'coming_soon', 'locked', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."course_module_access_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."course_module_access_state" AS ENUM('available', 'read_only', 'locked', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."learning_content_visibility" AS ENUM('visible', 'draft', 'coming_soon');--> statement-breakpoint
CREATE TABLE "course_module_access_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"state" "course_module_access_state" NOT NULL,
	"reason" varchar(500),
	"expires_at" timestamp with time zone,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_module_access_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "course_module_access_request_status" DEFAULT 'pending' NOT NULL,
	"message" varchar(1000),
	"decision_note" varchar(1000),
	"decided_by_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "course_module_access_requests_decision_check" CHECK ((
        ("course_module_access_requests"."status" = 'pending' and "course_module_access_requests"."decided_at" is null and "course_module_access_requests"."decided_by_id" is null)
        or ("course_module_access_requests"."status" in ('approved', 'rejected') and "course_module_access_requests"."decided_at" is not null and "course_module_access_requests"."decided_by_id" is not null)
        or ("course_module_access_requests"."status" = 'cancelled' and "course_module_access_requests"."decided_at" is not null and "course_module_access_requests"."decided_by_id" is null)
      ))
);
--> statement-breakpoint
ALTER TABLE "course_modules" DROP CONSTRAINT "course_modules_course_id_courses_id_fk";
--> statement-breakpoint
ALTER TABLE "course_modules" DROP CONSTRAINT "course_modules_module_id_modules_id_fk";
--> statement-breakpoint
ALTER TABLE "module_sections" DROP CONSTRAINT "module_sections_module_id_modules_id_fk";
--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "access_mode" "course_module_access_mode" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "delay_pending_state" "course_module_access_state" DEFAULT 'locked' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "available_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "available_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "window_default_state" "course_module_access_state" DEFAULT 'locked' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "window_state" "course_module_access_state" DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "request_access_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "first_published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "visibility" "learning_content_visibility" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE "module_sections" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "module_sections" ADD COLUMN "visibility" "learning_content_visibility" DEFAULT 'visible' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "course_modules" AS cm
    JOIN "courses" AS c ON c."id" = cm."course_id"
    JOIN "modules" AS m ON m."id" = cm."module_id"
    WHERE c."organization_id" <> m."organization_id"
  ) THEN
    RAISE EXCEPTION 'Visibility migration found a cross-tenant course module';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "lessons" AS l
    JOIN "module_sections" AS ms ON ms."id" = l."section_id"
    WHERE l."module_id" <> ms."module_id"
  ) THEN
    RAISE EXCEPTION 'Visibility migration found a lesson assigned to a foreign module section';
  END IF;
END $$;--> statement-breakpoint
UPDATE "course_modules" AS cm
SET "organization_id" = c."organization_id"
FROM "courses" AS c
WHERE c."id" = cm."course_id";--> statement-breakpoint
UPDATE "module_sections" AS ms
SET "organization_id" = m."organization_id"
FROM "modules" AS m
WHERE m."id" = ms."module_id";--> statement-breakpoint
UPDATE "lessons" AS l
SET "organization_id" = m."organization_id"
FROM "modules" AS m
WHERE m."id" = l."module_id";--> statement-breakpoint
UPDATE "module_sections"
SET "visibility" = CASE
  WHEN "status" = 'published' THEN 'visible'::"learning_content_visibility"
  ELSE 'draft'::"learning_content_visibility"
END;--> statement-breakpoint
UPDATE "lessons"
SET "visibility" = CASE
  WHEN "status" = 'published' THEN 'visible'::"learning_content_visibility"
  ELSE 'draft'::"learning_content_visibility"
END;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "course_modules" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "module_sections" WHERE "organization_id" IS NULL)
    OR EXISTS (SELECT 1 FROM "lessons" WHERE "organization_id" IS NULL)
  THEN
    RAISE EXCEPTION 'Visibility migration could not derive every tenant id';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "course_modules" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "module_sections" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
UPDATE "course_modules"
SET "drip_days" = greatest(0, least("drip_days", 36500));--> statement-breakpoint
UPDATE "course_modules"
SET "access_mode" = 'delay_days'
WHERE "drip_days" > 0;--> statement-breakpoint
UPDATE "courses" AS c
SET "first_published_at" = versions."first_published_at"
FROM (
  SELECT "course_id", min("published_at") AS "first_published_at"
  FROM "course_versions"
  WHERE "published_at" IS NOT NULL
  GROUP BY "course_id"
) AS versions
WHERE versions."course_id" = c."id";--> statement-breakpoint
UPDATE "courses"
SET "first_published_at" = coalesce("first_published_at", "updated_at", "created_at")
WHERE "status" = 'published' AND "first_published_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "modules_id_organization_idx" ON "modules" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_modules_course_module_organization_idx" ON "course_modules" USING btree ("course_id","module_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_sections_id_module_organization_idx" ON "module_sections" USING btree ("id","module_id","organization_id");--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_module_tenant_fk" FOREIGN KEY ("module_id","organization_id") REFERENCES "public"."modules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_assignment_fk" FOREIGN KEY ("course_id","module_id","organization_id") REFERENCES "public"."course_modules"("course_id","module_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_overrides" ADD CONSTRAINT "course_module_access_overrides_actor_tenant_fk" FOREIGN KEY ("created_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_decided_by_id_users_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_module_tenant_fk" FOREIGN KEY ("module_id","organization_id") REFERENCES "public"."modules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_assignment_fk" FOREIGN KEY ("course_id","module_id","organization_id") REFERENCES "public"."course_modules"("course_id","module_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_module_access_requests" ADD CONSTRAINT "course_module_access_requests_decider_tenant_fk" FOREIGN KEY ("decided_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_module_access_overrides_org_member_module_idx" ON "course_module_access_overrides" USING btree ("organization_id","user_id","course_id","module_id");--> statement-breakpoint
CREATE INDEX "course_module_access_overrides_org_course_idx" ON "course_module_access_overrides" USING btree ("organization_id","course_id");--> statement-breakpoint
CREATE INDEX "course_module_access_overrides_member_expiry_idx" ON "course_module_access_overrides" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "course_module_access_requests_pending_idx" ON "course_module_access_requests" USING btree ("organization_id","user_id","course_id","module_id") WHERE "course_module_access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "course_module_access_requests_org_course_status_idx" ON "course_module_access_requests" USING btree ("organization_id","course_id","status","requested_at");--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_module_tenant_fk" FOREIGN KEY ("module_id","organization_id") REFERENCES "public"."modules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_tenant_fk" FOREIGN KEY ("module_id","organization_id") REFERENCES "public"."modules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_section_module_tenant_fk" FOREIGN KEY ("section_id","module_id","organization_id") REFERENCES "public"."module_sections"("id","module_id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_sections" ADD CONSTRAINT "module_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "module_sections" ADD CONSTRAINT "module_sections_module_tenant_fk" FOREIGN KEY ("module_id","organization_id") REFERENCES "public"."modules"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_id_organization_idx" ON "lessons" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "module_sections_id_organization_idx" ON "module_sections" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_drip_days_check" CHECK ("course_modules"."drip_days" >= 0 and "course_modules"."drip_days" <= 36500);--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_window_check" CHECK ("course_modules"."available_from" is null or "course_modules"."available_until" is null or "course_modules"."available_until" > "course_modules"."available_from");--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_access_mode_config_check" CHECK ((
        ("course_modules"."access_mode" = 'delay_days' and "course_modules"."available_from" is null and "course_modules"."available_until" is null)
        or ("course_modules"."access_mode" = 'date_window' and "course_modules"."drip_days" = 0 and ("course_modules"."available_from" is not null or "course_modules"."available_until" is not null))
        or ("course_modules"."access_mode" not in ('delay_days', 'date_window') and "course_modules"."drip_days" = 0 and "course_modules"."available_from" is null and "course_modules"."available_until" is null)
      ));--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_delay_pending_state_check" CHECK ("course_modules"."delay_pending_state" in ('locked', 'hidden'));
