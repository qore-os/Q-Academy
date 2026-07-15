ALTER TABLE "lessons" ADD COLUMN "passing_score" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "max_attempts" integer;--> statement-breakpoint
ALTER TABLE "lessons" ADD COLUMN "shuffle_questions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_passing_score_check" CHECK ("lessons"."passing_score" >= 1 and "lessons"."passing_score" <= 100);--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_max_attempts_check" CHECK ("lessons"."max_attempts" is null or ("lessons"."max_attempts" >= 1 and "lessons"."max_attempts" <= 100));