CREATE OR REPLACE FUNCTION "public"."prevent_bound_community_media_update"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "public"."community_asset_bindings" AS "binding"
		WHERE "binding"."media_asset_id" = OLD."id"
			AND "binding"."organization_id" = OLD."organization_id"
	) THEN
		IF NEW."purpose" IS DISTINCT FROM OLD."purpose"
			OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
			OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
			OR NEW."status" IS DISTINCT FROM OLD."status"
			OR NEW."deleted_at" IS NOT NULL
		THEN
			RAISE EXCEPTION 'bound community media assets are immutable and cannot be deleted'
				USING ERRCODE = '55000';
		END IF;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_module_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_module_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_lesson_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_lesson_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_section_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_section_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_page_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_exam_page_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_link_module_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_link_module_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_link_content_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_link_content_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_course_module_outline_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_course_module_outline_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_published_course_link_edge_row"() SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_check_published_course_link_edge_row"() SET search_path TO pg_catalog, public;--> statement-breakpoint
REVOKE ALL ON FUNCTION
	"public"."prevent_bound_community_media_update"(),
	"public"."q_academy_check_exam_module_row"(),
	"public"."q_academy_check_exam_lesson_row"(),
	"public"."q_academy_check_exam_section_row"(),
	"public"."q_academy_check_exam_page_row"(),
	"public"."q_academy_check_link_module_row"(),
	"public"."q_academy_check_link_content_row"(),
	"public"."q_academy_check_course_module_outline_row"(),
	"public"."q_academy_check_published_course_link_edge_row"()
FROM PUBLIC;
