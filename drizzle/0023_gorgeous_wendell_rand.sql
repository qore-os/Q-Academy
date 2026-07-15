CREATE TABLE "course_authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_authors_sort_order_check" CHECK ("course_authors"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "course_learning_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"text" varchar(500) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_learning_goals_text_check" CHECK (length(btrim("course_learning_goals"."text")) between 1 and 500),
	CONSTRAINT "course_learning_goals_sort_order_check" CHECK ("course_learning_goals"."sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "visible_in_catalog" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "show_progress_percentage" boolean DEFAULT true NOT NULL;--> statement-breakpoint
INSERT INTO "course_authors" (
	"organization_id",
	"course_id",
	"user_id",
	"sort_order"
)
SELECT
	c."organization_id",
	c."id",
	c."created_by_id",
	0
FROM "courses" c
INNER JOIN "users" u
	ON u."id" = c."created_by_id"
	AND u."organization_id" = c."organization_id"
	AND u."status" = 'active'
	AND u."role" IN ('owner', 'admin', 'trainer')
WHERE c."created_by_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "course_authors" ca
		WHERE ca."organization_id" = c."organization_id"
			AND ca."course_id" = c."id"
			AND ca."user_id" = c."created_by_id"
	);--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_authors" ADD CONSTRAINT "course_authors_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_learning_goals" ADD CONSTRAINT "course_learning_goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_learning_goals" ADD CONSTRAINT "course_learning_goals_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_learning_goals" ADD CONSTRAINT "course_learning_goals_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_authors_id_organization_idx" ON "course_authors" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_authors_org_course_user_idx" ON "course_authors" USING btree ("organization_id","course_id","user_id");--> statement-breakpoint
CREATE INDEX "course_authors_org_course_sort_idx" ON "course_authors" USING btree ("organization_id","course_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "course_learning_goals_id_organization_idx" ON "course_learning_goals" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "course_learning_goals_org_course_sort_idx" ON "course_learning_goals" USING btree ("organization_id","course_id","sort_order");
