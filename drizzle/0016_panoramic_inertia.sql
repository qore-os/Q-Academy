ALTER TABLE "media_assets" DROP CONSTRAINT "media_assets_content_digest_state_check";--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_digest_state_check" CHECK ("media_assets"."storage_driver" = 'filesystem' or ("media_assets"."content_sha256" is null and "media_assets"."status" <> 'ready') or ("media_assets"."content_sha256" ~ '^[0-9a-f]{64}$' and "media_assets"."status" in ('ready', 'deleted')));--> statement-breakpoint
CREATE FUNCTION "prevent_media_storage_identity_update"()
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
		))
	THEN
		RAISE EXCEPTION 'media storage identities are immutable' USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "media_assets_prevent_storage_identity_update"
BEFORE UPDATE OF "organization_id", "storage_driver", "storage_key", "staging_storage_key", "staging_storage_version_id", "storage_version_id", "content_sha256", "etag", "actual_size_bytes", "detected_mime_type" ON "media_assets"
FOR EACH ROW
EXECUTE FUNCTION "prevent_media_storage_identity_update"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_submission_attachment_asset"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	asset "media_assets"%ROWTYPE;
	submission_owner_id uuid;
BEGIN
	SELECT * INTO asset
	FROM "media_assets"
	WHERE "id" = NEW."media_asset_id"
		AND "organization_id" = NEW."organization_id"
	FOR UPDATE;
	SELECT "user_id" INTO submission_owner_id
	FROM "submissions"
	WHERE "id" = NEW."submission_id"
		AND "organization_id" = NEW."organization_id";
	IF NOT FOUND
		OR asset."id" IS NULL
		OR asset."purpose" <> 'submission'
		OR asset."status" <> 'ready'
		OR asset."deleted_at" IS NOT NULL
		OR asset."owner_user_id" IS DISTINCT FROM submission_owner_id
	THEN
		RAISE EXCEPTION 'submission attachments require a ready same-tenant asset owned by the submitting user' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;
