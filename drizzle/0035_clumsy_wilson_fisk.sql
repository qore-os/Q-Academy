ALTER TABLE "oidc_identities" ADD COLUMN "last_configuration_version" integer;--> statement-breakpoint
UPDATE "oidc_identities" AS identity
SET "last_configuration_version" = COALESCE(configuration."version", 1)
FROM "oidc_configurations" AS configuration
WHERE configuration."organization_id" = identity."organization_id"
  AND configuration."issuer" = identity."issuer";--> statement-breakpoint
UPDATE "oidc_identities"
SET "last_configuration_version" = 1
WHERE "last_configuration_version" IS NULL;--> statement-breakpoint
ALTER TABLE "oidc_identities" ALTER COLUMN "last_configuration_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_configuration_version_check" CHECK ("oidc_identities"."last_configuration_version" >= 1);
