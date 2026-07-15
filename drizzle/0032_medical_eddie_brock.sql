CREATE INDEX "course_modules_org_course_outline_idx" ON "course_modules" USING btree ("organization_id","course_id","sort_order","module_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."q_academy_check_course_module_outline_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_lock_course_link_graph"(OLD."organization_id");
		PERFORM "public"."q_academy_assert_link_module_shape"(OLD."module_id");
		PERFORM "public"."q_academy_assert_course_outline"(OLD."organization_id", OLD."course_id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(OLD."organization_id");
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM "public"."q_academy_lock_course_link_graph"(NEW."organization_id");
		PERFORM "public"."q_academy_assert_link_module_shape"(NEW."module_id");
		PERFORM "public"."q_academy_assert_course_outline"(NEW."organization_id", NEW."course_id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(NEW."organization_id");
	END IF;
	RETURN NULL;
END;
$$;
