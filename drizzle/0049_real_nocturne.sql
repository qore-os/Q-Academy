CREATE TYPE "public"."community_score_contribution_kind" AS ENUM('post_reaction', 'post_comment', 'comment_reply', 'comment_reaction');--> statement-breakpoint
CREATE TABLE "comment_reactions" (
	"organization_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reaction" "community_reaction_type" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comment_reactions_comment_id_user_id_pk" PRIMARY KEY("comment_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "community_score_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" "community_score_contribution_kind" NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"reaction_comment_id" uuid,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_score_contributions_not_self_check" CHECK ("community_score_contributions"."recipient_id" <> "community_score_contributions"."actor_id"),
	CONSTRAINT "community_score_contributions_shape_check" CHECK ((
        "community_score_contributions"."kind" = 'post_reaction'
        and "community_score_contributions"."points" = 1
        and "community_score_contributions"."post_id" is not null
        and "community_score_contributions"."comment_id" is null
        and "community_score_contributions"."reaction_comment_id" is null
      ) or (
        "community_score_contributions"."kind" = 'post_comment'
        and "community_score_contributions"."points" = 2
        and "community_score_contributions"."post_id" is null
        and "community_score_contributions"."comment_id" is not null
        and "community_score_contributions"."reaction_comment_id" is null
      ) or (
        "community_score_contributions"."kind" = 'comment_reply'
        and "community_score_contributions"."points" = 1
        and "community_score_contributions"."post_id" is null
        and "community_score_contributions"."comment_id" is not null
        and "community_score_contributions"."reaction_comment_id" is null
      ) or (
        "community_score_contributions"."kind" = 'comment_reaction'
        and "community_score_contributions"."points" = 1
        and "community_score_contributions"."post_id" is null
        and "community_score_contributions"."comment_id" is null
        and "community_score_contributions"."reaction_comment_id" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "community_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "comment_reactions_source_tenant_idx" ON "comment_reactions" USING btree ("comment_id","user_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_id_author_organization_idx" ON "comments" USING btree ("id","author_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_likes_source_tenant_idx" ON "post_likes" USING btree ("post_id","user_id","organization_id");--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_comment_tenant_fk" FOREIGN KEY ("comment_id","post_id","organization_id") REFERENCES "public"."comments"("id","post_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_recipient_tenant_fk" FOREIGN KEY ("recipient_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_actor_tenant_fk" FOREIGN KEY ("actor_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_post_reaction_source_fk" FOREIGN KEY ("post_id","actor_id","organization_id") REFERENCES "public"."post_likes"("post_id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_comment_source_fk" FOREIGN KEY ("comment_id","actor_id","organization_id") REFERENCES "public"."comments"("id","author_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_score_contributions" ADD CONSTRAINT "community_score_contributions_comment_reaction_source_fk" FOREIGN KEY ("reaction_comment_id","actor_id","organization_id") REFERENCES "public"."comment_reactions"("comment_id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comment_reactions_org_comment_idx" ON "comment_reactions" USING btree ("organization_id","comment_id");--> statement-breakpoint
CREATE INDEX "comment_reactions_org_post_idx" ON "comment_reactions" USING btree ("organization_id","post_id");--> statement-breakpoint
CREATE INDEX "comment_reactions_org_created_idx" ON "comment_reactions" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "community_score_contributions_post_reaction_uidx" ON "community_score_contributions" USING btree ("organization_id","post_id","actor_id") WHERE "community_score_contributions"."kind" = 'post_reaction';--> statement-breakpoint
CREATE UNIQUE INDEX "community_score_contributions_post_comment_uidx" ON "community_score_contributions" USING btree ("organization_id","comment_id") WHERE "community_score_contributions"."kind" = 'post_comment';--> statement-breakpoint
CREATE UNIQUE INDEX "community_score_contributions_comment_reply_uidx" ON "community_score_contributions" USING btree ("organization_id","comment_id") WHERE "community_score_contributions"."kind" = 'comment_reply';--> statement-breakpoint
CREATE UNIQUE INDEX "community_score_contributions_comment_reaction_uidx" ON "community_score_contributions" USING btree ("organization_id","reaction_comment_id","actor_id") WHERE "community_score_contributions"."kind" = 'comment_reaction';--> statement-breakpoint
CREATE INDEX "community_score_contributions_org_recipient_created_idx" ON "community_score_contributions" USING btree ("organization_id","recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "community_score_contributions_org_actor_created_idx" ON "community_score_contributions" USING btree ("organization_id","actor_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_community_points_nonnegative_check" CHECK ("users"."community_points" >= 0);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."validate_community_score_contribution"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	valid_source boolean := false;
BEGIN
	IF TG_OP = 'UPDATE' THEN
		RAISE EXCEPTION 'community_score_contributions rows are immutable; delete and reinsert instead'
			USING ERRCODE = '55000';
	END IF;

	CASE NEW."kind"
		WHEN 'post_reaction' THEN
			SELECT true INTO valid_source
			FROM "public"."post_likes" AS reaction
			JOIN "public"."posts" AS post
				ON post."id" = reaction."post_id"
				AND post."organization_id" = reaction."organization_id"
			WHERE reaction."post_id" = NEW."post_id"
				AND reaction."user_id" = NEW."actor_id"
				AND reaction."organization_id" = NEW."organization_id"
				AND post."author_id" = NEW."recipient_id"
				AND post."moderation_state" = 'published'
			LIMIT 1;
		WHEN 'post_comment' THEN
			SELECT true INTO valid_source
			FROM "public"."comments" AS comment
			JOIN "public"."posts" AS post
				ON post."id" = comment."post_id"
				AND post."organization_id" = comment."organization_id"
			WHERE comment."id" = NEW."comment_id"
				AND comment."author_id" = NEW."actor_id"
				AND comment."organization_id" = NEW."organization_id"
				AND comment."parent_id" IS NULL
				AND comment."moderation_state" = 'published'
				AND post."moderation_state" = 'published'
				AND post."author_id" = NEW."recipient_id"
			LIMIT 1;
		WHEN 'comment_reply' THEN
			SELECT true INTO valid_source
			FROM "public"."comments" AS reply
			JOIN "public"."comments" AS parent
				ON parent."id" = reply."parent_id"
				AND parent."post_id" = reply."post_id"
				AND parent."organization_id" = reply."organization_id"
			JOIN "public"."posts" AS post
				ON post."id" = reply."post_id"
				AND post."organization_id" = reply."organization_id"
			WHERE reply."id" = NEW."comment_id"
				AND reply."author_id" = NEW."actor_id"
				AND reply."organization_id" = NEW."organization_id"
				AND reply."moderation_state" = 'published'
				AND parent."moderation_state" = 'published'
				AND post."moderation_state" = 'published'
				AND parent."author_id" = NEW."recipient_id"
			LIMIT 1;
		WHEN 'comment_reaction' THEN
			SELECT true INTO valid_source
			FROM "public"."comment_reactions" AS reaction
			JOIN "public"."comments" AS comment
				ON comment."id" = reaction."comment_id"
				AND comment."post_id" = reaction."post_id"
				AND comment."organization_id" = reaction."organization_id"
			JOIN "public"."posts" AS post
				ON post."id" = comment."post_id"
				AND post."organization_id" = comment."organization_id"
			WHERE reaction."comment_id" = NEW."reaction_comment_id"
				AND reaction."user_id" = NEW."actor_id"
				AND reaction."organization_id" = NEW."organization_id"
				AND comment."author_id" = NEW."recipient_id"
				AND comment."moderation_state" = 'published'
				AND post."moderation_state" = 'published'
			LIMIT 1;
	END CASE;

	IF NOT valid_source THEN
		RAISE EXCEPTION 'Invalid source or recipient for community score contribution %', NEW."id"
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."validate_community_score_contribution"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "community_score_contributions_validate_trigger"
BEFORE INSERT OR UPDATE ON "community_score_contributions"
FOR EACH ROW EXECUTE FUNCTION "public"."validate_community_score_contribution"();--> statement-breakpoint
INSERT INTO "community_score_contributions" (
	"organization_id", "recipient_id", "actor_id", "kind", "post_id", "points", "created_at"
)
SELECT reaction."organization_id", post."author_id", reaction."user_id",
	'post_reaction', reaction."post_id", 1, reaction."created_at"
FROM "post_likes" AS reaction
JOIN "posts" AS post
	ON post."id" = reaction."post_id"
	AND post."organization_id" = reaction."organization_id"
WHERE post."moderation_state" = 'published'
	AND post."author_id" <> reaction."user_id";--> statement-breakpoint
INSERT INTO "community_score_contributions" (
	"organization_id", "recipient_id", "actor_id", "kind", "comment_id", "points", "created_at"
)
SELECT comment."organization_id", post."author_id", comment."author_id",
	'post_comment', comment."id", 2, comment."created_at"
FROM "comments" AS comment
JOIN "posts" AS post
	ON post."id" = comment."post_id"
	AND post."organization_id" = comment."organization_id"
WHERE comment."parent_id" IS NULL
	AND comment."moderation_state" = 'published'
	AND post."moderation_state" = 'published'
	AND post."author_id" <> comment."author_id";--> statement-breakpoint
INSERT INTO "community_score_contributions" (
	"organization_id", "recipient_id", "actor_id", "kind", "comment_id", "points", "created_at"
)
SELECT reply."organization_id", parent."author_id", reply."author_id",
	'comment_reply', reply."id", 1, reply."created_at"
FROM "comments" AS reply
JOIN "comments" AS parent
	ON parent."id" = reply."parent_id"
	AND parent."post_id" = reply."post_id"
	AND parent."organization_id" = reply."organization_id"
JOIN "posts" AS post
	ON post."id" = reply."post_id"
	AND post."organization_id" = reply."organization_id"
WHERE reply."moderation_state" = 'published'
	AND parent."moderation_state" = 'published'
	AND post."moderation_state" = 'published'
	AND parent."author_id" <> reply."author_id";--> statement-breakpoint
DO $block$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "community_score_contributions"
		GROUP BY "organization_id", "recipient_id"
		HAVING sum("points"::bigint) > 2147483647
	) THEN
		RAISE EXCEPTION 'Community score backfill exceeds integer range'
			USING ERRCODE = '22003';
	END IF;
END;
$block$;--> statement-breakpoint
UPDATE "users" SET "community_points" = 0;--> statement-breakpoint
UPDATE "users" AS recipient
SET "community_points" = score."points"::integer
FROM (
	SELECT "organization_id", "recipient_id", sum("points"::bigint) AS "points"
	FROM "community_score_contributions"
	GROUP BY "organization_id", "recipient_id"
) AS score
WHERE recipient."id" = score."recipient_id"
	AND recipient."organization_id" = score."organization_id";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."apply_community_score_contribution_delta"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'INSERT' THEN
		UPDATE "public"."users"
		SET "community_points" = "community_points" + NEW."points"
		WHERE "id" = NEW."recipient_id"
			AND "organization_id" = NEW."organization_id";

		IF NOT FOUND THEN
			RAISE EXCEPTION 'Community score recipient does not exist in tenant'
				USING ERRCODE = '23503';
		END IF;

		RETURN NEW;
	END IF;

	UPDATE "public"."users"
	SET "community_points" = "community_points" - OLD."points"
	WHERE "id" = OLD."recipient_id"
		AND "organization_id" = OLD."organization_id"
		AND "community_points" >= OLD."points";

	IF NOT FOUND AND EXISTS (
		SELECT 1 FROM "public"."users"
		WHERE "id" = OLD."recipient_id"
			AND "organization_id" = OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'Community score cannot become negative'
			USING ERRCODE = '23514';
	END IF;

	RETURN OLD;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."apply_community_score_contribution_delta"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "community_score_contributions_delta_trigger"
AFTER INSERT OR DELETE ON "community_score_contributions"
FOR EACH ROW EXECUTE FUNCTION "public"."apply_community_score_contribution_delta"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."reject_community_score_contribution_truncate"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'community_score_contributions cannot be truncated'
		USING ERRCODE = '55000';
	RETURN NULL;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reject_community_score_contribution_truncate"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "community_score_contributions_reject_truncate_trigger"
BEFORE TRUNCATE ON "community_score_contributions"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_community_score_contribution_truncate"();--> statement-breakpoint
UPDATE "community_level_settings"
SET "enabled" = true,
	"revision" = "revision" + 1,
	"updated_at" = statement_timestamp()
WHERE NOT "enabled";--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_comment_reactions_trigger"
AFTER UPDATE OF "organization_id", "comment_id", "post_id", "user_id", "reaction", "created_at" OR DELETE
ON "comment_reactions" FOR EACH ROW EXECUTE FUNCTION "public"."bump_community_feed_revision"();
