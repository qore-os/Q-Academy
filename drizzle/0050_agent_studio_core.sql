CREATE TYPE "public"."ai_agent_type" AS ENUM('learning_coach', 'knowledge_assistant', 'form_assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_version_state" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_knowledge_mode" AS ENUM('all_accessible_courses', 'selected_sources');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_access_mode" AS ENUM('open', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_access_subject" AS ENUM('role', 'user', 'group', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_source_type" AS ENUM('course_version', 'manual_text', 'media_asset');--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "draft_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD COLUMN "published_version_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "agent_version_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agents_id_organization_idx" ON "ai_agents" USING btree ("id", "organization_id");--> statement-breakpoint
CREATE TABLE "ai_agent_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"draft_revision" integer DEFAULT 1 NOT NULL,
	"state" "ai_agent_version_state" DEFAULT 'draft' NOT NULL,
	"type" "ai_agent_type" DEFAULT 'learning_coach' NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"system_prompt" text NOT NULL,
	"color" varchar(20) DEFAULT '#2bb7a9' NOT NULL,
	"icon" varchar(40) DEFAULT 'sparkles' NOT NULL,
	"knowledge_mode" "ai_agent_knowledge_mode" DEFAULT 'all_accessible_courses' NOT NULL,
	"access_mode" "ai_agent_access_mode" DEFAULT 'open' NOT NULL,
	"created_by_id" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_versions_numbers_check" CHECK ("version" >= 1 AND "draft_revision" >= 1),
	CONSTRAINT "ai_agent_versions_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
	CONSTRAINT "ai_agent_versions_description_check" CHECK (length("description") <= 10000),
	CONSTRAINT "ai_agent_versions_system_prompt_check" CHECK (length(btrim("system_prompt")) BETWEEN 10 AND 50000),
	CONSTRAINT "ai_agent_versions_color_check" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "ai_agent_versions_icon_check" CHECK (length(btrim("icon")) BETWEEN 1 AND 40),
	CONSTRAINT "ai_agent_versions_publication_check" CHECK (("state" = 'draft' AND "published_at" IS NULL) OR ("state" = 'published' AND "published_at" IS NOT NULL))
);--> statement-breakpoint
CREATE TABLE "ai_agent_version_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"source_type" "ai_agent_source_type" NOT NULL,
	"course_id" uuid,
	"course_version_id" uuid,
	"media_asset_id" uuid,
	"title" varchar(220),
	"content" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_version_sources_sort_order_check" CHECK ("sort_order" BETWEEN 0 AND 10000),
	CONSTRAINT "ai_agent_version_sources_shape_check" CHECK ((
		"source_type" = 'course_version'
		AND "course_id" IS NOT NULL
		AND "course_version_id" IS NOT NULL
		AND "media_asset_id" IS NULL
		AND "title" IS NULL
		AND "content" IS NULL
	) OR (
		"source_type" = 'manual_text'
		AND "course_id" IS NULL
		AND "course_version_id" IS NULL
		AND "media_asset_id" IS NULL
		AND "title" IS NOT NULL
		AND "content" IS NOT NULL
		AND length(btrim("title")) BETWEEN 1 AND 220
		AND length(btrim("content")) BETWEEN 1 AND 2000000
	) OR (
		"source_type" = 'media_asset'
		AND "course_id" IS NULL
		AND "course_version_id" IS NULL
		AND "media_asset_id" IS NOT NULL
		AND "title" IS NOT NULL
		AND "content" IS NOT NULL
		AND length(btrim("title")) BETWEEN 1 AND 220
		AND length(btrim("content")) BETWEEN 1 AND 2000000
	))
);--> statement-breakpoint
CREATE TABLE "ai_agent_version_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"subject_type" "ai_agent_access_subject" NOT NULL,
	"subject_role" "role",
	"subject_user_id" uuid,
	"subject_group_id" uuid,
	"subject_bundle_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_version_access_grants_subject_shape_check" CHECK ((
		"subject_type" = 'role' AND "subject_role" IS NOT NULL
		AND "subject_user_id" IS NULL AND "subject_group_id" IS NULL AND "subject_bundle_id" IS NULL
	) OR (
		"subject_type" = 'user' AND "subject_role" IS NULL
		AND "subject_user_id" IS NOT NULL AND "subject_group_id" IS NULL AND "subject_bundle_id" IS NULL
	) OR (
		"subject_type" = 'group' AND "subject_role" IS NULL
		AND "subject_user_id" IS NULL AND "subject_group_id" IS NOT NULL AND "subject_bundle_id" IS NULL
	) OR (
		"subject_type" = 'bundle' AND "subject_role" IS NULL
		AND "subject_user_id" IS NULL AND "subject_group_id" IS NULL AND "subject_bundle_id" IS NOT NULL
	))
);--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_versions_id_agent_org_idx" ON "ai_agent_versions" USING btree ("id", "agent_id", "organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_versions_id_organization_idx" ON "ai_agent_versions" USING btree ("id", "organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_versions_agent_number_idx" ON "ai_agent_versions" USING btree ("agent_id", "version");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_versions_one_draft_idx" ON "ai_agent_versions" USING btree ("agent_id") WHERE "state" = 'draft';--> statement-breakpoint
CREATE INDEX "ai_agent_versions_org_state_updated_idx" ON "ai_agent_versions" USING btree ("organization_id", "state", "updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_sources_course_idx" ON "ai_agent_version_sources" USING btree ("agent_version_id", "course_version_id") WHERE "source_type" = 'course_version';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_sources_media_idx" ON "ai_agent_version_sources" USING btree ("agent_version_id", "media_asset_id") WHERE "source_type" = 'media_asset';--> statement-breakpoint
CREATE INDEX "ai_agent_version_sources_org_version_order_idx" ON "ai_agent_version_sources" USING btree ("organization_id", "agent_version_id", "sort_order", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_access_grants_role_idx" ON "ai_agent_version_access_grants" USING btree ("agent_version_id", "subject_role") WHERE "subject_type" = 'role';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_access_grants_user_idx" ON "ai_agent_version_access_grants" USING btree ("agent_version_id", "subject_user_id") WHERE "subject_type" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_access_grants_group_idx" ON "ai_agent_version_access_grants" USING btree ("agent_version_id", "subject_group_id") WHERE "subject_type" = 'group';--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_access_grants_bundle_idx" ON "ai_agent_version_access_grants" USING btree ("agent_version_id", "subject_bundle_id") WHERE "subject_type" = 'bundle';--> statement-breakpoint
CREATE INDEX "ai_agent_version_access_grants_org_version_idx" ON "ai_agent_version_access_grants" USING btree ("organization_id", "agent_version_id");--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_tenant_fk" FOREIGN KEY ("agent_id", "organization_id") REFERENCES "public"."ai_agents"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_creator_tenant_fk" FOREIGN KEY ("created_by_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_version_tenant_fk" FOREIGN KEY ("agent_version_id", "organization_id") REFERENCES "public"."ai_agent_versions"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_course_version_tenant_fk" FOREIGN KEY ("course_version_id", "course_id", "organization_id") REFERENCES "public"."course_versions"("id", "course_id", "organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_media_tenant_fk" FOREIGN KEY ("media_asset_id", "organization_id") REFERENCES "public"."media_assets"("id", "organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_access_grants" ADD CONSTRAINT "ai_agent_version_access_grants_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_access_grants" ADD CONSTRAINT "ai_agent_version_access_grants_version_tenant_fk" FOREIGN KEY ("agent_version_id", "organization_id") REFERENCES "public"."ai_agent_versions"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_access_grants" ADD CONSTRAINT "ai_agent_version_access_grants_user_tenant_fk" FOREIGN KEY ("subject_user_id", "organization_id") REFERENCES "public"."users"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_access_grants" ADD CONSTRAINT "ai_agent_version_access_grants_group_tenant_fk" FOREIGN KEY ("subject_group_id", "organization_id") REFERENCES "public"."groups"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_access_grants" ADD CONSTRAINT "ai_agent_version_access_grants_bundle_tenant_fk" FOREIGN KEY ("subject_bundle_id", "organization_id") REFERENCES "public"."bundles"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "ai_agent_versions" (
	"organization_id", "agent_id", "version", "draft_revision", "state", "type",
	"name", "description", "system_prompt", "color", "icon",
	"knowledge_mode", "access_mode", "published_at", "created_at", "updated_at"
)
SELECT
	agent."organization_id", agent."id", 1, 1, 'published', 'learning_coach',
	agent."name", agent."description", agent."system_prompt", agent."color", agent."icon",
	'all_accessible_courses', 'open', agent."created_at", agent."created_at", agent."created_at"
FROM "ai_agents" AS agent;--> statement-breakpoint
INSERT INTO "ai_agent_versions" (
	"organization_id", "agent_id", "version", "draft_revision", "state", "type",
	"name", "description", "system_prompt", "color", "icon",
	"knowledge_mode", "access_mode", "created_at", "updated_at"
)
SELECT
	agent."organization_id", agent."id", 2, 1, 'draft', 'learning_coach',
	agent."name", agent."description", agent."system_prompt", agent."color", agent."icon",
	'all_accessible_courses', 'open', agent."created_at", agent."created_at"
FROM "ai_agents" AS agent;--> statement-breakpoint
UPDATE "ai_agents" AS agent
SET
	"published_version_id" = published."id",
	"draft_version_id" = draft."id"
FROM "ai_agent_versions" AS published, "ai_agent_versions" AS draft
WHERE published."agent_id" = agent."id"
	AND published."organization_id" = agent."organization_id"
	AND published."version" = 1
	AND published."state" = 'published'
	AND draft."agent_id" = agent."id"
	AND draft."organization_id" = agent."organization_id"
	AND draft."version" = 2
	AND draft."state" = 'draft';--> statement-breakpoint
UPDATE "ai_conversations" AS conversation
SET "agent_version_id" = agent."published_version_id"
FROM "ai_agents" AS agent
WHERE agent."id" = conversation."agent_id"
	AND agent."organization_id" = conversation."organization_id";--> statement-breakpoint
DO $block$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "ai_agents"
		WHERE "draft_version_id" IS NULL OR "published_version_id" IS NULL
	) OR EXISTS (
		SELECT 1 FROM "ai_conversations" WHERE "agent_version_id" IS NULL
	) THEN
		RAISE EXCEPTION 'Agent Studio version backfill left an unbound agent or conversation'
			USING ERRCODE = '23514';
	END IF;
END;
$block$;--> statement-breakpoint
ALTER TABLE "ai_agents" ALTER COLUMN "draft_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_conversations" ALTER COLUMN "agent_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_version_pointers_distinct_check" CHECK ("published_version_id" IS NULL OR "published_version_id" <> "draft_version_id");--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_draft_version_tenant_fk" FOREIGN KEY ("draft_version_id", "id", "organization_id") REFERENCES "public"."ai_agent_versions"("id", "agent_id", "organization_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_published_version_tenant_fk" FOREIGN KEY ("published_version_id", "id", "organization_id") REFERENCES "public"."ai_agent_versions"("id", "agent_id", "organization_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "ai_conversations" DROP CONSTRAINT "ai_conversations_agent_id_ai_agents_id_fk";--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_agent_tenant_fk" FOREIGN KEY ("agent_id", "organization_id") REFERENCES "public"."ai_agents"("id", "organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_agent_version_tenant_fk" FOREIGN KEY ("agent_version_id", "agent_id", "organization_id") REFERENCES "public"."ai_agent_versions"("id", "agent_id", "organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_version"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."state" <> 'draft' THEN
			RAISE EXCEPTION 'AI agent versions must be created as drafts before publication'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."state" = 'published' THEN
			RAISE EXCEPTION 'Published AI agent versions are immutable'
				USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD."state" = 'published' THEN
		RAISE EXCEPTION 'Published AI agent versions are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
		OR NEW."version" IS DISTINCT FROM OLD."version"
		OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'AI agent version identity fields are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF NEW."state" = 'draft' THEN
		IF NEW."draft_revision" <> OLD."draft_revision" + 1 THEN
			RAISE EXCEPTION 'Draft AI agent updates must increment draft_revision by exactly one'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."state" <> 'published'
		OR NEW."draft_revision" <> OLD."draft_revision"
		OR NEW."type" IS DISTINCT FROM OLD."type"
		OR NEW."name" IS DISTINCT FROM OLD."name"
		OR NEW."description" IS DISTINCT FROM OLD."description"
		OR NEW."system_prompt" IS DISTINCT FROM OLD."system_prompt"
		OR NEW."color" IS DISTINCT FROM OLD."color"
		OR NEW."icon" IS DISTINCT FROM OLD."icon"
		OR NEW."knowledge_mode" IS DISTINCT FROM OLD."knowledge_mode"
		OR NEW."access_mode" IS DISTINCT FROM OLD."access_mode" THEN
		RAISE EXCEPTION 'Publishing may only seal the saved draft configuration'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."knowledge_mode" = 'selected_sources' AND NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_version_sources" AS source
		WHERE source."agent_version_id" = OLD."id"
			AND source."organization_id" = OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'Selected-source AI agent versions require at least one source'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."access_mode" = 'restricted' AND NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_version_access_grants" AS grant_row
		WHERE grant_row."agent_version_id" = OLD."id"
			AND grant_row."organization_id" = OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'Restricted AI agent versions require at least one access grant'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_ai_agent_version"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_versions_protect_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_agent_versions"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_version"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_version_child"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	parent_state "public"."ai_agent_version_state";
	target_version_id uuid;
	target_organization_id uuid;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'AI agent version child tenant and parent are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		target_version_id := OLD."agent_version_id";
		target_organization_id := OLD."organization_id";
	ELSE
		target_version_id := NEW."agent_version_id";
		target_organization_id := NEW."organization_id";
	END IF;

	SELECT version_row."state" INTO parent_state
	FROM "public"."ai_agent_versions" AS version_row
	WHERE version_row."id" = target_version_id
		AND version_row."organization_id" = target_organization_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'AI agent version child has no parent in its tenant'
			USING ERRCODE = '23503';
	END IF;

	IF parent_state = 'published' THEN
		RAISE EXCEPTION 'Published AI agent version sources and grants are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_ai_agent_version_child"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_sources_protect_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_agent_version_sources"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_version_child"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_access_grants_protect_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "ai_agent_version_access_grants"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_version_child"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_ai_agent_version_pointers"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	target_agent_id uuid;
	target_organization_id uuid;
	draft_pointer_id uuid;
	published_pointer_id uuid;
	draft_count integer;
BEGIN
	IF TG_TABLE_NAME = 'ai_agents' THEN
		target_agent_id := NEW."id";
		target_organization_id := NEW."organization_id";
	ELSE
		target_agent_id := COALESCE(NEW."agent_id", OLD."agent_id");
		target_organization_id := COALESCE(NEW."organization_id", OLD."organization_id");
	END IF;

	SELECT agent."draft_version_id", agent."published_version_id"
	INTO draft_pointer_id, published_pointer_id
	FROM "public"."ai_agents" AS agent
	WHERE agent."id" = target_agent_id
		AND agent."organization_id" = target_organization_id;

	IF NOT FOUND THEN
		RETURN COALESCE(NEW, OLD);
	END IF;

	SELECT count(*)::integer INTO draft_count
	FROM "public"."ai_agent_versions" AS version_row
	WHERE version_row."agent_id" = target_agent_id
		AND version_row."organization_id" = target_organization_id
		AND version_row."state" = 'draft';

	IF draft_count <> 1 OR NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_versions" AS version_row
		WHERE version_row."id" = draft_pointer_id
			AND version_row."agent_id" = target_agent_id
			AND version_row."organization_id" = target_organization_id
			AND version_row."state" = 'draft'
	) THEN
		RAISE EXCEPTION 'AI agent must point to exactly one draft version in its tenant'
			USING ERRCODE = '23514';
	END IF;

	IF published_pointer_id IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_versions" AS version_row
		WHERE version_row."id" = published_pointer_id
			AND version_row."agent_id" = target_agent_id
			AND version_row."organization_id" = target_organization_id
			AND version_row."state" = 'published'
	) THEN
		RAISE EXCEPTION 'AI agent published pointer must reference a published version in its tenant'
			USING ERRCODE = '23514';
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."validate_ai_agent_version_pointers"() FROM PUBLIC;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_agents_version_pointer_integrity_trigger"
AFTER INSERT OR UPDATE ON "ai_agents"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."validate_ai_agent_version_pointers"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "ai_agent_versions_pointer_integrity_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "ai_agent_versions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."validate_ai_agent_version_pointers"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_ai_agent_version_truncate"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'AI agent version history cannot be truncated'
		USING ERRCODE = '55000';
	RETURN NULL;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reject_ai_agent_version_truncate"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_versions_reject_truncate_trigger"
BEFORE TRUNCATE ON "ai_agent_versions"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_ai_agent_version_truncate"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_sources_reject_truncate_trigger"
BEFORE TRUNCATE ON "ai_agent_version_sources"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_ai_agent_version_truncate"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_access_grants_reject_truncate_trigger"
BEFORE TRUNCATE ON "ai_agent_version_access_grants"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_ai_agent_version_truncate"();
