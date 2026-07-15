CREATE TABLE "webhook_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"replay_generation" integer NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" varchar(20) NOT NULL,
	"response_status" integer,
	"failure_kind" varchar(24),
	"response_body_redacted" boolean DEFAULT false NOT NULL,
	"duration_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_attempts_position_check" CHECK ("webhook_delivery_attempts"."replay_generation" >= 0 and "webhook_delivery_attempts"."attempt" >= 1),
	CONSTRAINT "webhook_delivery_attempts_outcome_check" CHECK ("webhook_delivery_attempts"."outcome" in ('delivered', 'retrying', 'failed')),
	CONSTRAINT "webhook_delivery_attempts_response_check" CHECK ("webhook_delivery_attempts"."response_status" is null or "webhook_delivery_attempts"."response_status" between 100 and 599),
	CONSTRAINT "webhook_delivery_attempts_failure_check" CHECK (("webhook_delivery_attempts"."outcome" = 'delivered' and "webhook_delivery_attempts"."failure_kind" is null) or ("webhook_delivery_attempts"."outcome" <> 'delivered' and "webhook_delivery_attempts"."failure_kind" in ('http', 'timeout', 'dns', 'tls', 'connection', 'configuration', 'unknown'))),
	CONSTRAINT "webhook_delivery_attempts_timeline_check" CHECK ("webhook_delivery_attempts"."duration_ms" >= 0 and "webhook_delivery_attempts"."completed_at" >= "webhook_delivery_attempts"."started_at")
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "replay_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_id_organization_idx" ON "webhook_deliveries" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_delivery_tenant_fk" FOREIGN KEY ("delivery_id","organization_id") REFERENCES "public"."webhook_deliveries"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_webhook_tenant_fk" FOREIGN KEY ("webhook_id","organization_id") REFERENCES "public"."webhooks"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_attempts_delivery_generation_attempt_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","replay_generation","attempt");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_org_completed_idx" ON "webhook_delivery_attempts" USING btree ("organization_id","completed_at","id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_attempts_delivery_completed_idx" ON "webhook_delivery_attempts" USING btree ("delivery_id","completed_at","id");--> statement-breakpoint
UPDATE "webhook_deliveries"
SET "claimed_at" = coalesce("claimed_at", now()),
	"claim_token" = gen_random_uuid()
WHERE "status" = 'processing';--> statement-breakpoint
UPDATE "webhook_deliveries"
SET "claimed_at" = null,
	"claim_token" = null
WHERE "status" <> 'processing';--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_claim_state_check" CHECK (("webhook_deliveries"."status" = 'processing' and "webhook_deliveries"."claimed_at" is not null and "webhook_deliveries"."claim_token" is not null) or ("webhook_deliveries"."status" <> 'processing' and "webhook_deliveries"."claimed_at" is null and "webhook_deliveries"."claim_token" is null));--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_replay_generation_check" CHECK ("webhook_deliveries"."replay_generation" >= 0);
--> statement-breakpoint
INSERT INTO "webhook_delivery_attempts" (
	"organization_id",
	"delivery_id",
	"webhook_id",
	"replay_generation",
	"attempt",
	"outcome",
	"response_status",
	"failure_kind",
	"response_body_redacted",
	"duration_ms",
	"started_at",
	"completed_at"
)
SELECT
	"organization_id",
	"id",
	"webhook_id",
	0,
	"attempt",
	CASE
		WHEN "status" = 'delivered' THEN 'delivered'
		WHEN "status" = 'retrying' THEN 'retrying'
		ELSE 'failed'
	END,
	"response_status",
	CASE
		WHEN "status" = 'delivered' THEN null
		WHEN "response_status" is not null THEN 'http'
		ELSE 'unknown'
	END,
	"response_body" is not null,
	greatest(coalesce("duration_ms", 0), 0),
	"updated_at" - make_interval(secs => greatest(coalesce("duration_ms", 0), 0)::double precision / 1000),
	"updated_at"
FROM "webhook_deliveries"
WHERE "attempt" > 0
	AND "status" IN ('delivered', 'retrying', 'failed');
--> statement-breakpoint
CREATE FUNCTION "public"."protect_webhook_delivery_attempt"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' AND (
		NOT EXISTS (
			SELECT 1
			FROM "public"."webhook_deliveries" delivery
			WHERE delivery."id" = OLD."delivery_id"
				AND delivery."organization_id" = OLD."organization_id"
		)
		OR NOT EXISTS (
			SELECT 1
			FROM "public"."webhooks" webhook
			WHERE webhook."id" = OLD."webhook_id"
				AND webhook."organization_id" = OLD."organization_id"
		)
		OR "public"."tenant_erasure_cascade_is_authorized"(OLD."organization_id")
	) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'webhook delivery attempts are append-only' USING ERRCODE = '55000';
END;
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_webhook_delivery_attempt"() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER "webhook_delivery_attempts_protect_trigger"
BEFORE UPDATE OR DELETE ON "public"."webhook_delivery_attempts"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_webhook_delivery_attempt"();
--> statement-breakpoint
CREATE TRIGGER "webhook_delivery_attempts_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."webhook_delivery_attempts"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."protect_webhook_delivery_attempt"();
