CREATE TABLE "orbit_billing_accounts" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"billing_interval" varchar(16) DEFAULT 'monthly' NOT NULL,
	"base_fee_cents" bigint DEFAULT 0 NOT NULL,
	"included_instance_slots" integer DEFAULT 1 NOT NULL,
	"additional_instance_fee_cents" bigint DEFAULT 0 NOT NULL,
	"settlement_mode" varchar(20) DEFAULT 'manual' NOT NULL,
	"external_customer_reference" varchar(180),
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_billing_accounts_status_check" CHECK ("orbit_billing_accounts"."status" in ('active', 'past_due', 'suspended')),
	CONSTRAINT "orbit_billing_accounts_currency_check" CHECK ("orbit_billing_accounts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orbit_billing_accounts_interval_check" CHECK ("orbit_billing_accounts"."billing_interval" in ('monthly', 'annual')),
	CONSTRAINT "orbit_billing_accounts_amounts_check" CHECK ("orbit_billing_accounts"."base_fee_cents" between 0 and 1000000000000 and "orbit_billing_accounts"."additional_instance_fee_cents" between 0 and 1000000000000),
	CONSTRAINT "orbit_billing_accounts_included_slots_check" CHECK ("orbit_billing_accounts"."included_instance_slots" between 0 and 10000),
	CONSTRAINT "orbit_billing_accounts_settlement_check" CHECK (("orbit_billing_accounts"."settlement_mode" = 'manual' and "orbit_billing_accounts"."external_customer_reference" is null) or ("orbit_billing_accounts"."settlement_mode" = 'external' and btrim("orbit_billing_accounts"."external_customer_reference") <> '')),
	CONSTRAINT "orbit_billing_accounts_revision_check" CHECK ("orbit_billing_accounts"."revision" between 1 and 2147483647),
	CONSTRAINT "orbit_billing_accounts_timeline_check" CHECK ("orbit_billing_accounts"."updated_at" >= "orbit_billing_accounts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "orbit_billing_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"instance_count" integer NOT NULL,
	"included_instance_slots" integer NOT NULL,
	"additional_instance_count" integer NOT NULL,
	"base_fee_cents" bigint NOT NULL,
	"additional_instance_fee_cents" bigint NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"pricing_revision" integer NOT NULL,
	"finalized_by_account_id" uuid,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_billing_statements_period_check" CHECK ("orbit_billing_statements"."period_end" > "orbit_billing_statements"."period_start"),
	CONSTRAINT "orbit_billing_statements_counts_check" CHECK ("orbit_billing_statements"."instance_count" between 0 and 10000 and "orbit_billing_statements"."included_instance_slots" between 0 and 10000 and "orbit_billing_statements"."additional_instance_count" = greatest("orbit_billing_statements"."instance_count" - "orbit_billing_statements"."included_instance_slots", 0)),
	CONSTRAINT "orbit_billing_statements_amounts_check" CHECK ("orbit_billing_statements"."base_fee_cents" between 0 and 1000000000000 and "orbit_billing_statements"."additional_instance_fee_cents" between 0 and 1000000000000 and "orbit_billing_statements"."subtotal_cents" = "orbit_billing_statements"."base_fee_cents" + ("orbit_billing_statements"."additional_instance_count"::bigint * "orbit_billing_statements"."additional_instance_fee_cents")),
	CONSTRAINT "orbit_billing_statements_currency_check" CHECK ("orbit_billing_statements"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orbit_billing_statements_revision_check" CHECK ("orbit_billing_statements"."pricing_revision" between 1 and 2147483647),
	CONSTRAINT "orbit_billing_statements_timeline_check" CHECK ("orbit_billing_statements"."finalized_at" >= "orbit_billing_statements"."period_end" and "orbit_billing_statements"."created_at" >= "orbit_billing_statements"."finalized_at")
);
--> statement-breakpoint
ALTER TABLE "orbit_permission_sets" DROP CONSTRAINT "orbit_permission_sets_permissions_check";--> statement-breakpoint
ALTER TABLE "orbit_billing_accounts" ADD CONSTRAINT "orbit_billing_accounts_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_billing_statements" ADD CONSTRAINT "orbit_billing_statements_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_billing_statements" ADD CONSTRAINT "orbit_billing_statements_finalized_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("finalized_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_billing_statements_workspace_period_idx" ON "orbit_billing_statements" USING btree ("workspace_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "orbit_billing_statements_workspace_finalized_idx" ON "orbit_billing_statements" USING btree ("workspace_id","finalized_at");--> statement-breakpoint
INSERT INTO "orbit_billing_accounts" (
	"workspace_id",
	"included_instance_slots"
)
SELECT
	"id",
	1
FROM "orbit_workspaces"
ON CONFLICT ("workspace_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE "orbit_permission_sets" ADD CONSTRAINT "orbit_permission_sets_permissions_check" CHECK ("orbit_permission_sets"."permissions" <@ array['instances:read','instances:manage','memberships:manage','delegations:manage','entitlements:manage','transfers:read','transfers:create','billing:read','billing:manage','audit:read']::text[] and cardinality("orbit_permission_sets"."permissions") <= 10) NOT VALID;--> statement-breakpoint
ALTER TABLE "orbit_permission_sets" VALIDATE CONSTRAINT "orbit_permission_sets_permissions_check";--> statement-breakpoint
CREATE FUNCTION "public"."protect_orbit_billing_statement"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD."finalized_by_account_id" IS NOT NULL
		AND NEW."finalized_by_account_id" IS NULL
		AND (to_jsonb(NEW) - 'finalized_by_account_id') =
			(to_jsonb(OLD) - 'finalized_by_account_id') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'orbit_billing_statements is append-only'
		USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_orbit_billing_statement"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "orbit_billing_statements_append_only_trigger"
BEFORE UPDATE OR DELETE ON "public"."orbit_billing_statements"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_orbit_billing_statement"();--> statement-breakpoint
CREATE TRIGGER "orbit_billing_statements_prevent_truncate_trigger"
BEFORE TRUNCATE ON "public"."orbit_billing_statements"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."protect_orbit_billing_statement"();--> statement-breakpoint
COMMENT ON FUNCTION "public"."protect_orbit_billing_statement"() IS
	'Preserves finalized Orbit billing facts while allowing only referential unlinking of finalizer attribution.';
