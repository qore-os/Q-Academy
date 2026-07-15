CREATE TYPE "public"."event_audience_mode" AS ENUM('tenant', 'restricted');--> statement-breakpoint
CREATE TABLE "event_audience_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"bundle_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_audience_grants_single_target_check" CHECK (num_nonnulls("event_audience_grants"."user_id", "event_audience_grants"."group_id", "event_audience_grants"."bundle_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "audience_mode" "event_audience_mode" DEFAULT 'tenant' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_audience_grants" ADD CONSTRAINT "event_audience_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_grants" ADD CONSTRAINT "event_audience_grants_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_grants" ADD CONSTRAINT "event_audience_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_grants" ADD CONSTRAINT "event_audience_grants_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_audience_grants" ADD CONSTRAINT "event_audience_grants_bundle_id_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."bundles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_audience_grants_org_event_idx" ON "event_audience_grants" USING btree ("organization_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_grants_event_user_idx" ON "event_audience_grants" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_grants_event_group_idx" ON "event_audience_grants" USING btree ("event_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_audience_grants_event_bundle_idx" ON "event_audience_grants" USING btree ("event_id","bundle_id");