DO $$
DECLARE
	"interleaved_section" record;
BEGIN
	WITH "visible_lessons" AS (
		SELECT
			"lesson"."module_id",
			"lesson"."section_id",
			row_number() OVER (
				PARTITION BY "lesson"."module_id"
				ORDER BY "lesson"."sort_order", "lesson"."id"
			) AS "visible_order"
		FROM "lessons" AS "lesson"
		LEFT JOIN "module_sections" AS "section"
			ON "section"."id" = "lesson"."section_id"
		WHERE "lesson"."status" = 'published'
			AND "lesson"."visibility" <> 'draft'
			AND (
				"lesson"."section_id" IS NULL
				OR (
					"section"."status" = 'published'
					AND "section"."visibility" <> 'draft'
				)
			)
	),
	"interleaved_sections" AS (
		SELECT
			"section"."module_id",
			"section"."id" AS "section_id"
		FROM "module_sections" AS "section"
		INNER JOIN "visible_lessons" AS "lesson"
			ON "lesson"."section_id" = "section"."id"
		WHERE "section"."status" = 'published'
			AND "section"."visibility" <> 'draft'
			AND "section"."unlock_after_previous" = true
		GROUP BY "section"."module_id", "section"."id"
		HAVING count(*) > 1
			AND max("lesson"."visible_order") - min("lesson"."visible_order") + 1 <> count(*)
	)
	SELECT "module_id", "section_id"
	INTO "interleaved_section"
	FROM "interleaved_sections"
	ORDER BY "module_id", "section_id"
	LIMIT 1;

	IF FOUND THEN
		RAISE EXCEPTION 'cannot flatten course sections losslessly: section % in module % has interleaved published lessons',
			"interleaved_section"."section_id", "interleaved_section"."module_id";
	END IF;
END $$;--> statement-breakpoint
CREATE TEMPORARY TABLE "q_academy_section_flatten_snapshot_backup"
ON COMMIT DROP
AS
SELECT "id", "snapshot"
FROM "course_versions";--> statement-breakpoint
CREATE TEMPORARY TABLE "q_academy_section_flatten_lesson_backup"
ON COMMIT DROP
AS
SELECT
	"lesson"."id",
	"lesson"."module_id",
	"lesson"."section_id",
	"lesson"."sort_order",
	"lesson"."status",
	"lesson"."visibility",
	"section"."sort_order" AS "section_sort_order",
	"section"."status" AS "section_status",
	"section"."visibility" AS "section_visibility",
	"section"."unlock_after_previous" AS "section_unlock_after_previous",
	"section"."drip_days" AS "section_drip_days"
FROM "lessons" AS "lesson"
LEFT JOIN "module_sections" AS "section"
	ON "section"."id" = "lesson"."section_id";--> statement-breakpoint
DO $$
DECLARE
	"version_row" record;
	"module_entry" record;
	"section_entry" record;
	"lesson_entry" record;
	"module_id" text;
	"section_id" text;
	"lesson_id" text;
	"schema_version" integer;
	"has_access_policy" boolean;
	"has_module_kind" boolean;
	"has_strict_outline" boolean;
	"previous_indent_level" integer;
	"seen_module_ids" text[];
	"seen_section_ids" text[];
	"seen_lesson_ids" text[];
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "module_sections"
		WHERE "drip_days" < 0 OR "drip_days" > 36500
	) THEN
		RAISE EXCEPTION 'module section drip days are outside the supported range';
	END IF;

	FOR "version_row" IN
		SELECT "id", "course_id", "organization_id", "snapshot", "published_at"
		FROM "course_versions"
		ORDER BY "id"
	LOOP
		IF jsonb_typeof("version_row"."snapshot") IS DISTINCT FROM 'object' THEN
			RAISE EXCEPTION 'course version % snapshot must be an object', "version_row"."id";
		END IF;
		IF jsonb_typeof("version_row"."snapshot" -> 'schemaVersion') IS DISTINCT FROM 'number'
			OR ("version_row"."snapshot" ->> 'schemaVersion') !~ '^[2-5]$'
		THEN
			RAISE EXCEPTION 'course version % has an unsupported snapshot schema version: %', "version_row"."id", "version_row"."snapshot" -> 'schemaVersion';
		END IF;
		"schema_version" := ("version_row"."snapshot" ->> 'schemaVersion')::integer;
		"has_access_policy" := "version_row"."snapshot" ->> 'accessPolicyVersion' = '1';
		"has_module_kind" := "version_row"."snapshot" ->> 'moduleKindVersion' = '1';
		"has_strict_outline" := "schema_version" >= 4;

		IF jsonb_typeof("version_row"."snapshot" -> 'capturedAt') IS DISTINCT FROM 'string' THEN
			RAISE EXCEPTION 'course version % snapshot has an invalid capture time', "version_row"."id";
		END IF;
		IF "version_row"."snapshot" ? 'accessPolicyVersion'
			AND (
				jsonb_typeof("version_row"."snapshot" -> 'accessPolicyVersion') IS DISTINCT FROM 'number'
				OR "version_row"."snapshot" ->> 'accessPolicyVersion' <> '1'
			)
		THEN
			RAISE EXCEPTION 'course version % has an unsupported access policy version', "version_row"."id";
		END IF;
		IF "version_row"."snapshot" ? 'moduleKindVersion'
			AND (
				jsonb_typeof("version_row"."snapshot" -> 'moduleKindVersion') IS DISTINCT FROM 'number'
				OR "version_row"."snapshot" ->> 'moduleKindVersion' <> '1'
			)
		THEN
			RAISE EXCEPTION 'course version % has an unsupported module kind version', "version_row"."id";
		END IF;
		IF "version_row"."snapshot" ? 'courseOutlineVersion'
			AND (
				jsonb_typeof("version_row"."snapshot" -> 'courseOutlineVersion') IS DISTINCT FROM 'number'
				OR "version_row"."snapshot" ->> 'courseOutlineVersion' <> '1'
			)
		THEN
			RAISE EXCEPTION 'course version % has an unsupported course outline version', "version_row"."id";
		END IF;
		IF "has_strict_outline"
			AND "version_row"."snapshot" ->> 'accessPolicyVersion' IS DISTINCT FROM '1'
		THEN
			RAISE EXCEPTION 'course version % is missing its required access policy version', "version_row"."id";
		END IF;
		IF "has_strict_outline"
			AND (
				"version_row"."snapshot" ->> 'moduleKindVersion' IS DISTINCT FROM '1'
				OR "version_row"."snapshot" ->> 'courseOutlineVersion' IS DISTINCT FROM '1'
			)
		THEN
			RAISE EXCEPTION 'course version % is missing its required outline versions', "version_row"."id";
		END IF;
		IF "schema_version" = 5
			AND jsonb_typeof("version_row"."snapshot" -> 'widgets') IS DISTINCT FROM 'array'
		THEN
			RAISE EXCEPTION 'course version % snapshot widgets must be an array', "version_row"."id";
		END IF;
		IF jsonb_typeof("version_row"."snapshot" -> 'course') IS DISTINCT FROM 'object'
			OR "version_row"."snapshot" #>> '{course,id}' IS DISTINCT FROM "version_row"."course_id"::text
			OR "version_row"."snapshot" #>> '{course,organizationId}' IS DISTINCT FROM "version_row"."organization_id"::text
		THEN
			RAISE EXCEPTION 'course version % snapshot has an invalid course owner', "version_row"."id";
		END IF;
		IF jsonb_typeof("version_row"."snapshot" -> 'modules') IS DISTINCT FROM 'array' THEN
			RAISE EXCEPTION 'course version % snapshot modules must be an array', "version_row"."id";
		END IF;
		IF "has_access_policy"
			AND jsonb_typeof("version_row"."snapshot" #> '{course,firstPublishedAt}') IS DISTINCT FROM 'string'
			AND NOT (
				"version_row"."published_at" IS NULL
				AND jsonb_typeof("version_row"."snapshot" #> '{course,firstPublishedAt}') IS NOT DISTINCT FROM 'null'
			)
		THEN
			RAISE EXCEPTION 'course version % snapshot has an invalid first publication time', "version_row"."id";
		END IF;

		"seen_module_ids" := ARRAY[]::text[];
		"seen_section_ids" := ARRAY[]::text[];
		"seen_lesson_ids" := ARRAY[]::text[];
		"previous_indent_level" := 0;
		FOR "module_entry" IN
			SELECT "value" AS "item"
			FROM jsonb_array_elements("version_row"."snapshot" -> 'modules')
		LOOP
			IF jsonb_typeof("module_entry"."item") IS DISTINCT FROM 'object'
				OR jsonb_typeof("module_entry"."item" -> 'id') IS DISTINCT FROM 'string'
			THEN
				RAISE EXCEPTION 'course version % contains an invalid module', "version_row"."id";
			END IF;
			"module_id" := "module_entry"."item" ->> 'id';
			IF "module_id" = '' OR "module_id" = ANY("seen_module_ids") THEN
				RAISE EXCEPTION 'course version % contains a missing or duplicate module id', "version_row"."id";
			END IF;
			"seen_module_ids" := array_append("seen_module_ids", "module_id");
			IF jsonb_typeof("module_entry"."item" -> 'lessons') IS DISTINCT FROM 'array'
				OR jsonb_typeof("module_entry"."item" -> 'sections') IS DISTINCT FROM 'array'
				OR jsonb_typeof("module_entry"."item" -> 'sortOrder') IS DISTINCT FROM 'number'
				OR ("module_entry"."item" ->> 'sortOrder') !~ '^-?[0-9]+$'
				OR jsonb_typeof("module_entry"."item" -> 'dripDays') IS DISTINCT FROM 'number'
				OR ("module_entry"."item" ->> 'dripDays') !~ '^-?[0-9]+$'
				OR jsonb_typeof("module_entry"."item" -> 'isRequired') IS DISTINCT FROM 'boolean'
			THEN
				RAISE EXCEPTION 'course version % module % has invalid lesson collections', "version_row"."id", "module_id";
			END IF;
			IF "has_module_kind"
				AND (
					jsonb_typeof("module_entry"."item" -> 'kind') IS DISTINCT FROM 'string'
					OR "module_entry"."item" ->> 'kind' NOT IN ('learning', 'exam')
						AND NOT (
							"has_strict_outline"
							AND "module_entry"."item" ->> 'kind' = 'link'
						)
				)
			THEN
				RAISE EXCEPTION 'course version % module % has an invalid kind', "version_row"."id", "module_id";
			END IF;
			IF "has_strict_outline" THEN
				IF jsonb_typeof("module_entry"."item" -> 'indentLevel') IS DISTINCT FROM 'number'
					OR ("module_entry"."item" ->> 'indentLevel') !~ '^[0-3]$'
					OR (
						cardinality("seen_module_ids") = 1
						AND ("module_entry"."item" ->> 'indentLevel')::integer <> 0
					)
					OR (
						cardinality("seen_module_ids") > 1
						AND ("module_entry"."item" ->> 'indentLevel')::integer > "previous_indent_level" + 1
					)
				THEN
					RAISE EXCEPTION 'course version % module % has an invalid outline level', "version_row"."id", "module_id";
				END IF;
				"previous_indent_level" := ("module_entry"."item" ->> 'indentLevel')::integer;
				IF "module_entry"."item" ->> 'kind' = 'link'
					AND (
						jsonb_typeof("module_entry"."item" -> 'linkedCourseId') IS DISTINCT FROM 'string'
						OR "module_entry"."item" ->> 'linkedCourseId' = "version_row"."course_id"::text
						OR jsonb_typeof("module_entry"."item" -> 'targetVersionIdAtCapture') IS DISTINCT FROM 'string'
						OR jsonb_array_length("module_entry"."item" -> 'lessons') <> 0
						OR jsonb_array_length("module_entry"."item" -> 'sections') <> 0
						OR ("module_entry"."item" ->> 'isRequired')::boolean
					)
				THEN
					RAISE EXCEPTION 'course version % module % has an invalid link target', "version_row"."id", "module_id";
				END IF;
				IF "module_entry"."item" ->> 'kind' <> 'link'
					AND (
						jsonb_typeof("module_entry"."item" -> 'linkedCourseId') NOT IN ('null')
						OR jsonb_typeof("module_entry"."item" -> 'targetVersionIdAtCapture') NOT IN ('null')
					)
				THEN
					RAISE EXCEPTION 'course version % module % has an unexpected link target', "version_row"."id", "module_id";
				END IF;
			END IF;
			IF "has_access_policy" AND (
				"module_entry"."item" ->> 'organizationId' IS DISTINCT FROM "version_row"."organization_id"::text
				OR jsonb_typeof("module_entry"."item" -> 'accessMode') IS DISTINCT FROM 'string'
				OR "module_entry"."item" ->> 'accessMode' NOT IN ('visible', 'after_previous', 'delay_days', 'date_window', 'coming_soon', 'locked', 'hidden')
				OR jsonb_typeof("module_entry"."item" -> 'delayPendingState') IS DISTINCT FROM 'string'
				OR "module_entry"."item" ->> 'delayPendingState' NOT IN ('locked', 'hidden')
				OR jsonb_typeof("module_entry"."item" -> 'windowDefaultState') IS DISTINCT FROM 'string'
				OR "module_entry"."item" ->> 'windowDefaultState' NOT IN ('available', 'read_only', 'locked', 'hidden')
				OR jsonb_typeof("module_entry"."item" -> 'windowState') IS DISTINCT FROM 'string'
				OR "module_entry"."item" ->> 'windowState' NOT IN ('available', 'read_only', 'locked', 'hidden')
				OR jsonb_typeof("module_entry"."item" -> 'requestAccessEnabled') IS DISTINCT FROM 'boolean'
				OR ("module_entry"."item" ->> 'dripDays')::numeric < 0
				OR ("module_entry"."item" ->> 'dripDays')::numeric > 36500
				OR jsonb_typeof("module_entry"."item" -> 'availableFrom') NOT IN ('null', 'string')
				OR jsonb_typeof("module_entry"."item" -> 'availableUntil') NOT IN ('null', 'string')
				OR (
					"module_entry"."item" ->> 'accessMode' = 'date_window'
					AND "module_entry"."item" -> 'availableFrom' = 'null'::jsonb
					AND "module_entry"."item" -> 'availableUntil' = 'null'::jsonb
				)
				OR (
					"module_entry"."item" ->> 'accessMode' <> 'date_window'
					AND (
						"module_entry"."item" -> 'availableFrom' <> 'null'::jsonb
						OR "module_entry"."item" -> 'availableUntil' <> 'null'::jsonb
					)
				)
				OR (
					"module_entry"."item" ->> 'accessMode' <> 'delay_days'
					AND ("module_entry"."item" ->> 'dripDays')::integer <> 0
				)
			) THEN
				RAISE EXCEPTION 'course version % module % has an invalid access policy', "version_row"."id", "module_id";
			END IF;

			FOR "lesson_entry" IN
				SELECT "value" AS "item"
				FROM jsonb_array_elements("module_entry"."item" -> 'lessons')
			LOOP
				IF jsonb_typeof("lesson_entry"."item") IS DISTINCT FROM 'object'
					OR jsonb_typeof("lesson_entry"."item" -> 'id') IS DISTINCT FROM 'string'
					OR jsonb_typeof("lesson_entry"."item" -> 'moduleId') IS DISTINCT FROM 'string'
					OR "lesson_entry"."item" ->> 'moduleId' IS DISTINCT FROM "module_id"
					OR jsonb_typeof("lesson_entry"."item" -> 'sectionId') IS DISTINCT FROM 'null'
					OR jsonb_typeof("lesson_entry"."item" -> 'sortOrder') IS DISTINCT FROM 'number'
					OR ("lesson_entry"."item" ->> 'sortOrder') !~ '^-?[0-9]+$'
					OR jsonb_typeof("lesson_entry"."item" -> 'status') IS DISTINCT FROM 'string'
					OR "lesson_entry"."item" ->> 'status' NOT IN ('published', 'draft', 'archived')
					OR jsonb_typeof("lesson_entry"."item" -> 'blocks') IS DISTINCT FROM 'array'
					OR jsonb_typeof("lesson_entry"."item" -> 'pages') IS DISTINCT FROM 'array'
					OR (
						"lesson_entry"."item" ? 'visibility'
						AND (
							jsonb_typeof("lesson_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
							OR "lesson_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
						)
					)
					OR (
						"lesson_entry"."item" ? 'dripDays'
						AND (
							jsonb_typeof("lesson_entry"."item" -> 'dripDays') IS DISTINCT FROM 'number'
							OR ("lesson_entry"."item" ->> 'dripDays') !~ '^[0-9]+$'
							OR ("lesson_entry"."item" ->> 'dripDays')::numeric > 36500
						)
					)
					OR (
						"lesson_entry"."item" ? 'unlockAfterPrevious'
						AND jsonb_typeof("lesson_entry"."item" -> 'unlockAfterPrevious') IS DISTINCT FROM 'boolean'
					)
				THEN
					RAISE EXCEPTION 'course version % module % contains an invalid direct lesson', "version_row"."id", "module_id";
				END IF;
				IF EXISTS (
					SELECT 1
					FROM jsonb_array_elements("lesson_entry"."item" -> 'pages') AS "page"("item")
					WHERE jsonb_typeof("page"."item") IS DISTINCT FROM 'object'
						OR jsonb_typeof("page"."item" -> 'blocks') IS DISTINCT FROM 'array'
				) THEN
					RAISE EXCEPTION 'course version % lesson % contains an invalid page', "version_row"."id", "lesson_entry"."item" ->> 'id';
				END IF;
				IF "has_access_policy" AND (
					"lesson_entry"."item" ->> 'organizationId' IS DISTINCT FROM "version_row"."organization_id"::text
					OR jsonb_typeof("lesson_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
					OR "lesson_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
					OR (
						jsonb_typeof("lesson_entry"."item" -> 'availableAt') IS DISTINCT FROM 'null'
						AND jsonb_typeof("lesson_entry"."item" -> 'availableAt') IS DISTINCT FROM 'string'
					)
				) THEN
					RAISE EXCEPTION 'course version % lesson % has an invalid access policy', "version_row"."id", "lesson_entry"."item" ->> 'id';
				END IF;
				"lesson_id" := "lesson_entry"."item" ->> 'id';
				IF "lesson_id" = '' OR "lesson_id" = ANY("seen_lesson_ids") THEN
					RAISE EXCEPTION 'course version % contains a missing or duplicate lesson id', "version_row"."id";
				END IF;
				"seen_lesson_ids" := array_append("seen_lesson_ids", "lesson_id");
			END LOOP;

			FOR "section_entry" IN
				SELECT "value" AS "item"
				FROM jsonb_array_elements("module_entry"."item" -> 'sections')
			LOOP
				IF jsonb_typeof("section_entry"."item") IS DISTINCT FROM 'object'
					OR jsonb_typeof("section_entry"."item" -> 'id') IS DISTINCT FROM 'string'
					OR jsonb_typeof("section_entry"."item" -> 'moduleId') IS DISTINCT FROM 'string'
					OR "section_entry"."item" ->> 'moduleId' IS DISTINCT FROM "module_id"
					OR jsonb_typeof("section_entry"."item" -> 'lessons') IS DISTINCT FROM 'array'
					OR jsonb_typeof("section_entry"."item" -> 'sortOrder') IS DISTINCT FROM 'number'
					OR ("section_entry"."item" ->> 'sortOrder') !~ '^-?[0-9]+$'
					OR jsonb_typeof("section_entry"."item" -> 'status') IS DISTINCT FROM 'string'
					OR "section_entry"."item" ->> 'status' NOT IN ('published', 'draft', 'archived')
					OR (
						"section_entry"."item" ? 'visibility'
						AND (
							jsonb_typeof("section_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
							OR "section_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
						)
					)
					OR (
						"section_entry"."item" ? 'dripDays'
						AND (
							jsonb_typeof("section_entry"."item" -> 'dripDays') IS DISTINCT FROM 'number'
							OR ("section_entry"."item" ->> 'dripDays') !~ '^[0-9]+$'
							OR ("section_entry"."item" ->> 'dripDays')::numeric > 36500
						)
					)
					OR (
						"section_entry"."item" ? 'unlockAfterPrevious'
						AND jsonb_typeof("section_entry"."item" -> 'unlockAfterPrevious') IS DISTINCT FROM 'boolean'
					)
				THEN
					RAISE EXCEPTION 'course version % module % contains an invalid section', "version_row"."id", "module_id";
				END IF;
				IF "has_access_policy" AND (
					"section_entry"."item" ->> 'organizationId' IS DISTINCT FROM "version_row"."organization_id"::text
					OR jsonb_typeof("section_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
					OR "section_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
				) THEN
					RAISE EXCEPTION 'course version % section % has an invalid access policy', "version_row"."id", "section_entry"."item" ->> 'id';
				END IF;
				"section_id" := "section_entry"."item" ->> 'id';
				IF "section_id" = '' OR "section_id" = ANY("seen_section_ids") THEN
					RAISE EXCEPTION 'course version % contains a missing or duplicate section id', "version_row"."id";
				END IF;
				"seen_section_ids" := array_append("seen_section_ids", "section_id");

				FOR "lesson_entry" IN
					SELECT "value" AS "item"
					FROM jsonb_array_elements("section_entry"."item" -> 'lessons')
				LOOP
					IF jsonb_typeof("lesson_entry"."item") IS DISTINCT FROM 'object'
						OR jsonb_typeof("lesson_entry"."item" -> 'id') IS DISTINCT FROM 'string'
						OR jsonb_typeof("lesson_entry"."item" -> 'moduleId') IS DISTINCT FROM 'string'
						OR "lesson_entry"."item" ->> 'moduleId' IS DISTINCT FROM "module_id"
						OR jsonb_typeof("lesson_entry"."item" -> 'sectionId') IS DISTINCT FROM 'string'
						OR "lesson_entry"."item" ->> 'sectionId' IS DISTINCT FROM "section_id"
						OR jsonb_typeof("lesson_entry"."item" -> 'sortOrder') IS DISTINCT FROM 'number'
						OR ("lesson_entry"."item" ->> 'sortOrder') !~ '^-?[0-9]+$'
						OR jsonb_typeof("lesson_entry"."item" -> 'status') IS DISTINCT FROM 'string'
						OR "lesson_entry"."item" ->> 'status' NOT IN ('published', 'draft', 'archived')
						OR jsonb_typeof("lesson_entry"."item" -> 'blocks') IS DISTINCT FROM 'array'
						OR jsonb_typeof("lesson_entry"."item" -> 'pages') IS DISTINCT FROM 'array'
						OR (
							"lesson_entry"."item" ? 'visibility'
							AND (
								jsonb_typeof("lesson_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
								OR "lesson_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
							)
						)
						OR (
							"lesson_entry"."item" ? 'dripDays'
							AND (
								jsonb_typeof("lesson_entry"."item" -> 'dripDays') IS DISTINCT FROM 'number'
								OR ("lesson_entry"."item" ->> 'dripDays') !~ '^[0-9]+$'
								OR ("lesson_entry"."item" ->> 'dripDays')::numeric > 36500
							)
						)
						OR (
							"lesson_entry"."item" ? 'unlockAfterPrevious'
							AND jsonb_typeof("lesson_entry"."item" -> 'unlockAfterPrevious') IS DISTINCT FROM 'boolean'
						)
					THEN
						RAISE EXCEPTION 'course version % section % contains an invalid lesson', "version_row"."id", "section_id";
					END IF;
					IF EXISTS (
						SELECT 1
						FROM jsonb_array_elements("lesson_entry"."item" -> 'pages') AS "page"("item")
						WHERE jsonb_typeof("page"."item") IS DISTINCT FROM 'object'
							OR jsonb_typeof("page"."item" -> 'blocks') IS DISTINCT FROM 'array'
					) THEN
						RAISE EXCEPTION 'course version % lesson % contains an invalid page', "version_row"."id", "lesson_entry"."item" ->> 'id';
					END IF;
					IF "has_access_policy" AND (
						"lesson_entry"."item" ->> 'organizationId' IS DISTINCT FROM "version_row"."organization_id"::text
						OR jsonb_typeof("lesson_entry"."item" -> 'visibility') IS DISTINCT FROM 'string'
						OR "lesson_entry"."item" ->> 'visibility' NOT IN ('visible', 'draft', 'coming_soon')
						OR (
							jsonb_typeof("lesson_entry"."item" -> 'availableAt') IS DISTINCT FROM 'null'
							AND jsonb_typeof("lesson_entry"."item" -> 'availableAt') IS DISTINCT FROM 'string'
						)
					) THEN
						RAISE EXCEPTION 'course version % lesson % has an invalid access policy', "version_row"."id", "lesson_entry"."item" ->> 'id';
					END IF;
					"lesson_id" := "lesson_entry"."item" ->> 'id';
					IF "lesson_id" = '' OR "lesson_id" = ANY("seen_lesson_ids") THEN
						RAISE EXCEPTION 'course version % contains a missing or duplicate lesson id', "version_row"."id";
					END IF;
					"seen_lesson_ids" := array_append("seen_lesson_ids", "lesson_id");
				END LOOP;
			END LOOP;

			IF EXISTS (
				WITH "raw_visible_lessons" AS (
					SELECT
						"direct_lesson"."item" ->> 'id' AS "lesson_id",
						NULL::text AS "section_id",
						("direct_lesson"."item" ->> 'sortOrder')::numeric AS "lesson_sort_order",
						false AS "section_unlock_after_previous"
					FROM jsonb_array_elements("module_entry"."item" -> 'lessons') AS "direct_lesson"("item")
					WHERE "direct_lesson"."item" ->> 'status' = 'published'
						AND (
							CASE
								WHEN "has_access_policy" THEN "direct_lesson"."item" ->> 'visibility'
								ELSE 'visible'
							END
						) <> 'draft'

					UNION ALL

					SELECT
						"section_lesson"."item" ->> 'id' AS "lesson_id",
						"snapshot_section"."item" ->> 'id' AS "section_id",
						("section_lesson"."item" ->> 'sortOrder')::numeric AS "lesson_sort_order",
						coalesce(("snapshot_section"."item" ->> 'unlockAfterPrevious')::boolean, false)
							AS "section_unlock_after_previous"
					FROM jsonb_array_elements("module_entry"."item" -> 'sections') AS "snapshot_section"("item")
					CROSS JOIN LATERAL jsonb_array_elements("snapshot_section"."item" -> 'lessons') AS "section_lesson"("item")
					WHERE "snapshot_section"."item" ->> 'status' = 'published'
						AND (
							CASE
								WHEN "has_access_policy" THEN "snapshot_section"."item" ->> 'visibility'
								ELSE 'visible'
							END
						) <> 'draft'
						AND "section_lesson"."item" ->> 'status' = 'published'
						AND (
							CASE
								WHEN "has_access_policy" THEN "section_lesson"."item" ->> 'visibility'
								ELSE 'visible'
							END
						) <> 'draft'
				),
				"visible_lessons" AS (
					SELECT
						"raw_lesson".*,
						row_number() OVER (
							ORDER BY "raw_lesson"."lesson_sort_order", "raw_lesson"."lesson_id"
						) AS "visible_order"
					FROM "raw_visible_lessons" AS "raw_lesson"
				)
				SELECT 1
				FROM "visible_lessons" AS "lesson"
				WHERE "lesson"."section_unlock_after_previous" = true
				GROUP BY "lesson"."section_id"
				HAVING count(*) > 1
					AND max("lesson"."visible_order") - min("lesson"."visible_order") + 1 <> count(*)
			) THEN
				RAISE EXCEPTION 'cannot flatten course version % module % losslessly: an unlock-after-previous section has interleaved published lessons',
					"version_row"."id", "module_id";
			END IF;
		END LOOP;
	END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "unlock_after_previous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "drip_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "section_lessons" AS (
	SELECT
		"lesson"."id",
		"section"."status" AS "section_status",
		"section"."visibility" AS "section_visibility",
		"section"."drip_days" AS "section_drip_days",
		"section"."unlock_after_previous",
		count(*) FILTER (
			WHERE "section"."status" = 'published'
				AND "section"."visibility" <> 'draft'
				AND "lesson"."status" = 'published'
				AND "lesson"."visibility" <> 'draft'
		) OVER (
			PARTITION BY "section"."id"
			ORDER BY "lesson"."sort_order", "lesson"."id"
			ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
		) AS "published_section_lesson_order"
	FROM "lessons" AS "lesson"
	INNER JOIN "module_sections" AS "section"
		ON "section"."id" = "lesson"."section_id"
)
UPDATE "lessons" AS "lesson"
SET
	"status" = CASE
		WHEN "lesson"."status" = 'archived' OR "section_lesson"."section_status" = 'archived' THEN 'archived'::"course_status"
		WHEN "lesson"."status" = 'draft' OR "section_lesson"."section_status" = 'draft' THEN 'draft'::"course_status"
		ELSE 'published'::"course_status"
	END,
	"visibility" = CASE
		WHEN "lesson"."visibility" = 'draft' OR "section_lesson"."section_visibility" = 'draft' THEN 'draft'::"learning_content_visibility"
		WHEN "lesson"."visibility" = 'coming_soon' OR "section_lesson"."section_visibility" = 'coming_soon' THEN 'coming_soon'::"learning_content_visibility"
		ELSE 'visible'::"learning_content_visibility"
	END,
	"drip_days" = greatest("lesson"."drip_days", "section_lesson"."section_drip_days"),
	"unlock_after_previous" = "section_lesson"."unlock_after_previous"
		AND "section_lesson"."section_status" = 'published'
		AND "section_lesson"."section_visibility" <> 'draft'
		AND "lesson"."status" = 'published'
		AND "lesson"."visibility" <> 'draft'
		AND "section_lesson"."published_section_lesson_order" > 1
FROM "section_lessons" AS "section_lesson"
WHERE "section_lesson"."id" = "lesson"."id";--> statement-breakpoint
WITH "ordered_lessons" AS (
	SELECT
		"lesson"."id",
		row_number() OVER (
			PARTITION BY "lesson"."module_id"
			ORDER BY "lesson"."sort_order", "lesson"."id"
		) - 1 AS "new_sort_order"
	FROM "lessons" AS "lesson"
)
UPDATE "lessons" AS "lesson"
SET "sort_order" = "ordered_lesson"."new_sort_order"
FROM "ordered_lessons" AS "ordered_lesson"
WHERE "ordered_lesson"."id" = "lesson"."id";--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
WITH "flattened_versions" AS (
	SELECT
		"course_version"."id",
		(
			"course_version"."snapshot"
			- 'schemaVersion'
			- 'accessPolicyVersion'
			- 'moduleKindVersion'
			- 'courseOutlineVersion'
			- 'widgets'
			- 'course'
			- 'modules'
		)
		|| jsonb_build_object(
			'schemaVersion', 6,
			'accessPolicyVersion', 2,
			'moduleKindVersion', 1,
			'courseOutlineVersion', 1,
			'widgets', CASE
				WHEN "course_version"."snapshot" ->> 'schemaVersion' = '5'
					THEN "course_version"."snapshot" -> 'widgets'
				ELSE '[]'::jsonb
			END,
			'course',
				(("course_version"."snapshot" -> 'course') - 'id' - 'organizationId' - 'firstPublishedAt')
				|| jsonb_build_object(
					'id', "course_version"."course_id"::text,
					'organizationId', "course_version"."organization_id"::text,
					'firstPublishedAt', CASE
						WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
							THEN "course_version"."snapshot" #> '{course,firstPublishedAt}'
						ELSE to_jsonb("course_version"."snapshot" ->> 'capturedAt')
					END
				),
			'modules', "flattened_snapshot"."modules"
		) AS "snapshot"
	FROM "course_versions" AS "course_version"
	CROSS JOIN LATERAL (
	SELECT coalesce(
		jsonb_agg(
			(
				"module_entry"."item"
				- 'sections'
				- 'lessons'
				- 'organizationId'
				- 'kind'
				- 'linkedCourseId'
				- 'targetVersionIdAtCapture'
				- 'indentLevel'
				- 'accessMode'
				- 'dripDays'
				- 'delayPendingState'
				- 'availableFrom'
				- 'availableUntil'
				- 'windowDefaultState'
				- 'windowState'
				- 'requestAccessEnabled'
			)
			|| jsonb_build_object(
				'organizationId', "course_version"."organization_id"::text,
				'kind', CASE
					WHEN "course_version"."snapshot" ->> 'moduleKindVersion' = '1'
						THEN "module_entry"."item" ->> 'kind'
					ELSE 'learning'
				END,
				'linkedCourseId', CASE
					WHEN ("course_version"."snapshot" ->> 'schemaVersion')::integer >= 4
						AND "module_entry"."item" ->> 'kind' = 'link'
						THEN "module_entry"."item" -> 'linkedCourseId'
					ELSE 'null'::jsonb
				END,
				'targetVersionIdAtCapture', CASE
					WHEN ("course_version"."snapshot" ->> 'schemaVersion')::integer >= 4
						AND "module_entry"."item" ->> 'kind' = 'link'
						THEN "module_entry"."item" -> 'targetVersionIdAtCapture'
					ELSE 'null'::jsonb
				END,
				'indentLevel', CASE
					WHEN ("course_version"."snapshot" ->> 'schemaVersion')::integer >= 4
						THEN ("module_entry"."item" ->> 'indentLevel')::integer
					ELSE 0
				END,
				'accessMode', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN "module_entry"."item" ->> 'accessMode'
					WHEN greatest(0, least(("module_entry"."item" ->> 'dripDays')::integer, 36500)) > 0
						THEN 'delay_days'
					ELSE 'visible'
				END,
				'dripDays', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN ("module_entry"."item" ->> 'dripDays')::integer
					ELSE greatest(0, least(("module_entry"."item" ->> 'dripDays')::integer, 36500))
				END,
				'delayPendingState', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN "module_entry"."item" ->> 'delayPendingState'
					ELSE 'locked'
				END,
				'availableFrom', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN coalesce("module_entry"."item" -> 'availableFrom', 'null'::jsonb)
					ELSE 'null'::jsonb
				END,
				'availableUntil', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN coalesce("module_entry"."item" -> 'availableUntil', 'null'::jsonb)
					ELSE 'null'::jsonb
				END,
				'windowDefaultState', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN "module_entry"."item" ->> 'windowDefaultState'
					ELSE 'locked'
				END,
				'windowState', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN "module_entry"."item" ->> 'windowState'
					ELSE 'available'
				END,
				'requestAccessEnabled', CASE
					WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
						THEN ("module_entry"."item" ->> 'requestAccessEnabled')::boolean
					ELSE false
				END,
				'lessons', "flattened_lessons"."items"
			)
			ORDER BY "module_entry"."ordinality"
		),
		'[]'::jsonb
	) AS "modules"
	FROM jsonb_array_elements("course_version"."snapshot" -> 'modules')
		WITH ORDINALITY AS "module_entry"("item", "ordinality")
	CROSS JOIN LATERAL (
		SELECT coalesce(
			jsonb_agg(
				(
					"ordered_lesson"."item"
					- 'sectionId'
					- 'organizationId'
					- 'sortOrder'
					- 'status'
					- 'visibility'
					- 'availableAt'
					- 'dripDays'
					- 'unlockAfterPrevious'
				)
				|| jsonb_build_object(
					'organizationId', "course_version"."organization_id"::text,
					'sortOrder', "ordered_lesson"."new_sort_order",
					'status', "ordered_lesson"."effective_status",
					'visibility', "ordered_lesson"."effective_visibility",
					'availableAt', "ordered_lesson"."effective_available_at",
					'dripDays', "ordered_lesson"."effective_drip_days",
					'unlockAfterPrevious', "ordered_lesson"."effective_unlock_after_previous"
				)
				ORDER BY "ordered_lesson"."new_sort_order"
			),
			'[]'::jsonb
		) AS "items"
		FROM (
			SELECT
				"raw_lesson".*,
				row_number() OVER (
					ORDER BY "raw_lesson"."lesson_sort_order", "raw_lesson"."lesson_id"
				) - 1 AS "new_sort_order"
			FROM (
				SELECT
					"direct_lesson"."item",
					("direct_lesson"."item" ->> 'sortOrder')::numeric AS "lesson_sort_order",
					"direct_lesson"."item" ->> 'id' AS "lesson_id",
					"direct_lesson"."item" ->> 'status' AS "effective_status",
					CASE
						WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
							THEN "direct_lesson"."item" ->> 'visibility'
						WHEN "direct_lesson"."item" ->> 'status' = 'published' THEN 'visible'
						ELSE 'draft'
					END AS "effective_visibility",
					CASE
						WHEN jsonb_typeof("direct_lesson"."item" -> 'availableAt') = 'string'
							THEN "direct_lesson"."item" -> 'availableAt'
						ELSE 'null'::jsonb
					END AS "effective_available_at",
					0 AS "effective_drip_days",
					false AS "effective_unlock_after_previous"
				FROM jsonb_array_elements("module_entry"."item" -> 'lessons') AS "direct_lesson"("item")

				UNION ALL

				SELECT
					"section_lesson"."item",
					("section_lesson"."item" ->> 'sortOrder')::numeric AS "lesson_sort_order",
					"section_lesson"."item" ->> 'id' AS "lesson_id",
					CASE
						WHEN "section_lesson"."item" ->> 'status' = 'archived'
							OR "section_entry"."item" ->> 'status' = 'archived' THEN 'archived'
						WHEN "section_lesson"."item" ->> 'status' = 'draft'
							OR "section_entry"."item" ->> 'status' = 'draft' THEN 'draft'
						ELSE 'published'
					END AS "effective_status",
					CASE
						WHEN (
							CASE
								WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
									THEN "section_lesson"."item" ->> 'visibility'
								WHEN "section_lesson"."item" ->> 'status' = 'published' THEN 'visible'
								ELSE 'draft'
							END
						) = 'draft'
							OR (
								CASE
									WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
										THEN "section_entry"."item" ->> 'visibility'
									WHEN "section_entry"."item" ->> 'status' = 'published' THEN 'visible'
									ELSE 'draft'
								END
							) = 'draft' THEN 'draft'
						WHEN "section_lesson"."item" ->> 'visibility' = 'coming_soon'
							OR "section_entry"."item" ->> 'visibility' = 'coming_soon' THEN 'coming_soon'
						ELSE 'visible'
					END AS "effective_visibility",
					CASE
						WHEN jsonb_typeof("section_lesson"."item" -> 'availableAt') = 'string'
							THEN "section_lesson"."item" -> 'availableAt'
						ELSE 'null'::jsonb
					END AS "effective_available_at",
					greatest(
						coalesce(("section_lesson"."item" ->> 'dripDays')::integer, 0),
						coalesce(("section_entry"."item" ->> 'dripDays')::integer, 0)
					) AS "effective_drip_days",
					coalesce(("section_entry"."item" ->> 'unlockAfterPrevious')::boolean, false)
						AND "section_entry"."item" ->> 'status' = 'published'
						AND (
							CASE
								WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
									THEN "section_entry"."item" ->> 'visibility'
								ELSE CASE WHEN "section_entry"."item" ->> 'status' = 'published' THEN 'visible' ELSE 'draft' END
							END
						) <> 'draft'
						AND "section_lesson"."item" ->> 'status' = 'published'
						AND (
							CASE
								WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
									THEN "section_lesson"."item" ->> 'visibility'
								ELSE CASE WHEN "section_lesson"."item" ->> 'status' = 'published' THEN 'visible' ELSE 'draft' END
							END
						) <> 'draft'
						AND "section_lesson"."published_section_lesson_order" > 1 AS "effective_unlock_after_previous"
				FROM jsonb_array_elements("module_entry"."item" -> 'sections') AS "section_entry"("item")
				CROSS JOIN LATERAL (
					SELECT
						"lesson_entry"."item",
						count(*) FILTER (
							WHERE "section_entry"."item" ->> 'status' = 'published'
								AND (
									CASE
										WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
											THEN "section_entry"."item" ->> 'visibility'
										ELSE CASE WHEN "section_entry"."item" ->> 'status' = 'published' THEN 'visible' ELSE 'draft' END
									END
								) <> 'draft'
								AND "lesson_entry"."item" ->> 'status' = 'published'
								AND (
									CASE
										WHEN "course_version"."snapshot" ->> 'accessPolicyVersion' = '1'
											THEN "lesson_entry"."item" ->> 'visibility'
										ELSE CASE WHEN "lesson_entry"."item" ->> 'status' = 'published' THEN 'visible' ELSE 'draft' END
									END
								) <> 'draft'
						) OVER (
							ORDER BY
								("lesson_entry"."item" ->> 'sortOrder')::numeric,
								"lesson_entry"."item" ->> 'id'
							ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
						) AS "published_section_lesson_order"
					FROM jsonb_array_elements("section_entry"."item" -> 'lessons') AS "lesson_entry"("item")
				) AS "section_lesson"
			) AS "raw_lesson"
		) AS "ordered_lesson"
		) AS "flattened_lessons"
	) AS "flattened_snapshot"
)
UPDATE "course_versions" AS "course_version"
SET "snapshot" = "flattened_version"."snapshot"
FROM "flattened_versions" AS "flattened_version"
WHERE "flattened_version"."id" = "course_version"."id";--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "course_versions"
		WHERE "snapshot" ->> 'schemaVersion' IS DISTINCT FROM '6'
			OR "snapshot" ->> 'accessPolicyVersion' IS DISTINCT FROM '2'
			OR jsonb_typeof("snapshot" -> 'modules') IS DISTINCT FROM 'array'
	) THEN
		RAISE EXCEPTION 'course snapshot flattening did not install the target versions';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "course_versions" AS "version"
		CROSS JOIN LATERAL jsonb_array_elements("version"."snapshot" -> 'modules') AS "module"("item")
		WHERE "module"."item" ? 'sections'
			OR jsonb_typeof("module"."item" -> 'lessons') IS DISTINCT FROM 'array'
	) THEN
		RAISE EXCEPTION 'course snapshot flattening left a section collection behind';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "course_versions" AS "version"
		CROSS JOIN LATERAL jsonb_array_elements("version"."snapshot" -> 'modules') AS "module"("item")
		CROSS JOIN LATERAL jsonb_array_elements("module"."item" -> 'lessons') AS "lesson"("item")
		WHERE "lesson"."item" ? 'sectionId'
			OR jsonb_typeof("lesson"."item" -> 'dripDays') IS DISTINCT FROM 'number'
			OR jsonb_typeof("lesson"."item" -> 'unlockAfterPrevious') IS DISTINCT FROM 'boolean'
	) THEN
		RAISE EXCEPTION 'course snapshot flattening left an invalid lesson shape behind';
	END IF;

	IF EXISTS (
		WITH "old_lessons" AS (
			SELECT
				"backup"."id" AS "version_id",
				"lesson"."item" ->> 'id' AS "lesson_id"
			FROM "q_academy_section_flatten_snapshot_backup" AS "backup"
			CROSS JOIN LATERAL jsonb_array_elements("backup"."snapshot" -> 'modules') AS "module"("item")
			CROSS JOIN LATERAL (
				SELECT "direct_lesson"."item"
				FROM jsonb_array_elements("module"."item" -> 'lessons') AS "direct_lesson"("item")
				UNION ALL
				SELECT "section_lesson"."item"
				FROM jsonb_array_elements("module"."item" -> 'sections') AS "section"("item")
				CROSS JOIN LATERAL jsonb_array_elements("section"."item" -> 'lessons') AS "section_lesson"("item")
			) AS "lesson"
		),
		"new_lessons" AS (
			SELECT
				"version"."id" AS "version_id",
				"lesson"."item" ->> 'id' AS "lesson_id"
			FROM "course_versions" AS "version"
			CROSS JOIN LATERAL jsonb_array_elements("version"."snapshot" -> 'modules') AS "module"("item")
			CROSS JOIN LATERAL jsonb_array_elements("module"."item" -> 'lessons') AS "lesson"("item")
		),
		"difference" AS (
			(SELECT * FROM "old_lessons" EXCEPT SELECT * FROM "new_lessons")
			UNION ALL
			(SELECT * FROM "new_lessons" EXCEPT SELECT * FROM "old_lessons")
		)
		SELECT 1 FROM "difference"
	) THEN
		RAISE EXCEPTION 'course snapshot flattening changed the lesson identity set';
	END IF;
END $$;--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_section_id_module_sections_id_fk";--> statement-breakpoint
ALTER TABLE "lessons" DROP CONSTRAINT "lessons_section_module_tenant_fk";--> statement-breakpoint
DROP TRIGGER "module_sections_exam_shape_check" ON "module_sections";--> statement-breakpoint
DROP TRIGGER "module_sections_link_shape_check" ON "module_sections";--> statement-breakpoint
DROP FUNCTION "public"."q_academy_check_exam_section_row"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."q_academy_assert_exam_module_shape"("target_module_id" uuid)
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

	SELECT
		count(*)::integer,
		count(*) FILTER (WHERE "type" = 'exam')::integer
	INTO "lesson_count", "valid_exam_lesson_count"
	FROM "public"."lessons"
	WHERE "module_id" = "target_module_id";

	IF "lesson_count" <> 1 OR "valid_exam_lesson_count" <> 1 THEN
		RAISE EXCEPTION 'exam module % must contain exactly one exam lesson', "target_module_id"
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
ALTER FUNCTION "public"."q_academy_assert_exam_module_shape"(uuid) SECURITY DEFINER;--> statement-breakpoint
ALTER FUNCTION "public"."q_academy_assert_exam_module_shape"(uuid) SET search_path TO pg_catalog, public;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."q_academy_assert_exam_module_shape"(uuid) FROM PUBLIC;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."q_academy_assert_link_module_shape"("target_module_id" uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
REVOKE ALL ON FUNCTION "public"."q_academy_assert_link_module_shape"(uuid) FROM PUBLIC;--> statement-breakpoint
ALTER TABLE "lessons" DROP COLUMN "section_id";--> statement-breakpoint
DROP TABLE "module_sections";--> statement-breakpoint
CREATE INDEX "lessons_module_sort_idx" ON "lessons" USING btree ("module_id", "sort_order", "id");--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_drip_days_check" CHECK ("lessons"."drip_days" >= 0 AND "lessons"."drip_days" <= 36500);
