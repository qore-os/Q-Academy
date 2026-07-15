ALTER TABLE "courses" ADD COLUMN "notify_members_on_module_release" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "linked_course_id" uuid;--> statement-breakpoint
-- PostgreSQL 16 can clear only the optional course key while preserving the required tenant key.
ALTER TABLE "posts" ADD CONSTRAINT "posts_linked_course_tenant_fk" FOREIGN KEY ("linked_course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE SET NULL ("linked_course_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_org_linked_course_idx" ON "posts" USING btree ("organization_id","linked_course_id");--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" DROP CONSTRAINT "lesson_availability_subscriptions_lifecycle_check";--> statement-breakpoint
ALTER TABLE "lesson_availability_subscriptions" ADD CONSTRAINT "lesson_availability_subscriptions_lifecycle_check" CHECK ((
  "lesson_availability_subscriptions"."cancelled_at" is null
  or "lesson_availability_subscriptions"."fulfilled_at" is null
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
  )
));
