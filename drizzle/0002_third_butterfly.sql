CREATE TABLE "announcement_dismissals" (
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_dismissals_announcement_id_user_id_pk" PRIMARY KEY("announcement_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" varchar(180) NOT NULL,
	"body" text NOT NULL,
	"tone" varchar(20) DEFAULT 'info' NOT NULL,
	"placement" varchar(20) DEFAULT 'banner' NOT NULL,
	"audience" varchar(20) DEFAULT 'all' NOT NULL,
	"audience_id" uuid,
	"href" text,
	"action_label" varchar(80),
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"dismissible" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_tone_check" CHECK ("announcements"."tone" in ('info', 'success', 'warning', 'critical')),
	CONSTRAINT "announcements_placement_check" CHECK ("announcements"."placement" in ('banner', 'modal')),
	CONSTRAINT "announcements_audience_check" CHECK (("announcements"."audience" = 'all' and "announcements"."audience_id" is null) or ("announcements"."audience" in ('user', 'group') and "announcements"."audience_id" is not null)),
	CONSTRAINT "announcements_schedule_check" CHECK ("announcements"."ends_at" is null or "announcements"."ends_at" > "announcements"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_dismissals" ADD CONSTRAINT "announcement_dismissals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcement_dismissals_user_idx" ON "announcement_dismissals" USING btree ("user_id","dismissed_at");--> statement-breakpoint
CREATE INDEX "announcements_org_active_schedule_idx" ON "announcements" USING btree ("organization_id","active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "announcements_org_audience_idx" ON "announcements" USING btree ("organization_id","audience","audience_id");