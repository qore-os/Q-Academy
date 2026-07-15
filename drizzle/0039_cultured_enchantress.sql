CREATE TYPE "public"."course_permission" AS ENUM('view', 'edit', 'manage');--> statement-breakpoint
CREATE TABLE "course_collaborators" (
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" "course_permission" DEFAULT 'view' NOT NULL,
	"granted_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_collaborators_course_id_user_id_pk" PRIMARY KEY("course_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "course_collaborators" ADD CONSTRAINT "course_collaborators_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_collaborators" ADD CONSTRAINT "course_collaborators_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_collaborators" ADD CONSTRAINT "course_collaborators_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_collaborators" ADD CONSTRAINT "course_collaborators_granter_tenant_fk" FOREIGN KEY ("granted_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_collaborators_org_user_idx" ON "course_collaborators" USING btree ("organization_id","user_id");
--> statement-breakpoint
INSERT INTO "course_collaborators" (
	"organization_id",
	"course_id",
	"user_id",
	"permission",
	"granted_by_id"
)
SELECT
	"courses"."organization_id",
	"courses"."id",
	"users"."id",
	'manage'::"course_permission",
	"users"."id"
FROM "courses"
INNER JOIN "users"
	ON "users"."id" = "courses"."created_by_id"
	AND "users"."organization_id" = "courses"."organization_id"
WHERE "users"."role" = 'trainer'
ON CONFLICT ("course_id", "user_id") DO UPDATE
SET "permission" = 'manage'::"course_permission", "updated_at" = now();
--> statement-breakpoint
INSERT INTO "course_collaborators" (
	"organization_id",
	"course_id",
	"user_id",
	"permission",
	"granted_by_id"
)
SELECT
	"course_authors"."organization_id",
	"course_authors"."course_id",
	"users"."id",
	'edit'::"course_permission",
	"courses"."created_by_id"
FROM "course_authors"
INNER JOIN "users"
	ON "users"."id" = "course_authors"."user_id"
	AND "users"."organization_id" = "course_authors"."organization_id"
INNER JOIN "courses"
	ON "courses"."id" = "course_authors"."course_id"
	AND "courses"."organization_id" = "course_authors"."organization_id"
WHERE "users"."role" = 'trainer'
ON CONFLICT ("course_id", "user_id") DO NOTHING;
