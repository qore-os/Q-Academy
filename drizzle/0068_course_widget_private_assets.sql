ALTER TABLE "course_widgets" DROP CONSTRAINT "course_widgets_payload_check";--> statement-breakpoint
ALTER TABLE "course_widgets" ADD COLUMN "media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_media_asset_tenant_fk" FOREIGN KEY ("media_asset_id","organization_id") REFERENCES "public"."media_assets"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_widgets_org_media_asset_idx" ON "course_widgets" USING btree ("organization_id","media_asset_id");--> statement-breakpoint
ALTER TABLE "course_widgets" ADD CONSTRAINT "course_widgets_payload_check" CHECK ((
        "course_widgets"."type" = 'author'
        and "course_widgets"."author_user_id" is not null
        and "course_widgets"."title" is null
        and "course_widgets"."text" is null
        and "course_widgets"."link_url" is null
        and "course_widgets"."image_url" is null
        and "course_widgets"."media_asset_id" is null
        and "course_widgets"."alt_text" is null
      ) or (
        "course_widgets"."type" = 'info'
        and "course_widgets"."author_user_id" is null
        and "course_widgets"."author_role" is null
        and "course_widgets"."author_description" is null
        and length("course_widgets"."title") > 0
        and length("course_widgets"."text") > 0
        and "course_widgets"."image_url" is null
        and "course_widgets"."media_asset_id" is null
        and "course_widgets"."alt_text" is null
      ) or (
        "course_widgets"."type" = 'image_link'
        and "course_widgets"."author_user_id" is null
        and "course_widgets"."author_role" is null
        and "course_widgets"."author_description" is null
        and "course_widgets"."title" is null
        and "course_widgets"."text" is null
        and length("course_widgets"."link_url") > 0
        and length("course_widgets"."image_url") > 0
        and length("course_widgets"."alt_text") > 0
        and (
          "course_widgets"."media_asset_id" is null
          or "course_widgets"."image_url" = '/api/media-assets/' || "course_widgets"."media_asset_id"::text || '/download'
        )
      ));