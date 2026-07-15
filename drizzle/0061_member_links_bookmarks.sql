CREATE TABLE "lesson_bookmarks" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_bookmarks_user_course_lesson_pk" PRIMARY KEY("user_id","course_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "member_sidebar_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"label" varchar(80) NOT NULL,
	"description" varchar(240),
	"href" text NOT NULL,
	"icon" varchar(32) DEFAULT 'link' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sidebar_links_label_check" CHECK (length(btrim("member_sidebar_links"."label")) between 1 and 80),
	CONSTRAINT "member_sidebar_links_description_check" CHECK ("member_sidebar_links"."description" is null or length(btrim("member_sidebar_links"."description")) between 1 and 240),
	CONSTRAINT "member_sidebar_links_href_check" CHECK (length("member_sidebar_links"."href") between 1 and 2048 and "member_sidebar_links"."href" !~ '[[:cntrl:]]' and ("member_sidebar_links"."href" ~ '^/[A-Za-z0-9]' or "member_sidebar_links"."href" ~ '^https://[^[:space:]]+$')),
	CONSTRAINT "member_sidebar_links_icon_check" CHECK ("member_sidebar_links"."icon" in ('link', 'book-open', 'life-buoy', 'video', 'file-text', 'globe', 'messages-square', 'calendar')),
	CONSTRAINT "member_sidebar_links_sort_order_check" CHECK ("member_sidebar_links"."sort_order" between 0 and 999)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_id_module_organization_idx" ON "lessons" USING btree ("id","module_id","organization_id");--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_course_module_tenant_fk" FOREIGN KEY ("course_id","module_id","organization_id") REFERENCES "public"."course_modules"("course_id","module_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_bookmarks" ADD CONSTRAINT "lesson_bookmarks_lesson_module_tenant_fk" FOREIGN KEY ("lesson_id","module_id","organization_id") REFERENCES "public"."lessons"("id","module_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sidebar_links" ADD CONSTRAINT "member_sidebar_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_bookmarks_org_user_created_idx" ON "lesson_bookmarks" USING btree ("organization_id","user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "member_sidebar_links_org_label_lower_idx" ON "member_sidebar_links" USING btree ("organization_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "member_sidebar_links_id_organization_idx" ON "member_sidebar_links" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "member_sidebar_links_org_active_sort_idx" ON "member_sidebar_links" USING btree ("organization_id","active","sort_order","id");
