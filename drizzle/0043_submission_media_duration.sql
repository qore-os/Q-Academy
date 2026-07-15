ALTER TABLE "media_assets" ADD COLUMN "duration_milliseconds" integer;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_duration_state_check" CHECK ("media_assets"."duration_milliseconds" is null or ("media_assets"."duration_milliseconds" > 0 and "media_assets"."kind" in ('audio', 'video') and "media_assets"."status" in ('ready', 'deleted')));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "prevent_media_storage_identity_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."storage_driver" IS DISTINCT FROM OLD."storage_driver"
		OR NEW."storage_key" IS DISTINCT FROM OLD."storage_key"
		OR NEW."staging_storage_key" IS DISTINCT FROM OLD."staging_storage_key"
		OR (OLD."staging_storage_version_id" IS NOT NULL AND NEW."staging_storage_version_id" IS DISTINCT FROM OLD."staging_storage_version_id")
		OR (OLD."storage_version_id" IS NOT NULL AND NEW."storage_version_id" IS DISTINCT FROM OLD."storage_version_id")
		OR (OLD."content_sha256" IS NOT NULL AND NEW."content_sha256" IS DISTINCT FROM OLD."content_sha256")
		OR (OLD."status" = 'ready' AND (
			NEW."etag" IS DISTINCT FROM OLD."etag"
			OR NEW."actual_size_bytes" IS DISTINCT FROM OLD."actual_size_bytes"
			OR NEW."detected_mime_type" IS DISTINCT FROM OLD."detected_mime_type"
			OR NEW."duration_milliseconds" IS DISTINCT FROM OLD."duration_milliseconds"
		))
	THEN
		RAISE EXCEPTION 'media storage identities are immutable' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER "media_assets_prevent_storage_identity_update" ON "media_assets";--> statement-breakpoint
CREATE TRIGGER "media_assets_prevent_storage_identity_update"
BEFORE UPDATE OF "organization_id", "storage_driver", "storage_key", "staging_storage_key", "staging_storage_version_id", "storage_version_id", "content_sha256", "etag", "actual_size_bytes", "detected_mime_type", "duration_milliseconds" ON "media_assets"
FOR EACH ROW
EXECUTE FUNCTION "prevent_media_storage_identity_update"();
