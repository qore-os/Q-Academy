CREATE TYPE "public"."community_reaction_type" AS ENUM('like', 'celebrate', 'insightful', 'question');--> statement-breakpoint
CREATE TYPE "public"."community_space_type" AS ENUM('feed', 'discussion', 'announcement');--> statement-breakpoint
CREATE TYPE "public"."custom_field_visibility" AS ENUM('member', 'trainer', 'admin');--> statement-breakpoint
CREATE TABLE "community_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"comment_id" uuid,
	"mentioned_user_id" uuid NOT NULL,
	"mentioned_by_id" uuid NOT NULL,
	"handle" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_mentions_not_self_check" CHECK ("community_mentions"."mentioned_user_id" <> "community_mentions"."mentioned_by_id")
);
--> statement-breakpoint
CREATE TABLE "data_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"required_override" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_form_fields_sort_check" CHECK ("data_form_fields"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "data_form_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"form_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"submitted_by_id" uuid NOT NULL,
	"source_type" varchar(40) DEFAULT 'profile' NOT NULL,
	"source_id" uuid,
	"response_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_form_submissions_source_type_check" CHECK ("data_form_submissions"."source_type" in ('profile', 'lesson', 'hub', 'api')),
	CONSTRAINT "data_form_submissions_source_id_check" CHECK (("data_form_submissions"."source_type" in ('profile', 'api') and "data_form_submissions"."source_id" is null) or ("data_form_submissions"."source_type" in ('lesson', 'hub') and "data_form_submissions"."source_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "data_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_definition_id" uuid NOT NULL,
	"key" varchar(120) NOT NULL,
	"name" varchar(180) NOT NULL,
	"description" text,
	"submit_label" varchar(80) DEFAULT 'Angaben speichern' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_forms_key_check" CHECK ("data_forms"."key" ~ '^[a-z][a-z0-9_]{1,119}$'),
	CONSTRAINT "data_forms_name_check" CHECK (btrim("data_forms"."name") <> ''),
	CONSTRAINT "data_forms_submit_label_check" CHECK (btrim("data_forms"."submit_label") <> '')
);
--> statement-breakpoint
CREATE TABLE "data_profile_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" varchar(120) NOT NULL,
	"name" varchar(180) NOT NULL,
	"description" text,
	"allow_member_creation" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_profile_definitions_key_check" CHECK ("data_profile_definitions"."key" ~ '^[a-z][a-z0-9_]{1,119}$'),
	CONSTRAINT "data_profile_definitions_name_check" CHECK (btrim("data_profile_definitions"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "data_profile_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"profile_definition_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"required_override" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "data_profile_fields_sort_check" CHECK ("data_profile_fields"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "data_profile_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_data_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"name" varchar(180) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_data_profiles_name_check" CHECK (btrim("member_data_profiles"."name") <> ''),
	CONSTRAINT "member_data_profiles_default_active_check" CHECK ("member_data_profiles"."is_default" = false or "member_data_profiles"."active" = true)
);
--> statement-breakpoint
CREATE TABLE "post_votes" (
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_votes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id"),
	CONSTRAINT "post_votes_value_check" CHECK ("post_votes"."value" in (-1, 1))
);
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "post_likes" DROP CONSTRAINT "post_likes_post_id_posts_id_fk";
--> statement-breakpoint
ALTER TABLE "post_likes" DROP CONSTRAINT "post_likes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "type" "community_space_type" DEFAULT 'feed' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD COLUMN "visibility" "custom_field_visibility" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_likes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "post_likes" ADD COLUMN "reaction" "community_reaction_type" DEFAULT 'like' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "title" varchar(240);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "comments" AS "comment"
SET "organization_id" = "post"."organization_id"
FROM "posts" AS "post"
WHERE "comment"."post_id" = "post"."id";--> statement-breakpoint
UPDATE "post_likes" AS "reaction"
SET "organization_id" = "post"."organization_id"
FROM "posts" AS "post"
WHERE "reaction"."post_id" = "post"."id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "posts" AS "post"
		JOIN "community_spaces" AS "space" ON "space"."id" = "post"."space_id"
		JOIN "users" AS "author" ON "author"."id" = "post"."author_id"
		WHERE "space"."organization_id" <> "post"."organization_id"
			OR "author"."organization_id" <> "post"."organization_id"
	) OR EXISTS (
		SELECT 1
		FROM "comments" AS "comment"
		JOIN "users" AS "author" ON "author"."id" = "comment"."author_id"
		WHERE "comment"."organization_id" IS NULL
			OR "author"."organization_id" <> "comment"."organization_id"
	) OR EXISTS (
		SELECT 1
		FROM "post_likes" AS "reaction"
		JOIN "users" AS "member" ON "member"."id" = "reaction"."user_id"
		WHERE "reaction"."organization_id" IS NULL
			OR "member"."organization_id" <> "reaction"."organization_id"
	) THEN
		RAISE EXCEPTION 'Community tenant backfill found inconsistent legacy rows.';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "post_likes" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "comments_id_post_organization_idx" ON "comments" USING btree ("id","post_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_spaces_id_organization_idx" ON "community_spaces" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_definitions_id_org_idx" ON "custom_field_definitions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "posts_id_organization_idx" ON "posts" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_forms_id_org_idx" ON "data_forms" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_profile_definitions_id_org_idx" ON "data_profile_definitions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_data_profiles_id_org_idx" ON "member_data_profiles" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_data_profiles_id_user_org_idx" ON "member_data_profiles" USING btree ("id","user_id","organization_id");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "custom_field_values" AS "field_value"
		JOIN "users" AS "member" ON "member"."id" = "field_value"."user_id"
		JOIN "custom_field_definitions" AS "field" ON "field"."id" = "field_value"."field_id"
		WHERE "member"."organization_id" <> "field_value"."organization_id"
			OR "field"."organization_id" <> "field_value"."organization_id"
	) THEN
		RAISE EXCEPTION 'Data-profile backfill found inconsistent legacy rows.';
	END IF;
END $$;--> statement-breakpoint
INSERT INTO "data_profile_definitions" (
	"organization_id",
	"key",
	"name",
	"description",
	"allow_member_creation",
	"active",
	"sort_order"
)
SELECT
	"organization"."id",
	'default',
	'Standardprofil',
	'Bestehende und allgemeine Profildaten.',
	false,
	true,
	0
FROM "organizations" AS "organization";--> statement-breakpoint
INSERT INTO "data_profile_fields" (
	"organization_id",
	"profile_definition_id",
	"field_id",
	"required_override",
	"sort_order"
)
SELECT
	"field"."organization_id",
	"definition"."id",
	"field"."id",
	NULL,
	"field"."sort_order"
FROM "custom_field_definitions" AS "field"
JOIN "data_profile_definitions" AS "definition"
	ON "definition"."organization_id" = "field"."organization_id"
	AND "definition"."key" = 'default';--> statement-breakpoint
INSERT INTO "member_data_profiles" (
	"organization_id",
	"user_id",
	"definition_id",
	"name",
	"is_default",
	"active"
)
SELECT
	"member"."organization_id",
	"member"."id",
	"definition"."id",
	'Standardprofil',
	true,
	true
FROM "users" AS "member"
JOIN "data_profile_definitions" AS "definition"
	ON "definition"."organization_id" = "member"."organization_id"
	AND "definition"."key" = 'default';--> statement-breakpoint
INSERT INTO "data_profile_values" (
	"organization_id",
	"user_id",
	"profile_id",
	"field_id",
	"value",
	"updated_at"
)
SELECT
	"field_value"."organization_id",
	"field_value"."user_id",
	"profile"."id",
	"field_value"."field_id",
	"field_value"."value",
	"field_value"."updated_at"
FROM "custom_field_values" AS "field_value"
JOIN "member_data_profiles" AS "profile"
	ON "profile"."organization_id" = "field_value"."organization_id"
	AND "profile"."user_id" = "field_value"."user_id"
	AND "profile"."is_default" = true;--> statement-breakpoint
ALTER TABLE "community_mentions" ADD CONSTRAINT "community_mentions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_mentions" ADD CONSTRAINT "community_mentions_post_tenant_fk" FOREIGN KEY ("post_id","organization_id") REFERENCES "public"."posts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_mentions" ADD CONSTRAINT "community_mentions_comment_post_tenant_fk" FOREIGN KEY ("comment_id","post_id","organization_id") REFERENCES "public"."comments"("id","post_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_mentions" ADD CONSTRAINT "community_mentions_mentioned_user_tenant_fk" FOREIGN KEY ("mentioned_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_mentions" ADD CONSTRAINT "community_mentions_mentioner_tenant_fk" FOREIGN KEY ("mentioned_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_fields" ADD CONSTRAINT "data_form_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_fields" ADD CONSTRAINT "data_form_fields_form_id_data_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."data_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_fields" ADD CONSTRAINT "data_form_fields_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_fields" ADD CONSTRAINT "data_form_fields_form_tenant_fk" FOREIGN KEY ("form_id","organization_id") REFERENCES "public"."data_forms"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_fields" ADD CONSTRAINT "data_form_fields_field_tenant_fk" FOREIGN KEY ("field_id","organization_id") REFERENCES "public"."custom_field_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_form_id_data_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."data_forms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_profile_id_member_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."member_data_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_submitted_by_id_users_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_form_tenant_fk" FOREIGN KEY ("form_id","organization_id") REFERENCES "public"."data_forms"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_profile_user_tenant_fk" FOREIGN KEY ("profile_id","user_id","organization_id") REFERENCES "public"."member_data_profiles"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_form_submissions" ADD CONSTRAINT "data_form_submissions_submitter_tenant_fk" FOREIGN KEY ("submitted_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_forms" ADD CONSTRAINT "data_forms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_forms" ADD CONSTRAINT "data_forms_profile_definition_id_data_profile_definitions_id_fk" FOREIGN KEY ("profile_definition_id") REFERENCES "public"."data_profile_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_forms" ADD CONSTRAINT "data_forms_definition_tenant_fk" FOREIGN KEY ("profile_definition_id","organization_id") REFERENCES "public"."data_profile_definitions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_definitions" ADD CONSTRAINT "data_profile_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_fields" ADD CONSTRAINT "data_profile_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_fields" ADD CONSTRAINT "data_profile_fields_profile_definition_id_data_profile_definitions_id_fk" FOREIGN KEY ("profile_definition_id") REFERENCES "public"."data_profile_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_fields" ADD CONSTRAINT "data_profile_fields_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_fields" ADD CONSTRAINT "data_profile_fields_definition_tenant_fk" FOREIGN KEY ("profile_definition_id","organization_id") REFERENCES "public"."data_profile_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_fields" ADD CONSTRAINT "data_profile_fields_field_tenant_fk" FOREIGN KEY ("field_id","organization_id") REFERENCES "public"."custom_field_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_profile_id_member_data_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."member_data_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_field_id_custom_field_definitions_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_profile_user_tenant_fk" FOREIGN KEY ("profile_id","user_id","organization_id") REFERENCES "public"."member_data_profiles"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_profile_values" ADD CONSTRAINT "data_profile_values_field_tenant_fk" FOREIGN KEY ("field_id","organization_id") REFERENCES "public"."custom_field_definitions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_data_profiles" ADD CONSTRAINT "member_data_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_data_profiles" ADD CONSTRAINT "member_data_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_data_profiles" ADD CONSTRAINT "member_data_profiles_definition_id_data_profile_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."data_profile_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_data_profiles" ADD CONSTRAINT "member_data_profiles_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_data_profiles" ADD CONSTRAINT "member_data_profiles_definition_tenant_fk" FOREIGN KEY ("definition_id","organization_id") REFERENCES "public"."data_profile_definitions"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_post_tenant_fk" FOREIGN KEY ("post_id","organization_id") REFERENCES "public"."posts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_votes" ADD CONSTRAINT "post_votes_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_mentions_post_user_idx" ON "community_mentions" USING btree ("organization_id","post_id","mentioned_user_id") WHERE "community_mentions"."comment_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "community_mentions_comment_user_idx" ON "community_mentions" USING btree ("organization_id","comment_id","mentioned_user_id") WHERE "community_mentions"."comment_id" is not null;--> statement-breakpoint
CREATE INDEX "community_mentions_org_user_created_idx" ON "community_mentions" USING btree ("organization_id","mentioned_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_form_fields_form_field_idx" ON "data_form_fields" USING btree ("form_id","field_id");--> statement-breakpoint
CREATE INDEX "data_form_fields_org_form_sort_idx" ON "data_form_fields" USING btree ("organization_id","form_id","sort_order");--> statement-breakpoint
CREATE INDEX "data_form_submissions_org_user_date_idx" ON "data_form_submissions" USING btree ("organization_id","user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "data_form_submissions_org_form_date_idx" ON "data_form_submissions" USING btree ("organization_id","form_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_forms_org_key_idx" ON "data_forms" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "data_forms_org_active_idx" ON "data_forms" USING btree ("organization_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "data_profile_definitions_org_key_idx" ON "data_profile_definitions" USING btree ("organization_id","key");--> statement-breakpoint
CREATE INDEX "data_profile_definitions_org_active_sort_idx" ON "data_profile_definitions" USING btree ("organization_id","active","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "data_profile_fields_definition_field_idx" ON "data_profile_fields" USING btree ("profile_definition_id","field_id");--> statement-breakpoint
CREATE INDEX "data_profile_fields_org_definition_sort_idx" ON "data_profile_fields" USING btree ("organization_id","profile_definition_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "data_profile_values_profile_field_idx" ON "data_profile_values" USING btree ("profile_id","field_id");--> statement-breakpoint
CREATE INDEX "data_profile_values_org_user_idx" ON "data_profile_values" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_data_profiles_org_user_name_idx" ON "member_data_profiles" USING btree ("organization_id","user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "member_data_profiles_org_user_default_idx" ON "member_data_profiles" USING btree ("organization_id","user_id") WHERE "member_data_profiles"."is_default" = true;--> statement-breakpoint
CREATE INDEX "member_data_profiles_org_user_active_idx" ON "member_data_profiles" USING btree ("organization_id","user_id","active");--> statement-breakpoint
CREATE INDEX "post_votes_org_post_idx" ON "post_votes" USING btree ("organization_id","post_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_tenant_fk" FOREIGN KEY ("post_id","organization_id") REFERENCES "public"."posts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_tenant_fk" FOREIGN KEY ("author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_post_tenant_fk" FOREIGN KEY ("parent_id","post_id","organization_id") REFERENCES "public"."comments"("id","post_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_tenant_fk" FOREIGN KEY ("post_id","organization_id") REFERENCES "public"."posts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_space_tenant_fk" FOREIGN KEY ("space_id","organization_id") REFERENCES "public"."community_spaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_tenant_fk" FOREIGN KEY ("author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_parent_created_idx" ON "comments" USING btree ("parent_id","created_at");--> statement-breakpoint
CREATE INDEX "post_likes_org_post_idx" ON "post_likes" USING btree ("organization_id","post_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_parent_self_check" CHECK ("comments"."parent_id" is null or "comments"."parent_id" <> "comments"."id");
