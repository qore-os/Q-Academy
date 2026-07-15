CREATE TABLE "member_welcome_acknowledgements" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"configuration_version" integer NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_welcome_acknowledgements_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "member_welcome_acknowledgements_version_check" CHECK ("member_welcome_acknowledgements"."configuration_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "member_welcome_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"title" varchar(160) DEFAULT 'Willkommen in deiner Academy' NOT NULL,
	"welcome_text" text DEFAULT 'Schoen, dass du da bist. Hier findest du alles fuer deinen Lernstart.' NOT NULL,
	"video_url" varchar(2000),
	"prompt_profile_image" boolean DEFAULT false NOT NULL,
	"prompt_profile_completion" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_welcome_settings_title_check" CHECK (btrim("member_welcome_settings"."title") <> ''),
	CONSTRAINT "member_welcome_settings_text_check" CHECK (btrim("member_welcome_settings"."welcome_text") <> '' and char_length("member_welcome_settings"."welcome_text") <= 5000),
	CONSTRAINT "member_welcome_settings_video_url_check" CHECK ("member_welcome_settings"."video_url" is null or "member_welcome_settings"."video_url" ~ '^https://[^[:space:]]+$'),
	CONSTRAINT "member_welcome_settings_version_check" CHECK ("member_welcome_settings"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "member_welcome_acknowledgements" ADD CONSTRAINT "member_welcome_acknowledgements_organization_id_member_welcome_settings_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."member_welcome_settings"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_welcome_acknowledgements" ADD CONSTRAINT "member_welcome_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_welcome_acknowledgements" ADD CONSTRAINT "member_welcome_acknowledgements_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_welcome_settings" ADD CONSTRAINT "member_welcome_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_welcome_acknowledgements_org_version_idx" ON "member_welcome_acknowledgements" USING btree ("organization_id","configuration_version");