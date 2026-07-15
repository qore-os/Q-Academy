UPDATE "organization_support_settings"
SET "enabled" = false,
	"updated_at" = now()
WHERE "enabled" = true
	AND "provider" = 'intercom'
	AND (
		"intercom_app_id" IS NULL
		OR "identity_secret_encrypted" IS NULL
		OR "identity_secret_encrypted" = ''
	);--> statement-breakpoint
ALTER TABLE "organization_support_settings" DROP CONSTRAINT "organization_support_settings_configuration_check";--> statement-breakpoint
ALTER TABLE "organization_support_settings" ADD CONSTRAINT "organization_support_settings_configuration_check" CHECK ("organization_support_settings"."enabled" = false or ("organization_support_settings"."provider" = 'link' and "organization_support_settings"."support_url" is not null) or ("organization_support_settings"."provider" = 'email' and "organization_support_settings"."support_email" is not null) or ("organization_support_settings"."provider" = 'intercom' and "organization_support_settings"."intercom_app_id" is not null and "organization_support_settings"."identity_secret_encrypted" is not null and "organization_support_settings"."identity_secret_encrypted" <> ''));
