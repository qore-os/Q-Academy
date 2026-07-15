CREATE TYPE "public"."community_author_boost_strength" AS ENUM('light', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."community_follow_target_type" AS ENUM('author', 'space');--> statement-breakpoint
CREATE TABLE "community_author_boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"strength" "community_author_boost_strength" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_author_boosts_window_check" CHECK ("community_author_boosts"."starts_at" < "community_author_boosts"."ends_at" and "community_author_boosts"."ends_at" <= "community_author_boosts"."starts_at" + interval '90 days'),
	CONSTRAINT "community_author_boosts_reason_check" CHECK (length(btrim("community_author_boosts"."reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE TABLE "community_feed_revisions" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_feed_revisions_nonnegative_check" CHECK ("community_feed_revisions"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "community_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"follower_id" uuid NOT NULL,
	"target_type" "community_follow_target_type" NOT NULL,
	"target_author_id" uuid,
	"target_space_id" uuid,
	"notify" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_follows_target_shape_check" CHECK (("community_follows"."target_type" = 'author' and "community_follows"."target_author_id" is not null and "community_follows"."target_space_id" is null) or ("community_follows"."target_type" = 'space' and "community_follows"."target_author_id" is null and "community_follows"."target_space_id" is not null)),
	CONSTRAINT "community_follows_not_self_check" CHECK ("community_follows"."target_author_id" is null or "community_follows"."target_author_id" <> "community_follows"."follower_id")
);
--> statement-breakpoint
ALTER TABLE "community_author_boosts" ADD CONSTRAINT "community_author_boosts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_author_boosts" ADD CONSTRAINT "community_author_boosts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_author_boosts" ADD CONSTRAINT "community_author_boosts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_author_boosts" ADD CONSTRAINT "community_author_boosts_author_tenant_fk" FOREIGN KEY ("author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_author_boosts" ADD CONSTRAINT "community_author_boosts_creator_tenant_fk" FOREIGN KEY ("created_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_feed_revisions" ADD CONSTRAINT "community_feed_revisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_target_author_id_users_id_fk" FOREIGN KEY ("target_author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_target_space_id_community_spaces_id_fk" FOREIGN KEY ("target_space_id") REFERENCES "public"."community_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_follower_tenant_fk" FOREIGN KEY ("follower_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_author_tenant_fk" FOREIGN KEY ("target_author_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_follows" ADD CONSTRAINT "community_follows_space_tenant_fk" FOREIGN KEY ("target_space_id","organization_id") REFERENCES "public"."community_spaces"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_author_boosts_author_unique_idx" ON "community_author_boosts" USING btree ("organization_id","author_id");--> statement-breakpoint
CREATE INDEX "community_author_boosts_active_idx" ON "community_author_boosts" USING btree ("organization_id","starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_follows_author_unique_idx" ON "community_follows" USING btree ("organization_id","follower_id","target_author_id") WHERE "community_follows"."target_type" = 'author';--> statement-breakpoint
CREATE UNIQUE INDEX "community_follows_space_unique_idx" ON "community_follows" USING btree ("organization_id","follower_id","target_space_id") WHERE "community_follows"."target_type" = 'space';--> statement-breakpoint
CREATE INDEX "community_follows_follower_created_idx" ON "community_follows" USING btree ("organization_id","follower_id","created_at");--> statement-breakpoint
CREATE INDEX "community_follows_author_idx" ON "community_follows" USING btree ("organization_id","target_author_id");--> statement-breakpoint
CREATE INDEX "community_follows_space_idx" ON "community_follows" USING btree ("organization_id","target_space_id");--> statement-breakpoint
CREATE INDEX "comments_org_post_parent_created_idx" ON "comments" USING btree ("organization_id","post_id","parent_id","created_at","id");--> statement-breakpoint
CREATE INDEX "comments_org_post_created_author_idx" ON "comments" USING btree ("organization_id","post_id","created_at","author_id");--> statement-breakpoint
CREATE INDEX "comments_org_created_idx" ON "comments" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "post_likes_org_post_created_user_idx" ON "post_likes" USING btree ("organization_id","post_id","created_at","user_id");--> statement-breakpoint
CREATE INDEX "post_likes_org_created_idx" ON "post_likes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "post_votes_org_post_created_user_idx" ON "post_votes" USING btree ("organization_id","post_id","created_at","user_id");--> statement-breakpoint
CREATE INDEX "post_votes_org_created_idx" ON "post_votes" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_org_created_id_idx" ON "posts" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_org_author_created_id_idx" ON "posts" USING btree ("organization_id","author_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_org_space_created_id_idx" ON "posts" USING btree ("organization_id","space_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "posts_org_pinned_created_id_idx" ON "posts" USING btree ("organization_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "posts"."pinned" = true;
--> statement-breakpoint
INSERT INTO "community_feed_revisions" ("organization_id", "revision")
SELECT "id", 0 FROM "organizations"
ON CONFLICT ("organization_id") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "bump_community_feed_revision"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_organization_id uuid;
  processed_organizations text;
  organization_token text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_organization_id := OLD.organization_id;
  ELSE
    target_organization_id := NEW.organization_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = target_organization_id) THEN
    RETURN NULL;
  END IF;
  organization_token := ',' || target_organization_id::text || ',';
  processed_organizations := coalesce(
    nullif(current_setting('q_academy.community_feed_revision_organizations', true), ''),
    ','
  );
  IF position(organization_token in processed_organizations) > 0 THEN
    RETURN NULL;
  END IF;
  PERFORM set_config(
    'q_academy.community_feed_revision_organizations',
    processed_organizations || target_organization_id::text || ',',
    true
  );
  INSERT INTO public.community_feed_revisions (organization_id, revision, updated_at)
  VALUES (target_organization_id, 1, statement_timestamp())
  ON CONFLICT (organization_id) DO UPDATE
  SET revision = public.community_feed_revisions.revision + 1,
      updated_at = statement_timestamp();
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "bump_community_feed_revision_from_group_member"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_group_id uuid;
  target_organization_id uuid;
  processed_organizations text;
  organization_token text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_group_id := OLD.group_id;
  ELSE target_group_id := NEW.group_id;
  END IF;
  SELECT organization_id INTO target_organization_id FROM public.groups WHERE id = target_group_id;
  IF target_organization_id IS NOT NULL THEN
    organization_token := ',' || target_organization_id::text || ',';
    processed_organizations := coalesce(
      nullif(current_setting('q_academy.community_feed_revision_organizations', true), ''),
      ','
    );
    IF position(organization_token in processed_organizations) > 0 THEN
      RETURN NULL;
    END IF;
    PERFORM set_config(
      'q_academy.community_feed_revision_organizations',
      processed_organizations || target_organization_id::text || ',',
      true
    );
    INSERT INTO public.community_feed_revisions (organization_id, revision, updated_at)
    VALUES (target_organization_id, 1, statement_timestamp())
    ON CONFLICT (organization_id) DO UPDATE
    SET revision = public.community_feed_revisions.revision + 1,
        updated_at = statement_timestamp();
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION "bump_community_feed_revision_from_member_bundle"() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_bundle_id uuid;
  target_organization_id uuid;
  processed_organizations text;
  organization_token text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_bundle_id := OLD.bundle_id;
  ELSE target_bundle_id := NEW.bundle_id;
  END IF;
  SELECT organization_id INTO target_organization_id FROM public.bundles WHERE id = target_bundle_id;
  IF target_organization_id IS NOT NULL THEN
    organization_token := ',' || target_organization_id::text || ',';
    processed_organizations := coalesce(
      nullif(current_setting('q_academy.community_feed_revision_organizations', true), ''),
      ','
    );
    IF position(organization_token in processed_organizations) > 0 THEN
      RETURN NULL;
    END IF;
    PERFORM set_config(
      'q_academy.community_feed_revision_organizations',
      processed_organizations || target_organization_id::text || ',',
      true
    );
    INSERT INTO public.community_feed_revisions (organization_id, revision, updated_at)
    VALUES (target_organization_id, 1, statement_timestamp())
    ON CONFLICT (organization_id) DO UPDATE
    SET revision = public.community_feed_revisions.revision + 1,
        updated_at = statement_timestamp();
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_posts_trigger" AFTER INSERT OR UPDATE OR DELETE ON "posts" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_post_likes_trigger" AFTER INSERT OR UPDATE OR DELETE ON "post_likes" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_post_votes_trigger" AFTER INSERT OR UPDATE OR DELETE ON "post_votes" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_comments_trigger" AFTER INSERT OR UPDATE OR DELETE ON "comments" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_follows_trigger" AFTER INSERT OR UPDATE OR DELETE ON "community_follows" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_boosts_trigger" AFTER INSERT OR UPDATE OR DELETE ON "community_author_boosts" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_spaces_trigger" AFTER INSERT OR UPDATE OR DELETE ON "community_spaces" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_space_rules_trigger" AFTER INSERT OR UPDATE OR DELETE ON "community_space_access_rules" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_users_trigger" AFTER INSERT OR UPDATE OR DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_groups_trigger" AFTER INSERT OR UPDATE OR DELETE ON "groups" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_bundles_trigger" AFTER INSERT OR UPDATE OR DELETE ON "bundles" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_group_members_trigger" AFTER INSERT OR UPDATE OR DELETE ON "group_members" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision_from_group_member"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_group_bundles_trigger" AFTER INSERT OR UPDATE OR DELETE ON "group_bundles" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision_from_group_member"();
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_member_bundles_trigger" AFTER INSERT OR UPDATE OR DELETE ON "member_bundles" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision_from_member_bundle"();
--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_community_feed_revision"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_community_feed_revision_from_group_member"() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "bump_community_feed_revision_from_member_bundle"() FROM PUBLIC;
