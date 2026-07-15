ALTER TABLE "user_sessions" ADD COLUMN "auth_method" varchar(16) DEFAULT 'password' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "oidc_identity_id" uuid;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "oidc_configuration_version" integer;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "authenticated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "oidc_auth_time" timestamp with time zone;--> statement-breakpoint
UPDATE "user_sessions"
SET "authenticated_at" = LEAST("created_at", "last_seen_at");--> statement-breakpoint
CREATE INDEX "user_sessions_oidc_identity_active_idx" ON "user_sessions" USING btree ("oidc_identity_id","revoked_at","expires_at");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_auth_method_shape_check" CHECK (("user_sessions"."auth_method" = 'password' and "user_sessions"."oidc_identity_id" is null and "user_sessions"."oidc_configuration_version" is null and "user_sessions"."oidc_auth_time" is null) or ("user_sessions"."auth_method" = 'oidc' and "user_sessions"."oidc_identity_id" is not null and "user_sessions"."oidc_configuration_version" is not null));--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_oidc_configuration_version_check" CHECK ("user_sessions"."oidc_configuration_version" is null or "user_sessions"."oidc_configuration_version" >= 1);--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_auth_timeline_check" CHECK ("user_sessions"."authenticated_at" <= "user_sessions"."last_seen_at" and ("user_sessions"."oidc_auth_time" is null or "user_sessions"."oidc_auth_time" <= "user_sessions"."authenticated_at" + interval '5 minutes'));
