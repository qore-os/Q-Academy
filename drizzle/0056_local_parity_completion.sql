ALTER TYPE "public"."ai_agent_source_type" ADD VALUE 'web_url';--> statement-breakpoint
CREATE TABLE "announcement_interactions" (
	"organization_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_interactions_announcement_id_user_id_kind_pk" PRIMARY KEY("announcement_id","user_id","kind"),
	CONSTRAINT "announcement_interactions_kind_check" CHECK ("announcement_interactions"."kind" in ('impression', 'click', 'dismiss'))
);
--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" DROP CONSTRAINT "ai_agent_version_sources_shape_check";--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD COLUMN "content_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "target_rule_set" jsonb DEFAULT '{"version":1,"conjunction":"and","conditions":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD COLUMN "course_version_id" uuid;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD COLUMN "lesson_title" varchar(220);--> statement-breakpoint
DELETE FROM "public"."web_push_subscriptions";--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD COLUMN "session_id" uuid NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_id_organization_idx" ON "announcements" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_id_user_org_idx" ON "user_sessions" USING btree ("id","user_id","organization_id");--> statement-breakpoint
ALTER TABLE "announcement_interactions" ADD CONSTRAINT "announcement_interactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_interactions" ADD CONSTRAINT "announcement_interactions_announcement_tenant_fk" FOREIGN KEY ("announcement_id","organization_id") REFERENCES "public"."announcements"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_interactions" ADD CONSTRAINT "announcement_interactions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_interactions_org_kind_occurred_idx" ON "announcement_interactions" USING btree ("organization_id","kind","occurred_at");--> statement-breakpoint
INSERT INTO "public"."announcement_interactions" (
	"organization_id",
	"announcement_id",
	"user_id",
	"kind",
	"occurred_at"
)
SELECT
	announcement."organization_id",
	dismissal."announcement_id",
	dismissal."user_id",
	'dismiss',
	dismissal."dismissed_at"
FROM "public"."announcement_dismissals" AS dismissal
INNER JOIN "public"."announcements" AS announcement
	ON announcement."id" = dismissal."announcement_id"
INNER JOIN "public"."users" AS account
	ON account."id" = dismissal."user_id"
	AND account."organization_id" = announcement."organization_id"
ON CONFLICT ("announcement_id", "user_id", "kind") DO NOTHING;--> statement-breakpoint
WITH "resolved_learning_sessions" AS (
	SELECT
		learning_session."id" AS "session_id",
		resolved_lesson."course_version_id",
		resolved_lesson."lesson_title"
	FROM "public"."lesson_learning_time_sessions" AS learning_session
	INNER JOIN "public"."courses" AS course
		ON course."id" = learning_session."course_id"
		AND course."organization_id" = learning_session."organization_id"
	CROSS JOIN LATERAL (
		SELECT
			course_version."id" AS "course_version_id",
			lesson_node."lesson" ->> 'title' AS "lesson_title"
		FROM "public"."course_versions" AS course_version
		CROSS JOIN LATERAL jsonb_array_elements(
			COALESCE(course_version."snapshot" -> 'modules', '[]'::jsonb)
		) AS module_node("module")
		CROSS JOIN LATERAL (
			SELECT direct_lesson."lesson"
			FROM jsonb_array_elements(
				COALESCE(module_node."module" -> 'lessons', '[]'::jsonb)
			) AS direct_lesson("lesson")
			UNION ALL
			SELECT section_lesson."lesson"
			FROM jsonb_array_elements(
				COALESCE(module_node."module" -> 'sections', '[]'::jsonb)
			) AS section_node("section")
			CROSS JOIN LATERAL jsonb_array_elements(
				COALESCE(section_node."section" -> 'lessons', '[]'::jsonb)
			) AS section_lesson("lesson")
		) AS lesson_node
		WHERE course_version."course_id" = learning_session."course_id"
			AND course_version."organization_id" = learning_session."organization_id"
			AND course_version."published_at" IS NOT NULL
			AND lesson_node."lesson" ->> 'id' = learning_session."lesson_id"::text
			AND length(btrim(lesson_node."lesson" ->> 'title')) BETWEEN 1 AND 220
		ORDER BY
			CASE WHEN course_version."id" = course."published_version_id" THEN 0 ELSE 1 END,
			course_version."published_at" DESC,
			course_version."version" DESC
		LIMIT 1
	) AS resolved_lesson
)
UPDATE "public"."lesson_learning_time_sessions" AS learning_session
SET
	"course_version_id" = resolved."course_version_id",
	"lesson_title" = resolved."lesson_title"
FROM "resolved_learning_sessions" AS resolved
WHERE learning_session."id" = resolved."session_id";--> statement-breakpoint
DO $migration_guard$
DECLARE
	"unresolved_count" bigint;
BEGIN
	SELECT count(*)
	INTO "unresolved_count"
	FROM "public"."lesson_learning_time_sessions"
	WHERE "course_version_id" IS NULL OR "lesson_title" IS NULL;

	IF "unresolved_count" > 0 THEN
		RAISE EXCEPTION '0056 cannot bind % legacy learning-time session(s) to a published lesson snapshot', "unresolved_count";
	END IF;
END;
$migration_guard$;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ALTER COLUMN "course_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ALTER COLUMN "lesson_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" DROP CONSTRAINT "lesson_learning_time_sessions_lesson_tenant_fk";--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_version_scope_fk" FOREIGN KEY ("course_version_id","course_id","organization_id") REFERENCES "public"."course_versions"("id","course_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_learning_time_sessions_org_version_idx" ON "lesson_learning_time_sessions" USING btree ("organization_id","course_version_id","last_heartbeat_at");--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_lesson_title_check" CHECK (length(btrim("lesson_learning_time_sessions"."lesson_title")) between 1 and 220);--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_session_user_tenant_fk" FOREIGN KEY ("session_id","user_id","organization_id") REFERENCES "public"."user_sessions"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "public"."purge_web_push_on_session_revocation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
	IF OLD."revoked_at" IS NULL AND NEW."revoked_at" IS NOT NULL THEN
		DELETE FROM "public"."web_push_subscriptions"
		WHERE "session_id" = NEW."id";
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
CREATE TRIGGER "user_sessions_purge_web_push_on_revocation_trigger"
AFTER UPDATE OF "revoked_at" ON "public"."user_sessions"
FOR EACH ROW
EXECUTE FUNCTION "public"."purge_web_push_on_session_revocation"();--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_sources_web_url_idx" ON "ai_agent_version_sources" USING btree ("agent_version_id","source_url");--> statement-breakpoint
ALTER TABLE "ai_agent_version_sources" ADD CONSTRAINT "ai_agent_version_sources_shape_check" CHECK ((
		"ai_agent_version_sources"."source_type"::text = 'course_version'
		and "ai_agent_version_sources"."course_id" is not null
		and "ai_agent_version_sources"."course_version_id" is not null
		and "ai_agent_version_sources"."media_asset_id" is null
		and "ai_agent_version_sources"."title" is null
		and "ai_agent_version_sources"."content" is null
		and "ai_agent_version_sources"."source_url" is null
		and "ai_agent_version_sources"."content_digest" is null
		and "ai_agent_version_sources"."fetched_at" is null
	) or (
		"ai_agent_version_sources"."source_type"::text = 'manual_text'
		and "ai_agent_version_sources"."course_id" is null
		and "ai_agent_version_sources"."course_version_id" is null
		and "ai_agent_version_sources"."media_asset_id" is null
		and "ai_agent_version_sources"."title" is not null
		and "ai_agent_version_sources"."content" is not null
		and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
		and length(btrim("ai_agent_version_sources"."content")) between 1 and 2000000
		and "ai_agent_version_sources"."source_url" is null
		and "ai_agent_version_sources"."content_digest" is null
		and "ai_agent_version_sources"."fetched_at" is null
	) or (
		"ai_agent_version_sources"."source_type"::text = 'media_asset'
		and "ai_agent_version_sources"."course_id" is null
		and "ai_agent_version_sources"."course_version_id" is null
		and "ai_agent_version_sources"."media_asset_id" is not null
		and "ai_agent_version_sources"."title" is not null
		and "ai_agent_version_sources"."content" is not null
		and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
		and length(btrim("ai_agent_version_sources"."content")) between 1 and 2000000
		and "ai_agent_version_sources"."source_url" is null
		and "ai_agent_version_sources"."content_digest" is null
		and "ai_agent_version_sources"."fetched_at" is null
	) or (
		"ai_agent_version_sources"."source_type"::text = 'web_url'
		and "ai_agent_version_sources"."course_id" is null
		and "ai_agent_version_sources"."course_version_id" is null
		and "ai_agent_version_sources"."media_asset_id" is null
		and "ai_agent_version_sources"."title" is not null
		and "ai_agent_version_sources"."content" is not null
		and "ai_agent_version_sources"."source_url" is not null
		and "ai_agent_version_sources"."content_digest" is not null
		and "ai_agent_version_sources"."fetched_at" is not null
		and length(btrim("ai_agent_version_sources"."title")) between 1 and 220
		and length(btrim("ai_agent_version_sources"."content")) between 1 and 200000
		and length("ai_agent_version_sources"."source_url") between 12 and 2048
		and "ai_agent_version_sources"."source_url" like 'https://%'
		and "ai_agent_version_sources"."content_digest" ~ '^[0-9a-f]{64}$'
	));--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_target_rule_set_check" CHECK (case when jsonb_typeof("announcements"."target_rule_set") = 'object' and jsonb_typeof("announcements"."target_rule_set" -> 'conditions') = 'array' then "announcements"."target_rule_set" -> 'version' = '1'::jsonb and "announcements"."target_rule_set" ->> 'conjunction' = 'and' and jsonb_array_length("announcements"."target_rule_set" -> 'conditions') <= 20 else false end);
