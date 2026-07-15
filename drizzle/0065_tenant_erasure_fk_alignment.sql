ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_agent_action_events" DROP CONSTRAINT "ai_agent_action_events_organization_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_agent_action_events" ADD CONSTRAINT "ai_agent_action_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
