CREATE TABLE "community_asset_bindings" (
	"media_asset_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_asset_bindings" ADD CONSTRAINT "community_asset_bindings_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_asset_bindings_asset_org_idx" ON "community_asset_bindings" USING btree ("media_asset_id","organization_id");--> statement-breakpoint
CREATE INDEX "community_asset_bindings_org_created_idx" ON "community_asset_bindings" USING btree ("organization_id","created_at");--> statement-breakpoint
INSERT INTO "community_asset_bindings" ("media_asset_id", "organization_id", "created_at")
SELECT "media_asset_id", "organization_id", "created_at"
FROM "community_post_attachments"
UNION ALL
SELECT "media_asset_id", "organization_id", "created_at"
FROM "community_comment_attachments";--> statement-breakpoint
ALTER TABLE "community_comment_attachments" ADD CONSTRAINT "community_comment_attachments_registry_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."community_asset_bindings"("media_asset_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_post_attachments" ADD CONSTRAINT "community_post_attachments_registry_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."community_asset_bindings"("media_asset_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "guard_community_asset_binding_registry"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF pg_trigger_depth() <= 1 THEN
		RAISE EXCEPTION 'community asset binding registry is trigger-managed' USING ERRCODE = '55000';
	END IF;
	RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "community_asset_bindings_guard_insert"
BEFORE INSERT OR UPDATE OR DELETE ON "community_asset_bindings"
FOR EACH ROW EXECUTE FUNCTION "guard_community_asset_binding_registry"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "register_community_asset_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "community_asset_bindings" (
		"media_asset_id", "organization_id", "created_at"
	) VALUES (
		NEW."media_asset_id", NEW."organization_id", NEW."created_at"
	);
	RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "community_post_attachments_register"
BEFORE INSERT ON "community_post_attachments"
FOR EACH ROW EXECUTE FUNCTION "register_community_asset_binding"();--> statement-breakpoint

CREATE TRIGGER "community_comment_attachments_register"
BEFORE INSERT ON "community_comment_attachments"
FOR EACH ROW EXECUTE FUNCTION "register_community_asset_binding"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "unregister_community_asset_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "community_asset_bindings"
	WHERE "media_asset_id" = OLD."media_asset_id"
		AND "organization_id" = OLD."organization_id";
	RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "community_post_attachments_registry_cleanup"
AFTER DELETE ON "community_post_attachments"
FOR EACH ROW EXECUTE FUNCTION "unregister_community_asset_binding"();--> statement-breakpoint

CREATE TRIGGER "community_comment_attachments_registry_cleanup"
AFTER DELETE ON "community_comment_attachments"
FOR EACH ROW EXECUTE FUNCTION "unregister_community_asset_binding"();--> statement-breakpoint

CREATE OR REPLACE FUNCTION "delete_community_before_organization"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "community_spaces"
	WHERE "organization_id" = OLD."id";
	RETURN OLD;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "organizations_delete_community_first"
BEFORE DELETE ON "organizations"
FOR EACH ROW EXECUTE FUNCTION "delete_community_before_organization"();
