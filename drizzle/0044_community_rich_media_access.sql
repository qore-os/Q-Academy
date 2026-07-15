CREATE TYPE "public"."community_access_subject_type" AS ENUM('role', 'user', 'group', 'bundle');--> statement-breakpoint
CREATE TYPE "public"."community_space_access_mode" AS ENUM('open', 'restricted');--> statement-breakpoint
ALTER TYPE "public"."media_asset_purpose" ADD VALUE 'community' BEFORE 'avatar';--> statement-breakpoint
CREATE UNIQUE INDEX "bundles_id_organization_idx" ON "bundles" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_id_organization_idx" ON "groups" USING btree ("id","organization_id");--> statement-breakpoint
CREATE TABLE "community_comment_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_comment_attachments_sort_order_check" CHECK ("community_comment_attachments"."sort_order" >= 0 and "community_comment_attachments"."sort_order" < 3)
);
--> statement-breakpoint
CREATE TABLE "community_post_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_post_attachments_sort_order_check" CHECK ("community_post_attachments"."sort_order" >= 0 and "community_post_attachments"."sort_order" < 6)
);
--> statement-breakpoint
CREATE TABLE "community_space_access_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"subject_type" "community_access_subject_type" NOT NULL,
	"subject_role" "role",
	"subject_user_id" uuid,
	"subject_group_id" uuid,
	"subject_bundle_id" uuid,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_post" boolean DEFAULT false NOT NULL,
	"can_comment" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_access_rules_subject_shape_check" CHECK ((
        "community_space_access_rules"."subject_type" = 'role' and "community_space_access_rules"."subject_role" is not null and "community_space_access_rules"."subject_user_id" is null and "community_space_access_rules"."subject_group_id" is null and "community_space_access_rules"."subject_bundle_id" is null
      ) or (
        "community_space_access_rules"."subject_type" = 'user' and "community_space_access_rules"."subject_role" is null and "community_space_access_rules"."subject_user_id" is not null and "community_space_access_rules"."subject_group_id" is null and "community_space_access_rules"."subject_bundle_id" is null
      ) or (
        "community_space_access_rules"."subject_type" = 'group' and "community_space_access_rules"."subject_role" is null and "community_space_access_rules"."subject_user_id" is null and "community_space_access_rules"."subject_group_id" is not null and "community_space_access_rules"."subject_bundle_id" is null
      ) or (
        "community_space_access_rules"."subject_type" = 'bundle' and "community_space_access_rules"."subject_role" is null and "community_space_access_rules"."subject_user_id" is null and "community_space_access_rules"."subject_group_id" is null and "community_space_access_rules"."subject_bundle_id" is not null
      )),
	CONSTRAINT "community_access_rules_permission_check" CHECK ("community_space_access_rules"."can_view" and ("community_space_access_rules"."can_view" or "community_space_access_rules"."can_post" or "community_space_access_rules"."can_comment"))
);
--> statement-breakpoint
ALTER TABLE "community_spaces" ADD COLUMN "access_mode" "community_space_access_mode" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_comment_attachments" ADD CONSTRAINT "community_comment_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comment_attachments" ADD CONSTRAINT "community_comment_attachments_comment_tenant_fk" FOREIGN KEY ("comment_id","post_id","organization_id") REFERENCES "public"."comments"("id","post_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comment_attachments" ADD CONSTRAINT "community_comment_attachments_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_post_tenant_fk" FOREIGN KEY ("post_id","organization_id") REFERENCES "public"."posts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_access_rules" ADD CONSTRAINT "community_space_access_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_access_rules" ADD CONSTRAINT "community_access_rules_space_tenant_fk" FOREIGN KEY ("space_id","organization_id") REFERENCES "public"."community_spaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_access_rules" ADD CONSTRAINT "community_access_rules_user_tenant_fk" FOREIGN KEY ("subject_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_access_rules" ADD CONSTRAINT "community_access_rules_group_tenant_fk" FOREIGN KEY ("subject_group_id","organization_id") REFERENCES "public"."groups"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_space_access_rules" ADD CONSTRAINT "community_access_rules_bundle_tenant_fk" FOREIGN KEY ("subject_bundle_id","organization_id") REFERENCES "public"."bundles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_comment_attachments_asset_idx" ON "community_comment_attachments" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_comment_attachments_comment_order_idx" ON "community_comment_attachments" USING btree ("comment_id","sort_order");--> statement-breakpoint
CREATE INDEX "community_comment_attachments_org_comment_idx" ON "community_comment_attachments" USING btree ("organization_id","comment_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "community_post_attachments_asset_idx" ON "community_post_attachments" USING btree ("media_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_post_attachments_post_order_idx" ON "community_post_attachments" USING btree ("post_id","sort_order");--> statement-breakpoint
CREATE INDEX "community_post_attachments_org_post_idx" ON "community_post_attachments" USING btree ("organization_id","post_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "community_access_rules_role_idx" ON "community_space_access_rules" USING btree ("space_id","subject_role") WHERE "community_space_access_rules"."subject_type" = 'role';--> statement-breakpoint
CREATE UNIQUE INDEX "community_access_rules_user_idx" ON "community_space_access_rules" USING btree ("space_id","subject_user_id") WHERE "community_space_access_rules"."subject_type" = 'user';--> statement-breakpoint
CREATE UNIQUE INDEX "community_access_rules_group_idx" ON "community_space_access_rules" USING btree ("space_id","subject_group_id") WHERE "community_space_access_rules"."subject_type" = 'group';--> statement-breakpoint
CREATE UNIQUE INDEX "community_access_rules_bundle_idx" ON "community_space_access_rules" USING btree ("space_id","subject_bundle_id") WHERE "community_space_access_rules"."subject_type" = 'bundle';--> statement-breakpoint
CREATE INDEX "community_access_rules_org_space_idx" ON "community_space_access_rules" USING btree ("organization_id","space_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "validate_community_post_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	asset_owner uuid;
	asset_purpose media_asset_purpose;
	asset_status media_asset_status;
	asset_deleted_at timestamptz;
	post_author uuid;
	existing_count integer;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'community attachment bindings are immutable' USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	SELECT m."owner_user_id", m."purpose", m."status", m."deleted_at", p."author_id"
	INTO asset_owner, asset_purpose, asset_status, asset_deleted_at, post_author
	FROM "media_assets" m
	JOIN "posts" p ON p."id" = NEW."post_id" AND p."organization_id" = NEW."organization_id"
	WHERE m."id" = NEW."media_asset_id" AND m."organization_id" = NEW."organization_id"
	FOR UPDATE OF m;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'community attachment target is missing' USING ERRCODE = '23503';
	END IF;
	IF asset_purpose <> 'community' OR asset_status <> 'ready' OR asset_deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'community attachment asset must be ready and nondeleted' USING ERRCODE = '23514';
	END IF;
	IF asset_owner IS DISTINCT FROM post_author THEN
		RAISE EXCEPTION 'community attachment owner must equal post author' USING ERRCODE = '23514';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "community_comment_attachments" c
		WHERE c."media_asset_id" = NEW."media_asset_id"
	) THEN
		RAISE EXCEPTION 'community media asset is already bound' USING ERRCODE = '23505';
	END IF;
	SELECT count(*)::integer INTO existing_count
	FROM "community_post_attachments" a WHERE a."post_id" = NEW."post_id";
	IF existing_count >= 6 OR NEW."sort_order" <> existing_count THEN
		RAISE EXCEPTION 'community post attachments must be contiguous and contain at most six assets' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "validate_community_comment_attachment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	asset_owner uuid;
	asset_purpose media_asset_purpose;
	asset_status media_asset_status;
	asset_deleted_at timestamptz;
	comment_author uuid;
	existing_count integer;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		IF NEW IS DISTINCT FROM OLD THEN
			RAISE EXCEPTION 'community attachment bindings are immutable' USING ERRCODE = '55000';
		END IF;
		RETURN NEW;
	END IF;

	SELECT m."owner_user_id", m."purpose", m."status", m."deleted_at", c."author_id"
	INTO asset_owner, asset_purpose, asset_status, asset_deleted_at, comment_author
	FROM "media_assets" m
	JOIN "comments" c ON c."id" = NEW."comment_id" AND c."post_id" = NEW."post_id" AND c."organization_id" = NEW."organization_id"
	WHERE m."id" = NEW."media_asset_id" AND m."organization_id" = NEW."organization_id"
	FOR UPDATE OF m;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'community attachment target is missing' USING ERRCODE = '23503';
	END IF;
	IF asset_purpose <> 'community' OR asset_status <> 'ready' OR asset_deleted_at IS NOT NULL THEN
		RAISE EXCEPTION 'community attachment asset must be ready and nondeleted' USING ERRCODE = '23514';
	END IF;
	IF asset_owner IS DISTINCT FROM comment_author THEN
		RAISE EXCEPTION 'community attachment owner must equal comment author' USING ERRCODE = '23514';
	END IF;
	IF EXISTS (
		SELECT 1 FROM "community_post_attachments" p
		WHERE p."media_asset_id" = NEW."media_asset_id"
	) THEN
		RAISE EXCEPTION 'community media asset is already bound' USING ERRCODE = '23505';
	END IF;
	SELECT count(*)::integer INTO existing_count
	FROM "community_comment_attachments" a WHERE a."comment_id" = NEW."comment_id";
	IF existing_count >= 3 OR NEW."sort_order" <> existing_count THEN
		RAISE EXCEPTION 'community comment attachments must be contiguous and contain at most three assets' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "community_post_attachments_validate"
BEFORE INSERT OR UPDATE ON "community_post_attachments"
FOR EACH ROW EXECUTE FUNCTION "validate_community_post_attachment"();--> statement-breakpoint

CREATE TRIGGER "community_comment_attachments_validate"
BEFORE INSERT OR UPDATE ON "community_comment_attachments"
FOR EACH ROW EXECUTE FUNCTION "validate_community_comment_attachment"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "prevent_bound_community_media_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM "community_post_attachments" p WHERE p."media_asset_id" = OLD."id")
		OR EXISTS (SELECT 1 FROM "community_comment_attachments" c WHERE c."media_asset_id" = OLD."id")
	THEN
		IF NEW."purpose" IS DISTINCT FROM OLD."purpose"
			OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
			OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
			OR NEW."status" IS DISTINCT FROM OLD."status"
			OR NEW."deleted_at" IS NOT NULL
		THEN
			RAISE EXCEPTION 'bound community media assets are immutable and cannot be deleted' USING ERRCODE = '55000';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "media_assets_prevent_bound_community_update"
BEFORE UPDATE OF "purpose", "owner_user_id", "organization_id", "status", "deleted_at" ON "media_assets"
FOR EACH ROW EXECUTE FUNCTION "prevent_bound_community_media_update"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "prevent_new_post_image_url"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF (TG_OP = 'INSERT' AND NEW."image_url" IS NOT NULL)
		OR (TG_OP = 'UPDATE' AND NEW."image_url" IS DISTINCT FROM OLD."image_url" AND NEW."image_url" IS NOT NULL)
	THEN
		RAISE EXCEPTION 'posts.image_url is legacy read-only; use community attachments' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "posts_prevent_new_image_url"
BEFORE INSERT OR UPDATE OF "image_url" ON "posts"
FOR EACH ROW EXECUTE FUNCTION "prevent_new_post_image_url"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "protect_community_attachment_target"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_TABLE_NAME = 'posts' THEN
		IF EXISTS (SELECT 1 FROM "community_post_attachments" a WHERE a."post_id" = OLD."id")
			OR EXISTS (
				SELECT 1 FROM "community_comment_attachments" a
				WHERE a."post_id" = OLD."id"
			)
		THEN
			IF NEW."id" IS DISTINCT FROM OLD."id"
				OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
				OR NEW."space_id" IS DISTINCT FROM OLD."space_id"
				OR NEW."author_id" IS DISTINCT FROM OLD."author_id"
			THEN
				RAISE EXCEPTION 'a post with community attachments cannot change identity, space, tenant, or author' USING ERRCODE = '55000';
			END IF;
		END IF;
	ELSIF EXISTS (SELECT 1 FROM "community_comment_attachments" a WHERE a."comment_id" = OLD."id") THEN
		IF NEW."id" IS DISTINCT FROM OLD."id"
			OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
			OR NEW."post_id" IS DISTINCT FROM OLD."post_id"
			OR NEW."author_id" IS DISTINCT FROM OLD."author_id"
		THEN
			RAISE EXCEPTION 'a comment with community attachments cannot change identity, post, tenant, or author' USING ERRCODE = '55000';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "posts_protect_community_attachment_target"
BEFORE UPDATE OF "id", "organization_id", "space_id", "author_id" ON "posts"
FOR EACH ROW EXECUTE FUNCTION "protect_community_attachment_target"();--> statement-breakpoint

CREATE TRIGGER "comments_protect_community_attachment_target"
BEFORE UPDATE OF "id", "organization_id", "post_id", "author_id" ON "comments"
FOR EACH ROW EXECUTE FUNCTION "protect_community_attachment_target"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "soft_delete_detached_community_asset"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	UPDATE "media_assets"
	SET "status" = 'deleted',
		"deleted_at" = coalesce("deleted_at", now()),
		"scan_claim_token" = null,
		"scan_claimed_at" = null,
		"scan_lease_expires_at" = null,
		"scan_next_retry_at" = null,
		"updated_at" = now()
	WHERE "id" = OLD."media_asset_id"
		AND "organization_id" = OLD."organization_id"
		AND "purpose" = 'community'
		AND "status" <> 'deleted';
	RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "community_post_attachments_soft_delete_asset"
AFTER DELETE ON "community_post_attachments"
FOR EACH ROW EXECUTE FUNCTION "soft_delete_detached_community_asset"();--> statement-breakpoint

CREATE TRIGGER "community_comment_attachments_soft_delete_asset"
AFTER DELETE ON "community_comment_attachments"
FOR EACH ROW EXECUTE FUNCTION "soft_delete_detached_community_asset"();
