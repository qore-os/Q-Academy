CREATE TYPE "public"."ai_agent_action_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ai_agent_action_type" AS ENUM('course_enrollment');--> statement-breakpoint
CREATE TABLE "ai_agent_action_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_reference" varchar(64) NOT NULL,
	"event" varchar(80) NOT NULL,
	"from_status" "ai_agent_action_request_status",
	"to_status" "ai_agent_action_request_status" NOT NULL,
	"revision" integer NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_action_events_actor_reference_check" CHECK ("ai_agent_action_events"."actor_reference" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_agent_action_events_payload_digest_check" CHECK ("ai_agent_action_events"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_agent_action_events_revision_check" CHECK ("ai_agent_action_events"."revision" >= 1),
	CONSTRAINT "ai_agent_action_events_transition_check" CHECK (("ai_agent_action_events"."from_status" is null and "ai_agent_action_events"."to_status" = 'pending') or ("ai_agent_action_events"."from_status" is not null and "ai_agent_action_events"."from_status" <> "ai_agent_action_events"."to_status"))
);
--> statement-breakpoint
CREATE TABLE "ai_agent_action_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"action_configuration_id" uuid NOT NULL,
	"conversation_id" uuid,
	"requested_by_id" uuid NOT NULL,
	"action_type" "ai_agent_action_type" NOT NULL,
	"target_course_id" uuid NOT NULL,
	"label_snapshot" varchar(120) NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"status" "ai_agent_action_request_status" DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"decision_note" varchar(1000),
	"decided_by_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_action_requests_payload_digest_check" CHECK ("ai_agent_action_requests"."payload_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_agent_action_requests_label_check" CHECK (length(btrim("ai_agent_action_requests"."label_snapshot")) between 2 and 120),
	CONSTRAINT "ai_agent_action_requests_revision_check" CHECK ("ai_agent_action_requests"."revision" >= 1),
	CONSTRAINT "ai_agent_action_requests_expiry_check" CHECK ("ai_agent_action_requests"."expires_at" > "ai_agent_action_requests"."requested_at"),
	CONSTRAINT "ai_agent_action_requests_decision_state_check" CHECK ((
        "ai_agent_action_requests"."status" = 'pending'
        and "ai_agent_action_requests"."decided_by_id" is null
        and "ai_agent_action_requests"."decision_note" is null
        and "ai_agent_action_requests"."decided_at" is null
        and "ai_agent_action_requests"."executed_at" is null
      ) or (
        "ai_agent_action_requests"."status" = 'approved'
        and "ai_agent_action_requests"."decided_by_id" is not null
        and "ai_agent_action_requests"."decided_at" is not null
        and "ai_agent_action_requests"."executed_at" is not null
      ) or (
        "ai_agent_action_requests"."status" = 'rejected'
        and "ai_agent_action_requests"."decided_by_id" is not null
        and "ai_agent_action_requests"."decision_note" is not null
        and btrim("ai_agent_action_requests"."decision_note") <> ''
        and "ai_agent_action_requests"."decided_at" is not null
        and "ai_agent_action_requests"."executed_at" is null
      ) or (
        "ai_agent_action_requests"."status" in ('cancelled', 'expired')
        and "ai_agent_action_requests"."decided_by_id" is null
        and "ai_agent_action_requests"."decided_at" is not null
        and "ai_agent_action_requests"."executed_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "ai_agent_version_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_version_id" uuid NOT NULL,
	"action_type" "ai_agent_action_type" NOT NULL,
	"course_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"description" varchar(500) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_agent_version_actions_label_check" CHECK (length(btrim("ai_agent_version_actions"."label")) between 2 and 120),
	CONSTRAINT "ai_agent_version_actions_description_check" CHECK (length(btrim("ai_agent_version_actions"."description")) between 3 and 500),
	CONSTRAINT "ai_agent_version_actions_sort_order_check" CHECK ("ai_agent_version_actions"."sort_order" between 0 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_action_requests_id_org_idx" ON "ai_agent_action_requests" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_request_target_idx" ON "ai_agent_version_actions" USING btree ("id","organization_id","agent_version_id","action_type","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversations_id_organization_idx" ON "ai_conversations" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "ai_agent_action_events" ADD CONSTRAINT "ai_agent_action_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_events" ADD CONSTRAINT "ai_agent_action_events_request_tenant_fk" FOREIGN KEY ("request_id","organization_id") REFERENCES "public"."ai_agent_action_requests"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_agent_tenant_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "public"."ai_agents"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_version_tenant_fk" FOREIGN KEY ("agent_version_id","agent_id","organization_id") REFERENCES "public"."ai_agent_versions"("id","agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_configuration_tenant_fk" FOREIGN KEY ("action_configuration_id","organization_id","agent_version_id","action_type","target_course_id") REFERENCES "public"."ai_agent_version_actions"("id","organization_id","agent_version_id","action_type","course_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_conversation_tenant_fk" FOREIGN KEY ("conversation_id","organization_id") REFERENCES "public"."ai_conversations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_requester_tenant_fk" FOREIGN KEY ("requested_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_decider_tenant_fk" FOREIGN KEY ("decided_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_action_requests" ADD CONSTRAINT "ai_agent_action_requests_course_tenant_fk" FOREIGN KEY ("target_course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_version_tenant_fk" FOREIGN KEY ("agent_version_id","organization_id") REFERENCES "public"."ai_agent_versions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_agent_version_actions" ADD CONSTRAINT "ai_agent_version_actions_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_action_events_id_org_idx" ON "ai_agent_action_events" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_action_events_request_revision_idx" ON "ai_agent_action_events" USING btree ("request_id","revision");--> statement-breakpoint
CREATE INDEX "ai_agent_action_events_org_request_created_idx" ON "ai_agent_action_events" USING btree ("organization_id","request_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_action_requests_pending_member_config_idx" ON "ai_agent_action_requests" USING btree ("organization_id","requested_by_id","action_configuration_id") WHERE "ai_agent_action_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "ai_agent_action_requests_org_status_requested_idx" ON "ai_agent_action_requests" USING btree ("organization_id","status","requested_at","id");--> statement-breakpoint
CREATE INDEX "ai_agent_action_requests_org_member_requested_idx" ON "ai_agent_action_requests" USING btree ("organization_id","requested_by_id","requested_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_version_course_idx" ON "ai_agent_version_actions" USING btree ("agent_version_id","action_type","course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_agent_version_actions_id_org_idx" ON "ai_agent_version_actions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE INDEX "ai_agent_version_actions_org_version_order_idx" ON "ai_agent_version_actions" USING btree ("organization_id","agent_version_id","sort_order","id");--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_actions_protect_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "public"."ai_agent_version_actions"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_version_child"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_version_actions_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."ai_agent_version_actions"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."reject_ai_agent_version_truncate"();--> statement-breakpoint
CREATE FUNCTION "public"."protect_ai_agent_action_request_payload"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF NEW."id" IS DISTINCT FROM OLD."id"
		OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
		OR NEW."agent_id" IS DISTINCT FROM OLD."agent_id"
		OR NEW."agent_version_id" IS DISTINCT FROM OLD."agent_version_id"
		OR NEW."action_configuration_id" IS DISTINCT FROM OLD."action_configuration_id"
		OR NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
		OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
		OR NEW."action_type" IS DISTINCT FROM OLD."action_type"
		OR NEW."target_course_id" IS DISTINCT FROM OLD."target_course_id"
		OR NEW."label_snapshot" IS DISTINCT FROM OLD."label_snapshot"
		OR NEW."payload_digest" IS DISTINCT FROM OLD."payload_digest"
		OR NEW."requested_at" IS DISTINCT FROM OLD."requested_at"
		OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
		RAISE EXCEPTION 'AI agent action request payload is immutable'
			USING ERRCODE = '55000';
	END IF;
	IF NEW."revision" <> OLD."revision" + 1 THEN
		RAISE EXCEPTION 'AI agent action request transitions must increment revision by exactly one'
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_ai_agent_action_request_payload"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_requests_payload_protect_trigger"
BEFORE UPDATE ON "public"."ai_agent_action_requests"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_action_request_payload"();--> statement-breakpoint
CREATE FUNCTION "public"."prevent_ai_agent_action_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	RAISE EXCEPTION 'ai_agent_action_events is append-only'
		USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."prevent_ai_agent_action_event_mutation"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_events_append_only_trigger"
BEFORE UPDATE OR DELETE ON "public"."ai_agent_action_events"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_ai_agent_action_event_mutation"();--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_events_prevent_truncate_trigger"
BEFORE TRUNCATE ON "public"."ai_agent_action_events"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."prevent_ai_agent_action_event_mutation"();--> statement-breakpoint
COMMENT ON TRIGGER "ai_agent_action_events_append_only_trigger" ON "public"."ai_agent_action_events" IS
  'Strict append-only action decision audit. Tenant deletion is blocked until an explicit audited retention process handles these events.';
