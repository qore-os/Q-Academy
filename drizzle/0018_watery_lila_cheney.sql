CREATE TABLE "course_media_assets" (
	"organization_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"attached_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "courses_id_organization_idx" ON "courses" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "course_media_assets" ADD CONSTRAINT "course_media_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_media_assets" ADD CONSTRAINT "course_media_assets_course_tenant_fk" FOREIGN KEY ("course_id","organization_id") REFERENCES "public"."courses"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_media_assets" ADD CONSTRAINT "course_media_assets_media_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_media_assets" ADD CONSTRAINT "course_media_assets_attached_by_tenant_fk" FOREIGN KEY ("attached_by_id","organization_id") REFERENCES "public"."users"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_media_assets_org_course_asset_idx" ON "course_media_assets" USING btree ("organization_id","course_id","media_asset_id");--> statement-breakpoint
CREATE INDEX "course_media_assets_org_course_created_idx" ON "course_media_assets" USING btree ("organization_id","course_id","created_at");--> statement-breakpoint
CREATE INDEX "course_media_assets_org_asset_idx" ON "course_media_assets" USING btree ("organization_id","media_asset_id");--> statement-breakpoint
CREATE INDEX "course_media_assets_org_attached_by_idx" ON "course_media_assets" USING btree ("organization_id","attached_by_id");
