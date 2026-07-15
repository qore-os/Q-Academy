CREATE TABLE "lesson_availability_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"subscribed_version_id" uuid NOT NULL,
	"fulfilled_version_id" uuid,
	"notification_id" uuid,
	"email_delivery_id" uuid,
	"subscribed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lesson_availability_subscriptions_lifecycle_check" CHECK ((
        "lesson_availability_subscriptions"."cancelled_at" is null or "lesson_availability_subscriptions"."fulfilled_at" is null
      ) and (
        (
          "lesson_availability_subscriptions"."fulfilled_at" is null
          and "lesson_availability_subscriptions"."fulfilled_version_id" is null
          and "lesson_availability_subscriptions"."notification_id" is null
          and "lesson_availability_subscriptions"."email_delivery_id" is null
        ) or (
          "lesson_availability_subscriptions"."fulfilled_at" is not null
          and "lesson_availability_subscriptions"."fulfilled_version_id" is not null
          and "lesson_availability_subscriptions"."notification_id" is not null
          and "lesson_availability_subscriptions"."email_delivery_id" is not null
        )
      )),
	CONSTRAINT "lesson_availability_subscriptions_timestamps_check" CHECK ("lesson_availability_subscriptions"."cancelled_at" is null or "lesson_availability_subscriptions"."cancelled_at" >= "lesson_availability_subscriptions"."subscribed_at"),
	CONSTRAINT "lesson_availability_subscriptions_fulfilled_at_check" CHECK ("lesson_availability_subscriptions"."fulfilled_at" is null or "lesson_availability_subscriptions"."fulfilled_at" >= "lesson_availability_subscriptions"."subscribed_at")
);
--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_subscribed_version_id_course_versions_id_fk" FOREIGN KEY ("subscribed_version_id") REFERENCES "public"."course_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_fulfilled_version_id_course_versions_id_fk" FOREIGN KEY ("fulfilled_version_id") REFERENCES "public"."course_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_email_delivery_id_email_deliveries_id_fk" FOREIGN KEY ("email_delivery_id") REFERENCES "public"."email_deliveries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_user_tenant_fk" FOREIGN KEY ("user_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_lesson_tenant_fk" FOREIGN KEY ("lesson_id","organization_id") REFERENCES "public"."lessons"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_availability_subscriptions_active_idx" ON "lesson_availability_subscriptions" USING btree ("organization_id","user_id","course_id","lesson_id") WHERE "lesson_availability_subscriptions"."cancelled_at" is null and "lesson_availability_subscriptions"."fulfilled_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_availability_subscriptions_notification_idx" ON "lesson_availability_subscriptions" USING btree ("notification_id") WHERE "lesson_availability_subscriptions"."notification_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_availability_subscriptions_delivery_idx" ON "lesson_availability_subscriptions" USING btree ("email_delivery_id") WHERE "lesson_availability_subscriptions"."email_delivery_id" is not null;--> statement-breakpoint
CREATE INDEX "lesson_availability_subscriptions_course_active_idx" ON "lesson_availability_subscriptions" USING btree ("organization_id","course_id","cancelled_at","fulfilled_at");--> statement-breakpoint
CREATE INDEX "lesson_availability_subscriptions_user_created_idx" ON "lesson_availability_subscriptions" USING btree ("organization_id","user_id","subscribed_at");