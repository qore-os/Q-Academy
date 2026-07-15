CREATE TYPE "public"."notification_category" AS ENUM('learning', 'community', 'events', 'feedback', 'announcements', 'system');--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preferences_pk" PRIMARY KEY("organization_id","user_id","category"),
	CONSTRAINT "user_notification_preferences_configurable_category_check" CHECK ("user_notification_preferences"."category" <> 'system')
);
--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD COLUMN "category" "notification_category" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "category" "notification_category" DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" varchar(16);--> statement-breakpoint
UPDATE "notifications"
SET "category" = CASE
	WHEN lower("type") = 'community' THEN 'community'::"notification_category"
	WHEN lower("type") IN ('submission', 'feedback') THEN 'feedback'::"notification_category"
	WHEN lower("type") IN ('lesson_available', 'lesson', 'course', 'course_access', 'certificate') THEN 'learning'::"notification_category"
	WHEN lower("type") = 'event' OR lower("type") LIKE 'event.%' THEN 'events'::"notification_category"
	WHEN lower("type") = 'announcement' THEN 'announcements'::"notification_category"
	ELSE 'system'::"notification_category"
END;--> statement-breakpoint
UPDATE "email_deliveries"
SET "category" = CASE
	WHEN "event" = 'lesson.available' THEN 'learning'::"notification_category"
	WHEN "event" = 'feedback.reply' THEN 'feedback'::"notification_category"
	WHEN "event" IN ('event.rescheduled', 'event.cancelled') THEN 'events'::"notification_category"
	ELSE 'system'::"notification_category"
END;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "classify_notification_category"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."category" = 'system'::"notification_category" THEN
		NEW."category" := CASE
			WHEN lower(NEW."type") = 'community' THEN 'community'::"notification_category"
			WHEN lower(NEW."type") IN ('submission', 'feedback') THEN 'feedback'::"notification_category"
			WHEN lower(NEW."type") IN ('lesson_available', 'lesson', 'course', 'course_access', 'certificate') THEN 'learning'::"notification_category"
			WHEN lower(NEW."type") = 'event' OR lower(NEW."type") LIKE 'event.%' THEN 'events'::"notification_category"
			WHEN lower(NEW."type") = 'announcement' THEN 'announcements'::"notification_category"
			ELSE 'system'::"notification_category"
		END;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "notifications_classify_category_trigger"
BEFORE INSERT OR UPDATE OF "type", "category" ON "notifications"
FOR EACH ROW EXECUTE FUNCTION "classify_notification_category"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "classify_email_delivery_category"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."category" = 'system'::"notification_category" THEN
		NEW."category" := CASE
			WHEN NEW."event" = 'lesson.available' THEN 'learning'::"notification_category"
			WHEN NEW."event" = 'feedback.reply' THEN 'feedback'::"notification_category"
			WHEN NEW."event" IN ('event.rescheduled', 'event.cancelled') THEN 'events'::"notification_category"
			ELSE 'system'::"notification_category"
		END;
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "email_deliveries_classify_category_trigger"
BEFORE INSERT OR UPDATE OF "event", "category" ON "email_deliveries"
FOR EACH ROW EXECUTE FUNCTION "classify_email_delivery_category"();--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_notification_preferences_user_idx" ON "user_notification_preferences" USING btree ("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_check" CHECK ("users"."phone" is null or "users"."phone" ~ '^\+[1-9][0-9]{6,14}$');
