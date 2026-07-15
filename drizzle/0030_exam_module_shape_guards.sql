CREATE FUNCTION "public"."q_academy_assert_exam_module_shape"("target_module_id" uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	"target_kind" "public"."module_kind";
	"lesson_count" integer;
	"valid_exam_lesson_count" integer;
	"page_count" integer;
BEGIN
	IF "target_module_id" IS NULL THEN
		RETURN;
	END IF;

	PERFORM pg_advisory_xact_lock(
		hashtextextended('exam-module:' || "target_module_id"::text, 0)
	);
	SELECT "kind"
	INTO "target_kind"
	FROM "public"."modules"
	WHERE "id" = "target_module_id"
	FOR UPDATE;

	IF NOT FOUND OR "target_kind" <> 'exam' THEN
		RETURN;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."module_sections"
		WHERE "module_id" = "target_module_id"
	) THEN
		RAISE EXCEPTION 'exam module % must not contain sections', "target_module_id"
			USING ERRCODE = '23514';
	END IF;

	SELECT
		count(*)::integer,
		count(*) FILTER (
			WHERE "type" = 'exam' AND "section_id" IS NULL
		)::integer
	INTO "lesson_count", "valid_exam_lesson_count"
	FROM "public"."lessons"
	WHERE "module_id" = "target_module_id";

	IF "lesson_count" <> 1 OR "valid_exam_lesson_count" <> 1 THEN
		RAISE EXCEPTION 'exam module % must contain exactly one unsectioned exam lesson', "target_module_id"
			USING ERRCODE = '23514';
	END IF;

	SELECT count(*)::integer
	INTO "page_count"
	FROM "public"."lesson_pages" AS "page"
	INNER JOIN "public"."lessons" AS "lesson"
		ON "lesson"."id" = "page"."lesson_id"
	WHERE "lesson"."module_id" = "target_module_id";

	IF "page_count" < 1 THEN
		RAISE EXCEPTION 'exam module % must contain at least one page', "target_module_id"
			USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_exam_module_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM "public"."q_academy_assert_exam_module_shape"(
		CASE WHEN TG_OP = 'DELETE' THEN OLD."id" ELSE NEW."id" END
	);
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_exam_lesson_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_assert_exam_module_shape"(OLD."module_id");
	END IF;
	IF TG_OP <> 'DELETE' AND (
		TG_OP = 'INSERT' OR NEW."module_id" IS DISTINCT FROM OLD."module_id"
	) THEN
		PERFORM "public"."q_academy_assert_exam_module_shape"(NEW."module_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_exam_section_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_assert_exam_module_shape"(OLD."module_id");
	END IF;
	IF TG_OP <> 'DELETE' AND (
		TG_OP = 'INSERT' OR NEW."module_id" IS DISTINCT FROM OLD."module_id"
	) THEN
		PERFORM "public"."q_academy_assert_exam_module_shape"(NEW."module_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_exam_page_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	"old_module_id" uuid;
	"new_module_id" uuid;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		SELECT "module_id"
		INTO "old_module_id"
		FROM "public"."lessons"
		WHERE "id" = OLD."lesson_id";
		PERFORM "public"."q_academy_assert_exam_module_shape"("old_module_id");
	END IF;
	IF TG_OP <> 'DELETE' AND (
		TG_OP = 'INSERT' OR NEW."lesson_id" IS DISTINCT FROM OLD."lesson_id"
	) THEN
		SELECT "module_id"
		INTO "new_module_id"
		FROM "public"."lessons"
		WHERE "id" = NEW."lesson_id";
		PERFORM "public"."q_academy_assert_exam_module_shape"("new_module_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "modules_exam_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."modules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_exam_module_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "lessons_exam_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."lessons"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_exam_lesson_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "module_sections_exam_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."module_sections"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_exam_section_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "lesson_pages_exam_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."lesson_pages"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_exam_page_row"();
