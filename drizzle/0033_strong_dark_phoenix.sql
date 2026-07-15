CREATE TABLE "oidc_configurations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_name" varchar(80) DEFAULT 'Unternehmens-Login' NOT NULL,
	"issuer" varchar(2000),
	"client_id" varchar(512),
	"client_secret_encrypted" jsonb,
	"auto_provision_members" boolean DEFAULT false NOT NULL,
	"allowed_email_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"password_login_enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_configurations_display_name_check" CHECK (btrim("oidc_configurations"."display_name") <> ''),
	CONSTRAINT "oidc_configurations_enabled_shape_check" CHECK (not "oidc_configurations"."enabled" or ("oidc_configurations"."issuer" is not null and btrim("oidc_configurations"."issuer") <> '' and "oidc_configurations"."client_id" is not null and btrim("oidc_configurations"."client_id") <> '' and "oidc_configurations"."client_secret_encrypted" is not null)),
	CONSTRAINT "oidc_configurations_password_fallback_check" CHECK ("oidc_configurations"."password_login_enabled" or "oidc_configurations"."enabled"),
	CONSTRAINT "oidc_configurations_domains_check" CHECK (jsonb_typeof("oidc_configurations"."allowed_email_domains") = 'array' and jsonb_array_length("oidc_configurations"."allowed_email_domains") <= 50),
	CONSTRAINT "oidc_configurations_version_check" CHECK ("oidc_configurations"."version" >= 1),
	CONSTRAINT "oidc_configurations_timeline_check" CHECK ("oidc_configurations"."updated_at" >= "oidc_configurations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "oidc_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" varchar(2000) NOT NULL,
	"subject" varchar(512) NOT NULL,
	"email_at_link" varchar(255) NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oidc_identities_values_check" CHECK (btrim("oidc_identities"."issuer") <> '' and btrim("oidc_identities"."subject") <> '' and btrim("oidc_identities"."email_at_link") <> ''),
	CONSTRAINT "oidc_identities_timeline_check" CHECK ("oidc_identities"."last_login_at" >= "oidc_identities"."created_at")
);
--> statement-breakpoint
ALTER TABLE "oidc_configurations" ADD CONSTRAINT "oidc_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oidc_identities" ADD CONSTRAINT "oidc_identities_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_org_issuer_subject_idx" ON "oidc_identities" USING btree ("organization_id","issuer","subject");--> statement-breakpoint
CREATE UNIQUE INDEX "oidc_identities_org_user_issuer_idx" ON "oidc_identities" USING btree ("organization_id","user_id","issuer");--> statement-breakpoint
CREATE INDEX "oidc_identities_user_created_idx" ON "oidc_identities" USING btree ("user_id","created_at");