CREATE TABLE "event_calendar_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"background_color" varchar(7) DEFAULT '#f7f9fb' NOT NULL,
	"surface_color" varchar(7) DEFAULT '#ffffff' NOT NULL,
	"border_color" varchar(7) DEFAULT '#dfe4e8' NOT NULL,
	"heading_color" varchar(7) DEFAULT '#243444' NOT NULL,
	"body_color" varchar(7) DEFAULT '#66727f' NOT NULL,
	"accent_color" varchar(7) DEFAULT '#167e74' NOT NULL,
	"live_color" varchar(7) DEFAULT '#b84e42' NOT NULL,
	"cancelled_color" varchar(7) DEFAULT '#8c3f35' NOT NULL,
	"density" varchar(16) DEFAULT 'comfortable' NOT NULL,
	"card_radius" integer DEFAULT 6 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_calendar_settings_colors_check" CHECK ("event_calendar_settings"."background_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."surface_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."border_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."heading_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."body_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."accent_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."live_color" ~ '^#[0-9a-fA-F]{6}$' and "event_calendar_settings"."cancelled_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "event_calendar_settings_density_check" CHECK ("event_calendar_settings"."density" in ('compact', 'comfortable')),
	CONSTRAINT "event_calendar_settings_radius_check" CHECK ("event_calendar_settings"."card_radius" between 0 and 8)
);
--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" ADD COLUMN "timezone" varchar(64) DEFAULT 'Europe/Berlin' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "timezone" varchar(64) DEFAULT 'Europe/Berlin' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_calendar_settings" ADD CONSTRAINT "event_calendar_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" ADD CONSTRAINT "event_lifecycle_history_timezone_check" CHECK ("event_lifecycle_history"."timezone" = 'UTC' or "event_lifecycle_history"."timezone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9._+-]+)+$') NOT VALID;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_timezone_check" CHECK ("events"."timezone" = 'UTC' or "events"."timezone" ~ '^[A-Za-z_+-]+(?:/[A-Za-z0-9._+-]+)+$') NOT VALID;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" VALIDATE CONSTRAINT "event_lifecycle_history_timezone_check";--> statement-breakpoint
ALTER TABLE "events" VALIDATE CONSTRAINT "events_timezone_check";
