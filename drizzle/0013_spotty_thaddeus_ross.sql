CREATE TYPE "public"."submission_review_decision" AS ENUM('revision', 'approved');--> statement-breakpoint
CREATE TABLE "submission_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"decision" "submission_review_decision" NOT NULL,
	"feedback" text NOT NULL,
	"score" real NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_reviews_score_check" CHECK ("submission_reviews"."score" >= 0 and "submission_reviews"."score" <= 100)
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "block_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "attempt_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "supersedes_id" uuid;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_reviews" ADD CONSTRAINT "submission_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_reviews_submission_idx" ON "submission_reviews" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submission_reviews_org_reviewed_idx" ON "submission_reviews" USING btree ("organization_id","reviewed_at");--> statement-breakpoint
INSERT INTO "submission_reviews" (
	"organization_id",
	"submission_id",
	"reviewer_id",
	"decision",
	"feedback",
	"score",
	"reviewed_at"
)
SELECT
	"organization_id",
	"id",
	"reviewer_id",
	"status"::text::"submission_review_decision",
	coalesce("feedback", 'Bestehende Bewertung'),
	coalesce("score", 0),
	coalesce("reviewed_at", "submitted_at")
FROM "submissions"
WHERE "status" IN ('revision', 'approved');--> statement-breakpoint
CREATE FUNCTION "prevent_submission_review_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'submission review history is immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submission_reviews_prevent_update"
BEFORE UPDATE ON "submission_reviews"
FOR EACH ROW
EXECUTE FUNCTION "prevent_submission_review_update"();--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_supersedes_id_submissions_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."submissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submissions_org_member_block_idx" ON "submissions" USING btree ("organization_id","user_id","course_id","lesson_id","block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_org_member_block_attempt_idx" ON "submissions" USING btree ("organization_id","user_id","course_id","lesson_id","block_id","attempt_number") WHERE "submissions"."block_id" is not null and "submissions"."lesson_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_supersedes_idx" ON "submissions" USING btree ("supersedes_id") WHERE "submissions"."supersedes_id" is not null;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_attempt_number_check" CHECK ("submissions"."attempt_number" > 0);--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_supersedes_self_check" CHECK ("submissions"."supersedes_id" is null or "submissions"."supersedes_id" <> "submissions"."id");
