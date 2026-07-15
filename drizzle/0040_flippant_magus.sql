CREATE TYPE "public"."exam_content_access_mode" AS ENUM('allow', 'block_course', 'block_academy');--> statement-breakpoint
CREATE TYPE "public"."exam_finalization_reason" AS ENUM('submitted', 'timeout', 'administrator');--> statement-breakpoint
CREATE TYPE "public"."exam_result_release_mode" AS ENUM('immediate', 'after_deadline', 'manual');--> statement-breakpoint
CREATE TYPE "public"."exam_review_release_mode" AS ENUM('never', 'after_result', 'manual');--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "course_version_id" uuid;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "definition_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "question_order" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "question_pools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "question_presentation" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "draft_answers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "draft_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "last_saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "finalization_reason" "exam_finalization_reason";--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "result_release_mode" "exam_result_release_mode" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "review_release_mode" "exam_review_release_mode" DEFAULT 'after_result' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "content_access_mode" "exam_content_access_mode" DEFAULT 'allow' NOT NULL;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "result_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD COLUMN "review_released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "exam_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "exam_question_pools" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "exam_result_release_mode" "exam_result_release_mode" DEFAULT 'immediate' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "exam_review_release_mode" "exam_review_release_mode" DEFAULT 'after_result' NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "exam_content_access_mode" "exam_content_access_mode" DEFAULT 'allow' NOT NULL;--> statement-breakpoint
UPDATE "assessment_attempts"
SET "status" = 'graded',
    "submitted_at" = greatest("started_at", coalesce("submitted_at", statement_timestamp())),
    "graded_at" = greatest("started_at", coalesce("submitted_at", "started_at"), statement_timestamp()),
    "finalization_reason" = 'administrator'
WHERE "status" in ('in_progress', 'submitted');--> statement-breakpoint
UPDATE "assessment_attempts"
SET "submitted_at" = coalesce("submitted_at", "started_at"),
    "graded_at" = greatest(coalesce("graded_at", "started_at"), coalesce("submitted_at", "started_at")),
    "finalization_reason" = coalesce("finalization_reason", 'submitted'),
    "result_released_at" = coalesce("result_released_at", greatest(coalesce("graded_at", "started_at"), coalesce("submitted_at", "started_at"))),
    "review_released_at" = coalesce("review_released_at", "result_released_at", greatest(coalesce("graded_at", "started_at"), coalesce("submitted_at", "started_at")))
WHERE "status" = 'graded' AND "course_version_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_attempts_id_org_idx" ON "assessment_attempts" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "assessment_answers" ADD CONSTRAINT "assessment_answers_attempt_tenant_fk" FOREIGN KEY ("attempt_id","organization_id") REFERENCES "public"."assessment_attempts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_course_version_id_course_versions_id_fk" FOREIGN KEY ("course_version_id") REFERENCES "public"."course_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_lesson_tenant_fk" FOREIGN KEY ("lesson_id","organization_id") REFERENCES "public"."lessons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_version_scope_fk" FOREIGN KEY ("course_version_id","course_id","organization_id") REFERENCES "public"."course_versions"("id","course_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_attempts_one_active_idx" ON "assessment_attempts" USING btree ("organization_id","user_id","course_id","lesson_id") WHERE "assessment_attempts"."status" in ('in_progress', 'submitted');--> statement-breakpoint
CREATE INDEX "assessment_attempts_active_deadline_idx" ON "assessment_attempts" USING btree ("deadline_at","id") WHERE "assessment_attempts"."deadline_at" is not null and "assessment_attempts"."status" in ('in_progress', 'submitted');--> statement-breakpoint
CREATE INDEX "assessment_attempts_result_release_deadline_idx" ON "assessment_attempts" USING btree ("deadline_at","id") WHERE "assessment_attempts"."deadline_at" is not null and "assessment_attempts"."status" = 'graded' and "assessment_attempts"."result_release_mode" = 'after_deadline' and "assessment_attempts"."result_released_at" is null;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_definition_hash_check" CHECK ("assessment_attempts"."definition_hash" is null or "assessment_attempts"."definition_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_lifecycle_scope_check" CHECK (("assessment_attempts"."course_version_id" is null and "assessment_attempts"."definition_hash" is null) or ("assessment_attempts"."course_version_id" is not null and "assessment_attempts"."definition_hash" is not null));--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_lifecycle_json_shape_check" CHECK (jsonb_typeof("assessment_attempts"."question_order") = 'array' and jsonb_typeof("assessment_attempts"."question_pools") = 'array' and jsonb_typeof("assessment_attempts"."question_presentation") = 'array' and jsonb_typeof("assessment_attempts"."draft_answers") = 'array');--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_draft_revision_check" CHECK ("assessment_attempts"."draft_revision" >= 0);--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_deadline_check" CHECK ("assessment_attempts"."deadline_at" is null or "assessment_attempts"."deadline_at" > "assessment_attempts"."started_at");--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_release_timestamps_check" CHECK (("assessment_attempts"."result_released_at" is null or ("assessment_attempts"."graded_at" is not null and "assessment_attempts"."result_released_at" >= "assessment_attempts"."graded_at")) and ("assessment_attempts"."review_released_at" is null or ("assessment_attempts"."result_released_at" is not null and "assessment_attempts"."review_released_at" >= "assessment_attempts"."result_released_at")));--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_exam_duration_seconds_check" CHECK ("lessons"."exam_duration_seconds" is null or ("lessons"."exam_duration_seconds" >= 60 and "lessons"."exam_duration_seconds" <= 86400));--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_exam_question_pools_shape_check" CHECK (jsonb_typeof("lessons"."exam_question_pools") = 'array');
