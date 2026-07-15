DROP TRIGGER "community_feed_revision_posts_trigger" ON "posts";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_posts_trigger"
AFTER UPDATE OF "organization_id", "space_id", "author_id", "pinned", "created_at" OR DELETE
ON "posts" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_post_likes_trigger" ON "post_likes";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_post_likes_trigger"
AFTER UPDATE OF "organization_id", "post_id", "user_id", "created_at" OR DELETE
ON "post_likes" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_post_votes_trigger" ON "post_votes";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_post_votes_trigger"
AFTER UPDATE OF "organization_id", "post_id", "user_id", "created_at" OR DELETE
ON "post_votes" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_comments_trigger" ON "comments";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_comments_trigger"
AFTER UPDATE OF "organization_id", "post_id", "author_id", "created_at" OR DELETE
ON "comments" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_follows_trigger" ON "community_follows";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_follows_trigger"
AFTER UPDATE OF "organization_id", "follower_id", "target_type", "target_author_id", "target_space_id", "created_at" OR DELETE
ON "community_follows" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_boosts_trigger" ON "community_author_boosts";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_boosts_trigger"
AFTER UPDATE OF "organization_id", "author_id", "strength", "starts_at", "ends_at", "created_at" OR DELETE
ON "community_author_boosts" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_spaces_trigger" ON "community_spaces";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_spaces_trigger"
AFTER UPDATE OF "organization_id", "access_mode" OR DELETE
ON "community_spaces" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_users_trigger" ON "users";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_users_trigger"
AFTER UPDATE OF "organization_id", "role", "status" OR DELETE
ON "users" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_groups_trigger" ON "groups";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_groups_trigger"
AFTER UPDATE OF "organization_id" OR DELETE
ON "groups" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
--> statement-breakpoint
DROP TRIGGER "community_feed_revision_bundles_trigger" ON "bundles";
--> statement-breakpoint
CREATE TRIGGER "community_feed_revision_bundles_trigger"
AFTER UPDATE OF "organization_id", "active" OR DELETE
ON "bundles" FOR EACH ROW EXECUTE FUNCTION "bump_community_feed_revision"();
