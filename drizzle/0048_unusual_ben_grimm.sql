CREATE TYPE "public"."community_approval_mode" AS ENUM('off', 'members', 'non_admins');--> statement-breakpoint
CREATE TYPE "public"."community_automation_mode" AS ENUM('off', 'observe', 'enforce');--> statement-breakpoint
CREATE TYPE "public"."community_content_state" AS ENUM('pending', 'published', 'held', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."community_moderation_case_status" AS ENUM('open', 'reviewing', 'resolved', 'appealed');--> statement-breakpoint
CREATE TYPE "public"."community_moderation_decision_action" AS ENUM('submitted', 'flagged', 'held', 'approved', 'rejected', 'restored', 'appealed', 'appeal_upheld', 'appeal_overturned');--> statement-breakpoint
CREATE TYPE "public"."community_moderation_reason_code" AS ENUM('approval_required', 'report_threshold', 'duplicate', 'link_limit', 'manual');--> statement-breakpoint
CREATE TABLE "community_level_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_level_settings_revision_check" CHECK ("community_level_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"min_points" integer NOT NULL,
	"icon" varchar(60) DEFAULT 'award' NOT NULL,
	"color" varchar(20) DEFAULT '#d6a536' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_levels_position_check" CHECK ("community_levels"."position" between 1 and 100),
	CONSTRAINT "community_levels_min_points_check" CHECK ("community_levels"."min_points" >= 0),
	CONSTRAINT "community_levels_name_check" CHECK (length(btrim("community_levels"."name")) between 1 and 160),
	CONSTRAINT "community_levels_description_check" CHECK (length("community_levels"."description") <= 5000),
	CONSTRAINT "community_levels_icon_check" CHECK (length(btrim("community_levels"."icon")) between 1 and 60),
	CONSTRAINT "community_levels_color_check" CHECK ("community_levels"."color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "community_moderation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"appellant_id" uuid NOT NULL,
	"statement" varchar(2000) NOT NULL,
	"decision_version" integer NOT NULL,
	"resolution_action" "community_moderation_decision_action",
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_appeals_statement_check" CHECK (length(btrim("community_moderation_appeals"."statement")) between 3 and 2000),
	CONSTRAINT "community_moderation_appeals_decision_version_check" CHECK ("community_moderation_appeals"."decision_version" >= 1),
	CONSTRAINT "community_moderation_appeals_resolution_check" CHECK (("community_moderation_appeals"."resolution_action" is null and "community_moderation_appeals"."resolved_by_id" is null and "community_moderation_appeals"."resolved_at" is null and "community_moderation_appeals"."resolution_note" is null) or ("community_moderation_appeals"."resolution_action" in ('appeal_upheld', 'appeal_overturned') and "community_moderation_appeals"."resolved_by_id" is not null and "community_moderation_appeals"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "community_moderation_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" "community_content_state" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_assessments_revision_check" CHECK ("community_moderation_assessments"."revision" >= 1 and "community_moderation_assessments"."policy_version" >= 1),
	CONSTRAINT "community_moderation_assessments_fingerprint_check" CHECK ("community_moderation_assessments"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "community_moderation_assessments_signals_check" CHECK (jsonb_typeof("community_moderation_assessments"."signals") = 'object' and octet_length("community_moderation_assessments"."signals"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "community_moderation_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_type" "community_report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_author_id" uuid,
	"content_version" integer DEFAULT 1 NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"reason" "community_moderation_reason_code" NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "community_moderation_case_status" DEFAULT 'open' NOT NULL,
	"claimed_by_id" uuid,
	"claimed_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"resolved_at" timestamp with time zone,
	"decision_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_cases_versions_check" CHECK ("community_moderation_cases"."content_version" >= 1 and "community_moderation_cases"."policy_version" >= 1 and "community_moderation_cases"."decision_version" >= 1),
	CONSTRAINT "community_moderation_cases_priority_check" CHECK ("community_moderation_cases"."priority" between 0 and 100),
	CONSTRAINT "community_moderation_cases_resolution_check" CHECK (("community_moderation_cases"."status" in ('open', 'reviewing') and "community_moderation_cases"."resolved_at" is null) or ("community_moderation_cases"."status" in ('resolved', 'appealed') and "community_moderation_cases"."resolved_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "community_moderation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"action" "community_moderation_decision_action" NOT NULL,
	"actor_id" uuid,
	"reason_code" "community_moderation_reason_code" NOT NULL,
	"content_version" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"decision_version" integer NOT NULL,
	"note" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_events_versions_check" CHECK ("community_moderation_events"."content_version" >= 1 and "community_moderation_events"."policy_version" >= 1 and "community_moderation_events"."decision_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community_space_moderation_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"post_approval" "community_approval_mode" DEFAULT 'off' NOT NULL,
	"comment_approval" "community_approval_mode" DEFAULT 'off' NOT NULL,
	"automation_mode" "community_automation_mode" DEFAULT 'off' NOT NULL,
	"report_threshold" integer,
	"duplicate_window_minutes" integer DEFAULT 0 NOT NULL,
	"link_limit" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_moderation_policies_report_threshold_check" CHECK ("community_space_moderation_policies"."report_threshold" is null or "community_space_moderation_policies"."report_threshold" between 2 and 20),
	CONSTRAINT "community_moderation_policies_duplicate_window_check" CHECK ("community_space_moderation_policies"."duplicate_window_minutes" between 0 and 1440),
	CONSTRAINT "community_moderation_policies_link_limit_check" CHECK ("community_space_moderation_policies"."link_limit" between 0 and 20),
	CONSTRAINT "community_moderation_policies_version_check" CHECK ("community_space_moderation_policies"."version" >= 1)
);
--> statement-breakpoint
DROP INDEX "community_reports_reporter_target_idx";--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderation_state" "community_content_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderation_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "published_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "moderated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "community_reports" ADD COLUMN "case_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_state" "community_content_state" DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderation_fingerprint" varchar(64);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "published_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "moderated_by_id" uuid;--> statement-breakpoint
UPDATE "posts" SET "published_at" = "created_at" WHERE "moderation_state" = 'published';--> statement-breakpoint
UPDATE "comments" SET "published_at" = "created_at" WHERE "moderation_state" = 'published';--> statement-breakpoint
UPDATE "users" SET "points" = 0 WHERE "points" < 0;--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_cases_id_organization_idx" ON "community_moderation_cases" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "community_level_settings" ADD CONSTRAINT "community_level_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_level_settings" ADD CONSTRAINT "community_level_settings_updater_tenant_fk" FOREIGN KEY ("updated_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_levels" ADD CONSTRAINT "community_levels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_appeals" ADD CONSTRAINT "community_moderation_appeals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_appeals" ADD CONSTRAINT "community_moderation_appeals_case_tenant_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."community_moderation_cases"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_appeals" ADD CONSTRAINT "community_moderation_appeals_appellant_tenant_fk" FOREIGN KEY ("appellant_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_appeals" ADD CONSTRAINT "community_moderation_appeals_resolver_tenant_fk" FOREIGN KEY ("resolved_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_assessments" ADD CONSTRAINT "community_moderation_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_assessments" ADD CONSTRAINT "community_moderation_assessments_case_tenant_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."community_moderation_cases"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_cases" ADD CONSTRAINT "community_moderation_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_cases" ADD CONSTRAINT "community_moderation_cases_author_tenant_fk" FOREIGN KEY ("target_author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_cases" ADD CONSTRAINT "community_moderation_cases_claimant_tenant_fk" FOREIGN KEY ("claimed_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_cases" ADD CONSTRAINT "community_moderation_cases_resolver_tenant_fk" FOREIGN KEY ("resolved_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_events" ADD CONSTRAINT "community_moderation_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_events" ADD CONSTRAINT "community_moderation_events_case_tenant_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."community_moderation_cases"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_moderation_events" ADD CONSTRAINT "community_moderation_events_actor_tenant_fk" FOREIGN KEY ("actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_moderation_policies" ADD CONSTRAINT "community_space_moderation_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_moderation_policies" ADD CONSTRAINT "community_moderation_policies_space_tenant_fk" FOREIGN KEY ("space_id","organization_id") REFERENCES "public"."community_spaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_moderation_policies" ADD CONSTRAINT "community_moderation_policies_updater_tenant_fk" FOREIGN KEY ("updated_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "community_level_settings" ("organization_id", "enabled", "revision")
SELECT "id", false, 1 FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "community_levels" ("organization_id", "position", "name", "description", "min_points")
SELECT "organizations"."id", "defaults"."position", "defaults"."name", "defaults"."description", "defaults"."min_points"
FROM "organizations"
CROSS JOIN (
	VALUES
		(1, 'Level 1', 'Community-Level 1', 0),
		(2, 'Level 2', 'Community-Level 2', 20),
		(3, 'Level 3', 'Community-Level 3', 60),
		(4, 'Level 4', 'Community-Level 4', 180),
		(5, 'Level 5', 'Community-Level 5', 540),
		(6, 'Level 6', 'Community-Level 6', 1620),
		(7, 'Level 7', 'Community-Level 7', 4860),
		(8, 'Level 8', 'Community-Level 8', 14580),
		(9, 'Level 9', 'Community-Level 9', 43740)
) AS "defaults" ("position", "name", "description", "min_points")
;--> statement-breakpoint
INSERT INTO "community_space_moderation_policies" ("organization_id", "space_id")
SELECT "organization_id", "id" FROM "community_spaces"
;--> statement-breakpoint
INSERT INTO "community_moderation_cases" (
	"organization_id",
	"target_type",
	"target_id",
	"target_author_id",
	"content_version",
	"policy_version",
	"reason",
	"priority",
	"status",
	"claimed_by_id",
	"claimed_at",
	"resolved_by_id",
	"resolved_at",
	"decision_version",
	"created_at",
	"updated_at"
)
SELECT
	"reports"."organization_id",
	"reports"."target_type",
	"reports"."target_id",
	(array_agg("reports"."target_author_id" ORDER BY "reports"."created_at") FILTER (WHERE "reports"."target_author_id" IS NOT NULL))[1],
	1,
	1,
	'manual',
	LEAST(100, (count(*) * 10)::integer),
	CASE
		WHEN bool_or("reports"."status" = 'reviewing') THEN 'reviewing'::"community_moderation_case_status"
		WHEN bool_or("reports"."status" = 'open') THEN 'open'::"community_moderation_case_status"
		ELSE 'resolved'::"community_moderation_case_status"
	END,
	CASE
		WHEN bool_or("reports"."status" = 'reviewing')
		THEN (array_agg("reports"."handled_by_id" ORDER BY "reports"."updated_at" DESC) FILTER (WHERE "reports"."handled_by_id" IS NOT NULL))[1]
		ELSE NULL
	END,
	CASE
		WHEN bool_or("reports"."status" = 'reviewing')
		THEN min("reports"."updated_at") FILTER (WHERE "reports"."status" = 'reviewing')
		ELSE NULL
	END,
	CASE
		WHEN NOT bool_or("reports"."status" IN ('open', 'reviewing'))
		THEN (array_agg("reports"."handled_by_id" ORDER BY "reports"."resolved_at" DESC NULLS LAST) FILTER (WHERE "reports"."handled_by_id" IS NOT NULL))[1]
		ELSE NULL
	END,
	CASE
		WHEN NOT bool_or("reports"."status" IN ('open', 'reviewing')) THEN max("reports"."resolved_at")
		ELSE NULL
	END,
	1,
	min("reports"."created_at"),
	max("reports"."updated_at")
FROM "community_reports" AS "reports"
GROUP BY "reports"."organization_id", "reports"."target_type", "reports"."target_id";--> statement-breakpoint
UPDATE "community_reports" AS "reports"
SET "case_id" = "cases"."id"
FROM "community_moderation_cases" AS "cases"
WHERE "reports"."organization_id" = "cases"."organization_id"
	AND "reports"."target_type" = "cases"."target_type"
	AND "reports"."target_id" = "cases"."target_id"
	AND "reports"."case_id" IS NULL;--> statement-breakpoint
INSERT INTO "community_moderation_events" (
	"organization_id",
	"case_id",
	"action",
	"actor_id",
	"reason_code",
	"content_version",
	"policy_version",
	"decision_version",
	"note",
	"created_at"
)
SELECT
	"organization_id",
	"id",
	'flagged',
	coalesce("claimed_by_id", "resolved_by_id"),
	"reason",
	"content_version",
	"policy_version",
	"decision_version",
	'Migrierte Community-Meldungen',
	"created_at"
FROM "community_moderation_cases";--> statement-breakpoint
CREATE UNIQUE INDEX "community_levels_org_position_idx" ON "community_levels" USING btree ("organization_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "community_levels_org_min_points_idx" ON "community_levels" USING btree ("organization_id","min_points");--> statement-breakpoint
CREATE UNIQUE INDEX "community_levels_id_organization_idx" ON "community_levels" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "community_levels_org_active_position_idx" ON "community_levels" USING btree ("organization_id","active","position");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_appeals_id_organization_idx" ON "community_moderation_appeals" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_appeals_active_case_idx" ON "community_moderation_appeals" USING btree ("organization_id","case_id") WHERE "community_moderation_appeals"."resolution_action" is null;--> statement-breakpoint
CREATE INDEX "community_moderation_appeals_case_created_idx" ON "community_moderation_appeals" USING btree ("organization_id","case_id","created_at");--> statement-breakpoint
CREATE INDEX "community_moderation_appeals_resolution_queue_idx" ON "community_moderation_appeals" USING btree ("organization_id","resolved_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_assessments_case_revision_idx" ON "community_moderation_assessments" USING btree ("organization_id","case_id","revision");--> statement-breakpoint
CREATE INDEX "community_moderation_assessments_case_history_idx" ON "community_moderation_assessments" USING btree ("organization_id","case_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_moderation_assessments_outcome_created_idx" ON "community_moderation_assessments" USING btree ("organization_id","outcome","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_cases_active_target_idx" ON "community_moderation_cases" USING btree ("organization_id","target_type","target_id") WHERE "community_moderation_cases"."status" in ('open', 'reviewing', 'appealed');--> statement-breakpoint
CREATE INDEX "community_moderation_cases_queue_idx" ON "community_moderation_cases" USING btree ("organization_id","status","priority" DESC NULLS LAST,"created_at","id");--> statement-breakpoint
CREATE INDEX "community_moderation_cases_target_history_idx" ON "community_moderation_cases" USING btree ("organization_id","target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_events_id_organization_idx" ON "community_moderation_events" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "community_moderation_events_case_timeline_idx" ON "community_moderation_events" USING btree ("organization_id","case_id","created_at","id");--> statement-breakpoint
CREATE INDEX "community_moderation_events_action_created_idx" ON "community_moderation_events" USING btree ("organization_id","action","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_policies_org_space_idx" ON "community_space_moderation_policies" USING btree ("organization_id","space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_moderation_policies_id_organization_idx" ON "community_space_moderation_policies" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderator_tenant_fk" FOREIGN KEY ("moderated_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_reports" ADD CONSTRAINT "community_reports_case_tenant_fk" FOREIGN KEY ("case_id","organization_id") REFERENCES "public"."community_moderation_cases"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_moderator_tenant_fk" FOREIGN KEY ("moderated_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_org_moderation_queue_idx" ON "comments" USING btree ("organization_id","moderation_state","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_org_post_published_idx" ON "comments" USING btree ("organization_id","post_id","published_at","id") WHERE "comments"."moderation_state" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_case_reporter_idx" ON "community_reports" USING btree ("organization_id","case_id","reporter_id") WHERE "community_reports"."case_id" is not null and "community_reports"."reporter_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_reports_legacy_reporter_target_idx" ON "community_reports" USING btree ("organization_id","reporter_id","target_type","target_id") WHERE "community_reports"."case_id" is null and "community_reports"."reporter_id" is not null;--> statement-breakpoint
CREATE INDEX "community_reports_org_case_created_idx" ON "community_reports" USING btree ("organization_id","case_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_org_moderation_queue_idx" ON "posts" USING btree ("organization_id","moderation_state","created_at","id");--> statement-breakpoint
CREATE INDEX "posts_org_space_published_idx" ON "posts" USING btree ("organization_id","space_id","published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."moderation_state" = 'published';--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderation_version_check" CHECK ("comments"."moderation_version" >= 1);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_moderation_fingerprint_check" CHECK ("comments"."moderation_fingerprint" is null or "comments"."moderation_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_published_at_check" CHECK ("comments"."moderation_state" <> 'published' or "comments"."published_at" is not null);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_moderation_version_check" CHECK ("posts"."moderation_version" >= 1);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_moderation_fingerprint_check" CHECK ("posts"."moderation_fingerprint" is null or "posts"."moderation_fingerprint" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_published_at_check" CHECK ("posts"."moderation_state" <> 'published' or "posts"."published_at" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_points_nonnegative_check" CHECK ("users"."points" >= 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."enforce_community_content_publication_timeline"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."moderation_state" = 'published' AND NEW."published_at" IS NULL THEN
			RAISE EXCEPTION 'Published content in % requires published_at', TG_TABLE_NAME USING ERRCODE = '23514';
		END IF;

		IF NEW."moderation_state" <> 'published' AND NEW."published_at" IS NOT NULL THEN
			RAISE EXCEPTION 'Never-published content in % cannot have published_at', TG_TABLE_NAME USING ERRCODE = '23514';
		END IF;

		RETURN NEW;
	END IF;

	IF NEW."moderation_state" = 'published' AND NEW."published_at" IS NULL THEN
		RAISE EXCEPTION 'Published content in % requires published_at', TG_TABLE_NAME USING ERRCODE = '23514';
	END IF;

	IF OLD."published_at" IS NULL
		AND NEW."published_at" IS NOT NULL
		AND NEW."moderation_state" <> 'published' THEN
		RAISE EXCEPTION 'Content in % must be published before retaining published_at', TG_TABLE_NAME USING ERRCODE = '23514';
	END IF;

	IF OLD."published_at" IS NOT NULL
		AND NEW."published_at" IS DISTINCT FROM OLD."published_at" THEN
		RAISE EXCEPTION 'Initial published_at in % is immutable', TG_TABLE_NAME USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."enforce_community_content_publication_timeline"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "posts_publication_timeline_trigger"
BEFORE INSERT OR UPDATE OF "moderation_state", "published_at"
ON "posts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_community_content_publication_timeline"();--> statement-breakpoint
CREATE TRIGGER "comments_publication_timeline_trigger"
BEFORE INSERT OR UPDATE OF "moderation_state", "published_at"
ON "comments" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_community_content_publication_timeline"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_community_moderation_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'community_moderation_events is append-only' USING ERRCODE = '55000';
	RETURN NULL;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reject_community_moderation_event_mutation"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "community_moderation_events_immutable_rows_trigger"
BEFORE UPDATE OR DELETE ON "community_moderation_events"
FOR EACH ROW EXECUTE FUNCTION "public"."reject_community_moderation_event_mutation"();--> statement-breakpoint
CREATE TRIGGER "community_moderation_events_immutable_truncate_trigger"
BEFORE TRUNCATE ON "community_moderation_events"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_community_moderation_event_mutation"();--> statement-breakpoint
DROP TRIGGER "community_feed_revision_posts_trigger" ON "posts";--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_posts_trigger"
AFTER UPDATE OF "organization_id", "space_id", "author_id", "pinned", "moderation_state", "published_at", "created_at" OR DELETE
ON "posts" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();--> statement-breakpoint
DROP TRIGGER "community_feed_revision_comments_trigger" ON "comments";--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_comments_trigger"
AFTER UPDATE OF "organization_id", "post_id", "author_id", "moderation_state", "published_at", "created_at" OR DELETE
ON "comments" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
