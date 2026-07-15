CREATE TABLE "mfa_login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"jti_hash" varchar(64) NOT NULL,
	"mode" varchar(16) NOT NULL,
	"auth_method" varchar(16) NOT NULL,
	"oidc_identity_id" uuid,
	"oidc_configuration_version" integer,
	"oidc_auth_time" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mfa_login_challenges_mode_check" CHECK ("mfa_login_challenges"."mode" in ('verify', 'enroll')),
	CONSTRAINT "mfa_login_challenges_auth_shape_check" CHECK (("mfa_login_challenges"."auth_method" = 'password' and "mfa_login_challenges"."oidc_identity_id" is null and "mfa_login_challenges"."oidc_configuration_version" is null and "mfa_login_challenges"."oidc_auth_time" is null) or ("mfa_login_challenges"."auth_method" = 'oidc' and "mfa_login_challenges"."oidc_identity_id" is not null and "mfa_login_challenges"."oidc_configuration_version" is not null)),
	CONSTRAINT "mfa_login_challenges_oidc_version_check" CHECK ("mfa_login_challenges"."oidc_configuration_version" is null or "mfa_login_challenges"."oidc_configuration_version" >= 1),
	CONSTRAINT "mfa_login_challenges_timeline_check" CHECK ("mfa_login_challenges"."expires_at" > "mfa_login_challenges"."created_at" and ("mfa_login_challenges"."consumed_at" is null or "mfa_login_challenges"."consumed_at" >= "mfa_login_challenges"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "organization_mfa_policies" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"require_for_privileged" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_mfa_policies_revision_check" CHECK ("organization_mfa_policies"."revision" >= 1),
	CONSTRAINT "organization_mfa_policies_timeline_check" CHECK ("organization_mfa_policies"."updated_at" >= "organization_mfa_policies"."created_at")
);
--> statement-breakpoint
CREATE TABLE "user_mfa_configurations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"secret_encrypted" jsonb NOT NULL,
	"recovery_code_hashes" text[] DEFAULT '{}' NOT NULL,
	"last_totp_counter" bigint,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_mfa_configurations_status_check" CHECK ("user_mfa_configurations"."status" in ('pending', 'enabled')),
	CONSTRAINT "user_mfa_configurations_secret_envelope_check" CHECK (jsonb_typeof("user_mfa_configurations"."secret_encrypted") = 'object' and "user_mfa_configurations"."secret_encrypted" ->> 'v' = '2' and btrim(coalesce("user_mfa_configurations"."secret_encrypted" ->> 'kid', '')) <> '' and btrim(coalesce("user_mfa_configurations"."secret_encrypted" ->> 'iv', '')) <> '' and btrim(coalesce("user_mfa_configurations"."secret_encrypted" ->> 'tag', '')) <> '' and btrim(coalesce("user_mfa_configurations"."secret_encrypted" ->> 'ciphertext', '')) <> ''),
	CONSTRAINT "user_mfa_configurations_recovery_hashes_check" CHECK (cardinality("user_mfa_configurations"."recovery_code_hashes") <= 12 and array_to_string("user_mfa_configurations"."recovery_code_hashes", ',') ~ '^(v1\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.[a-f0-9]{64})(,v1\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.[a-f0-9]{64})*$|^$'),
	CONSTRAINT "user_mfa_configurations_state_check" CHECK (("user_mfa_configurations"."status" = 'pending' and "user_mfa_configurations"."enabled_at" is null and "user_mfa_configurations"."last_totp_counter" is null and cardinality("user_mfa_configurations"."recovery_code_hashes") = 0) or ("user_mfa_configurations"."status" = 'enabled' and "user_mfa_configurations"."enabled_at" is not null and "user_mfa_configurations"."last_totp_counter" is not null)),
	CONSTRAINT "user_mfa_configurations_counter_check" CHECK ("user_mfa_configurations"."last_totp_counter" is null or "user_mfa_configurations"."last_totp_counter" >= 0),
	CONSTRAINT "user_mfa_configurations_timeline_check" CHECK ("user_mfa_configurations"."updated_at" >= "user_mfa_configurations"."created_at" and ("user_mfa_configurations"."enabled_at" is null or ("user_mfa_configurations"."enabled_at" >= "user_mfa_configurations"."created_at" and "user_mfa_configurations"."enabled_at" <= "user_mfa_configurations"."updated_at")))
);
--> statement-breakpoint
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_auth_timeline_check";--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD COLUMN "mfa_method" varchar(16);--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mfa_login_challenges" ADD CONSTRAINT "mfa_login_challenges_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_mfa_policies" ADD CONSTRAINT "organization_mfa_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_configurations" ADD CONSTRAINT "user_mfa_configurations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_configurations" ADD CONSTRAINT "user_mfa_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_mfa_configurations" ADD CONSTRAINT "user_mfa_configurations_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_login_challenges_jti_hash_idx" ON "mfa_login_challenges" USING btree ("jti_hash");--> statement-breakpoint
CREATE INDEX "mfa_login_challenges_user_active_idx" ON "mfa_login_challenges" USING btree ("organization_id","user_id","consumed_at","expires_at");--> statement-breakpoint
CREATE INDEX "mfa_login_challenges_expiry_idx" ON "mfa_login_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "user_mfa_configurations_org_status_idx" ON "user_mfa_configurations" USING btree ("organization_id","status");--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_mfa_shape_check" CHECK (("user_sessions"."mfa_verified_at" is null and "user_sessions"."mfa_method" is null) or ("user_sessions"."mfa_verified_at" is not null and "user_sessions"."mfa_method" in ('totp', 'recovery')));--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_auth_timeline_check" CHECK ("user_sessions"."authenticated_at" <= "user_sessions"."last_seen_at" and ("user_sessions"."oidc_auth_time" is null or "user_sessions"."oidc_auth_time" <= "user_sessions"."authenticated_at" + interval '5 minutes') and ("user_sessions"."mfa_verified_at" is null or "user_sessions"."mfa_verified_at" >= "user_sessions"."authenticated_at" - interval '5 minutes'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."protect_ai_agent_action_request_payload"()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
	IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
		RAISE EXCEPTION 'AI agent action requests cannot be deleted or truncated'
			USING ERRCODE = '55000';
	END IF;
	IF OLD."status" <> 'pending'
		OR NEW."status" NOT IN ('approved', 'rejected', 'cancelled', 'expired') THEN
		RAISE EXCEPTION 'AI agent action requests may only transition once from pending to a terminal status'
			USING ERRCODE = '23514';
	END IF;
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
$function$;
--> statement-breakpoint
DROP TRIGGER "ai_agent_action_requests_payload_protect_trigger" ON "public"."ai_agent_action_requests";
--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_requests_payload_protect_trigger"
BEFORE UPDATE OR DELETE ON "public"."ai_agent_action_requests"
FOR EACH ROW EXECUTE FUNCTION "public"."protect_ai_agent_action_request_payload"();
--> statement-breakpoint
CREATE TRIGGER "ai_agent_action_requests_reject_truncate_trigger"
BEFORE TRUNCATE ON "public"."ai_agent_action_requests"
FOR EACH STATEMENT EXECUTE FUNCTION "public"."protect_ai_agent_action_request_payload"();
--> statement-breakpoint
COMMENT ON TRIGGER "ai_agent_action_requests_payload_protect_trigger" ON "public"."ai_agent_action_requests" IS
  'Requests are immutable approval evidence: exactly one pending-to-terminal transition is allowed and direct deletion is blocked.';
