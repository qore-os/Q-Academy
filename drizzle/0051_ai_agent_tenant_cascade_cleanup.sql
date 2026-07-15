CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_version"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW."state" <> 'draft' THEN
			RAISE EXCEPTION 'AI agent versions must be created as drafts before publication'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF TG_OP = 'DELETE' THEN
		IF OLD."state" = 'published' AND EXISTS (
			SELECT 1
			FROM "public"."organizations" AS organization
			WHERE organization."id" = OLD."organization_id"
		) THEN
			RAISE EXCEPTION 'Published AI agent versions are immutable'
				USING ERRCODE = '55000';
		END IF;
		RETURN OLD;
	END IF;

	IF OLD."state" = 'published' THEN
		RAISE EXCEPTION 'Published AI agent versions are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
		OR NEW."version" IS DISTINCT FROM OLD."version"
		OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
		OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
		RAISE EXCEPTION 'AI agent version identity fields are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF NEW."state" = 'draft' THEN
		IF NEW."draft_revision" <> OLD."draft_revision" + 1 THEN
			RAISE EXCEPTION 'Draft AI agent updates must increment draft_revision by exactly one'
				USING ERRCODE = '23514';
		END IF;
		RETURN NEW;
	END IF;

	IF NEW."state" <> 'published'
		OR NEW."draft_revision" <> OLD."draft_revision"
		OR NEW."type" IS DISTINCT FROM OLD."type"
		OR NEW."name" IS DISTINCT FROM OLD."name"
		OR NEW."description" IS DISTINCT FROM OLD."description"
		OR NEW."system_prompt" IS DISTINCT FROM OLD."system_prompt"
		OR NEW."color" IS DISTINCT FROM OLD."color"
		OR NEW."icon" IS DISTINCT FROM OLD."icon"
		OR NEW."knowledge_mode" IS DISTINCT FROM OLD."knowledge_mode"
		OR NEW."access_mode" IS DISTINCT FROM OLD."access_mode" THEN
		RAISE EXCEPTION 'Publishing may only seal the saved draft configuration'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."knowledge_mode" = 'selected_sources' AND NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_version_sources" AS source
		WHERE source."agent_version_id" = OLD."id"
			AND source."organization_id" = OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'Selected-source AI agent versions require at least one source'
			USING ERRCODE = '23514';
	END IF;

	IF NEW."access_mode" = 'restricted' AND NOT EXISTS (
		SELECT 1 FROM "public"."ai_agent_version_access_grants" AS grant_row
		WHERE grant_row."agent_version_id" = OLD."id"
			AND grant_row."organization_id" = OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'Restricted AI agent versions require at least one access grant'
			USING ERRCODE = '23514';
	END IF;

	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_ai_agent_version"() FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_version_child"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
	parent_state "public"."ai_agent_version_state";
	target_version_id uuid;
	target_organization_id uuid;
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
	) THEN
		RAISE EXCEPTION 'AI agent version child tenant and parent are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		target_version_id := OLD."agent_version_id";
		target_organization_id := OLD."organization_id";
		IF NOT EXISTS (
			SELECT 1
			FROM "public"."organizations" AS organization
			WHERE organization."id" = target_organization_id
		) THEN
			RETURN OLD;
		END IF;
	ELSE
		target_version_id := NEW."agent_version_id";
		target_organization_id := NEW."organization_id";
	END IF;

	SELECT version_row."state" INTO parent_state
	FROM "public"."ai_agent_versions" AS version_row
	WHERE version_row."id" = target_version_id
		AND version_row."organization_id" = target_organization_id
	FOR UPDATE;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'AI agent version child has no parent in its tenant'
			USING ERRCODE = '23503';
	END IF;

	IF parent_state = 'published' THEN
		RAISE EXCEPTION 'Published AI agent version sources and grants are immutable'
			USING ERRCODE = '55000';
	END IF;

	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_ai_agent_version_child"() FROM PUBLIC;
