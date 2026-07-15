CREATE TYPE "public"."push_delivery_status" AS ENUM('pending', 'processing', 'delivered', 'failed', 'retrying');--> statement-breakpoint
CREATE TABLE "lesson_learning_time_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"last_sequence" integer DEFAULT 0 NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_learning_time_sessions_sequence_check" CHECK ("lesson_learning_time_sessions"."last_sequence" >= 0 and "lesson_learning_time_sessions"."last_sequence" <= 1000000),
	CONSTRAINT "lesson_learning_time_sessions_active_seconds_check" CHECK ("lesson_learning_time_sessions"."active_seconds" >= 0 and "lesson_learning_time_sessions"."active_seconds" <= 86400),
	CONSTRAINT "lesson_learning_time_sessions_timestamps_check" CHECK ("lesson_learning_time_sessions"."last_heartbeat_at" >= "lesson_learning_time_sessions"."started_at" and "lesson_learning_time_sessions"."updated_at" >= "lesson_learning_time_sessions"."last_heartbeat_at")
);
--> statement-breakpoint
CREATE TABLE "push_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"status" "push_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_body" text,
	"next_retry_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_notification_deliveries_attempt_check" CHECK ("push_notification_deliveries"."attempt" between 0 and 8),
	CONSTRAINT "push_notification_deliveries_response_status_check" CHECK ("push_notification_deliveries"."response_status" is null or "push_notification_deliveries"."response_status" between 100 and 599),
	CONSTRAINT "push_notification_deliveries_response_body_check" CHECK ("push_notification_deliveries"."response_body" is null or char_length("push_notification_deliveries"."response_body") <= 500),
	CONSTRAINT "push_notification_deliveries_state_check" CHECK (("push_notification_deliveries"."status" = 'pending' and "push_notification_deliveries"."claimed_at" is null and "push_notification_deliveries"."next_retry_at" is null and "push_notification_deliveries"."delivered_at" is null) or ("push_notification_deliveries"."status" = 'processing' and "push_notification_deliveries"."claimed_at" is not null and "push_notification_deliveries"."next_retry_at" is null and "push_notification_deliveries"."delivered_at" is null) or ("push_notification_deliveries"."status" = 'retrying' and "push_notification_deliveries"."claimed_at" is null and "push_notification_deliveries"."next_retry_at" is not null and "push_notification_deliveries"."delivered_at" is null) or ("push_notification_deliveries"."status" = 'failed' and "push_notification_deliveries"."claimed_at" is null and "push_notification_deliveries"."next_retry_at" is null and "push_notification_deliveries"."delivered_at" is null) or ("push_notification_deliveries"."status" = 'delivered' and "push_notification_deliveries"."claimed_at" is null and "push_notification_deliveries"."next_retry_at" is null and "push_notification_deliveries"."delivered_at" is not null)),
	CONSTRAINT "push_notification_deliveries_timestamps_check" CHECK ("push_notification_deliveries"."updated_at" >= "push_notification_deliveries"."created_at" and ("push_notification_deliveries"."delivered_at" is null or "push_notification_deliveries"."delivered_at" >= "push_notification_deliveries"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint_hash" varchar(64) NOT NULL,
	"subscription_encrypted" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "web_push_subscriptions_endpoint_hash_check" CHECK ("web_push_subscriptions"."endpoint_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "web_push_subscriptions_encrypted_check" CHECK (jsonb_typeof("web_push_subscriptions"."subscription_encrypted") = 'object' and "web_push_subscriptions"."subscription_encrypted" ->> 'v' = '2' and "web_push_subscriptions"."subscription_encrypted" ->> 'alg' = 'A256GCM' and btrim(coalesce("web_push_subscriptions"."subscription_encrypted" ->> 'kid', '')) <> '' and btrim(coalesce("web_push_subscriptions"."subscription_encrypted" ->> 'iv', '')) <> '' and btrim(coalesce("web_push_subscriptions"."subscription_encrypted" ->> 'tag', '')) <> '' and btrim(coalesce("web_push_subscriptions"."subscription_encrypted" ->> 'ciphertext', '')) <> ''),
	CONSTRAINT "web_push_subscriptions_timestamps_check" CHECK ("web_push_subscriptions"."updated_at" >= "web_push_subscriptions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "default_locale" varchar(5) DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_locale" varchar(5);--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_learning_time_sessions" ADD CONSTRAINT "lesson_learning_time_sessions_lesson_tenant_fk" FOREIGN KEY ("lesson_id","organization_id") REFERENCES "public"."lessons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_notification_user_fk" FOREIGN KEY ("notification_id","user_id") REFERENCES "public"."notifications"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_id_user_org_idx" ON "web_push_subscriptions" USING btree ("id","user_id","organization_id");--> statement-breakpoint
ALTER TABLE "push_notification_deliveries" ADD CONSTRAINT "push_notification_deliveries_subscription_tenant_fk" FOREIGN KEY ("subscription_id","user_id","organization_id") REFERENCES "public"."web_push_subscriptions"("id","user_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_push_subscriptions" ADD CONSTRAINT "web_push_subscriptions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lesson_learning_time_sessions_org_course_idx" ON "lesson_learning_time_sessions" USING btree ("organization_id","course_id","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "lesson_learning_time_sessions_org_user_idx" ON "lesson_learning_time_sessions" USING btree ("organization_id","user_id","last_heartbeat_at");--> statement-breakpoint
CREATE INDEX "lesson_learning_time_sessions_org_lesson_idx" ON "lesson_learning_time_sessions" USING btree ("organization_id","lesson_id","last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_notification_deliveries_notification_subscription_idx" ON "push_notification_deliveries" USING btree ("notification_id","subscription_id");--> statement-breakpoint
CREATE INDEX "push_notification_deliveries_status_retry_idx" ON "push_notification_deliveries" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE INDEX "push_notification_deliveries_processing_claim_idx" ON "push_notification_deliveries" USING btree ("status","claimed_at");--> statement-breakpoint
CREATE INDEX "push_notification_deliveries_org_created_idx" ON "push_notification_deliveries" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "web_push_subscriptions_endpoint_hash_idx" ON "web_push_subscriptions" USING btree ("endpoint_hash");--> statement-breakpoint
CREATE INDEX "web_push_subscriptions_org_user_idx" ON "web_push_subscriptions" USING btree ("organization_id","user_id","updated_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_default_locale_check" CHECK ("organizations"."default_locale" in ('de', 'en', 'it', 'es', 'fr'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_locale_check" CHECK ("users"."preferred_locale" is null or "users"."preferred_locale" in ('de', 'en', 'it', 'es', 'fr'));
