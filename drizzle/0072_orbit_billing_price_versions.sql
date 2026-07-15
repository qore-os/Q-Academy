CREATE TABLE "orbit_billing_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"currency" varchar(3) NOT NULL,
	"base_fee_cents" bigint NOT NULL,
	"included_instance_slots" integer NOT NULL,
	"additional_instance_fee_cents" bigint NOT NULL,
	"created_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orbit_billing_price_versions_revision_check" CHECK ("orbit_billing_price_versions"."revision" between 1 and 2147483647),
	CONSTRAINT "orbit_billing_price_versions_currency_check" CHECK ("orbit_billing_price_versions"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "orbit_billing_price_versions_amounts_check" CHECK ("orbit_billing_price_versions"."base_fee_cents" between 0 and 100000000000 and "orbit_billing_price_versions"."additional_instance_fee_cents" between 0 and 100000000000),
	CONSTRAINT "orbit_billing_price_versions_included_slots_check" CHECK ("orbit_billing_price_versions"."included_instance_slots" between 0 and 10000),
	CONSTRAINT "orbit_billing_price_versions_timeline_check" CHECK ("orbit_billing_price_versions"."effective_from" <= "orbit_billing_price_versions"."created_at" + interval '366 days')
);
--> statement-breakpoint
ALTER TABLE "orbit_billing_accounts" DROP CONSTRAINT "orbit_billing_accounts_amounts_check";--> statement-breakpoint
ALTER TABLE "orbit_billing_statements" DROP CONSTRAINT "orbit_billing_statements_amounts_check";--> statement-breakpoint
ALTER TABLE "orbit_billing_price_versions" ADD CONSTRAINT "orbit_billing_price_versions_workspace_id_orbit_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."orbit_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orbit_billing_price_versions" ADD CONSTRAINT "orbit_billing_price_versions_created_by_account_id_orbit_accounts_id_fk" FOREIGN KEY ("created_by_account_id") REFERENCES "public"."orbit_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orbit_billing_price_versions_workspace_revision_idx" ON "orbit_billing_price_versions" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "orbit_billing_price_versions_workspace_effective_idx" ON "orbit_billing_price_versions" USING btree ("workspace_id","effective_from","revision");--> statement-breakpoint
INSERT INTO "orbit_billing_price_versions" (
	"workspace_id",
	"revision",
	"effective_from",
	"currency",
	"base_fee_cents",
	"included_instance_slots",
	"additional_instance_fee_cents",
	"created_by_account_id",
	"created_at"
)
SELECT
	"account"."workspace_id",
	"account"."revision",
	TIMESTAMPTZ '1970-01-01 00:00:00+00',
	"account"."currency",
	"account"."base_fee_cents",
	"account"."included_instance_slots",
	"account"."additional_instance_fee_cents",
	"workspace"."created_by_account_id",
	"account"."created_at"
FROM "orbit_billing_accounts" AS "account"
INNER JOIN "orbit_workspaces" AS "workspace"
	ON "workspace"."id" = "account"."workspace_id"
ON CONFLICT ("workspace_id", "revision") DO NOTHING;--> statement-breakpoint
DO $block$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "orbit_billing_accounts"
		WHERE "base_fee_cents" > 100000000000
			OR "additional_instance_fee_cents" > 100000000000
	) OR EXISTS (
		SELECT 1
		FROM "orbit_billing_statements"
		WHERE "base_fee_cents" > 100000000000
			OR "additional_instance_fee_cents" > 100000000000
	) THEN
		RAISE EXCEPTION 'Orbit billing amount exceeds the JavaScript-safe pricing ceiling'
			USING ERRCODE = '23514';
	END IF;
END;
$block$;--> statement-breakpoint
ALTER TABLE "orbit_billing_accounts" ADD CONSTRAINT "orbit_billing_accounts_amounts_check" CHECK ("orbit_billing_accounts"."base_fee_cents" between 0 and 100000000000 and "orbit_billing_accounts"."additional_instance_fee_cents" between 0 and 100000000000) NOT VALID;--> statement-breakpoint
ALTER TABLE "orbit_billing_accounts" VALIDATE CONSTRAINT "orbit_billing_accounts_amounts_check";--> statement-breakpoint
ALTER TABLE "orbit_billing_statements" ADD CONSTRAINT "orbit_billing_statements_amounts_check" CHECK ("orbit_billing_statements"."base_fee_cents" between 0 and 100000000000 and "orbit_billing_statements"."additional_instance_fee_cents" between 0 and 100000000000 and "orbit_billing_statements"."subtotal_cents" = "orbit_billing_statements"."base_fee_cents" + ("orbit_billing_statements"."additional_instance_count"::bigint * "orbit_billing_statements"."additional_instance_fee_cents")) NOT VALID;--> statement-breakpoint
ALTER TABLE "orbit_billing_statements" VALIDATE CONSTRAINT "orbit_billing_statements_amounts_check";--> statement-breakpoint
CREATE FUNCTION "public"."protect_orbit_billing_price_version"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'UPDATE'
		AND OLD."created_by_account_id" IS NOT NULL
		AND NEW."created_by_account_id" IS NULL
		AND (to_jsonb(NEW) - 'created_by_account_id') =
			(to_jsonb(OLD) - 'created_by_account_id') THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'orbit_billing_price_versions is append-only'
		USING ERRCODE = '55000';
END;
$function$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."protect_orbit_billing_price_version"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "orbit_billing_price_versions_append_only_trigger"
BEFORE UPDATE OR DELETE ON "public"."orbit_billing_price_versions"
FOR EACH ROW
EXECUTE FUNCTION "public"."protect_orbit_billing_price_version"();--> statement-breakpoint
CREATE TRIGGER "orbit_billing_price_versions_prevent_truncate_trigger"
BEFORE TRUNCATE ON "public"."orbit_billing_price_versions"
FOR EACH STATEMENT
EXECUTE FUNCTION "public"."protect_orbit_billing_price_version"();--> statement-breakpoint
COMMENT ON FUNCTION "public"."protect_orbit_billing_price_version"() IS
	'Preserves Orbit pricing history while allowing only referential unlinking of creator attribution.';
