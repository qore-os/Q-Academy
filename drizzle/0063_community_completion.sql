CREATE TABLE "community_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_areas_title_check" CHECK (btrim("community_areas"."title") <> ''),
	CONSTRAINT "community_areas_slug_check" CHECK ("community_areas"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "community_areas_sort_check" CHECK ("community_areas"."sort_order" >= 0),
	CONSTRAINT "community_areas_updated_check" CHECK ("community_areas"."updated_at" >= "community_areas"."created_at")
);
--> statement-breakpoint
CREATE TABLE "community_profile_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"completion_gate_enabled" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_profile_settings_revision_check" CHECK ("community_profile_settings"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "community_public_profile_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"standard_field" varchar(40),
	"custom_field_id" uuid,
	"required_for_posting" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_public_profile_fields_source_check" CHECK (num_nonnulls("community_public_profile_fields"."standard_field", "community_public_profile_fields"."custom_field_id") = 1),
	CONSTRAINT "community_public_profile_fields_standard_check" CHECK ("community_public_profile_fields"."standard_field" is null or "community_public_profile_fields"."standard_field" in ('avatar', 'job_title', 'department', 'bio', 'community_points', 'badges')),
	CONSTRAINT "community_public_profile_fields_required_check" CHECK ("community_public_profile_fields"."required_for_posting" = false or "community_public_profile_fields"."custom_field_id" is not null or "community_public_profile_fields"."standard_field" in ('avatar', 'job_title', 'department', 'bio')),
	CONSTRAINT "community_public_profile_fields_sort_check" CHECK ("community_public_profile_fields"."sort_order" >= 0)
);
--> statement-breakpoint
INSERT INTO "community_areas" (
	"organization_id", "title", "slug", "description", "sort_order"
)
SELECT
	organization."id", 'Allgemein', 'allgemein',
	'Allgemeine Community-Bereiche', 0
FROM "organizations" organization
;--> statement-breakpoint
INSERT INTO "community_profile_settings" (
	"organization_id", "completion_gate_enabled", "revision"
)
SELECT organization."id", false, 1
FROM "organizations" organization
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "community_public_profile_fields" (
	"organization_id", "standard_field", "required_for_posting", "sort_order"
)
SELECT organization."id", field."standard_field", false, field."sort_order"
FROM "organizations" organization
CROSS JOIN (
	VALUES
		('avatar'::varchar, 0),
		('job_title'::varchar, 1),
		('community_points'::varchar, 2),
		('badges'::varchar, 3)
) AS field("standard_field", "sort_order")
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "data_profile_definitions" (
	"organization_id", "key", "name", "description",
	"allow_member_creation", "active", "sort_order"
)
SELECT
	organization."id", 'default', 'Standardprofil',
	'Bestehende und allgemeine Profildaten.', false, true, 0
FROM "organizations" organization
ON CONFLICT ("organization_id", "key") DO UPDATE
SET
	"active" = true,
	"allow_member_creation" = false,
	"updated_at" = now();--> statement-breakpoint
INSERT INTO "data_profile_fields" (
	"organization_id", "profile_definition_id", "field_id", "sort_order"
)
SELECT
	definition."organization_id", definition."id", field."id", field."sort_order"
FROM "data_profile_definitions" definition
JOIN "custom_field_definitions" field
	ON field."organization_id" = definition."organization_id"
WHERE definition."key" = 'default'
ON CONFLICT ("profile_definition_id", "field_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "member_data_profiles" (
	"organization_id", "user_id", "definition_id", "name",
	"is_default", "active"
)
SELECT
	member."organization_id", member."id", definition."id",
	'Community Standard ' || member."id"::text, true, true
FROM "users" member
JOIN "data_profile_definitions" definition
	ON definition."organization_id" = member."organization_id"
	AND definition."key" = 'default'
WHERE NOT EXISTS (
	SELECT 1
	FROM "member_data_profiles" profile
	WHERE profile."organization_id" = member."organization_id"
		AND profile."user_id" = member."id"
		AND profile."is_default" = true
)
ON CONFLICT ("organization_id", "user_id", "name") DO UPDATE
SET
	"definition_id" = excluded."definition_id",
	"is_default" = true,
	"active" = true,
	"updated_at" = now();--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "users" member
		WHERE NOT EXISTS (
			SELECT 1
			FROM "member_data_profiles" profile
			WHERE profile."organization_id" = member."organization_id"
				AND profile."user_id" = member."id"
				AND profile."is_default" = true
				AND profile."active" = true
		)
	) THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = '0063 profile backfill failed: at least one member has no active default profile';
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "data_profile_values" (
	"organization_id", "user_id", "profile_id", "field_id", "value", "updated_at"
)
SELECT
	legacy."organization_id", legacy."user_id", profile."id",
	legacy."field_id", legacy."value", legacy."updated_at"
FROM "custom_field_values" legacy
JOIN "member_data_profiles" profile
	ON profile."organization_id" = legacy."organization_id"
	AND profile."user_id" = legacy."user_id"
	AND profile."is_default" = true
JOIN "custom_field_definitions" field
	ON field."id" = legacy."field_id"
	AND field."organization_id" = legacy."organization_id"
ON CONFLICT ("profile_id", "field_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "content_format" varchar(20) DEFAULT 'plain_text' NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "rich_text" jsonb;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "content_projection_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
WITH ranked_spaces AS (
	SELECT
		space."id",
		area."id" AS "area_id",
		row_number() OVER (
			PARTITION BY space."organization_id"
			ORDER BY lower(space."title"), space."id"
		) - 1 AS "sort_order"
	FROM "community_spaces" space
	JOIN "community_areas" area
		ON area."organization_id" = space."organization_id"
		AND area."slug" = 'allgemein'
)
UPDATE "community_spaces" space
SET
	"area_id" = ranked."area_id",
	"sort_order" = ranked."sort_order"
FROM ranked_spaces ranked
WHERE ranked."id" = space."id";--> statement-breakpoint
ALTER TABLE "community_spaces" ALTER COLUMN "area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_format" varchar(20) DEFAULT 'plain_text' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "rich_text" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "content_projection_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	invalid_post_count bigint;
	invalid_comment_count bigint;
BEGIN
	SELECT count(*) INTO invalid_post_count
	FROM "posts"
	WHERE char_length("content") NOT BETWEEN 1 AND 10000;

	SELECT count(*) INTO invalid_comment_count
	FROM "comments"
	WHERE char_length("content") NOT BETWEEN 1 AND 5000;

	IF invalid_post_count > 0 OR invalid_comment_count > 0 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = format(
				'0063 content preflight failed: %s posts and %s comments exceed the supported projection bounds',
				invalid_post_count,
				invalid_comment_count
			);
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "community_areas" ADD CONSTRAINT "community_areas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_profile_settings" ADD CONSTRAINT "community_profile_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_public_profile_fields" ADD CONSTRAINT "community_public_profile_fields_organization_id_community_profile_settings_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."community_profile_settings"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_public_profile_fields" ADD CONSTRAINT "community_public_profile_fields_custom_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("custom_field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "community_public_profile_fields" ADD CONSTRAINT "community_public_profile_fields_custom_tenant_fk" FOREIGN KEY ("custom_field_id","organization_id") REFERENCES "public"."custom_field_definitions"("id","organization_id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE UNIQUE INDEX "community_areas_org_slug_idx" ON "community_areas" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "community_areas_id_organization_idx" ON "community_areas" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_areas_org_sort_idx" ON "community_areas" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "community_public_profile_fields_org_standard_idx" ON "community_public_profile_fields" USING btree ("organization_id","standard_field") WHERE "community_public_profile_fields"."standard_field" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_public_profile_fields_org_custom_idx" ON "community_public_profile_fields" USING btree ("organization_id","custom_field_id") WHERE "community_public_profile_fields"."custom_field_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_public_profile_fields_org_sort_idx" ON "community_public_profile_fields" USING btree ("organization_id","sort_order");--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_area_id_community_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."community_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_area_tenant_fk" FOREIGN KEY ("area_id","organization_id") REFERENCES "public"."community_areas"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_spaces_org_area_sort_idx" ON "community_spaces" USING btree ("organization_id","area_id","sort_order");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_length_check" CHECK (char_length("comments"."content") between 1 and 5000);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_content_document_shape_check" CHECK ((
        "comments"."content_format" = 'plain_text'
        and "comments"."rich_text" is null
        and "comments"."content_projection_version" = 1
      ) or (
        "comments"."content_format" = 'rich_text'
        and btrim("comments"."content") <> ''
        and "comments"."rich_text" is not null
        and jsonb_typeof("comments"."rich_text") = 'object'
        and "comments"."rich_text" ->> 'version' = '1'
        and jsonb_typeof("comments"."rich_text" -> 'blocks') = 'array'
        and char_length("comments"."rich_text"::text) <= 100000
        and "comments"."content_projection_version" = 1
      ));--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_title_check" CHECK (btrim("community_spaces"."title") <> '');--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_slug_check" CHECK ("community_spaces"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_sort_check" CHECK ("community_spaces"."sort_order" >= 0);--> statement-breakpoint
ALTER TABLE "community_spaces" ADD CONSTRAINT "community_spaces_updated_check" CHECK ("community_spaces"."updated_at" >= "community_spaces"."created_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_content_length_check" CHECK (char_length("posts"."content") between 1 and 10000);--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_content_document_shape_check" CHECK ((
        "posts"."content_format" = 'plain_text'
        and "posts"."rich_text" is null
        and "posts"."content_projection_version" = 1
      ) or (
        "posts"."content_format" = 'rich_text'
        and btrim("posts"."content") <> ''
        and "posts"."rich_text" is not null
        and jsonb_typeof("posts"."rich_text") = 'object'
        and "posts"."rich_text" ->> 'version' = '1'
        and jsonb_typeof("posts"."rich_text" -> 'blocks') = 'array'
        and char_length("posts"."rich_text"::text) <= 100000
        and "posts"."content_projection_version" = 1
      ));
