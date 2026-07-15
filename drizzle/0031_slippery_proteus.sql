INSERT INTO "public"."lesson_pages" (
	"lesson_id",
	"title",
	"title_synced_with_lesson",
	"slug",
	"sort_order",
	"status"
)
SELECT
	"lesson"."id",
	"lesson"."title",
	true,
	"lesson"."slug",
	0,
	"lesson"."status"
FROM "public"."modules" AS "module"
INNER JOIN "public"."lessons" AS "lesson"
	ON "lesson"."module_id" = "module"."id"
	AND "lesson"."organization_id" = "module"."organization_id"
WHERE "module"."kind" = 'exam'
	AND NOT EXISTS (
		SELECT 1
		FROM "public"."lesson_pages" AS "page"
		WHERE "page"."lesson_id" = "lesson"."id"
	);--> statement-breakpoint
DO $$
DECLARE
	"exam_module" record;
BEGIN
	FOR "exam_module" IN
		SELECT "id"
		FROM "public"."modules"
		WHERE "kind" = 'exam'
	LOOP
		PERFORM "public"."q_academy_assert_exam_module_shape"("exam_module"."id");
	END LOOP;
END;
$$;--> statement-breakpoint
ALTER TYPE "public"."module_kind" ADD VALUE 'link';--> statement-breakpoint
CREATE TABLE "published_course_link_edges" (
	"organization_id" uuid NOT NULL,
	"source_course_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"link_module_id" uuid NOT NULL,
	"target_course_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "published_course_link_edges_source_course_id_link_module_id_pk" PRIMARY KEY("source_course_id","link_module_id"),
	CONSTRAINT "published_course_link_edges_no_self_check" CHECK ("published_course_link_edges"."source_course_id" <> "published_course_link_edges"."target_course_id")
);
--> statement-breakpoint
ALTER TABLE "course_modules" ADD COLUMN "indent_level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "linked_course_id" uuid;--> statement-breakpoint
ALTER TABLE "published_course_link_edges" ADD CONSTRAINT "published_course_link_edges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_course_link_edges" ADD CONSTRAINT "published_course_link_edges_source_tenant_fk" FOREIGN KEY ("source_course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_course_link_edges" ADD CONSTRAINT "published_course_link_edges_target_tenant_fk" FOREIGN KEY ("target_course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_course_link_edges" ADD CONSTRAINT "published_course_link_edges_version_tenant_fk" FOREIGN KEY ("source_version_id","source_course_id","organization_id") REFERENCES "public"."course_versions"("id","course_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "published_course_link_edges_org_target_idx" ON "published_course_link_edges" USING btree ("organization_id","target_course_id");--> statement-breakpoint
CREATE INDEX "published_course_link_edges_org_source_version_idx" ON "published_course_link_edges" USING btree ("organization_id","source_course_id","source_version_id");--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_linked_course_tenant_fk" FOREIGN KEY ("linked_course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "modules_org_linked_course_idx" ON "modules" USING btree ("organization_id","linked_course_id");--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_indent_level_check" CHECK ("course_modules"."indent_level" >= 0 and "course_modules"."indent_level" <= 3);--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_link_target_check" CHECK ((
        ("modules"."kind"::text = 'link' and "modules"."linked_course_id" is not null)
        or ("modules"."kind"::text <> 'link' and "modules"."linked_course_id" is null)
      ));--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_lock_course_link_graph"("target_organization_id" uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF "target_organization_id" IS NULL THEN
		RETURN;
	END IF;
	PERFORM pg_advisory_xact_lock(
		hashtextextended('course-link-graph:' || "target_organization_id"::text, 0)
	);
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_assert_link_module_shape"("target_module_id" uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	"target_kind" text;
	"target_organization_id" uuid;
	"target_course_id" uuid;
BEGIN
	IF "target_module_id" IS NULL THEN
		RETURN;
	END IF;

	SELECT "kind"::text, "organization_id", "linked_course_id"
	INTO "target_kind", "target_organization_id", "target_course_id"
	FROM "public"."modules"
	WHERE "id" = "target_module_id";
	IF NOT FOUND OR "target_kind" <> 'link' THEN
		RETURN;
	END IF;

	PERFORM "public"."q_academy_lock_course_link_graph"("target_organization_id");
	SELECT "kind"::text, "organization_id", "linked_course_id"
	INTO "target_kind", "target_organization_id", "target_course_id"
	FROM "public"."modules"
	WHERE "id" = "target_module_id"
	FOR UPDATE;
	IF NOT FOUND OR "target_kind" <> 'link' THEN
		RETURN;
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."module_sections"
		WHERE "module_id" = "target_module_id"
	) OR EXISTS (
		SELECT 1
		FROM "public"."lessons"
		WHERE "module_id" = "target_module_id"
	) THEN
		RAISE EXCEPTION 'link module % must not contain learning content', "target_module_id"
			USING ERRCODE = '23514';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."course_modules"
		WHERE "module_id" = "target_module_id"
			AND "is_required" = true
	) THEN
		RAISE EXCEPTION 'link module % must not be required', "target_module_id"
			USING ERRCODE = '23514';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "public"."course_modules"
		WHERE "module_id" = "target_module_id"
			AND "course_id" = "target_course_id"
	) THEN
		RAISE EXCEPTION 'link module % must not link a course to itself', "target_module_id"
			USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_assert_course_outline"(
	"target_organization_id" uuid,
	"target_course_id" uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF "target_organization_id" IS NULL OR "target_course_id" IS NULL THEN
		RETURN;
	END IF;
	PERFORM pg_advisory_xact_lock(
		hashtextextended('course-outline:' || "target_course_id"::text, 0)
	);
	IF EXISTS (
		WITH "ordered" AS (
			SELECT
				"indent_level",
				row_number() OVER (
					ORDER BY "sort_order", "module_id"
				) AS "position",
				lag("indent_level") OVER (
					ORDER BY "sort_order", "module_id"
				) AS "previous_indent_level"
			FROM "public"."course_modules"
			WHERE "organization_id" = "target_organization_id"
				AND "course_id" = "target_course_id"
		)
		SELECT 1
		FROM "ordered"
		WHERE ("position" = 1 AND "indent_level" <> 0)
			OR (
				"position" > 1
				AND "indent_level" > "previous_indent_level" + 1
			)
	) THEN
		RAISE EXCEPTION 'course % has an invalid module outline', "target_course_id"
			USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_assert_draft_course_link_graph"("target_organization_id" uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM "public"."q_academy_lock_course_link_graph"("target_organization_id");
	IF EXISTS (
		WITH RECURSIVE "edges" AS (
			SELECT DISTINCT
				"assignment"."course_id" AS "source_course_id",
				"module"."linked_course_id" AS "target_course_id"
			FROM "public"."course_modules" AS "assignment"
			INNER JOIN "public"."modules" AS "module"
				ON "module"."id" = "assignment"."module_id"
				AND "module"."organization_id" = "assignment"."organization_id"
			WHERE "assignment"."organization_id" = "target_organization_id"
				AND "module"."kind"::text = 'link'
				AND "module"."linked_course_id" IS NOT NULL
		),
		"reach"("source_course_id", "target_course_id") AS (
			SELECT "source_course_id", "target_course_id" FROM "edges"
			UNION
			SELECT "reach"."source_course_id", "edge"."target_course_id"
			FROM "reach"
			INNER JOIN "edges" AS "edge"
				ON "edge"."source_course_id" = "reach"."target_course_id"
		)
		SELECT 1
		FROM "reach"
		WHERE "source_course_id" = "target_course_id"
	) THEN
		RAISE EXCEPTION 'organization % has a cyclic draft course-link graph', "target_organization_id"
			USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_assert_published_course_link_graph"("target_organization_id" uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	PERFORM "public"."q_academy_lock_course_link_graph"("target_organization_id");
	IF EXISTS (
		WITH RECURSIVE "edges" AS (
			SELECT DISTINCT "source_course_id", "target_course_id"
			FROM "public"."published_course_link_edges"
			WHERE "organization_id" = "target_organization_id"
		),
		"reach"("source_course_id", "target_course_id") AS (
			SELECT "source_course_id", "target_course_id" FROM "edges"
			UNION
			SELECT "reach"."source_course_id", "edge"."target_course_id"
			FROM "reach"
			INNER JOIN "edges" AS "edge"
				ON "edge"."source_course_id" = "reach"."target_course_id"
		)
		SELECT 1
		FROM "reach"
		WHERE "source_course_id" = "target_course_id"
	) THEN
		RAISE EXCEPTION 'organization % has a cyclic published course-link graph', "target_organization_id"
			USING ERRCODE = '23514';
	END IF;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_link_module_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' AND OLD."kind"::text = 'link' THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(OLD."id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(OLD."organization_id");
	END IF;
	IF TG_OP <> 'DELETE' AND NEW."kind"::text = 'link' THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(NEW."id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(NEW."organization_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_link_content_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(OLD."module_id");
	END IF;
	IF TG_OP <> 'DELETE' AND (
		TG_OP = 'INSERT' OR NEW."module_id" IS DISTINCT FROM OLD."module_id"
	) THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(NEW."module_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_course_module_outline_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(OLD."module_id");
		PERFORM "public"."q_academy_assert_course_outline"(OLD."organization_id", OLD."course_id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(OLD."organization_id");
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM "public"."q_academy_assert_link_module_shape"(NEW."module_id");
		PERFORM "public"."q_academy_assert_course_outline"(NEW."organization_id", NEW."course_id");
		PERFORM "public"."q_academy_assert_draft_course_link_graph"(NEW."organization_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE FUNCTION "public"."q_academy_check_published_course_link_edge_row"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		PERFORM "public"."q_academy_assert_published_course_link_graph"(OLD."organization_id");
	END IF;
	IF TG_OP <> 'DELETE' THEN
		PERFORM "public"."q_academy_assert_published_course_link_graph"(NEW."organization_id");
	END IF;
	RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "modules_link_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."modules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_link_module_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "lessons_link_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."lessons"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_link_content_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "module_sections_link_shape_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."module_sections"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_link_content_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "course_modules_outline_link_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."course_modules"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_course_module_outline_row"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "published_course_link_edges_graph_check"
AFTER INSERT OR UPDATE OR DELETE ON "public"."published_course_link_edges"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "public"."q_academy_check_published_course_link_edge_row"();
