ALTER TABLE "oidc_identities" ALTER COLUMN "last_configuration_version" DROP NOT NULL;--> statement-breakpoint
UPDATE "oidc_identities" SET "last_configuration_version" = NULL;
