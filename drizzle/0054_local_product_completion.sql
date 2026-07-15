CREATE TYPE "public"."event_lifecycle_action" AS ENUM('created', 'rescheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ai_agent_action_type" ADD VALUE 'course_unenrollment';--> statement-breakpoint
CREATE TABLE "ai_external_use_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notice_version" integer NOT NULL,
	"notice_digest" varchar(64) NOT NULL,
	"privacy_policy_url" text,
	"transparency_policy_url" text,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_external_use_acknowledgements_version_check" CHECK ("ai_external_use_acknowledgements"."notice_version" >= 1),
	CONSTRAINT "ai_external_use_acknowledgements_digest_check" CHECK ("ai_external_use_acknowledgements"."notice_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_external_use_acknowledgements_privacy_url_check" CHECK ("ai_external_use_acknowledgements"."privacy_policy_url" is null or "ai_external_use_acknowledgements"."privacy_policy_url" ~ '^https://[^[:space:]]+$'),
	CONSTRAINT "ai_external_use_acknowledgements_transparency_url_check" CHECK ("ai_external_use_acknowledgements"."transparency_policy_url" is null or "ai_external_use_acknowledgements"."transparency_policy_url" ~ '^https://[^[:space:]]+$')
);
--> statement-breakpoint
CREATE TABLE "event_lifecycle_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_reference" varchar(96) NOT NULL,
	"action" "event_lifecycle_action" NOT NULL,
	"from_status" "event_status",
	"to_status" "event_status" NOT NULL,
	"previous_starts_at" timestamp with time zone,
	"previous_ends_at" timestamp with time zone,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" varchar(500),
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_lifecycle_history_revision_nonnegative_check" CHECK ("event_lifecycle_history"."revision" >= 0),
	CONSTRAINT "event_lifecycle_history_actor_reference_check" CHECK ("event_lifecycle_history"."actor_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "event_lifecycle_history_window_check" CHECK ("event_lifecycle_history"."ends_at" > "event_lifecycle_history"."starts_at" and ("event_lifecycle_history"."previous_starts_at" is null or "event_lifecycle_history"."previous_ends_at" > "event_lifecycle_history"."previous_starts_at")),
	CONSTRAINT "event_lifecycle_history_shape_check" CHECK (("event_lifecycle_history"."action" = 'created' and "event_lifecycle_history"."revision" = 0 and "event_lifecycle_history"."from_status" is null and "event_lifecycle_history"."previous_starts_at" is null and "event_lifecycle_history"."previous_ends_at" is null and "event_lifecycle_history"."reason" is null) or ("event_lifecycle_history"."action" <> 'created' and "event_lifecycle_history"."revision" > 0 and "event_lifecycle_history"."from_status" is not null and "event_lifecycle_history"."previous_starts_at" is not null and "event_lifecycle_history"."previous_ends_at" is not null and length(btrim("event_lifecycle_history"."reason")) between 3 and 500))
);
--> statement-breakpoint
ALTER TABLE "user_mfa_configurations" DROP CONSTRAINT "user_mfa_configurations_recovery_hashes_check";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "status" "event_status" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lifecycle_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "events_id_organization_idx" ON "events" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "ai_external_use_acknowledgements" ADD CONSTRAINT "ai_external_use_acknowledgements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_external_use_acknowledgements" ADD CONSTRAINT "ai_external_use_acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_external_use_acknowledgements" ADD CONSTRAINT "ai_external_use_acknowledgements_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" ADD CONSTRAINT "event_lifecycle_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_lifecycle_history" ADD CONSTRAINT "event_lifecycle_history_event_tenant_fk" FOREIGN KEY ("event_id","organization_id") REFERENCES "public"."events"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_external_use_acknowledgements_id_org_idx" ON "ai_external_use_acknowledgements" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_external_use_acknowledgements_user_notice_idx" ON "ai_external_use_acknowledgements" USING btree ("organization_id","user_id","notice_digest");--> statement-breakpoint
CREATE INDEX "ai_external_use_acknowledgements_org_acknowledged_idx" ON "ai_external_use_acknowledgements" USING btree ("organization_id","acknowledged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_lifecycle_history_event_revision_idx" ON "event_lifecycle_history" USING btree ("event_id","revision");--> statement-breakpoint
CREATE INDEX "event_lifecycle_history_org_created_idx" ON "event_lifecycle_history" USING btree ("organization_id","created_at");--> statement-breakpoint
UPDATE "public"."events"
SET "ends_at" = "starts_at" + interval '1 minute',
	"updated_at" = statement_timestamp()
WHERE "ends_at" <= "starts_at";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_window_check" CHECK ("events"."ends_at" > "events"."starts_at");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_lifecycle_revision_nonnegative_check" CHECK ("events"."lifecycle_revision" >= 0);--> statement-breakpoint
ALTER TABLE "user_mfa_configurations" ADD CONSTRAINT "user_mfa_configurations_recovery_hashes_check" CHECK (cardinality("user_mfa_configurations"."recovery_code_hashes") <= 12 and array_to_string("user_mfa_configurations"."recovery_code_hashes", ',') ~ '^(v1.[A-Za-z0-9][A-Za-z0-9._-]{0,63}.[a-f0-9]{64})(,v1.[A-Za-z0-9][A-Za-z0-9._-]{0,63}.[a-f0-9]{64})*$|^$');
--> statement-breakpoint
INSERT INTO "public"."event_lifecycle_history" (
	"organization_id",
	"event_id",
	"actor_reference",
	"action",
	"from_status",
	"to_status",
	"previous_starts_at",
	"previous_ends_at",
	"starts_at",
	"ends_at",
	"reason",
	"revision",
	"created_at"
)
SELECT
	"organization_id",
	"id",
	md5('event-migration:' || "id"::text) || md5('event-migration-v2:' || "id"::text),
	'created'::"public"."event_lifecycle_action",
	NULL,
	'scheduled'::"public"."event_status",
	NULL,
	NULL,
	"starts_at",
	"ends_at",
	NULL,
	0,
	"created_at"
FROM "public"."events"
ON CONFLICT ("event_id", "revision") DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION "public"."protect_event_lifecycle_history"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND NOT EXISTS (
		SELECT 1
		FROM "public"."organizations"
		WHERE "id" = OLD."organization_id"
	) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'event_lifecycle_history is append-only'
		USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_event_lifecycle_history"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "event_lifecycle_history_append_only_trigger"
BEFORE UPDATE OR DELETE ON "public"."event_lifecycle_history"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_event_lifecycle_history"();
--> statement-breakpoint
CREATE FUNCTION "public"."reject_event_lifecycle_history_truncate"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'event_lifecycle_history cannot be truncated'
		USING ERRCODE = '55000';
	RETURN NULL;
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."reject_event_lifecycle_history_truncate"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "event_lifecycle_history_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."event_lifecycle_history"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_event_lifecycle_history_truncate"();
--> statement-breakpoint
COMMENT ON TRIGGER "event_lifecycle_history_append_only_trigger" ON "public"."event_lifecycle_history" IS
	'Event lifecycle evidence is append-only; only a complete organization cascade may remove it.';
