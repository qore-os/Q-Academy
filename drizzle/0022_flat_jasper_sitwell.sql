CREATE TYPE "public"."course_widget_type" AS ENUM('author', 'info', 'image_link');--> statement-breakpoint
CREATE TABLE "course_widgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"type" "course_widget_type" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"author_user_id" uuid,
	"author_role" varchar(160),
	"author_description" text,
	"title" varchar(220),
	"text" text,
	"link_url" text,
	"image_url" text,
	"alt_text" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_widgets_sort_order_check" CHECK ("course_widgets"."sort_order" >= 0),
	CONSTRAINT "course_widgets_payload_check" CHECK ((
        "course_widgets"."type" = 'author'
        and "course_widgets"."author_user_id" is not null
        and "course_widgets"."title" is null
        and "course_widgets"."text" is null
        and "course_widgets"."link_url" is null
        and "course_widgets"."image_url" is null
        and "course_widgets"."alt_text" is null
      ) or (
        "course_widgets"."type" = 'info'
        and "course_widgets"."author_user_id" is null
        and "course_widgets"."author_role" is null
        and "course_widgets"."author_description" is null
        and length("course_widgets"."title") > 0
        and length("course_widgets"."text") > 0
        and "course_widgets"."image_url" is null
        and "course_widgets"."alt_text" is null
      ) or (
        "course_widgets"."type" = 'image_link'
        and "course_widgets"."author_user_id" is null
        and "course_widgets"."author_role" is null
        and "course_widgets"."author_description" is null
        and "course_widgets"."title" is null
        and "course_widgets"."text" is null
        and length("course_widgets"."link_url") > 0
        and length("course_widgets"."image_url") > 0
        and length("course_widgets"."alt_text") > 0
      ))
);
--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_author_tenant_fk" FOREIGN KEY ("author_user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_widgets_id_organization_idx" ON "course_widgets" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "course_widgets_org_course_sort_idx" ON "course_widgets" USING btree ("organization_id","course_id","sort_order");