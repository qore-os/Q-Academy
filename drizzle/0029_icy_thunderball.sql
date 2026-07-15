CREATE TYPE "public"."module_kind" AS ENUM('learning', 'exam');--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "kind" "module_kind";--> statement-breakpoint
UPDATE "modules" SET "kind" = 'learning';--> statement-breakpoint
UPDATE "modules" AS "module"
SET "kind" = 'exam'
WHERE EXISTS (
	SELECT 1
	FROM "lessons" AS "lesson"
	WHERE "lesson"."module_id" = "module"."id"
		AND "lesson"."organization_id" = "module"."organization_id"
		AND "lesson"."type" = 'exam'
		AND "lesson"."section_id" IS NULL
		AND NOT EXISTS (
			SELECT 1
			FROM "lessons" AS "other_lesson"
			WHERE "other_lesson"."module_id" = "module"."id"
				AND "other_lesson"."id" <> "lesson"."id"
		)
		AND EXISTS (
			SELECT 1
			FROM "content_blocks" AS "block"
			WHERE "block"."lesson_id" = "lesson"."id"
				AND "block"."type" IN (
					'multiple_choice',
					'true_false',
					'multi_select',
					'fill_blank',
					'ordering',
					'submission'
				)
		)
)
	AND NOT EXISTS (
		SELECT 1
		FROM "module_sections" AS "section"
		WHERE "section"."module_id" = "module"."id"
	);--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "kind" SET DEFAULT 'learning';--> statement-breakpoint
ALTER TABLE "modules" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "modules_org_kind_folder_idx" ON "modules" USING btree ("organization_id","kind","folder");
