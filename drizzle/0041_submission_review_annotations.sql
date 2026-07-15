CREATE TYPE "public"."submission_review_annotation_type" AS ENUM('text_range', 'media_timestamp');--> statement-breakpoint
CREATE TABLE "submission_review_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"type" "submission_review_annotation_type" NOT NULL,
	"body" text NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"media_asset_id" uuid,
	"media_asset_kind" "media_asset_kind",
	"timestamp_milliseconds" integer,
	"sort_order" integer NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_review_annotations_body_check" CHECK (char_length("submission_review_annotations"."body") between 1 and 2000 and btrim("submission_review_annotations"."body") <> ''),
	CONSTRAINT "submission_review_annotations_fingerprint_check" CHECK ("submission_review_annotations"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "submission_review_annotations_sort_order_check" CHECK ("submission_review_annotations"."sort_order" >= 0 and "submission_review_annotations"."sort_order" < 100),
	CONSTRAINT "submission_review_annotations_shape_check" CHECK ((
        "submission_review_annotations"."type" = 'text_range'
        and "submission_review_annotations"."start_offset" >= 0
        and "submission_review_annotations"."end_offset" > "submission_review_annotations"."start_offset"
        and "submission_review_annotations"."media_asset_id" is null
        and "submission_review_annotations"."media_asset_kind" is null
        and "submission_review_annotations"."timestamp_milliseconds" is null
      ) or (
        "submission_review_annotations"."type" = 'media_timestamp'
        and "submission_review_annotations"."start_offset" is null
        and "submission_review_annotations"."end_offset" is null
        and "submission_review_annotations"."media_asset_id" is not null
        and "submission_review_annotations"."media_asset_kind" in ('audio', 'video')
        and "submission_review_annotations"."timestamp_milliseconds" >= 0
      ))
);
--> statement-breakpoint
ALTER TABLE "submission_review_annotations" ADD CONSTRAINT "submission_review_annotations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_id_org_kind_idx" ON "media_assets" USING btree ("id","organization_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_attachments_asset_submission_org_idx" ON "submission_attachments" USING btree ("media_asset_id","submission_id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_reviews_id_submission_org_idx" ON "submission_reviews" USING btree ("id","submission_id","organization_id");--> statement-breakpoint
ALTER TABLE "submission_review_annotations" ADD CONSTRAINT "submission_review_annotations_review_scope_fk" FOREIGN KEY ("review_id","submission_id","organization_id") REFERENCES "public"."submission_reviews"("id","submission_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_review_annotations" ADD CONSTRAINT "submission_review_annotations_attachment_scope_fk" FOREIGN KEY ("media_asset_id","submission_id","organization_id") REFERENCES "public"."submission_attachments"("media_asset_id","submission_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_review_annotations" ADD CONSTRAINT "submission_review_annotations_media_kind_fk" FOREIGN KEY ("media_asset_id","organization_id","media_asset_kind") REFERENCES "public"."media_assets"("id","organization_id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "submission_review_annotations_review_order_idx" ON "submission_review_annotations" USING btree ("review_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_review_annotations_review_fingerprint_idx" ON "submission_review_annotations" USING btree ("review_id","fingerprint");--> statement-breakpoint
CREATE INDEX "submission_review_annotations_org_submission_idx" ON "submission_review_annotations" USING btree ("organization_id","submission_id","sort_order");--> statement-breakpoint
CREATE INDEX "submission_review_annotations_org_asset_idx" ON "submission_review_annotations" USING btree ("organization_id","media_asset_id");--> statement-breakpoint
CREATE FUNCTION "prevent_submission_review_annotation_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'submission review annotations are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "submission_review_annotations_prevent_update"
BEFORE UPDATE ON "submission_review_annotations"
FOR EACH ROW
EXECUTE FUNCTION "prevent_submission_review_annotation_update"();
